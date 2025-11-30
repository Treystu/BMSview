
const { getCollection } = require("./utils/mongodb.cjs");
const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

const respond = (statusCode, body, headers = {}) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
});

const clearCollection = async (collectionName, log) => {
    log.warn('Starting to clear collection', { collectionName });
    try {
        const collection = await getCollection(collectionName);
        const { deletedCount } = await collection.deleteMany({});
        log.warn('Finished clearing collection', { collectionName, deletedCount });
        return deletedCount;
    } catch (error) {
        log.error('Failed to clear collection', { collectionName, error: error.message });
        return 0;
    }
};

exports.handler = async function(event, context) {
    const headers = getCorsHeaders(event);
    
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }
    
    const log = createLoggerFromEvent('data-management', event, context);
    log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });
    const timer = createTimer(log, 'data-management');
    
    if (!validateEnvironment(log)) {
        log.exit(500);
        return respond(500, { error: 'Server configuration error' }, headers);
    }

    if (event.httpMethod !== 'DELETE') {
        log.warn('Method not allowed', { method: event.httpMethod });
        log.exit(405);
        return respond(405, { error: 'Method Not Allowed' }, headers);
    }
    
    try {
        const { store: collectionToClearName } = event.queryStringParameters || {};
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
                log.warn('Clearing single collection', { collectionToClear: mongoCollection });
                const deletedCount = await clearCollection(mongoCollection, log);
                timer.end({ collectionsCleared: 1 });
                log.exit(200);
                return respond(200, {
                    message: `Collection '${mongoCollection}' cleared successfully.`,
                    details: { [mongoCollection]: deletedCount },
                }, headers);
            } else {
                log.warn('Invalid store name provided', { collectionToClearName });
                log.exit(400);
                return respond(400, { error: `Invalid store name provided: ${collectionToClearName}` }, headers);
            }
        }

        log.warn('Clearing ALL application data from all collections');
        const deletionResults = {};
        for (const collectionName of allCollections) {
            deletionResults[collectionName] = await clearCollection(collectionName, log);
        }

        timer.end({ collectionsCleared: allCollections.length });
        log.warn('Successfully cleared all data across all collections', { results: deletionResults });
        log.exit(200);
        return respond(200, { message: "All data cleared successfully.", details: deletionResults }, headers);

    } catch (error) {
        timer.end({ error: true });
        log.error('Critical error during data clearing operation', { error: error.message, stack: error.stack });
        log.exit(500);
        return respond(500, { error: "An internal server error occurred while clearing data." }, headers);
    }
};
