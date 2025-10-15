
const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");

const PROCESSING_BATCH_SIZE = 2;
const AUDIT_BATCH_SIZE = 50;
const MAX_RETRIES = 2;
const STAGE_TIMEOUT_SECONDS = 300; // 5 minute universal timeout for any processing stage.
const TERMINAL_JOB_TTL_SECONDS = 300; // 5 minutes

const FAILURE_THRESHOLD = 5;
const COOLDOWN_PERIOD_MS = 5 * 60 * 1000;

const getShepherdState = async (collection, log) => {
    const defaultState = { _id: 'shepherd_state', consecutiveFailures: 0, lastFailureReason: null, breakerTrippedUntil: null };
    const state = await collection.findOne({ _id: 'shepherd_state' });
    return { ...defaultState, ...(state || {}) };
};

const saveShepherdState = async (collection, state, log) => {
    try {
        await collection.updateOne({ _id: 'shepherd_state' }, { $set: state }, { upsert: true });
        log('debug', 'Shepherd state saved.', { state });
    } catch (e) {
        log('error', 'Failed to save shepherd state.', { error: e.message });
    }
};

const processQueue = async (jobsCollection, log) => {
    log('debug', 'Phase 1: Processing queue for new jobs.');
    const queuedJobs = await jobsCollection.find({ status: 'Queued' }).limit(PROCESSING_BATCH_SIZE).toArray();

    if (queuedJobs.length === 0) {
        log('info', 'Phase 1: No queued jobs found to process.');
        return;
    }

    log('info', `Phase 1: Found ${queuedJobs.length} queued jobs. Starting invocation.`);
    const processingPromises = queuedJobs.map(async (job) => {
        const jobLogContext = { jobId: job.id, fileName: job.fileName };
        try {
            log('debug', 'Locking job by setting status to Processing.', jobLogContext);
            const now = new Date();
            await jobsCollection.updateOne(
                { _id: job._id, status: 'Queued' }, // Ensure we only update if it's still queued (atomic lock)
                { $set: { status: 'Processing', statusEnteredAt: now, lastHeartbeat: now } }
            );

            const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
            const response = await fetch(invokeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-netlify-background': 'true' },
                body: JSON.stringify({ jobId: job.id }),
            });
            
            if (response.status !== 202 && response.status !== 200) throw new Error(`Background function invocation failed with status: ${response.status}`);
            log('info', 'Successfully invoked background processor.', jobLogContext);
        } catch (error) {
            log('error', 'Failed to process a queued job.', { ...jobLogContext, errorMessage: error.message });
        }
    });
    await Promise.all(processingPromises);
};

const auditJobs = async (jobsCollection, shepherdState, log) => {
    log('debug', 'Phase 2: Auditing jobs.');
    const now = new Date();

    // Audit terminal jobs for cleanup
    const terminalCutoff = new Date(now.getTime() - TERMINAL_JOB_TTL_SECONDS * 1000);
    const { deletedCount } = await jobsCollection.deleteMany({
        status: { $in: ['completed', 'failed_timeout'] },
        statusEnteredAt: { $lt: terminalCutoff }
    });
    if (deletedCount > 0) log('info', `Cleaned up ${deletedCount} stale terminal jobs.`);

    // Audit in-progress jobs for timeout
    const processingTimeout = new Date(now.getTime() - STAGE_TIMEOUT_SECONDS * 1000);
    const zombieJobs = await jobsCollection.find({
        status: 'Processing',
        lastHeartbeat: { $lt: processingTimeout }
    }).limit(AUDIT_BATCH_SIZE).toArray();
    
    if (zombieJobs.length === 0) {
        if (shepherdState.consecutiveFailures > 0) {
            log('info', 'Clean audit run. Resetting consecutive failure count.');
            shepherdState.consecutiveFailures = 0;
            shepherdState.lastFailureReason = null;
        }
    } else {
        log('warn', `Found ${zombieJobs.length} zombie jobs.`);
        shepherdState.lastFailureReason = 'stage_timeout';
        shepherdState.consecutiveFailures += zombieJobs.length;

        for (const job of zombieJobs) {
            if (job.retryCount < MAX_RETRIES) {
                log('info', 'Re-queueing zombie job for retry.', { jobId: job.id });
                await jobsCollection.updateOne({ _id: job._id }, { $set: { status: 'Queued', retryCount: job.retryCount + 1 } });
            } else {
                log('error', 'Job has exhausted all retries. Marking as failed.', { jobId: job.id });
                await jobsCollection.updateOne({ _id: job._id }, { $set: { status: 'failed_timeout', error: 'Job failed after max retries.' } });
            }
        }
    }
    
    if (shepherdState.consecutiveFailures >= FAILURE_THRESHOLD) {
        shepherdState.breakerTrippedUntil = new Date(Date.now() + COOLDOWN_PERIOD_MS);
        log('error', `CIRCUIT BREAKER TRIPPED for ${COOLDOWN_PERIOD_MS / 1000}s.`, { reason: shepherdState.lastFailureReason });
    }
};

exports.handler = async function(event, context) {
    const log = createLogger('job-shepherd', context);
    log('info', 'Shepherd function invoked by schedule.');
    log('debug', 'Shepherd invocation details.', { event: JSON.stringify(event) });

    try {
        const jobsCollection = await getCollection("jobs");
        const shepherdCollection = await getCollection("shepherd_state");
        const shepherdState = await getShepherdState(shepherdCollection, log);

        if (shepherdState.breakerTrippedUntil && new Date() < new Date(shepherdState.breakerTrippedUntil)) {
            log('warn', 'Circuit breaker is tripped. Skipping run.', { until: shepherdState.breakerTrippedUntil });
            return { statusCode: 200, body: 'Circuit breaker tripped.' };
        }

        await processQueue(jobsCollection, log);
        await auditJobs(jobsCollection, shepherdState, log);
        await saveShepherdState(shepherdCollection, shepherdState, log);
        
        log('info', 'Shepherd run completed successfully.');
        return { statusCode: 200, body: 'Shepherd run completed.' };

    } catch (error) {
        log('error', 'Critical error in job-shepherd handler.', { errorMessage: error.message, stack: error.stack });
        return { statusCode: 500, body: 'An internal error occurred.' };
    }
};