const { createLoggerFromEvent } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const {
  createStandardEntryMeta,
  logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 */
function validateEnvironment(log) {
  // No specific env vars required for this function, but good practice to have the hook.
  return true;
}

/**
 * @param {any} event
 * @param {any} context
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('debug-insights', event, context);
  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Debug insights request', includeBody: true, bodyMaxStringLength: 20000 });

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
      /** @type {Record<string, unknown>} */
      bodyStructure: /** @type {Record<string, unknown>} */ (analyzeStructure(body)),
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
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error('Debug insights failed', {
      error: message,
      stack
    });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message })
    };
  }
};

/**
 * Sanitize headers for logging (remove sensitive values)
 */
/**
 * @param {Record<string, string> | undefined | null} headers
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

/**
 * @param {unknown} obj
 * @param {number} [depth]
 * @returns {unknown}
 */
function analyzeStructure(obj, depth = 0) {
  if (depth > 3) return '[too deep]';

  if (Array.isArray(obj)) {
    return `Array(${obj.length})`;
  }

  if (obj && typeof obj === 'object') {
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */(obj))) {
      result[key] = analyzeStructure(value, depth + 1);
    }
    return result;
  }

  return typeof obj;
}

/**
 * @param {Record<string, any>} body
 */
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
