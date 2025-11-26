// @ts-nocheck
/**
 * AI Feedback Submission Endpoint
 * Stores AI-generated feedback and suggestions for app improvements
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { detectDuplicates } = require('./utils/duplicate-detection.cjs');

/**
 * Submit AI feedback to database
 */
async function submitFeedbackToDatabase(feedbackData, context) {
  const log = createLogger('ai-feedback:submit', context);
  
  try {
    const feedbackCollection = await getCollection('ai_feedback');
    
    // Create feedback document
    const feedback = {
      id: generateId(),
      timestamp: new Date(),
      systemId: feedbackData.systemId,
      feedbackType: feedbackData.feedbackType,
      category: feedbackData.category,
      priority: feedbackData.priority,
      status: 'pending',
      geminiModel: feedbackData.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      suggestion: {
        title: feedbackData.content.title,
        description: feedbackData.content.description,
        rationale: feedbackData.content.rationale,
        implementation: feedbackData.content.implementation,
        expectedBenefit: feedbackData.content.expectedBenefit,
        estimatedEffort: feedbackData.content.estimatedEffort,
        codeSnippets: feedbackData.content.codeSnippets || [],
        affectedComponents: feedbackData.content.affectedComponents || []
      },
      metrics: {
        viewCount: 0,
        lastViewed: null,
        discussionCount: 0
      }
    };
    
    // Enhanced duplicate detection with semantic similarity
    const duplicateCheck = await detectDuplicates(feedback, feedbackCollection, {
      similarityThreshold: 0.7 // 70% similarity threshold
    });
    
    if (duplicateCheck.isDuplicate) {
      log.info('Duplicate feedback detected', {
        existingId: duplicateCheck.existingId,
        matchType: duplicateCheck.matchType,
        similarity: duplicateCheck.similarity
      });
      return {
        id: duplicateCheck.existingId,
        isDuplicate: true,
        matchType: duplicateCheck.matchType,
        similarity: duplicateCheck.similarity,
        similarItems: duplicateCheck.similarItems
      };
    }
    
    // Add contextHash for basic deduplication
    const crypto = require('crypto');
    feedback.contextHash = crypto.createHash('sha256')
      .update(JSON.stringify(feedback.suggestion))
      .digest('hex');
    
    // Insert feedback
    await feedbackCollection.insertOne(feedback);
    
    log.info('AI feedback submitted successfully', {
      feedbackId: feedback.id,
      type: feedback.feedbackType,
      priority: feedback.priority,
      similarItems: duplicateCheck.similarItems.length
    });
    
    // Auto-create GitHub issue if critical
    if (feedback.priority === 'critical') {
      log.info('Critical feedback detected, notifying admin', { feedbackId: feedback.id });
      // Future: Auto-create GitHub issue
    }
    
    return {
      id: feedback.id,
      isDuplicate: false,
      similarItems: duplicateCheck.similarItems
    };
  } catch (error) {
    log.error('Failed to submit AI feedback', { error: error.message });
    throw error;
  }
}

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

/**
 * Helper functions
 */

function generateId() {
  return `fb_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Export for use in other modules
module.exports.submitFeedbackToDatabase = submitFeedbackToDatabase;
