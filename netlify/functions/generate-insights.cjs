/**
 * Generate Insights - Redirect to Enhanced Mode
 * 
 * This endpoint now redirects to the enhanced mode for all insights generation.
 * Standard mode has been deprecated in favor of AI-powered analysis with 
 * intelligent data querying and trend analysis.
 * 
 * **Usage:**
 * - Endpoint: /.netlify/functions/generate-insights
 * - Redirects to: /.netlify/functions/generate-insights-with-tools
 * 
 * @module netlify/functions/generate-insights
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');

/**
 * Generate insights handler - redirects to enhanced mode
 */
async function generateHandler(event = {}, context = {}) {
  const log = createLogger ? createLogger('generate-insights', context) : console;
  const timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => { } };

  try {
    log.info('Standard mode deprecated, redirecting to enhanced mode');
    
    // Call the enhanced insights function directly
    const enhancedHandler = require('./generate-insights-with-tools.cjs').handler;
    const result = await enhancedHandler(event, context);
    
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
