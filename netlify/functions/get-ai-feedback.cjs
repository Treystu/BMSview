// @ts-nocheck
/**
 * Get AI Feedback Endpoint
 * Retrieves AI feedback with filtering and pagination
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

exports.handler = async (event, context) => {
  const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
  const log = createLoggerFromEvent('get-ai-feedback', event, context);
  const timer = createTimer(log, 'get-ai-feedback-handler');
  const headers = getCorsHeaders(event);
  
  log.entry({ method: event.httpMethod, path: event.path });
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    log.debug('OPTIONS preflight request');
    timer.end();
    log.exit(200);
    return { statusCode: 200, headers };
  }
  
  try {
    if (event.httpMethod !== 'GET') {
      log.warn('Method not allowed', { method: event.httpMethod });
      timer.end();
      log.exit(405);
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    const params = event.queryStringParameters || {};
    const status = params.status || 'all';
    const priority = params.priority;
    const category = params.category;
    const limit = parseInt(params.limit || '50');
    const skip = parseInt(params.skip || '0');
    
    log.debug('Query parameters', { status, priority, category, limit, skip });
    
    // Build query filter
    const filter = {};
    if (status !== 'all') {
      filter.status = status;
    }
    if (priority) {
      filter.priority = priority;
    }
    if (category) {
      filter.category = category;
    }
    
    const feedbackCollection = await getCollection('ai_feedback');
    
    // Get total count
    const totalCount = await feedbackCollection.countDocuments(filter);
    
    // Get feedbacks with pagination
    const feedbacks = await feedbackCollection
      .find(filter)
      .sort({ priority: -1, timestamp: -1 }) // Critical first, then by date
      .skip(skip)
      .limit(limit)
      .toArray();
    
    log.info('Retrieved AI feedbacks', {
      count: feedbacks.length,
      totalCount,
      filter
    });
    
    timer.end({ success: true });
    log.exit(200, { count: feedbacks.length, totalCount });
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedbacks,
        totalCount,
        limit,
        skip,
        hasMore: skip + feedbacks.length < totalCount
      })
    };
  } catch (error) {
    log.error('Get AI feedback error', { error: error.message });
    timer.end({ success: false, error: error.message });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to retrieve AI feedback',
        message: error.message
      })
    };
  }
};
