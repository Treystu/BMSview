/**
 * Insights Jobs Management Utility
 * 
 * Handles job creation, status updates, and progress tracking for 
 * background insights generation with streaming updates.
 * 
 * @module netlify/functions/utils/insights-jobs
 */

const { getCollection } = require('./mongodb.cjs');
const { createLogger } = require('./logger.cjs');

const COLLECTION_NAME = 'insights-jobs';

/**
 * Create a new insights job
 * 
 * @param {Object} params - Job parameters
 * @param {Object} params.analysisData - Battery analysis data
 * @param {string} params.systemId - BMS system ID
 * @param {string} params.customPrompt - User's custom prompt (optional)
 * @param {Object} params.initialSummary - Initial battery summary
 * @param {Object} params.contextWindowDays - Context window for analysis
 * @param {Object} params.maxIterations - Max iterations
 * @param {Object} params.modelOverride - Model override
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Created job object with jobId
 */
async function createInsightsJob(params, log) {
  const { analysisData, systemId, customPrompt, initialSummary, contextWindowDays, maxIterations, modelOverride, fullContextMode, jobId: providedJobId } = params;

  const jobId = providedJobId || `insights_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const job = {
    id: jobId,
    status: 'queued',
    analysisData,
    systemId,
    customPrompt,
    initialSummary,
    contextWindowDays,
    maxIterations,
    modelOverride,
    fullContextMode,
    progress: [],
    partialInsights: null,
    finalInsights: null,
    checkpointState: null, // For resuming after timeout
    error: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  try {
    const collection = await getCollection(COLLECTION_NAME);
    await collection.insertOne(job);

    log.info('Insights job created', {
      jobId,
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      summaryKeys: initialSummary ? Object.keys(initialSummary) : []
    });

    return job;
  } catch (error) {
    log.error('Failed to create insights job', {
      error: error.message,
      jobId
    });
    throw error;
  }
}

/**
 * Get job by ID
 * 
 * @param {string} jobId - Job ID
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} Job object or null if not found
 */
async function getInsightsJob(jobId, log) {
  try {
    const collection = await getCollection(COLLECTION_NAME);
    const job = await collection.findOne({ id: jobId });

    if (!job) {
      log.warn('Insights job not found', { jobId });
      return null;
    }

    return job;
  } catch (error) {
    log.error('Failed to get insights job', {
      error: error.message,
      jobId
    });
    throw error;
  }
}

/**
 * Update job status
 * 
 * @param {string} jobId - Job ID
 * @param {string} status - New status: 'queued', 'processing', 'completed', 'failed'
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} Success status
 */
async function updateJobStatus(jobId, status, log) {
  try {
    const collection = await getCollection(COLLECTION_NAME);
    const result = await collection.updateOne(
      { id: jobId },
      {
        $set: {
          status,
          updatedAt: new Date()
        }
      }
    );

    log.info('Job status updated', { jobId, status, matched: result.matchedCount });
    return result.matchedCount > 0;
  } catch (error) {
    log.error('Failed to update job status', {
      error: error.message,
      jobId,
      status
    });
    throw error;
  }
}

/**
 * Add progress event to job
 * 
 * @param {string} jobId - Job ID
 * @param {Object} progressEvent - Progress event data
 * @param {string} progressEvent.type - Event type: 'tool_call', 'tool_response', 'ai_response', 'error'
 * @param {Object} progressEvent.data - Event data
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} Success status
 */
async function addProgressEvent(jobId, progressEvent, log) {
  try {
    const event = {
      timestamp: new Date(),
      ...progressEvent
    };

    const collection = await getCollection(COLLECTION_NAME);
    const result = await collection.updateOne(
      { id: jobId },
      {
        $push: { progress: event },
        $set: { updatedAt: new Date() }
      }
    );

    log.debug('Progress event added', {
      jobId,
      eventType: progressEvent.type,
      matched: result.matchedCount
    });

    return result.matchedCount > 0;
  } catch (error) {
    log.error('Failed to add progress event', {
      error: error.message,
      jobId,
      eventType: progressEvent.type
    });
    throw error;
  }
}

/**
 * Update partial insights
 * 
 * @param {string} jobId - Job ID
 * @param {string} partialInsights - Partial insights text
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} Success status
 */
async function updatePartialInsights(jobId, partialInsights, log) {
  try {
    const collection = await getCollection(COLLECTION_NAME);
    const result = await collection.updateOne(
      { id: jobId },
      {
        $set: {
          partialInsights,
          updatedAt: new Date()
        }
      }
    );

    log.debug('Partial insights updated', {
      jobId,
      insightsLength: partialInsights?.length,
      matched: result.matchedCount
    });

    return result.matchedCount > 0;
  } catch (error) {
    log.error('Failed to update partial insights', {
      error: error.message,
      jobId
    });
    throw error;
  }
}

/**
 * Complete job with final insights
 * 
 * @param {string} jobId - Job ID
 * @param {Object} finalInsights - Final insights result
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} Success status
 */
async function completeJob(jobId, finalInsights, log) {
  try {
    const collection = await getCollection(COLLECTION_NAME);
    const result = await collection.updateOne(
      { id: jobId },
      {
        $set: {
          status: 'completed',
          finalInsights,
          updatedAt: new Date()
        }
      }
    );

    log.info('Job completed', {
      jobId,
      matched: result.matchedCount
    });

    return result.matchedCount > 0;
  } catch (error) {
    log.error('Failed to complete job', {
      error: error.message,
      jobId
    });
    throw error;
  }
}

/**
 * Fail job with error
 * 
 * @param {string} jobId - Job ID
 * @param {string} errorMessage - Error message
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} Success status
 */
async function failJob(jobId, errorMessage, log) {
  try {
    const collection = await getCollection(COLLECTION_NAME);
    const result = await collection.updateOne(
      { id: jobId },
      {
        $set: {
          status: 'failed',
          error: errorMessage,
          updatedAt: new Date()
        }
      }
    );

    log.warn('Job failed', {
      jobId,
      error: errorMessage,
      matched: result.matchedCount
    });

    return result.matchedCount > 0;
  } catch (error) {
    log.error('Failed to mark job as failed', {
      error: error.message,
      jobId
    });
    throw error;
  }
}

/**
 * Save checkpoint state for resuming after timeout
 * EDGE CASE PROTECTION: Includes retry logic to handle MongoDB errors
 * 
 * @param {string} jobId - Job ID
 * @param {Object} checkpointState - State to save
 * @param {Array} checkpointState.conversationHistory - Conversation history
 * @param {number} checkpointState.turnCount - Current turn count
 * @param {number} checkpointState.toolCallCount - Tool call count
 * @param {Object} checkpointState.contextSummary - Context summary
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} Success status
 */
async function saveCheckpoint(jobId, checkpointState, log) {
  const MAX_SAVE_RETRIES = 3;
  const BASE_RETRY_DELAY_MS = 200; // Base delay for linear backoff (200ms, 400ms, 600ms)

  for (let attempt = 1; attempt <= MAX_SAVE_RETRIES; attempt++) {
    try {
      const collection = await getCollection(COLLECTION_NAME);
      const result = await collection.updateOne(
        { id: jobId },
        {
          $set: {
            checkpointState,
            updatedAt: new Date()
          }
        },
        {
          // EDGE CASE PROTECTION: Set short timeout on MongoDB operation
          maxTimeMS: 2000 // 2 second max
        }
      );

      log.info('Checkpoint saved', {
        jobId,
        turnCount: checkpointState.turnCount,
        toolCallCount: checkpointState.toolCallCount,
        historyLength: checkpointState.conversationHistory?.length,
        matched: result.matchedCount,
        attempt
      });

      return result.matchedCount > 0;
    } catch (error) {
      const isLastAttempt = attempt === MAX_SAVE_RETRIES;

      log.warn(`Failed to save checkpoint (attempt ${attempt}/${MAX_SAVE_RETRIES})`, {
        error: error.message,
        jobId,
        willRetry: !isLastAttempt
      });

      if (isLastAttempt) {
        // EDGE CASE PROTECTION: Don't throw - return false to indicate failure
        // This prevents checkpoint save failure from crashing the entire function
        log.error('Checkpoint save failed after all retries', {
          jobId,
          error: error.message,
          attempts: MAX_SAVE_RETRIES
        });
        return false;
      }

      // Wait before retry with linear backoff (200ms, 400ms, 600ms)
      await new Promise(resolve => setTimeout(resolve, BASE_RETRY_DELAY_MS * attempt));
    }
  }

  return false; // Should never reach here, but be safe
}

/**
 * Ensure indexes for insights-jobs collection
 * Should be called on application startup or first use
 * 
 * @param {Object} log - Logger instance
 */
async function ensureIndexes(log) {
  try {
    const collection = await getCollection(COLLECTION_NAME);

    // Index on job ID for fast lookups
    await collection.createIndex({ id: 1 }, { unique: true });

    // Index on status and creation time for cleanup queries
    await collection.createIndex({ status: 1, createdAt: 1 });

    // TTL index to auto-cleanup old jobs after 30 days
    // Note: If a TTL index with different expireAfterSeconds exists, it won't be updated.
    // Manual cleanup required: db.insights-jobs.dropIndex({ createdAt: 1 })
    // Then restart the application to recreate with new settings.
    await collection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 2592000 } // 30 days
    );

    log.info('Insights jobs indexes ensured');
  } catch (error) {
    log.error('Failed to ensure indexes', { error: error.message });
    // Don't throw - indexes are optimization, not critical
  }
}

module.exports = {
  createInsightsJob,
  getInsightsJob,
  updateJobStatus,
  addProgressEvent,
  updatePartialInsights,
  completeJob,
  failJob,
  saveCheckpoint,
  ensureIndexes
};
