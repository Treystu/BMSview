/**
 * Analysis Background - Netlify Async Workload Handler
 * 
 * Processes BMS screenshot analysis jobs asynchronously using Netlify's async workload system.
 * This handler is invoked by Netlify's async workload system when analysis events are sent.
 * 
 * FEATURES:
 * ✅ Event-driven architecture (not HTTP-based)
 * ✅ Durable execution with automatic retries
 * ✅ Multi-step workflows with independent retry per step
 * ✅ Custom backoff schedules
 * ✅ Event filtering
 * ✅ State persistence across retries
 * ✅ Error handling with retry control
 * ✅ Extended execution time (no timeout limits)
 * 
 * @see https://docs.netlify.com/build/async-workloads/
 */

import { asyncWorkloadFn, ErrorDoNotRetry, ErrorRetryAfterDelay } from '@netlify/async-workloads';
import { performAnalysisPipeline } from './utils/analysis-pipeline.mjs';
import { COLLECTIONS } from './utils/collections.mjs';
import { createForwardingLogger } from './utils/log-forwarder.mjs';
import { createLogger } from './utils/logger.mjs';
import { getCollection } from './utils/mongodb.mjs';
import { calculateImageHash, checkExistingAnalysis } from './utils/unified-deduplication.mjs';

// Retry delay constants (in milliseconds)
const RATE_LIMIT_RETRY_DELAY_MS = 300000; // 5 minutes
const TRANSIENT_ERROR_RETRY_DELAY_MS = 30000; // 30 seconds

/**
 * Create or update an analysis job in the database
 */
async function createOrUpdateAnalysisJob(jobData, log) {
    const jobsCollection = await getCollection(COLLECTIONS.PENDING_JOBS);

    const jobDoc = {
        id: jobData.jobId,
        fileName: jobData.fileName,
        mimeType: jobData.mimeType,
        image: jobData.fileData,
        status: 'queued',
        createdAt: new Date(),
        lastHeartbeat: new Date(),
        retryCount: 0,
        systems: jobData.systems || { items: [] },
        // Optional fields
        ...(jobData.systemId && { systemId: jobData.systemId }),
        ...(jobData.forceReanalysis && { forceReanalysis: jobData.forceReanalysis }),
    };

    // Upsert the job document
    await jobsCollection.replaceOne(
        { id: jobData.jobId },
        jobDoc,
        { upsert: true }
    );

    log.info('Analysis job created/updated', { jobId: jobData.jobId, fileName: jobData.fileName });
    return jobDoc;
}

async function upsertAnalysisResults({ recordId, fileName, timestamp, systemId, systemName, analysis, contentHash }, log) {
    if (!contentHash || !recordId) return;
    try {
        const resultsCol = await getCollection(COLLECTIONS.ANALYSIS_RESULTS);
        await resultsCol.updateOne(
            { contentHash },
            {
                $set: {
                    id: recordId,
                    fileName,
                    timestamp,
                    systemId: systemId || null,
                    systemName: systemName || null,
                    analysis,
                    contentHash,
                    updatedAt: new Date()
                },
                $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true }
        );
    } catch (e) {
        log.warn('Failed to upsert analysis-results (non-fatal)', { error: e?.message || String(e), recordId });
    }
}

/**
 * Update job status in the database
 */
async function updateJobStatus(jobId, status, log, extra = {}) {
    const jobsCollection = await getCollection(COLLECTIONS.PENDING_JOBS);

    const logContext = { jobId, newStatus: status, ...extra };
    try {
        log.debug('Updating job status', logContext);

        const isTerminal = status === 'completed' || status.startsWith('failed');
        const updatePayload = {
            $set: { ...extra, status, lastHeartbeat: new Date() }
        };

        if (isTerminal) {
            updatePayload.$unset = { image: "" };
        }

        const result = await jobsCollection.updateOne({ id: jobId }, updatePayload);

        if (result.matchedCount > 0) {
            log.info('Job status updated successfully', logContext);
        } else {
            log.warn('Job not found for status update', logContext);
        }
    } catch (e) {
        log.error('Failed to update job status', { ...logContext, error: e.message });
    }
}

/**
 * Store a progress event for the job
 */
async function storeProgressEvent(jobId, eventData, log) {
    try {
        const collection = await getCollection(COLLECTIONS.PROGRESS_EVENTS);
        await collection.insertOne({
            jobId,
            ...eventData,
            timestamp: new Date()
        });
        log.debug('Progress event stored', { jobId, stage: eventData.stage });
    } catch (e) {
        log.error('Failed to store progress event', { jobId, error: e.message });
    }
}

/**
 * Main async workload handler
 */
const handler = asyncWorkloadFn(async (event) => {
    const { eventName, eventData, eventId, attempt, _sendEvent, step } = event;

    const log = createLogger('analysis-background', { eventId, attempt });
    log.info('Analysis async workload invoked', {
        eventName,
        eventId,
        attempt,
        hasEventData: !!eventData
    });

    // Unified logging: also forward to centralized collector
    const _forwardLog = createForwardingLogger('analysis-background');

    try {
        // Extract job details from event data
        const {
            jobId,
            fileData,
            fileName,
            mimeType,
            systemId,
            forceReanalysis,
            systems
        } = eventData || {};

        if (!jobId) {
            throw new ErrorDoNotRetry('Missing jobId in event data - cannot retry without job identifier');
        }

        // STEP 1: Initialize and validate
        await step.run('initialize-workload', async () => {
            log.info('Step 1: Initialize analysis workload', { jobId, fileName });

            // Ensure job exists in pending-jobs collection
            const jobData = {
                jobId,
                fileData,
                fileName,
                mimeType,
                systemId,
                forceReanalysis,
                systems
            };

            await createOrUpdateAnalysisJob(jobData, log);
            await updateJobStatus(jobId, 'processing', log);
            await storeProgressEvent(jobId, {
                stage: 'processing',
                progress: 10,
                message: 'Starting analysis...'
            }, log);

            log.info('Analysis workload initialized', { jobId, fileName });
        });

        // STEP 2: Load job data from database
        let jobDoc;
        await step.run('load-job-data', async () => {
            log.info('Step 2: Loading job data', { jobId });

            const jobsCollection = await getCollection(COLLECTIONS.PENDING_JOBS);
            jobDoc = await jobsCollection.findOne({ id: jobId });

            if (!jobDoc) {
                throw new ErrorDoNotRetry(`Job ${jobId} not found in database`);
            }

            if (!jobDoc.image) {
                throw new ErrorDoNotRetry(`Job ${jobId} has no image data`);
            }

            log.info('Job data loaded', {
                jobId,
                fileName: jobDoc.fileName,
                hasImage: !!jobDoc.image,
                imageBytes: jobDoc.image?.length || 0
            });
        });

        // STEP 3: Check for existing analysis by content hash (parity with sync mode)
        let contentHash = null;
        let existingRecordDoc = null;
        let isUpgrade = false;
        await step.run('check-duplicates', async () => {
            log.info('Step 3: Checking content-hash duplicates', { jobId });

            contentHash = calculateImageHash(jobDoc.image, log, { skipValidation: true });
            if (!contentHash) {
                log.warn('Failed to compute content hash for async job (will proceed without dedupe)', { jobId });
                return;
            }

            const dedupeResult = await checkExistingAnalysis(contentHash, log, jobDoc.fileName);
            isUpgrade = !!dedupeResult?._isUpgrade;
            existingRecordDoc = isUpgrade ? dedupeResult?._existingRecord : dedupeResult;
            const isDuplicate = !!existingRecordDoc && !isUpgrade;

            log.info('Async dedupe result', {
                jobId,
                hasHash: !!contentHash,
                isDuplicate,
                needsUpgrade: isUpgrade,
                forceReanalysis: !!jobDoc.forceReanalysis
            });

            // Standardize: async path returns existing record unless explicitly forced
            if (isDuplicate && !jobDoc.forceReanalysis) {
                const recordId = existingRecordDoc.id || existingRecordDoc._id;
                await updateJobStatus(jobId, 'completed', log, { recordId, completedAt: new Date() });
                await storeProgressEvent(jobId, {
                    stage: 'completed',
                    progress: 100,
                    message: 'Duplicate detected - returning existing record',
                    recordId
                }, log);

                log.info('Async job short-circuited due to duplicate', { jobId, recordId });
                return;
            }
        });

        // If we short-circuited due to duplicate, stop here.
        if (existingRecordDoc && !isUpgrade && !jobDoc.forceReanalysis) {
            return {
                success: true,
                jobId,
                recordId: existingRecordDoc.id || existingRecordDoc._id,
                fileName: jobDoc.fileName,
                isDuplicate: true
            };
        }

        // STEP 4: Perform the analysis
        let analysisRecord;
        await step.run('perform-analysis', async () => {
            log.info('Step 4: Performing BMS analysis', { jobId });

            await storeProgressEvent(jobId, {
                stage: 'analyzing',
                progress: 50,
                message: 'Extracting BMS data using AI...'
            }, log);

            // Use the existing analysis pipeline (NOTE: it expects { image, fileName, mimeType, force })
            analysisRecord = await performAnalysisPipeline(
                {
                    image: jobDoc.image,
                    fileName: jobDoc.fileName,
                    mimeType: jobDoc.mimeType,
                    force: !!jobDoc.forceReanalysis
                },
                jobDoc.systems || { items: [] },
                log,
                {
                    functionName: 'analysis-background',
                    jobId,
                    eventId
                },
                jobDoc.systemId || null
            );

            log.info('Analysis completed successfully', {
                jobId,
                recordId: analysisRecord.id,
                hasSerialNumber: !!analysisRecord.serialNumber
            });
        });

        // STEP 5: Upsert analysis-results + backfill contentHash
        await step.run('persist-analysis-results', async () => {
            if (!contentHash) {
                contentHash = calculateImageHash(jobDoc.image);
            }

            await upsertAnalysisResults({
                recordId: analysisRecord.id,
                fileName: jobDoc.fileName,
                timestamp: analysisRecord.timestamp,
                systemId: analysisRecord.systemId,
                systemName: analysisRecord.systemName,
                analysis: analysisRecord.analysis,
                contentHash
            }, log);

            try {
                const historyCol = await getCollection(COLLECTIONS.HISTORY);
                await historyCol.updateOne(
                    { id: analysisRecord.id },
                    { $set: { contentHash, analysisKey: contentHash } }
                );
            } catch (e) {
                log.warn('Failed to backfill history contentHash (non-fatal)', { error: e?.message || String(e), jobId });
            }
        });

        // STEP 6: Complete the job
        await step.run('complete-job', async () => {
            log.info('Step 6: Completing job', { jobId, recordId: analysisRecord.id });

            // If this job was a forced reanalysis of an existing record, overwrite the existing record and delete the new one.
            const shouldMergeIntoExisting = (jobDoc.forceReanalysis || isUpgrade) && existingRecordDoc && (existingRecordDoc.id || existingRecordDoc._id);
            if (shouldMergeIntoExisting) {
                const canonicalId = existingRecordDoc.id || existingRecordDoc._id;

                try {
                    const historyCol = await getCollection(COLLECTIONS.HISTORY);
                    await historyCol.updateOne(
                        { id: canonicalId },
                        {
                            $set: {
                                analysis: analysisRecord.analysis,
                                timestamp: analysisRecord.timestamp,
                                systemId: analysisRecord.systemId || null,
                                systemName: analysisRecord.systemName || null,
                                fileName: analysisRecord.fileName || jobDoc.fileName,
                                contentHash: contentHash || null,
                                analysisKey: contentHash || null,
                                updatedAt: new Date().toISOString()
                            }
                        }
                    );

                    await historyCol.deleteOne({ id: analysisRecord.id });
                    analysisRecord.id = canonicalId;
                } catch (e) {
                    log.warn('Failed to merge forced reanalysis into existing record (non-fatal)', {
                        error: e?.message || String(e),
                        jobId
                    });
                }

                await upsertAnalysisResults({
                    recordId: canonicalId,
                    fileName: jobDoc.fileName,
                    timestamp: analysisRecord.timestamp,
                    systemId: analysisRecord.systemId,
                    systemName: analysisRecord.systemName,
                    analysis: analysisRecord.analysis,
                    contentHash
                }, log);
            }

            // Ensure canonical record (whether merged or newly created) has contentHash backfilled
            if (contentHash) {
                try {
                    const historyCol = await getCollection(COLLECTIONS.HISTORY);
                    await historyCol.updateOne(
                        { id: analysisRecord.id },
                        { $set: { contentHash, analysisKey: contentHash } }
                    );
                } catch (e) {
                    log.warn('Failed to backfill history contentHash at completion (non-fatal)', { error: e?.message || String(e), jobId });
                }
            }

            await updateJobStatus(jobId, 'completed', log, {
                recordId: analysisRecord.id,
                completedAt: new Date()
            });

            await storeProgressEvent(jobId, {
                stage: 'completed',
                progress: 100,
                message: 'Analysis completed successfully',
                recordId: analysisRecord.id
            }, log);

            log.info('Job completed successfully', { jobId, recordId: analysisRecord.id });
        });

        // Return success result
        return {
            success: true,
            jobId,
            recordId: analysisRecord.id,
            fileName: jobDoc.fileName
        };

    } catch (error) {
        const { jobId } = eventData || {};

        // Store error progress event
        if (jobId) {
            await storeProgressEvent(jobId, {
                stage: 'error',
                progress: 0,
                message: `Analysis failed: ${error.message}`
            }, log);
        }

        // Determine if we should retry
        if (error instanceof ErrorDoNotRetry || attempt >= asyncWorkloadConfig.maxRetries) {
            // Mark job as permanently failed
            if (jobId) {
                await updateJobStatus(jobId, 'failed', log, {
                    error: error.message,
                    failedAt: new Date()
                });
            }

            log.error('Job failed permanently', {
                jobId,
                error: error.message,
                attempt,
                maxRetries: asyncWorkloadConfig.maxRetries
            });

            // Re-throw to prevent further retries
            throw error;
        }

        // Check for specific retryable errors
        if (error.message.includes('rate limit') || error.message.includes('quota')) {
            log.warn('Rate limit hit, scheduling retry with delay', { jobId, attempt });
            throw new ErrorRetryAfterDelay(RATE_LIMIT_RETRY_DELAY_MS);
        }

        if (error.message.includes('timeout') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('service_unavailable')) {
            log.warn('Transient error detected, will retry', { jobId, attempt, error: error.message });
            throw new ErrorRetryAfterDelay(TRANSIENT_ERROR_RETRY_DELAY_MS);
        }

        // Default: treat as transient and retry
        log.warn('Unknown error, treating as transient', { jobId, attempt, error: error.message });
        throw new ErrorRetryAfterDelay(TRANSIENT_ERROR_RETRY_DELAY_MS);
    }
});

// Export the handler
export default handler;

/**
 * Async Workload Configuration
 * 
 * This configuration tells Netlify how to handle this workload.
 * 
 * @see https://docs.netlify.com/build/async-workloads/writing-workloads/
 */
export const asyncWorkloadConfig = {
    // Workload name for identification
    name: 'analysis-background',

    // Events this workload should handle
    events: ['analyze'],

    // Maximum number of retries before dead-lettering (15 retries)
    maxRetries: 15,

    // Event filter - only process events with valid job data
    eventFilter: (event) => {
        const { eventData } = event;
        return Boolean(
            eventData &&
            eventData.jobId &&
            eventData.fileData &&
            eventData.fileName &&
            eventData.mimeType
        );
    },

    // Custom exponential backoff schedule
    // Attempt 1: 5s, Attempt 2: 10s, Attempt 3: 30s, Attempt 4+: 60s
    backoffSchedule: (attempt) => {
        if (attempt === 1) return 5000;       // 5 seconds
        if (attempt === 2) return 10000;      // 10 seconds
        if (attempt === 3) return 30000;      // 30 seconds
        return 60000;                         // 1 minute for subsequent attempts
    }
};
