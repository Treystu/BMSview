/**
 * Log Forwarder Utility
 * 
 * Helper for other Netlify functions to forward logs to the unified collector.
 * Non-blocking: forwards logs in the background without affecting function performance.
 * 
 * Usage:
 *   const { forwardLog } = require('./utils/log-forwarder.cjs');
 *   await forwardLog('analyze', 'info', 'Analysis started', { fileName: 'test.png' });
 *   // or batch:
 *   await forwardLogs([
 *     { source: 'analyze', level: 'info', message: 'Step 1', context: { step: 1 } },
 *     { source: 'analyze', level: 'info', message: 'Step 2', context: { step: 2 } }
 *   ]);
 */

const { createLogger } = require('./logger.cjs');

const log = createLogger('log-forwarder');

/**
 * Forward a single log entry to the unified collector
 */
async function forwardLog(source, level, message, context = {}) {
    if (!source || !level || !message) {
        log.warn('Invalid log entry, skipping forward', { source, level, message });
        return;
    }

    const entry = {
        source,
        level: level.toLowerCase(),
        message,
        context: typeof context === 'object' ? context : { value: context },
        timestamp: new Date().toISOString()
    };

    // Fire-and-forget: don't await to avoid blocking the main function
    fetch('/.netlify/functions/log-collector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
    }).catch(error => {
        // Silent fail to avoid impacting main function
        log.warn('Failed to forward log to collector', {
            source,
            level,
            message: message.substring(0, 50),
            error: error.message
        });
    });
}

/**
 * Forward multiple log entries in one request
 */
async function forwardLogs(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return;
    }

    // Validate and enrich entries
    const validEntries = entries.filter(entry =>
        entry &&
        typeof entry.source === 'string' &&
        typeof entry.level === 'string' &&
        typeof entry.message === 'string'
    ).map(entry => ({
        ...entry,
        level: entry.level.toLowerCase(),
        timestamp: entry.timestamp || new Date().toISOString()
    }));

    if (validEntries.length === 0) {
        return;
    }

    // Fire-and-forget batch request
    fetch('/.netlify/functions/log-collector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validEntries)
    }).catch(error => {
        log.warn('Failed to forward log batch to collector', {
            count: validEntries.length,
            error: error.message
        });
    });
}

/**
 * Create a logger that forwards to the unified collector
 */
function createForwardingLogger(source) {
    return {
        debug: (message, context = {}) => forwardLog(source, 'debug', message, context),
        info: (message, context = {}) => forwardLog(source, 'info', message, context),
        warn: (message, context = {}) => forwardLog(source, 'warn', message, context),
        error: (message, context = {}) => forwardLog(source, 'error', message, context),
        // Batch method for multiple entries
        batch: (entries) => forwardLogs(entries.map(entry => ({ ...entry, source })))
    };
}

module.exports = {
    forwardLog,
    forwardLogs,
    createForwardingLogger
};
