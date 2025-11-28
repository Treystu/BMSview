// @ts-nocheck
/**
 * AI Feedback Analytics Endpoint
 * Provides comprehensive analytics and metrics for AI feedback system including:
 * - Implementation tracking
 * - ROI calculations
 * - Time-to-implementation metrics
 * - Effectiveness scoring
 * - User satisfaction tracking
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

/**
 * Calculate time difference in days
 */
function daysBetween(start, end) {
  if (!start || !end) return null;
  const startDate = new Date(start).getTime();
  const endDate = new Date(end).getTime();
  return Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate median of an array
 */
function calculateMedian(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate percentile of an array
 */
function calculatePercentile(arr, percentile) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Calculate effectiveness score for a feedback item
 */
function calculateEffectivenessScore(feedback, satisfactionSurveys = []) {
  const weights = {
    implementationSpeed: 0.25,
    userSatisfaction: 0.30,
    roiScore: 0.25,
    stabilityScore: 0.20
  };

  let totalScore = 0;
  let appliedWeights = 0;

  // Implementation speed score (faster = higher score)
  if (feedback.implementationDate && feedback.timestamp) {
    const days = daysBetween(feedback.timestamp, feedback.implementationDate);
    // Score: 100 for same day, decreases by 5 per day, minimum 20
    const speedScore = Math.max(20, 100 - (days * 5));
    totalScore += speedScore * weights.implementationSpeed;
    appliedWeights += weights.implementationSpeed;
  }

  // User satisfaction from surveys
  const relatedSurveys = satisfactionSurveys.filter(s => s.feedbackId === feedback.id);
  if (relatedSurveys.length > 0) {
    const avgSatisfaction = relatedSurveys.reduce((sum, s) => sum + s.satisfactionScore, 0) / relatedSurveys.length;
    const satisfactionScore = (avgSatisfaction / 5) * 100; // Convert 1-5 scale to 0-100
    totalScore += satisfactionScore * weights.userSatisfaction;
    appliedWeights += weights.userSatisfaction;
  }

  // ROI score from actualBenefitScore if available
  if (feedback.actualBenefitScore !== undefined) {
    totalScore += feedback.actualBenefitScore * weights.roiScore;
    appliedWeights += weights.roiScore;
  }

  // Stability score (default to 80 if not measured)
  const stabilityScore = feedback.stabilityScore || 80;
  totalScore += stabilityScore * weights.stabilityScore;
  appliedWeights += weights.stabilityScore;

  // Normalize if not all weights applied
  return appliedWeights > 0 ? Math.round((totalScore / appliedWeights) * 10) / 10 : null;
}

/**
 * Calculate ROI metrics for implemented feedback
 */
function calculateROIMetrics(implementedFeedback) {
  const roiMetrics = implementedFeedback.map(fb => {
    // Estimate cost savings based on effort and category
    const effortHours = {
      hours: 2,
      days: 16,
      weeks: 80
    };
    const baseHours = effortHours[fb.suggestion?.estimatedEffort] || 8;
    const actualHours = fb.actualEffortHours || baseHours;
    
    // Estimate hourly rate for developer time
    const hourlyRate = 100;
    const devCost = actualHours * hourlyRate;
    
    // Calculate potential savings (simplified model)
    const categorySavingsMultiplier = {
      performance: 2.5,
      bug_report: 3.0,
      optimization: 2.0,
      ui_ux: 1.5,
      integration: 2.0,
      analytics: 1.5,
      weather_api: 1.8,
      data_structure: 2.2
    };
    const multiplier = categorySavingsMultiplier[fb.category] || 1.5;
    const estimatedSavings = Math.round(devCost * multiplier);

    return {
      feedbackId: fb.id,
      feedbackTitle: fb.suggestion?.title || 'Unknown',
      category: fb.category,
      estimatedEffort: fb.suggestion?.estimatedEffort || 'days',
      actualEffortHours: actualHours,
      estimatedBenefit: fb.suggestion?.expectedBenefit || '',
      actualBenefitScore: fb.actualBenefitScore || null,
      costSavingsEstimate: estimatedSavings,
      performanceImprovementPercent: fb.performanceImprovementPercent || null,
      userSatisfactionChange: fb.userSatisfactionChange || null,
      implementedAt: fb.implementationDate
    };
  });

  return {
    totalEstimatedSavings: roiMetrics.reduce((sum, r) => sum + (r.costSavingsEstimate || 0), 0),
    averageROIScore: roiMetrics.length > 0 
      ? Math.round(roiMetrics.reduce((sum, r) => sum + (r.actualBenefitScore || 50), 0) / roiMetrics.length)
      : 0,
    topROIImplementations: roiMetrics
      .sort((a, b) => (b.costSavingsEstimate || 0) - (a.costSavingsEstimate || 0))
      .slice(0, 5)
  };
}

/**
 * Calculate basic analytics metrics (original function, enhanced)
 */
async function calculateAnalytics(feedbackCollection, surveysCollection = null) {
  const log = createLogger('feedback-analytics:calculate');
  
  try {
    // Get all feedback
    const allFeedback = await feedbackCollection.find({}).toArray();
    
    // Get satisfaction surveys if collection is available
    let satisfactionSurveys = [];
    if (surveysCollection) {
      try {
        satisfactionSurveys = await surveysCollection.find({}).toArray();
      } catch (e) {
        log.warn('Could not fetch satisfaction surveys', { error: e.message });
      }
    }
    
    if (allFeedback.length === 0) {
      return getEmptyAnalytics();
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

    // Enhanced implementation metrics
    const implementationMetrics = calculateImplementationMetrics(allFeedback);
    
    // ROI summary
    const roiSummary = calculateROIMetrics(implementedFeedback);
    
    // Time to implementation detailed metrics
    const timeToImplementation = calculateTimeToImplementationMetrics(allFeedback, implementedFeedback);
    
    // Effectiveness scores
    const effectivenessOverview = calculateEffectivenessOverview(implementedFeedback, satisfactionSurveys);
    
    // User satisfaction summary
    const userSatisfaction = calculateUserSatisfactionMetrics(satisfactionSurveys);
    
    // Monthly breakdown
    const monthlyBreakdown = calculateMonthlyBreakdown(allFeedback);
    
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
      // Enhanced metrics
      implementationMetrics,
      roiSummary,
      timeToImplementation,
      effectivenessOverview,
      userSatisfaction,
      monthlyBreakdown,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    log.error('Failed to calculate analytics', { error: error.message });
    throw error;
  }
}

/**
 * Get empty analytics structure
 */
function getEmptyAnalytics() {
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
    recentTrends: { total: 0, critical: 0, high: 0, implemented: 0 },
    implementationMetrics: {
      byPriority: {},
      byCategory: {},
      byEffort: {}
    },
    roiSummary: {
      totalEstimatedSavings: 0,
      averageROIScore: 0,
      topROIImplementations: []
    },
    timeToImplementation: {
      averageDays: null,
      medianDays: null,
      p90Days: null,
      byPriority: {},
      trend: []
    },
    effectivenessOverview: {
      averageScore: null,
      scoreDistribution: [],
      topPerformers: [],
      bottomPerformers: []
    },
    userSatisfaction: {
      averageScore: null,
      surveyCount: 0,
      satisfactionTrend: [],
      impactRating: null,
      recommendations: 0
    },
    monthlyBreakdown: [],
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Calculate implementation metrics by priority, category, and effort
 */
function calculateImplementationMetrics(allFeedback) {
  const byPriority = {};
  const byCategory = {};
  const byEffort = {};

  // Group and calculate for priority
  const priorities = ['critical', 'high', 'medium', 'low'];
  priorities.forEach(priority => {
    const filtered = allFeedback.filter(fb => fb.priority === priority);
    const implemented = filtered.filter(fb => fb.status === 'implemented');
    byPriority[priority] = {
      total: filtered.length,
      implemented: implemented.length,
      rate: filtered.length > 0 ? Math.round((implemented.length / filtered.length) * 100) : 0
    };
  });

  // Group and calculate for category
  const categories = [...new Set(allFeedback.map(fb => fb.category))];
  categories.forEach(category => {
    const filtered = allFeedback.filter(fb => fb.category === category);
    const implemented = filtered.filter(fb => fb.status === 'implemented');
    byCategory[category] = {
      total: filtered.length,
      implemented: implemented.length,
      rate: filtered.length > 0 ? Math.round((implemented.length / filtered.length) * 100) : 0
    };
  });

  // Group and calculate for effort
  const efforts = ['hours', 'days', 'weeks'];
  efforts.forEach(effort => {
    const filtered = allFeedback.filter(fb => fb.suggestion?.estimatedEffort === effort);
    const implemented = filtered.filter(fb => fb.status === 'implemented' && fb.implementationDate);
    const implDays = implemented.map(fb => daysBetween(fb.timestamp, fb.implementationDate)).filter(d => d !== null);
    byEffort[effort] = {
      total: filtered.length,
      implemented: implemented.length,
      avgDays: implDays.length > 0 ? Math.round(implDays.reduce((a, b) => a + b, 0) / implDays.length) : null
    };
  });

  return { byPriority, byCategory, byEffort };
}

/**
 * Calculate detailed time-to-implementation metrics
 */
function calculateTimeToImplementationMetrics(allFeedback, implementedFeedback) {
  const implDays = implementedFeedback
    .map(fb => daysBetween(fb.timestamp, fb.implementationDate))
    .filter(d => d !== null);

  const byPriority = {};
  ['critical', 'high', 'medium', 'low'].forEach(priority => {
    const filtered = implementedFeedback.filter(fb => fb.priority === priority);
    const days = filtered.map(fb => daysBetween(fb.timestamp, fb.implementationDate)).filter(d => d !== null);
    byPriority[priority] = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
  });

  // Monthly trend
  const trend = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthStr = monthStart.toISOString().slice(0, 7);
    
    const monthImplemented = implementedFeedback.filter(fb => {
      const implDate = new Date(fb.implementationDate);
      return implDate >= monthStart && implDate <= monthEnd;
    });
    
    const monthDays = monthImplemented
      .map(fb => daysBetween(fb.timestamp, fb.implementationDate))
      .filter(d => d !== null);
    
    trend.push({
      month: monthStr,
      avgDays: monthDays.length > 0 ? Math.round(monthDays.reduce((a, b) => a + b, 0) / monthDays.length) : null,
      count: monthImplemented.length
    });
  }

  return {
    averageDays: implDays.length > 0 ? Math.round(implDays.reduce((a, b) => a + b, 0) / implDays.length) : null,
    medianDays: calculateMedian(implDays),
    p90Days: calculatePercentile(implDays, 90),
    byPriority,
    trend
  };
}

/**
 * Calculate effectiveness overview
 */
function calculateEffectivenessOverview(implementedFeedback, satisfactionSurveys) {
  const scores = implementedFeedback.map(fb => ({
    feedbackId: fb.id,
    totalScore: calculateEffectivenessScore(fb, satisfactionSurveys),
    implementationSpeed: fb.implementationDate && fb.timestamp ? 
      Math.max(20, 100 - (daysBetween(fb.timestamp, fb.implementationDate) * 5)) : null,
    userSatisfaction: null,
    roiScore: fb.actualBenefitScore || null,
    adoptionRate: fb.adoptionRate || null,
    stabilityScore: fb.stabilityScore || 80,
    calculatedAt: new Date().toISOString()
  })).filter(s => s.totalScore !== null);

  // Score distribution
  const ranges = [
    { range: '0-20', count: 0 },
    { range: '21-40', count: 0 },
    { range: '41-60', count: 0 },
    { range: '61-80', count: 0 },
    { range: '81-100', count: 0 }
  ];

  scores.forEach(s => {
    if (s.totalScore <= 20) ranges[0].count++;
    else if (s.totalScore <= 40) ranges[1].count++;
    else if (s.totalScore <= 60) ranges[2].count++;
    else if (s.totalScore <= 80) ranges[3].count++;
    else ranges[4].count++;
  });

  return {
    averageScore: scores.length > 0 
      ? Math.round(scores.reduce((sum, s) => sum + s.totalScore, 0) / scores.length * 10) / 10 
      : null,
    scoreDistribution: ranges,
    topPerformers: [...scores].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)).slice(0, 5),
    bottomPerformers: [...scores].sort((a, b) => (a.totalScore || 0) - (b.totalScore || 0)).slice(0, 5)
  };
}

/**
 * Calculate user satisfaction metrics
 */
function calculateUserSatisfactionMetrics(surveys) {
  if (!surveys || surveys.length === 0) {
    return {
      averageScore: null,
      surveyCount: 0,
      satisfactionTrend: [],
      impactRating: null,
      recommendations: 0
    };
  }

  const avgScore = surveys.reduce((sum, s) => sum + (s.satisfactionScore || 0), 0) / surveys.length;
  const avgImpact = surveys.reduce((sum, s) => sum + (s.impactRating || 0), 0) / surveys.length;
  const recommendations = surveys.filter(s => s.wouldRecommend).length;

  // Monthly trend
  const trend = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthStr = monthStart.toISOString().slice(0, 7);
    
    const monthSurveys = surveys.filter(s => {
      const surveyDate = new Date(s.surveyDate);
      return surveyDate >= monthStart && surveyDate <= monthEnd;
    });
    
    trend.push({
      month: monthStr,
      avgScore: monthSurveys.length > 0 
        ? Math.round(monthSurveys.reduce((sum, s) => sum + (s.satisfactionScore || 0), 0) / monthSurveys.length * 10) / 10 
        : null,
      count: monthSurveys.length
    });
  }

  return {
    averageScore: Math.round(avgScore * 10) / 10,
    surveyCount: surveys.length,
    satisfactionTrend: trend,
    impactRating: Math.round(avgImpact * 10) / 10,
    recommendations
  };
}

/**
 * Calculate monthly breakdown
 */
function calculateMonthlyBreakdown(allFeedback) {
  const breakdown = [];
  const now = new Date();
  
  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthStr = monthStart.toISOString().slice(0, 7);
    
    const newInMonth = allFeedback.filter(fb => {
      const created = new Date(fb.timestamp);
      return created >= monthStart && created <= monthEnd;
    });
    
    const implementedInMonth = allFeedback.filter(fb => {
      if (!fb.implementationDate) return false;
      const implemented = new Date(fb.implementationDate);
      return implemented >= monthStart && implemented <= monthEnd;
    });
    
    const implDays = implementedInMonth
      .map(fb => daysBetween(fb.timestamp, fb.implementationDate))
      .filter(d => d !== null);
    
    const effScores = implementedInMonth
      .map(fb => fb.effectivenessScore)
      .filter(s => s !== null && s !== undefined);

    breakdown.push({
      month: monthStr,
      newSuggestions: newInMonth.length,
      implemented: implementedInMonth.length,
      avgTimeToImplement: implDays.length > 0 ? Math.round(implDays.reduce((a, b) => a + b, 0) / implDays.length) : null,
      avgEffectiveness: effScores.length > 0 ? Math.round(effScores.reduce((a, b) => a + b, 0) / effScores.length) : null
    });
  }
  
  return breakdown;
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
    
    // Try to get satisfaction surveys collection (optional)
    let surveysCollection = null;
    try {
      surveysCollection = await getCollection('satisfaction_surveys');
    } catch (e) {
      log.info('Satisfaction surveys collection not available', { error: e.message });
    }
    
    const analytics = await calculateAnalytics(feedbackCollection, surveysCollection);
    
    log.info('Analytics calculated successfully', {
      totalFeedback: analytics.totalFeedback,
      acceptanceRate: analytics.acceptanceRate,
      implementationRate: analytics.implementationRate
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
module.exports.calculateEffectivenessScore = calculateEffectivenessScore;
module.exports.calculateROIMetrics = calculateROIMetrics;
module.exports.daysBetween = daysBetween;
module.exports.calculateMedian = calculateMedian;
module.exports.calculatePercentile = calculatePercentile;
