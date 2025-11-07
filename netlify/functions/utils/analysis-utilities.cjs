/**
 * Shared Utilities for Analysis Modules
 * 
 * Common helper functions used across forecasting, pattern analysis, and energy budget modules.
 * 
 * @module netlify/functions/utils/analysis-utilities
 */

/**
 * Parse time range string (e.g., "7d", "30d", "90d", "1y") to number of days
 * 
 * @param {string} timeRange - Time range string (e.g., "30d", "2w", "3m", "1y")
 * @returns {number} Number of days
 * 
 * @example
 * parseTimeRange("7d") // Returns 7
 * parseTimeRange("2w") // Returns 14
 * parseTimeRange("3m") // Returns 90
 * parseTimeRange("1y") // Returns 365
 */
function parseTimeRange(timeRange) {
  const match = timeRange.match(/^(\d+)(d|w|m|y)$/);
  if (!match) return 30; // Default to 30 days
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 'd': return value;
    case 'w': return value * 7;
    case 'm': return value * 30;
    case 'y': return value * 365;
    default: return 30;
  }
}

/**
 * Calculate statistics (mean, standard deviation, min, max) for a numeric array
 * 
 * @param {number[]} values - Array of numeric values
 * @returns {Object} Statistics object with mean, stdDev, min, max
 */
function calculateStats(values) {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0, min: 0, max: 0 };
  }
  
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  return { mean, stdDev, min, max };
}

/**
 * Battery replacement threshold constants
 * Different battery chemistries have different end-of-life criteria
 */
const BATTERY_REPLACEMENT_THRESHOLDS = {
  // Lithium-based batteries (LiFePO4, Li-ion)
  lithium: 0.80, // 80% of original capacity is common replacement threshold
  
  // Lead-acid batteries
  leadAcid: 0.70, // 70% is typical for lead-acid
  
  // Default (conservative estimate)
  default: 0.80
};

/**
 * Anomaly detection threshold in standard deviations
 * Values beyond this many standard deviations are considered anomalies
 * 
 * Common values:
 * - 2.0σ: ~95% confidence (more sensitive, catches more anomalies)
 * - 2.5σ: ~98% confidence (balanced sensitivity)
 * - 3.0σ: ~99.7% confidence (less sensitive, only extreme outliers)
 */
const ANOMALY_THRESHOLD_SIGMA = 2.5;

/**
 * Generator fuel consumption estimate
 * Average fuel consumption for portable generators
 * 
 * Note: Actual consumption varies by generator type, load, and efficiency.
 * This is a conservative estimate for planning purposes.
 */
const GENERATOR_FUEL_CONSUMPTION_L_PER_KWH = 0.3; // Liters per kWh

module.exports = {
  parseTimeRange,
  calculateStats,
  BATTERY_REPLACEMENT_THRESHOLDS,
  ANOMALY_THRESHOLD_SIGMA,
  GENERATOR_FUEL_CONSUMPTION_L_PER_KWH
};
