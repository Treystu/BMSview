// @ts-nocheck
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta, logDebugRequestSummary } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');

/**
 * Polling endpoint for admin panel updates (Replacement for broken SSE)
 * Returns aggregated system status:
 * - Analysis progress (recent events)
 * - System health (DB status, recent activity)
 * - Active insights jobs
 */

async function getAnalysisProgress(log) {
  try {
    const progressCol = await getCollection('progress-events');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentEvents = await progressCol.find({
      timestamp: { $gte: fiveMinutesAgo }
    }).sort({ timestamp: -1 }).limit(10).toArray();

    return {
      events: recentEvents,
      count: recentEvents.length
    };
  } catch (error) {
    log.error('Analysis progress check failed', { error: error.message });
    return { error: error.message };
  }
}

async function getSystemHealth(log) {
  try {
    const healthStatus = {
      mongodb: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };

    try {
      const resultsCol = await getCollection('analysis-results');
      const recentCount = await resultsCol.countDocuments({
        timestamp: { $gte: new Date(Date.now() - 3600000) } // Last hour
      });
      healthStatus.recentAnalyses = recentCount;
    } catch (error) {
      healthStatus.mongodb = 'degraded';
      healthStatus.error = error.message;
    }

    return healthStatus;
  } catch (error) {
    log.error('System health check failed', { error: error.message });
    return { error: error.message };
  }
}

async function getInsightsJobs(log) {
  try {
    const jobsCol = await getCollection('insights-jobs');
    const activeJobs = await jobsCol.find({
      status: { $in: ['pending', 'running'] }
    }).limit(5).toArray();

    return {
      activeJobs: activeJobs.map(job => ({
        id: job.id,
        status: job.status,
        progress: job.progress || 0,
        startedAt: job.startedAt,
        estimatedCompletion: job.estimatedCompletion
      })),
      count: activeJobs.length
    };
  } catch (error) {
    log.error('Insights jobs check failed', { error: error.message });
    return { error: error.message };
  }
}

exports.handler = async (event, context) => {
  const headers = {
    ...getCorsHeaders(event),
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('poll-updates', event, context);
  log.entry(createStandardEntryMeta(event));
  const timer = createTimer(log, 'poll-updates');

  try {
    const [analysis, health, insights] = await Promise.all([
      getAnalysisProgress(log),
      getSystemHealth(log),
      getInsightsJobs(log)
    ]);

    const responseBody = {
      timestamp: new Date().toISOString(),
      analysis,
      health,
      insights
    };

    timer.end({ success: true });
    log.exit(200);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseBody)
    };

  } catch (error) {
    timer.end({ error: true });
    log.error('Poll updates failed', { error: error.message, stack: error.stack });
    log.exit(500);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch updates' })
    };
  }
};
