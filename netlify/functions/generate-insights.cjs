/**
 * Generate Insights - Legacy Endpoint (Proxy to New Implementation)
 * 
 * This endpoint maintains backward compatibility by proxying requests
 * to the new fully-featured generate-insights-with-tools endpoint.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  if (!process.env.GEMINI_API_KEY) {
    log.error('Missing GEMINI_API_KEY environment variable');
    return false;
  }
  return true;
}

// Import the new implementation
const { handler: newHandler } = require('./generate-insights-with-tools.cjs');

/**
 * Legacy handler - proxies to new implementation
 */
const handler = async (event, context) => {
  const log = createLoggerFromEvent('generate-insights-legacy', event, context);
  const timer = createTimer(log, 'generate-insights-legacy-handler');
  
  log.entry({ method: event.httpMethod, path: event.path });
  
  if (!validateEnvironment(log)) {
    timer.end({ success: false, error: 'configuration' });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }
  
  try {
    log.info('Legacy endpoint called, proxying to new implementation', {
      method: event.httpMethod,
      hasBody: !!event.body
    });

    // Simply delegate to the new handler
    const result = await newHandler(event, context);
    
    timer.end({ success: true, statusCode: result.statusCode });
    log.exit(result.statusCode);
    
    return result;
  } catch (error) {
    log.error('Error in legacy generate-insights proxy', {
      error: error.message,
      stack: error.stack
    });
    timer.end({ success: false, error: error.message });
    log.exit(500);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// Export both handler and generateHandler for backward compatibility
exports.handler = handler;
exports.generateHandler = handler;
