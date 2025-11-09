/**
 * Generate Insights - AI-Powered Battery Analysis
 * 
 * This endpoint provides hybrid sync/async processing for battery insights generation:
 * - Sync kickoff: Returns immediate job ID and initial summary
 * - Async processing: Background AI analysis with historical data queries
 * - Sync close: Poll for results when complete
 * 
 * **Processing Flow:**
 * 1. Synchronous validation and initial summary (< 1 second)
 * 2. Background AI processing with tool calling (10-50 seconds)
 * 3. Client polls for completion or receives webhook
 * 
 * **Usage:**
 * - Endpoint: /.netlify/functions/generate-insights
 * - Delegates to: /.netlify/functions/generate-insights-with-tools
 * - Mode: Intelligent routing via resolveRunMode() based on data size & complexity
 * - Override: Can specify ?mode=sync or ?mode=background explicitly
 * 
 * @module netlify/functions/generate-insights
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');

// Load enhanced handler once at module level
const enhancedHandler = require('./generate-insights-with-tools.cjs').handler;

/**
 * Generate insights handler - redirects to enhanced mode with sync processing
 */
/**
 * @param {any} event
 * @param {any} context
 */
async function generateHandler(event, context) {
  event = event || {};
  context = context || {};
  const log = createLogger ? createLogger('generate-insights', context) : console;
  const timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => { } };

  try {
    log.info('Generate insights request - delegating to enhanced mode with intelligent routing');

    // Let resolveRunMode() make intelligent decision based on:
    // - Data size (measurement count, custom prompt length)
    // - Explicit mode parameters (?mode=sync or ?sync=true)
    // - Request characteristics
    // 
    // No forced mode - resolveRunMode() handles all logic intelligently
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
