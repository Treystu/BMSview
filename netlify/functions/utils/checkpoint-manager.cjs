/**
 * Checkpoint Manager - Context-Aware Intermediary for Long-Running Insights
 * 
 * This module acts as a smart intermediary between the function handler and the ReAct loop,
 * managing state persistence, resumption, and context across multiple invocations.
 * 
 * Key responsibilities:
 * 1. Save conversation state before timeout
 * 2. Load and validate checkpoint state on resume
 * 3. Manage context size and optimization
 * 4. Coordinate between sync retries and background fallback
 * 
 * @module netlify/functions/utils/checkpoint-manager
 */

const { saveCheckpoint, getInsightsJob, createInsightsJob } = require('./insights-jobs.cjs');
const { createLogger } = require('./logger.cjs');

// Constants
const CHECKPOINT_SAVE_THRESHOLD_MS = 55000; // Save checkpoint at 55s (before 60s timeout)
const MAX_RETRY_ATTEMPTS = 3; // Maximum number of resume attempts
const CONTEXT_COMPRESSION_THRESHOLD = 50; // Compress history after 50 turns

/**
 * Create or get a resumable job for insights generation
 * 
 * @param {Object} params - Job parameters
 * @param {string} params.resumeJobId - Optional job ID to resume
 * @param {Object} params.analysisData - Battery analysis data
 * @param {string} params.systemId - System ID
 * @param {string} params.customPrompt - Custom prompt
 * @param {number} params.contextWindowDays - Context window
 * @param {number} params.maxIterations - Max iterations
 * @param {string} params.modelOverride - Model override
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Job object with resume capability
 */
async function getOrCreateResumableJob(params, log) {
  const { 
    resumeJobId, 
    analysisData, 
    systemId, 
    customPrompt,
    contextWindowDays,
    maxIterations,
    modelOverride
  } = params;

  // If resumeJobId provided, try to load existing job
  if (resumeJobId) {
    log.info('Attempting to resume existing job', { resumeJobId });
    
    const existingJob = await getInsightsJob(resumeJobId, log);
    
    if (!existingJob) {
      log.warn('Resume job not found, creating new job', { resumeJobId });
      // Fall through to create new job
    } else if (existingJob.status === 'completed') {
      log.info('Job already completed, returning final insights', { resumeJobId });
      return {
        job: existingJob,
        isResume: false,
        isComplete: true
      };
    } else if (existingJob.status === 'failed') {
      log.warn('Resume job previously failed, creating new job', { 
        resumeJobId,
        previousError: existingJob.error 
      });
      // Fall through to create new job
    } else {
      // Job exists and is resumable
      log.info('Found resumable job', { 
        resumeJobId,
        status: existingJob.status,
        hasCheckpoint: !!existingJob.checkpointState,
        checkpointTurnCount: existingJob.checkpointState?.turnCount
      });
      
      return {
        job: existingJob,
        isResume: true,
        isComplete: false,
        checkpoint: existingJob.checkpointState
      };
    }
  }

  // Create new job
  log.info('Creating new resumable job');
  
  const newJob = await createInsightsJob({
    analysisData,
    systemId,
    customPrompt,
    initialSummary: null,
    contextWindowDays,
    maxIterations,
    modelOverride
  }, log);

  return {
    job: newJob,
    isResume: false,
    isComplete: false,
    checkpoint: null
  };
}

/**
 * Create checkpoint state from current ReAct loop state
 * 
 * @param {Object} state - Current state
 * @param {Array} state.conversationHistory - Conversation history
 * @param {number} state.turnCount - Current turn
 * @param {number} state.toolCallCount - Tool calls made
 * @param {Object} state.contextSummary - Context summary
 * @param {number} state.startTime - Loop start time
 * @returns {Object} Checkpoint state
 */
function createCheckpointState(state) {
  const { conversationHistory, turnCount, toolCallCount, contextSummary, startTime } = state;
  
  // Compress conversation history if too large
  const compressedHistory = compressConversationHistory(conversationHistory, turnCount);
  
  return {
    conversationHistory: compressedHistory,
    turnCount,
    toolCallCount,
    contextSummary,
    checkpointedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startTime,
    version: '1.0' // For future compatibility
  };
}

/**
 * Compress conversation history to reduce checkpoint size
 * Keeps initial context and recent turns, summarizes middle turns
 * 
 * @param {Array} history - Full conversation history
 * @param {number} currentTurn - Current turn number
 * @returns {Array} Compressed history
 */
function compressConversationHistory(history, currentTurn) {
  // If history is small, don't compress
  if (history.length < CONTEXT_COMPRESSION_THRESHOLD) {
    return history;
  }
  
  // Keep first 5 exchanges (initial prompt + setup)
  const keepInitial = 5;
  // Keep last 20 exchanges (recent context)
  const keepRecent = 20;
  
  const initial = history.slice(0, keepInitial);
  const recent = history.slice(-keepRecent);
  
  // Create summary marker for omitted section
  const omittedCount = history.length - keepInitial - keepRecent;
  const summaryMarker = {
    role: 'user',
    parts: [{
      text: `[Checkpoint: ${omittedCount} conversation turns omitted for space. Resumed at turn ${currentTurn}]`
    }]
  };
  
  return [...initial, summaryMarker, ...recent];
}

/**
 * Validate checkpoint state before resuming
 * 
 * @param {Object} checkpoint - Checkpoint state
 * @param {Object} log - Logger instance
 * @returns {Object} Validation result { valid: boolean, error?: string }
 */
function validateCheckpoint(checkpoint, log) {
  if (!checkpoint) {
    return { valid: false, error: 'No checkpoint state provided' };
  }
  
  if (!checkpoint.conversationHistory || !Array.isArray(checkpoint.conversationHistory)) {
    return { valid: false, error: 'Invalid or missing conversation history' };
  }
  
  if (typeof checkpoint.turnCount !== 'number' || checkpoint.turnCount < 0) {
    return { valid: false, error: 'Invalid turn count' };
  }
  
  if (typeof checkpoint.toolCallCount !== 'number' || checkpoint.toolCallCount < 0) {
    return { valid: false, error: 'Invalid tool call count' };
  }
  
  // Check version compatibility
  if (checkpoint.version && checkpoint.version !== '1.0') {
    log.warn('Checkpoint version mismatch', { 
      checkpointVersion: checkpoint.version,
      currentVersion: '1.0'
    });
    // Continue anyway - might still work
  }
  
  log.info('Checkpoint validation passed', {
    historyLength: checkpoint.conversationHistory.length,
    turnCount: checkpoint.turnCount,
    toolCallCount: checkpoint.toolCallCount,
    checkpointAge: checkpoint.checkpointedAt 
      ? Date.now() - new Date(checkpoint.checkpointedAt).getTime() 
      : 'unknown'
  });
  
  return { valid: true };
}

/**
 * Context-aware checkpoint saver with automatic timeout detection
 * Creates a checkpoint callback that monitors elapsed time and saves state before timeout
 * 
 * @param {string} jobId - Job ID to save checkpoint for
 * @param {number} timeoutMs - Timeout threshold in milliseconds
 * @param {Object} log - Logger instance
 * @returns {Function} Checkpoint callback function
 */
function createCheckpointCallback(jobId, timeoutMs, log) {
  const checkpointThreshold = Math.min(timeoutMs - 5000, CHECKPOINT_SAVE_THRESHOLD_MS);
  let lastCheckpointTime = Date.now();
  
  return async function(currentState) {
    const now = Date.now();
    const elapsed = now - currentState.startTime;
    const timeSinceLastCheckpoint = now - lastCheckpointTime;
    
    // Only save checkpoint if approaching timeout and enough time has passed since last save
    if (elapsed > checkpointThreshold && timeSinceLastCheckpoint > 10000) {
      log.info('Approaching timeout, saving checkpoint', {
        jobId,
        elapsedMs: elapsed,
        thresholdMs: checkpointThreshold,
        turnCount: currentState.turnCount
      });
      
      const checkpoint = createCheckpointState(currentState);
      await saveCheckpoint(jobId, checkpoint, log);
      lastCheckpointTime = now;
      
      return true; // Checkpoint saved
    }
    
    return false; // No checkpoint needed yet
  };
}

/**
 * Smart resume logic that determines how to continue from checkpoint
 * 
 * @param {Object} checkpoint - Checkpoint state
 * @param {Object} params - Original parameters
 * @param {Object} log - Logger instance
 * @returns {Object} Resume configuration
 */
function planResume(checkpoint, params, log) {
  const { maxIterations, contextWindowDays } = params;
  const { turnCount, toolCallCount } = checkpoint;
  
  // Calculate remaining budget
  const remainingTurns = maxIterations ? maxIterations - turnCount : 10;
  
  log.info('Planning resume strategy', {
    checkpointTurn: turnCount,
    checkpointToolCalls: toolCallCount,
    remainingTurns,
    maxIterations
  });
  
  return {
    conversationHistory: checkpoint.conversationHistory,
    startTurnCount: turnCount,
    startToolCallCount: toolCallCount,
    contextSummary: checkpoint.contextSummary,
    maxRemainingTurns: remainingTurns,
    skipInitialization: true // Already initialized in previous run
  };
}

module.exports = {
  getOrCreateResumableJob,
  createCheckpointState,
  validateCheckpoint,
  createCheckpointCallback,
  planResume,
  compressConversationHistory,
  CHECKPOINT_SAVE_THRESHOLD_MS,
  MAX_RETRY_ATTEMPTS
};
