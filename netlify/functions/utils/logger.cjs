"use strict";

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
    // Always log debug when LOG_LEVEL is DEBUG or not set (default to INFO, but allow DEBUG)
    // Also check for truthy LOG_LEVEL values that indicate debug should be enabled
    const logLevel = (process.env.LOG_LEVEL || '').toUpperCase();
    if (logLevel === 'DEBUG' || logLevel === '') {
      // When LOG_LEVEL is not set, still log debug (Netlify Functions default to showing all logs)
      // User can set LOG_LEVEL=INFO to suppress debug logs
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
 * @typedef {Object} LoggerMethods
 * @property {function(string, object=): void} debug
 * @property {function(string, object=): void} info
 * @property {function(string, object=): void} warn
 * @property {function(string, object=): void} error
 * @property {function(string, object=): void} critical
 * @property {function(object=): void} entry
 * @property {function(number, object=): void} exit
 * @property {function(string, string, object=): void} dbOperation
 * @property {function(string, string, object=): void} apiCall
 * @property {function(string, number, string=): void} metric
 */

/**
 * @typedef {(function(string, string, object=): void) & LoggerMethods} LogFunction
 */

/**
 * Create a logger instance for a function
 * @param {string} functionName - Name of the function
 * @param {object} context - Netlify function context
 * @returns {LogFunction} Logger instance or backward-compatible function
 */
function createLogger(functionName, context = {}) {
  const logger = new Logger(functionName, context);

  // Create a backward-compatible function that can be called directly
  // This supports the old API: log('info', 'message', data)
  /** @type {LogFunction} */
  const logFunction = function (level, message, data) {
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

/**
 * Create a timer for performance tracking
 * @param {Function|Object} log - Logger instance or function
 * @param {string} operationName - Name of the operation being timed
 * @returns {Object} Timer object with end() method
 */
function createTimer(log, operationName) {
  const startTime = Date.now();

  return {
    end: (metadata = {}) => {
      const duration = Date.now() - startTime;

      // Support both old-style log function and new Logger instance
      if (typeof log === 'function') {
        log('info', `${operationName} completed`, {
          duration: `${duration}ms`,
          ...metadata
        });
      } else if (log && typeof log.info === 'function') {
        log.info(`${operationName} completed`, {
          duration: `${duration}ms`,
          ...metadata
        });
      }

      return duration;
    }
  };
}

module.exports = { createLogger, createTimer, Logger };
