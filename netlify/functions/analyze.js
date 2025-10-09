const { GoogleGenAI } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require("./security");
const { getConfiguredStore } = require("./utils/blobs.js");
const { builder } = require('@netlify/functions');

const JOBS_STORE_NAME = "bms-jobs";

const createLogger = (context) => (level, message, extra = {}) => {
    try {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            functionName: context?.functionName || 'analyze',
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        }));
    } catch (e) {
        console.log(JSON.stringify({
            level: 'ERROR',
            functionName: context?.functionName || 'analyze',
            awsRequestId: context?.awsRequestId,
            message: 'Failed to serialize log message.',
            originalMessage: message,
            serializationError: e.message,
        }));
    }
};

const withRetry = async (fn, log, maxRetries = 3, initialDelay = 250) => {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            const isRetryable = (error instanceof TypeError) || (error.message && (error.message.includes('401 status code') || error.message.includes('502 status code')));
            if (isRetryable && i < maxRetries) {
                const delay = initialDelay * Math.pow(2, i) + Math.random() * initialDelay;
                log('warn', `A retryable blob store operation failed. Retrying in ${delay.toFixed(0)}ms...`, { attempt: i + 1, maxRetries, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

const analysisHandler = async function(event, context) {
    const log = createLogger(context);
    log('info', 'Function invoked.', { stage: 'invocation', httpMethod: event.httpMethod });

    if (event.httpMethod !== 'POST') {
        log('warn', 'Method Not Allowed.', { httpMethod: event.httpMethod });
        return respond(405, { error: 'Method Not Allowed' });
    }

    let response;
    try {
        log('info', 'Starting security check');
        await checkSecurity(event, log);
        log('info', 'Security passed, parsing body');
        
        const body = JSON.parse(event.body);
        const { images, systems } = body;

        if (!Array.isArray(images) || images.length === 0) {
            log('warn', 'Bad request: images array is missing or empty.');
            response = respond(400, { error: 'Request body must contain an array of images.' });
        } else {
            log('info', `Starting job creation for ${images.length} images.`);
            
            const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
            const jobCreationResults = [];

            for (const image of images) {
                const jobId = uuidv4();
                const logContext = { fileName: image.fileName, jobId };
                log('info', `Creating job for file.`, logContext);
                const job = {
                    jobId,
                    status: 'queued',
                    fileName: image.fileName,
                    image: image.image,
                    mimeType: image.mimeType,
                    systems, // Pass systems context to the job
                    createdAt: new Date().toISOString(),
                };
                
                await withRetry(() => jobsStore.setJSON(jobId, job), log);
                log('info', `Job created and stored in blob store.`, logContext);

                // Asynchronously invoke the background function.
                // Crucially, if the invocation fails, we log it AND update the job status.
                context.functions.invoke('process-analysis', {
                    body: JSON.stringify({ jobId })
                }).catch(async (err) => {
                    log('error', 'Failed to invoke background analysis function. Updating job status to failed.', { ...logContext, error: err.message, stack: err.stack });
                    try {
                        // We must mark the job as failed so the frontend doesn't poll forever.
                        const jobToFail = await withRetry(() => jobsStore.get(jobId, { type: "json" }), log);
                        if (jobToFail) {
                            jobToFail.status = 'failed';
                            jobToFail.error = `Function invocation failed: ${err.message}`;
                            await withRetry(() => jobsStore.setJSON(jobId, jobToFail), log);
                        }
                    } catch (updateError) {
                        log('error', 'CRITICAL: Failed to update job status to FAILED after invocation error.', { ...logContext, updateError: updateError.message });
                    }
                });

                jobCreationResults.push({
                    fileName: image.fileName,
                    jobId,
                    status: 'queued',
                });
            }
            
            log('info', 'All jobs created and background functions invoked.', { count: images.length, jobIds: jobCreationResults.map(j => j.jobId) });
            response = respond(202, jobCreationResults);
        }

    } catch (error) {
        if (error instanceof HttpError) {
            log('warn', 'Security check failed.', { statusCode: error.statusCode, message: error.message });
            response = respond(error.statusCode, { error: error.message });
        } else {
            log('error', 'Critical error in function handler.', { stage: 'handler_fatal', error: error.message, stack: error.stack });
            response = respond(500, { error: "An internal server error occurred: " + error.message });
        }
    }
    return response;
};

exports.handler = builder(analysisHandler);