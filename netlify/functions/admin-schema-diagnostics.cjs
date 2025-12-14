/**
 * Admin Schema Diagnostics Endpoint
 * 
 * Provides detailed diagnostics about analysis-results schema:
 * - Collection counts and date ranges
 * - Schema validation (top-level vs nested systemId)
 * - Full Context Mode query simulation
 * 
 * This endpoint helps diagnose the "rawDataPoints: 0" issue by showing:
 * 1. How many records exist per systemId
 * 2. Which records have top-level systemId vs nested only
 * 3. What a Full Context query would return
 */

const { getCollection } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

/**
 * Analyze schema patterns for a given systemId
 */
async function analyzeSchemaForSystem(systemId, log) {
  const analysisCollection = await getCollection('analysis-results');
  const historyCollection = await getCollection('history');

  // Count records with top-level systemId
  const topLevelCount = await analysisCollection.countDocuments({ systemId });

  // Count records with nested systemId only (legacy records without top-level systemId)
  const nestedOnlyCount = await analysisCollection.countDocuments({
    'analysis.systemId': systemId,
    $or: [
      { systemId: null },
      { systemId: { $exists: false } }
    ]
  });

  // Count records with both
  const bothCount = await analysisCollection.countDocuments({
    systemId,
    'analysis.systemId': systemId
  });

  // Total records (using $or like full-context-builder)
  const totalViaOr = await analysisCollection.countDocuments({
    $or: [
      { systemId },
      { 'analysis.systemId': systemId }
    ]
  });

  // Get date range
  const oldestRecord = await analysisCollection
    .find({
      $or: [
        { systemId },
        { 'analysis.systemId': systemId }
      ]
    })
    .sort({ timestamp: 1 })
    .limit(1)
    .toArray();

  const newestRecord = await analysisCollection
    .find({
      $or: [
        { systemId },
        { 'analysis.systemId': systemId }
      ]
    })
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();

  // History collection comparison
  const historyCount = await historyCollection.countDocuments({ systemId });

  return {
    systemId,
    analysisResults: {
      topLevelSystemId: topLevelCount,
      nestedSystemIdOnly: nestedOnlyCount,
      both: bothCount,
      totalViaOrQuery: totalViaOr,
      dateRange: {
        oldest: oldestRecord[0]?.timestamp || null,
        newest: newestRecord[0]?.timestamp || null
      }
    },
    history: {
      count: historyCount
    },
    schemaStatus: topLevelCount > 0 ? 'UPDATED' : nestedOnlyCount > 0 ? 'LEGACY' : 'NO_DATA',
    recommendation: topLevelCount === 0 && nestedOnlyCount > 0 
      ? 'Run migration to add top-level systemId to existing records'
      : topLevelCount > 0
      ? 'Schema is up to date'
      : 'No data found for this systemId'
  };
}

/**
 * Simulate Full Context Mode query
 */
async function simulateFullContextQuery(systemId, days, log) {
  const analysisCollection = await getCollection('analysis-results');
  
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  // Simulate the exact query used by full-context-builder.cjs
  const records = await analysisCollection.find({
    $or: [
      { systemId, timestamp: { $gte: startISO, $lte: endISO } },
      { 'analysis.systemId': systemId, timestamp: { $gte: startISO, $lte: endISO } }
    ]
  }).sort({ timestamp: 1 }).toArray();

  return {
    query: {
      systemId,
      timeRange: { start: startISO, end: endISO },
      days
    },
    results: {
      recordCount: records.length,
      dateRange: {
        oldest: records[0]?.timestamp || null,
        newest: records[records.length - 1]?.timestamp || null
      }
    },
    sampleRecords: records.slice(0, 3).map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      hasTopLevelSystemId: !!r.systemId,
      hasNestedSystemId: !!r.analysis?.systemId,
      voltage: r.analysis?.overallVoltage,
      soc: r.analysis?.stateOfCharge
    }))
  };
}

/**
 * Get overview of all systems in database
 */
async function getAllSystemsOverview(log) {
  const analysisCollection = await getCollection('analysis-results');
  const systemsCollection = await getCollection('systems');

  // Get all registered systems
  const registeredSystems = await systemsCollection.find({}).toArray();

  const overview = await Promise.all(
    registeredSystems.map(async (system) => {
      const count = await analysisCollection.countDocuments({
        $or: [
          { systemId: system.id },
          { 'analysis.systemId': system.id }
        ]
      });

      return {
        systemId: system.id,
        systemName: system.name,
        recordCount: count
      };
    })
  );

  return overview;
}

exports.handler = async (event, context) => {
  const log = createLoggerFromEvent(event, context, 'admin-schema-diagnostics');

  try {
    log.info('Admin schema diagnostics request', {
      method: event.httpMethod,
      queryParams: event.queryStringParameters
    });

    const { systemId, action = 'analyze', days = '90' } = event.queryStringParameters || {};

    let result;

    switch (action) {
      case 'analyze':
        if (!systemId) {
          return {
            statusCode: 400,
            headers: getCorsHeaders(),
            body: JSON.stringify({
              error: 'systemId parameter required for analyze action'
            })
          };
        }
        result = await analyzeSchemaForSystem(systemId, log);
        break;

      case 'simulate':
        if (!systemId) {
          return {
            statusCode: 400,
            headers: getCorsHeaders(),
            body: JSON.stringify({
              error: 'systemId parameter required for simulate action'
            })
          };
        }
        const daysNum = parseInt(days, 10);
        if (isNaN(daysNum) || daysNum <= 0 || daysNum > 365) {
          return {
            statusCode: 400,
            headers: getCorsHeaders(),
            body: JSON.stringify({
              error: 'days parameter must be a positive integer between 1 and 365',
              provided: days
            })
          };
        }
        result = await simulateFullContextQuery(systemId, daysNum, log);
        break;

      case 'overview':
        result = await getAllSystemsOverview(log);
        break;

      default:
        return {
          statusCode: 400,
          headers: getCorsHeaders(),
          body: JSON.stringify({
            error: `Unknown action: ${action}`,
            validActions: ['analyze', 'simulate', 'overview']
          })
        };
    }

    log.info('Schema diagnostics completed', { action, systemId });

    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        success: true,
        action,
        data: result,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    log.error('Schema diagnostics failed', {
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        error: 'Schema diagnostics failed',
        message: error.message
      })
    };
  }
};
