/**
 * Generate Insights With Tools - Full ReAct Loop Implementation
 * 
 * This is the MAIN endpoint for generating battery insights using the ReAct loop.
 * Supports both sync and background modes with full function calling.
 * Sync mode no longer falls back to background - returns error on timeout instead.
 */

const { createLogger } = require('./utils/logger.cjs');
const { executeReActLoop } = require('./utils/react-loop.cjs');
const { 
  createInsightsJob, 
  getInsightsJob,
  updateJobStatus 
} = require('./utils/insights-jobs.cjs');
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { 
  getOrCreateResumableJob,
  validateCheckpoint,
  createCheckpointCallback,
  planResume
} = require('./utils/checkpoint-manager.cjs');

// Mode constants
const SYNC_MODE_TIMEOUT_MS = 60000; // 60s timeout for sync mode
const DEFAULT_MODE = 'sync';

/**
 * Main handler for insights generation
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLogger('generate-insights-with-tools', context);
  const startTime = Date.now();

  try {
    // Parse request
    const body = event.body ? JSON.parse(event.body) : {};
    const { 
      analysisData, 
      systemId, 
      customPrompt,
      mode = DEFAULT_MODE,
      contextWindowDays, // Optional: days of historical data to retrieve
      maxIterations, // Optional: max ReAct loop iterations
      modelOverride, // Optional: override Gemini model (e.g., "gemini-2.5-pro")
      initializationComplete, // Optional: skip initialization if already done
      resumeJobId // Optional: Job ID to resume from checkpoint
    } = body;

    // Validate input
    if (!analysisData && !systemId && !resumeJobId) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Either analysisData, systemId, or resumeJobId is required' 
        })
      };
    }

    log.info('Insights request received', {
      hasAnalysisData: !!analysisData,
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      hasResumeJobId: !!resumeJobId,
      mode,
      contextWindowDays,
      maxIterations,
      modelOverride,
      initializationComplete
    });

    // SYNC MODE: Execute ReAct loop with checkpoint/resume support
    if (mode === 'sync') {
      // Get or create resumable job
      const { job, isResume, isComplete, checkpoint } = await getOrCreateResumableJob({
        resumeJobId,
        analysisData,
        systemId,
        customPrompt,
        contextWindowDays,
        maxIterations,
        modelOverride
      }, log);

      // If job already complete, return results immediately
      if (isComplete) {
        log.info('Returning completed job results', { jobId: job.id });
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            insights: job.finalInsights,
            metadata: {
              mode: 'sync',
              jobId: job.id,
              wasResumed: false,
              fromCache: true
            }
          })
        };
      }

      // Validate checkpoint if resuming
      let resumeConfig = null;
      if (isResume && checkpoint) {
        const validation = validateCheckpoint(checkpoint, log);
        if (!validation.valid) {
          log.warn('Invalid checkpoint, starting fresh', { 
            error: validation.error,
            jobId: job.id 
          });
        } else {
          resumeConfig = planResume(checkpoint, { maxIterations, contextWindowDays }, log);
          log.info('Resuming from checkpoint', {
            jobId: job.id,
            checkpointTurn: checkpoint.turnCount,
            remainingTurns: resumeConfig.maxRemainingTurns
          });
        }
      }

      try {
        log.info(isResume ? 'Resuming sync ReAct loop' : 'Starting sync ReAct loop', {
          jobId: job.id
        });
        
        // Create checkpoint callback for this job
        const checkpointCallback = createCheckpointCallback(job.id, SYNC_MODE_TIMEOUT_MS, log);
        
        const result = await Promise.race([
          executeReActLoop({
            analysisData: job.analysisData || analysisData,
            systemId: job.systemId || systemId,
            customPrompt: job.customPrompt || customPrompt,
            log,
            mode: 'sync',
            contextWindowDays: job.contextWindowDays || contextWindowDays,
            maxIterations: job.maxIterations || maxIterations,
            modelOverride: job.modelOverride || modelOverride,
            skipInitialization: resumeConfig?.skipInitialization || initializationComplete,
            checkpointState: resumeConfig, // Pass resume config if available
            onCheckpoint: checkpointCallback // Auto-save checkpoints
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), SYNC_MODE_TIMEOUT_MS)
          )
        ]);

        if (!result || !result.success) {
          const errorMsg = result?.error || 'ReAct loop failed without error details';
          log.warn('Sync ReAct loop completed with failure', { 
            error: errorMsg,
            jobId: job.id
          });
          throw new Error(errorMsg);
        }

        const durationMs = Date.now() - startTime;

        log.info('Sync insights completed successfully', {
          jobId: job.id,
          durationMs,
          turns: result.turns || 0,
          toolCalls: result.toolCalls || 0,
          hasAnswer: !!result.finalAnswer,
          wasResumed: isResume
        });

        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            insights: {
              rawText: result.finalAnswer || '',
              contextSummary: result.contextSummary || {}
            },
            metadata: {
              mode: 'sync',
              jobId: job.id,
              turns: result.turns || 0,
              toolCalls: result.toolCalls || 0,
              durationMs,
              wasResumed: isResume,
              usedFunctionCalling: true
            }
          })
        };

      } catch (syncError) {
        log.error('Sync mode failed', {
          error: syncError.message,
          jobId: job.id,
          durationMs: Date.now() - startTime,
          timeoutMs: SYNC_MODE_TIMEOUT_MS,
          wasResumed: isResume
        });
        
        // Return error with jobId so client can resume
        return {
          statusCode: 408, // Request Timeout
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: syncError.message === 'TIMEOUT' ? 'insights_timeout' : 'insights_failed',
            message: syncError.message === 'TIMEOUT' 
              ? `Insights generation timed out after ${SYNC_MODE_TIMEOUT_MS}ms. A checkpoint was saved - retry with resumeJobId to continue.`
              : syncError.message,
            details: {
              jobId: job.id, // Include jobId for resumption
              durationMs: Date.now() - startTime,
              timeoutMs: SYNC_MODE_TIMEOUT_MS,
              canResume: syncError.message === 'TIMEOUT', // Only resume on timeout
              wasResumed: isResume
            }
          })
        };
      }
    }

    // BACKGROUND MODE: Create job and process asynchronously (only if mode === 'background')
    if (mode !== 'background') {
      log.warn('Invalid mode specified, expected sync or background', { mode });
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'invalid_mode',
          message: `Invalid mode: ${mode}. Must be 'sync' or 'background'.`
        })
      };
    }
    
    log.info('Starting background insights job');

    let job;
    try {
      job = await createInsightsJob({
        analysisData,
        systemId,
        customPrompt,
        initialSummary: null,
        contextWindowDays,
        maxIterations
      }, log);
      
      if (!job || !job.id) {
        throw new Error('Job creation returned no job ID');
      }
      
      log.info('Background job created successfully', { jobId: job.id });
    } catch (jobError) {
      log.error('Failed to create background job', {
        error: jobError.message,
        stack: jobError.stack
      });
      throw new Error(`Failed to create insights job: ${jobError.message}`);
    }

    // Start background processing (don't await)
    // Pass all parameters including contextWindowDays, maxIterations, and modelOverride
    processInsightsInBackground(
      job.id,
      analysisData,
      systemId,
      customPrompt,
      log,
      {
        contextWindowDays,
        maxIterations,
        modelOverride
      }
    ).catch(err => {
      log.error('Background processing error (logged, not thrown)', {
        jobId: job.id,
        error: err.message,
        stack: err.stack
      });
      // Update job status to failed
      updateJobStatus(job.id, 'failed', err.message, log).catch(() => {
        // Silent fail on status update
      });
    });

    return {
      statusCode: 202,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId: job.id,
        status: 'processing',
        message: 'Insights generation started in background',
        statusUrl: `/.netlify/functions/generate-insights-status?jobId=${job.id}`
      })
    };

  } catch (error) {
    log.error('Insights generation failed', {
      error: error.message,
      stack: error.stack,
      errorType: error.constructor?.name,
      durationMs: Date.now() - startTime
    });

    // Determine appropriate status code
    const statusCode = getInsightsErrorStatusCode(error);
    const errorCode = getInsightsErrorCode(error);

    return {
      statusCode,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: errorCode,
        message: error.message,
        details: {
          type: error.constructor?.name,
          recoverable: statusCode < 500
        }
      })
    };
  }
};

/**
 * Determine appropriate HTTP status code for insights errors
 */
function getInsightsErrorStatusCode(error) {
  const message = error.message || '';
  
  if (message.includes('invalid') || message.includes('required')) return 400;
  if (message.includes('timeout') || message.includes('TIMEOUT')) return 408;
  if (message.includes('quota') || message.includes('rate limit')) return 429;
  if (message.includes('ECONNREFUSED') || message.includes('unavailable')) return 503;
  
  return 500;
}

/**
 * Determine appropriate error code for insights errors
 */
function getInsightsErrorCode(error) {
  const message = error.message || '';
  
  if (message.includes('timeout') || message.includes('TIMEOUT')) return 'insights_timeout';
  if (message.includes('quota')) return 'quota_exceeded';
  if (message.includes('ECONNREFUSED')) return 'database_unavailable';
  if (message.includes('Gemini') || message.includes('API')) return 'ai_service_error';
  
  return 'insights_generation_failed';
}
