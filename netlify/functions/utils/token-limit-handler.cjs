/**
 * Token Limit Handler
 * 
 * Provides utilities for detecting and handling token limit scenarios
 * Implements progressive context reduction and fallback strategies
 */

"use strict";

const { createLogger } = require('./logger.cjs');

// Token limits for different Gemini models
const MODEL_TOKEN_LIMITS = {
  'gemini-2.5-flash': 1048576, // 1M input tokens
  'gemini-2.0-flash': 1048576,
  'gemini-1.5-flash': 1048576,
  'gemini-1.5-pro': 2097152,   // 2M input tokens
  'default': 1048576
};

// Safety margin - trigger reduction at 80% of limit
const TOKEN_SAFETY_MARGIN = 0.8;

// Context reduction strategies in order of preference
const REDUCTION_STRATEGIES = [
  {
    name: 'reduce_granularity',
    description: 'Switch from hourly to daily granularity',
    estimatedReduction: 0.5 // ~50% reduction
  },
  {
    name: 'reduce_time_window',
    description: 'Reduce time window by 50%',
    estimatedReduction: 0.5
  },
  {
    name: 'limit_metrics',
    description: 'Request specific metrics instead of "all"',
    estimatedReduction: 0.7 // ~30% reduction
  },
  {
    name: 'sample_data',
    description: 'Use data sampling for large datasets',
    estimatedReduction: 0.6 // ~40% reduction
  }
];

/**
 * Estimate token count for text (rough approximation)
 * Uses ~4 characters per token as rough estimate
 * For more accurate counting, integrate tiktoken library
 * 
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokenCount(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  // Rough approximation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for structured data (JSON)
 * 
 * @param {Object} data - Data object to estimate
 * @returns {number} Estimated token count
 */
function estimateDataTokens(data) {
  try {
    const jsonString = JSON.stringify(data);
    return estimateTokenCount(jsonString);
  } catch (error) {
    return 0;
  }
}

/**
 * Get token limit for a specific model
 * 
 * @param {string} model - Model name
 * @returns {number} Token limit
 */
function getModelTokenLimit(model) {
  const modelKey = model || 'default';
  return MODEL_TOKEN_LIMITS[modelKey] || MODEL_TOKEN_LIMITS.default;
}

/**
 * Check if context is approaching token limit
 * 
 * @param {number} estimatedTokens - Estimated token count
 * @param {string} model - Model name
 * @returns {Object} Status object with warning flag and remaining tokens
 */
function checkTokenLimit(estimatedTokens, model) {
  const limit = getModelTokenLimit(model);
  const safeLimit = limit * TOKEN_SAFETY_MARGIN;
  const isApproachingLimit = estimatedTokens > safeLimit;
  const remaining = limit - estimatedTokens;
  const percentUsed = (estimatedTokens / limit) * 100;

  return {
    isApproachingLimit,
    limit,
    safeLimit,
    estimatedTokens,
    remaining,
    percentUsed: Math.round(percentUsed * 10) / 10,
    exceedsLimit: estimatedTokens > limit
  };
}

/**
 * Suggest context reduction strategy based on current configuration
 * 
 * @param {Object} config - Current query configuration
 * @param {number} currentTokens - Current estimated token count
 * @param {string} model - Model name
 * @returns {Object} Suggested reduction strategy
 */
function suggestReduction(config, currentTokens, model) {
  const tokenStatus = checkTokenLimit(currentTokens, model);
  
  if (!tokenStatus.isApproachingLimit) {
    return { needsReduction: false };
  }

  const suggestions = [];

  // Strategy 1: Reduce granularity (hourly → daily)
  if (config.granularity === 'hourly_avg') {
    suggestions.push({
      ...REDUCTION_STRATEGIES[0],
      newConfig: { ...config, granularity: 'daily_avg' },
      priority: 1
    });
  }

  // Strategy 2: Reduce time window
  if (config.contextWindowDays && config.contextWindowDays > 7) {
    const reducedDays = Math.max(7, Math.floor(config.contextWindowDays * 0.5));
    suggestions.push({
      ...REDUCTION_STRATEGIES[1],
      newConfig: { ...config, contextWindowDays: reducedDays },
      priority: 2
    });
  }

  // Strategy 3: Limit metrics (if using "all")
  if (config.metric === 'all') {
    suggestions.push({
      ...REDUCTION_STRATEGIES[2],
      newConfig: { ...config, metric: 'power' }, // Most important metric
      priority: 3
    });
  }

  // Strategy 4: Sample data
  suggestions.push({
    ...REDUCTION_STRATEGIES[3],
    newConfig: { ...config, sampleRate: 0.5 },
    priority: 4
  });

  // Sort by priority
  suggestions.sort((a, b) => a.priority - b.priority);

  return {
    needsReduction: true,
    tokenStatus,
    suggestions,
    recommendedStrategy: suggestions[0]
  };
}

/**
 * Apply progressive context reduction
 * Tries multiple strategies in sequence until token count is acceptable
 * 
 * @param {Object} config - Original configuration
 * @param {number} currentTokens - Current token estimate
 * @param {string} model - Model name
 * @param {Object} log - Logger instance
 * @returns {Object} Reduced configuration and metadata
 */
function applyContextReduction(config, currentTokens, model, log) {
  const reduction = suggestReduction(config, currentTokens, model);
  
  if (!reduction.needsReduction) {
    return {
      success: true,
      config: config,
      reductionsApplied: [],
      finalTokens: currentTokens
    };
  }

  log.warn('Token limit approaching, applying context reduction', {
    currentTokens,
    percentUsed: reduction.tokenStatus.percentUsed,
    strategy: reduction.recommendedStrategy.name
  });

  const reductionsApplied = [];
  let currentConfig = { ...config };
  let iterations = 0;
  const maxIterations = REDUCTION_STRATEGIES.length;

  while (iterations < maxIterations) {
    const strategy = reduction.suggestions[iterations];
    if (!strategy) break;

    currentConfig = { ...strategy.newConfig };
    reductionsApplied.push({
      strategy: strategy.name,
      description: strategy.description
    });

    // Re-estimate tokens (rough estimate based on reduction factor)
    currentTokens = Math.floor(currentTokens * strategy.estimatedReduction);
    
    const newStatus = checkTokenLimit(currentTokens, model);
    
    if (!newStatus.isApproachingLimit) {
      log.info('Context reduction successful', {
        reductionsApplied: reductionsApplied.length,
        finalTokens: currentTokens,
        percentUsed: newStatus.percentUsed
      });
      break;
    }

    iterations++;
  }

  return {
    success: !checkTokenLimit(currentTokens, model).isApproachingLimit,
    config: currentConfig,
    reductionsApplied,
    finalTokens: currentTokens,
    warning: reductionsApplied.length > 0 
      ? `Context was reduced to fit token limits. Applied: ${reductionsApplied.map(r => r.strategy).join(', ')}`
      : null
  };
}

/**
 * Create a user-friendly message about token limit handling
 * 
 * @param {Array} reductionsApplied - List of reductions applied
 * @returns {string} User message
 */
function createTokenLimitMessage(reductionsApplied) {
  if (!reductionsApplied || reductionsApplied.length === 0) {
    return null;
  }

  const messages = [
    '⚠️ Token Limit Handling:',
    'Your query required too much context for the AI model.',
    'The following optimizations were applied automatically:',
    ...reductionsApplied.map((r, i) => `  ${i + 1}. ${r.description}`),
    '',
    'Results are still accurate but may have less granular details.'
  ];

  return messages.join('\n');
}

/**
 * Handle token limit exceeded scenario with fallback
 * 
 * @param {Object} originalConfig - Original query configuration
 * @param {Object} error - Token limit error
 * @param {Object} log - Logger instance
 * @returns {Object} Fallback configuration and strategy
 */
async function handleTokenLimitExceeded(originalConfig, error, log) {
  log.error('Token limit exceeded', {
    error: error.message,
    config: originalConfig
  });

  // Try aggressive reduction
  const fallbackConfig = {
    ...originalConfig,
    granularity: 'daily_avg',
    contextWindowDays: Math.min(originalConfig.contextWindowDays || 30, 14),
    metric: originalConfig.metric === 'all' ? 'power' : originalConfig.metric,
    sampleRate: 0.5
  };

  return {
    success: true,
    fallbackConfig,
    message: 'Query exceeded token limits. Using reduced context with daily aggregation and 14-day window.',
    userMessage: createTokenLimitMessage([
      { description: 'Switched to daily data aggregation' },
      { description: 'Limited time window to 14 days' },
      { description: 'Applied 50% data sampling' }
    ])
  };
}

module.exports = {
  estimateTokenCount,
  estimateDataTokens,
  getModelTokenLimit,
  checkTokenLimit,
  suggestReduction,
  applyContextReduction,
  createTokenLimitMessage,
  handleTokenLimitExceeded,
  MODEL_TOKEN_LIMITS,
  TOKEN_SAFETY_MARGIN
};
