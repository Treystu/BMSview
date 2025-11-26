// @ts-nocheck
/**
 * AI Feedback Analytics Endpoint
 * Provides analytics and metrics for AI feedback system
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

/**
 * Calculate analytics metrics
 */
async function calculateAnalytics(feedbackCollection) {
  const log = createLogger('feedback-analytics:calculate');
  
  try {
    // Get all feedback
    const allFeedback = await feedbackCollection.find({}).toArray();
    
    if (allFeedback.length === 0) {
      return {
        totalFeedback: 0,
        byStatus: {},
        byPriority: {},
        byCategory: {},
        byType: {},
        acceptanceRate: 0,
        implementationRate: 0,
        averageTimeToReview: null,
        averageTimeToImplementation: null,
        topCategories: [],
        recentTrends: []
      };
    }
    
    // Group by status
    const byStatus = allFeedback.reduce((acc, fb) => {
      acc[fb.status] = (acc[fb.status] || 0) + 1;
      return acc;
    }, {});
    
    // Group by priority
    const byPriority = allFeedback.reduce((acc, fb) => {
      acc[fb.priority] = (acc[fb.priority] || 0) + 1;
      return acc;
    }, {});
    
    // Group by category
    const byCategory = allFeedback.reduce((acc, fb) => {
      acc[fb.category] = (acc[fb.category] || 0) + 1;
      return acc;
    }, {});
    
    // Group by type
    const byType = allFeedback.reduce((acc, fb) => {
      acc[fb.feedbackType] = (acc[fb.feedbackType] || 0) + 1;
      return acc;
    }, {});
    
    // Calculate rates
    const acceptedCount = (byStatus.accepted || 0) + (byStatus.implemented || 0);
    const acceptanceRate = (acceptedCount / allFeedback.length) * 100;
    const implementationRate = byStatus.implemented 
      ? (byStatus.implemented / acceptedCount) * 100 
      : 0;
    
    // Calculate average times
    const reviewedFeedback = allFeedback.filter(fb => 
      fb.status !== 'pending' && fb.updatedAt
    );
    
    let averageTimeToReview = null;
    if (reviewedFeedback.length > 0) {
      const totalReviewTime = reviewedFeedback.reduce((acc, fb) => {
        const created = new Date(fb.timestamp).getTime();
        const reviewed = new Date(fb.updatedAt).getTime();
        return acc + (reviewed - created);
      }, 0);
      averageTimeToReview = Math.round(totalReviewTime / reviewedFeedback.length / (1000 * 60 * 60 * 24)); // days
    }
    
    const implementedFeedback = allFeedback.filter(fb => 
      fb.status === 'implemented' && fb.implementationDate
    );
    
    let averageTimeToImplementation = null;
    if (implementedFeedback.length > 0) {
      const totalImplTime = implementedFeedback.reduce((acc, fb) => {
        const created = new Date(fb.timestamp).getTime();
        const implemented = new Date(fb.implementationDate).getTime();
        return acc + (implemented - created);
      }, 0);
      averageTimeToImplementation = Math.round(totalImplTime / implementedFeedback.length / (1000 * 60 * 60 * 24)); // days
    }
    
    // Top categories
    const topCategories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));
    
    // Recent trends (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentFeedback = allFeedback.filter(fb => 
      new Date(fb.timestamp) >= thirtyDaysAgo
    );
    
    const recentTrends = {
      total: recentFeedback.length,
      critical: recentFeedback.filter(fb => fb.priority === 'critical').length,
      high: recentFeedback.filter(fb => fb.priority === 'high').length,
      implemented: recentFeedback.filter(fb => fb.status === 'implemented').length
    };
    
    return {
      totalFeedback: allFeedback.length,
      byStatus,
      byPriority,
      byCategory,
      byType,
      acceptanceRate: Math.round(acceptanceRate * 10) / 10,
      implementationRate: Math.round(implementationRate * 10) / 10,
      averageTimeToReview,
      averageTimeToImplementation,
      topCategories,
      recentTrends,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    log.error('Failed to calculate analytics', { error: error.message });
    throw error;
  }
}

/**
 * Main handler
 */
exports.handler = async (event, context) => {
  const log = createLogger('feedback-analytics', context);
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  try {
    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    const feedbackCollection = await getCollection('ai_feedback');
    const analytics = await calculateAnalytics(feedbackCollection);
    
    log.info('Analytics calculated successfully', {
      totalFeedback: analytics.totalFeedback,
      acceptanceRate: analytics.acceptanceRate
    });
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(analytics)
    };
  } catch (error) {
    log.error('Feedback analytics error', { error: error.message });
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to calculate feedback analytics',
        message: error.message
      })
    };
  }
};

// Export for testing
module.exports.calculateAnalytics = calculateAnalytics;
