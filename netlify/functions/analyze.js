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
    console.log('Received event:', event.body);
    const log = createLogger('analyze', context);
    
    try {
        if (event.httpMethod !== 'POST') {
            return respond(405, { error: 'Method Not Allowed' });
        }

        await checkSecurity(event, log);
        
        const body = JSON.parse(event.body);
        const { images, systems } = body;

        if (!Array.isArray(images) || images.length === 0) {
            return respond(400, { error: "No images provided for analysis." });
        }

        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
        const jobCreationResponses = [];

        for (const image of images) {
            const newJobId = uuidv4();
            // Important: We only store what's necessary for the background job
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
                // First, save the job data. If this fails, we won't try to invoke.
                await jobsStore.setJSON(newJobId, jobData);

                // Asynchronously invoke the background function.
                // The client won't wait for this, allowing for a quick response.
                fetch(`${process.env.URL}/.netlify/functions/process-analysis`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ jobId: newJobId }),
                }).catch(e => {
                    log('error', "Fire-and-forget invocation failed for process-analysis.", { jobId: newJobId, error: e.message });
                    // The job is in the store, but might not be processed. A retry mechanism could handle this.
                });

                jobCreationResponses.push({
                    fileName: image.fileName,
                    jobId: newJobId,
                    status: 'queued',
                });
            } catch (storeError) {
                 log('error', 'Failed to create and store job, it will not be processed.', { fileName: image.fileName, error: storeError.message });
                 jobCreationResponses.push({
                    fileName: image.fileName,
                    jobId: null,
                    status: 'failed',
                    error: 'Failed to create job in store.'
                 });
            }
        }
        
        log('info', `Queued ${jobCreationResponses.filter(j => j.status === 'queued').length} analysis jobs.`);
        return respond(200, jobCreationResponses);

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        return respond(500, { error: "An internal server error occurred." });
    }
};