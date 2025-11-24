
const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

const clearCollection = async (collectionName, log) => {
    const logContext = { collectionName };
    log('warn', `Starting to clear collection.`, logContext);
    try {
        const collection = await getCollection(collectionName);
        const { deletedCount } = await collection.deleteMany({});
        log('warn', `Finished clearing collection.`, { ...logContext, deletedCount });
        return deletedCount;
    } catch (error) {
        log('error', `Failed to clear collection ${collectionName}`, { ...logContext, errorMessage: error.message });
        return 0;
    }
};

exports.handler = async function(event, context) {
    const log = createLogger('data-management', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, queryStringParameters } = event;
    const logContext = { clientIp, httpMethod };

    log('debug', 'Function invoked.', { ...logContext, queryStringParameters, headers: event.headers });
    
    if (httpMethod !== 'DELETE') {
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        const { store: collectionToClearName } = queryStringParameters || {};
        // Map old blob store names to new MongoDB collection names
        const collectionMap = {
            "bms-systems": "systems",
            "bms-history": "history",
            "bms-jobs": "jobs",
            "rate-limiting": "rate_limits",
            "verified-ips": "security", // Both verified and blocked are in 'security'
            "bms-blocked-ips": "security",
        };
        const allCollections = [...new Set(Object.values(collectionMap))];

        if (collectionToClearName) {
            const mongoCollection = collectionMap[collectionToClearName];
            if (mongoCollection) {
                log('warn', `Received request to clear single collection.`, { ...logContext, collectionToClear: mongoCollection });
                const deletedCount = await clearCollection(mongoCollection, log);
                return respond(200, {
                    message: `Collection '${mongoCollection}' cleared successfully.`,
                    details: { [mongoCollection]: deletedCount },
                });
            } else {
                return respond(400, { error: `Invalid store name provided: ${collectionToClearName}` });
            }
        }

        log('warn', 'Received request to clear ALL application data from all collections.', logContext);
        const deletionResults = {};
        for (const collectionName of allCollections) {
            deletionResults[collectionName] = await clearCollection(collectionName, log);
        }

        log('warn', `Successfully cleared all data across all collections.`, { ...logContext, results: deletionResults });
        return respond(200, { message: "All data cleared successfully.", details: deletionResults });

    } catch (error) {
        log('error', 'Critical error during data clearing operation.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred while clearing data." });
    }
};
