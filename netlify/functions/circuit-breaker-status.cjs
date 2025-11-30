/**
 * Circuit Breaker Status Endpoint
 * 
 * Provides information about circuit breaker states for debugging and monitoring.
 * Allows users to check why services might be unavailable.
 * Now includes both global and per-tool circuit breakers.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCircuitBreakerStatus } = require('./utils/retry.cjs');
const { getRegistry } = require('./utils/tool-circuit-breakers.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('circuit-breaker-status', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'circuit-breaker-status');

  try {
    log.debug('Fetching circuit breaker status');

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
          halfOpen: globalStatus.halfOpen || 0,
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

    timer.end({ 
      totalBreakers: response.overall.totalBreakers,
      anyOpen: response.overall.anyOpen
    });
    log.info('Circuit breaker status retrieved', {
      globalTotal: response.global.summary.total,
      globalOpen: response.global.summary.open,
      toolsTotal: response.tools.summary.total,
      toolsOpen: response.tools.summary.open,
      anyOpen: response.overall.anyOpen
    });

    log.exit(200);
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    timer.end({ error: true });
    log.error('Failed to retrieve circuit breaker status', {
      error: error.message,
      stack: error.stack
    });
    log.exit(500);

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
