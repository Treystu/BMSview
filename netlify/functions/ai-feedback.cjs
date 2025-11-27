// @ts-nocheck
/**
 * AI Feedback Submission Endpoint
 * Stores AI-generated feedback and suggestions for app improvements
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { submitFeedbackToDatabase } = require('./utils/feedback-manager.cjs');

/**
 * Main handler
 */
exports.handler = async (event, context) => {
  const log = createLogger('ai-feedback', context);
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    const body = JSON.parse(event.body);
    const { systemId, feedbackType, content, priority, category } = body;
    
    // Validate required fields
    if (!systemId || !feedbackType || !content || !priority || !category) {
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
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Invalid feedbackType. Must be one of: ${validFeedbackTypes.join(', ')}` })
      };
    }
    
    if (!validCategories.includes(category)) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` })
      };
    }
    
    if (!validPriorities.includes(priority)) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` })
      };
    }
    
    // Submit feedback
    const result = await submitFeedbackToDatabase(body, context);
    
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
    log.error('AI feedback endpoint error', { error: error.message });
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
