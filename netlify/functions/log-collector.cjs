/**
 * Unified Log Collector
 * 
 * Accepts structured logs from any Netlify function and stores them in a centralized collection.
 * This enables pulling all app logs in one query without per-function polling.
 * 
 * Usage in other functions:
 *   await fetch('/.netlify/functions/log-collector', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       source: 'analyze',
 *       level: 'info',
 *       message: 'Analysis started',
 *       context: { fileName: 'test.png', jobId: 'job-123' }
 *     })
 *   });
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { COLLECTIONS } = require('./utils/collections.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

const log = createLogger('log-collector');

// Note: log-collector doesn't forward to itself to prevent infinite loop
// const forwardLog = createForwardingLogger('log-collector');

/**
 * Validate log entry structure
 */
function isValidLogEntry(entry) {
    return (
        entry &&
        typeof entry === 'object' &&
        typeof entry.source === 'string' &&
        typeof entry.level === 'string' &&
        typeof entry.message === 'string' &&
        ['debug', 'info', 'warn', 'error'].includes(entry.level.toLowerCase())
    );
}

/**
 * Main handler
 */
exports.handler = async (event, context) => {
    // Only accept POST requests
    if (event.httpMethod !== 'POST') {
        return errorResponse(405, 'method_not_allowed', 'Only POST method is allowed');
    }

    try {
        // Parse body
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (parseError) {
            log.warn('Invalid JSON in log collector request', { error: parseError.message });
            return errorResponse(400, 'invalid_json', 'Request body must be valid JSON');
        }

        // Support single log entry or batch
        const logs = Array.isArray(body) ? body : [body];
        if (logs.length === 0) {
            return errorResponse(400, 'empty_logs', 'At least one log entry is required');
        }

        // Validate all entries
        const invalidLogs = logs.filter(entry => !isValidLogEntry(entry));
        if (invalidLogs.length > 0) {
            log.warn('Invalid log entries received', { count: invalidLogs.length });
            return errorResponse(400, 'invalid_logs', `Invalid log entry structure. Expected: { source, level, message, context? }`);
        }

        // Enrich and store logs
        const enrichedLogs = logs.map(entry => ({
            ...entry,
            timestamp: entry.timestamp || new Date().toISOString(),
            requestId: context.awsRequestId || null,
            userAgent: event.headers['user-agent'] || null,
            ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
            receivedAt: new Date().toISOString()
        }));

        // Store in MongoDB
        const logsCollection = await getCollection(COLLECTIONS.LOGS);
        const result = await logsCollection.insertMany(enrichedLogs);

        log.info('Logs collected', {
            count: result.insertedCount,
            sources: [...new Set(logs.map(l => l.source))].join(', ')
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Idempotency-Key',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
            },
            body: JSON.stringify({
                success: true,
                logged: result.insertedCount,
                message: `Logged ${result.insertedCount} entries`
            })
        };

    } catch (error) {
        log.error('Failed to collect logs', { error: error.message, stack: error.stack });
        return errorResponse(500, 'internal_error', 'Failed to store logs');
    }
};
