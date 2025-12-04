/**
 * Generate Insights Async Trigger - Trigger Endpoint for Async Workload
 * 
 * This endpoint triggers the Netlify Async Workload for insights generation.
 * It creates a job, sends an event to the async workload system, and returns immediately.
 * 
 * The actual processing happens in generate-insights-background.mjs via async workload.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { createInsightsJob } = require('./utils/insights-jobs.cjs');
const { triggerInsightsWorkload } = require('./utils/insights-async-client.cjs');

/**
 * Handler for triggering async workload
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLoggerFromEvent('generate-insights-async-trigger', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'async-trigger');
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      analysisData,
      systemId,
      customPrompt,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode,
      consentGranted
    } = body;
    
    if (!analysisData || !systemId) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'analysisData and systemId are required'
        })
      };
    }
    
    if (!consentGranted) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'User consent is required for async workload processing'
        })
      };
    }
    
    log.info('Creating job for async workload', {
      hasAnalysisData: !!analysisData,
      hasSystemId: !!systemId,
      contextWindowDays,
      maxIterations,
      fullContextMode
    });
    
    // Create job in database
    const job = await createInsightsJob({
      analysisData,
      systemId,
      customPrompt,
      initialSummary: null,
      contextWindowDays,
      maxIterations,
      fullContextMode
    }, log);
    
    log.info('Job created, triggering async workload', { jobId: job.id });
    
    // Trigger async workload event
    const { eventId } = await triggerInsightsWorkload({
      jobId: job.id,
      analysisData,
      systemId,
      customPrompt,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode,
      priority: 5 // Normal priority
    });
    
    const durationMs = timer.end({ jobId: job.id, eventId });
    log.info('Async workload triggered successfully', { jobId: job.id, eventId, durationMs });
    log.exit(202);
    
    // Return job info immediately (workload runs asynchronously)
    return {
      statusCode: 202,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId: job.id,
        eventId,
        status: 'queued',
        message: 'Async workload triggered successfully. Use jobId to poll for status.',
        statusUrl: `/.netlify/functions/generate-insights-status?jobId=${job.id}`,
        mode: 'async-workload',
        info: {
          maxTimeout: 'unlimited',
          retries: 'automatic with exponential backoff',
          steps: 6,
          features: ['durable execution', 'state persistence', 'event chaining']
        }
      })
    };
    
  } catch (error) {
    timer.end({ error: true });
    log.error('Failed to trigger async workload', {
      error: error.message,
      stack: error.stack
    });
    
    log.exit(500);
    
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
