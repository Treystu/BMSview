const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");
const { createRetryWrapper } = require("./utils/retry.js");

const JOBS_STORE_NAME = "bms-jobs";
const JOB_PREFIXES = ['Queued/', 'Processing/', 'failed_timeout/'];

const findJob = async (jobId, store, log, withRetry) => {
    // A job's key changes as it moves through states. To find a job by its static ID,
    // we must check under all possible prefixes it might have.
    for (const prefix of JOB_PREFIXES) {
        const key = `${prefix}${jobId}`;
        try {
            const job = await withRetry(() => store.get(key, { type: "json" }));
            if (job) {
                return job;
            }
        } catch (error) {
            if (error.status !== 404) {
                log('warn', `Error checking for job under prefix`, { jobId, prefix, error: error.message });
            }
        }
    }
    // A job might also exist without a prefix if it's in a state not managed by prefixes.
    // This provides backward compatibility and robustness.
    try {
        const job = await withRetry(() => store.get(jobId, { type: "json" }));
        if (job) {
             return job;
        }
    } catch(error) {
        if (error.status !== 404) {
            log('warn', `Error checking for job without prefix`, { jobId, error: error.message });
        }
    }
    
    return null;
};


const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('get-job-status', context);
    const withRetry = createRetryWrapper(log);
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
            findJob(jobId, jobsStore, log, withRetry)
            .then(job => {
                const jobLogContext = { ...logContext, jobId };
                if (job) {
                    // To save bandwidth, don't return the large image blob in the status
                    const { image, images, ...jobStatus } = job;
                    log('debug', 'Found job and extracted status.', { ...jobLogContext, status: jobStatus.status });
                    return jobStatus;
                }
                log('warn', 'Job not found in store under any prefix.', jobLogContext);
                return { id: jobId, status: 'not_found', error: 'Job not found in store.' };
            })
            .catch(error => {
                log('error', `Failed to fetch job status for ID: ${jobId}`, { ...logContext, jobId, errorMessage: error.message });
                return { id: jobId, status: 'failed', error: 'Failed to retrieve job status.' };
            })
        );
        
        const results = await Promise.all(jobPromises);
        log('info', 'Successfully fetched all job statuses.', { ...requestLogContext, results: results.map(r => ({ jobId: r.id, status: r.status })) });
        return respond(200, results);

    } catch (error) {
        log('error', 'Critical error in get-job-status handler.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred." });
    }
};