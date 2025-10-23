const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");
const { ObjectId } = require('mongodb'); // Needed for BulkWrite operations

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

// Helper function to call the weather Netlify function
const callWeatherFunction = async (lat, lon, timestamp, log) => {
    const weatherUrl = `${process.env.URL}/.netlify/functions/weather`;
    const logContext = { lat, lon, timestamp, weatherUrl };
    log('debug', 'Calling weather function.', logContext);
    try {
        const response = await fetch(weatherUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lon, timestamp }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            log('warn', 'Weather function call failed.', { ...logContext, status: response.status, errorBody });
            return null;
        }
        const data = await response.json();
        log('debug', 'Weather function call successful.', logContext);
        return data;
    } catch (error) {
        log('error', 'Error calling weather function.', { ...logContext, errorMessage: error.message });
        return null;
    }
};


exports.handler = async function(event, context) {
    const log = createLogger('history', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, queryStringParameters, body } = event;
    const logContext = { clientIp, httpMethod };
    log('debug', 'Function invoked.', { ...logContext, queryStringParameters, headers: event.headers });

    try {
        const historyCollection = await getCollection("history");
        const systemsCollection = await getCollection("systems");

        // --- GET Request Handler ---
        if (httpMethod === 'GET') {
            const { id, systemId, all, page = '1', limit = '25' } = queryStringParameters || {};

            if (id) {
                // Fetch single record by ID
                const record = await historyCollection.findOne({ id }, { projection: { _id: 0 } });
                return record ? respond(200, record) : respond(404, { error: "Record not found." });
            }

            if (systemId) {
                // Fetch all history for a specific system (used for charting)
                log('info', 'Fetching full history for a single system.', { ...logContext, systemId });
                const historyForSystem = await historyCollection.find({ systemId }, { projection: { _id: 0 } }).sort({ timestamp: 1 }).toArray();
                return respond(200, historyForSystem);
            }

            if (all === 'true') {
                 // Fetch ALL history records (used for cache building, potentially large)
                 log('info', 'Fetching ALL history records.', { ...logContext });
                 const allHistory = await historyCollection.find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).toArray();
                 return respond(200, allHistory);
            }

            // Fetch paginated history (default)
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

        // --- POST Request Handler ---
        if (httpMethod === 'POST') {
            const parsedBody = JSON.parse(body);
            log('debug', 'Parsed POST body.', { ...logContext, bodyPreview: JSON.stringify(parsedBody).substring(0, 100) });
            const { action } = parsedBody;
            const postLogContext = { ...logContext, action };
            log('info', 'Processing POST request.', postLogContext);

            // --- Batch Delete Action ---
            if (action === 'deleteBatch') {
                const { recordIds } = parsedBody;
                if (!recordIds || !Array.isArray(recordIds)) return respond(400, { error: 'recordIds array is required.' });
                log('warn', 'Deleting batch of history records.', { ...postLogContext, count: recordIds.length });
                const { deletedCount } = await historyCollection.deleteMany({ id: { $in: recordIds } });
                return respond(200, { success: true, deletedCount });
            }

            // --- Fix Power Signs Action ---
            if (action === 'fix-power-signs') {
                log('info', 'Starting fix-power-signs task.', postLogContext);
                const filter = {
                    'analysis.current': { $lt: 0 }, // Current is negative (discharge)
                    'analysis.power': { $gt: 0 }    // Power is positive (incorrect)
                };
                const updatePipeline = [
                    { $set: { 'analysis.power': { $multiply: ['$analysis.power', -1] } } }
                ];
                const { modifiedCount } = await historyCollection.updateMany(filter, updatePipeline);
                log('info', 'Fix-power-signs task complete.', { ...postLogContext, updatedCount: modifiedCount });
                return respond(200, { success: true, updatedCount: modifiedCount });
            }

            // --- Auto-Associate Action ---
            if (action === 'auto-associate') {
                log('info', 'Starting auto-association task.', postLogContext);
                const systems = await systemsCollection.find({}, { projection: { _id: 0, id: 1, name: 1, associatedDLs: 1 } }).toArray();
                const dlMap = new Map(); // Map DL number -> array of system IDs
                systems.forEach(s => {
                    (s.associatedDLs || []).forEach(dl => {
                        if (dl) { // Ensure dl is not null or empty
                            if (!dlMap.has(dl)) dlMap.set(dl, []);
                            dlMap.get(dl).push({ id: s.id, name: s.name });
                        }
                    });
                });

                const unlinkedCursor = historyCollection.find({ systemId: null, dlNumber: { $exists: true, $ne: null, $ne: '' } });
                let associatedCount = 0;
                const bulkOps = [];

                for await (const record of unlinkedCursor) {
                    const potentialSystems = dlMap.get(record.dlNumber);
                    // Only associate if exactly one system matches the DL number
                    if (potentialSystems && potentialSystems.length === 1) {
                        const system = potentialSystems[0];
                        bulkOps.push({
                            updateOne: {
                                filter: { _id: record._id }, // Use _id for bulk ops
                                update: { $set: { systemId: system.id, systemName: system.name } }
                            }
                        });
                        associatedCount++;
                        if (bulkOps.length >= 500) { // Process in batches
                            await historyCollection.bulkWrite(bulkOps, { ordered: false });
                            bulkOps.length = 0; // Clear the array
                            log('debug', 'Processed auto-associate batch.', { ...postLogContext, count: 500 });
                        }
                    }
                }

                if (bulkOps.length > 0) {
                    await historyCollection.bulkWrite(bulkOps, { ordered: false });
                }
                log('info', 'Auto-association task complete.', { ...postLogContext, associatedCount });
                return respond(200, { success: true, associatedCount });
            }

            // --- Cleanup Links Action ---
            if (action === 'cleanup-links') {
                log('info', 'Starting cleanup-links task.', postLogContext);
                const allSystemIds = new Set(await systemsCollection.distinct('id'));
                const linkedCursor = historyCollection.find({ systemId: { $exists: true, $ne: null } });
                let updatedCount = 0;
                const bulkOps = [];

                for await (const record of linkedCursor) {
                    if (!allSystemIds.has(record.systemId)) {
                        bulkOps.push({
                            updateOne: {
                                filter: { _id: record._id },
                                update: { $set: { systemId: null, systemName: null } }
                            }
                        });
                        updatedCount++;
                         if (bulkOps.length >= 500) {
                            await historyCollection.bulkWrite(bulkOps, { ordered: false });
                            bulkOps.length = 0;
                            log('debug', 'Processed cleanup-links batch.', { ...postLogContext, count: 500 });
                        }
                    }
                }
                 if (bulkOps.length > 0) {
                    await historyCollection.bulkWrite(bulkOps, { ordered: false });
                }
                log('info', 'Cleanup-links task complete.', { ...postLogContext, updatedCount });
                return respond(200, { success: true, updatedCount });
            }

            if (action === 'count-records-needing-weather') {
                log('info', 'Counting records needing weather backfill.', postLogContext);
                const count = await historyCollection.countDocuments({ systemId: { $ne: null }, $or: [{ weather: null }, { 'weather.clouds': { $exists: false } }] });
                return respond(200, { count });
            }

            // --- Backfill Weather Action ---
             if (action === 'backfill-weather') {
                log('info', 'Starting backfill-weather task.', postLogContext);
                const systemsWithLocation = await systemsCollection.find({ latitude: { $ne: null }, longitude: { $ne: null } }).toArray();
                const systemLocationMap = new Map(systemsWithLocation.map(s => [s.id, { lat: s.latitude, lon: s.longitude }]));

                const recordsNeedingWeatherCursor = historyCollection.find({ systemId: { $ne: null }, $or: [{ weather: null }, { 'weather.clouds': { $exists: false } }] });
                let updatedCount = 0;
                const bulkOps = [];
                const BATCH_SIZE = 50; // Smaller batch for external API calls

                for await (const record of recordsNeedingWeatherCursor) {
        log('info', `Processing record: ${record.id}, _id type: ${typeof record._id}`);
                    const location = systemLocationMap.get(record.systemId);
                    if (location && record.timestamp) {
                        try {
                            const weatherData = await callWeatherFunction(location.lat, location.lon, record.timestamp, log);
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
                            log('warn', 'Failed to fetch weather during backfill.', { recordId: record.id, error: weatherError.message });
                        }

                                    if (bulkOps.length >= BATCH_SIZE) {
                                        try {
                                            log('debug', `Performing bulkWrite with ${bulkOps.length} operations.`);
                                            const result = await historyCollection.bulkWrite(bulkOps, { ordered: false });
                                            log('debug', 'Processed backfill-weather batch.', { ...postLogContext, count: BATCH_SIZE, result });
                                        } catch (e) {
                                            log('error', 'Error during bulkWrite.', { error: e.message });
                                        }
                                        bulkOps.length = 0;
                                        // Add a small delay to avoid hitting rate limits too hard
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                    }
                                }
                            }
                            if (bulkOps.length > 0) {
                                try {
                                    log('debug', `Performing final bulkWrite with ${bulkOps.length} operations.`);
                                    const result = await historyCollection.bulkWrite(bulkOps, { ordered: false });
                                    log('debug', 'Processed final backfill-weather batch.', { ...postLogContext, result });
                                } catch (e) {
                                    log('error', 'Error during final bulkWrite.', { error: e.message });
                                }
                            }
                log('info', 'Backfill-weather task complete.', { ...postLogContext, updatedCount });
                return respond(200, { success: true, updatedCount });
            }


            // --- Default Action: Create New History Record ---
            log('info', 'Creating new history record.', logContext);
            // Basic validation for new record
            if (!parsedBody.analysis || !parsedBody.fileName) {
                return respond(400, { error: "Missing 'analysis' or 'fileName' for new record." });
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
            return respond(201, recordToReturn);
        }

        // --- PUT Request Handler (Link Record) ---
        if (httpMethod === 'PUT') {
            const parsedBody = JSON.parse(body);
            log('debug', 'Parsed PUT body.', { ...logContext, bodyPreview: JSON.stringify(parsedBody).substring(0, 100) });
            const { recordId, systemId, dlNumber } = parsedBody;
            if (!recordId || !systemId) return respond(400, { error: "recordId and systemId are required." });

            const system = await systemsCollection.findOne({ id: systemId });
            if (!system) return respond(404, { error: "Target system not found." });

            const updateResult = await historyCollection.updateOne(
                { id: recordId },
                { $set: { systemId, systemName: system.name } }
            );
            if (updateResult.matchedCount === 0) return respond(404, { error: "Record not found." });

            // Ensure DL number is associated with the system
            if (dlNumber && (!system.associatedDLs || !system.associatedDLs.includes(dlNumber))) {
                log('info', 'Adding DL number to system during link.', { ...logContext, recordId, systemId, dlNumber });
                await systemsCollection.updateOne({ id: systemId }, { $addToSet: { associatedDLs: dlNumber } });
            }

            log('info', 'Successfully linked history record to system.', { ...logContext, recordId, systemId });
            return respond(200, { success: true });
        }

        // --- DELETE Request Handler ---
        if (httpMethod === 'DELETE') {
            const { id, unlinked } = queryStringParameters || {};
            const deleteLogContext = { ...logContext, recordId: id, deleteUnlinked: unlinked };

            if (unlinked === 'true') {
                // Delete all records not linked to any system
                log('warn', 'Deleting ALL unlinked history records.', deleteLogContext);
                const { deletedCount } = await historyCollection.deleteMany({ systemId: null });
                log('info', 'Deletion of unlinked records complete.', { ...deleteLogContext, deletedCount });
                return respond(200, { success: true, deletedCount });
            } else if (id) {
                // Delete a single record by ID
                log('warn', 'Deleting single history record.', deleteLogContext);
                const { deletedCount } = await historyCollection.deleteOne({ id });
                if (deletedCount > 0) {
                     log('info', 'Single record deleted successfully.', deleteLogContext);
                     return respond(200, { success: true });
                } else {
                    log('warn', 'Record not found for deletion.', deleteLogContext);
                    return respond(404, { error: 'Record not found.' });
                }
            }
            log('warn', 'Missing parameters for DELETE request.', deleteLogContext);
            return respond(400, { error: "Missing 'id' or 'unlinked=true' parameter for DELETE." });
        }

        // --- Fallback for unsupported methods ---
        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });

    } catch (error) {
        log('error', 'Critical error in history function.', { ...logContext, errorMessage: error.message, stack: error.stack });
        // Distinguish between client errors (like bad JSON) and server errors
        if (error instanceof SyntaxError) {
             return respond(400, { error: "Invalid JSON in request body." });
        }
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};
