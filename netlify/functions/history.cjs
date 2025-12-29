// @ts-nocheck - Dynamic Mongo shapes and Netlify event typing; tracked for future typing hardening
const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.cjs");
const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
    if (!process.env.MONGODB_URI) {
        log.error('Missing MONGODB_URI environment variable');
        return false;
    }
    return true;
}
const { ObjectId } = require('mongodb'); // Needed for BulkWrite operations
const { fetchHistoricalWeather, fetchHourlyWeather, getDaylightHours } = require("./utils/weather-fetcher.cjs");
const { mergeBmsAndCloudData, downsampleMergedData } = require('./utils/data-merge.cjs');

const respond = (statusCode, body, headers = {}) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
});

async function verifyGoogleIdToken(event, log) {
    const authHeader = event.headers?.authorization || '';
    const bearerPrefix = 'Bearer ';

    if (!authHeader.startsWith(bearerPrefix)) {
        return { ok: false, reason: 'missing' };
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
        log.warn('GOOGLE_CLIENT_ID not configured; skipping Google ID token verification');
        return { ok: false, reason: 'client_id_missing' };
    }

    const idToken = authHeader.slice(bearerPrefix.length).trim();

    try {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (!res.ok) {
            const text = await res.text();
            log.warn('Google ID token verification failed', { status: res.status, body: text });
            return { ok: false, reason: 'invalid_token' };
        }

        const tokenInfo = await res.json();

        if (tokenInfo.aud !== process.env.GOOGLE_CLIENT_ID) {
            log.warn('Google ID token audience mismatch', { expected: process.env.GOOGLE_CLIENT_ID, received: tokenInfo.aud });
            return { ok: false, reason: 'aud_mismatch' };
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        if (tokenInfo.exp && Number(tokenInfo.exp) < nowSeconds) {
            log.warn('Google ID token expired', { exp: tokenInfo.exp, now: nowSeconds });
            return { ok: false, reason: 'expired' };
        }

        return {
            ok: true,
            email: tokenInfo.email,
            sub: tokenInfo.sub,
            hd: tokenInfo.hd,
        };
    } catch (error) {
        log.error('Failed to verify Google ID token', { error: error.message });
        return { ok: false, reason: 'verification_failed' };
    }
}

async function ensureAdminAuthorized(event, context, headers, log) {
    // Netlify Identity (Google OAuth-backed) — preferred path
    const identityUser = context?.clientContext?.user;
    if (identityUser) {
        log.info('Authorized via Netlify Identity (Google OAuth)', {
            email: identityUser.email,
            id: identityUser.sub || identityUser.id,
            provider: identityUser.app_metadata?.provider
        });
        return null;
    }

    // Preferred path: Google ID token from OAuth-protected admin UI
    const googleAuth = await verifyGoogleIdToken(event, log);
    if (googleAuth.ok) {
        log.info('Authorized via Google OAuth', { email: googleAuth.email, sub: googleAuth.sub, domain: googleAuth.hd });
        return null;
    }

    const adminToken = process.env.ADMIN_ACCESS_TOKEN;

    // If no token is configured, rely on page-level OAuth protection (admin.html) and allow the request.
    if (!adminToken) {
        log.info('No ADMIN_ACCESS_TOKEN configured; allowing request based on page-level Google OAuth protection');
        return null;
    }

    const provided = event.headers?.['x-admin-token'] || event.queryStringParameters?.adminKey;
    if (provided !== adminToken) {
        log.warn('Unauthorized admin operation attempt', { method: event.httpMethod, path: event.path });
        return respond(403, { error: 'Unauthorized' }, headers);
    }

    return null;
}


exports.handler = async function (event, context) {
    const headers = getCorsHeaders(event);

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('history', event, context);
    log.entry(createStandardEntryMeta(event));
    const timer = createTimer(log, 'history');

    // Define logContext for consistent logging throughout the function
    const clientIp = event.headers['x-nf-client-connection-ip'] || 'unknown';
    const logContext = {
        clientIp,
        httpMethod: event.httpMethod,
        path: event.path
    };

    if (!validateEnvironment(log)) {
        log.exit(500);
        return respond(500, { error: 'Server configuration error' }, headers);
    }

    if (event.httpMethod !== 'GET') {
        const authResponse = await ensureAdminAuthorized(event, context, headers, log);
        if (authResponse) {
            log.exit(403);
            return authResponse;
        }
    }

    try {
        const historyCollection = await getCollection("history");
        const systemsCollection = await getCollection("systems");

        // --- GET Request Handler ---
        if (event.httpMethod === 'GET') {
            const { id, systemId, all, page = '1', limit = '25', merged, startDate, endDate, downsample, updatedSince } = event.queryStringParameters || {};

            if (id) {
                // Fetch single record by ID
                log.debug('Fetching single record by ID', { id });
                const record = await historyCollection.findOne({ id }, { projection: { _id: 0 } });
                timer.end({ found: !!record });
                log.exit(record ? 200 : 404);
                return record ? respond(200, record, headers) : respond(404, { error: "Record not found." }, headers);
            }

            // --- Weather-Only Fetch (Standardized Timeline) ---
            if (event.queryStringParameters.weatherOnly === 'true' && systemId && startDate && endDate) {
                log.info('Fetching raw weather/solar data', { systemId, startDate, endDate });

                try {
                    const hourlyWeatherCollection = await getCollection("hourly-weather");

                    // Fetch weather data
                    const weatherData = await hourlyWeatherCollection.find({
                        systemId: systemId,
                        date: { $gte: startDate.split('T')[0], $lte: endDate.split('T')[0] }
                    }).toArray();

                    // Process and flatten to hourly points
                    let flatPoints = [];

                    weatherData.forEach(day => {
                        if (day.hourlyData && Array.isArray(day.hourlyData)) {
                            day.hourlyData.forEach(hour => {
                                // Ensure point is within exact requested range
                                if (hour.timestamp >= startDate && hour.timestamp <= endDate) {
                                    flatPoints.push({
                                        ...hour,
                                        systemId: systemId,
                                        source: 'weather'
                                    });
                                }
                            });
                        }
                    });

                    // Sort by timestamp
                    flatPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                    timer.end({ weatherOnly: true, count: flatPoints.length });
                    log.exit(200);
                    return respond(200, flatPoints, headers);
                } catch (err) {
                    log.error('Failed to fetch weather data', { error: err.message, stack: err.stack });
                    return respond(500, { error: 'Failed to fetch weather data: ' + err.message }, headers);
                }
            }

            // Merged timeline data (BMS + Cloud)
            if (merged === 'true' && systemId && startDate && endDate) {
                log.info('Fetching merged timeline data', { systemId, startDate, endDate });

                try {
                    let mergedData = await mergeBmsAndCloudData(systemId, startDate, endDate, log);

                    // Apply downsampling if requested
                    if (downsample === 'true') {
                        const maxPoints = parseInt(event.queryStringParameters.maxPoints) || 2000;
                        mergedData = downsampleMergedData(mergedData, maxPoints, log);
                    }

                    timer.end({ merged: true, dataPoints: mergedData.length });
                    log.exit(200);
                    return respond(200, {
                        systemId,
                        startDate,
                        endDate,
                        totalPoints: mergedData.length,
                        downsampled: downsample === 'true',
                        data: mergedData
                    });
                } catch (err) {
                    log.error('Failed to merge timeline data', { error: err.message, stack: err.stack });
                    return respond(500, { error: 'Failed to merge timeline data: ' + err.message }, headers);
                }
            }

            if (systemId) {
                // Fetch all history for a specific system (used for charting)
                log.info('Fetching full history for a single system', { ...logContext, systemId });
                const historyForSystem = await historyCollection.find({ systemId }, { projection: { _id: 0 } }).sort({ timestamp: 1 }).toArray();
                timer.end({ systemId, count: historyForSystem.length });
                log.exit(200);
                return respond(200, historyForSystem, headers);
            }

            if (all === 'true') {
                // Fetch ALL or INCREMENTAL history records
                const query = {};
                if (updatedSince) {
                    query.updatedAt = { $gt: updatedSince };
                    log.info('Fetching INCREMENTAL history records', { ...logContext, updatedSince });
                } else {
                    log.info('Fetching ALL history records', logContext);
                }

                // LIMIT to 500 and sort by updatedAt ASC to allow incremental processing
                // without hitting Netlify response limits (6MB) or timeouts.
                const allHistory = await historyCollection.find(query, { projection: { _id: 0 } })
                    .sort({ updatedAt: 1 })
                    .limit(500)
                    .toArray();

                timer.end({ all: true, incremental: !!updatedSince, count: allHistory.length });
                log.info(`Sync returning ${allHistory.length} records`, { ...logContext, incremental: !!updatedSince });
                log.exit(200);
                return respond(200, allHistory, headers);
            }

            // Fetch paginated history (default)
            log.debug('Fetching paginated history', { ...logContext, page, limit });
            const isAll = limit === 'all';
            const pageNum = parseInt(page, 10);
            // SAFETY: Cap 'all' to 1000 to prevent 502/timeouts
            const limitNum = isAll ? 1000 : parseInt(limit, 10);
            const skip = isAll ? 0 : (pageNum - 1) * limitNum;

            let query = historyCollection.find({}, { projection: { _id: 0 } })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limitNum);

            const [history, totalItems] = await Promise.all([
                query.toArray(),
                historyCollection.countDocuments({})
            ]);

            timer.end({ page: pageNum, returned: history.length, total: totalItems });
            log.info(`Returning page ${pageNum} of history`, { ...logContext, returned: history.length, total: totalItems });
            log.exit(200);
            return respond(200, { items: history, totalItems }, headers);
        }

        // --- POST Request Handler ---
        if (event.httpMethod === 'POST') {
            const parsedBody = JSON.parse(event.body);
            log.debug('Parsed POST body', { ...logContext, bodyPreview: JSON.stringify(parsedBody).substring(0, 100) });
            const { action } = parsedBody;
            const postLogContext = { ...logContext, action };
            log.info('Processing POST request', postLogContext);

            // --- Batch Delete Action ---
            if (action === 'deleteBatch') {
                const { recordIds } = parsedBody;
                if (!recordIds || !Array.isArray(recordIds)) {
                    timer.end({ error: 'missing_recordIds' });
                    log.exit(400);
                    return respond(400, { error: 'recordIds array is required.' }, headers);
                }
                log.warn('Deleting batch of history records', { ...postLogContext, count: recordIds.length });
                const { deletedCount } = await historyCollection.deleteMany({ id: { $in: recordIds } });
                timer.end({ action, deletedCount });
                log.exit(200);
                return respond(200, { success: true, deletedCount }, headers);
            }

            // --- Fix Power Signs Action ---
            if (action === 'fix-power-signs') {
                log.info('Starting fix-power-signs task', postLogContext);
                const filter = {
                    'analysis.current': { $lt: 0 }, // Current is negative (discharge)
                    'analysis.power': { $gt: 0 }    // Power is positive (incorrect)
                };
                const updatePipeline = [
                    { $set: { 'analysis.power': { $multiply: ['$analysis.power', -1] }, updatedAt: new Date().toISOString() } }
                ];
                const { modifiedCount } = await historyCollection.updateMany(filter, updatePipeline);
                timer.end({ action, updatedCount: modifiedCount });
                log.info('Fix-power-signs task complete', { action, updatedCount: modifiedCount });
                log.exit(200);
                return respond(200, { success: true, updatedCount: modifiedCount }, headers);
            }

            // --- Auto-Associate Action ---
            if (action === 'auto-associate') {
                log.info('Starting auto-association task', { action });
                const { skip = 0 } = parsedBody;
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 15000;
                let timeoutReached = false;

                // Helper for normalization
                const normalizeId = (id) => id ? id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : null;

                // Fetch all systems first (needed for cleanup and association)
                const systems = await systemsCollection.find({}).toArray();
                const systemMap = new Map(systems.map(s => [s.id, s]));
                const allSystemIds = Array.from(systemMap.keys());

                // --- PHASE 0: Cleanup Orphans (Holistic Repair) ---
                // Identify records with a systemId that no longer exists in the systems collection
                // and set them to null so they can be re-evaluated for association.
                let orphansCleaned = 0;
                if (allSystemIds.length > 0) {
                    const orphanResult = await historyCollection.updateMany(
                        { systemId: { $exists: true, $ne: null, $nin: allSystemIds } },
                        { $set: { systemId: null, systemName: null, updatedAt: new Date().toISOString() } }
                    );
                    orphansCleaned = orphanResult.modifiedCount;
                    if (orphansCleaned > 0) {
                        log.info(`Cleaned up ${orphansCleaned} orphaned records (invalid systemId -> null).`);
                    }
                }

                // --- PHASE 1: Learn from existing links (Self-Healing) ---
                // Find all records that ARE linked but have IDs not yet in the system definition
                log.info('Phase 1: Learning associations from history...');
                const linkedIdAggregation = await historyCollection.aggregate([
                    {
                        $match: {
                            systemId: { $ne: null },
                            $or: [
                                { dlNumber: { $exists: true, $ne: null } },
                                { hardwareSystemId: { $exists: true, $ne: null } },
                                { 'analysis.dlNumber': { $exists: true, $ne: null } },
                                { 'analysis.hardwareSystemId': { $exists: true, $ne: null } }
                            ]
                        }
                    },
                    {
                        $group: {
                            _id: "$systemId",
                            associatedIDs: {
                                $addToSet: {
                                    $ifNull: ["$hardwareSystemId", "$dlNumber", "$analysis.hardwareSystemId", "$analysis.dlNumber"]
                                }
                            }
                        }
                    }
                ]).toArray();

                let systemsUpdatedCount = 0;
                const systemUpdateBulkOps = [];

                // Fetch all systems for comparison (Already fetched in Phase 0)
                // const systems = await systemsCollection.find({}).toArray();
                // const systemMap = new Map(systems.map(s => [s.id, s]));

                for (const group of linkedIdAggregation) {
                    const systemId = group._id;
                    const historyIds = group.associatedIDs.filter(id => id); // Remove nulls
                    const system = systemMap.get(systemId);

                    if (system && historyIds.length > 0) {
                        const currentSystemIds = new Set([
                            ...(system.associatedDLs || []),
                            ...(system.associatedHardwareIds || [])
                        ]);

                        const newIds = historyIds.filter(id => !currentSystemIds.has(id));

                        if (newIds.length > 0) {
                            log.info(`Found new IDs for system ${system.name} from history records`, { systemId, newIds });

                            // Update local object for Phase 2
                            system.associatedDLs = [...(system.associatedDLs || []), ...newIds];

                            // Push database update
                            systemUpdateBulkOps.push({
                                updateOne: {
                                    filter: { id: systemId },
                                    update: { $addToSet: { associatedDLs: { $each: newIds } } }
                                }
                            });
                            systemsUpdatedCount++;
                        }
                    }
                }

                if (systemUpdateBulkOps.length > 0) {
                    log.info(`Updating ${systemUpdateBulkOps.length} systems with learned IDs.`);
                    await systemsCollection.bulkWrite(systemUpdateBulkOps);
                }

                // --- PHASE 2: Standard Auto-Association ---
                log.info('Phase 2: Running auto-association with updated system definitions...');
                let debugInfo = {
                    orphansCleaned,
                    phase1Updates: systemUpdateBulkOps.length,
                    systemsLoaded: systems.length,
                    mapEntries: 0,
                    unlinkedFound: 0,
                    unmatchableCount: 0,
                    sampleFailures: []
                };

                const hardwareIdMap = new Map(); // Map normalized ID -> array of system objects

                // Re-process systems (using updated memory objects)
                systems.forEach(s => {
                    const allIds = new Set([
                        ...(s.associatedDLs || []),
                        ...(s.associatedHardwareIds || []) // Include alias
                    ]);

                    allIds.forEach(rawId => {
                        const normId = normalizeId(rawId);
                        if (normId) {
                            if (!hardwareIdMap.has(normId)) hardwareIdMap.set(normId, []);
                            // Prevent duplicates in map if dlNumber and hardwareSystemId overlap
                            const existing = hardwareIdMap.get(normId);
                            if (!existing.some(ex => ex.id === s.id)) {
                                existing.push({ id: s.id, name: s.name });
                            }
                        }
                    });
                });

                // Get stats on unmatchable records first
                // Updated logic: Include records where fields are empty string '' as unmatchable
                // Get stats on unmatchable records first
                // Updated logic: Include records where fields are empty string '' as unmatchable
                const stats = await historyCollection.aggregate([
                    { $match: { systemId: null } },
                    {
                        $group: {
                            _id: null,
                            totalUnlinked: { $sum: 1 },
                            unmatchable: {
                                $sum: {
                                    $cond: [
                                        {
                                            $and: [
                                                // Check if root dlNumber is missing/empty
                                                { $or: [{ $in: [{ $type: "$dlNumber" }, ["missing", "null"]] }, { $eq: ["$dlNumber", ""] }] },
                                                // Check if root hardwareSystemId is missing/empty
                                                { $or: [{ $in: [{ $type: "$hardwareSystemId" }, ["missing", "null"]] }, { $eq: ["$hardwareSystemId", ""] }] },
                                                // Check if analysis.dlNumber is missing/empty
                                                { $or: [{ $in: [{ $type: "$analysis.dlNumber" }, ["missing", "null"]] }, { $eq: ["$analysis.dlNumber", ""] }] },
                                                // Check if analysis.hardwareSystemId is missing/empty
                                                { $or: [{ $in: [{ $type: "$analysis.hardwareSystemId" }, ["missing", "null"]] }, { $eq: ["$analysis.hardwareSystemId", ""] }] }
                                            ]
                                        }, 1, 0
                                    ]
                                }
                            }
                        }
                    }
                ]).toArray();

                debugInfo.unmatchableCount = stats[0]?.unmatchable || 0;
                const totalUnlinked = stats[0]?.totalUnlinked || 0;

                const unlinkedCursor = historyCollection.find({
                    systemId: null,
                    $or: [
                        { dlNumber: { $exists: true, $nin: [null, ''] } },
                        { hardwareSystemId: { $exists: true, $nin: [null, ''] } },
                        // Checks for nested IDs inside analysis object
                        { 'analysis.dlNumber': { $exists: true, $nin: [null, ''] } },
                        { 'analysis.hardwareSystemId': { $exists: true, $nin: [null, ''] } }
                    ]
                }).skip(skip); // Apply skip to move past unmatchable records from previous batches

                let associatedCount = 0;
                let processedCount = 0;
                let ambiguousCount = 0;
                const bulkOps = [];

                for await (const record of unlinkedCursor) {
                    if (Date.now() - startTime > MAX_EXECUTION_TIME) {
                        timeoutReached = true;
                        log.warn('Auto-associate task approaching timeout, stopping early.', { associatedCount });
                        break;
                    }
                    processedCount++;

                    // Try to extract a valid ID from the record (checking root AND nested fields)
                    const recordHardwareId = normalizeId(record.hardwareSystemId) ||
                        normalizeId(record.dlNumber) ||
                        normalizeId(record.analysis?.hardwareSystemId) ||
                        normalizeId(record.analysis?.dlNumber);

                    if (recordHardwareId) {
                        const potentialSystems = hardwareIdMap.get(recordHardwareId);

                        // Only associate if exactly one system matches the Hardware ID
                        if (potentialSystems) {
                            if (potentialSystems.length === 1) {
                                const system = potentialSystems[0];
                                bulkOps.push({
                                    updateOne: {
                                        filter: { _id: record._id }, // Use _id for bulk ops
                                        update: {
                                            $set: {
                                                systemId: system.id,
                                                systemName: system.name,
                                                // Ensure standard fields are populated (lifting nested ID to root)
                                                hardwareSystemId: recordHardwareId,
                                                updatedAt: new Date().toISOString()
                                                // Note: we don't overwrite dlNumber if it exists, to preserve original
                                            }
                                        }
                                    }
                                });
                                associatedCount++;
                                if (bulkOps.length >= 500) { // Process in batches
                                    await historyCollection.bulkWrite(bulkOps, { ordered: false });
                                    bulkOps.length = 0; // Clear the array
                                    log.debug('Processed auto-associate batch', { action, count: 500 });
                                }
                            } else {
                                ambiguousCount++;
                                if (debugInfo.sampleFailures.length < 50) { // Increased limit from 5 to 50
                                    debugInfo.sampleFailures.push({
                                        reason: 'ambiguous',
                                        id: recordHardwareId,
                                        matches: potentialSystems.map(s => s.name)
                                    });
                                }
                            }
                        } else {
                            // No match found
                            if (debugInfo.sampleFailures.length < 50) { // Increased limit from 5 to 50
                                debugInfo.sampleFailures.push({
                                    reason: 'no_match',
                                    recordId: record.id,
                                    rawSystemId: record.hardwareSystemId,
                                    rawDl: record.dlNumber,
                                    normalized: recordHardwareId
                                });
                            }
                        }
                    }
                }

                debugInfo.unlinkedFound = processedCount;
                debugInfo.associated = associatedCount;
                debugInfo.mapEntries = hardwareIdMap.size;

                if (bulkOps.length > 0) {
                    await historyCollection.bulkWrite(bulkOps, { ordered: false });
                }

                timer.end({ action, associatedCount, processedCount, ambiguousCount, timeoutReached, systemsUpdatedCount, orphansCleaned });
                log.info('Auto-association task complete', { action, associatedCount, ambiguousCount, timeoutReached, systemsUpdatedCount, orphansCleaned });

                let message = timeoutReached
                    ? `Time limit reached. Processed ${processedCount}, Associated ${associatedCount}`
                    : `Completed. Processed ${processedCount} matchable records, Associated ${associatedCount}.`;

                if (ambiguousCount > 0) {
                    message += ` (Ambiguous: ${ambiguousCount})`;
                }
                if (debugInfo.unmatchableCount > 0) {
                    message += ` (Unmatchable: ${debugInfo.unmatchableCount})`;
                }

                if (systemsUpdatedCount > 0) {
                    message += ` (Updated ${systemsUpdatedCount} systems)`;
                }

                if (orphansCleaned > 0) {
                    message += ` (Cleaned ${orphansCleaned} orphans)`;
                }
                if (timeoutReached) {
                    message += " Run again to continue.";
                }

                log.exit(200);
                return respond(200, {
                    success: true,
                    associatedCount,
                    processedCount,
                    message,
                    debugInfo
                }, headers);
            }

            // --- Cleanup Links Action ---
            if (action === 'cleanup-links') {
                log.info('Starting cleanup-links task', { action });

                // Optimized bulk update logic - NO LOOP
                const allSystemIds = await systemsCollection.distinct('id');

                // Find and unset systemId for any record pointing to a non-existent system in one go
                // Using updateMany is atomic and much faster than iterating
                const result = await historyCollection.updateMany(
                    { systemId: { $exists: true, $ne: null, $nin: allSystemIds } },
                    { $set: { systemId: null, systemName: null, updatedAt: new Date().toISOString() } }
                );

                const updatedCount = result.modifiedCount;

                timer.end({ action, updatedCount, optimized: true });
                log.info('Cleanup-links task complete (optimized)', { action, updatedCount });
                log.exit(200);
                return respond(200, {
                    success: true,
                    updatedCount,
                    message: `Completed. Cleaned ${updatedCount} records.`
                }, headers);
            }

            // --- Normalize IDs Action (Unify fields app-wide) ---
            if (action === 'normalize-ids') {
                log.info('Starting normalize-ids task', { action });
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 20000;
                let updatedCount = 0;
                let scannedCount = 0;

                // Find records that might need normalization (either missing root ID or have analysis ID)
                // We process in batches to handle timeouts gracefully
                const parsedLimit = parseInt(parsedBody.limit) || 1000;

                // Helper to normalize an ID string
                const norm = (id) => (!id || id === 'UNKNOWN') ? null : String(id).trim();

                const cursor = historyCollection.find({
                    $or: [
                        { hardwareSystemId: null },
                        { hardwareSystemId: "" },
                        { hardwareSystemId: "UNKNOWN" },
                        { dlNumber: { $ne: null } }, // Check if dlNumber exists but hardwareSystemId might differ
                        { 'analysis.hardwareSystemId': { $exists: true } },
                        { 'analysis.dlNumber': { $exists: true } }
                    ]
                }).limit(parsedLimit);

                const bulkOps = [];

                for await (const record of cursor) {
                    if (Date.now() - startTime > MAX_EXECUTION_TIME) break;
                    scannedCount++;

                    // Priority Step 1: Get the Best ID available (preferring root hardwareSystemId if valid)
                    const rootHwId = norm(record.hardwareSystemId);
                    const rootDl = norm(record.dlNumber);
                    const nestedHwId = norm(record.analysis?.hardwareSystemId);
                    const nestedDl = norm(record.analysis?.dlNumber);

                    // Determine the "True" ID
                    // Logic: Use existing root ID if valid, otherwise lift from nested.
                    // If root fields mismatch, prefer hardwareSystemId, or unify them if one is missing.
                    const bestId = rootHwId || rootDl || nestedHwId || nestedDl;

                    if (bestId) {
                        // Check if update is actually needed (completeness check)
                        const needsUpdate = (
                            record.hardwareSystemId !== bestId ||
                            record.dlNumber !== bestId // Ensure legacy field matches
                        );

                        if (needsUpdate) {
                            bulkOps.push({
                                updateOne: {
                                    filter: { _id: record._id },
                                    update: {
                                        $set: {
                                            hardwareSystemId: bestId,
                                            dlNumber: bestId, // Legacy compat: Force sync
                                            updatedAt: new Date().toISOString()
                                        }
                                    }
                                }
                            });
                            updatedCount++;
                        }
                    }
                }

                if (bulkOps.length > 0) {
                    await historyCollection.bulkWrite(bulkOps);
                }

                const message = `Scanned ${scannedCount} records, unified IDs for ${updatedCount} records.`;
                timer.end({ action, updatedCount, scannedCount, message });
                log.info('Normalize-ids task complete', { action, updatedCount, scannedCount });

                return respond(200, {
                    success: true,
                    updatedCount,
                    scannedCount,
                    message
                }, headers);
            }

            if (action === 'count-records-needing-weather') {
                log.info('Counting records needing weather backfill', { action });
                const count = await historyCollection.countDocuments({ systemId: { $ne: null }, $or: [{ weather: null }, { 'weather.clouds': { $exists: false } }] });
                timer.end({ action, count });
                log.exit(200);
                return respond(200, { count }, headers);
            }

            // --- Backfill Weather Action ---
            if (action === 'backfill-weather') {
                log.info('Starting backfill-weather task', { action });

                const maxRecords = parseInt(parsedBody.maxRecords) || 50; // Default to 50 records per run
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 20000; // 20 seconds (leave 6 seconds buffer)

                const systemsWithLocation = await systemsCollection.find({ latitude: { $ne: null }, longitude: { $ne: null } }).toArray();
                const systemLocationMap = new Map(systemsWithLocation.map(s => [s.id, { lat: s.latitude, lon: s.longitude }]));

                const recordsNeedingWeatherCursor = historyCollection.find({
                    systemId: { $ne: null },
                    $or: [{ weather: null }, { 'weather.clouds': { $exists: false } }]
                }).limit(maxRecords); // Limit number of records to process

                let updatedCount = 0;
                let errorCount = 0;
                let processedCount = 0;
                const bulkOps = [];
                const BATCH_SIZE = 25; // Smaller batch for safer processing
                const THROTTLE_DELAY_MS = 200; // Reduced delay for faster processing
                const RETRY_DELAY_MS = 500; // Reduced delay after error
                let timeoutReached = false;

                for await (const record of recordsNeedingWeatherCursor) {
                    // Check if we're approaching timeout
                    const elapsedTime = Date.now() - startTime;
                    if (elapsedTime > MAX_EXECUTION_TIME) {
                        log.warn('Approaching timeout limit, stopping early', {
                            action,
                            elapsedTime,
                            processedCount,
                            updatedCount
                        });
                        timeoutReached = true;
                        break;
                    }

                    processedCount++;
                    log.debug(`Processing weather backfill for record: ${record.id}`, { processedCount, maxRecords });
                    const location = systemLocationMap.get(record.systemId);
                    if (location && record.timestamp) {
                        try {
                            const weatherData = await fetchHistoricalWeather(location.lat, location.lon, record.timestamp, log);
                            if (weatherData) {
                                bulkOps.push({
                                    updateOne: {
                                        filter: { _id: record._id },
                                        update: { $set: { weather: weatherData } }
                                    }
                                });
                                updatedCount++;
                            }
                        } catch (weatherError) {
                            errorCount++;
                            log.warn('Failed to fetch weather during backfill', { recordId: record.id, error: weatherError.message });
                            // Add delay after error to avoid rate limiting
                            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        }

                        if (bulkOps.length >= BATCH_SIZE) {
                            try {
                                const result = await historyCollection.bulkWrite(bulkOps, { ordered: false });
                                log.info('Processed backfill-weather batch', {
                                    action,
                                    batchSize: bulkOps.length,
                                    modified: result.modifiedCount,
                                    totalProcessed: updatedCount
                                });
                            } catch (e) {
                                log.error('Error during bulkWrite', { error: e.message, batchSize: bulkOps.length });
                            }
                            bulkOps.length = 0;
                            // Throttle to avoid hitting rate limits
                            await new Promise(resolve => setTimeout(resolve, THROTTLE_DELAY_MS));
                        }
                    }
                }

                if (bulkOps.length > 0) {
                    try {
                        const result = await historyCollection.bulkWrite(bulkOps, { ordered: false });
                        log.info('Processed final backfill-weather batch', {
                            action,
                            batchSize: bulkOps.length,
                            modified: result.modifiedCount
                        });
                    } catch (e) {
                        log.error('Error during final bulkWrite', { error: e.message, batchSize: bulkOps.length });
                    }
                }

                const completed = !timeoutReached && processedCount < maxRecords;
                const message = completed
                    ? 'Weather backfill completed successfully.'
                    : `Processed ${processedCount} records before ${timeoutReached ? 'timeout' : 'limit'}. Run again to continue.`;

                timer.end({ action, updatedCount, errorCount, processedCount, completed });
                log.info('Backfill-weather task finished', {
                    action,
                    updatedCount,
                    errorCount,
                    processedCount,
                    completed,
                    message
                });
                log.exit(200);

                return respond(200, {
                    success: true,
                    updatedCount,
                    errorCount,
                    processedCount,
                    completed,
                    message
                }, headers);
            }

            // --- Hourly Cloud Backfill Action ---
            if (action === 'hourly-cloud-backfill') {
                log.info('Starting hourly-cloud-backfill task', { action });

                // Get maxDays parameter (default to 10 days per run to avoid timeout)
                const maxDaysPerRun = parseInt(parsedBody.maxDays) || 10;
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 20000; // 20 seconds (leave 6 seconds buffer for Netlify's 26s limit)

                // Get systems with location data
                const systemsWithLocation = await systemsCollection.find({
                    latitude: { $ne: null },
                    longitude: { $ne: null }
                }).toArray();

                if (systemsWithLocation.length === 0) {
                    log('warn', 'No systems with location data found.', postLogContext);
                    return respond(200, {
                        success: true,
                        message: 'No systems with location data.',
                        processedDays: 0,
                        completed: true
                    });
                }

                const hourlyWeatherCollection = await getCollection("hourly-weather");
                let totalProcessedDays = 0;
                let totalHoursInserted = 0;
                let totalErrors = 0;
                let timeoutReached = false;

                // Process each system
                systemLoop: for (const system of systemsWithLocation) {
                    log.info('Processing hourly cloud backfill for system', {
                        action,
                        systemId: system.id,
                        systemName: system.name
                    });
                    const systemLogContext = {
                        action,
                        systemId: system.id,
                        systemName: system.name
                    };

                    // Get min and max dates for this system's analysis records
                    const dateRange = await historyCollection.aggregate([
                        { $match: { systemId: system.id, timestamp: { $exists: true, $ne: null } } },
                        {
                            $group: {
                                _id: null,
                                minDate: { $min: '$timestamp' },
                                maxDate: { $max: '$timestamp' }
                            }
                        }
                    ]).toArray();

                    if (dateRange.length === 0 || !dateRange[0].minDate) {
                        log('info', 'No analysis records with timestamps for system, skipping.', systemLogContext);
                        continue;
                    }

                    const minDate = new Date(dateRange[0].minDate);
                    const maxDate = new Date(dateRange[0].maxDate);
                    log('info', 'Date range for system.', {
                        ...systemLogContext,
                        minDate: minDate.toISOString(),
                        maxDate: maxDate.toISOString()
                    });

                    // Iterate through each date in the range
                    const currentDate = new Date(minDate);
                    currentDate.setHours(0, 0, 0, 0); // Start at beginning of day

                    while (currentDate <= maxDate) {
                        // Check if we're approaching timeout
                        const elapsedTime = Date.now() - startTime;
                        if (elapsedTime > MAX_EXECUTION_TIME) {
                            log.warn('Approaching timeout limit, stopping early', {
                                action,
                                elapsedTime,
                                processedDays: totalProcessedDays,
                                maxDaysPerRun
                            });
                            timeoutReached = true;
                            break systemLoop;
                        }

                        // Check if we've hit the max days limit for this run
                        if (totalProcessedDays >= maxDaysPerRun) {
                            log.info('Reached max days limit for this run', {
                                action,
                                processedDays: totalProcessedDays,
                                maxDaysPerRun
                            });
                            timeoutReached = true;
                            break systemLoop;
                        }

                        const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD

                        // Check if we already have hourly data for this date/system
                        const existingRecord = await hourlyWeatherCollection.findOne({
                            systemId: system.id,
                            date: dateStr
                        });

                        if (existingRecord) {
                            log.debug('Hourly weather data already exists for date, skipping', {
                                action,
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr
                            });
                            currentDate.setDate(currentDate.getDate() + 1);
                            continue;
                        }

                        try {
                            // Get daylight hours for this date/location
                            const daylightHours = getDaylightHours(system.latitude, system.longitude, currentDate);

                            if (daylightHours.length === 0) {
                                log.debug('No daylight hours for date (polar night?), skipping', {
                                    action,
                                    systemId: system.id,
                                    systemName: system.name,
                                    date: dateStr
                                });
                                currentDate.setDate(currentDate.getDate() + 1);
                                continue;
                            }

                            // Fetch hourly weather data for the day
                            const hourlyData = await fetchHourlyWeather(
                                system.latitude,
                                system.longitude,
                                dateStr,
                                log
                            );

                            if (!hourlyData || hourlyData.length === 0) {
                                log.warn('No hourly weather data returned', {
                                    action,
                                    systemId: system.id,
                                    systemName: system.name,
                                    date: dateStr
                                });
                                totalErrors++;
                                currentDate.setDate(currentDate.getDate() + 1);
                                await new Promise(resolve => setTimeout(resolve, 200)); // Small delay
                                continue;
                            }

                            // Filter to daylight hours and extract relevant data
                            const daylightHourSet = new Set(daylightHours);
                            const processedHourlyData = hourlyData
                                .map(hour => {
                                    const hourTimestamp = new Date(hour.dt * 1000);
                                    return {
                                        hour: hourTimestamp.getHours(),
                                        timestamp: hourTimestamp.toISOString(),
                                        clouds: hour.clouds,
                                        temp: hour.temp,
                                        uvi: hour.uvi || null,
                                        weather_main: hour.weather?.[0]?.main || 'Unknown',
                                        // Include solar irradiance if available from the API
                                        // Note: OpenWeather doesn't provide direct irradiance, but we can estimate from UVI
                                        estimated_irradiance_w_m2: hour.uvi ? hour.uvi * 25 : null // Rough estimate
                                    };
                                })
                                .filter(hour => daylightHourSet.has(hour.hour));

                            // Store the hourly data
                            const recordToInsert = {
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                latitude: system.latitude,
                                longitude: system.longitude,
                                daylightHours: daylightHours,
                                hourlyData: processedHourlyData,
                                createdAt: new Date().toISOString()
                            };

                            await hourlyWeatherCollection.insertOne(recordToInsert);
                            totalHoursInserted += processedHourlyData.length;
                            totalProcessedDays++;

                            log.info('Stored hourly weather data for date', {
                                action,
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                hoursStored: processedHourlyData.length,
                                daylightHoursCount: daylightHours.length
                            });

                            // Reduced throttle delay for faster processing (still respects API limits)
                            await new Promise(resolve => setTimeout(resolve, 200));

                        } catch (error) {
                            totalErrors++;
                            log.error('Error processing hourly weather for date', {
                                action,
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                error: error.message,
                                stack: error.stack
                            });
                            await new Promise(resolve => setTimeout(resolve, 500)); // Delay after error
                        }

                        // Move to next day
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                const completed = !timeoutReached;
                const message = completed
                    ? 'Hourly cloud backfill completed successfully.'
                    : `Processed ${totalProcessedDays} days before timeout. Run again to continue.`;

                timer.end({ action, totalProcessedDays, totalHoursInserted, totalErrors, completed });
                log.info('Hourly cloud backfill task finished', {
                    action,
                    totalProcessedDays,
                    totalHoursInserted,
                    totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                });
                log.exit(200);

                return respond(200, {
                    success: true,
                    processedDays: totalProcessedDays,
                    hoursInserted: totalHoursInserted,
                    errors: totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                }, headers);
            }

            // --- Hourly Solar Irradiance Backfill Action ---
            if (action === 'hourly-solar-irradiance-backfill') {
                log.info('Starting hourly-solar-irradiance-backfill task', { action });

                const { calculateSolarIrradiance } = require('./utils/solar-irradiance.cjs');

                // Get maxDays parameter (default to 10 days per run to avoid timeout)
                const maxDaysPerRun = parseInt(parsedBody.maxDays) || 10;
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 20000; // 20 seconds

                // Get systems with location data
                const systemsWithLocation = await systemsCollection.find({
                    latitude: { $ne: null },
                    longitude: { $ne: null }
                }).toArray();

                if (systemsWithLocation.length === 0) {
                    log('warn', 'No systems with location data found.', postLogContext);
                    return respond(200, {
                        success: true,
                        message: 'No systems with location data.',
                        processedDays: 0,
                        completed: true
                    });
                }

                const hourlyIrradianceCollection = await getCollection("hourly-solar-irradiance");
                const hourlyWeatherCollection = await getCollection("hourly-weather");
                let totalProcessedDays = 0;
                let totalHoursCalculated = 0;
                let totalErrors = 0;
                let timeoutReached = false;

                // Process each system
                systemLoop: for (const system of systemsWithLocation) {
                    log.info('Processing hourly solar irradiance backfill for system', {
                        action,
                        systemId: system.id,
                        systemName: system.name
                    });
                    const systemLogContext = {
                        action,
                        systemId: system.id,
                        systemName: system.name
                    };

                    // Get min and max dates for this system's analysis records
                    const dateRange = await historyCollection.aggregate([
                        { $match: { systemId: system.id, timestamp: { $exists: true, $ne: null } } },
                        {
                            $group: {
                                _id: null,
                                minDate: { $min: '$timestamp' },
                                maxDate: { $max: '$timestamp' }
                            }
                        }
                    ]).toArray();

                    if (dateRange.length === 0 || !dateRange[0].minDate) {
                        log('info', 'No analysis records with timestamps for system, skipping.', systemLogContext);
                        continue;
                    }

                    const minDate = new Date(dateRange[0].minDate);
                    const maxDate = new Date(dateRange[0].maxDate);
                    log('info', 'Date range for system.', {
                        ...systemLogContext,
                        minDate: minDate.toISOString(),
                        maxDate: maxDate.toISOString()
                    });

                    // Iterate through each date in the range
                    const currentDate = new Date(minDate);
                    currentDate.setHours(0, 0, 0, 0);

                    while (currentDate <= maxDate) {
                        // Check timeout and limits
                        const elapsedTime = Date.now() - startTime;
                        if (elapsedTime > MAX_EXECUTION_TIME || totalProcessedDays >= maxDaysPerRun) {
                            log.warn('Approaching timeout or max days limit, stopping early', {
                                action,
                                elapsedTime,
                                processedDays: totalProcessedDays,
                                maxDaysPerRun
                            });
                            timeoutReached = true;
                            break systemLoop;
                        }

                        const dateStr = currentDate.toISOString().split('T')[0];

                        // Check if we already have irradiance data for this date/system
                        const existingRecord = await hourlyIrradianceCollection.findOne({
                            systemId: system.id,
                            date: dateStr
                        });

                        if (existingRecord) {
                            log.debug('Hourly irradiance data already exists for date, skipping', {
                                action,
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr
                            });
                            currentDate.setDate(currentDate.getDate() + 1);
                            continue;
                        }

                        try {
                            // Get cloud data from hourly-weather collection if available
                            const weatherRecord = await hourlyWeatherCollection.findOne({
                                systemId: system.id,
                                date: dateStr
                            });

                            // Calculate solar irradiance for each hour of the day
                            const hourlyIrradianceData = [];

                            for (let hour = 0; hour < 24; hour++) {
                                const hourTimestamp = new Date(currentDate);
                                hourTimestamp.setHours(hour, 0, 0, 0);

                                // Get cloud cover for this hour if available
                                let cloudCover = null;
                                if (weatherRecord && weatherRecord.hourlyData) {
                                    const weatherHour = weatherRecord.hourlyData.find(h => h.hour === hour);
                                    if (weatherHour) {
                                        cloudCover = weatherHour.clouds;
                                    }
                                }

                                // Calculate irradiance with or without cloud data
                                const irradianceData = calculateSolarIrradiance(
                                    hourTimestamp,
                                    system.latitude,
                                    system.longitude,
                                    cloudCover,
                                    system.altitude || 0
                                );

                                // Only store hours when sun is up
                                if (irradianceData.isSunUp) {
                                    hourlyIrradianceData.push({
                                        hour,
                                        timestamp: irradianceData.timestamp,
                                        solarAltitude: irradianceData.solarAltitude,
                                        solarAzimuth: irradianceData.solarPosition.azimuth,
                                        clearSkyGlobalIrradiance: irradianceData.clearSkyIrradiance.global,
                                        clearSkyDirectIrradiance: irradianceData.clearSkyIrradiance.directHorizontal,
                                        clearSkyDiffuseIrradiance: irradianceData.clearSkyIrradiance.diffuse,
                                        actualGlobalIrradiance: irradianceData.actualIrradiance.global,
                                        actualDirectIrradiance: irradianceData.actualIrradiance.directHorizontal,
                                        actualDiffuseIrradiance: irradianceData.actualIrradiance.diffuse,
                                        cloudCoverPercent: cloudCover,
                                        cloudFactor: irradianceData.actualIrradiance.cloudFactor,
                                        airMass: irradianceData.clearSkyIrradiance.airMass
                                    });
                                }
                            }

                            if (hourlyIrradianceData.length === 0) {
                                log.debug('No daylight hours for date (polar night?), skipping', {
                                    action,
                                    systemId: system.id,
                                    systemName: system.name,
                                    date: dateStr
                                });
                                currentDate.setDate(currentDate.getDate() + 1);
                                continue;
                            }

                            // Store the hourly irradiance data
                            const recordToInsert = {
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                latitude: system.latitude,
                                longitude: system.longitude,
                                altitude: system.altitude || 0,
                                hourlyIrradianceData,
                                hasCloudData: weatherRecord !== null,
                                createdAt: new Date().toISOString()
                            };

                            await hourlyIrradianceCollection.insertOne(recordToInsert);
                            totalHoursCalculated += hourlyIrradianceData.length;
                            totalProcessedDays++;

                            log.info('Stored hourly irradiance data for date', {
                                action,
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                hoursStored: hourlyIrradianceData.length,
                                hasCloudData: recordToInsert.hasCloudData
                            });

                            // Small delay to avoid overwhelming the system
                            await new Promise(resolve => setTimeout(resolve, 50));

                        } catch (error) {
                            totalErrors++;
                            log.error('Error processing hourly irradiance for date', {
                                action,
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                error: error.message,
                                stack: error.stack
                            });
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }

                        // Move to next day
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                const completed = !timeoutReached;
                const message = completed
                    ? 'Hourly solar irradiance backfill completed successfully.'
                    : `Processed ${totalProcessedDays} days before timeout. Run again to continue.`;

                timer.end({ action, totalProcessedDays, totalHoursCalculated, totalErrors, completed });
                log.info('Hourly solar irradiance backfill task finished', {
                    action,
                    totalProcessedDays,
                    totalHoursCalculated,
                    totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                });
                log.exit(200);

                return respond(200, {
                    success: true,
                    processedDays: totalProcessedDays,
                    hoursCalculated: totalHoursCalculated,
                    errors: totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                }, headers);
            }


            // --- Default Action: Create New History Record ---
            log.info('Creating new history record');
            // Basic validation for new record
            if (!parsedBody.analysis || !parsedBody.fileName) {
                timer.end({ error: 'missing_fields' });
                log.exit(400);
                return respond(400, { error: "Missing 'analysis' or 'fileName' for new record." }, headers);
            }
            const newRecord = {
                _id: new ObjectId(), // Use ObjectId for internal _id
                id: uuidv4(),
                timestamp: parsedBody.timestamp || new Date().toISOString(), // Allow timestamp override or default to now
                systemId: parsedBody.systemId || null,
                systemName: parsedBody.systemName || null,
                analysis: parsedBody.analysis,
                weather: parsedBody.weather || null,
                dlNumber: parsedBody.dlNumber || parsedBody.analysis?.dlNumber || null,
                fileName: parsedBody.fileName,
                // Add analysisKey for potential future duplicate checks on insert
                analysisKey: parsedBody.analysisKey || null, // Assuming analysisKey is generated client-side or during process-analysis
            };
            await historyCollection.insertOne(newRecord);
            // Return record without the internal _id
            const { _id, ...recordToReturn } = newRecord;
            timer.end({ created: true });
            log.exit(201);
            return respond(201, recordToReturn, headers);
        }

        // --- PUT Request Handler (Link Record) ---
        if (event.httpMethod === 'PUT') {
            const parsedBody = JSON.parse(event.body);
            log.debug('Parsed PUT body', { bodyPreview: JSON.stringify(parsedBody).substring(0, 100) });
            const { recordId, systemId, dlNumber } = parsedBody;
            if (!recordId || !systemId) {
                timer.end({ error: 'missing_params' });
                log.exit(400);
                return respond(400, { error: "recordId and systemId are required." }, headers);
            }

            const system = await systemsCollection.findOne({ id: systemId });
            if (!system) {
                timer.end({ error: 'system_not_found' });
                log.exit(404);
                return respond(404, { error: "Target system not found." }, headers);
            }

            const updateResult = await historyCollection.updateOne(
                { id: recordId },
                { $set: { systemId, systemName: system.name } }
            );
            if (updateResult.matchedCount === 0) {
                timer.end({ error: 'record_not_found' });
                log.exit(404);
                return respond(404, { error: "Record not found." }, headers);
            }

            // Ensure Hardware ID/DL number is associated with the system
            // If dlNumber was not provided in the request, try to get it from the record
            let idToLink = dlNumber;
            if (!idToLink) {
                // We need to fetch the record to get the hardware ID
                // Note: We might have already fetched it if we did a verify check, but currently we just blindly update.
                // Let's fetch it now if needed.
                const record = await historyCollection.findOne({ id: recordId });
                if (record) {
                    idToLink = record.hardwareSystemId || record.dlNumber;
                }
            }

            if (idToLink) {
                const alreadyHasIt = (system.associatedDLs || []).includes(idToLink) ||
                    (system.associatedHardwareIds || []).includes(idToLink);

                if (!alreadyHasIt) {
                    log.info('Adding Hardware ID to system during link', { recordId, systemId, idToLink });
                    // Add to both aliases for consistency
                    await systemsCollection.updateOne(
                        { id: systemId },
                        {
                            $addToSet: {
                                associatedDLs: idToLink,
                                associatedHardwareIds: idToLink
                            }
                        }
                    );
                }
            }

            timer.end({ linked: true, recordId, systemId });
            log.info('Successfully linked history record to system', { recordId, systemId });
            log.exit(200);
            return respond(200, { success: true }, headers);
        }

        // --- DELETE Request Handler ---
        if (event.httpMethod === 'DELETE') {
            const { id, unlinked } = event.queryStringParameters || {};

            if (unlinked === 'true') {
                // Delete all records not linked to any system (Holistic cleanup)
                log.warn('Deleting ALL unlinked history records', { unlinked: true });

                // 1. Get all valid system IDs
                const allSystemIds = await systemsCollection.distinct('id');

                // 2. Delete where systemId is null OR not in the valid list
                const { deletedCount } = await historyCollection.deleteMany({
                    $or: [
                        { systemId: null },
                        { systemId: { $nin: allSystemIds } }
                    ]
                });

                timer.end({ deleted: true, deletedCount });
                log.info('Deletion of unlinked records complete', { deletedCount });
                log.exit(200);
                return respond(200, { success: true, deletedCount }, headers);
            } else if (id) {
                // Delete a single record by ID
                log.warn('Deleting single history record', { recordId: id });
                const { deletedCount } = await historyCollection.deleteOne({ id });
                if (deletedCount > 0) {
                    timer.end({ deleted: true, recordId: id });
                    log.info('Single record deleted successfully', { recordId: id });
                } else {
                    timer.end({ deleted: false, reason: 'not_found', recordId: id });
                    log.info('Record not found for deletion, treating as success', { recordId: id });
                }
                log.exit(200);
                return respond(200, { success: true, deleted: deletedCount > 0 }, headers);
            }
            log.warn('Missing parameters for DELETE request');
            timer.end({ error: 'missing_params' });
            log.exit(400);
            return respond(400, { error: "Missing 'id' or 'unlinked=true' parameter for DELETE." }, headers);
        }

        // --- Fallback for unsupported methods ---
        log.warn('Method not allowed', { method: event.httpMethod });
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return respond(405, { error: 'Method Not Allowed' }, headers);

    } catch (error) {
        timer.end({ error: true });
        log.error('Critical error in history function', { error: error.message, stack: error.stack });
        log.exit(error instanceof SyntaxError ? 400 : 500);
        // Distinguish between client errors (like bad JSON) and server errors
        if (error instanceof SyntaxError) {
            return respond(400, { error: "Invalid JSON in request body." }, headers);
        }
        return respond(500, { error: "An internal server error occurred: " + error.message }, headers);
    }
};
