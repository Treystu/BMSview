/**
 * Circuit Breaker Reset Endpoint
 * 
 * Allows manual reset of circuit breakers when services have recovered.
 * This is a diagnostic/admin tool for recovering from "stuck" circuit breaker states.
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { resetCircuitBreaker, resetAllCircuitBreakers } = require('./utils/retry.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLogger('circuit-breaker-reset', context);

  try {
    // Parse request
    const body = event.body ? JSON.parse(event.body) : {};
    const { key, resetAll } = body;

    log.info('Circuit breaker reset requested', {
      hasKey: !!key,
      resetAll: !!resetAll
    });

    let result;

    if (resetAll) {
      // Reset all circuit breakers
      result = resetAllCircuitBreakers();
      log.info('All circuit breakers reset', {
        count: result.count
      });
    } else if (key) {
      // Reset specific circuit breaker
      result = resetCircuitBreaker(key);
      log.info('Circuit breaker reset', {
        key,
        wasOpen: result.wasOpen,
        previousFailures: result.previousFailures
      });
    } else {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Either "key" or "resetAll" must be provided'
        })
      };
    }

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        ...result
      })
    };

  } catch (error) {
    log.error('Failed to reset circuit breaker', {
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to reset circuit breaker',
        message: error.message
      })
    };
  }
};
