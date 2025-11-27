// @ts-nocheck
/**
 * Feedback Manager Utility
 * Shared utility for managing AI feedback submissions
 * Prevents circular dependencies between endpoint files
 */

const { createLogger } = require('./logger.cjs');
const { getCollection } = require('./mongodb.cjs');
const { detectDuplicates } = require('./duplicate-detection.cjs');

/**
 * Submit AI feedback to database
 * @param {Object} feedbackData - The feedback data to submit
 * @param {Object} context - Lambda context for logging
 * @returns {Promise<Object>} Result with id, isDuplicate flag, and similar items
 */
async function submitFeedbackToDatabase(feedbackData, context) {
  const log = createLogger('feedback-manager:submit', context);
  
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
 * Generate unique feedback ID
 * @returns {string} Unique ID in format fb_{timestamp}_{random}
 */
function generateId() {
  return `fb_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

module.exports = {
  submitFeedbackToDatabase
};
