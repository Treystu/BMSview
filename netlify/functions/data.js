const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");

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

const clearStore = async (store, log) => {
    const storeName = store.name;
    const logContext = { storeName };
    log('warn', `Starting to clear store.`, logContext);
    let deletedCount = 0;
    let pageCount = 0;
    let cursor = undefined;
    do {
        pageCount++;
        log('debug', `Fetching page ${pageCount} of blobs to delete.`, { ...logContext, cursor: cursor || 'start' });
        const { blobs, cursor: nextCursor } = await withRetry(() => store.list({ cursor, limit: 1000 }), log);
        if (blobs && blobs.length > 0) {
            log('debug', `Found ${blobs.length} blobs on page ${pageCount}. Deleting them now.`, logContext);
            for (const blob of blobs) {
                await withRetry(() => store.delete(blob.key), log);
            }
            deletedCount += blobs.length;
            log('debug', `Deleted page ${pageCount}. Total deleted so far: ${deletedCount}.`, logContext);
        } else {
            log('debug', `No blobs found on page ${pageCount}.`, logContext);
        }
        cursor = nextCursor;
    } while (cursor);
    log('warn', `Finished clearing store.`, { ...logContext, totalDeleted: deletedCount, totalPages: pageCount });
    return deletedCount;
};

exports.handler = async function(event, context) {
    const log = createLogger('data-management', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, queryStringParameters } = event;
    const logContext = { clientIp, httpMethod };

    log('debug', 'Function invoked.', { ...logContext, queryStringParameters });
    
    if (httpMethod !== 'DELETE') {
        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        const { store: storeToClearName } = queryStringParameters || {};
        const allStores = [
            "bms-systems", "bms-history", "bms-jobs", 
            "rate-limiting", "verified-ips", "bms-blocked-ips"
        ];

        if (storeToClearName) {
            if (allStores.includes(storeToClearName)) {
                log('warn', `Received request to clear single store.`, { ...logContext, storeToClear: storeToClearName });
                const store = getConfiguredStore(storeToClearName, log);
                const deletedCount = await clearStore(store, log);
                return respond(200, {
                    message: `Store '${storeToClearName}' cleared successfully.`,
                    details: { [storeToClearName]: deletedCount },
                });
            } else {
                log('error', `Invalid store name provided for deletion.`, { ...logContext, invalidStoreName: storeToClearName });
                return respond(400, { error: `Invalid store name provided: ${storeToClearName}` });
            }
        }

        log('warn', 'Received request to clear ALL application data from all stores. This is a destructive operation.', logContext);
        const deletionResults = {};
        for (const storeName of allStores) {
            const store = getConfiguredStore(storeName, log);
            deletionResults[storeName] = await clearStore(store, log);
        }

        log('warn', `Successfully cleared all data across all stores.`, { ...logContext, results: deletionResults });
        return respond(200, { message: "All data cleared successfully.", details: deletionResults });

    } catch (error) {
        log('error', 'Critical error during data clearing operation.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred while clearing data." });
    }
};
