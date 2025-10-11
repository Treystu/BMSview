const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require("./security");
const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");

const JOBS_STORE_NAME = "bms-jobs";

const withRetry = async (fn, log, maxRetries = 5, initialDelay = 250) => {
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
                if (i === maxRetries) {
                    log('error', 'Blob store operation failed after maximum retries.', { attempt: i + 1, maxRetries, error: error.message });
                }
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

exports.handler = async function(event, context) {
    const log = createLogger('analyze', context);
    const startTime = Date.now();
    log('info', 'Handler entry - start', { httpMethod: event.httpMethod, bodySize: event.body ? event.body.length : 0, timestamp: new Date().toISOString() });
    console.log('RAW ENTRY FLUSH: Handler started at ' + new Date().toISOString());  // Raw fallback
    
    let response;
    try {
        if (event.httpMethod !== 'POST') {
            log('warn', 'Method Not Allowed.', { httpMethod: event.httpMethod });
            response = respond(405, { error: 'Method Not Allowed' });
        } else {
            log('info', 'Method check passed', { timestamp: new Date().toISOString() });
            console.log('RAW METHOD PASS: POST confirmed at ' + new Date().toISOString());
            await checkSecurity(event, log);
            log('info', 'Security check passed', { timestamp: new Date().toISOString() });
            console.log('RAW SECURITY PASS: Cleared at ' + new Date().toISOString());
            
            const body = JSON.parse(event.body);
            const { images, systems } = body;
            log('info', 'Body parsed', { imagesLength: images.length, systemsCount: systems ? systems.length : 0, timestamp: new Date().toISOString() });
            console.log('RAW BODY PARSE: ' + images.length + ' images at ' + new Date().toISOString());

            if (!Array.isArray(images) || images.length === 0) {
                log('warn', 'Bad request: images array is missing or empty.');
                response = respond(400, { error: 'Request body must contain an array of images.' });
            } else {
                log('info', `Starting job creation for ${images.length} images.`);
                
                const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
                const jobCreationResults = [];

                for (const image of images) {
                    const jobId = uuidv4();
                    log('info', 'Job loop start for file', { fileName: image.fileName, timestamp: new Date().toISOString() });
                    console.log('RAW LOOP START: File ' + image.fileName + ' at ' + new Date().toISOString());
                    
                    const job = {
                        jobId,
                        status: 'queued',
                        fileName: image.fileName,
                        image: image.image,
                        mimeType: image.mimeType,
                        systems,
                        createdAt: new Date().toISOString(),
                    };
                    
                    await withRetry(() => jobsStore.setJSON(jobId, job), log);
                    log('info', 'Job blob written', { jobId, fileName: image.fileName, timestamp: new Date().toISOString() });
                    console.log('RAW BLOB WRITE: Job ' + jobId + ' for ' + image.fileName + ' at ' + new Date().toISOString());

                    const functionUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
                    
                    // Fire-and-forget the invocation. Do not await this.
                    fetch(functionUrl, {
                        method: 'POST',
                        headers: {
                            'x-netlify-background': 'true',
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ jobId })
                    }).then(res => {
                        if (res.status !== 202) {
                            log('warn', `Background function invocation returned a non-202 status`, { jobId, status: res.status });
                            return res.text().then(text => {
                                log('warn', 'Invocation failure response body', { body: text });
                            });
                        } else {
                            log('info', 'Background invocation acknowledged.', { jobId, status: res.status });
                        }
                    }).catch(err => {
                      log('warn', 'Background function invocation fetch failed.', { jobId, error: err.message, stack: err.stack, timestamp: new Date().toISOString() });
                      console.log('RAW INVOKE FAIL: Job ' + jobId + ' error ' + err.message + ' at ' + new Date().toISOString());
                    });

                    log('info', 'Invoke sent', { jobId, timestamp: new Date().toISOString() });
                    console.log('RAW INVOKE SENT: Job ' + jobId + ' sent at ' + new Date().toISOString());

                    jobCreationResults.push({
                        fileName: image.fileName,
                        jobId,
                        status: 'queued',
                    });

                    // Stagger invocations to avoid thundering herd on the background function & Gemini API.
                    if (images.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
                
                log('info', 'All jobs created and invokes sent', { totalJobs: images.length, timestamp: new Date().toISOString() });
                console.log('RAW ALL INVOKES SENT: ' + images.length + ' done at ' + new Date().toISOString());
                
                log('info', 'Handler success exit prep', { resultsCount: jobCreationResults.length, timestamp: new Date().toISOString() });
                console.log('RAW SUCCESS PREP: ' + jobCreationResults.length + ' results at ' + new Date().toISOString());
                response = respond(202, jobCreationResults);
            }
        }
    } catch (error) {
        if (error instanceof HttpError) {
            log('warn', 'Security check failed.', { statusCode: error.statusCode, message: error.message });
            response = respond(error.statusCode, { error: error.message });
        } else {
            log('error', 'Critical error in function handler.', { stage: 'handler_fatal', error: error.message, stack: error.stack });
            log('error', 'Catch response prep', { errorType: error.constructor.name, timestamp: new Date().toISOString() });
            console.log('RAW CATCH PREP: Error ' + error.constructor.name + ' at ' + new Date().toISOString());
            response = respond(500, { error: "An internal server error occurred: " + error.message });
        }
    } finally {
        const duration = Date.now() - startTime;
        log('info', 'Handler final exit', { durationMs: duration, finalStatus: response ? response.statusCode : 'unknown', timestamp: new Date().toISOString() });
        console.log('RAW FINAL EXIT: Duration ' + duration + 'ms at ' + new Date().toISOString());
    }
    return response;
};