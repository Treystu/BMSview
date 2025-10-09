const { getConfiguredStore } = require("./utils/blobs.js");

const JOBS_STORE_NAME = "bms-jobs";

const createLogger = (context) => (level, message, extra = {}) => {
    try {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            functionName: context?.functionName || 'jobs-cleanup',
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        }));
    } catch (e) {
        console.log(JSON.stringify({
            level: 'ERROR',
            functionName: context?.functionName || 'jobs-cleanup',
            awsRequestId: context?.awsRequestId,
            message: 'Failed to serialize log message.',
            originalMessage: message,
            serializationError: e.message,
        }));
    }
};

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
    const log = createLogger(context);

    if (event.httpMethod !== 'POST') {
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        const { cursor: startCursor } = JSON.parse(event.body || '{}');
        log('info', `Starting cleanup batch.`, { startCursor: startCursor || 'start' });

        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
        
        let cleanedCount = 0;
        const { blobs, cursor: nextCursor } = await withRetry(() => jobsStore.list({ cursor: startCursor, limit: 200 }), log);
        log('info', `Processing page with ${blobs.length} blobs.`);

        if (blobs && blobs.length > 0) {
            for (const blob of blobs) {
                try {
                    const job = await withRetry(() => jobsStore.get(blob.key, { type: "json" }), log);
                    
                    if (job && (job.status === 'completed' || job.status === 'failed') && (job.image || job.images)) {
                        log('info', 'Cleaning job data.', { key: blob.key });
                        const { image, images, ...jobWithoutImages } = job;
                        await withRetry(() => jobsStore.setJSON(blob.key, jobWithoutImages), log);
                        cleanedCount++;
                    }
                } catch (e) {
                    log('warn', `Failed to process job blob during cleanup; it will be skipped.`, { key: blob.key, error: e.message, stack: e.stack });
                }
            }
        }
    
        log('info', 'Finished cleanup batch.', { cleanedCount, hasNextPage: !!nextCursor });
        return respond(200, { success: true, cleanedCount, nextCursor: nextCursor || null });

    } catch (error) {
        log('error', 'Error during job cleanup batch.', { errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred." });
    }
};