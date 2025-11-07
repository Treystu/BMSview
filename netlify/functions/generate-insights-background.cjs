/**
 * Generate Insights Background Processor
 * 
 * Long-running Netlify background function for AI insights generation.
 * Supports up to 15 minutes of processing time with progress streaming.
 * 
 * This function is invoked by generate-insights-with-tools.cjs and runs
 * the full AI tool calling loop with real-time progress updates.
 * 
 * @module netlify/functions/generate-insights-background
 */

const { createLogger, createTimer } = require('./utils/logger.cjs');
const { getInsightsJob } = require('./utils/insights-jobs.cjs');
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');

/**
 * Background handler - marked for Netlify background execution
 */
async function handler(event, context) {
  const log = createLogger('generate-insights-background', context);
  const timer = createTimer(log, 'generate-insights-background');
  
  try {
    // Parse request body
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (err) {
      log.warn('Failed to parse request body', { error: err.message });
      return respond(400, { error: 'Invalid JSON in request body' });
    }
    
    const { jobId } = body;
    
    if (!jobId) {
      log.warn('Missing jobId in background function');
      return respond(400, { error: 'jobId is required' });
    }
    
    log.info('Background function invoked', { jobId });
    
    // Get job from database
    const job = await getInsightsJob(jobId, log);
    
    if (!job) {
      log.error('Job not found', { jobId });
      return respond(404, { error: 'Job not found' });
    }
    
    log.info('Job loaded, starting processing', {
      jobId,
      status: job.status,
      hasSystemId: !!job.systemId,
      hasCustomPrompt: !!job.customPrompt
    });
    
    try {
      // Execute AI processing with function calling
      const result = await processInsightsInBackground(
        job.id,
        job.analysisData,
        job.systemId,
        job.customPrompt,
        log
      );
      
      timer.end();
      
      log.info('Background processing completed successfully', {
        jobId,
        iterations: result.iterations,
        toolCallsUsed: result.toolCalls?.length || 0
      });
      
      return respond(200, { 
        success: true, 
        jobId,
        status: 'completed'
      });
      
    } catch (processingError) {
      const error = processingError instanceof Error ? processingError : new Error(String(processingError));
      log.error('Background processing failed', { 
        jobId,
        error: error.message,
        stack: error.stack
      });
      
      timer.end();
      
      return respond(500, { 
        error: 'Processing failed',
        jobId,
        message: error.message
      });
    }
    
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Background function error', { 
      error: error.message, 
      stack: error.stack 
    });
    timer.end();
    
    return respond(500, { 
      error: 'Background function failed',
      message: error.message
    });
  }
}

/**
 * Helper to create HTTP response
 */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = handler;
