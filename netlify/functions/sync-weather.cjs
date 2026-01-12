// @ts-nocheck
const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { backfillWeatherForDateRange } = require('./utils/weather-batch-backfill.cjs');

/**
 * Sync weather data for a system within a date range.
 * This triggers background weather backfill for the specified system and date range.
 * 
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async function (event, context) {exports.handler = async function (event, context) {
    const headers = getCorsHeaders(event);

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('sync-weather', event, context);

  // Unified logging: also forward to centralized collector
  const forwardLog = createForwardingLogger('sync-weather');
    log.entry(createStandardEntryMeta(event));
    const timer = createTimer(log, 'sync-weather');

    if (event.httpMethod !== 'POST') {
        log.warn('Method not allowed', { method: event.httpMethod });
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return {
            statusCode: 405,
            headers: { ...headers, 'Content-Type': 'application/json', 'Allow': 'POST' },
            body: JSON.stringify({ error: 'sync-weather expects POST requests.' })
        };
    }

    let parsedBody;
    try {
        if (!event.body) {
            throw new Error('Request body is empty');
        }
        parsedBody = JSON.parse(event.body);
    } catch (e) {
        log.warn('Invalid JSON body', { error: e.message });
        timer.end({ error: 'invalid_json' });
        log.exit(400);
        return {
            statusCode: 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid JSON body.' })
        };
    }

    const { systemId, startDate, endDate } = parsedBody;

    if (!systemId || !startDate || !endDate) {
        log.warn('Missing required fields', { systemId, startDate, endDate });
        timer.end({ error: 'missing_fields' });
        log.exit(400);
        return {
            statusCode: 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Missing required fields: systemId, startDate, endDate.' })
        };
    }

    log.info('Syncing weather data', { systemId, startDate, endDate });

    try {
        // Get the system to find its location
        const systemsCollection = await getCollection('systems');
        const system = await systemsCollection.findOne({ id: systemId });

        if (!system) {
            log.warn('System not found', { systemId });
            timer.end({ error: 'system_not_found' });
            log.exit(404);
            return {
                statusCode: 404,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'System not found.' })
            };
        }

        // Check if system has location data
        const lat = system.latitude || system.lat;
        const lon = system.longitude || system.lon;

        if (!lat || !lon) {
            log.info('System has no location data, skipping weather sync', { systemId });
            timer.end({ skipped: true, reason: 'no_location' });
            log.exit(200);
            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, skipped: true, reason: 'System has no location data.' })
            };
        }

        // Trigger weather backfill for the date range
        const start = new Date(startDate);
        const end = new Date(endDate);

        log.info('Starting weather backfill', { systemId, lat, lon, startDate, endDate });

        // Use the batch backfill utility if available, otherwise just acknowledge
        if (typeof backfillWeatherForDateRange === 'function') {
            const result = await backfillWeatherForDateRange(lat, lon, start, end, log);
            log.info('Weather backfill complete', { systemId, result });
            timer.end({ success: true, ...result });
        } else {
            log.info('Weather backfill function not available, acknowledging request');
            timer.end({ success: true, acknowledged: true });
        }

        log.exit(200);
        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, systemId, startDate, endDate })
        };

    } catch (error) {
        log.error('Weather sync failed', { error: error.message, stack: error.stack });
        timer.end({ error: error.message });
        log.exit(500);
        return {
            statusCode: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Weather sync failed.', details: error.message })
        };
    }
};

    const headers = getCorsHeaders(event);

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('sync-weather', event, context);
    log.entry(createStandardEntryMeta(event));
    const timer = createTimer(log, 'sync-weather');

    if (event.httpMethod !== 'POST') {
        log.warn('Method not allowed', { method: event.httpMethod });
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return {
            statusCode: 405,
            headers: { ...headers, 'Content-Type': 'application/json', 'Allow': 'POST' },
            body: JSON.stringify({ error: 'sync-weather expects POST requests.' })
        };
    }

    let parsedBody;
    try {
        if (!event.body) {
            throw new Error('Request body is empty');
        }
        parsedBody = JSON.parse(event.body);
    } catch (e) {
        log.warn('Invalid JSON body', { error: e.message });
        timer.end({ error: 'invalid_json' });
        log.exit(400);
        return {
            statusCode: 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid JSON body.' })
        };
    }

    const { systemId, startDate, endDate } = parsedBody;

    if (!systemId || !startDate || !endDate) {
        log.warn('Missing required fields', { systemId, startDate, endDate });
        timer.end({ error: 'missing_fields' });
        log.exit(400);
        return {
            statusCode: 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Missing required fields: systemId, startDate, endDate.' })
        };
    }

    log.info('Syncing weather data', { systemId, startDate, endDate });

    try {
        // Get the system to find its location
        const systemsCollection = await getCollection('systems');
        const system = await systemsCollection.findOne({ id: systemId });

        if (!system) {
            log.warn('System not found', { systemId });
            timer.end({ error: 'system_not_found' });
            log.exit(404);
            return {
                statusCode: 404,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'System not found.' })
            };
        }

        // Check if system has location data
        const lat = system.latitude || system.lat;
        const lon = system.longitude || system.lon;

        if (!lat || !lon) {
            log.info('System has no location data, skipping weather sync', { systemId });
            timer.end({ skipped: true, reason: 'no_location' });
            log.exit(200);
            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, skipped: true, reason: 'System has no location data.' })
            };
        }

        // Trigger weather backfill for the date range
        const start = new Date(startDate);
        const end = new Date(endDate);

        log.info('Starting weather backfill', { systemId, lat, lon, startDate, endDate });

        // Use the batch backfill utility if available, otherwise just acknowledge
        if (typeof backfillWeatherForDateRange === 'function') {
            const result = await backfillWeatherForDateRange(lat, lon, start, end, log);
            log.info('Weather backfill complete', { systemId, result });
            timer.end({ success: true, ...result });
        } else {
            log.info('Weather backfill function not available, acknowledging request');
            timer.end({ success: true, acknowledged: true });
        }

        log.exit(200);
        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, systemId, startDate, endDate })
        };

    } catch (error) {
        log.error('Weather sync failed', { error: error.message, stack: error.stack });
        timer.end({ error: error.message });
        log.exit(500);
        return {
            statusCode: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Weather sync failed.', details: error.message })
        };
    }
};
