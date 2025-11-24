/**
 * Get Hourly SOC Predictions
 * 
 * Returns hourly state of charge predictions for a battery system.
 * Combines actual BMS data with interpolated predictions based on patterns.
 */

const { createLogger } = require('./utils/logger.cjs');
const { predictHourlySoc } = require('./utils/forecasting.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLogger('get-hourly-soc-predictions', context);
  const startTime = Date.now();

  try {
    // Parse request
    const body = event.body ? JSON.parse(event.body) : {};
    const { systemId, hoursBack = 72 } = body;

    // Validate input
    if (!systemId) {
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
    const predictions = await predictHourlySoc(systemId, hoursBack, log);

    const durationMs = Date.now() - startTime;

    log.info('Hourly SOC predictions completed', {
      systemId,
      hoursBack,
      durationMs,
      predictionsCount: predictions.predictions?.length || 0
    });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(predictions)
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Hourly SOC predictions failed', {
      error: error.message,
      stack: error.stack,
      durationMs
    });

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: true,
        message: error.message
      })
    };
  }
};
