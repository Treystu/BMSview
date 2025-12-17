/**
 * Circuit Breaker Reset Endpoint
 * 
 * Allows manual reset of circuit breakers when services have recovered.
 * This is a diagnostic/admin tool for recovering from "stuck" circuit breaker states.
 * Supports both global and per-tool circuit breakers.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { resetCircuitBreaker, resetAllCircuitBreakers } = require('./utils/retry.cjs');
const { getRegistry } = require('./utils/tool-circuit-breakers.cjs');
const {
  createStandardEntryMeta,
  logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('circuit-breaker-reset', event, context);
  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Circuit breaker reset request', includeBody: true });
  const timer = createTimer(log, 'circuit-breaker-reset');

  try {
    // Parse request
    log.debug('Parsing request body');
    const body = event.body ? JSON.parse(event.body) : {};
    const { key, toolName, resetAll, resetAllTools } = body;

    log.info('Circuit breaker reset requested', {
      hasKey: !!key,
      hasToolName: !!toolName,
      resetAll: !!resetAll,
      resetAllTools: !!resetAllTools
    });

    const results = {};

    // Reset global circuit breakers
    if (resetAll) {
      results.global = resetAllCircuitBreakers();
      log.info('All global circuit breakers reset', {
        count: results.global.count
      });
    } else if (key) {
      results.global = resetCircuitBreaker(key);
      log.info('Global circuit breaker reset', {
        key,
        wasOpen: results.global.wasOpen,
        previousFailures: results.global.previousFailures
      });
    }

    // Reset tool-specific circuit breakers
    const toolRegistry = getRegistry();

    if (resetAllTools) {
      const count = toolRegistry.resetAll(log);
      results.tools = {
        count,
        resetAt: new Date().toISOString()
      };
      log.info('All tool circuit breakers reset', { count });
    } else if (toolName) {
      const success = toolRegistry.resetBreaker(toolName, log);
      results.tools = {
        toolName,
        success,
        resetAt: new Date().toISOString()
      };
      log.info('Tool circuit breaker reset', { toolName, success });
    }

    // Check if any reset was performed
    if (!results.global && !results.tools) {
      log.warn('No reset parameters provided');
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'At least one reset parameter must be provided',
          validParameters: {
            global: 'key or resetAll',
            tools: 'toolName or resetAllTools'
          }
        })
      };
    }

    timer.end({
      globalReset: !!results.global,
      toolsReset: !!results.tools
    });
    log.exit(200);
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        ...results
      })
    };

  } catch (error) {
    timer.end({ error: true });
    log.error('Failed to reset circuit breaker', {
      error: error.message,
      stack: error.stack
    });
    log.exit(500);

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
