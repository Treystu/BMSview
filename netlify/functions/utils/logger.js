/**
 * Shared Logger Utility
 * Provides structured logging with context and severity levels
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4
};

class Logger {
  constructor(functionName, context = {}) {
    this.functionName = functionName;
    this.context = context;
    this.requestId = context.requestId || context.awsRequestId || 'unknown';
    this.startTime = Date.now();
  }

  _formatMessage(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const elapsed = Date.now() - this.startTime;
    
    return JSON.stringify({
      timestamp,
      level,
      function: this.functionName,
      requestId: this.requestId,
      elapsed: `${elapsed}ms`,
      message,
      ...data,
      context: this.context
    });
  }

  debug(message, data) {
    if (process.env.LOG_LEVEL === 'DEBUG') {
      console.log(this._formatMessage('DEBUG', message, data));
    }
  }

  info(message, data) {
    console.log(this._formatMessage('INFO', message, data));
  }

  warn(message, data) {
    console.warn(this._formatMessage('WARN', message, data));
  }

  error(message, data) {
    console.error(this._formatMessage('ERROR', message, data));
  }

  critical(message, data) {
    console.error(this._formatMessage('CRITICAL', message, data));
  }

  // Log function entry
  entry(data = {}) {
    this.info('Function invoked', data);
  }

  // Log function exit
  exit(statusCode, data = {}) {
    this.info('Function completed', { statusCode, ...data });
  }

  // Log database operations
  dbOperation(operation, collection, data = {}) {
    this.debug(`DB ${operation}`, { collection, ...data });
  }

  // Log API calls
  apiCall(service, endpoint, data = {}) {
    this.debug(`API call to ${service}`, { endpoint, ...data });
  }

  // Log performance metrics
  metric(name, value, unit = 'ms') {
    this.info('Performance metric', { metric: name, value, unit });
  }
}

/**
 * Create a logger instance for a function
 * @param {string} functionName - Name of the function
 * @param {object} context - Netlify function context
 * @returns {Logger|Function} Logger instance or backward-compatible function
 */
function createLogger(functionName, context = {}) {
  const logger = new Logger(functionName, context);
  
  // Create a backward-compatible function that can be called directly
  // This supports the old API: log('info', 'message', data)
  const logFunction = function(level, message, data) {
    if (typeof logger[level] === 'function') {
      logger[level](message, data);
    } else {
      logger.info(message, { level, ...data });
    }
  };
  
  // Copy all logger methods to the function
  logFunction.debug = logger.debug.bind(logger);
  logFunction.info = logger.info.bind(logger);
  logFunction.warn = logger.warn.bind(logger);
  logFunction.error = logger.error.bind(logger);
  logFunction.critical = logger.critical.bind(logger);
  logFunction.entry = logger.entry.bind(logger);
  logFunction.exit = logger.exit.bind(logger);
  logFunction.dbOperation = logger.dbOperation.bind(logger);
  logFunction.apiCall = logger.apiCall.bind(logger);
  logFunction.metric = logger.metric.bind(logger);
  
  return logFunction;
}

module.exports = { createLogger, Logger };