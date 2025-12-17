const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta, logDebugRequestSummary } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const {
  getRealtimeMetrics,
  getCostMetrics
} = require('./utils/metrics-collector.cjs');

/**
 * Monitoring Endpoint
 * Provides comprehensive metrics and monitoring data for AI feedback system
 * 
 * Query parameters:
 * - type: 'realtime' | 'cost' | 'alerts' | 'trends' | 'feedback' | 'dashboard' (default: 'dashboard')
 * - period: 'daily' | 'weekly' | 'monthly' (for cost metrics)
 * - startDate: ISO date string
 * - endDate: ISO date string
 */
exports.handler = async (event, context) => {
  const headers = {
    ...getCorsHeaders(event),
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('monitoring', event, context);
  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Monitoring request', includeBody: false });
  const timer = createTimer(log, 'monitoring');

  try {
    const params = event.queryStringParameters || {};
    const type = params.type || 'dashboard';

    log.debug('Processing monitoring request', { type });

    let result;
    switch (type) {
      case 'realtime':
        result = await handleRealtimeMetrics(log, headers);
        break;

      case 'cost':
        result = await handleCostMetrics(log, headers, params);
        break;

      case 'alerts':
        result = await handleAlerts(log, headers, params);
        break;

      case 'trends':
        result = await handleTrends(log, headers, params);
        break;

      case 'feedback':
        result = await handleFeedbackStats(log, headers);
        break;

      case 'dashboard':
      default:
        result = await handleDashboard(log, headers, params);
        break;
    }

    timer.end({ type });
    log.exit(result.statusCode);
    return result;
  } catch (error) {
    timer.end({ error: true });
    log.error('Monitoring endpoint error', { error: error.message, stack: error.stack });
    log.exit(500);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};

/**
 * Get realtime metrics
 */
async function handleRealtimeMetrics(log, headers) {
  const metrics = await getRealtimeMetrics();

  log.info('Realtime metrics retrieved', { metrics });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(metrics)
  };
}

/**
 * Get cost metrics
 */
async function handleCostMetrics(log, headers, params) {
  const period = params.period || 'daily';
  const startDate = params.startDate ? new Date(params.startDate) : null;
  const endDate = params.endDate ? new Date(params.endDate) : null;

  const costMetrics = await getCostMetrics(period, startDate, endDate);

  log.info('Cost metrics retrieved', { period, costMetrics });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(costMetrics)
  };
}

/**
 * Get alerts
 */
async function handleAlerts(log, headers, params) {
  const collection = await getCollection('anomaly_alerts');
  const resolved = params.resolved === 'true';
  // Validate limit to prevent excessive queries (1-1000 range)
  const parsedLimit = parseInt(params.limit || '50', 10);
  const limit = Number.isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 1000));

  const alerts = await collection
    .find({ resolved })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  log.info('Alerts retrieved', { count: alerts.length, resolved });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(alerts)
  };
}

/**
 * Get performance trends
 */
async function handleTrends(log, headers, params) {
  const collection = await getCollection('ai_operations');
  // Validate hours to prevent excessive queries (max 168 hours / 7 days)
  const parsedHours = parseInt(params.hours || '24', 10);
  const hours = Number.isNaN(parsedHours) ? 24 : Math.min(parsedHours, 168);
  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Aggregate by hour
  const trends = await collection.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate.toISOString() }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%dT%H:00:00',
            date: { $dateFromString: { dateString: '$timestamp' } }
          }
        },
        avgDuration: { $avg: '$duration' },
        errorCount: {
          $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] }
        },
        successCount: {
          $sum: { $cond: [{ $eq: ['$success', true] }, 1, 0] }
        }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]).toArray();

  const formattedTrends = trends.map(t => ({
    timestamp: t._id,
    avgDuration: Math.round(t.avgDuration),
    errorCount: t.errorCount,
    successCount: t.successCount
  }));

  log.info('Performance trends retrieved', { hours, dataPoints: formattedTrends.length });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(formattedTrends)
  };
}

/**
 * Get feedback implementation statistics
 */
async function handleFeedbackStats(log, headers) {
  const collection = await getCollection('feedback_tracking');

  // Use aggregation pipeline for efficient stats calculation
  // Only consider feedback from the last 90 days to prevent loading all historical data
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const pipeline = [
    { $match: { suggestedAt: { $gte: ninetyDaysAgo.toISOString() } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        effectivenessSum: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'implemented'] },
              { $ifNull: ['$effectiveness', 0] },
              0
            ]
          }
        }
      }
    }
  ];

  const results = await collection.aggregate(pipeline).toArray();

  // Calculate stats from aggregation results
  let totalSuggestions = 0;
  let implementedCount = 0;
  let effectivenessSum = 0;
  const statusBreakdown = {
    pending: 0,
    implemented: 0,
    rejected: 0,
    expired: 0
  };

  for (const r of results) {
    totalSuggestions += r.count;
    if (r._id === 'implemented') {
      implementedCount = r.count;
      effectivenessSum = r.effectivenessSum;
    }
    if (Object.prototype.hasOwnProperty.call(statusBreakdown, r._id)) {
      statusBreakdown[r._id] = r.count;
    }
  }

  const stats = {
    totalSuggestions,
    implementationRate: totalSuggestions > 0 ? implementedCount / totalSuggestions : 0,
    averageEffectiveness: implementedCount > 0 ? effectivenessSum / implementedCount : 0,
    statusBreakdown
  };

  log.info('Feedback stats retrieved', { stats });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(stats)
  };
}

/**
 * Get comprehensive dashboard data
 */
async function handleDashboard(log, headers, params) {
  const period = params.period || 'daily';

  // Get all metrics in parallel
  const [realtimeMetrics, costMetrics, alerts, trends, feedbackStats] = await Promise.all([
    getRealtimeMetrics(),
    getCostMetrics(period),
    getCollection('anomaly_alerts')
      .then(col => col.find({ resolved: false }).sort({ timestamp: -1 }).limit(10).toArray()),
    getCollection('ai_operations')
      .then(async col => {
        const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const trends = await col.aggregate([
          { $match: { timestamp: { $gte: startDate.toISOString() } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%dT%H:00:00',
                  date: { $dateFromString: { dateString: '$timestamp' } }
                }
              },
              avgDuration: { $avg: '$duration' },
              errorCount: { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } },
              successCount: { $sum: { $cond: [{ $eq: ['$success', true] }, 1, 0] } }
            }
          },
          { $sort: { _id: 1 } }
        ]).toArray();

        return trends.map(t => ({
          timestamp: t._id,
          avgDuration: Math.round(t.avgDuration),
          errorCount: t.errorCount,
          successCount: t.successCount
        }));
      }),
    getCollection('feedback_tracking')
      .then(async col => {
        // Use aggregation pipeline for efficient stats calculation (last 90 days)
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const pipeline = [
          { $match: { suggestedAt: { $gte: ninetyDaysAgo.toISOString() } } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              effectivenessSum: {
                $sum: {
                  $cond: [
                    { $eq: ['$status', 'implemented'] },
                    { $ifNull: ['$effectiveness', 0] },
                    0
                  ]
                }
              }
            }
          }
        ];
        const results = await col.aggregate(pipeline).toArray();

        let totalSuggestions = 0;
        let implementedCount = 0;
        let effectivenessSum = 0;

        for (const r of results) {
          totalSuggestions += r.count;
          if (r._id === 'implemented') {
            implementedCount = r.count;
            effectivenessSum = r.effectivenessSum;
          }
        }

        return {
          totalSuggestions,
          implementationRate: totalSuggestions > 0 ? implementedCount / totalSuggestions : 0,
          averageEffectiveness: implementedCount > 0 ? effectivenessSum / implementedCount : 0
        };
      })
  ]);

  const dashboard = {
    realtimeMetrics,
    costMetrics,
    recentAlerts: alerts,
    performanceTrends: trends,
    feedbackStats
  };

  log.info('Dashboard data retrieved', {
    alertCount: alerts.length,
    trendDataPoints: trends.length
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(dashboard)
  };
}