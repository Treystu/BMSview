// @ts-nocheck
"use strict";

/**
 * Shared Logger Utility
 * Provides structured logging with context and severity levels
 * 
 * Extended with audit logging for security events:
 * - Rate limiting events
 * - Input sanitization warnings
 * - Authentication/authorization events
 * - Data access events for compliance
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4
};

// Security event types for audit logging
const SECURITY_EVENT_TYPES = {
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  RATE_LIMIT_WARNING: 'rate_limit_warning',
  INPUT_SANITIZED: 'input_sanitized',
  INJECTION_BLOCKED: 'injection_blocked',
  PROMPT_INJECTION_DETECTED: 'prompt_injection_detected',
  AUTH_SUCCESS: 'auth_success',
  AUTH_FAILURE: 'auth_failure',
  CONSENT_GRANTED: 'consent_granted',
  CONSENT_DENIED: 'consent_denied',
  DATA_ACCESS: 'data_access',
  DATA_EXPORT: 'data_export',
  ADMIN_ACTION: 'admin_action',
  ENCRYPTION_EVENT: 'encryption_event'
};

/**
 * Generate a simple unique ID for request correlation
 * Uses crypto.randomUUID() if available, falls back to timestamp-based ID
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  try {
    // Node 14.17+ has crypto.randomUUID()
    const crypto = require('crypto');
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older Node versions
    return crypto.randomBytes(16).toString('hex');
  } catch (e) {
    // Ultimate fallback
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Extract correlation ID from request headers
 * Checks common correlation header names (case-insensitive)
 * @param {Object} headers - Request headers object
 * @returns {string|null} Correlation ID if found, null otherwise
 */
function extractCorrelationIdFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  // Common correlation ID header names to check
  const correlationHeaderNames = [
    'x-request-id',
    'x-correlation-id',
    'x-trace-id',
    'request-id',
    'correlation-id'
  ];

  // Convert correlation header names to a Set for O(1) lookup
  const correlationHeaderSet = new Set(correlationHeaderNames);

  // Iterate through headers once (more efficient)
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (correlationHeaderSet.has(lowerKey) && value && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

class Logger {
  /**
   * @param {string} functionName
   * @param {Object.<string, any>} [context]
   */
  constructor(functionName, context = {}) {
    /** @type {string} */
    this.functionName = functionName;
    /** @type {Object.<string, any>} */
    this.context = context;
    // Priority: explicit requestId > awsRequestId > headers correlation > generated
    /** @type {string} */
    this.requestId = context.requestId ||
      context.awsRequestId ||
      extractCorrelationIdFromHeaders(context.headers) ||
      generateCorrelationId();
    /** @type {string|null} */
    this.jobId = context.jobId || null;
    /** @type {number} */
    this.startTime = Date.now();
  }

  /**
   * @param {string} level
   * @param {string} message
   * @param {object} [data]
   * @returns {string} JSON string
   */
  _formatMessage(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const elapsed = Date.now() - this.startTime;

    /** @type {Object.<string, any>} */
    const logEntry = {
      timestamp,
      level,
      function: this.functionName,
      requestId: this.requestId,
      elapsed: `${elapsed}ms`,
      message,
      ...data
    };

    // Include jobId if present (for background/async operations)
    if (this.jobId) {
      logEntry.jobId = this.jobId;
    }

    // Include context but filter out headers to avoid log bloat
    if (this.context && Object.keys(this.context).length > 0) {
      /** @type {Object.<string, any>} */
      const ctx = this.context;
      const { headers, ...contextWithoutHeaders } = ctx;
      if (Object.keys(contextWithoutHeaders).length > 0) {
        logEntry.context = contextWithoutHeaders;
      }
    }

    return JSON.stringify(logEntry);
  }

  /**
  * @param {string} message
  * @param {object} [data]
  */
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

  /**
   * @param {string} message
   * @param {object} [data]
   */
  info(message, data) {
    console.log(this._formatMessage('INFO', message, data));
  }

  /**
   * @param {string} message
   * @param {object} [data]
   */
  warn(message, data) {
    console.warn(this._formatMessage('WARN', message, data));
  }

  /**
   * @param {string} message
   * @param {object} [data]
   */
  error(message, data) {
    console.error(this._formatMessage('ERROR', message, data));
  }

  /**
   * @param {string} message
   * @param {object} [data]
   */
  critical(message, data) {
    console.error(this._formatMessage('CRITICAL', message, data));
  }

  // Log function entry
  /**
   * @param {object} [data]
   */
  entry(data = {}) {
    this.info('Function invoked', data);
  }

  // Log function exit
  /**
   * @param {number} statusCode
   * @param {object} [data]
   */
  exit(statusCode, data = {}) {
    // @ts-ignore
    this.info('Function completed', { statusCode, ...data });
  }

  // Log database operations
  /**
   * @param {string} operation
   * @param {string} collection
   * @param {object} [data]
   */
  dbOperation(operation, collection, data = {}) {
    this.debug(`DB ${operation}`, { collection, ...data });
  }

  // Log API calls
  /**
   * @param {string} service
   * @param {string} endpoint
   * @param {object} [data]
   */
  apiCall(service, endpoint, data = {}) {
    this.debug(`API call to ${service}`, { endpoint, ...data });
  }

  // Log performance metrics
  /**
   * @param {string} name
   * @param {number} value
   * @param {string} [unit]
   */
  metric(name, value, unit = 'ms') {
    this.info('Performance metric', { metric: name, value, unit });
  }

  /**
   * Log a security audit event
   * These events are always logged regardless of LOG_LEVEL for compliance
   * @param {string} eventType - Type of security event (see SECURITY_EVENT_TYPES)
   * @param {Object} data - Event data
   */
  audit(eventType, data = {}) {
    const auditData = {
      auditEvent: true,
      eventType,
      clientIp: data.clientIp || this.context.clientIp || 'unknown',
      // userId is optional - only include if explicitly provided in data
      ...(data.userId ? { userId: data.userId } : {}),
      systemId: data.systemId || null,
      ...data
    };

    // Remove sensitive data from audit logs
    const sanitizedData = this._sanitizeAuditData(auditData);

    // Always log audit events as INFO level, regardless of LOG_LEVEL
    console.log(this._formatMessage('AUDIT', `Security event: ${eventType}`, sanitizedData));
  }

  /**
   * Remove sensitive data from audit log entries
   * @param {Object.<string, any>} data - Data to sanitize
   * @returns {Object.<string, any>} Sanitized data
   */
  _sanitizeAuditData(data) {
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'authorization', 'cookie'];
    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    // Truncate large data fields for audit logs
    if (sanitized['analysisData'] && typeof sanitized['analysisData'] === 'object') {
      sanitized['analysisData'] = '[OBJECT]';
    }
    if (sanitized['customPrompt'] && typeof sanitized['customPrompt'] === 'string') {
      // @ts-ignore
      sanitized['customPrompt'] = sanitized['customPrompt'].substring(0, 100) + (sanitized['customPrompt'].length > 100 ? '...' : '');
    }

    return sanitized;
  }

  /**
   * Log a rate limit event
   * @param {string} action - 'allowed' or 'blocked'
   * @param {Object} data - Rate limit details
   */
  rateLimit(action, data = {}) {
    const eventType = action === 'blocked' ?
      SECURITY_EVENT_TYPES.RATE_LIMIT_EXCEEDED :
      SECURITY_EVENT_TYPES.RATE_LIMIT_WARNING;

    this.audit(eventType, {
      action,
      remaining: data.remaining,
      limit: data.limit,
      endpoint: data.endpoint,
      clientIp: data.clientIp
    });
  }

  /**
   * Log an input sanitization event
   * @param {string} field - Field that was sanitized
   * @param {string} reason - Reason for sanitization
   * @param {Object} data - Additional context
   */
  sanitization(field, reason, data = {}) {
    this.audit(SECURITY_EVENT_TYPES.INPUT_SANITIZED, {
      field,
      reason,
      ...data
    });
  }

  /**
   * Log a consent event
   * @param {boolean} granted - Whether consent was granted
   * @param {Object} data - Consent context
   */
  consent(granted, data = {}) {
    const eventType = granted ?
      SECURITY_EVENT_TYPES.CONSENT_GRANTED :
      SECURITY_EVENT_TYPES.CONSENT_DENIED;

    this.audit(eventType, data);
  }

  /**
   * Log a data access event for compliance
   * @param {string} operation - Type of data operation
   * @param {Object} data - Access context
   */
  dataAccess(operation, data = {}) {
    this.audit(SECURITY_EVENT_TYPES.DATA_ACCESS, {
      operation,
      ...data
    });
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
 * @property {function(string, object=): void} audit
 * @property {function(string, object=): void} rateLimit
 * @property {function(string, string, object=): void} sanitization
 * @property {function(boolean, object=): void} consent
 * @property {function(string, object=): void} dataAccess
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
    // @ts-ignore
    if (typeof logger[level] === 'function') {
      // @ts-ignore
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
  logFunction.audit = logger.audit.bind(logger);
  logFunction.rateLimit = logger.rateLimit.bind(logger);
  logFunction.sanitization = logger.sanitization.bind(logger);
  logFunction.consent = logger.consent.bind(logger);
  logFunction.dataAccess = logger.dataAccess.bind(logger);

  return logFunction;
}

/**
 * Create a timer for performance tracking
 * @param {Function|Object} log - Logger instance or function
 * @param {string} operationName - Name of the operation being timed
 * @returns {{ end: (metadata?: object) => number }} Timer object with end() method
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

/**
 * Create a logger from a Netlify event with automatic correlation ID extraction
 * This is the preferred way to create loggers in Netlify functions
 * 
 * @param {string} functionName - Name of the function
 * @param {Object} event - Netlify event object
 * @param {Object} context - Netlify context object  
 * @param {Object} options - Additional options
 * @param {string} options.jobId - Job ID for background operations
 * @returns {LogFunction} Logger instance
 * 
 * @example
 * const log = createLoggerFromEvent('my-function', event, context);
 * log.entry({ method: event.httpMethod, path: event.path });
 * log.debug('Processing request', { body: event.body?.length });
 * log.exit(200);
 */
function createLoggerFromEvent(functionName, event, context = {}, options = {}) {
  const headers = event?.headers || {};
  const clientIp = headers['x-nf-client-connection-ip'] || 'unknown';

  // Build enhanced context with headers for correlation ID extraction
  /** @type {Object.<string, any>} */
  const enhancedContext = {
    ...context,
    headers,
    clientIp,
    httpMethod: /** @type {any} */ (event)?.httpMethod,
    path: /** @type {any} */ (event)?.path,
    ...(options.jobId && { jobId: options.jobId })
  };

  return createLogger(functionName, enhancedContext);
}

module.exports = {
  createLogger,
  createLoggerFromEvent,
  createTimer,
  Logger,
  SECURITY_EVENT_TYPES,
  generateCorrelationId,
  extractCorrelationIdFromHeaders
};
