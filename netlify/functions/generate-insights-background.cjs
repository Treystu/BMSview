/**
 * Background wrapper for Generate Insights
 *
 * Restores the legacy background endpoint name and forwards to the enhanced
 * insights implementation while emitting structured logs.
 *
 * Endpoint: /.netlify/functions/generate-insights-background
 * Behavior: Background function (Netlify returns 202 to caller).
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');
const enhancedHandler = require('./generate-insights-with-tools.cjs').handler;

exports.handler = async (event = {}, context = {}) => {
  const log = createLogger('generate-insights-background', context);
  const timer = createTimer(log, 'generate-insights-background');

  try {
    log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });

    const result = await enhancedHandler(event, context);
    const durationMs = timer.end({ statusCode: result && result.statusCode });
    log.exit(result?.statusCode || 200, { durationMs });

    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        message: 'generate-insights-background accepted',
        proxiedStatus: result?.statusCode || 200,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Background insights failed', { error: err.message, stack: err.stack });
    timer.end({ error: true });

    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
