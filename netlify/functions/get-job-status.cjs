"use strict";

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { COLLECTIONS } = require('./utils/collections.cjs');
const { createStandardEntryMeta, logDebugRequestSummary } = require('./utils/handler-logging.cjs');

const MAX_JOB_IDS = 100;

function normalizeJobIds(raw) {
    if (!raw) return [];

    const values = Array.isArray(raw) ? raw : [raw];

    return values
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, MAX_JOB_IDS);
}

function extractJobIdsFromQuery(event) {
    const params = event?.queryStringParameters || {};

    if (typeof params.ids === 'string' && params.ids.trim()) {
        return normalizeJobIds(params.ids.split(','));
    }

    if (typeof params.jobId === 'string' && params.jobId.trim()) {
        return normalizeJobIds([params.jobId]);
    }

    if (typeof params.id === 'string' && params.id.trim()) {
        return normalizeJobIds([params.id]);
    }

    return [];
}

function extractJobIdsFromBody(event) {
    if (!event?.body || typeof event.body !== 'string') return { ok: false, error: 'Missing request body' };

    let body;
    try {
        body = JSON.parse(event.body);
    } catch {
        return { ok: false, error: 'Invalid JSON body' };
    }

    if (Array.isArray(body?.jobIds)) {
        return { ok: true, jobIds: normalizeJobIds(body.jobIds) };
    }

    if (typeof body?.jobId === 'string') {
        return { ok: true, jobIds: normalizeJobIds([body.jobId]) };
    }

    if (typeof body?.ids === 'string' && body.ids.trim()) {
        return { ok: true, jobIds: normalizeJobIds(body.ids.split(',')) };
    }

    return { ok: false, error: 'jobIds is required' };
}

function deriveStatusFromProgressEvent(progressEvent) {
    if (!progressEvent || typeof progressEvent !== 'object') {
        return { status: 'queued' };
    }

    const stage = typeof progressEvent.stage === 'string' ? progressEvent.stage : '';
    const message = typeof progressEvent.message === 'string' ? progressEvent.message : undefined;
    const recordId = typeof progressEvent.recordId === 'string' ? progressEvent.recordId : undefined;
    const retryCount = typeof progressEvent.retryCount === 'number' ? progressEvent.retryCount : undefined;
    const nextRetryAt = typeof progressEvent.nextRetryAt === 'string' ? progressEvent.nextRetryAt : undefined;
    const lastFailureReason = typeof progressEvent.lastFailureReason === 'string' ? progressEvent.lastFailureReason : undefined;
    const fileName = typeof progressEvent.fileName === 'string' ? progressEvent.fileName : undefined;

    const lower = stage.toLowerCase();

    if (lower === 'completed' || lower === 'complete') {
        return {
            status: recordId ? 'completed' : 'processing',
            recordId,
            retryCount,
            nextRetryAt,
            lastFailureReason,
            fileName
        };
    }

    if (lower === 'failed' || lower === 'error') {
        return {
            status: 'failed',
            error: message || lastFailureReason || 'Unknown error',
            retryCount,
            nextRetryAt,
            lastFailureReason,
            fileName
        };
    }

    if (lower === 'queued') {
        return {
            status: 'queued',
            retryCount,
            nextRetryAt,
            lastFailureReason,
            fileName
        };
    }

    return {
        status: lower || 'processing',
        retryCount,
        nextRetryAt,
        lastFailureReason,
        fileName
    };
}

function buildJobStatus(jobId, jobDoc, progressEvent) {
    const base = { jobId, status: 'queued' };

    if (jobDoc && typeof jobDoc === 'object') {
        const status = typeof jobDoc.status === 'string' ? jobDoc.status : undefined;

        return {
            ...base,
            status: status || base.status,
            recordId: typeof jobDoc.recordId === 'string' ? jobDoc.recordId : undefined,
            retryCount: typeof jobDoc.retryCount === 'number' ? jobDoc.retryCount : undefined,
            nextRetryAt: typeof jobDoc.nextRetryAt === 'string' ? jobDoc.nextRetryAt : undefined,
            lastFailureReason: typeof jobDoc.lastFailureReason === 'string' ? jobDoc.lastFailureReason : undefined,
            fileName: typeof jobDoc.fileName === 'string' ? jobDoc.fileName : undefined,
            error: typeof jobDoc.error === 'string' ? jobDoc.error : undefined
        };
    }

    const derived = deriveStatusFromProgressEvent(progressEvent);
    return {
        ...base,
        ...derived
    };
}

exports.handler = async (event, context) => {
    const corsHeaders = getCorsHeaders(event);
    const headers = {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('get-job-status', event, context);
    log.entry(createStandardEntryMeta(event));
    logDebugRequestSummary(log, event, { label: 'Get job status request', includeBody: true, bodyMaxStringLength: 20000 });
    const timer = createTimer(log, 'get-job-status');

    try {
        if (!process.env.MONGODB_URI) {
            timer.end({ outcome: 'configuration_error' });
            log.exit(500, { outcome: 'configuration_error' });
            return errorResponse(500, 'server_error', 'Server configuration error', undefined, headers);
        }

        if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
            timer.end({ outcome: 'method_not_allowed' });
            log.exit(405, { outcome: 'method_not_allowed' });
            return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
        }

        let jobIds = [];

        if (event.httpMethod === 'GET') {
            jobIds = extractJobIdsFromQuery(event);
        } else {
            const bodyResult = extractJobIdsFromBody(event);
            if (!bodyResult.ok) {
                timer.end({ outcome: 'bad_request' });
                log.exit(400, { outcome: 'bad_request' });
                return errorResponse(400, 'bad_request', bodyResult.error || 'Invalid request', undefined, headers);
            }
            jobIds = bodyResult.jobIds;
        }

        if (!jobIds || jobIds.length === 0) {
            timer.end({ outcome: 'missing_jobIds' });
            log.exit(400, { outcome: 'missing_jobIds' });
            return errorResponse(400, 'bad_request', 'jobIds is required', undefined, headers);
        }

        const uniqueJobIds = Array.from(new Set(jobIds)).slice(0, MAX_JOB_IDS);

        const [jobsCol, progressCol] = await Promise.all([
            getCollection(COLLECTIONS.PENDING_JOBS),
            getCollection(COLLECTIONS.PROGRESS_EVENTS)
        ]);

        const [jobDocs, progressGroups] = await Promise.all([
            jobsCol.find({ id: { $in: uniqueJobIds } }).toArray(),
            progressCol
                .aggregate([
                    { $match: { jobId: { $in: uniqueJobIds } } },
                    { $sort: { timestamp: -1 } },
                    { $group: { _id: '$jobId', doc: { $first: '$$ROOT' } } }
                ])
                .toArray()
        ]);

        const jobDocById = new Map(jobDocs.map((doc) => [doc.id, doc]));
        const progressById = new Map(progressGroups.map((group) => [group._id, group.doc]));

        const statuses = uniqueJobIds.map((jobId) => buildJobStatus(jobId, jobDocById.get(jobId), progressById.get(jobId)));

        timer.end({ outcome: 'success', count: statuses.length });
        log.exit(200, { count: statuses.length });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ statuses })
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;

        timer.end({ outcome: 'error' });
        log.error('Get job status failed', { error: message, stack });
        log.exit(500);

        return errorResponse(500, 'internal_error', 'Failed to get job status', { message }, headers);
    }
};
// Trigger redeploy Sat Jan 10 22:27:04 HST 2026
