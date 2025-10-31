const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.js');

const MAX_RETRY_COUNT = 5;

const findJob = async (jobId, collection, log) => {
    log('debug', 'Attempting to find job by ID in MongoDB.', { jobId });
    const job = await collection.findOne({ id: jobId });
    log('debug', job ? 'Found job.' : 'Job not found.', { jobId });
    return job;
};

const updateJobStatus = async (jobId, status, log, jobsCollection, extra = {}) => {
    const logContext = { jobId, newStatus: status, ...extra };
    try {
        log('debug', 'Attempting to update job status in MongoDB.', logContext);
        const isTerminal = status === 'completed' || status.startsWith('failed');
        const updatePayload = {
            $set: { ...extra, status, lastHeartbeat: new Date() }
        };
        if (isTerminal) {
            updatePayload.$unset = { image: "" };
        }
        const result = await jobsCollection.updateOne({ id: jobId }, updatePayload);
        if (result.matchedCount > 0) {
             log('info', 'Job status updated successfully.', logContext);
        } else {
             log('warn', 'Job not found for status update.', logContext);
        }
    } catch (e) {
        log('error', 'Failed to update job status in MongoDB.', { ...logContext, error: e.message });
    }
};

const requeueJob = async (jobId, reason, log, jobsCollection, retryCount = 0) => {
    const logContext = { jobId, reason, retryCount };
    if (retryCount >= MAX_RETRY_COUNT) {
        log('error', 'Job exceeded max retries, failing permanently.', logContext);
        await updateJobStatus(jobId, 'failed', log, jobsCollection, { 
            error: `failed_Max retries exceeded. Last reason: ${reason}`
        });
        return;
    }
    log('info', 'Requeuing job for later processing.', logContext);
    const backoffDelay = 60000 * Math.pow(2, retryCount);
    const nextRetryAt = new Date(Date.now() + backoffDelay);
    await updateJobStatus(jobId, 'Queued', log, jobsCollection, { 
        retryCount: retryCount + 1,
        lastFailureReason: reason,
        nextRetryAt: nextRetryAt.toISOString(),
    });
};

exports.handler = async function(event, context) {
    const log = createLogger('process-analysis', context);
    let jobId;

    try {
        const body = JSON.parse(event.body);
        jobId = body.jobId;

        if (!jobId) {
            log('error', 'Job ID is missing from invocation payload.', { body });
            return { statusCode: 400, body: 'Job ID is required.', headers: { 'Content-Type': 'text/plain' } };
        }

        const logContext = { jobId };
        log('info', 'Background analysis job started.', logContext);
        
        const jobsCollection = await getCollection("jobs");
        const job = await findJob(jobId, jobsCollection, log);

        if (!job) throw new Error(`Job with ID ${jobId} not found.`);
        
        await updateJobStatus(jobId, 'Processing', log, jobsCollection);

        const analysisRecord = await performAnalysisPipeline(job, job.systems, log, context);

        await updateJobStatus(jobId, 'completed', log, jobsCollection, { recordId: analysisRecord.id });
        log('info', 'Job completed successfully.', { ...logContext, recordId: analysisRecord.id });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Successfully processed job ${jobId}`, recordId: analysisRecord.id }),
        };

    } catch (error) {
        const logContext = { jobId };
        log('error', 'Background analysis job failed.', { ...logContext, errorMessage: error.message, stack: error.stack });
        
        if (jobId) {
            const jobsCollection = await getCollection("jobs");
            if (error.message.includes('TRANSIENT_ERROR')) {
                const reason = error.message.replace('TRANSIENT_ERROR: ', '');
                const job = await findJob(jobId, jobsCollection, log);
                await requeueJob(jobId, reason, log, jobsCollection, job?.retryCount || 0);
            } else {
                await updateJobStatus(jobId, 'failed', log, jobsCollection, { error: `failed_${error.message}` });
            }
        }
        
        return {
            statusCode: 200, // Return 200 to prevent Netlify from retrying a failed function
            body: JSON.stringify({ error: `Job ${jobId} failed: ${error.message}` }),
        };
    }
};
