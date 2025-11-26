/**
 * Circuit Breaker Status Endpoint
 * 
 * Provides information about circuit breaker states for debugging and monitoring.
 * Allows users to check why services might be unavailable.
 * Now includes both global and per-tool circuit breakers.
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCircuitBreakerStatus } = require('./utils/retry.cjs');
const { getRegistry } = require('./utils/tool-circuit-breakers.cjs');

function validateEnvironment(log) {
  // No specific env vars required for this function, but good practice to have the hook.
  return true;
}

exports.handler = async (event, context) => {
  const log = createLogger('circuit-breaker-status', context);

  if (!validateEnvironment(log)) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    log.info('Circuit breaker status requested');

    // Get current status of global circuit breakers (legacy retry.cjs)
    const globalStatus = getCircuitBreakerStatus();
    
    // Get per-tool circuit breaker status
    const toolRegistry = getRegistry();
    const toolSummary = toolRegistry.getSummary();

    // Format for client consumption
    const response = {
      timestamp: new Date().toISOString(),
      global: {
        breakers: globalStatus.breakers.map(breaker => ({
          key: breaker.key,
          state: breaker.state,
          failures: breaker.failures,
          openUntil: breaker.openUntil ? new Date(breaker.openUntil).toISOString() : null,
          isOpen: breaker.isOpen,
          timeUntilReset: breaker.openUntil 
            ? Math.max(0, breaker.openUntil - Date.now())
            : 0
        })),
        summary: {
          total: globalStatus.total,
          open: globalStatus.open,
          closed: globalStatus.closed,
          anyOpen: globalStatus.anyOpen
        }
      },
      tools: {
        breakers: toolSummary.breakers.map(breaker => ({
          toolName: breaker.toolName,
          state: breaker.state,
          failures: breaker.failureCount,
          totalRequests: breaker.totalRequests,
          totalFailures: breaker.totalFailures,
          failureRate: breaker.failureRate,
          lastFailureTime: breaker.lastFailureTime 
            ? new Date(breaker.lastFailureTime).toISOString() 
            : null,
          config: breaker.config
        })),
        summary: {
          total: toolSummary.total,
          open: toolSummary.open,
          halfOpen: toolSummary.halfOpen,
          closed: toolSummary.closed,
          anyOpen: toolSummary.anyOpen
        }
      },
      overall: {
        anyOpen: globalStatus.anyOpen || toolSummary.anyOpen,
        totalBreakers: globalStatus.total + toolSummary.total
      }
    };

    log.info('Circuit breaker status retrieved', {
      globalTotal: response.global.summary.total,
      globalOpen: response.global.summary.open,
      toolsTotal: response.tools.summary.total,
      toolsOpen: response.tools.summary.open,
      anyOpen: response.overall.anyOpen
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
