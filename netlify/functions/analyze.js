const { getCollection } = require('./utils/mongodb.js');
const { createLogger, createTimer } = require("./utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require('./security.js');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.js');

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

// Function to invoke the background processor
const invokeProcessor = async (jobId, log) => {
    const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
    log('info', 'Invoking background processor.', { jobId, invokeUrl });
    
    try {
        const response = await fetch(invokeUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'x-netlify-background': 'true' 
            },
            body: JSON.stringify({ jobId: jobId }),
        });
        
        if (response.status === 202 || response.status === 200) {
            log('info', 'Background processor invoked successfully.', { jobId, status: response.status });
        } else {
            log('error', 'Background processor invocation returned non-success status.', { 
                jobId, 
                status: response.status,
                statusText: response.statusText
            });
            throw new Error(`Invocation failed with status ${response.status}`);
        }
    } catch (error) {
        log('error', 'Failed to invoke background processor.', { 
            jobId, 
            errorMessage: error.message,
            errorStack: error.stack
        });
        throw error;
    }
};

const handleAsyncAnalysis = async (images, systems, log, context) => {
    const timer = createTimer(log, 'async-analysis-handler');
    const logContext = { clientIp: context.clientIp, httpMethod: context.httpMethod };

    const historyCollection = await getCollection("history");
    const jobsCollection = await getCollection("jobs");

    const jobCreationResponses = [];
    const jobsToInsert = [];
    const batchFileNames = new Set();

    const fileNamesToCheck = images.map(img => img.fileName);
    const existingRecords = await historyCollection.find({ fileName: { $in: fileNamesToCheck } }).toArray();
    const existingRecordMap = new Map(existingRecords.map(r => [r.fileName, r]));

    for (const image of images) {
        const imageLogContext = { ...logContext, fileName: image.fileName };

        if (batchFileNames.has(image.fileName)) {
            jobCreationResponses.push({ fileName: image.fileName, status: 'duplicate_batch' });
            continue;
        }
        batchFileNames.add(image.fileName);

        const existingRecord = existingRecordMap.get(image.fileName);
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
            _id: newJobId,
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
        log('info', `Successfully created ${jobsToInsert.length} new analysis jobs.`, { ...logContext, jobIds: jobsToInsert.map(j => j.id) });

        const invocationPromises = jobsToInsert.map(job => invokeProcessor(job.id, log));
        await Promise.allSettled(invocationPromises);
    }

    const responseCounts = jobCreationResponses.reduce((acc, j) => {
        if (j.status === 'Submitted') acc.queued++;
        else if (j.status.startsWith('duplicate')) acc.duplicates++;
        return acc;
    }, { queued: 0, duplicates: 0 });

    timer.end({ ...responseCounts, totalProcessed: images.length });
    return respond(200, jobCreationResponses);
};

exports.handler = async (event, context) => {
    const log = createLogger('analyze', context);
    log('info', 'analyze.js handler function invoked');
    const timer = createTimer(log, 'analyze-handler');
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };

    try {
        if (httpMethod !== 'POST') {
            return respond(405, { error: 'Method Not Allowed' });
        }

        await checkSecurity(event, log);
        
        const body = JSON.parse(event.body);
        const { images, systems } = body;
        
        if (!Array.isArray(images) || images.length === 0) {
            return respond(400, { error: "No images provided for analysis." });
        }

        const isSync = event.queryStringParameters?.sync === 'true';

        if (isSync) {
            log('info', 'Starting synchronous analysis.', logContext);
            if (images.length > 1) {
                return respond(400, { error: "Synchronous analysis only supports one image at a time." });
            }
            const image = images[0];
            const analysisRecord = await performAnalysisPipeline(image, systems, log, context);
            log('info', 'Synchronous analysis complete.', { ...logContext, recordId: analysisRecord.id });
            timer.end();
            // The pipeline returns the full record, which we send back directly.
            // The client expects an array, so we wrap it.
            return respond(200, [analysisRecord]);
        } else {
            log('info', 'Starting asynchronous analysis.', { ...logContext, imageCount: images.length });
            return await handleAsyncAnalysis(images, systems, log, { clientIp, httpMethod });
        }

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { ...logContext, errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        return respond(500, { error: "An internal server error occurred." });
    }
};



