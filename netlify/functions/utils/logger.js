/**
 * Enhanced Logger with LOG_LEVEL Support
 * 
 * Supports environment variable LOG_LEVEL with values:
 * - ERROR: Only errors
 * - WARN: Errors + warnings
 * - INFO: Errors + warnings + info (default)
 * - DEBUG: All operations + detailed context
 * - TRACE: Everything including data dumps
 */

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4
};

const getLogLevel = () => {
    const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
    return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.INFO;
};

const shouldLog = (messageLevel) => {
    const currentLevel = getLogLevel();
    const messageLevelValue = LOG_LEVELS[messageLevel.toUpperCase()] || LOG_LEVELS.INFO;
    return messageLevelValue <= currentLevel;
};

const createLogger = (functionName, context) => {
    const awsRequestId = context?.awsRequestId || 'unknown';
    const startTime = Date.now();
    
    return (level, message, extra = {}) => {
        // Check if we should log this level
        if (!shouldLog(level)) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const elapsed = Date.now() - startTime;
        
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            functionName,
            awsRequestId,
            elapsedMs: elapsed,
            message,
            ...extra
        };
        
        // Add performance context for DEBUG and TRACE levels
        if (shouldLog('DEBUG') && context) {
            logEntry.remainingTimeMs = context.getRemainingTimeInMillis?.();
            logEntry.memoryLimitMB = context.memoryLimitInMB;
        }
        
        console.log(JSON.stringify(logEntry));
    };
};

/**
 * Performance timing utility
 */
const createTimer = (log, operation) => {
    const startTime = Date.now();
    
    return {
        end: (extra = {}) => {
            const duration = Date.now() - startTime;
            log('debug', `Operation completed: ${operation}`, { 
                operation, 
                durationMs: duration,
                ...extra 
            });
            return duration;
        }
    };
};

/**
 * Sanitize sensitive data from logs
 */
const sanitize = (data) => {
    if (!data || typeof data !== 'object') return data;
    
    const sanitized = { ...data };
    const sensitiveKeys = ['password', 'apikey', 'api_key', 'token', 'secret', 'authorization', 'cookie'];
    
    for (const key of Object.keys(sanitized)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitize(sanitized[key]);
        }
    }
    
    return sanitized;
};

/**
 * Log with automatic sanitization
 */
const createSafeLogger = (functionName, context) => {
    const baseLog = createLogger(functionName, context);
    
    return (level, message, extra = {}) => {
        const sanitizedExtra = sanitize(extra);
        baseLog(level, message, sanitizedExtra);
    };
};

module.exports = { 
    createLogger, 
    createSafeLogger,
    createTimer,
    sanitize,
    LOG_LEVELS,
    getLogLevel
};