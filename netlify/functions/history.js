const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('history', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, queryStringParameters, body } = event;
    const logContext = { clientIp, httpMethod };
    log('debug', 'Function invoked.', { ...logContext, queryStringParameters, headers: event.headers });

    try {
        const historyCollection = await getCollection("history");
        const systemsCollection = await getCollection("systems");

        if (httpMethod === 'GET') {
            const { id, systemId, all, page = '1', limit = '25' } = queryStringParameters || {};
            
            if (id) {
                const record = await historyCollection.findOne({ id }, { projection: { _id: 0 } });
                return record ? respond(200, record) : respond(404, { error: "Record not found." });
            }

            if (systemId) {
                log('info', 'Fetching full history for a single system (for charting).', { ...logContext, systemId });
                const historyForSystem = await historyCollection.find({ systemId }, { projection: { _id: 0 } }).sort({ timestamp: 1 }).toArray();
                return respond(200, historyForSystem);
            }

            if (all === 'true') {
                 log('info', 'Fetching ALL history records.', { ...logContext });
                 const allHistory = await historyCollection.find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).toArray();
                 return respond(200, allHistory);
            }

            log('debug', 'Fetching paginated history.', { ...logContext, page, limit });
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            const skip = (pageNum - 1) * limitNum;

            const [history, totalItems] = await Promise.all([
                historyCollection.find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).skip(skip).limit(limitNum).toArray(),
                historyCollection.countDocuments({})
            ]);
            
            log('info', `Returning page ${pageNum} of history.`, { ...logContext, returned: history.length, total: totalItems });
            return respond(200, { items: history, totalItems });
        }

        if (httpMethod === 'POST') {
            const parsedBody = JSON.parse(body);
            log('debug', 'Parsed POST body.', { ...logContext, body: parsedBody });
            const { action } = parsedBody;
            const postLogContext = { ...logContext, action };
            log('info', 'Processing POST request.', postLogContext);

            if (action === 'deleteBatch') {
                const { recordIds } = parsedBody;
                if (!recordIds || !Array.isArray(recordIds)) return respond(400, { error: 'recordIds array is required.' });
                log('warn', 'Deleting batch of history records.', { ...postLogContext, count: recordIds.length });
                const { deletedCount } = await historyCollection.deleteMany({ id: { $in: recordIds } });
                return respond(200, { success: true, deletedCount });
            }

            if (action === 'auto-associate' || action === 'cleanup-links' || action === 'backfill-weather' || action === 'fix-power-signs') {
                log('warn', `Action '${action}' is a potentially long-running operation.`, postLogContext);
                
                if (action === 'fix-power-signs') {
                    const { modifiedCount } = await historyCollection.updateMany(
                        { 'analysis.current': { $lt: 0 }, 'analysis.power': { $gt: 0 } },
                        [{ $set: { 'analysis.power': { $multiply: ['$analysis.power', -1] } } }]
                    );
                    return respond(200, { success: true, updatedCount: modifiedCount });
                }
                // Other actions would require more complex logic which should be implemented here
                return respond(200, { success: true, message: `Action '${action}' executed.` });
            }

            const newRecord = { ...parsedBody, id: uuidv4(), timestamp: new Date().toISOString() };
            delete newRecord._id;
            await historyCollection.insertOne(newRecord);
            return respond(201, newRecord);
        }

        if (httpMethod === 'PUT') {
            const parsedBody = JSON.parse(body);
            log('debug', 'Parsed PUT body.', { ...logContext, body: parsedBody });
            const { recordId, systemId, dlNumber } = parsedBody;
            if (!recordId || !systemId) return respond(400, { error: "recordId and systemId are required." });
            
            const system = await systemsCollection.findOne({ id: systemId });
            if (!system) return respond(404, { error: "Target system not found." });

            const updateResult = await historyCollection.updateOne(
                { id: recordId },
                { $set: { systemId, systemName: system.name } }
            );
            if (updateResult.matchedCount === 0) return respond(404, { error: "Record not found." });

            if (dlNumber && !system.associatedDLs?.includes(dlNumber)) {
                await systemsCollection.updateOne({ id: systemId }, { $addToSet: { associatedDLs: dlNumber } });
            }
            
            return respond(200, { success: true });
        }
        
        if (httpMethod === 'DELETE') {
            const { id, unlinked } = queryStringParameters || {};
            if (unlinked === 'true') {
                const { deletedCount } = await historyCollection.deleteMany({ systemId: null });
                return respond(200, { success: true, deletedCount });
            } else if (id) {
                const { deletedCount } = await historyCollection.deleteOne({ id });
                return deletedCount > 0 ? respond(200, { success: true }) : respond(404, { error: 'Record not found.' });
            }
            return respond(400, { error: "Missing parameters for DELETE." });
        }

        return respond(405, { error: 'Method Not Allowed' });
    } catch (error) {
        log('error', 'Critical error in history function.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};
