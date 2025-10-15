
const { getCollection } = require('./utils/mongodb.js');
const { createLogger } = require("./utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require('./security.js');

const getBasename = (path) => path ? path.split(/[/\\]/).pop() || '' : '';

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async (event, context) => {
    const log = createLogger('analyze', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };

    log('debug', 'Function invoked.', { ...logContext, headers: event.headers });
    
    try {
        if (httpMethod !== 'POST') {
            return respond(405, { error: 'Method Not Allowed' });
        }

        await checkSecurity(event, log);
        
        const body = JSON.parse(event.body);
        log('debug', 'Request body parsed.', { ...logContext, imageCount: body.images?.length, hasSystems: !!body.systems });
        const { images, systems } = body;

        if (!Array.isArray(images) || images.length === 0) {
            return respond(400, { error: "No images provided for analysis." });
        }
        
        const historyCollection = await getCollection("history");
        const jobsCollection = await getCollection("jobs");
        const jobCreationResponses = [];
        const batchBasenames = new Set();
        const basenamesToCheck = images.map(img => getBasename(img.fileName));
        
        const existingRecords = await historyCollection.find({ fileName: { $in: basenamesToCheck } }).toArray();
        const existingRecordMap = new Map(existingRecords.map(r => [r.fileName, r]));

        const jobsToInsert = [];

        for (const [index, image] of images.entries()) {
            const basename = getBasename(image.fileName);
            const imageLogContext = { ...logContext, fileName: image.fileName, basename, imageIndex: index };
            
            if (batchBasenames.has(basename)) {
                 jobCreationResponses.push({ fileName: image.fileName, status: 'duplicate_batch' });
                 continue;
            }
            batchBasenames.add(basename);

            const existingRecord = existingRecordMap.get(basename);
            if (existingRecord && !image.force) {
                jobCreationResponses.push({
                    fileName: image.fileName,
                    status: 'duplicate_history',
                    duplicateRecordId: existingRecord.id,
                });
                continue;
            }

            const newJobId = uuidv4();
            jobsToInsert.push({
                _id: newJobId, // Use native MongoDB _id for jobs
                id: newJobId,
                fileName: image.fileName,
                status: "Queued",
                image: image.image,
                mimeType: image.mimeType,
                systems,
                createdAt: new Date(),
                retryCount: 0,
            });
            jobCreationResponses.push({
                fileName: image.fileName,
                jobId: newJobId,
                status: 'Submitted',
            });
        }
        
        if (jobsToInsert.length > 0) {
            await jobsCollection.insertMany(jobsToInsert);
            log('info', `Successfully created ${jobsToInsert.length} new analysis jobs.`);
        }
        
        const responseCounts = jobCreationResponses.reduce((acc, j) => {
            if (j.status === 'Submitted') acc.queued++;
            else if (j.status.startsWith('duplicate')) acc.duplicates++;
            return acc;
        }, { queued: 0, duplicates: 0 });
        
        log('info', `Analysis submission processing complete.`, { ...logContext, ...responseCounts, totalProcessed: images.length });
        return respond(200, jobCreationResponses);

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { ...logContext, errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        return respond(500, { error: "An internal server error occurred." });
    }
};