const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  // No specific env vars required for this function, but good practice to have the hook.
  return true;
}

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLoggerFromEvent('debug-insights', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  
  if (!validateEnvironment(log)) {
    log.error('Environment validation failed');
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    log.debug('Parsing request body');
    const body = event.body ? JSON.parse(event.body) : {};

    const debug = {
      requestMethod: event.httpMethod,
      headers: sanitizeHeaders(event.headers),
      bodyKeys: Object.keys(body),
      bodyStructure: analyzeStructure(body),
      timestamp: new Date().toISOString()
    };

    log.info('Debug request processed', { 
      bodyKeys: debug.bodyKeys,
      structureDepth: Object.keys(debug.bodyStructure).length
    });

    const recommendations = generateRecommendations(body);
    log.debug('Recommendations generated', { count: recommendations.length });

    log.exit(200);
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        debug,
        recommendations
      })
    };
  } catch (error) {
    log.error('Debug insights failed', { 
      error: error.message,
      stack: error.stack
    });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Sanitize headers for logging (remove sensitive values)
 */
function sanitizeHeaders(headers) {
  if (!headers) return {};
  const sanitized = { ...headers };
  const sensitiveKeys = ['authorization', 'cookie', 'x-api-key'];
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}

function analyzeStructure(obj, depth = 0) {
  if (depth > 3) return '[too deep]';

  if (Array.isArray(obj)) {
    return `Array(${obj.length})`;
  }

  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = analyzeStructure(value, depth + 1);
    }
    return result;
  }

  return typeof obj;
}

function generateRecommendations(body) {
  const recommendations = [];

  if (!body.analysisData && !body.batteryData && !body.measurements) {
    recommendations.push('Include analysisData, batteryData, or measurements in request');
  }

  if (body.analysisData && !body.analysisData.measurements) {
    recommendations.push('analysisData should contain measurements array');
  }

  return recommendations;
}
