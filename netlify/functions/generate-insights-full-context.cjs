// @ts-nocheck
/**
 * Generate Insights with Full Context
 * Enhanced version that provides complete context and enables AI feedback
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { generateFullContextInsights, countDataPoints } = require('./utils/full-context-logic.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

/**
 * Main handler for full context insights
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('generate-insights-full-context', event, context);
  log.entry(createStandardEntryMeta(event));
  const timer = createTimer(log, 'full-context-insights');

  try {
    if (event.httpMethod !== 'POST') {
      log.warn('Method not allowed', { method: event.httpMethod });
      log.exit(405);
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    log.debug('Parsing request body');
    const body = JSON.parse(event.body);
    const { systemId, enableFeedback = true, contextWindowDays = 90, customPrompt, recentHistory } = body;

    // Ensure systemId shows up even if we only looked for it in the body (not query)
    log.debug('Parsed request', {
      systemId,
      enableFeedback,
      contextWindowDays,
      hasCustomPrompt: !!customPrompt,
      hasRecentHistory: Array.isArray(recentHistory) && recentHistory.length > 0
    });

    if (!systemId) {
      log.warn('Missing systemId in request');
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'systemId is required' })
      };
    }

    log.info('Full context insights requested', {
      systemId,
      enableFeedback,
      contextWindowDays,
      hasCustomPrompt: !!customPrompt
    });

    // Use the reusable logic
    const result = await generateFullContextInsights({
      systemId,
      enableFeedback,
      contextWindowDays,
      customPrompt,
      recentHistory
    }, log, context);

    const durationMs = timer.end({
      systemId,
      dataPointsAnalyzed: result.metadata.dataPointsAnalyzed,
      feedbackSubmitted: result.feedbackSubmitted.length
    });

    log.info('Full context insights generated', {
      systemId,
      dataPointsAnalyzed: result.metadata.dataPointsAnalyzed,
      contextSizeBytes: result.metadata.contextSize,
      feedbackSubmitted: result.feedbackSubmitted.length,
      durationMs
    });

    log.exit(200, { systemId, durationMs });
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        insights: result.insights,
        metadata: result.metadata,
        systemId,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    timer.end({ error: true });
    log.error('Full context insights error', {
      error: error.message,
      stack: error.stack,
      errorType: error.constructor?.name
    });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to generate full context insights',
        message: error.message
      })
    };
  }
};
