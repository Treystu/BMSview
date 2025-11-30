const { getDb } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

/**
 * Netlify Function: diagnostics-progress
 * 
 * Provides real-time progress updates for running diagnostic tests.
 * Frontend polls this endpoint to get incremental test results.
 * 
 * Query params:
 * - testId: The diagnostic run ID to check progress for
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  // Get testId early for logging
  const testId = event.queryStringParameters?.testId;
  
  const logger = createLoggerFromEvent('diagnostics-progress', event, context, { jobId: testId });
  logger.entry({ method: event.httpMethod, path: event.path, testId });
  const timer = createTimer(logger, 'diagnostics-progress');
  
  if (!validateEnvironment(logger)) {
    logger.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }
  
  try {
    // Only support GET
    if (event.httpMethod !== 'GET') {
      logger.warn('Method not allowed', { method: event.httpMethod });
      logger.exit(405);
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed. Use GET.' })
      };
    }
    
    if (!testId) {
      logger.warn('Missing testId query parameter');
      logger.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Missing testId query parameter',
          usage: '/.netlify/functions/diagnostics-progress?testId=<testId>' 
        })
      };
    }

    logger.debug('Querying progress from database', { testId });

    // Query the progress document
    const db = await getDb();
    const progressDoc = await db.collection('diagnostics-runs').findOne({ testId });

    if (!progressDoc) {
      logger.warn('Diagnostic run not found', { testId });
      timer.end({ found: false });
      logger.exit(404);
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Diagnostic run not found',
          testId 
        })
      };
    }

    // Calculate progress summary
    const totalTests = progressDoc.totalTests || progressDoc.selectedTests?.length || 0;
    const completedCount = progressDoc.completedTests?.length || 0;
    const resultsCount = progressDoc.results?.length || 0;
    const isComplete = progressDoc.status === 'completed';

    // Return progress data
    const response = {
      testId: progressDoc.testId,
      status: progressDoc.status,
      timestamp: progressDoc.timestamp,
      lastUpdate: progressDoc.lastUpdate,
      completedAt: progressDoc.completedAt,
      progress: {
        total: totalTests,
        completed: completedCount,
        percentage: totalTests > 0 ? Math.round((completedCount / totalTests) * 100) : 0
      },
      results: progressDoc.results || [],
      completedTests: progressDoc.completedTests || [],
      isComplete
    };

    timer.end({ completed: completedCount, total: totalTests, isComplete });
    logger.info('Progress fetched', { 
      testId, 
      completed: completedCount, 
      total: totalTests,
      isComplete 
    });
    logger.exit(200);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    timer.end({ error: true });
    logger.error('Error fetching diagnostic progress', {
      error: error.message,
      stack: error.stack
    });
    logger.exit(500);

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to fetch diagnostic progress',
        message: error.message
      })
    };
  }
};
