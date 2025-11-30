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
// CRITICAL: Netlify timeout limits (10s free, 26s pro)
// Save checkpoint well before timeout to ensure we can respond
const NETLIFY_TIMEOUT_MS = parseInt(process.env.NETLIFY_FUNCTION_TIMEOUT_MS || '20000'); // 20s safe default
const CHECKPOINT_SAVE_THRESHOLD_MS = Math.max(NETLIFY_TIMEOUT_MS - 2000, 5000); // Save 2s before timeout (~18s)
const MAX_RETRY_ATTEMPTS = 10; // Maximum number of resume attempts (10 attempts * 20s = 200s total = ~3.3 minutes max)
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
      const checkpoint = existingJob.checkpointState;
      const previousTurn = checkpoint?.turnCount || 0;
      const previousRetryCount = checkpoint?.sameCheckpointRetryCount || 0;
      
      log.info('Found resumable job', { 
        resumeJobId,
        status: existingJob.status,
        hasCheckpoint: !!checkpoint,
        checkpointTurnCount: previousTurn,
        previousRetryCount
      });
      
      // STALL DETECTION: If we're resuming from the same turn multiple times,
      // the model may be too slow for our timeout budget (e.g., gemini-2.5-pro)
      // After 5 retries at the same turn, fail with helpful message
      const MAX_SAME_TURN_RETRIES = 5;
      if (previousRetryCount >= MAX_SAME_TURN_RETRIES) {
        log.error('Job stalled - no progress after multiple retries at same checkpoint', {
          resumeJobId,
          turnCount: previousTurn,
          retryCount: previousRetryCount,
          maxRetries: MAX_SAME_TURN_RETRIES
        });
        
        return {
          job: existingJob,
          isResume: false,
          isComplete: false,
          isStalled: true,
          stalledReason: `The AI model is too slow for the current timeout configuration. After ${previousRetryCount} attempts, no progress was made beyond turn ${previousTurn}. Try using a faster model (gemini-2.5-flash) or reduce the complexity of your query.`
        };
      }
      
      // Increment retry count if resuming at same turn
      // This helps detect if we're stuck at the same point
      if (checkpoint) {
        checkpoint.sameCheckpointRetryCount = (checkpoint.sameCheckpointRetryCount || 0) + 1;
        checkpoint.lastResumeAttempt = new Date().toISOString();
      }
      
      return {
        job: existingJob,
        isResume: true,
        isComplete: false,
        checkpoint
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
function createCheckpointState(state, previousCheckpoint = null) {
  const { conversationHistory, turnCount, toolCallCount, contextSummary, startTime } = state;
  
  // Compress conversation history if too large
  const compressedHistory = compressConversationHistory(conversationHistory, turnCount);
  
  // Track retry count at same turn for stall detection
  // Reset to 0 if progress was made (turn advanced), otherwise keep previous count
  const previousTurn = previousCheckpoint?.turnCount || 0;
  const madeProgress = turnCount > previousTurn;
  const sameCheckpointRetryCount = madeProgress ? 0 : (previousCheckpoint?.sameCheckpointRetryCount || 0);
  
  return {
    conversationHistory: compressedHistory,
    turnCount,
    toolCallCount,
    contextSummary,
    checkpointedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startTime,
    sameCheckpointRetryCount, // Track stalled retries
    version: '1.0' // For future compatibility
  };
}

/**
 * Compress conversation history to reduce checkpoint size
 * Keeps initial context and recent turns, summarizes middle turns
 * EDGE CASE PROTECTION: More aggressive compression for memory safety
 * 
 * @param {Array} history - Full conversation history
 * @param {number} currentTurn - Current turn number
 * @returns {Array} Compressed history
 */
function compressConversationHistory(history, currentTurn) {
  // EDGE CASE PROTECTION #5: More aggressive compression threshold
  const MEMORY_SAFE_THRESHOLD = 30; // Compress after 30 exchanges instead of 50
  
  // If history is small, don't compress
  if (history.length < MEMORY_SAFE_THRESHOLD) {
    return history;
  }
  
  // EDGE CASE PROTECTION #6: Keep fewer messages to prevent memory issues
  // Keep first 3 exchanges (initial prompt + setup)
  const keepInitial = 3;
  // Keep last 15 exchanges (recent context) - reduced from 20
  const keepRecent = 15;
  
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
  let lastCheckpointTime = Date.now();
  
  return async function(currentState) {
    const now = Date.now();
    const elapsed = now - currentState.startTime;
    const timeSinceLastCheckpoint = now - lastCheckpointTime;
    
    // ALWAYS save checkpoint when called by the react-loop.
    // Previously this had conditional logic that could skip saves, but the react-loop
    // is responsible for deciding when to checkpoint, so we should always save here.
    // This ensures we never lose conversation history on timeout.
    log.info('Saving checkpoint', {
      jobId,
      elapsedMs: elapsed,
      turnCount: currentState.turnCount,
      historyLength: currentState.conversationHistory?.length || 0,
      timeSinceLastCheckpoint
    });
    
    const checkpoint = createCheckpointState(currentState);
    await saveCheckpoint(jobId, checkpoint, log);
    lastCheckpointTime = now;
    
    return true; // Checkpoint saved
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
