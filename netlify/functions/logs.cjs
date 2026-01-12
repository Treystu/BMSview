/**
 * Logs Query Endpoint
 * 
 * Retrieve unified logs from the centralized collection.
 * Supports filtering by source, level, time range, and pagination.
 * 
 * Query parameters:
 *   - source: filter by function name (e.g., analyze, history, systems)
 *   - level: filter by log level (debug, info, warn, error)
 *   - from: ISO timestamp start (inclusive)
 *   - to: ISO timestamp end (inclusive)
 *   - limit: max records to return (default 100, max 1000)
 *   - offset: pagination offset (default 0)
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { COLLECTIONS } = require('./utils/collections.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

const log = createLogger('logs');

// Note: logs endpoint doesn't forward to itself to prevent infinite loop
// const forwardLog = createForwardingLogger('logs');

/**
 * Parse and validate query parameters
 */
function parseQueryParams(event) {
    const { queryStringParameters = {} } = event;

    const params = {
        source: queryStringParameters.source || null,
        level: queryStringParameters.level || null,
        from: queryStringParameters.from || null,
        to: queryStringParameters.to || null,
        limit: Math.min(parseInt(queryStringParameters.limit) || 100, 1000),
        offset: parseInt(queryStringParameters.offset) || 0
    };

    // Validate level
    if (params.level && !['debug', 'info', 'warn', 'error'].includes(params.level.toLowerCase())) {
        throw new Error('Invalid level parameter. Must be one of: debug, info, warn, error');
    }

    // Validate timestamps
    if (params.from && isNaN(Date.parse(params.from))) {
        throw new Error('Invalid from parameter. Must be ISO 8601 timestamp');
    }
    if (params.to && isNaN(Date.parse(params.to))) {
        throw new Error('Invalid to parameter. Must be ISO 8601 timestamp');
    }

    return params;
}

/**
 * Build MongoDB query from parameters
 */
function buildQuery(params) {
    const query = {};

    if (params.source) {
        query.source = params.source;
    }

    if (params.level) {
        query.level = params.level.toLowerCase();
    }

    if (params.from || params.to) {
        query.timestamp = {};
        if (params.from) {
            query.timestamp.$gte = params.from;
        }
        if (params.to) {
            query.timestamp.$lte = params.to;
        }
    }

    return query;
}

/**
 * Main handler
 */
exports.handler = async (event, context) => {
    // Accept GET and POST (for complex queries)
    if (!['GET', 'POST'].includes(event.httpMethod)) {
        return errorResponse(405, 'method_not_allowed', 'Only GET and POST methods are allowed');
    }

    try {
        // Parse parameters
        const params = parseQueryParams(event);

        // Build query
        const query = buildQuery(params);

        // Get collection
        const logsCollection = await getCollection(COLLECTIONS.LOGS);

        // Execute query with pagination
        const cursor = logsCollection
            .find(query)
            .sort({ timestamp: -1 }) // Most recent first
            .skip(params.offset)
            .limit(params.limit);

        const logs = await cursor.toArray();
        const total = await logsCollection.countDocuments(query);

        // Format response
        const response = {
            success: true,
            logs,
            pagination: {
                total,
                limit: params.limit,
                offset: params.offset,
                hasMore: params.offset + params.limit < total
            },
            filters: {
                source: params.source,
                level: params.level,
                from: params.from,
                to: params.to
            }
        };

        log.info('Logs queried', {
            total,
            returned: logs.length,
            filters: params
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Idempotency-Key',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
            },
            body: JSON.stringify(response)
        };

    } catch (error) {
        log.error('Failed to query logs', { error: error.message, stack: error.stack });

        // Return specific error for validation failures
        if (error.message.includes('Invalid')) {
            return errorResponse(400, 'invalid_parameters', error.message);
        }

        return errorResponse(500, 'internal_error', 'Failed to query logs');
    }
};
