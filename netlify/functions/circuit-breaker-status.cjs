/**
 * Circuit Breaker Status Endpoint
 * 
 * Provides information about circuit breaker states for debugging and monitoring.
 * Allows users to check why services might be unavailable.
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

// Import the breaker map from retry.cjs to check states
// Note: This is a direct reference to the in-memory circuit breaker state
const { getCircuitBreakerStatus } = require('./utils/retry.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLogger('circuit-breaker-status', context);

  try {
    log.info('Circuit breaker status requested');

    // Get current status of all circuit breakers
    const status = getCircuitBreakerStatus();

    // Format for client consumption
    const response = {
      timestamp: new Date().toISOString(),
      breakers: status.breakers.map(breaker => ({
        key: breaker.key,
        state: breaker.state, // 'open', 'closed', or 'half-open'
        failures: breaker.failures,
        openUntil: breaker.openUntil ? new Date(breaker.openUntil).toISOString() : null,
        isOpen: breaker.isOpen,
        timeUntilReset: breaker.openUntil 
          ? Math.max(0, breaker.openUntil - Date.now())
          : 0
      })),
      summary: {
        total: status.total,
        open: status.open,
        closed: status.closed,
        anyOpen: status.anyOpen
      }
    };

    log.info('Circuit breaker status retrieved', {
      total: response.summary.total,
      open: response.summary.open,
      anyOpen: response.summary.anyOpen
    });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    log.error('Failed to retrieve circuit breaker status', {
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to retrieve circuit breaker status',
        message: error.message
      })
    };
  }
};
