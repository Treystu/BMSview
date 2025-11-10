const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");
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

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('systems', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, queryStringParameters, body } = event;
    const logContext = { clientIp, httpMethod };
    log('info', 'Systems function invoked.', { ...logContext, queryStringParameters, path: event.path });
    
    try {
        const systemsCollection = await getCollection("systems");
        const historyCollection = await getCollection("history");

        if (httpMethod === 'GET') {
            const { systemId, page = '1', limit = '25' } = queryStringParameters || {};
            if (systemId) {
                log('debug', 'Fetching single system by ID.', { ...logContext, systemId });
                const system = await systemsCollection.findOne({ id: systemId }, { projection: { _id: 0 } });
                return system ? respond(200, system) : respond(404, { error: "System not found." });
            }
            
            log('debug', 'Fetching paginated systems.', { ...logContext, page, limit });
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

        if (httpMethod === 'DELETE') {
            const { systemId } = queryStringParameters || {};
            const deleteLogContext = { ...logContext, systemId };
            
            if (!systemId) {
                return respond(400, { error: 'System ID is required for deletion.' });
            }
            
            log('info', 'Attempting to delete system.', deleteLogContext);
            
            // Check if system has linked records
            const linkedCount = await historyCollection.countDocuments({ systemId });
            
            if (linkedCount > 0) {
                log('warn', 'Cannot delete system with linked records.', { ...deleteLogContext, linkedCount });
                return respond(400, { 
                    error: `Cannot delete system with ${linkedCount} linked records. Please unlink or delete the records first.` 
                });
            }
            
            const result = await systemsCollection.deleteOne({ id: systemId });
            
            if (result.deletedCount === 0) {
                log('warn', 'System not found for deletion.', deleteLogContext);
                return respond(404, { error: 'System not found.' });
            }
            
            log('info', 'System deleted successfully.', deleteLogContext);
            return respond(200, { success: true, message: 'System deleted successfully.' });
        }

        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });
    } catch (error) {
        log('error', 'Critical error in systems function.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};
