// @ts-nocheck
const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.cjs");
const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
// Unified Normalizer
const { normalizeHardwareId } = require('./utils/analysis-helpers.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

function validateEnvironment(log) {
    if (!process.env.MONGODB_URI) {
        log.error('Missing MONGODB_URI environment variable');
        return false;
    }
    return true;
}
const { z } = require("zod");

// System validation schema
const SystemSchema = z.object({
    name: z.string().min(1, "System name is required"),
    chemistry: z.union([z.enum(["LiFePO4", "LiPo", "LiIon", "LeadAcid", "NiMH", "Other", "NMC", "LTO", "AGM", "Gel"]), z.literal(''), z.null(), z.undefined()]).optional(),
    voltage: z.union([z.number().positive("Voltage must be positive"), z.null(), z.undefined()]).optional(),
    capacity: z.union([z.number().positive("Capacity must be positive"), z.null(), z.undefined()]).optional(),
    latitude: z.union([z.number().min(-90).max(90), z.null(), z.undefined()]).optional(),
    longitude: z.union([z.number().min(-180).max(180), z.null(), z.undefined()]).optional(),
    associatedDLs: z.array(z.string()).optional(),
    associatedHardwareIds: z.array(z.string()).optional(), // Alias for associatedDLs
    notes: z.union([z.string(), z.null(), z.undefined()]).optional(),
    location: z.union([z.string(), z.null(), z.undefined()]).optional(),
    maxAmpsSolarCharging: z.union([z.number().nonnegative("Solar Max Amps must be non-negative"), z.null(), z.undefined()]).optional(),
    maxAmpsGeneratorCharging: z.union([z.number().nonnegative("Generator Max Amps must be non-negative"), z.null(), z.undefined()]).optional()
});

const respond = (statusCode, body, headers = {}) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
});

/**
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async function (event, context) {
    const headers = getCorsHeaders(event);

    const rawPath = event.path || '';
    const basePath = '/.netlify/functions/systems';
    const subPath = rawPath.startsWith(basePath) ? rawPath.slice(basePath.length) : '';
    const subParts = subPath.split('/').filter(Boolean);
    const isMergePath = subParts.length === 1 && subParts[0] === 'merge';
    const isAssociateHardwarePath = subParts.length === 1 && subParts[0] === 'associate-hardware';
    const pathSystemId = subParts.length >= 1 && !['merge', 'associate-hardware'].includes(subParts[0]) ? subParts[0] : null;
    const isMergedTimelinePath = subParts.length === 2 && subParts[1] === 'merged-timeline' && !!pathSystemId;

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('systems', event, context);
    log.entry(createStandardEntryMeta(event));

    // Unified logging: also forward to centralized collector
    const forwardLog = createForwardingLogger('systems');

    const timer = createTimer(log, 'systems');

    // Define logContext for consistent logging throughout the function
    const clientIp = event.headers['x-nf-client-connection-ip'] || 'unknown';
    const logContext = {
        clientIp,
        httpMethod: event.httpMethod,
        path: event.path,
        queryStringParameters: event.queryStringParameters || {}
    };

    log.debug('Systems function invoked', logContext);

    if (!validateEnvironment(log)) {
        timer.end({ error: 'env_validation_failed' });
        log.exit(500);
        return respond(500, { error: 'Server configuration error' }, headers);
    }

    try {
        log.debug('Connecting to MongoDB collections');
        const systemsCollection = await getCollection("systems");
        const historyCollection = await getCollection("history");
        log.debug('MongoDB collections connected', { systemsCollection: 'systems', historyCollection: 'history' });

        if (event.httpMethod === 'GET') {
            const { systemId: qsSystemId, page = '1', limit = '25', startDate: qsStartDate, endDate: qsEndDate, downsample: qsDownsample, maxPoints: qsMaxPoints } = event.queryStringParameters || {};
            const systemId = qsSystemId || pathSystemId || undefined;
            log.debug('GET request - parsing query parameters', { systemId, page, limit });

            if (isMergedTimelinePath) {
                const now = new Date();
                const endDate = qsEndDate || now.toISOString();
                const startDate = qsStartDate || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const downsample = qsDownsample === 'true';
                const maxPoints = qsMaxPoints ? parseInt(qsMaxPoints, 10) : 2000;

                try {
                    const { mergeBmsAndCloudData, downsampleMergedData } = require('./utils/data-merge.cjs');
                    let mergedData = await mergeBmsAndCloudData(systemId, startDate, endDate, log);
                    if (downsample) {
                        mergedData = downsampleMergedData(mergedData, Number.isFinite(maxPoints) ? maxPoints : 2000, log);
                    }

                    timer.end({ mergedTimeline: true, dataPoints: mergedData.length });
                    log.exit(200);
                    return respond(200, {
                        systemId,
                        startDate,
                        endDate,
                        totalPoints: mergedData.length,
                        downsampled: downsample,
                        data: mergedData
                    }, headers);
                } catch (err) {
                    const e = err instanceof Error ? err : new Error(String(err));
                    log.error('Failed to fetch merged timeline data', { error: e.message, stack: e.stack });
                    timer.end({ error: 'merged_timeline_failed' });
                    log.exit(500);
                    return respond(500, { error: 'Failed to fetch merged timeline data', details: e.message }, headers);
                }
            }

            if (systemId) {
                log.debug('Fetching single system by ID', { systemId });
                const system = await systemsCollection.findOne({ id: systemId }, { projection: { _id: 0 } });
                log.debug('Single system lookup complete', { systemId, found: !!system });
                timer.end({ found: !!system });
                log.exit(system ? 200 : 404);
                return system ? respond(200, system, headers) : respond(404, { error: "System not found." }, headers);
            }

            log.debug('Fetching paginated systems', { page, limit });
            const isAll = limit === 'all';
            const pageNum = parseInt(page, 10);
            const limitNum = isAll ? 0 : parseInt(limit, 10);
            const skip = isAll ? 0 : (pageNum - 1) * limitNum;

            log.debug('Building MongoDB query', { isAll, pageNum, limitNum, skip });
            let query = systemsCollection.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).skip(skip);
            if (!isAll) {
                query = query.limit(limitNum);
            }

            log.debug('Executing database queries in parallel');
            let systems, totalItems;
            try {
                [systems, totalItems] = await Promise.all([
                    query.toArray().catch(err => {
                        log.error('Failed to fetch systems array', { error: err.message, stack: err.stack });
                        throw new Error(`Database query failed: ${err.message}`);
                    }),
                    systemsCollection.countDocuments({}).catch(err => {
                        log.error('Failed to count documents', { error: err.message, stack: err.stack });
                        throw new Error(`Database count failed: ${err.message}`);
                    })
                ]);
            } catch (parallelError) {
                log.error('Parallel database operations failed', { error: parallelError.message });
                throw new Error(`Failed to retrieve systems: ${parallelError.message}`);
            }
            log.debug('Database queries complete', { returned: systems.length, total: totalItems });

            timer.end({ page: pageNum, returned: systems.length, total: totalItems });
            log.info(`Returning page ${pageNum} of systems`, { ...logContext, returned: systems.length, total: totalItems });
            log.exit(200);
            return respond(200, { items: systems, totalItems }, headers);
        }

        if (event.httpMethod === 'POST') {
            log.debug('POST request received', logContext);
            let parsedBody;
            try {
                if (!event.body) {
                    throw new Error('Request body is empty');
                }
                parsedBody = JSON.parse(event.body);
            } catch (parseError) {
                log.error('Failed to parse POST request body', { ...logContext, error: parseError.message });
                timer.end({ error: 'invalid_json' });
                log.exit(400);
                return respond(400, { error: 'Invalid JSON in request body', details: parseError.message }, headers);
            }
            log.debug('Parsing POST body', { ...logContext, bodyLength: event.body ? event.body.length : 0 });

            if (isMergePath && !parsedBody.action) {
                parsedBody.action = 'merge';
            }
            if (isAssociateHardwarePath && !parsedBody.action) {
                parsedBody.action = 'associate-hardware';
            }
            if (!parsedBody.action && parsedBody.primarySystemId && Array.isArray(parsedBody.idsToMerge)) {
                parsedBody.action = 'merge';
            }

            const { action, ...otherProps } = parsedBody;
            const postLogContext = { ...logContext, action, fieldsProvided: Object.keys(otherProps) };

            if (action === 'merge') {
                log.debug('POST action: merge', postLogContext);
                const { primarySystemId, idsToMerge } = parsedBody;
                log.info('Starting system merge operation', { ...postLogContext, primarySystemId, idsToMergeCount: idsToMerge?.length });

                const systemsToMerge = await systemsCollection.find({ id: { $in: idsToMerge } }).toArray();
                const primarySystem = systemsToMerge.find(s => s.id === primarySystemId);
                if (!primarySystem) {
                    timer.end({ error: 'primary_not_found' });
                    log.exit(404);
                    return respond(404, { error: "Primary system not found." }, headers);
                }

                const idsToDelete = idsToMerge.filter(id => id !== primarySystemId);
                // UNIFIED: Merge all hardware IDs from both fields (associatedHardwareIds is source of truth)
                const allHardwareIdsToMerge = systemsToMerge.flatMap(s => s.associatedHardwareIds || s.associatedDLs || []);
                // Normalize during merge
                const mergedHardwareIds = [...new Set([...(primarySystem.associatedHardwareIds || primarySystem.associatedDLs || []), ...allHardwareIdsToMerge])]
                    .map(id => normalizeHardwareId(id))
                    .filter(id => id && id !== 'UNKNOWN');

                primarySystem.associatedHardwareIds = mergedHardwareIds;
                primarySystem.associatedDLs = mergedHardwareIds; // Keep in sync for backward compat

                // Check for conflicting chemistry/voltage and record metadata
                const conflicts = [];
                const mergedSystems = systemsToMerge.filter(s => s.id !== primarySystemId);
                mergedSystems.forEach(system => {
                    if (system.chemistry && primarySystem.chemistry && system.chemistry !== primarySystem.chemistry) {
                        conflicts.push({ field: 'chemistry', primary: primarySystem.chemistry, conflicting: system.chemistry, systemId: system.id });
                    }
                    if (system.voltage && primarySystem.voltage && Math.abs(system.voltage - primarySystem.voltage) > 0.1) {
                        conflicts.push({ field: 'voltage', primary: primarySystem.voltage, conflicting: system.voltage, systemId: system.id });
                    }
                });

                if (conflicts.length > 0) {
                    log.warn('Detected conflicts during merge operation', { ...postLogContext, conflicts });
                }

                const mergeMetadata = {
                    mergedAt: new Date().toISOString(),
                    mergedSystemIds: idsToDelete,
                    conflicts: conflicts.length > 0 ? conflicts : undefined
                };

                log.debug(`Re-assigning history records from ${idsToDelete.length} systems to primary system`, postLogContext);
                log.debug('Executing history collection updateMany operation');

                let modifiedCount = 0;
                try {
                    const updateResult = await historyCollection.updateMany(
                        { systemId: { $in: idsToDelete } },
                        { $set: { systemId: primarySystem.id, systemName: primarySystem.name } }
                    );
                    modifiedCount = updateResult.modifiedCount || 0;
                    log.debug('History collection update complete', { modifiedCount });
                    log.info(`Updated ${modifiedCount} history records during merge`, { ...postLogContext, modifiedCount });
                } catch (historyUpdateError) {
                    log.error('Failed to update history records during merge', {
                        ...postLogContext,
                        error: historyUpdateError.message,
                        stack: historyUpdateError.stack
                    });
                    timer.end({ error: 'history_update_failed' });
                    log.exit(500);
                    return respond(500, {
                        error: 'Failed to update history records during system merge',
                        details: historyUpdateError.message
                    }, headers);
                }

                try {
                    await systemsCollection.updateOne(
                        { id: primarySystem.id },
                        { $set: { associatedHardwareIds: primarySystem.associatedHardwareIds, associatedDLs: primarySystem.associatedDLs, mergeMetadata } }
                    );
                    log.info('Updated primary system in store', { ...postLogContext, systemId: primarySystem.id });
                } catch (primaryUpdateError) {
                    log.error('Failed to update primary system during merge', {
                        ...postLogContext,
                        error: primaryUpdateError.message,
                        stack: primaryUpdateError.stack
                    });
                    timer.end({ error: 'primary_update_failed' });
                    log.exit(500);
                    return respond(500, {
                        error: 'Failed to update primary system during merge',
                        details: primaryUpdateError.message
                    }, headers);
                }

                if (idsToDelete.length > 0) {
                    try {
                        await systemsCollection.deleteMany({ id: { $in: idsToDelete } });
                        log.info('Deleted merged systems', { ...postLogContext, deletedCount: idsToDelete.length });
                    } catch (deleteError) {
                        log.error('Failed to delete merged systems', {
                            ...postLogContext,
                            error: deleteError.message,
                            stack: deleteError.stack
                        });
                        // Log but don't fail - the merge is already complete
                        log.warn('Merge completed but failed to clean up merged systems', {
                            ...postLogContext,
                            idsToDelete
                        });
                    }
                }

                timer.end({ merged: true, conflicts: conflicts.length });
                log.warn('System merge operation completed successfully', postLogContext);
                log.exit(200);
                return respond(200, { success: true, conflicts: conflicts.length > 0 ? conflicts : undefined }, headers);
            }

            if (action === 'associate-hardware') {
                const { systemId, hardwareId } = parsedBody;
                if (!systemId || !hardwareId) {
                    timer.end({ error: 'missing_params' });
                    log.exit(400);
                    return respond(400, { error: 'systemId and hardwareId are required' }, headers);
                }

                const normalizedId = normalizeHardwareId(hardwareId);
                if (!normalizedId || normalizedId === 'UNKNOWN') {
                    timer.end({ error: 'invalid_hardware_id' });
                    log.exit(400);
                    return respond(400, { error: 'Invalid hardwareId' }, headers);
                }

                const system = await systemsCollection.findOne({ id: systemId }, { projection: { _id: 0 } });
                if (!system) {
                    timer.end({ error: 'not_found' });
                    log.exit(404);
                    return respond(404, { error: 'System not found.' }, headers);
                }

                const existingIds = Array.isArray(system.associatedHardwareIds)
                    ? system.associatedHardwareIds
                    : (Array.isArray(system.associatedDLs) ? system.associatedDLs : []);
                const updatedIds = [...new Set([...existingIds, normalizedId])];
                const added = updatedIds.length !== existingIds.length;

                await systemsCollection.updateOne(
                    { id: systemId },
                    { $set: { associatedHardwareIds: updatedIds, associatedDLs: updatedIds } }
                );

                timer.end({ associated: true, added });
                log.exit(200);
                return respond(200, { success: true, systemId, hardwareId: normalizedId, added }, headers);
            }

            // Validate and create new system
            try {
                const validatedSystem = SystemSchema.parse(parsedBody);
                // Ensure backward compatibility: Sync associatedHardwareIds -> associatedDLs
                let dls = validatedSystem.associatedHardwareIds || validatedSystem.associatedDLs || [];

                // UNIFIED: Normalize incoming IDs immediately
                dls = dls.map(id => normalizeHardwareId(id)).filter(id => id && id !== 'UNKNOWN');

                const newSystem = {
                    ...validatedSystem,
                    id: uuidv4(),
                    associatedDLs: dls,
                    associatedHardwareIds: dls // Persist both or just ensure API returns both? Let's just persist usage.
                };
                // Ensure we don't have undefined fields
                if (!newSystem.associatedHardwareIds) newSystem.associatedHardwareIds = dls;

                log.debug('Preparing new system record for insertion', { systemId: newSystem.id, systemName: newSystem.name });
                log.debug('Executing systems collection insertOne operation');
                await systemsCollection.insertOne(newSystem);
                log.debug('Systems collection insert complete', { systemId: newSystem.id });
                // Return new system without the internal _id
                const { _id, ...systemToReturn } = newSystem;
                log.info('New system created successfully', { ...logContext, systemId: newSystem.id, systemName: newSystem.name });
                timer.end({ created: true, systemId: newSystem.id });
                log.exit(201);
                return respond(201, systemToReturn, headers);
            } catch (validationError) {
                if (validationError.errors) {
                    log.warn('System validation failed', { ...logContext, errors: validationError.errors });
                    timer.end({ error: 'validation_failed' });
                    log.exit(400);
                    return respond(400, {
                        error: 'Validation failed',
                        details: validationError.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
                    }, headers);
                }
                throw validationError;
            }
        }

        if (event.httpMethod === 'PUT') {
            const { systemId: qsSystemId } = event.queryStringParameters || {};
            const systemId = qsSystemId || pathSystemId;
            const putLogContext = { ...logContext, systemId };
            if (!systemId) {
                timer.end({ error: 'missing_systemId' });
                log.exit(400);
                return respond(400, { error: 'System ID is required for update.' }, headers);
            }

            log.info('Updating system', putLogContext);
            let updateData;
            try {
                if (!event.body) {
                    throw new Error('Request body is empty');
                }
                updateData = JSON.parse(event.body);
            } catch (parseError) {
                log.error('Failed to parse PUT request body', { ...putLogContext, error: parseError.message });
                timer.end({ error: 'invalid_json' });
                log.exit(400);
                return respond(400, { error: 'Invalid JSON in request body', details: parseError.message }, headers);
            }
            const { id, ...dataToUpdate } = updateData;
            log.info('System update request', { ...logContext, fieldsToUpdate: Object.keys(dataToUpdate) });

            log.debug('Parsed PUT body', { ...putLogContext, bodyPreview: JSON.stringify(updateData).substring(0, 100) });

            // Validate update data
            try {
                const { id, ...dataToUpdate } = updateData; // Ensure `id` is not in the update payload
                const validatedUpdate = SystemSchema.partial().parse(dataToUpdate);

                // Handle aliasing for updates
                if (validatedUpdate.associatedHardwareIds && !validatedUpdate.associatedDLs) {
                    validatedUpdate.associatedDLs = validatedUpdate.associatedHardwareIds;
                } else if (validatedUpdate.associatedDLs && !validatedUpdate.associatedHardwareIds) {
                    validatedUpdate.associatedHardwareIds = validatedUpdate.associatedDLs;
                }
                // If both provided, prefer hardwareIds? Or assume they match? Let's sync them.
                if (validatedUpdate.associatedHardwareIds) {
                    // UNIFIED: Normalize on update
                    const normIds = validatedUpdate.associatedHardwareIds
                        .map(hid => normalizeHardwareId(hid))
                        .filter(hid => hid && hid !== 'UNKNOWN');

                    validatedUpdate.associatedHardwareIds = normIds;
                    validatedUpdate.associatedDLs = normIds;
                }

                const result = await systemsCollection.updateOne({ id: systemId }, { $set: validatedUpdate });

                if (result.matchedCount === 0) {
                    timer.end({ error: 'not_found' });
                    log.exit(404);
                    return respond(404, { error: "System not found." }, headers);
                }

                const updatedSystem = await systemsCollection.findOne({ id: systemId }, { projection: { _id: 0 } });
                timer.end({ updated: true, systemId });
                log.exit(200);
                return respond(200, updatedSystem, headers);
            } catch (validationError) {
                if (validationError.errors) {
                    log.warn('System update validation failed', { ...putLogContext, errors: validationError.errors });
                    timer.end({ error: 'validation_failed' });
                    log.exit(400);
                    return respond(400, {
                        error: 'Validation failed',
                        details: validationError.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
                    }, headers);
                }
                throw validationError;
            }
        }

        if (event.httpMethod === 'DELETE') {
            const { systemId: qsSystemId } = event.queryStringParameters || {};
            const systemId = qsSystemId || pathSystemId;

            if (!systemId) {
                log.warn('System ID missing for deletion');
                timer.end({ error: 'missing_systemId' });
                log.exit(400);
                return respond(400, { error: 'System ID is required for deletion.' }, headers);
            }

            log.info('Attempting to delete system', { systemId });

            // Check if system has linked records
            const linkedCount = await historyCollection.countDocuments({ systemId });

            if (linkedCount > 0) {
                log.warn('Cannot delete system with linked records', { systemId, linkedCount });
                timer.end({ error: 'has_linked_records' });
                log.exit(400);
                return respond(400, {
                    error: `Cannot delete system with ${linkedCount} linked records. Please unlink or delete the records first.`
                }, headers);
            }

            const result = await systemsCollection.deleteOne({ id: systemId });

            if (result.deletedCount === 0) {
                log.info('System not found for deletion, treating as success', { systemId });
                timer.end({ found: false, deleted: false });
            } else {
                timer.end({ deleted: true });
                log.info('System deleted successfully', { systemId });
            }

            log.exit(200);
            return respond(200, { success: true, message: 'System deleted successfully.', deleted: result.deletedCount > 0 }, headers);
        }

        log.warn('Method not allowed', { method: event.httpMethod });
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return respond(405, { error: 'Method Not Allowed' }, headers);
    } catch (error) {
        timer.end({ error: true });
        log.error('Critical error in systems function', { error: error.message, stack: error.stack });
        log.exit(500);
        return respond(500, { error: "An internal server error occurred: " + error.message }, headers);
    }
};
