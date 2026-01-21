// @ts-nocheck
/**
 * Query Complexity Estimator
 *
 * Analyzes queries to determine if they should be routed to async mode.
 * Factors: date range, data volume, prompt length, expected tool calls.
 */

const { createLogger } = require('./logger.cjs');
const { getCollection } = require('./mongodb.cjs');

/**
 * Complexity score weights (must sum to 100)
 */
const WEIGHTS = {
  dateRange: 30,      // Long date ranges require more processing
  dataVolume: 25,     // Large datasets take longer to process
  promptLength: 15,   // Complex prompts need more analysis
  toolCalls: 20,      // Multiple tool calls increase duration
  contextMode: 10     // Full context mode is expensive
};

/**
 * Complexity thresholds
 */
const THRESHOLDS = {
  simple: 30,         // 0-30: Simple query, sync mode fine
  moderate: 60,       // 30-60: Moderate complexity, sync likely OK
  complex: 75,        // 60-75: Complex, async recommended
  veryComplex: 90     // 75+: Very complex, async strongly recommended
};

/**
 * Calculate query complexity score (0-100)
 *
 * @param {Object} params - Query parameters
 * @param {string} params.customPrompt - User's custom prompt
 * @param {string} params.systemId - BMS system ID
 * @param {string} params.startDate - Start date for analysis
 * @param {string} params.endDate - End date for analysis
 * @param {boolean} params.fullContextMode - Whether full context is requested
 * @param {any} log - Logger instance
 * @returns {Promise<Object>} Complexity analysis
 */
async function calculateComplexity(params, log = createLogger('query-complexity')) {
  const {
    customPrompt = '',
    systemId,
    startDate,
    endDate,
    fullContextMode = false
  } = params;

  log.debug('Calculating query complexity', {
    hasPrompt: !!customPrompt,
    promptLength: customPrompt.length,
    systemId,
    startDate,
    endDate,
    fullContextMode
  });

  // Calculate individual complexity factors (0-100 each)
  const factors = {
    dateRange: await calculateDateRangeComplexity(startDate, endDate, log),
    dataVolume: await calculateDataVolumeComplexity(systemId, startDate, endDate, log),
    promptLength: calculatePromptComplexity(customPrompt),
    toolCalls: estimateToolCallComplexity(customPrompt, fullContextMode),
    contextMode: fullContextMode ? 100 : 0
  };

  // Calculate weighted score
  let totalScore = 0;
  for (const [factor, score] of Object.entries(factors)) {
    totalScore += (score * WEIGHTS[factor]) / 100;
  }

  // Round to nearest integer
  totalScore = Math.round(totalScore);

  // Determine recommendation
  const recommendation = totalScore < THRESHOLDS.simple
    ? 'sync'
    : totalScore < THRESHOLDS.moderate
      ? 'sync'
      : totalScore < THRESHOLDS.complex
        ? 'async_optional'
        : 'async_recommended';

  const analysis = {
    totalScore,
    factors,
    recommendation,
    reasoning: generateReasoning(factors, totalScore)
  };

  log.info('Query complexity calculated', {
    totalScore,
    recommendation,
    factors: Object.entries(factors).map(([k, v]) => `${k}=${v}`).join(', ')
  });

  return analysis;
}

/**
 * Calculate date range complexity (0-100)
 *
 * Longer date ranges = higher complexity
 * - 0-7 days: Low (0-30)
 * - 7-30 days: Moderate (30-60)
 * - 30-90 days: High (60-85)
 * - 90+ days: Very high (85-100)
 *
 * @param {string} startDate - Start date (ISO 8601)
 * @param {string} endDate - End date (ISO 8601)
 * @param {any} log - Logger instance
 * @returns {number} Complexity score 0-100
 */
function calculateDateRangeComplexity(startDate, endDate, log) {
  if (!startDate || !endDate) {
    // No date range = use defaults (30 days), moderate complexity
    return 40;
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.abs((end - start) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 7) return 20;
    if (daysDiff <= 30) return 45;
    if (daysDiff <= 90) return 75;
    return 95;
  } catch (error) {
    log.warn('Failed to calculate date range complexity', { error: error.message });
    return 40; // Default to moderate
  }
}

/**
 * Calculate data volume complexity (0-100)
 *
 * More records = higher complexity
 * - 0-100 records: Low (0-25)
 * - 100-500 records: Moderate (25-50)
 * - 500-1000 records: High (50-75)
 * - 1000+ records: Very high (75-100)
 *
 * @param {string} systemId - BMS system ID
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {any} log - Logger instance
 * @returns {Promise<number>} Complexity score 0-100
 */
async function calculateDataVolumeComplexity(systemId, startDate, endDate, log) {
  if (!systemId) {
    return 0; // No system ID = no data to process
  }

  try {
    const collection = await getCollection('history');

    // Build query
    const query = { systemId };
    if (startDate && endDate) {
      query.timestamp = {
        $gte: startDate,
        $lte: endDate
      };
    }

    // Count records
    const count = await collection.countDocuments(query);

    log.debug('Data volume calculated', { systemId, count, startDate, endDate });

    if (count <= 100) return 15;
    if (count <= 500) return 40;
    if (count <= 1000) return 65;
    if (count <= 2000) return 85;
    return 100;
  } catch (error) {
    log.warn('Failed to calculate data volume complexity', { error: error.message });
    return 50; // Default to moderate
  }
}

/**
 * Calculate prompt complexity (0-100)
 *
 * Longer prompts = more complex analysis needed
 * - 0-100 chars: Low (0-20)
 * - 100-300 chars: Moderate (20-50)
 * - 300-500 chars: High (50-75)
 * - 500+ chars: Very high (75-100)
 *
 * @param {string} prompt - User's custom prompt
 * @returns {number} Complexity score 0-100
 */
function calculatePromptComplexity(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return 10; // No prompt = simple default insights
  }

  const length = prompt.length;

  if (length <= 100) return 15;
  if (length <= 300) return 40;
  if (length <= 500) return 65;
  return 90;
}

/**
 * Estimate tool call complexity (0-100)
 *
 * Analyzes prompt to estimate how many tools will be needed.
 * More tools = higher complexity.
 *
 * @param {string} prompt - User's custom prompt
 * @param {boolean} fullContextMode - Whether full context is requested
 * @returns {number} Complexity score 0-100
 */
function estimateToolCallComplexity(prompt, fullContextMode) {
  if (fullContextMode) {
    // Full context pre-loads many tools
    return 85;
  }

  if (!prompt || typeof prompt !== 'string') {
    return 20; // Default insights = minimal tool calls
  }

  // Count tool-triggering keywords
  const keywords = {
    data: /data|records|history|snapshots?/gi,
    analytics: /analytics|statistics|metrics|patterns?/gi,
    trends: /trend|forecast|predict|degradation/gi,
    comparison: /compare|vs|versus|better|worse/gi,
    weather: /weather|temperature|solar|cloud/gi,
    budget: /budget|autonomy|runtime|remaining/gi
  };

  let matchCount = 0;
  for (const pattern of Object.values(keywords)) {
    if (pattern.test(prompt)) {
      matchCount++;
    }
  }

  // 0-1 keywords: Low (20)
  // 2-3 keywords: Moderate (50)
  // 4-5 keywords: High (75)
  // 6+ keywords: Very high (95)
  if (matchCount <= 1) return 20;
  if (matchCount <= 3) return 50;
  if (matchCount <= 5) return 75;
  return 95;
}

/**
 * Generate human-readable reasoning for complexity score
 *
 * @param {Object} factors - Individual complexity factors
 * @param {number} totalScore - Total complexity score
 * @returns {string} Reasoning text
 */
function generateReasoning(factors, totalScore) {
  const reasons = [];

  if (factors.dateRange > 70) {
    reasons.push('long date range (90+ days)');
  }

  if (factors.dataVolume > 70) {
    reasons.push('large dataset (1000+ records)');
  }

  if (factors.promptLength > 60) {
    reasons.push('detailed custom prompt');
  }

  if (factors.toolCalls > 70) {
    reasons.push('multiple tool calls expected');
  }

  if (factors.contextMode === 100) {
    reasons.push('full context mode requested');
  }

  if (reasons.length === 0) {
    return 'Simple query with minimal processing requirements';
  }

  return `Complex query due to: ${reasons.join(', ')}`;
}

/**
 * Should query be auto-routed to async mode?
 *
 * @param {Object} complexityAnalysis - Result from calculateComplexity()
 * @returns {boolean}
 */
function shouldUseAsync(complexityAnalysis) {
  return complexityAnalysis.totalScore >= THRESHOLDS.complex;
}

module.exports = {
  calculateComplexity,
  shouldUseAsync,
  THRESHOLDS,
  WEIGHTS
};
