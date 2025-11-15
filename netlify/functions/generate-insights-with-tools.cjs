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
  getInsightsJob 
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

        if (!result.success) {
          throw new Error(result.error || 'ReAct loop failed');
        }

        const durationMs = Date.now() - startTime;

        log.info('Sync insights completed', {
          durationMs,
          turns: result.turns,
          toolCalls: result.toolCalls
        });

        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            insights: {
              rawText: result.finalAnswer,
              contextSummary: result.contextSummary
            },
            metadata: {
              mode: 'sync',
              turns: result.turns,
              toolCalls: result.toolCalls,
              durationMs,
              usedFunctionCalling: true
            }
          })
        };

      } catch (syncError) {
        if (syncError.message === 'TIMEOUT') {
          log.warn('Sync mode timed out, falling back to background mode');
          // Fall through to background mode below
        } else {
          throw syncError;
        }
      }
    }

    // BACKGROUND MODE: Create job and process asynchronously
    log.info('Starting background insights job');

    const job = await createInsightsJob({
      analysisData,
      systemId,
      customPrompt,
      initialSummary: null
    }, log);

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
        error: err.message
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
      durationMs: Date.now() - startTime
    });

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to generate insights',
        message: error.message
      })
    };
  }
};
