/**
 * Get Hourly SOC Predictions
 * 
 * Returns hourly state of charge predictions for a battery system.
 * Combines actual BMS data with interpolated predictions based on patterns.
 */

const { createLogger, createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { predictHourlySoc } = require('./utils/forecasting.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const {
  createStandardEntryMeta,
  logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 */
function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

/**
 * @param {any} event
 * @param {any} context
 */
exports.handler = async (event, context) => {
  const log = createLoggerFromEvent('get-hourly-soc-predictions', event, context);
  /** @type {any} */
  const timer = createTimer(log, 'get-hourly-soc-predictions-handler');
  const headers = getCorsHeaders(event);

  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Hourly SOC predictions request', includeBody: true, bodyMaxStringLength: 20000 });

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    log.debug('OPTIONS preflight request');
    timer.end();
    log.exit(200);
    return { statusCode: 200, headers };
  }

  if (!validateEnvironment(log)) {
    timer.end({ success: false, error: 'configuration' });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: true, message: 'Server configuration error' })
    };
  }

  try {
    // Parse request
    const body = event.body ? JSON.parse(event.body) : {};
    const { systemId, hoursBack = 72 } = body;

    // Validate input
    if (!systemId) {
      log.warn('Missing systemId parameter');
      timer.end();
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: true,
          message: 'systemId is required'
        })
      };
    }

    log.info('Hourly SOC predictions request', { systemId, hoursBack });

    // Get predictions
    /** @type {any} */
    const predictions = await predictHourlySoc(systemId, hoursBack, /** @type {any} */(log));

    log.info('Hourly SOC predictions completed', {
      systemId,
      hoursBack,
      predictionsCount: predictions.predictions?.length || 0
    });

    timer.end({ success: true });
    log.exit(200, { systemId, predictionsCount: predictions.predictions?.length || 0 });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(predictions)
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error('Hourly SOC predictions failed', {
      error: message,
      stack
    });

    timer.end({ success: false, error: message });
    log.exit(500);

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: true,
        message
      })
    };
  }
};
