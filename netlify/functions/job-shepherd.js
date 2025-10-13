const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");
const { createRetryWrapper } = require("./utils/retry.js");

const JOBS_STORE_NAME = "bms-jobs";
const SHEPHERD_STATE_KEY = "_shepherd_state"; // Reserved key for circuit breaker state
const PROCESSING_BATCH_SIZE = 5; // Process up to 5 new jobs per run
const AUDIT_BATCH_SIZE = 50; // Audit up to 50 in-progress jobs per run
const MAX_RETRIES = 2;
const HEARTBEAT_TIMEOUT_SECONDS = 120; // 2 minutes

const STAGE_TIMEOUTS_SECONDS = {
    'Processing': 60,
    'Extracting data': 300, // 5 minutes for Gemini call
    'Extraction complete (checkpoint)': 120,
    'Mapping data': 120,
    'Matching system': 120,
    'Fetching weather': 120,
    'Saving result': 120,
    'default': 180 // 3 minute default for any other state
};

const FAILURE_THRESHOLD = 5; // Trip breaker after 5 consecutive failures
const COOLDOWN_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

const isTerminalStatus = (status) => ['completed', 'Queued'].includes(status) || status?.startsWith('failed');

const getShepherdState = async (store, log, withRetry) => {
    try {
        const state = await withRetry(() => store.get(SHEPHERD_STATE_KEY, { type: 'json' }));
        return state || { consecutiveFailures: 0, lastFailureReason: null, breakerTrippedUntil: null };
    } catch (e) {
        if (e.status === 404) {
            log('info', 'Shepherd state not found, initializing with defaults.');
            return { consecutiveFailures: 0, lastFailureReason: null, breakerTrippedUntil: null };
        }
        throw e;
    }
};

const saveShepherdState = async (store, state, log, withRetry) => {
    try {
        await withRetry(() => store.setJSON(SHEPHERD_STATE_KEY, state));
        log('debug', 'Shepherd state saved.', { state });
    } catch (e) {
        log('error', 'Failed to save shepherd state.', { error: e.message });
    }
};

const processQueue = async (jobsStore, log, withRetry) => {
    log('debug', 'Phase 1: Processing queue for new jobs.');
    let jobsToProcess = [];
    
    const { blobs } = await withRetry(() => jobsStore.list({ prefix: 'Queued/', limit: PROCESSING_BATCH_SIZE }));
    if (blobs.length === 0) {
        log('info', 'Phase 1: No queued jobs found to process.');
        return 0;
    }

    for (const blob of blobs) {
         try {
            const job = await withRetry(() => jobsStore.get(blob.key, { type: 'json' }));
            if (job && job.status === 'Queued') jobsToProcess.push(job);
        } catch (e) {
            log('warn', 'Failed to get/parse job blob during queue scan, skipping.', { key: blob.key, error: e.message });
        }
    }

    if (jobsToProcess.length === 0) {
        log('info', 'Phase 1: No processable queued jobs found.');
        return 0;
    }

    log('info', `Phase 1: Found ${jobsToProcess.length} queued jobs. Starting invocation.`);
    const processingPromises = jobsToProcess.map(async (job) => {
        const jobLogContext = { jobId: job.id, fileName: job.fileName };
        try {
            log('debug', 'Locking job by moving it to Processing status.', jobLogContext);
            const { image, images, ...jobWithoutImages } = job;
            const updatedJob = { ...jobWithoutImages, status: 'Processing', statusEnteredAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString() };
            
            // Set the new prefixed key first
            await withRetry(() => jobsStore.setJSON(job.id, updatedJob, { key: `Processing/${job.id}` }));
            // Then delete the old prefixed key
            await withRetry(() => jobsStore.delete(job.id, { key: `Queued/${job.id}` }));
            
            log('info', 'Job locked. Invoking background processor.', jobLogContext);
            const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
            const response = await fetch(invokeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-netlify-function-secret': process.env.FUNCTION_SECRET },
                body: JSON.stringify({ jobId: job.id }),
            });
            if (response.status !== 202) {
                throw new Error(`Failed to invoke background function. Status: ${response.status}`);
            }
            log('info', 'Successfully invoked background processor.', jobLogContext);
        } catch (error) {
            log('error', 'Failed to process a queued job.', { ...jobLogContext, errorMessage: error.message });
        }
    });
    await Promise.all(processingPromises);
    return jobsToProcess.length;
};

const auditJobs = async (jobsStore, shepherdState, log, withRetry) => {
    log('debug', 'Phase 2: Auditing in-progress jobs.');
    let zombiesFound = 0;
    const now = new Date();
    
    const { blobs } = await withRetry(() => jobsStore.list({ prefix: 'Processing/', limit: AUDIT_BATCH_SIZE }));
    if (blobs.length === 0) {
        log('info', 'Phase 2: No in-progress jobs to audit.');
    } else {
        log('info', `Phase 2: Auditing ${blobs.length} in-progress jobs.`);
    }

    for (const blob of blobs) {
        try {
            const job = await withRetry(() => jobsStore.get(blob.key, { type: 'json' }));
            if (!job || isTerminalStatus(job.status)) continue;

            const jobLogContext = { jobId: job.id, status: job.status, retryCount: job.retryCount };
            const lastHeartbeat = new Date(job.lastHeartbeat || 0);
            const statusEnteredAt = new Date(job.statusEnteredAt || 0);
            const heartbeatAge = (now - lastHeartbeat) / 1000;
            const stageAge = (now - statusEnteredAt) / 1000;
            const stageTimeout = STAGE_TIMEOUTS_SECONDS[job.status] || STAGE_TIMEOUTS_SECONDS.default;

            if (heartbeatAge > HEARTBEAT_TIMEOUT_SECONDS || stageAge > stageTimeout) {
                zombiesFound++;
                const reason = heartbeatAge > HEARTBEAT_TIMEOUT_SECONDS ? 'heartbeat_timeout' : `stage_timeout (${job.status})`;
                log('warn', `Found zombie job.`, { ...jobLogContext, reason, heartbeatAge, stageAge });

                if (shepherdState.lastFailureReason === reason) {
                    shepherdState.consecutiveFailures++;
                } else {
                    shepherdState.lastFailureReason = reason;
                    shepherdState.consecutiveFailures = 1;
                }
                log('debug', 'Updated circuit breaker state.', { consecutiveFailures: shepherdState.consecutiveFailures, lastFailureReason: shepherdState.lastFailureReason });
                
                if (job.retryCount < MAX_RETRIES) {
                    log('info', 'Re-queueing zombie job for retry.', jobLogContext);
                    const requeuedJob = { ...job, status: 'Queued', retryCount: job.retryCount + 1 };
                    await withRetry(() => jobsStore.setJSON(job.id, requeuedJob, { key: `Queued/${job.id}` }));
                    await withRetry(() => jobsStore.delete(job.id, { key: `Processing/${job.id}`}));
                } else {
                    log('error', 'Job has exhausted all retries. Marking as failed.', jobLogContext);
                    const failedJob = { ...job, status: 'failed_timeout', error: `Job failed after ${MAX_RETRIES} retries. Last known reason: ${reason}.` };
                    await withRetry(() => jobsStore.setJSON(job.id, failedJob, { key: `failed_timeout/${job.id}` }));
                    await withRetry(() => jobsStore.delete(job.id, { key: `Processing/${job.id}` }));
                }
            }
        } catch(e) {
            log('warn', 'Failed to audit a job blob, skipping.', { key: blob.key, error: e.message });
        }
    }
    
    if (zombiesFound > 0) {
        if (shepherdState.consecutiveFailures >= FAILURE_THRESHOLD) {
            shepherdState.breakerTrippedUntil = new Date(Date.now() + COOLDOWN_PERIOD_MS).toISOString();
            log('error', `CIRCUIT BREAKER TRIPPED for ${COOLDOWN_PERIOD_MS / 1000}s due to ${shepherdState.consecutiveFailures} consecutive failures.`, { reason: shepherdState.lastFailureReason });
        }
    } else if (shepherdState.consecutiveFailures > 0) {
        log('info', 'Clean audit run. Resetting consecutive failure count.');
        shepherdState.consecutiveFailures = 0;
        shepherdState.lastFailureReason = null;
    }
    
    await saveShepherdState(jobsStore, shepherdState, log, withRetry);
};

exports.handler = async function(event, context) {
    const log = createLogger('job-shepherd', context);
    const withRetry = createRetryWrapper(log);
    log('info', 'Shepherd function invoked by schedule.');

    const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);

    try {
        const shepherdState = await getShepherdState(jobsStore, log, withRetry);
        if (shepherdState.breakerTrippedUntil && new Date() < new Date(shepherdState.breakerTrippedUntil)) {
            log('warn', 'Circuit breaker is tripped. Skipping job processing and audit.', { until: shepherdState.breakerTrippedUntil });
            return { statusCode: 200, body: 'Circuit breaker tripped. No new jobs processed.' };
        }

        await processQueue(jobsStore, log, withRetry);
        await auditJobs(jobsStore, shepherdState, log, withRetry);
        
        log('info', 'Shepherd run completed successfully.');
        return { statusCode: 200, body: 'Shepherd run completed.' };

    } catch (error) {
        log('error', 'Critical error in job-shepherd handler.', { errorMessage: error.message, stack: error.stack });
        return { statusCode: 500, body: 'An internal error occurred.' };
    }
};