/**
 * Generate Insights - Redirect to Enhanced Mode (Sync)
 * 
 * This endpoint redirects to the enhanced mode with synchronous processing.
 * Standard mode has been deprecated in favor of AI-powered analysis with 
 * intelligent data querying and trend analysis.
 * 
 * **Usage:**
 * - Endpoint: /.netlify/functions/generate-insights
 * - Redirects to: /.netlify/functions/generate-insights-with-tools?sync=true
 * - Processes synchronously (up to 55 seconds)
 * 
 * @module netlify/functions/generate-insights
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');

// Load enhanced handler once at module level
const enhancedHandler = require('./generate-insights-with-tools.cjs').handler;

/**
 * Generate insights handler - redirects to enhanced mode with sync processing
 */
async function generateHandler(event = {}, context = {}) {
  const log = createLogger ? createLogger('generate-insights', context) : console;
  const timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => { } };

  try {
    log.info('Standard mode deprecated, redirecting to enhanced mode (sync)');
    
    // Force synchronous mode for backward compatibility
    // This ensures existing code and tests continue to work
    const modifiedEvent = {
      ...event,
      queryStringParameters: {
        ...(event.queryStringParameters || {}),
        sync: 'true',
        mode: 'sync'
      }
    };
    
    // Call the enhanced insights function with sync mode
    const result = await enhancedHandler(modifiedEvent, context);
    
    await timer.end();
    return result;
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    log.warn('Failed to generate insights', { error: err.message, stack: err.stack });
    
    await timer.end();
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate insights',
        message: err.message,
        timestamp: new Date().toISOString()
      })
    };
  }
}

// Export the handlers
exports.handler = generateHandler;
exports.generateHandler = generateHandler;
