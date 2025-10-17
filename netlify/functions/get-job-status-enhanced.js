const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");

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
    
    log('info', 'Get job status function invoked.', { ...logContext, queryStringParameters, path: event.path });

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
        log('debug', `Parsed job IDs from query string.`, { ...logContext, originalIds: ids, parsedCount: jobIds.length });
        if (jobIds.length === 0) {
            log('warn', "Query parameter 'ids' was empty after parsing.", { ...logContext, originalIds: ids });
            return respond(200, []);
        }

        const requestLogContext = { ...logContext, requestedJobIds: jobIds, count: jobIds.length };
        log('info', `Fetching status for jobs.`, requestLogContext);
        
        const jobsCollection = await getCollection("jobs");
        
        // Add timeout protection for database query
        const dbTimeout = setTimeout(() => {
            log('warn', 'Database query timeout exceeded', requestLogContext);
        }, 10000); // 10 second warning
        
        const jobs = await jobsCollection.find({ id: { $in: jobIds } }).toArray();
        clearTimeout(dbTimeout);
        
        const resultsMap = new Map(jobs.map(job => [job.id, job]));
        
        const results = jobIds.map(id => {
            const job = resultsMap.get(id);
            if (job) {
                // To save bandwidth, don't return the large image blob in the status
                const { image, images, _id, ...jobStatus } = job;
                log('debug', 'Found job and extracted status.', { jobId: id, status: jobStatus.status });
                return jobStatus;
            }
            log('warn', 'Job not found in collection.', { jobId: id });
            return { id, status: 'not_found', error: 'Job not found in store.' };
        });
        
        log('info', 'Successfully fetched all job statuses.', { ...requestLogContext, results: results.map(r => ({ jobId: r.id, status: r.status })) });
        return respond(200, results);

    } catch (error) {
        log('error', 'Critical error in get-job-status handler.', { ...logContext, errorMessage: error.message, stack: error.stack });
        // Return a more informative error response
        return respond(500, { 
            error: "An internal server error occurred.",
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
};