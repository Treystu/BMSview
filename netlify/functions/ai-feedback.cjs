// @ts-nocheck
/**
 * AI Feedback Submission Endpoint
 * Stores AI-generated feedback and suggestions for app improvements
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { submitFeedbackToDatabase } = require('./utils/feedback-manager.cjs');

/**
 * Main handler
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLoggerFromEvent('ai-feedback', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'ai-feedback');
  
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
    const { systemId, feedbackType, content, priority, category } = body;
    
    // Validate required fields
    if (!systemId || !feedbackType || !content || !priority || !category) {
      log.warn('Missing required fields', { 
        hasSystemId: !!systemId, 
        hasFeedbackType: !!feedbackType,
        hasContent: !!content,
        hasPriority: !!priority,
        hasCategory: !!category
      });
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Missing required fields: systemId, feedbackType, content, priority, category'
        })
      };
    }
    
    // Validate enums
    const validFeedbackTypes = ['feature_request', 'api_suggestion', 'data_format', 'bug_report', 'optimization'];
    const validCategories = ['weather_api', 'data_structure', 'ui_ux', 'performance', 'integration', 'analytics'];
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    
    if (!validFeedbackTypes.includes(feedbackType)) {
      log.warn('Invalid feedbackType', { feedbackType });
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Invalid feedbackType. Must be one of: ${validFeedbackTypes.join(', ')}` })
      };
    }
    
    if (!validCategories.includes(category)) {
      log.warn('Invalid category', { category });
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` })
      };
    }
    
    if (!validPriorities.includes(priority)) {
      log.warn('Invalid priority', { priority });
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` })
      };
    }
    
    // Submit feedback
    log.info('Submitting AI feedback', { systemId, feedbackType, priority, category });
    const result = await submitFeedbackToDatabase(body, context);
    
    timer.end({ success: true, isDuplicate: result.isDuplicate });
    log.info('AI feedback submitted', { feedbackId: result.id, isDuplicate: result.isDuplicate });
    log.exit(200);
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        feedbackId: result.id,
        isDuplicate: result.isDuplicate
      })
    };
  } catch (error) {
    timer.end({ error: true });
    log.error('AI feedback endpoint error', { error: error.message, stack: error.stack });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to submit AI feedback',
        message: error.message
      })
    };
  }
};
