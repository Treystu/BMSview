const { getDb } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');

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
  const logger = createLogger('diagnostics-progress', context);
  
  try {
    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        },
        body: ''
      };
    }

    // Only support GET
    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Method not allowed. Use GET.' })
      };
    }

    // Get testId from query parameters
    const testId = event.queryStringParameters?.testId;
    
    if (!testId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          error: 'Missing testId query parameter',
          usage: '/.netlify/functions/diagnostics-progress?testId=<testId>' 
        })
      };
    }

    logger.info('Fetching diagnostic progress', { testId });

    // Query the progress document
    const db = await getDb();
    const progressDoc = await db.collection('diagnostics-runs').findOne({ testId });

    if (!progressDoc) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
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

    logger.info('Progress fetched', { 
      testId, 
      completed: completedCount, 
      total: totalTests,
      isComplete 
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    logger.error('Error fetching diagnostic progress', {
      message: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: 'Failed to fetch diagnostic progress',
        message: error.message
      })
    };
  }
};
