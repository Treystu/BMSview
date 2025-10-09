const { getConfiguredStore } = require("./utils/blobs.js");

const createLogger = (context) => (level, message, extra = {}) => {
    try {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            functionName: context?.functionName || 'data',
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        }));
    } catch (e) {
        console.log(JSON.stringify({
            level: 'ERROR',
            functionName: context?.functionName || 'data',
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

const clearStore = async (store, log) => {
    log('info', `Starting to clear store: ${store.name}`);
    let deletedCount = 0;
    let cursor = undefined;
    do {
        const { blobs, cursor: nextCursor } = await withRetry(() => store.list({ cursor, limit: 1000 }), log);
        if (blobs && blobs.length > 0) {
            for (const blob of blobs) {
                await withRetry(() => store.delete(blob.key), log);
            }
            deletedCount += blobs.length;
        }
        cursor = nextCursor;
    } while (cursor);
    log('info', `Finished clearing store.`, { store: store.name, totalDeleted: deletedCount });
    return deletedCount;
};

exports.handler = async function(event, context) {
    const log = createLogger(context);
    
    if (event.httpMethod !== 'DELETE') {
        return respond(405, { error: 'Method Not Allowed' });
    }
    
    try {
        const { store: storeToClearName } = event.queryStringParameters || {};
        const allStores = [
            "bms-systems", "bms-history", "bms-jobs", 
            "rate-limiting", "verified-ips", "bms-blocked-ips"
        ];

        if (storeToClearName) {
            if (allStores.includes(storeToClearName)) {
                log('warn', `Clearing single store: ${storeToClearName}.`);
                const store = getConfiguredStore(storeToClearName, log);
                const deletedCount = await clearStore(store, log);
                return respond(200, {
                    message: `Store '${storeToClearName}' cleared successfully.`,
                    details: { [storeToClearName]: deletedCount },
                });
            } else {
                return respond(400, { error: `Invalid store name provided: ${storeToClearName}` });
            }
        }

        log('warn', 'Clearing all application data from all stores.');
        const deletionResults = {};
        for (const storeName of allStores) {
            log('info', `Now clearing store: ${storeName}`);
            const store = getConfiguredStore(storeName, log);
            deletionResults[storeName] = await clearStore(store, log);
            log('info', `Finished clearing store: ${storeName}`);
        }

        log('info', `Successfully cleared all data.`, { results: deletionResults });
        return respond(200, { message: "All data cleared successfully.", details: deletionResults });

    } catch (error) {
        log('error', 'Error clearing data.', { errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred while clearing data." });
    }
};
