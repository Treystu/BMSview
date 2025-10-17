const { getCollection } = require("./utils/mongodb.js");
const { createLogger, createTimer } = require("./utils/logger.js");

const PROCESSING_BATCH_SIZE = 2;
const AUDIT_BATCH_SIZE = 50;
const MAX_RETRIES = 2;
const STAGE_TIMEOUT_SECONDS = 300; // 5 minute universal timeout for any processing stage.
const TERMINAL_JOB_TTL_SECONDS = 300; // 5 minutes

const FAILURE_THRESHOLD = 5;
const COOLDOWN_PERIOD_MS = 5 * 60 * 1000;

// Configuration for logging
const LOG_CONFIG = {
    logQueuedJobDetails: true,
    logAuditDetails: true,
    logCircuitBreakerState: true
};

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
    const timer = createTimer(log, 'process-queue');
    log('debug', 'Phase 1: Processing queue for new jobs.');
    
    // Enhanced query to include retry information
    const queuedJobs = await jobsCollection.find({ status: 'Queued' })
        .sort({ createdAt: 1 }) // Process oldest first
        .limit(PROCESSING_BATCH_SIZE)
        .toArray();

    if (queuedJobs.length === 0) {
        log('info', 'Phase 1: No queued jobs found to process.');
        timer.end({ jobsProcessed: 0 });
        return;
    }

    log('info', `Phase 1: Found ${queuedJobs.length} queued jobs. Starting invocation.`, {
        jobIds: queuedJobs.map(j => j.id),
        retryInfo: queuedJobs.map(j => ({ id: j.id, retryCount: j.retryCount || 0 }))
    });
    
    const processingPromises = queuedJobs.map(async (job) => {
        const jobLogContext = { 
            jobId: job.id, 
            fileName: job.fileName,
            retryCount: job.retryCount || 0,
            createdAt: job.createdAt
        };
        
        try {
            log('debug', 'Locking job by setting status to Processing.', jobLogContext);
            const now = new Date();
            const updateResult = await jobsCollection.updateOne(
                { _id: job._id, status: 'Queued' }, // Ensure we only update if it's still queued (atomic lock)
                { $set: { status: 'Processing', statusEnteredAt: now, lastHeartbeat: now } }
            );
            
            if (updateResult.matchedCount === 0) {
                log('warn', 'Job was already locked by another process.', jobLogContext);
                return;
            }

            // Log the environment details for debugging
            const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
            log('info', 'Invoking background processor.', { 
                ...jobLogContext, 
                invokeUrl,
                environment: process.env.NODE_ENV || 'unknown',
                functionUrl: process.env.URL || 'not-set'
            });
            
            const response = await fetch(invokeUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'x-netlify-background': 'true',
                    'x-netlify-event': 'background-invocation'
                },
                body: JSON.stringify({ jobId: job.id }),
            });
            
            if (response.status !== 202 && response.status !== 200) {
                const errorText = await response.text().catch(() => 'No response body');
                throw new Error(`Background function invocation failed with status: ${response.status}, body: ${errorText}`);
            }
            
            log('info', 'Successfully invoked background processor.', { 
                ...jobLogContext, 
                responseStatus: response.status,
                responseHeaders: Object.fromEntries(response.headers.entries())
            });
        } catch (error) {
            log('error', 'Failed to process a queued job.', { 
                ...jobLogContext, 
                errorMessage: error.message,
                stack: error.stack,
                environment: process.env.NODE_ENV || 'unknown'
            });
            
            // Attempt to revert the job status back to Queued so it can be retried
            try {
                await jobsCollection.updateOne(
                    { _id: job._id },
                    { 
                        $set: { 
                            status: 'Queued',
                            lastFailureReason: `Invocation failed: ${error.message}`,
                            lastHeartbeat: new Date()
                        },
                        $inc: { retryCount: 1 }
                    }
                );
                log('warn', 'Reverted job status to Queued for retry.', jobLogContext);
            } catch (revertError) {
                log('error', 'Failed to revert job status.', { 
                    ...jobLogContext, 
                    revertError: revertError.message 
                });
            }
        }
    });
    
    await Promise.all(processingPromises);
    timer.end({ jobsProcessed: queuedJobs.length });
};