// @ts-nocheck
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
const { z } = require("zod");

// System validation schema
const SystemSchema = z.object({
    name: z.string().min(1, "System name is required"),
    chemistry: z.union([z.enum(["LiFePO4", "LiPo", "LiIon", "LeadAcid", "NiMH", "Other"]), z.literal(''), z.null(), z.undefined()]).optional(),
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

exports.handler = async function (event, context) {
    const headers = getCorsHeaders(event);

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('systems', event, context);
    log.entry(createStandardEntryMeta(event));
    const timer = createTimer(log, 'systems');

    // Define logContext for consistent logging throughout the function
    const clientIp = event.headers['x-nf-client-connection-ip'] || 'unknown';
    const logContext = {
        clientIp,
        httpMethod: event.httpMethod,
        path: event.path
    };

    if (!validateEnvironment(log)) {
        timer.end({ error: 'env_validation_failed' });
        log.exit(500);
        return respond(500, { error: 'Server configuration error' }, headers);
    }

    try {
        const systemsCollection = await getCollection("systems");
        const historyCollection = await getCollection("history");

        if (event.httpMethod === 'GET') {
            const { systemId, page = '1', limit = '25' } = event.queryStringParameters || {};
            if (systemId) {
                log.debug('Fetching single system by ID', { systemId });
                const system = await systemsCollection.findOne({ id: systemId }, { projection: { _id: 0 } });
                timer.end({ found: !!system });
                log.exit(system ? 200 : 404);
                return system ? respond(200, system, headers) : respond(404, { error: "System not found." }, headers);
            }

            log.debug('Fetching paginated systems', { page, limit });
            const isAll = limit === 'all';
            const pageNum = parseInt(page, 10);
            const limitNum = isAll ? 0 : parseInt(limit, 10);
            const skip = isAll ? 0 : (pageNum - 1) * limitNum;

            let query = systemsCollection.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).skip(skip);
            if (!isAll) {
                query = query.limit(limitNum);
            }

            const [systems, totalItems] = await Promise.all([
                query.toArray(),
                systemsCollection.countDocuments({})
            ]);

            timer.end({ page: pageNum, returned: systems.length, total: totalItems });
            log.info(`Returning page ${pageNum} of systems`, { ...logContext, returned: systems.length, total: totalItems });
            log.exit(200);
            return respond(200, { items: systems, totalItems }, headers);
        }

        if (event.httpMethod === 'POST') {
            const parsedBody = JSON.parse(event.body);
            // Do not log body contents (may contain user notes/PII). Safe signal only.
            log.debug('Parsed POST body', { ...logContext, bodyLength: event.body ? event.body.length : 0 });
            const { action } = parsedBody;
            const postLogContext = { ...logContext, action };

            if (action === 'merge') {
                const { primarySystemId, idsToMerge } = parsedBody;
                log.warn('Starting system merge operation', { ...postLogContext, primarySystemId, idsToMerge });

                const systemsToMerge = await systemsCollection.find({ id: { $in: idsToMerge } }).toArray();
                const primarySystem = systemsToMerge.find(s => s.id === primarySystemId);
                if (!primarySystem) {
                    timer.end({ error: 'primary_not_found' });
                    log.exit(404);
                    return respond(404, { error: "Primary system not found." }, headers);
                }

                const idsToDelete = idsToMerge.filter(id => id !== primarySystemId);
                const allDlsToMerge = systemsToMerge.flatMap(s => s.associatedDLs || []);
                primarySystem.associatedDLs = [...new Set([...(primarySystem.associatedDLs || []), ...allDlsToMerge])];

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
                const { modifiedCount } = await historyCollection.updateMany(
                    { systemId: { $in: idsToDelete } },
                    { $set: { systemId: primarySystem.id, systemName: primarySystem.name } }
                );
                log.info(`Updated ${modifiedCount} history records during merge`, { ...postLogContext, modifiedCount });

                await systemsCollection.updateOne(
                    { id: primarySystem.id },
                    { $set: { associatedDLs: primarySystem.associatedDLs, mergeMetadata } }
                );
                log.info('Updated primary system in store', { ...postLogContext, systemId: primarySystem.id });

                if (idsToDelete.length > 0) {
                    await systemsCollection.deleteMany({ id: { $in: idsToDelete } });
                    log.info('Deleted merged systems', { ...postLogContext, deletedCount: idsToDelete.length });
                }

                timer.end({ merged: true, conflicts: conflicts.length });
                log.warn('System merge operation completed successfully', postLogContext);
                log.exit(200);
                return respond(200, { success: true, conflicts: conflicts.length > 0 ? conflicts : undefined }, headers);
            }

            // Validate and create new system
            try {
                const validatedSystem = SystemSchema.parse(parsedBody);
                // Ensure backward compatibility: Sync associatedHardwareIds -> associatedDLs
                const dls = validatedSystem.associatedHardwareIds || validatedSystem.associatedDLs || [];

                const newSystem = {
                    ...validatedSystem,
                    id: uuidv4(),
                    associatedDLs: dls,
                    associatedHardwareIds: dls // Persist both or just ensure API returns both? Let's just persist usage.
                };
                // Ensure we don't have undefined fields
                if (!newSystem.associatedHardwareIds) newSystem.associatedHardwareIds = dls;

                log.info('Creating new system', { ...logContext, systemId: newSystem.id, systemName: newSystem.name });
                await systemsCollection.insertOne(newSystem);
                // Return new system without the internal _id
                const { _id, ...systemToReturn } = newSystem;
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
            const { systemId } = event.queryStringParameters || {};
            const putLogContext = { ...logContext, systemId };
            if (!systemId) {
                timer.end({ error: 'missing_systemId' });
                log.exit(400);
                return respond(400, { error: 'System ID is required for update.' }, headers);
            }

            log.info('Updating system', putLogContext);
            const updateData = JSON.parse(event.body);
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
                    validatedUpdate.associatedDLs = validatedUpdate.associatedHardwareIds;
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
            const { systemId } = event.queryStringParameters || {};

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
