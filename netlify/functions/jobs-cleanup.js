const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");

const JOBS_STORE_NAME = "bms-jobs";

const withRetry = async (fn, log, maxRetries = 3, initialDelay = 250) => {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            const isRetryable = (error instanceof TypeError) || (error.message && error.message.includes('401 status code'));
            if (isRetryable && i < maxRetries) {
                const delay = initialDelay * Math.pow(2, i) + Math.random() * initialDelay;
                log('warn', `A retryable blob store operation failed. Retrying...`, { attempt: i + 1, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('jobs-cleanup', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };
    log('debug', 'Function invoked.', logContext);

    if (httpMethod !== 'POST') {
        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        const { cursor: startCursor } = JSON.parse(event.body || '{}');
        const batchLogContext = { ...logContext, startCursor: startCursor || 'start' };
        log('info', `Starting cleanup batch.`, batchLogContext);

        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
        
        let cleanedCount = 0;
        const { blobs, cursor: nextCursor } = await withRetry(() => jobsStore.list({ cursor: startCursor, limit: 200 }), log);
        log('debug', `Processing page with ${blobs.length} blobs.`, { ...batchLogContext, nextCursor: nextCursor || 'end' });

        if (blobs && blobs.length > 0) {
            for (const blob of blobs) {
                const jobLogContext = { ...batchLogContext, key: blob.key };
                try {
                    const job = await withRetry(() => jobsStore.get(blob.key, { type: "json" }), log);
                    
                    if (job && (job.status === 'completed' || job.status === 'failed') && (job.image || job.images)) {
                        log('debug', 'Found completed/failed job with image data. Cleaning.', jobLogContext);
                        const { image, images, ...jobWithoutImages } = job;
                        await withRetry(() => jobsStore.setJSON(blob.key, jobWithoutImages), log);
                        cleanedCount++;
                        log('debug', 'Job data cleaned successfully.', jobLogContext);
                    } else {
                        log('debug', 'Skipping job: not cleanable or no image data found.', { ...jobLogContext, status: job?.status, hasImage: !!job?.image });
                    }
                } catch (e) {
                    log('warn', `Failed to process job blob during cleanup; it will be skipped.`, { ...jobLogContext, error: e.message, stack: e.stack });
                }
            }
        }
    
        log('info', 'Finished cleanup batch.', { ...batchLogContext, cleanedCount, hasNextPage: !!nextCursor });
        return respond(200, { success: true, cleanedCount, nextCursor: nextCursor || null });

    } catch (error) {
        log('error', 'Critical error during job cleanup batch.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred." });
    }
};
