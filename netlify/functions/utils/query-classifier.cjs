// @ts-nocheck
/**
 * Query Classifier
 *
 * Analyzes user prompts to determine what analytical tools should be
 * automatically pre-loaded for efficient insights generation.
 */

const { createLogger } = require('./logger.cjs');

/**
 * Query patterns that trigger auto-trending
 */
const PATTERN_GROUPS = {
  degradation: [
    /battery health/i,
    /degradation/i,
    /capacity loss/i,
    /battery lifetime/i,
    /service life/i,
    /battery life/i,
    /how long.*last/i,
    /replacement/i,
    /wear/i
  ],
  performance: [
    /performance/i,
    /efficiency/i,
    /how.*performing/i,
    /metrics/i,
    /baseline/i,
    /benchmarks?/i
  ],
  usage: [
    /usage patterns?/i,
    /consumption/i,
    /load profile/i,
    /daily usage/i,
    /energy budget/i,
    /draw/i
  ],
  comparison: [
    /compare/i,
    /vs\b/i,
    /versus/i,
    /this (week|month|year)/i,
    /last (week|month|year)/i,
    /better|worse/i,
    /improving|declining/i
  ],
  trends: [
    /trend/i,
    /over time/i,
    /historical/i,
    /changes?/i,
    /evolution/i,
    /forecast/i,
    /predict/i
  ]
};

/**
 * Classify a user query to determine which analytics to pre-load
 *
 * @param {string} query - User's query or custom prompt
 * @param {any} log - Logger instance
 * @returns {Object} Classification result
 */
function classifyQuery(query, log = createLogger('query-classifier')) {
  if (!query || typeof query !== 'string') {
    return {
      needsDegradationAnalysis: false,
      needsPerformanceBaseline: false,
      needsUsagePatterns: false,
      needsComparison: false,
      needsTrending: false,
      confidence: 0
    };
  }

  const lowerQuery = query.toLowerCase();
  const matches = {
    degradation: 0,
    performance: 0,
    usage: 0,
    comparison: 0,
    trends: 0
  };

  // Count pattern matches
  for (const [category, patterns] of Object.entries(PATTERN_GROUPS)) {
    for (const pattern of patterns) {
      if (pattern.test(lowerQuery)) {
        matches[category]++;
      }
    }
  }

  // Calculate total matches
  const totalMatches = Object.values(matches).reduce((sum, count) => sum + count, 0);

  // Determine confidence (0-100)
  const confidence = Math.min(100, (totalMatches / 3) * 100);

  const classification = {
    needsDegradationAnalysis: matches.degradation > 0,
    needsPerformanceBaseline: matches.performance > 0,
    needsUsagePatterns: matches.usage > 0,
    needsComparison: matches.comparison > 0,
    needsTrending: matches.trends > 0 || matches.degradation > 0,
    confidence,
    matchCounts: matches
  };

  log.debug('Query classified', {
    query: query.substring(0, 100),
    classification: {
      ...classification,
      matchCounts: undefined // Don't log detailed counts
    }
  });

  return classification;
}

/**
 * Determine if query should trigger full context mode
 *
 * Full context mode is appropriate for queries that need comprehensive
 * historical analysis across multiple dimensions.
 *
 * @param {string} query - User's query
 * @param {any} log - Logger instance
 * @returns {boolean}
 */
function shouldUseFullContext(query, log = createLogger('query-classifier')) {
  const classification = classifyQuery(query, log);

  // Full context if:
  // 1. High confidence (>60%)
  // 2. Multiple categories matched
  // 3. Comparison or trending requested
  const categoryCount = [
    classification.needsDegradationAnalysis,
    classification.needsPerformanceBaseline,
    classification.needsUsagePatterns,
    classification.needsComparison,
    classification.needsTrending
  ].filter(Boolean).length;

  const shouldUse =
    classification.confidence > 60 ||
    categoryCount >= 2 ||
    classification.needsComparison ||
    classification.needsTrending;

  log.debug('Full context decision', {
    shouldUse,
    confidence: classification.confidence,
    categoryCount
  });

  return shouldUse;
}

/**
 * Get list of tools that should be pre-loaded based on query classification
 *
 * @param {string} query - User's query
 * @param {any} log - Logger instance
 * @returns {Array<string>} Tool names to pre-load
 */
function getRecommendedTools(query, log = createLogger('query-classifier')) {
  const classification = classifyQuery(query, log);
  const tools = [];

  // Always load system analytics for context
  if (classification.confidence > 40) {
    tools.push('getSystemAnalytics');
  }

  // Add specific tools based on classification
  if (classification.needsDegradationAnalysis) {
    tools.push('predict_battery_trends');
  }

  if (classification.needsUsagePatterns) {
    tools.push('analyze_usage_patterns');
  }

  if (classification.needsComparison || classification.needsTrending) {
    // Comparison requires daily rollup data
    tools.push('load_90_day_daily_rollup');
  }

  log.debug('Recommended tools', { tools, confidence: classification.confidence });

  return tools;
}

module.exports = {
  classifyQuery,
  shouldUseFullContext,
  getRecommendedTools,
  PATTERN_GROUPS
};
