const { getConfiguredStore } = require('./utils/blobs');
const { createLogger } = require("./utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require('./security.js');

const JOBS_STORE_NAME = "bms-jobs";

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
            log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
            return respond(405, { error: 'Method Not Allowed' });
        }

        log('debug', 'Starting security check.', logContext);
        await checkSecurity(event, log);
        log('debug', 'Security check passed.', logContext);
        
        let body;
        try {
            body = JSON.parse(event.body);
            log('debug', 'Request body parsed successfully.', { ...logContext, imageCount: body?.images?.length, hasSystems: !!body?.systems });
        } catch (e) {
            log('error', 'Failed to parse request body as JSON.', { ...logContext, body: event.body, error: e.message });
            throw new HttpError(400, "Invalid JSON in request body.");
        }

        const { images, systems } = body;

        if (!Array.isArray(images) || images.length === 0) {
            log('warn', 'Validation failed: No images provided for analysis.', logContext);
            return respond(400, { error: "No images provided for analysis." });
        }
        log('debug', `Processing ${images.length} images.`, logContext);

        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
        const jobCreationResponses = [];

        for (const [index, image] of images.entries()) {
            const newJobId = uuidv4();
            const jobLogContext = { ...logContext, jobId: newJobId, fileName: image.fileName, imageIndex: index };
            log('debug', 'Creating job for image.', jobLogContext);
            
            const jobData = {
                id: newJobId,
                fileName: image.fileName,
                status: "queued",
                image: image.image, // base64 string
                mimeType: image.mimeType,
                systems, // All systems info
                createdAt: new Date().toISOString(),
            };
            
            try {
                log('debug', 'Storing job data in blob store.', jobLogContext);
                await jobsStore.setJSON(newJobId, jobData);
                log('debug', 'Job data stored successfully.', jobLogContext);

                const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
                log('debug', 'Invoking background processing function.', { ...jobLogContext, url: invokeUrl });
                // Asynchronously invoke the background function.
                fetch(invokeUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobId: newJobId }),
                }).catch(e => {
                    log('error', "Fire-and-forget invocation failed for process-analysis.", { ...jobLogContext, error: e.message });
                });

                jobCreationResponses.push({
                    fileName: image.fileName,
                    jobId: newJobId,
                    status: 'queued',
                });
            } catch (storeError) {
                 log('error', 'Failed to create and store job, it will not be processed.', { ...jobLogContext, error: storeError.message });
                 jobCreationResponses.push({
                    fileName: image.fileName,
                    jobId: null,
                    status: 'failed',
                    error: 'Failed to create job in store.'
                 });
            }
        }
        
        const queuedCount = jobCreationResponses.filter(j => j.status === 'queued').length;
        log('info', `Queued ${queuedCount} analysis jobs.`, { ...logContext, totalProcessed: images.length });
        return respond(200, jobCreationResponses);

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { ...logContext, errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        return respond(500, { error: "An internal server error occurred." });
    }
};
