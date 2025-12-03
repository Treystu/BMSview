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

const { createLogger, createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
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
 * Generate month buckets for the last N months
 * Utility function to avoid repeated date calculations across functions
 * @param {number} monthsBack - Number of months to go back
 * @returns {Array<{monthStr: string, monthStart: Date, monthEnd: Date}>}
 */
function generateMonthBuckets(monthsBack) {
  const buckets = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthStr = monthStart.toISOString().slice(0, 7);
    buckets.push({ monthStr, monthStart, monthEnd });
  }
  return buckets;
}

/**
 * Group items by month for efficient trend calculation
 * @param {Array} items - Array of items with date field
 * @param {string} dateField - Name of the date field to group by
 * @returns {Object} - Map of month strings to arrays of items
 */
function groupByMonth(items, dateField) {
  const byMonth = {};
  items.forEach(item => {
    if (item[dateField]) {
      const month = new Date(item[dateField]).toISOString().slice(0, 7);
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(item);
    }
  });
  return byMonth;
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
  if (appliedWeights === 0) {
    return null;
  }
  return Math.round((totalScore / appliedWeights) * 10) / 10;
}

// ============================================================================
// ROI CONFIGURATION
// These values are estimates and may need adjustment for your organization.
// If these don't match your actual costs, submit a feature request to make
// them configurable via environment variables or admin settings.
// ============================================================================

/**
 * Developer hourly rate estimate (USD)
 * Based on average market rates for mid-senior developers.
 * NOTE: This is a placeholder value. Actual rates vary significantly by region,
 * experience level, and organization. Consider configuring via environment variable.
 */
const DEV_HOURLY_RATE = parseInt(process.env.DEV_HOURLY_RATE || '100', 10);

/**
 * Estimated effort hours for different time estimates
 * - hours: Quick fixes, typically 2 hours
 * - days: Medium complexity, typically 2 work days (16 hours)
 * - weeks: Large features, typically 2 work weeks (80 hours)
 */
const EFFORT_HOURS_ESTIMATE = {
  hours: 2,
  days: 16,
  weeks: 80
};

/**
 * Category savings multipliers represent the estimated long-term value multiplier
 * based on the type of improvement vs. implementation cost.
 * 
 * Higher multipliers indicate improvements with ongoing/compounding benefits:
 * - bug_report (3.0): Bug fixes prevent future incidents and customer impact
 * - performance (2.5): Performance improvements have ongoing user experience benefits
 * - optimization (2.0): Optimizations reduce operational costs over time
 * - data_structure (2.2): Data improvements enable future features
 * - integration (2.0): Integration improvements reduce maintenance burden
 * - weather_api (1.8): API improvements affect data quality
 * - ui_ux (1.5): UX improvements have moderate long-term impact
 * - analytics (1.5): Analytics improvements help decision-making
 * 
 * NOTE: These are estimated values. Actual ROI varies significantly.
 * Consider submitting a feature request if these don't match your needs.
 */
const CATEGORY_SAVINGS_MULTIPLIERS = {
  performance: 2.5,
  bug_report: 3.0,
  optimization: 2.0,
  ui_ux: 1.5,
  integration: 2.0,
  analytics: 1.5,
  weather_api: 1.8,
  data_structure: 2.2
};

/**
 * Calculate ROI metrics for implemented feedback
 */
function calculateROIMetrics(implementedFeedback) {
  const roiMetrics = implementedFeedback.map(fb => {
    // Estimate cost savings based on effort and category
    const baseHours = EFFORT_HOURS_ESTIMATE[fb.suggestion?.estimatedEffort] || 8;
    const actualHours = fb.actualEffortHours || baseHours;
    
    // Calculate developer cost
    const devCost = actualHours * DEV_HOURLY_RATE;
    
    // Calculate potential savings using category multipliers
    const multiplier = CATEGORY_SAVINGS_MULTIPLIERS[fb.category] || 1.5;
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

  // Group implementations by month first for O(n) instead of O(n*m) complexity
  const implByMonth = groupByMonth(implementedFeedback, 'implementationDate');
  
  // Monthly trend using pre-grouped data
  const monthBuckets = generateMonthBuckets(6);
  const trend = monthBuckets.map(({ monthStr }) => {
    const monthImplemented = implByMonth[monthStr] || [];
    const monthDays = monthImplemented
      .map(fb => daysBetween(fb.timestamp, fb.implementationDate))
      .filter(d => d !== null);
    
    return {
      month: monthStr,
      avgDays: monthDays.length > 0 ? Math.round(monthDays.reduce((a, b) => a + b, 0) / monthDays.length) : null,
      count: monthImplemented.length
    };
  });

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

  // Group surveys by month first for O(n) complexity
  const surveysByMonth = groupByMonth(surveys, 'surveyDate');
  
  // Monthly trend using pre-grouped data
  const monthBuckets = generateMonthBuckets(6);
  const trend = monthBuckets.map(({ monthStr }) => {
    const monthSurveys = surveysByMonth[monthStr] || [];
    return {
      month: monthStr,
      avgScore: monthSurveys.length > 0 
        ? Math.round(monthSurveys.reduce((sum, s) => sum + (s.satisfactionScore || 0), 0) / monthSurveys.length * 10) / 10 
        : null,
      count: monthSurveys.length
    };
  });

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
  // Pre-group feedback by creation and implementation month for O(n) complexity
  const feedbackByCreationMonth = groupByMonth(allFeedback, 'timestamp');
  const feedbackByImplMonth = groupByMonth(
    allFeedback.filter(fb => fb.implementationDate), 
    'implementationDate'
  );
  
  // Generate 12 month buckets
  const monthBuckets = generateMonthBuckets(12);
  
  return monthBuckets.map(({ monthStr }) => {
    const newInMonth = feedbackByCreationMonth[monthStr] || [];
    const implementedInMonth = feedbackByImplMonth[monthStr] || [];
    
    const implDays = implementedInMonth
      .map(fb => daysBetween(fb.timestamp, fb.implementationDate))
      .filter(d => d !== null);
    
    const effScores = implementedInMonth
      .map(fb => fb.effectivenessScore)
      .filter(s => s !== null && s !== undefined);

    return {
      month: monthStr,
      newSuggestions: newInMonth.length,
      implemented: implementedInMonth.length,
      avgTimeToImplement: implDays.length > 0 ? Math.round(implDays.reduce((a, b) => a + b, 0) / implDays.length) : null,
      avgEffectiveness: effScores.length > 0 ? Math.round(effScores.reduce((a, b) => a + b, 0) / effScores.length) : null
    };
  });
}

/**
 * Main handler
 * 
 * SECURITY: Access control is enforced at the page level.
 * The Admin Dashboard (admin.html) requires Netlify Identity OAuth authentication
 * before loading. Once authenticated and the page loads, this endpoint is accessible.
 * No additional authentication or authorization checks are performed in this function.
 */
exports.handler = async (event, context) => {
  const log = createLoggerFromEvent('feedback-analytics', event, context);
  const timer = createTimer(log, 'feedback-analytics-handler');
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
    
    // SECURITY: Access control is enforced at the page level
    // The admin.html page requires Netlify Identity OAuth authentication before loading.
    // Once the page loads, all admin functions are accessible to the authenticated user.
    // No additional authentication checks are performed in this function.
    
    const feedbackCollection = await getCollection('ai_feedback');
    
    // Try to get satisfaction surveys collection (optional)
    let surveysCollection = null;
    let surveysAvailable = true;
    try {
      surveysCollection = await getCollection('satisfaction_surveys');
    } catch (e) {
      surveysAvailable = false;
      log.info('Satisfaction surveys collection not available', { error: e.message });
    }
    
    const analytics = await calculateAnalytics(feedbackCollection, surveysCollection);
    
    // SECURITY: Sanitize response - remove any potentially sensitive data
    // before sending to client. The analytics are aggregated so they don't
    // expose individual feedback details, but we sanitize feedbackIds in
    // top/bottom performers to prevent data leakage.
    const sanitizedAnalytics = sanitizeAnalyticsResponse(analytics);
    
    // Add surveysAvailable flag to help consumers understand data availability
    sanitizedAnalytics.surveysAvailable = surveysAvailable;
    
    log.info('Analytics calculated successfully', {
      totalFeedback: sanitizedAnalytics.totalFeedback,
      acceptanceRate: sanitizedAnalytics.acceptanceRate,
      implementationRate: sanitizedAnalytics.implementationRate,
      surveysAvailable
    });
    
    timer.end({ success: true });
    log.exit(200, { totalFeedback: sanitizedAnalytics.totalFeedback });
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitizedAnalytics)
    };
  } catch (error) {
    log.error('Feedback analytics error', { error: error.message });
    timer.end({ success: false, error: error.message });
    log.exit(500);
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

/**
 * Sanitize analytics response to remove/mask sensitive data
 * - Truncates feedbackIds to prevent direct lookup
 * - Removes any user-identifying information
 * - Keeps aggregate statistics intact
 */
function sanitizeAnalyticsResponse(analytics) {
  const sanitized = { ...analytics };
  
  // Sanitize ROI top implementations - mask feedbackIds
  if (sanitized.roiSummary?.topROIImplementations) {
    sanitized.roiSummary.topROIImplementations = sanitized.roiSummary.topROIImplementations.map((item, idx) => ({
      ...item,
      feedbackId: `impl-${idx + 1}`, // Replace with generic identifier
    }));
  }
  
  // Sanitize effectiveness top/bottom performers - mask feedbackIds
  if (sanitized.effectivenessOverview?.topPerformers) {
    sanitized.effectivenessOverview.topPerformers = sanitized.effectivenessOverview.topPerformers.map((item, idx) => ({
      ...item,
      feedbackId: `top-${idx + 1}`,
    }));
  }
  
  if (sanitized.effectivenessOverview?.bottomPerformers) {
    sanitized.effectivenessOverview.bottomPerformers = sanitized.effectivenessOverview.bottomPerformers.map((item, idx) => ({
      ...item,
      feedbackId: `bottom-${idx + 1}`,
    }));
  }
  
  // User satisfaction data is already aggregated, no individual user data exposed
  // but ensure we don't leak any userId references if they exist
  if (sanitized.userSatisfaction?.satisfactionTrend) {
    sanitized.userSatisfaction.satisfactionTrend = sanitized.userSatisfaction.satisfactionTrend.map(item => {
      const { userId, ...rest } = item;
      return rest;
    });
  }
  
  return sanitized;
}

// Export for testing
module.exports.calculateAnalytics = calculateAnalytics;
module.exports.calculateEffectivenessScore = calculateEffectivenessScore;
module.exports.calculateROIMetrics = calculateROIMetrics;
module.exports.daysBetween = daysBetween;
module.exports.calculateMedian = calculateMedian;
module.exports.calculatePercentile = calculatePercentile;
module.exports.sanitizeAnalyticsResponse = sanitizeAnalyticsResponse;
