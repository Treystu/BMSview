/**
 * Weather Backfill Gaps Endpoint
 * 
 * POST: Intelligently fills weather data gaps for a system
 * Called after batch analysis completes to ensure full weather coverage
 * 
 * Uses minimal API calls by:
 * 1. Checking existing cached data first
 * 2. Fetching 24 hours per API call (1 call per day)
 * 3. Only backfilling dates with analysis records
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { backfillWeatherGaps } = require('./utils/weather-batch-backfill.cjs');

/**
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async function (event, context) {
    const headers = getCorsHeaders(event);

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('weather-backfill-gaps', event, context);
    log.entry(createStandardEntryMeta(event));
    const timer = createTimer(log, 'weather-backfill-gaps');

    if (event.httpMethod !== 'POST') {
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return {
            statusCode: 405,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { systemId } = body;

        if (!systemId) {
            timer.end({ error: 'missing_systemId' });
            log.exit(400);
            return {
                statusCode: 400,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'systemId is required' })
            };
        }

        log.info('Starting weather gap backfill', { systemId });

        // Get system location
        const systemsCollection = await getCollection('systems');
        const system = await systemsCollection.findOne({ id: systemId });

        if (!system) {
            timer.end({ error: 'system_not_found' });
            log.exit(404);
            return {
                statusCode: 404,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'System not found' })
            };
        }

        if (!system.latitude || !system.longitude) {
            timer.end({ error: 'no_location' });
            log.exit(200);
            return {
                statusCode: 200,
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    message: 'System has no location data, skipping weather backfill',
                    datesBackfilled: 0,
                    apiCalls: 0
                })
            };
        }

        // Perform the backfill
        log.info('Initiating batch backfill process', {
            systemId,
            lat: system.latitude,
            lon: system.longitude
        });

        const result = await backfillWeatherGaps(
            systemId,
            system.latitude,
            system.longitude,
            log
        );

        timer.end({
            datesBackfilled: result.datesBackfilled,
            apiCalls: result.apiCalls,
            hoursStored: result.hoursStored
        });

        log.info('Weather gap backfill complete', { systemId, ...result });
        log.exit(200);

        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                systemId,
                ...result
            })
        };

    } catch (error) {
        timer.end({ error: true });
        const err = error instanceof Error ? error : new Error(String(error));
        log.error('Weather backfill failed', { error: err.message, stack: err.stack });
        log.exit(500);
        return {
            statusCode: 500,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Weather backfill failed: ' + err.message })
        };
    }
};
