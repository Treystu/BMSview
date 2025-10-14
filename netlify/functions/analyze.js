const { getConfiguredStore } = require('./utils/blobs');
const { createLogger } = require("./utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require('./security.js');
const { createRetryWrapper } = require("./utils/retry.js");

const JOBS_STORE_NAME = "bms-jobs";
const HISTORY_STORE_NAME = "bms-history";
const HISTORY_CACHE_KEY = "_all_history_cache";

// Helper to get the base name of a file path
const getBasename = (path) => {
  if (!path) return '';
  return path.split(/[/\\]/).pop() || '';
};

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async (event, context) => {
    const log = createLogger('analyze', context);
    const withRetry = createRetryWrapper(log);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };

    log('debug', 'Function invoked.', { ...logContext, headers: event.headers });
    
    try {
        if (httpMethod !== 'POST') {
            log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
            return respond(405, { error: 'Method Not Allowed' });
        }

        log('debug', 'Starting security check.', logContext);
        await checkSecurity(event, log);
        log('debug', 'Security check passed.', logContext);
        
        let body;
        try {
            body = JSON.parse(event.body);
            log('debug', 'Request body parsed successfully.', { ...logContext, imageCount: body?.images?.length, hasSystems: !!body?.systems });
        } catch (e) {
            log('error', 'Failed to parse request body as JSON.', { ...logContext, body: event.body, error: e.message });
            throw new HttpError(400, "Invalid JSON in request body.");
        }

        const { images, systems } = body;

        if (!Array.isArray(images) || images.length === 0) {
            log('warn', 'Validation failed: No images provided for analysis.', logContext);
            return respond(400, { error: "No images provided for analysis." });
        }
        log('debug', `Processing ${images.length} images. Starting duplicate check.`, logContext);
        
        // --- Authoritative Duplicate Check ---
        const historyStore = getConfiguredStore(HISTORY_STORE_NAME, log);
        const allHistory = await withRetry(() => historyStore.get(HISTORY_CACHE_KEY, { type: 'json' })).catch(() => []);
        const existingRecordMap = new Map();
        if (Array.isArray(allHistory)) {
            for (const record of allHistory) {
                if (record.fileName) {
                    existingRecordMap.set(getBasename(record.fileName), record);
                }
            }
        }
        log('debug', `History cache loaded for duplicate check. Found ${existingRecordMap.size} unique filenames.`, logContext);

        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
        const jobCreationResponses = [];
        const batchBasenames = new Set();

        for (const [index, image] of images.entries()) {
            const basename = getBasename(image.fileName);
            const imageLogContext = { ...logContext, fileName: image.fileName, basename, imageIndex: index };

            if (batchBasenames.has(basename)) {
                 log('info', 'Found duplicate within this batch, skipping job creation.', imageLogContext);
                 jobCreationResponses.push({
                    fileName: image.fileName,
                    status: 'duplicate_batch',
                 });
                 continue;
            }
            batchBasenames.add(basename);

            const existingRecord = existingRecordMap.get(basename);
            if (existingRecord) {
                log('info', 'Found duplicate in history, skipping job creation.', { ...imageLogContext, existingRecordId: existingRecord.id });
                jobCreationResponses.push({
                    fileName: image.fileName,
                    status: 'duplicate_history',
                    duplicateRecordId: existingRecord.id,
                });
                continue;
            }

            const newJobId = uuidv4();
            const jobLogContext = { ...imageLogContext, jobId: newJobId };
            log('debug', 'Creating job for new image.', jobLogContext);
            
            const jobData = {
                id: newJobId,
                fileName: image.fileName,
                status: "Queued",
                image: image.image, // base64 string
                mimeType: image.mimeType,
                systems, // All systems info
                createdAt: new Date().toISOString(),
                retryCount: 0,
            };
            
            try {
                log('debug', 'Storing job data in blob store.', jobLogContext);
                // Store under a "Queued/" prefix for efficient querying by the shepherd
                await jobsStore.setJSON(`Queued/${newJobId}`, jobData);
                log('debug', 'Job data stored successfully.', jobLogContext);

                jobCreationResponses.push({
                    fileName: image.fileName,
                    jobId: newJobId,
                    status: 'Queued',
                });
            } catch (storeError) {
                 log('error', 'Failed to create and store job, it will not be processed.', { ...jobLogContext, error: storeError.message });
                 jobCreationResponses.push({
                    fileName: image.fileName,
                    jobId: null,
                    status: 'failed',
                    error: 'Failed to create job in store.'
                 });
            }
        }
        
        const responseCounts = jobCreationResponses.reduce((acc, j) => {
            if (j.status === 'Queued') acc.queued++;
            else if (j.status.startsWith('duplicate')) acc.duplicates++;
            else if (j.status === 'failed') acc.failed++;
            return acc;
        }, { queued: 0, duplicates: 0, failed: 0 });
        
        log('info', `Analysis submission processing complete.`, { ...logContext, ...responseCounts, totalProcessed: images.length });
        return respond(200, jobCreationResponses);

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { ...logContext, errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        return respond(500, { error: "An internal server error occurred." });
    }
};