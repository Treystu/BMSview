/**
 * Insights Processor - Background AI Processing Logic
 * 
 * Extracted from generate-insights-background.cjs to be reusable.
 * Handles the core AI function calling loop with progress tracking.
 * NOW UPDATED to use executeReActLoop (same as sync mode) for consistency.
 * 
 * @module netlify/functions/utils/insights-processor
 */

const { executeReActLoop, DEFAULT_MAX_TURNS } = require('./react-loop.cjs');
const { generateFullContextInsights } = require('./full-context-logic.cjs');
const {
  updateJobStatus,
  addProgressEvent,
  completeJob,
  failJob
} = require('./insights-jobs.cjs');

// Processing constants
const TOTAL_TIMEOUT_MS = 14 * 60 * 1000; // 14 minutes for background mode

/**
 * Main background processing function
 * 
 * @param {string} jobId - Job identifier
 * @param {Object} analysisData - Battery analysis data
 * @param {string} systemId - Optional system ID
 * @param {string} customPrompt - Optional custom user prompt
 * @param {Object} log - Logger instance
 * @param {Object} options - Optional parameters
 * @param {number} options.contextWindowDays - Days of historical context
 * @param {number} options.maxIterations - Max ReAct iterations
 * @param {string} options.modelOverride - Gemini model override
 * @param {boolean} options.fullContextMode - Whether to use Full Context mode
 * @returns {Promise<Object>} Processing result
 */
async function processInsightsInBackground(jobId, analysisData, systemId, customPrompt, log, options = {}) {
  // CRITICAL: Log immediately at function entry for debugging
  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: new Date().toISOString(),
    message: 'processInsightsInBackground ENTRY',
    context: { jobId, hasSystemId: !!systemId, hasCustomPrompt: !!customPrompt }
  }));

  // Checkpoint tracking for granular debugging
  const checkpoints = {
    entry: Date.now(),
    statusUpdate: null,
    reactLoopStart: null,
    reactLoopEnd: null,
    jobComplete: null
  };

  try {
    const { contextWindowDays, maxIterations, modelOverride, fullContextMode } = options;

    log.info('Background processing started', {
      jobId,
      hasSystemId: !!systemId,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode
    });

    // Checkpoint: Update job status
    checkpoints.statusUpdate = Date.now();
    log.info('Checkpoint: Updating job status to processing', {
      jobId,
      elapsed: checkpoints.statusUpdate - checkpoints.entry
    });

    await updateJobStatus(jobId, 'processing', log);
    await addProgressEvent(jobId, {
      type: 'status',
      data: { message: fullContextMode ? 'Analyzing full historical context...' : 'AI analysis starting...' }
    }, log);

    // Checkpoint: Start ReAct loop or Full Context
    checkpoints.reactLoopStart = Date.now();
    log.info('Checkpoint: Starting analysis logic', {
      jobId,
      elapsed: checkpoints.reactLoopStart - checkpoints.entry
    });

    let result;

    if (fullContextMode) {
      // FULL CONTEXT MODE
      log.info('Running Full Context analysis in background', { jobId });
      const fcResult = await generateFullContextInsights({
        systemId,
        enableFeedback: true,
        contextWindowDays,
        customPrompt,
        // recentHistory is not needed here as we are in background and should read from DB
      }, log, {}); // Context empty

      // Map to standardized result structure
      result = {
        success: true,
        finalAnswer: fcResult.insights.rawText,
        contextSummary: {
          pointsAnalyzed: fcResult.metadata.dataPointsAnalyzed,
          mode: 'full-context'
        },
        turns: 1,
        toolCalls: fcResult.feedbackSubmitted.length
      };
    } else {
      // STANDARD REACT LOOP MODE
      result = await executeReActLoop({
        analysisData,
        systemId,
        customPrompt,
        log,
        mode: 'background',
        contextWindowDays,
        maxIterations,
        modelOverride,
        skipInitialization: false // Run full initialization in background
      });
    }

    // Checkpoint: Logic complete
    checkpoints.reactLoopEnd = Date.now();
    log.info('Checkpoint: Analysis logic completed', {
      jobId,
      elapsed: checkpoints.reactLoopEnd - checkpoints.reactLoopStart,
      totalElapsed: checkpoints.reactLoopEnd - checkpoints.entry,
      success: result?.success
    });

    if (!result || !result.success) {
      const errorMsg = result?.error || 'Analysis failed without error details';
      log.error('Background analysis failed', {
        jobId,
        error: errorMsg,
        turns: result?.turns,
        toolCalls: result?.toolCalls
      });
      throw new Error(errorMsg);
    }

    log.info('Background analysis completed successfully', {
      jobId,
      turns: result.turns || 0,
      toolCalls: result.toolCalls || 0,
      hasAnswer: !!result.finalAnswer,
      duration: checkpoints.reactLoopEnd - checkpoints.reactLoopStart
    });

    // Checkpoint: Formatting insights
    const formatStart = Date.now();
    log.info('Checkpoint: Formatting insights for storage', {
      jobId,
      elapsed: formatStart - checkpoints.reactLoopEnd
    });

    // Format insights for storage
    const insights = {
      rawText: result.finalAnswer || '',
      contextSummary: result.contextSummary || {},
      metadata: {
        mode: fullContextMode ? 'full-context-background' : 'background',
        turns: result.turns || 0,
        toolCalls: result.toolCalls || 0,
        usedFunctionCalling: true,
        checkpoints: {
          totalDuration: formatStart - checkpoints.entry,
          analysisDuration: checkpoints.reactLoopEnd - checkpoints.reactLoopStart, // Renamed from reactLoopDuration
          initDuration: checkpoints.reactLoopStart - checkpoints.entry
        }
      }
    };

    // Checkpoint: Mark job as complete
    const completeStart = Date.now();
    log.info('Checkpoint: Marking job as complete', {
      jobId,
      elapsed: completeStart - formatStart
    });

    // Mark job as complete
    await completeJob(jobId, insights, log);
    await addProgressEvent(jobId, {
      type: 'status',
      data: { message: 'Analysis completed successfully' }
    }, log);

    checkpoints.jobComplete = Date.now();
    log.info('Background processing completed', {
      jobId,
      turns: result.turns,
      toolCalls: result.toolCalls,
      totalDuration: checkpoints.jobComplete - checkpoints.entry,
      checkpoints: {
        init: checkpoints.reactLoopStart - checkpoints.entry,
        analysis: checkpoints.reactLoopEnd - checkpoints.reactLoopStart,
        formatting: completeStart - checkpoints.reactLoopEnd,
        completion: checkpoints.jobComplete - completeStart
      }
    });

    return { success: true, insights };

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Determine which checkpoint was reached last
    const getLastCheckpoint = () => {
      if (checkpoints.reactLoopEnd) return 'reactLoopEnd';
      if (checkpoints.reactLoopStart) return 'reactLoopStart';
      if (checkpoints.statusUpdate) return 'statusUpdate';
      return 'entry';
    };

    // Log detailed error with checkpoint information
    log.error('Background processing failed', {
      jobId,
      error: err.message,
      stack: err.stack,
      checkpoints: {
        failedAt: Date.now() - checkpoints.entry,
        lastCheckpoint: getLastCheckpoint()
      }
    });

    // Mark job as failed
    await failJob(jobId, err.message, log);
    await addProgressEvent(jobId, {
      type: 'error',
      data: {
        error: err.message
      }
    }, log);

    throw error;
  }
}

module.exports = {
  processInsightsInBackground
};
