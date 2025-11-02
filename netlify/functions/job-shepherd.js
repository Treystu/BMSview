const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger, createTimer } = require("./utils/logger.cjs");

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

            const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
            log('info', 'Invoking background processor.', { 
                   ...jobLogContext, 
                   invokeUrl,
                   environment: process.env.NODE_ENV || 'unknown',
                   functionUrl: process.env.URL || 'not-set'
               });
            
            const response = await fetch(invokeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-netlify-background': 'true' },
                body: JSON.stringify({ jobId: job.id }),
            });
            
            if (response.status !== 202 && response.status !== 200) {
                throw new Error(`Background function invocation failed with status: ${response.status}`);
            }
            
            log('info', 'Successfully invoked background processor.', { 
                ...jobLogContext, 
                responseStatus: response.status 
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

const auditJobs = async (jobsCollection, shepherdState, log) => {
    const timer = createTimer(log, 'audit-jobs');
    log('debug', 'Phase 2: Auditing jobs.');
    const now = new Date();

    // Audit terminal jobs for cleanup
    const terminalCutoff = new Date(now.getTime() - TERMINAL_JOB_TTL_SECONDS * 1000);
    log('debug', 'Checking for stale terminal jobs.', { 
        cutoffTime: terminalCutoff.toISOString(),
        ttlSeconds: TERMINAL_JOB_TTL_SECONDS 
    });
    
    const { deletedCount } = await jobsCollection.deleteMany({
        status: { $in: ['completed', 'failed_timeout'] },
        statusEnteredAt: { $lt: terminalCutoff }
    });
    
    if (deletedCount > 0) {
        log('info', `Cleaned up ${deletedCount} stale terminal jobs.`, { 
            deletedCount,
            cutoffTime: terminalCutoff.toISOString() 
        });
    } else {
        log('debug', 'No stale terminal jobs to clean up.');
    }

    // Audit in-progress jobs for timeout
    const processingTimeout = new Date(now.getTime() - STAGE_TIMEOUT_SECONDS * 1000);
    log('debug', 'Checking for zombie jobs (timed out processing).', { 
        timeoutThreshold: processingTimeout.toISOString(),
        timeoutSeconds: STAGE_TIMEOUT_SECONDS 
    });
    
    const zombieJobs = await jobsCollection.find({
        status: 'Processing',
        lastHeartbeat: { $lt: processingTimeout }
    }).limit(AUDIT_BATCH_SIZE).toArray();
    
    if (zombieJobs.length === 0) {
        log('debug', 'No zombie jobs found.');
        if (shepherdState.consecutiveFailures > 0) {
            log('info', 'Clean audit run. Resetting consecutive failure count.', {
                previousFailures: shepherdState.consecutiveFailures
            });
            shepherdState.consecutiveFailures = 0;
            shepherdState.lastFailureReason = null;
        }
    } else {
        log('warn', `Found ${zombieJobs.length} zombie jobs.`, {
            zombieJobIds: zombieJobs.map(j => j.id),
            zombieJobDetails: zombieJobs.map(j => ({
                id: j.id,
                fileName: j.fileName,
                retryCount: j.retryCount || 0,
                lastHeartbeat: j.lastHeartbeat
            }))
        });
        
        shepherdState.lastFailureReason = 'stage_timeout';
        shepherdState.consecutiveFailures += zombieJobs.length;

        for (const job of zombieJobs) {
            const jobContext = { 
                jobId: job.id, 
                fileName: job.fileName,
                retryCount: job.retryCount || 0,
                maxRetries: MAX_RETRIES
            };
            
            if ((job.retryCount || 0) < MAX_RETRIES) {
                log('info', 'Re-queueing zombie job for retry.', jobContext);
                await jobsCollection.updateOne(
                    { _id: job._id }, 
                    { $set: { 
                        status: 'Queued', 
                        retryCount: (job.retryCount || 0) + 1,
                        lastFailureReason: 'Processing timeout',
                        requeuedAt: new Date().toISOString()
                    } }
                );
            } else {
                log('error', 'Job has exhausted all retries. Marking as failed.', jobContext);
                await jobsCollection.updateOne(
                    { _id: job._id }, 
                    { $set: { 
                        status: 'failed_timeout', 
                        error: `Job failed after ${MAX_RETRIES} retries due to processing timeout.`,
                        failedAt: new Date().toISOString()
                    } }
                );
            }
        }
    }
    
    if (shepherdState.consecutiveFailures >= FAILURE_THRESHOLD) {
        shepherdState.breakerTrippedUntil = new Date(Date.now() + COOLDOWN_PERIOD_MS);
        log('error', `CIRCUIT BREAKER TRIPPED for ${COOLDOWN_PERIOD_MS / 1000}s.`, { 
            reason: shepherdState.lastFailureReason,
            consecutiveFailures: shepherdState.consecutiveFailures,
            threshold: FAILURE_THRESHOLD,
            trippedUntil: shepherdState.breakerTrippedUntil.toISOString()
        });
    } else if (LOG_CONFIG.logCircuitBreakerState) {
        log('debug', 'Circuit breaker state.', {
            consecutiveFailures: shepherdState.consecutiveFailures,
            threshold: FAILURE_THRESHOLD,
            isTripped: false
        });
    }
    
    timer.end({ zombieJobsFound: zombieJobs.length, deletedCount });
};

exports.handler = async function(event, context) {
    const log = createLogger('job-shepherd', context);
    const totalTimer = createTimer(log, 'shepherd-total');
    
    log('info', 'Shepherd function invoked by schedule.');
    log('debug', 'Shepherd invocation details.', { 
        eventType: event.headers?.['x-netlify-event'],
        remainingTimeMs: context.getRemainingTimeInMillis?.()
    });

    try {
        const jobsCollection = await getCollection("jobs");
        const shepherdCollection = await getCollection("shepherd_state");
        const shepherdState = await getShepherdState(shepherdCollection, log);

        log('debug', 'Shepherd state retrieved.', {
            consecutiveFailures: shepherdState.consecutiveFailures,
            lastFailureReason: shepherdState.lastFailureReason,
            breakerTrippedUntil: shepherdState.breakerTrippedUntil
        });

        if (shepherdState.breakerTrippedUntil && new Date() < new Date(shepherdState.breakerTrippedUntil)) {
            const remainingCooldown = Math.round((new Date(shepherdState.breakerTrippedUntil) - new Date()) / 1000);
            log('warn', 'Circuit breaker is tripped. Skipping run.', { 
                until: shepherdState.breakerTrippedUntil,
                remainingCooldownSeconds: remainingCooldown,
                reason: shepherdState.lastFailureReason
            });
            return { statusCode: 200, body: 'Circuit breaker tripped.' };
        }

        // Get queue statistics before processing
        const queueStats = await jobsCollection.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();
        
        log('info', 'Current queue statistics.', { 
            stats: queueStats.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {})
        });

        await processQueue(jobsCollection, log);
        await auditJobs(jobsCollection, shepherdState, log);
        await saveShepherdState(shepherdCollection, shepherdState, log);
        
        const duration = totalTimer.end();
        log('info', 'Shepherd run completed successfully.', { 
            totalDurationMs: duration,
            finalState: {
                consecutiveFailures: shepherdState.consecutiveFailures,
                breakerTripped: !!shepherdState.breakerTrippedUntil
            }
        });
        
        return { statusCode: 200, body: 'Shepherd run completed.' };

    } catch (error) {
        log('error', 'Critical error in job-shepherd handler.', { 
            errorMessage: error.message, 
            stack: error.stack 
        });
        return { statusCode: 500, body: 'An internal error occurred.' };
    }
};
