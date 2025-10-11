const { v4: uuidv4 } = require("uuid");
const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");

const STORE_NAME = "bms-history";
const SYSTEMS_STORE_NAME = "bms-systems";
const CACHE_KEY = "_all_history_cache";

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
                log('info', 'Cache not found, will create a new one.');
                cache = [];
                metadata = null;
            } else { throw e; }
        }

        if (!Array.isArray(cache)) cache = [];

        const updatedCache = updateFn(cache);
        updatedCache.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        try {
            await withRetry(() => store.setJSON(CACHE_KEY, updatedCache, { etag: metadata?.etag }), log);
            log('info', 'Cache updated successfully.', { etag: metadata?.etag, updatedSize: updatedCache.length });
            return; // Success
        } catch (e) {
            if (e.status === 412) { // Etag mismatch
                const delay = 50 * Math.pow(2, i);
                log('warn', `Cache update conflict, retrying in ${delay}ms...`, { attempt: i + 1 });
                await new Promise(res => setTimeout(res, delay));
            } else { throw e; }
        }
    }
    log('error', 'Failed to update cache after multiple retries.');
    // Don't throw here, as the primary operation succeeded. The cache will just be stale.
};

const rebuildHistoryCache = async (store, log) => {
    log('info', 'Rebuilding history cache.', { cacheKey: CACHE_KEY });
    let allHistory = [];
    let cursor = undefined;
    do {
        const { blobs, cursor: nextCursor } = await store.list({ cursor, limit: 1000 });
        const blobsToFetch = blobs.filter(blob => blob.key !== CACHE_KEY);
        for (const blob of blobsToFetch) {
            try {
                const record = await withRetry(() => store.get(blob.key, { type: "json" }), log);
                if (record) allHistory.push(record);
            } catch (error) {
                log('error', `Failed to get/parse blob during cache rebuild.`, { key: blob.key, errorMessage: error.message });
            }
        }
        cursor = nextCursor;
    } while (cursor);
    allHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    await withRetry(() => store.setJSON(CACHE_KEY, allHistory), log);
    return allHistory;
};

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

const fetchHistoricalWeather = async (lat, lon, timestamp, log) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
        log('warn', "Weather API key not configured.");
        return null;
    }
    try {
        log('info', 'Fetching weather data.', { lat, lon, timestamp });
        const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
        const [mainResponse, uviResponse] = await Promise.all([
            fetch(`https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`),
            fetch(`https://api.openweathermap.org/data/2.5/uvi/history?lat=${lat}&lon=${lon}&start=${unixTimestamp}&end=${unixTimestamp}&appid=${apiKey}`)
        ]);

        const mainData = await mainResponse.json();
        const uviData = await uviResponse.json();
        const current = mainData.data?.[0];

        if (mainResponse.ok && current) {
            const result = {
                temp: current.temp, clouds: current.clouds, uvi: null,
                weather_main: current.weather[0]?.main || 'Unknown', weather_icon: current.weather[0]?.icon || '',
            };
            if (uviResponse.ok && uviData && Array.isArray(uviData) && uviData.length > 0) {
                result.uvi = uviData[0].value;
            }
            log('info', 'Successfully fetched weather data.');
            return result;
        }
    } catch (e) {
        log('error', 'Error fetching weather.', { errorMessage: e.message });
    }
    return null;
};

exports.handler = async function(event, context) {
    const log = createLogger('history', context);
    const store = getConfiguredStore(STORE_NAME, log);

    try {
        if (event.httpMethod === 'GET') {
            const { id } = event.queryStringParameters || {};
            if (id) {
                const record = await withRetry(() => store.get(id, { type: "json" }), log);
                return record ? respond(200, record) : respond(404, { error: "Record not found." });
            }
            try {
                const cachedHistory = await withRetry(() => store.get(CACHE_KEY, { type: 'json' }), log);
                if (cachedHistory) {
                    log('info', 'History cache hit.');
                    return respond(200, cachedHistory);
                }
            } catch (error) {
                 if (error.status !== 404) log('warn', 'Error reading history cache.', { error: error.message });
            }
            const history = await rebuildHistoryCache(store, log);
            return respond(200, history);
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body);
            const { action } = body;

            if (action === 'deleteBatch') {
                const { recordIds } = body;
                log('info', 'Deleting batch of history records.', { count: recordIds.length, recordIds });
                const idsToDeleteSet = new Set(recordIds);
                for (const id of recordIds) await withRetry(() => store.delete(id), log);
                await updateCache(store, log, cache => cache.filter(r => !idsToDeleteSet.has(r.id)));
                return respond(200, { success: true, deletedCount: recordIds.length });
            }

            if (action === 'auto-associate') {
                log('info', 'Starting auto-association of unlinked records.');
                const systemsStore = getConfiguredStore(SYSTEMS_STORE_NAME, log);
                const systems = await withRetry(() => systemsStore.get("_all_systems_cache", { type: 'json' }), log).catch(() => []);
                const dlToSystemMap = new Map();
                systems.forEach(s => s.associatedDLs?.forEach(dl => dl && dlToSystemMap.set(dl, { id: s.id, name: s.name })));
                
                const allHistory = await withRetry(() => store.get(CACHE_KEY, { type: 'json' }), log).catch(() => rebuildHistoryCache(store, log));
                const recordsToUpdate = allHistory.filter(r => !r.systemId && r.dlNumber && dlToSystemMap.has(r.dlNumber));
                
                let associatedCount = 0;
                const updatedRecordMap = new Map();
                for (const record of recordsToUpdate) {
                    const systemInfo = dlToSystemMap.get(record.dlNumber);
                    if (systemInfo) {
                        const updatedRecord = { ...record, systemId: systemInfo.id, systemName: systemInfo.name };
                        await withRetry(() => store.setJSON(record.id, updatedRecord), log);
                        updatedRecordMap.set(record.id, updatedRecord);
                        associatedCount++;
                    }
                }
                if (associatedCount > 0) {
                    log('info', 'Auto-association complete.', { associatedCount });
                    await updateCache(store, log, cache => cache.map(r => updatedRecordMap.get(r.id) || r));
                } else {
                    log('info', 'Auto-association complete. No records were updated.');
                }
                return respond(200, { success: true, associatedCount });
            }
            
            if (action === 'backfill-weather') {
                log('info', 'Starting weather backfill for history records.');
                const allHistory = await withRetry(() => store.get(CACHE_KEY, { type: 'json' }), log).catch(() => rebuildHistoryCache(store, log));
                const systemsStore = getConfiguredStore(SYSTEMS_STORE_NAME, log);
                const systems = await withRetry(() => systemsStore.get("_all_systems_cache", { type: 'json' }), log).catch(() => []);
                const systemsWithLocation = new Map(systems.filter(s => s.latitude && s.longitude).map(s => [s.id, s]));
            
                const recordsToUpdate = allHistory.filter(r => !r.weather && r.systemId && systemsWithLocation.has(r.systemId));
                let updatedCount = 0;
                const updatedRecordMap = new Map();
                for (const record of recordsToUpdate) {
                    const system = systemsWithLocation.get(record.systemId);
                    if (system && record.timestamp) {
                        const weather = await fetchHistoricalWeather(system.latitude, system.longitude, record.timestamp, log);
                        if (weather) {
                            const updatedRecord = { ...record, weather };
                            await withRetry(() => store.setJSON(record.id, updatedRecord), log);
                            updatedRecordMap.set(record.id, updatedRecord);
                            updatedCount++;
                        }
                    }
                }
                if (updatedCount > 0) {
                    log('info', `Weather backfill complete. Updated ${updatedCount} records.`);
                    await updateCache(store, log, cache => cache.map(r => updatedRecordMap.get(r.id) || r));
                } else {
                    log('info', 'Weather backfill complete. No records needed updating.');
                }
                return respond(200, { success: true, updatedCount });
            }

            if (action === 'cleanup-links') {
                log('info', 'Starting history link cleanup.');
                const systemsStore = getConfiguredStore(SYSTEMS_STORE_NAME, log);
                const systems = await withRetry(() => systemsStore.get("_all_systems_cache", { type: 'json' }), log).catch(() => []);
                const systemsMap = new Map(systems.map(s => [s.id, s.name]));
                const allHistory = await withRetry(() => store.get(CACHE_KEY, { type: 'json' }), log).catch(() => rebuildHistoryCache(store, log));
                
                let updatedCount = 0;
                const updatedRecordMap = new Map();
                for (const record of allHistory) {
                    let needsUpdate = false;
                    const updatedRecord = { ...record };
                    if (record.systemId && !systemsMap.has(record.systemId)) {
                        updatedRecord.systemId = null; updatedRecord.systemName = 'Unlinked'; needsUpdate = true;
                    } else if (record.systemId && record.systemName !== systemsMap.get(record.systemId)) {
                        updatedRecord.systemName = systemsMap.get(record.systemId); needsUpdate = true;
                    }
                    if (needsUpdate) {
                       await withRetry(() => store.setJSON(record.id, updatedRecord), log);
                       updatedRecordMap.set(record.id, updatedRecord);
                       updatedCount++;
                    }
                }
                if (updatedCount > 0) {
                    log('info', `Link cleanup complete. Updated ${updatedCount} records.`);
                    await updateCache(store, log, cache => cache.map(r => updatedRecordMap.get(r.id) || r));
                } else {
                    log('info', 'Link cleanup complete. No records needed updating.');
                }
                return respond(200, { success: true, updatedCount });
            }
            
            const newRecord = { ...body, id: uuidv4() };
            log('info', 'Creating new history record.', { recordId: newRecord.id, fileName: newRecord.fileName });
            await withRetry(() => store.setJSON(newRecord.id, newRecord), log);
            await updateCache(store, log, cache => [...cache, newRecord]);
            return respond(201, newRecord);
        }
        
        if (event.httpMethod === 'PUT') {
            const { recordId, systemId, dlNumber } = JSON.parse(event.body);
            if (!recordId || !systemId) return respond(400, { error: "recordId and systemId are required." });
            log('info', 'Linking record to system.', { recordId, systemId, dlNumber });

            const systemsStore = getConfiguredStore(SYSTEMS_STORE_NAME, log);
            const system = await withRetry(() => systemsStore.get(systemId, { type: "json" }), log);
            if (!system) return respond(404, { error: "Target system not found." });

            const recordToUpdate = await withRetry(() => store.get(recordId, { type: "json" }), log);
            if (!recordToUpdate) return respond(404, { error: "Analysis record not found." });

            const updatedRecord = { ...recordToUpdate, systemId, systemName: system.name };
            if (!updatedRecord.weather && system.latitude && system.longitude && updatedRecord.timestamp) {
                log('info', 'Record is missing weather data. Fetching weather.', { recordId });
                updatedRecord.weather = await fetchHistoricalWeather(system.latitude, system.longitude, updatedRecord.timestamp, log);
            }
            await withRetry(() => store.setJSON(recordId, updatedRecord), log);

            const recordDlNumber = dlNumber || recordToUpdate.dlNumber;
            if (recordDlNumber && !system.associatedDLs?.includes(recordDlNumber)) {
                log('info', 'Associating DL number with system.', { systemId, dlNumber: recordDlNumber });
                system.associatedDLs = [...(system.associatedDLs || []), recordDlNumber];
                await withRetry(() => systemsStore.setJSON(system.id, system), log);
                // System cache will be updated in its own function, but ideally we'd pass the updated system obj
            }
            
            await updateCache(store, log, cache => {
                const index = cache.findIndex(r => r.id === recordId);
                if (index > -1) cache[index] = updatedRecord;
                else cache.push(updatedRecord);
                return cache;
            });

            return respond(200, { success: true });
        }

        if (event.httpMethod === 'DELETE') {
            const { id, unlinked } = event.queryStringParameters || {};
            if (unlinked === 'true') {
                log('warn', 'Deleting all unlinked history records.');
                const allHistory = await withRetry(() => store.get(CACHE_KEY, { type: 'json' }), log).catch(() => rebuildHistoryCache(store, log));
                const unlinkedRecords = allHistory.filter(record => !record.systemId);
                log('info', `Found ${unlinkedRecords.length} unlinked records to delete.`);
                for (const record of unlinkedRecords) await withRetry(() => store.delete(record.id), log);
                if (unlinkedRecords.length > 0) {
                    await updateCache(store, log, cache => cache.filter(r => r.systemId));
                }
                return respond(200, { success: true, deletedCount: unlinkedRecords.length });
            } else if (id) {
                log('warn', 'Deleting single history record.', { id });
                await withRetry(() => store.delete(id), log);
                await updateCache(store, log, cache => cache.filter(r => r.id !== id));
                return respond(200, { success: true });
            }
            return respond(400, { error: "Missing or invalid query parameters for DELETE." });
        }

        return respond(405, { error: 'Method Not Allowed' });
    } catch (error) {
        log('error', 'Critical error in history function.', { errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};