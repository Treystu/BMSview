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
    const log = createLogger('get-job-status', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, queryStringParameters } = event;
    const logContext = { clientIp, httpMethod };
    
    log('debug', 'Function invoked.', { ...logContext, queryStringParameters });

    if (httpMethod !== 'GET') {
        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        const { ids } = queryStringParameters;
        if (!ids) {
            log('warn', "Query parameter 'ids' is required.", logContext);
            return respond(400, { error: "Query parameter 'ids' is required." });
        }
        
        const jobIds = ids.split(',').filter(id => id.trim() !== '');
        if (jobIds.length === 0) {
            log('warn', "Query parameter 'ids' was empty after parsing.", { ...logContext, originalIds: ids });
            return respond(200, []);
        }

        const requestLogContext = { ...logContext, requestedJobIds: jobIds, count: jobIds.length };
        log('info', `Fetching status for jobs.`, requestLogContext);
        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);

        const jobPromises = jobIds.map(jobId => 
            withRetry(() => jobsStore.get(jobId, { type: "json" }), log)
            .then(job => {
                const jobLogContext = { ...logContext, jobId };
                if (job) {
                    // To save bandwidth, don't return the large image blob in the status
                    const { image, images, ...jobStatus } = job;
                    log('debug', 'Found job and extracted status.', { ...jobLogContext, status: jobStatus.status });
                    return jobStatus;
                }
                log('warn', 'Job not found in store.', jobLogContext);
                return { jobId, status: 'not_found', error: 'Job not found in store.' };
            })
            .catch(error => {
                log('error', `Failed to fetch job status for ID: ${jobId}`, { ...logContext, jobId, errorMessage: error.message });
                return { jobId, status: 'failed', error: 'Failed to retrieve job status.' };
            })
        );
        
        const results = await Promise.all(jobPromises);
        log('info', 'Successfully fetched all job statuses.', { ...requestLogContext, results: results.map(r => ({ jobId: r.jobId, status: r.status })) });
        return respond(200, results);

    } catch (error) {
        log('error', 'Critical error in get-job-status handler.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred." });
    }
};
