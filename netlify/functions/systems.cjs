const { v4: uuidv4 } = require("uuid");
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
const { z } = require("zod");

// System validation schema
const SystemSchema = z.object({
  name: z.string().min(1, "System name is required"),
  chemistry: z.enum(["LiFePO4", "LiPo", "LiIon", "LeadAcid", "NiMH", "Other"]).optional(),
  voltage: z.number().positive("Voltage must be positive").optional(),
  capacity: z.number().positive("Capacity must be positive").optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  associatedDLs: z.array(z.string()).optional(),
  notes: z.string().optional(),
  location: z.string().optional()
});

const respond = (statusCode, body, headers = {}) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
});

exports.handler = async function(event, context) {
    const headers = getCorsHeaders(event);
    
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }
    
    const log = createLoggerFromEvent('systems', event, context);
    log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });
    const timer = createTimer(log, 'systems');
    
    if (!validateEnvironment(log)) {
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
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            const skip = (pageNum - 1) * limitNum;

            const [systems, totalItems] = await Promise.all([
                systemsCollection.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).skip(skip).limit(limitNum).toArray(),
                systemsCollection.countDocuments({})
            ]);
            
            log('info', `Returning page ${pageNum} of systems.`, { ...logContext, returned: systems.length, total: totalItems });
            return respond(200, { items: systems, totalItems });
        }

        if (httpMethod === 'POST') {
            const parsedBody = JSON.parse(body);
            log('debug', 'Parsed POST body.', { ...logContext, body: parsedBody });
            const { action } = parsedBody;
            const postLogContext = { ...logContext, action };

            if (action === 'merge') {
                const { primarySystemId, idsToMerge } = parsedBody;
                log('warn', 'Starting system merge operation.', { ...postLogContext, primarySystemId, idsToMerge });
                
                const systemsToMerge = await systemsCollection.find({ id: { $in: idsToMerge } }).toArray();
                const primarySystem = systemsToMerge.find(s => s.id === primarySystemId);
                if (!primarySystem) return respond(404, { error: "Primary system not found." });

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
                    log('warn', 'Detected conflicts during merge operation.', { ...postLogContext, conflicts });
                }

                const mergeMetadata = {
                    mergedAt: new Date().toISOString(),
                    mergedSystemIds: idsToDelete,
                    conflicts: conflicts.length > 0 ? conflicts : undefined
                };

                log('debug', `Re-assigning history records from ${idsToDelete.length} systems to primary system.`, postLogContext);
                const { modifiedCount } = await historyCollection.updateMany(
                    { systemId: { $in: idsToDelete } },
                    { $set: { systemId: primarySystem.id, systemName: primarySystem.name } }
                );
                log('info', `Updated ${modifiedCount} history records during merge.`, postLogContext);

                await systemsCollection.updateOne(
                    { id: primarySystem.id }, 
                    { $set: { associatedDLs: primarySystem.associatedDLs, mergeMetadata } }
                );
                log('info', 'Updated primary system in store.', { ...postLogContext, systemId: primarySystem.id });

                if (idsToDelete.length > 0) {
                    await systemsCollection.deleteMany({ id: { $in: idsToDelete } });
                    log('info', 'Deleted merged systems.', { ...postLogContext, deletedCount: idsToDelete.length });
                }
                
                log('warn', 'System merge operation completed successfully.', postLogContext);
                return respond(200, { success: true, conflicts: conflicts.length > 0 ? conflicts : undefined });
            }

            // Validate and create new system
            try {
                const validatedSystem = SystemSchema.parse(parsedBody);
                const newSystem = { ...validatedSystem, id: uuidv4(), associatedDLs: validatedSystem.associatedDLs || [] };
                log('info', 'Creating new system.', { ...logContext, systemId: newSystem.id, systemName: newSystem.name });
                await systemsCollection.insertOne(newSystem);
                // Return new system without the internal _id
                const { _id, ...systemToReturn } = newSystem;
                return respond(201, systemToReturn);
            } catch (validationError) {
                if (validationError.errors) {
                    log('warn', 'System validation failed.', { ...logContext, errors: validationError.errors });
                    return respond(400, { 
                        error: 'Validation failed', 
                        details: validationError.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
                    });
                }
                throw validationError;
            }
        }

        if (httpMethod === 'PUT') {
            const { systemId } = queryStringParameters;
            const putLogContext = { ...logContext, systemId };
            if (!systemId) return respond(400, { error: 'System ID is required for update.' });
            
            log('info', 'Updating system.', putLogContext);
            const updateData = JSON.parse(body);
            log('debug', 'Parsed PUT body.', { ...putLogContext, body: updateData });
            
            // Validate update data
            try {
                const { id, ...dataToUpdate } = updateData; // Ensure `id` is not in the update payload
                const validatedUpdate = SystemSchema.partial().parse(dataToUpdate);
                
                const result = await systemsCollection.updateOne({ id: systemId }, { $set: validatedUpdate });

                if (result.matchedCount === 0) {
                    return respond(404, { error: "System not found." });
                }
                
                const updatedSystem = await systemsCollection.findOne({ id: systemId }, { projection: { _id: 0 } });
                return respond(200, updatedSystem);
            } catch (validationError) {
                if (validationError.errors) {
                    log('warn', 'System update validation failed.', { ...putLogContext, errors: validationError.errors });
                    return respond(400, { 
                        error: 'Validation failed', 
                        details: validationError.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
                    });
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
                log.warn('System not found for deletion', { systemId });
                timer.end({ found: false });
                log.exit(404);
                return respond(404, { error: 'System not found.' }, headers);
            }
            
            timer.end({ deleted: true });
            log.info('System deleted successfully', { systemId });
            log.exit(200);
            return respond(200, { success: true, message: 'System deleted successfully.' }, headers);
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
