/**
 * Generate Insights With Tools - Full ReAct Loop Implementation
 * 
 * This is the MAIN endpoint for generating battery insights using the ReAct loop.
 * Supports both sync (55s) and background modes with full function calling.
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

// Mode constants
const SYNC_MODE_TIMEOUT_MS = 55000; // 55s for Netlify function timeout
const DEFAULT_MODE = 'sync'; // Start with sync, auto-fallback to background if needed

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
      mode = DEFAULT_MODE 
    } = body;

    // Validate input
    if (!analysisData && !systemId) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Either analysisData or systemId is required' 
        })
      };
    }

    log.info('Insights request received', {
      hasAnalysisData: !!analysisData,
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      mode
    });

    // SYNC MODE: Execute ReAct loop directly (with timeout protection)
    if (mode === 'sync') {
      try {
        log.info('Starting sync ReAct loop');
        
        const result = await Promise.race([
          executeReActLoop({
            analysisData,
            systemId,
            customPrompt,
            log,
            mode: 'sync'
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), SYNC_MODE_TIMEOUT_MS)
          )
        ]);

        if (!result || !result.success) {
          const errorMsg = result?.error || 'ReAct loop failed without error details';
          log.warn('Sync ReAct loop completed with failure', { error: errorMsg });
          throw new Error(errorMsg);
        }

        const durationMs = Date.now() - startTime;

        log.info('Sync insights completed successfully', {
          durationMs,
          turns: result.turns || 0,
          toolCalls: result.toolCalls || 0,
          hasAnswer: !!result.finalAnswer
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
              turns: result.turns || 0,
              toolCalls: result.toolCalls || 0,
              durationMs,
              usedFunctionCalling: true
            }
          })
        };

      } catch (syncError) {
        if (syncError.message === 'TIMEOUT') {
          log.warn('Sync mode timed out, falling back to background mode', {
            durationMs: Date.now() - startTime,
            timeoutMs: SYNC_MODE_TIMEOUT_MS
          });
          // Fall through to background mode below
        } else {
          log.error('Sync mode failed, not falling back', {
            error: syncError.message,
            durationMs: Date.now() - startTime
          });
          throw syncError;
        }
      }
    }

    // BACKGROUND MODE: Create job and process asynchronously
    log.info('Starting background insights job');

    let job;
    try {
      job = await createInsightsJob({
        analysisData,
        systemId,
        customPrompt,
        initialSummary: null
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
    processInsightsInBackground(
      job.id,
      analysisData,
      systemId,
      customPrompt,
      log
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
