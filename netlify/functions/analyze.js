const { getCollection } = require('./utils/mongodb.js');
const { createLogger, createTimer } = require("./utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require('./security.js');

const getBasename = (path) => path ? path.split(/[/\\]/).pop() || '' : '';

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
            log('info', 'Background processor invoked successfully.', { 
                jobId, 
                status: response.status 
            });
        } else {
            log('error', 'Background processor invocation returned non-success status.', { 
                jobId, 
                status: response.status,
                statusText: response.statusText
            });
            // Throw an error to be caught by Promise.allSettled
            throw new Error(`Invocation failed with status ${response.status}`);
        }
    } catch (error) {
        log('error', 'Failed to invoke background processor.', { 
            jobId, 
            errorMessage: error.message,
            errorStack: error.stack
        });
        // Re-throw the error to be caught by Promise.allSettled
        throw error;
    }
};

exports.handler = async (event, context) => {
    const log = createLogger('analyze', context);
    log('info', 'analyze.js handler function invoked - v2');
    const timer = createTimer(log, 'analyze-handler');
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };

    log('debug', 'Function invoked.', { ...logContext, path: event.path, method: httpMethod });
    
    try {
        if (httpMethod !== 'POST') {
            return respond(405, { error: 'Method Not Allowed' });
        }

        await checkSecurity(event, log);
        
        const body = JSON.parse(event.body);
        const { images, systems } = body;
        
        log('debug', 'Request body parsed.', { 
            ...logContext, 
            imageCount: images?.length, 
            hasSystems: !!systems,
            systemCount: systems?.length || 0,
            bodySize: event.body?.length || 0
        });

        if (!Array.isArray(images) || images.length === 0) {
            log('warn', 'Request rejected: No images provided.', logContext);
            return respond(400, { error: "No images provided for analysis." });
        }
        
        log('info', 'Starting batch analysis.', { 
            ...logContext, 
            imageCount: images.length,
            systemCount: systems?.length || 0
        });
        
        const dbTimer = createTimer(log, 'database-operations');
        const historyCollection = await getCollection("history");
        const jobsCollection = await getCollection("jobs");
        log('debug', 'Database collections retrieved.', logContext);
        
        const jobCreationResponses = [];
        const batchFileNames = new Set();
        const jobsToInsert = [];

        const BATCH_SIZE = 100;
        const imageBatches = [];
        for (let i = 0; i < images.length; i += BATCH_SIZE) {
            imageBatches.push(images.slice(i, i + BATCH_SIZE));
        }

        for (const batch of imageBatches) {
            const fileNamesToCheck = batch.map(img => img.fileName);

            const existingRecords = await historyCollection.find({ fileName: { $in: fileNamesToCheck } }).toArray();
            const existingRecordMap = new Map(existingRecords.map(r => [r.fileName, r]));
            log('info', 'Duplicate check data', { fileNamesToCheck, existingRecordMap: Array.from(existingRecordMap.entries()) });

            for (const [index, image] of batch.entries()) {
                const imageLogContext = { ...logContext, fileName: image.fileName, imageIndex: index };

                if (batchFileNames.has(image.fileName)) {
                    log('debug', 'Duplicate in current batch detected.', imageLogContext);
                    jobCreationResponses.push({ fileName: image.fileName, status: 'duplicate_batch' });
                    continue;
                }
                batchFileNames.add(image.fileName);

                const existingRecord = existingRecordMap.get(image.fileName);
                if (existingRecord && !image.force) {
                    log('debug', 'Duplicate in history detected.', {
                        ...imageLogContext,
                        existingRecordId: existingRecord.id,
                        force: image.force
                    });
                    jobCreationResponses.push({
                        fileName: image.fileName,
                        status: 'duplicate_history',
                        duplicateRecordId: existingRecord.id,
                    });
                    continue;
                }

                log('debug', 'Creating new job for image.', imageLogContext);

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
        }

        dbTimer.end();        
        if (jobsToInsert.length > 0) {
            const insertTimer = createTimer(log, 'insert-jobs');
            await jobsCollection.insertMany(jobsToInsert);
            insertTimer.end({ jobCount: jobsToInsert.length });
            log('info', `Successfully created ${jobsToInsert.length} new analysis jobs.`, { 
                ...logContext,
                jobIds: jobsToInsert.map(j => j.id)
            });

            // *** THE FIX: Reliably trigger background processors and await invocation ***
            const invocationPromises = jobsToInsert.map(job => invokeProcessor(job.id, log));
            const invocationResults = await Promise.allSettled(invocationPromises);
            
            const failedInvocations = invocationResults.filter(r => r.status === 'rejected');
            if (failedInvocations.length > 0) {
                log('error', `${failedInvocations.length} background processor invocation(s) failed. These jobs will be picked up by the shepherd.`, {
                    ...logContext,
                    failedCount: failedInvocations.length,
                });
            }

            log('info', 'All background processors invoked.', {
                ...logContext,
                jobCount: jobsToInsert.length,
                successful: jobsToInsert.length - failedInvocations.length,
                failed: failedInvocations.length
            });
        } else {
            log('info', 'No new jobs to create (all duplicates).', logContext);
        }
        
        const responseCounts = jobCreationResponses.reduce((acc, j) => {
            if (j.status === 'Submitted') acc.queued++;
            else if (j.status.startsWith('duplicate')) acc.duplicates++;
            return acc;
        }, { queued: 0, duplicates: 0 });
        
        const totalDuration = timer.end({ ...responseCounts, totalProcessed: images.length });
        log('info', `Analysis submission processing complete.`, { 
            ...logContext, 
            ...responseCounts, 
            totalProcessed: images.length,
            totalDurationMs: totalDuration
        });
        
        return respond(200, jobCreationResponses);

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { ...logContext, errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        return respond(500, { error: "An internal server error occurred." });
    }
};

