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
    
    if (event.httpMethod !== 'GET') {
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        const { ids } = event.queryStringParameters;
        if (!ids) {
            return respond(400, { error: "Query parameter 'ids' is required." });
        }
        
        const jobIds = ids.split(',');
        log('info', `Fetching status for ${jobIds.length} jobs.`, { jobIds });
        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);

        const jobPromises = jobIds.map(jobId => 
            withRetry(() => jobsStore.get(jobId, { type: "json" }), log)
            .then(job => {
                // To save bandwidth, don't return the large image blob in the status
                if (job) {
                    const { image, images, ...jobStatus } = job;
                    return jobStatus;
                }
                return { jobId, status: 'not_found', error: 'Job not found in store.' };
            })
            .catch(error => {
                log('error', `Failed to fetch job status for ID: ${jobId}`, { errorMessage: error.message });
                return { jobId, status: 'failed', error: 'Failed to retrieve job status.' };
            })
        );
        
        const results = await Promise.all(jobPromises);
        log('info', 'Successfully fetched job statuses.', { results: results.map(r => ({ jobId: r.jobId, status: r.status })) });
        return respond(200, results);

    } catch (error) {
        log('error', 'Error fetching job statuses.', { errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred." });
    }
};