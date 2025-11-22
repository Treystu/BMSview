/**
 * Generate Insights - Legacy Endpoint (Proxy to New Implementation)
 * 
 * This endpoint maintains backward compatibility by proxying requests
 * to the new fully-featured generate-insights-with-tools endpoint.
 */

const { createLogger } = require('./utils/logger.cjs');

// Import the new implementation
const { handler: newHandler } = require('./generate-insights-with-tools.cjs');

/**
 * Legacy handler - proxies to new implementation
 */
const handler = async (event, context) => {
  const log = createLogger('generate-insights-legacy', context);
  
  log.info('Legacy endpoint called, proxying to new implementation', {
    method: event.httpMethod,
    hasBody: !!event.body
  });

  // Simply delegate to the new handler
  return await newHandler(event, context);
};

// Export both handler and generateHandler for backward compatibility
exports.handler = handler;
exports.generateHandler = handler;
