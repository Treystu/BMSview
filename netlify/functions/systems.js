const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");

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

                log('debug', `Re-assigning history records from ${idsToDelete.length} systems to primary system.`, postLogContext);
                const { modifiedCount } = await historyCollection.updateMany(
                    { systemId: { $in: idsToDelete } },
                    { $set: { systemId: primarySystem.id, systemName: primarySystem.name } }
                );
                log('info', `Updated ${modifiedCount} history records during merge.`, postLogContext);

                await systemsCollection.updateOne({ id: primarySystem.id }, { $set: { associatedDLs: primarySystem.associatedDLs } });
                log('info', 'Updated primary system in store.', { ...postLogContext, systemId: primarySystem.id });

                if (idsToDelete.length > 0) {
                    await systemsCollection.deleteMany({ id: { $in: idsToDelete } });
                    log('info', 'Deleted merged systems.', { ...postLogContext, deletedCount: idsToDelete.length });
                }
                
                log('warn', 'System merge operation completed successfully.', postLogContext);
                return respond(200, { success: true });
            }

            const newSystem = { ...parsedBody, id: uuidv4(), associatedDLs: parsedBody.associatedDLs || [] };
            log('info', 'Creating new system.', { ...logContext, systemId: newSystem.id, systemName: newSystem.name });
            await systemsCollection.insertOne(newSystem);
            // Return new system without the internal _id
            const { _id, ...systemToReturn } = newSystem;
            return respond(201, systemToReturn);
        }

        if (httpMethod === 'PUT') {
            const { systemId } = queryStringParameters;
            const putLogContext = { ...logContext, systemId };
            if (!systemId) return respond(400, { error: 'System ID is required for update.' });
            
            log('info', 'Updating system.', putLogContext);
            const updateData = JSON.parse(body);
            log('debug', 'Parsed PUT body.', { ...putLogContext, body: updateData });
            const { id, ...dataToUpdate } = updateData; // Ensure `id` is not in the update payload
            
            const result = await systemsCollection.updateOne({ id: systemId }, { $set: dataToUpdate });

            if (result.matchedCount === 0) {
                return respond(404, { error: "System not found." });
            }
            
            const updatedSystem = await systemsCollection.findOne({ id: systemId }, { projection: { _id: 0 } });
            return respond(200, updatedSystem);
        }

        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });
    } catch (error) {
        log('error', 'Critical error in systems function.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};
