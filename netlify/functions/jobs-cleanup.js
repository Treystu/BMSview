const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");

const BATCH_SIZE = 200;

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
    log('debug', 'Function invoked.', { ...logContext, headers: event.headers });

    if (httpMethod !== 'POST') {
        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        log('info', `Starting jobs cleanup task.`, logContext);

        const jobsCollection = await getCollection("jobs");
        
        const result = await jobsCollection.updateMany(
            {
                status: { $in: ['completed', 'failed'] },
                $or: [
                    { image: { $exists: true, $ne: null } },
                    { images: { $exists: true, $ne: null } },
                ]
            },
            {
                $unset: { image: "", images: "" }
            }
        );
        
        const cleanedCount = result.modifiedCount;
    
        log('info', 'Finished jobs cleanup task.', { ...logContext, cleanedCount });
        return respond(200, { success: true, cleanedCount, nextCursor: null }); // nextCursor is kept for API compatibility but is no longer needed.

    } catch (error) {
        log('error', 'Critical error during job cleanup.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred." });
    }
};