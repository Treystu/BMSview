const { v4: uuidv4 } = require("uuid");
const { getConfiguredStore } = require("./utils/blobs.js");

const STORE_NAME = "bms-systems";
const HISTORY_STORE_NAME = "bms-history";
const CACHE_KEY = "_all_systems_cache";

const createLogger = (context) => (level, message, extra = {}) => {
    try {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            functionName: context?.functionName || 'systems',
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        }));
    } catch (e) {
        console.log(JSON.stringify({
            level: 'ERROR',
            functionName: context?.functionName || 'systems',
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

const updateCache = async (store, log, updateFn) => {
    for (let i = 0; i < 5; i++) { // retry loop for contention
        let cache, metadata;
        try {
            const result = await withRetry(() => store.getWithMetadata(CACHE_KEY, { type: 'json' }), log);
            cache = result.data || [];
            metadata = result.metadata;
        } catch (e) {
            if (e.status === 404) {
                log('info', 'Systems cache not found, will create a new one.');
                cache = [];
                metadata = null;
            } else { throw e; }
        }

        if (!Array.isArray(cache)) cache = [];

        const updatedCache = updateFn(cache);

        try {
            await withRetry(() => store.setJSON(CACHE_KEY, updatedCache, { etag: metadata?.etag }), log);
            log('info', 'Systems cache updated successfully.', { etag: metadata?.etag, updatedSize: updatedCache.length });
            return;
        } catch (e) {
            if (e.status === 412) {
                const delay = 50 * Math.pow(2, i);
                log('warn', `Systems cache update conflict, retrying in ${delay}ms...`, { attempt: i + 1 });
                await new Promise(res => setTimeout(res, delay));
            } else { throw e; }
        }
    }
    log('error', 'Failed to update systems cache after multiple retries.');
};

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

const rebuildSystemsCache = async (store, log) => {
    log('info', 'Rebuilding systems cache.', { cacheKey: CACHE_KEY });
    let allSystems = [];
    let cursor = undefined;
    do {
        const { blobs, cursor: nextCursor } = await store.list({ cursor, limit: 1000 });
        const blobsToFetch = blobs.filter(blob => blob.key !== CACHE_KEY);
        for (const blob of blobsToFetch) {
            try {
                const system = await withRetry(() => store.get(blob.key, { type: "json" }), log);
                if (system) allSystems.push(system);
            } catch (error) {
                log('error', `Failed to get/parse system blob during cache rebuild.`, { key: blob.key, errorMessage: error.message });
            }
        }
        cursor = nextCursor;
    } while (cursor);
    await withRetry(() => store.setJSON(CACHE_KEY, allSystems), log);
    return allSystems;
};

exports.handler = async function(event, context) {
    const log = createLogger(context);
    const store = getConfiguredStore(STORE_NAME, log);

    try {
        if (event.httpMethod === 'GET') {
            const { systemId } = event.queryStringParameters || {};
            if (systemId) {
                const system = await withRetry(() => store.get(systemId, { type: "json" }), log);
                return system ? respond(200, system) : respond(404, { error: "System not found." });
            }
            try {
                const cachedSystems = await withRetry(() => store.get(CACHE_KEY, { type: 'json' }), log);
                if (cachedSystems && cachedSystems.length > 0) {
                    log('info', 'Systems cache hit.');
                    return respond(200, cachedSystems);
                }
            } catch (error) {
                if (error.status !== 404) log('warn', 'Error reading cache, will rebuild.', { error: error.message });
            }
            const systems = await rebuildSystemsCache(store, log);
            return respond(200, systems);
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body);
            const { action } = body;

            if (action === 'merge') {
                const { primarySystemId, idsToMerge } = body;
                log('info', 'Starting merge operation.', { primarySystemId, idsToMerge });
                
                const systemsToFetch = [...new Set(idsToMerge)];
                const fetchedSystems = [];
                for (const id of systemsToFetch) {
                    fetchedSystems.push(await withRetry(() => store.get(id, { type: "json" }), log).catch(() => null));
                }

                const systemsMap = new Map(fetchedSystems.filter(Boolean).map(s => [s.id, s]));
                const primarySystem = systemsMap.get(primarySystemId);
                if (!primarySystem) return respond(404, { error: "Primary system not found." });

                const idsToDelete = idsToMerge.filter(id => id !== primarySystemId);
                const allDlsToMerge = idsToMerge.map(id => systemsMap.get(id)).filter(Boolean).flatMap(s => s.associatedDLs || []);
                primarySystem.associatedDLs = [...new Set([...(primarySystem.associatedDLs || []), ...allDlsToMerge])];

                const historyStore = getConfiguredStore(HISTORY_STORE_NAME, log);
                let historyUpdateCount = 0; let cursor = undefined;
                do {
                    const { blobs, cursor: nextCursor } = await historyStore.list({ cursor, limit: 1000 });
                    for (const blob of blobs) {
                        try {
                            const record = await withRetry(() => historyStore.get(blob.key, { type: 'json' }), log);
                            if (record && idsToDelete.includes(record.systemId || '')) {
                                await withRetry(() => historyStore.setJSON(record.id, { ...record, systemId: primarySystem.id, systemName: primarySystem.name }), log);
                                historyUpdateCount++;
                            }
                        } catch (e) { log('warn', `Failed to process record during merge.`, { key: blob.key, error: e.message }); }
                    }
                    cursor = nextCursor;
                } while (cursor);
                log('info', `Updated ${historyUpdateCount} history records during merge.`);

                await withRetry(() => store.setJSON(primarySystem.id, primarySystem), log);
                log('info', 'Updated primary system.', { systemId: primarySystem.id });

                for (const id of idsToDelete) {
                    await withRetry(() => store.delete(id), log);
                    log('info', 'Deleted merged system.', { systemId: id });
                }
                
                await updateCache(store, log, cache => {
                    const cacheAfterDeletes = cache.filter(s => !idsToDelete.includes(s.id));
                    const index = cacheAfterDeletes.findIndex(s => s.id === primarySystem.id);
                    if (index > -1) {
                        cacheAfterDeletes[index] = primarySystem;
                    } else {
                        cacheAfterDeletes.push(primarySystem);
                    }
                    return cacheAfterDeletes;
                });
                
                await withRetry(() => historyStore.delete("_all_history_cache"), log).catch(err => log('warn', 'Failed to invalidate history cache on merge.', { error: err.message }));

                return respond(200, { success: true });
            }

            const newSystem = { ...body, id: uuidv4(), associatedDLs: body.associatedDLs || [] };
            log('info', 'Creating new system.', { systemId: newSystem.id, systemName: newSystem.name });
            await withRetry(() => store.setJSON(newSystem.id, newSystem), log);
            await updateCache(store, log, cache => [...cache, newSystem]);
            return respond(201, newSystem);
        }

        if (event.httpMethod === 'PUT') {
            const { systemId } = event.queryStringParameters;
            if (!systemId) return respond(400, { error: 'System ID is required for update.' });
            log('info', 'Updating system.', { systemId });
            
            const originalSystem = await withRetry(() => store.get(systemId, { type: "json" }), log);
            if (!originalSystem) return respond(404, { error: "System not found." });

            const updatedSystem = { ...originalSystem, ...JSON.parse(event.body), id: systemId };
            await withRetry(() => store.setJSON(systemId, updatedSystem), log);
            
            await updateCache(store, log, cache => {
                const index = cache.findIndex(s => s.id === systemId);
                if (index > -1) cache[index] = updatedSystem;
                else cache.push(updatedSystem);
                return cache;
            });
            
            return respond(200, updatedSystem);
        }

        return respond(405, { error: 'Method Not Allowed' });
    } catch (error) {
        log('error', 'Critical error in systems function.', { errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};