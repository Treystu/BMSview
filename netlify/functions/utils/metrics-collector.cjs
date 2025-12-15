"use strict";

/**
 * Metrics Collector Utility
 * Provides comprehensive metrics collection for AI feedback system
 */

const { getCollection } = require('./mongodb.cjs');
const { createLogger } = require('./logger.cjs');
const { v4: uuidv4 } = require('uuid');

const log = createLogger('metrics-collector');

/**
 * Gemini API Pricing (as of December 2025)
 * Based on official Google rates: https://ai.google.dev/gemini-api/docs/pricing
 * 
 * IMPORTANT: Prices vary by context window size for most models.
 * - Gemini 3.0, 2.5, 2.0: Standard rate ≤200K tokens, higher rate >200K
 * - Gemini 1.5: Standard rate ≤128K tokens, higher rate >128K
 * 
 * Current implementation uses standard (lower) rates by default.
 */
const GEMINI_PRICING = {
  // ===== Gemini 3.0 Family (Preview) =====
  // Context threshold: 200K tokens
  // Reference: https://ai.google.dev/gemini-api/docs/pricing
  'gemini-3-pro-preview': {
    inputTokens: 2.00 / 1_000_000,    // $2.00 per million (≤200K context)
    outputTokens: 12.00 / 1_000_000,  // $12.00 per million (≤200K context)
    inputTokensLongContext: 4.00 / 1_000_000,   // $4.00 per million (>200K context)
    outputTokensLongContext: 18.00 / 1_000_000, // $18.00 per million (>200K context)
    contextThreshold: 200_000,
    description: 'Gemini 3.0 Pro Preview - Most advanced model'
  },

  // ===== Gemini 2.5 Family =====
  // Context threshold: 200K tokens
  // Reference: https://ai.google.dev/gemini-api/docs/pricing
  'gemini-2.5-pro': {
    inputTokens: 1.25 / 1_000_000,    // $1.25 per million (≤200K context)
    outputTokens: 10.00 / 1_000_000,  // $10.00 per million (≤200K context)
    inputTokensLongContext: 2.50 / 1_000_000,   // $2.50 per million (>200K context)
    outputTokensLongContext: 15.00 / 1_000_000, // $15.00 per million (>200K context)
    contextThreshold: 200_000,
    description: 'Gemini 2.5 Pro - Highly capable'
  },
  'gemini-2.5-flash': {
    inputTokens: 0.10 / 1_000_000,    // $0.10 per million (≤200K context)
    outputTokens: 0.40 / 1_000_000,   // $0.40 per million (≤200K context)
    inputTokensLongContext: 0.10 / 1_000_000,   // Same for >200K (no price increase)
    outputTokensLongContext: 0.40 / 1_000_000,  // Same for >200K (no price increase)
    contextThreshold: 200_000,
    description: 'Gemini 2.5 Flash - Fast multimodal model'
  },
  'gemini-2.5-flash-preview-05-20': {
    inputTokens: 0.10 / 1_000_000,
    outputTokens: 0.40 / 1_000_000,
    inputTokensLongContext: 0.10 / 1_000_000,   // Same for >200K (no price increase)
    outputTokensLongContext: 0.40 / 1_000_000,  // Same for >200K (no price increase)
    contextThreshold: 200_000,
    description: 'Gemini 2.5 Flash Preview (legacy)'
  },

  // ===== Gemini 2.0 Family =====
  // Context threshold: 200K tokens
  // Reference: https://ai.google.dev/gemini-api/docs/pricing
  'gemini-2.0-pro': {
    inputTokens: 0.50 / 1_000_000,    // $0.50 per million (≤200K context)
    outputTokens: 5.00 / 1_000_000,   // $5.00 per million (≤200K context)
    inputTokensLongContext: 1.00 / 1_000_000,   // $1.00 per million (>200K context)
    outputTokensLongContext: 7.50 / 1_000_000,  // $7.50 per million (>200K context)
    contextThreshold: 200_000,
    description: 'Gemini 2.0 Pro - Production ready'
  },
  'gemini-2.0-flash': {
    inputTokens: 0.10 / 1_000_000,    // $0.10 per million (≤200K context)
    outputTokens: 0.40 / 1_000_000,   // $0.40 per million (≤200K context)
    inputTokensLongContext: 0.10 / 1_000_000,   // Same for >200K (no price increase)
    outputTokensLongContext: 0.40 / 1_000_000,  // Same for >200K (no price increase)
    contextThreshold: 200_000,
    description: 'Gemini 2.0 Flash - Experimental'
  },
  'gemini-2.0-flash-exp': {
    inputTokens: 0.10 / 1_000_000,
    outputTokens: 0.40 / 1_000_000,
    inputTokensLongContext: 0.10 / 1_000_000,   // Same for >200K (no price increase)
    outputTokensLongContext: 0.40 / 1_000_000,  // Same for >200K (no price increase)
    contextThreshold: 200_000,
    description: 'Gemini 2.0 Flash Experimental'
  },
  'gemini-2.0-flash-thinking-exp-1219': {
    inputTokens: 0.10 / 1_000_000,
    outputTokens: 0.40 / 1_000_000,
    inputTokensLongContext: 0.10 / 1_000_000,   // Same for >200K (no price increase)
    outputTokensLongContext: 0.40 / 1_000_000,  // Same for >200K (no price increase)
    contextThreshold: 200_000,
    description: 'Gemini 2.0 Flash Thinking Experimental'
  },

  // ===== Gemini 1.5 Family =====
  // Context threshold: 128K tokens (different from 2.x/3.x!)
  // Reference: https://ai.google.dev/gemini-api/docs/pricing
  'gemini-1.5-pro': {
    inputTokens: 1.25 / 1_000_000,    // $1.25 per million (≤128K context)
    outputTokens: 5.00 / 1_000_000,   // $5.00 per million (≤128K context)
    inputTokensLongContext: 2.50 / 1_000_000,   // $2.50 per million (>128K context)
    outputTokensLongContext: 10.00 / 1_000_000, // $10.00 per million (>128K context)
    contextThreshold: 128_000,
    description: 'Gemini 1.5 Pro - Most capable 1.5 model'
  },
  'gemini-1.5-pro-latest': {
    inputTokens: 1.25 / 1_000_000,
    outputTokens: 5.00 / 1_000_000,
    inputTokensLongContext: 2.50 / 1_000_000,
    outputTokensLongContext: 10.00 / 1_000_000,
    contextThreshold: 128_000,
    description: 'Gemini 1.5 Pro Latest'
  },
  'gemini-1.5-flash': {
    inputTokens: 0.075 / 1_000_000,   // $0.075 per million (≤128K context)
    outputTokens: 0.30 / 1_000_000,   // $0.30 per million (≤128K context)
    inputTokensLongContext: 0.15 / 1_000_000,   // $0.15 per million (>128K context)
    outputTokensLongContext: 0.60 / 1_000_000,  // $0.60 per million (>128K context)
    contextThreshold: 128_000,
    description: 'Gemini 1.5 Flash - Fast and versatile'
  },
  'gemini-1.5-flash-latest': {
    inputTokens: 0.075 / 1_000_000,
    outputTokens: 0.30 / 1_000_000,
    inputTokensLongContext: 0.15 / 1_000_000,
    outputTokensLongContext: 0.60 / 1_000_000,
    contextThreshold: 128_000,
    description: 'Gemini 1.5 Flash Latest'
  },
  'gemini-1.5-flash-8b': {
    inputTokens: 0.0375 / 1_000_000,  // $0.0375 per million (≤128K context)
    outputTokens: 0.15 / 1_000_000,   // $0.15 per million (≤128K context)
    inputTokensLongContext: 0.075 / 1_000_000,  // $0.075 per million (>128K context)
    outputTokensLongContext: 0.30 / 1_000_000,  // $0.30 per million (>128K context)
    contextThreshold: 128_000,
    description: 'Gemini 1.5 Flash 8B - Budget option'
  },
  'gemini-1.5-flash-8b-latest': {
    inputTokens: 0.0375 / 1_000_000,
    outputTokens: 0.15 / 1_000_000,
    inputTokensLongContext: 0.075 / 1_000_000,
    outputTokensLongContext: 0.30 / 1_000_000,
    contextThreshold: 128_000,
    description: 'Gemini 1.5 Flash 8B Latest'
  },

  // ===== Gemini 1.0 Family (Legacy) =====
  'gemini-1.0-pro': {
    inputTokens: 0.50 / 1_000_000,
    outputTokens: 1.50 / 1_000_000,
    description: 'Gemini 1.0 Pro - Legacy'
  },
  'gemini-pro': {
    inputTokens: 0.50 / 1_000_000,
    outputTokens: 1.50 / 1_000_000,
    description: 'Gemini Pro - Legacy alias'
  }
};

/**
 * Get pricing for a model, with fallback to default
 * @param {string} model - Model name
 * @param {number} contextTokens - Optional: number of context tokens to determine pricing tier
 * @returns {Object} Pricing info with standard and optionally long-context rates
 */
function getModelPricing(model, contextTokens = 0) {
  let pricing = null;
  
  // Try exact match first
  if (GEMINI_PRICING[model]) {
    pricing = GEMINI_PRICING[model];
  } else {
    // Try partial match (for versioned model names like gemini-2.5-flash-001)
    const baseModel = Object.keys(GEMINI_PRICING)
      .sort((a, b) => b.length - a.length)
      .find(key => model.startsWith(key));
    if (baseModel) {
      pricing = GEMINI_PRICING[baseModel];
    }
  }
  
  // Default to gemini-2.5-flash pricing if no match found
  if (!pricing) {
    log.warn('Unknown model, using default pricing', { model, defaultModel: 'gemini-2.5-flash' });
    pricing = GEMINI_PRICING['gemini-2.5-flash'];
  }
  
  // If context tokens provided and model has context threshold, determine which pricing tier to use
  if (contextTokens > 0 && pricing.contextThreshold) {
    const useLongContext = contextTokens > pricing.contextThreshold;
    if (useLongContext && pricing.inputTokensLongContext) {
      return {
        inputTokens: pricing.inputTokensLongContext,
        outputTokens: pricing.outputTokensLongContext,
        description: `${pricing.description} (Long Context >${(pricing.contextThreshold / 1000).toFixed(0)}K)`,
        contextThreshold: pricing.contextThreshold,
        isLongContext: true
      };
    }
  }
  
  // Return standard pricing
  return {
    inputTokens: pricing.inputTokens,
    outputTokens: pricing.outputTokens,
    description: pricing.description,
    contextThreshold: pricing.contextThreshold,
    isLongContext: false
  };
}

/**
 * Calculate cost for Gemini API usage
 * @param {string} model - Model name (reads from env if not provided)
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {number} contextTokens - Optional: total context size for context-aware pricing
 * @returns {number} Cost in USD
 */
function calculateGeminiCost(model, inputTokens = 0, outputTokens = 0, contextTokens = 0) {
  const effectiveModel = model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const pricing = getModelPricing(effectiveModel, contextTokens);
  return (inputTokens * pricing.inputTokens) + (outputTokens * pricing.outputTokens);
}

/**
 * Get current model and its pricing info
 * @returns {Object} Model info with pricing
 */
function getCurrentModelInfo() {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const pricing = getModelPricing(model);
  return {
    model,
    pricing: {
      inputPerMillion: pricing.inputTokens * 1_000_000,
      outputPerMillion: pricing.outputTokens * 1_000_000,
      description: pricing.description
    }
  };
}

/**
 * Log an AI operation for tracking
 * @param {Object} operation - Operation details
 * @returns {Promise<string>} Operation ID
 */
async function logAIOperation(operation) {
  try {
    const collection = await getCollection('ai_operations');
    
    const record = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      operation: operation.operation || 'unknown',
      systemId: operation.systemId,
      duration: operation.duration || 0,
      tokensUsed: operation.tokensUsed || 0,
      inputTokens: operation.inputTokens || 0,
      outputTokens: operation.outputTokens || 0,
      cost: operation.cost || calculateGeminiCost(
        operation.model,
        operation.inputTokens,
        operation.outputTokens
      ),
      success: operation.success !== false,
      error: operation.error,
      model: operation.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contextWindowDays: operation.contextWindowDays,
      metadata: operation.metadata || {}
    };

    await collection.insertOne(record);
    
    log.info('AI operation logged', {
      id: record.id,
      operation: record.operation,
      duration: record.duration,
      cost: record.cost
    });

    return record.id;
  } catch (error) {
    log.error('Failed to log AI operation', { error: error.message });
    return null;
  }
}

/**
 * Record a metric for tracking
 * @param {Object} metric - Metric details
 * @returns {Promise<string>} Metric ID
 */
async function recordMetric(metric) {
  try {
    const collection = await getCollection('ai_metrics');
    
    const record = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      systemId: metric.systemId,
      metricType: metric.metricType,
      metricName: metric.metricName,
      value: metric.value,
      unit: metric.unit,
      metadata: metric.metadata || {}
    };

    await collection.insertOne(record);
    
    log.debug('Metric recorded', {
      id: record.id,
      type: record.metricType,
      name: record.metricName,
      value: record.value
    });

    return record.id;
  } catch (error) {
    log.error('Failed to record metric', { error: error.message });
    return null;
  }
}

/**
 * Create an anomaly alert
 * @param {Object} alert - Alert details
 * @returns {Promise<string>} Alert ID
 */
async function createAlert(alert) {
  try {
    const collection = await getCollection('anomaly_alerts');
    
    const record = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      severity: alert.severity || 'medium',
      type: alert.type,
      message: alert.message,
      metadata: alert.metadata || {},
      resolved: false
    };

    await collection.insertOne(record);
    
    log.warn('Anomaly alert created', {
      id: record.id,
      severity: record.severity,
      type: record.type,
      message: record.message
    });

    return record.id;
  } catch (error) {
    log.error('Failed to create alert', { error: error.message });
    return null;
  }
}

/**
 * Resolve an alert
 * @param {string} alertId - Alert ID
 * @returns {Promise<boolean>} Success status
 */
async function resolveAlert(alertId) {
  try {
    const collection = await getCollection('anomaly_alerts');
    
    await collection.updateOne(
      { id: alertId },
      { 
        $set: { 
          resolved: true,
          resolvedAt: new Date().toISOString()
        } 
      }
    );
    
    log.info('Alert resolved', { alertId });
    return true;
  } catch (error) {
    log.error('Failed to resolve alert', { alertId, error: error.message });
    return false;
  }
}

/**
 * Track feedback implementation
 * @param {Object} tracking - Tracking details
 * @returns {Promise<string>} Tracking ID
 */
async function trackFeedbackImplementation(tracking) {
  try {
    const collection = await getCollection('feedback_tracking');
    
    const record = {
      id: uuidv4(),
      feedbackId: tracking.feedbackId,
      suggestedAt: tracking.suggestedAt || new Date().toISOString(),
      implementedAt: tracking.implementedAt,
      status: tracking.status || 'pending',
      implementationType: tracking.implementationType,
      implementationNotes: tracking.implementationNotes,
      effectiveness: tracking.effectiveness
    };

    await collection.insertOne(record);
    
    log.info('Feedback implementation tracked', {
      id: record.id,
      status: record.status
    });

    return record.id;
  } catch (error) {
    log.error('Failed to track feedback implementation', { error: error.message });
    return null;
  }
}

/**
 * Get cost metrics for a time period
 * @param {string} period - 'daily', 'weekly', or 'monthly'
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>} Cost metrics
 */
async function getCostMetrics(period = 'daily', startDate = null, endDate = null) {
  try {
    const collection = await getCollection('ai_operations');
    
    // Default to last 24 hours if no dates provided
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - 24 * 60 * 60 * 1000);

    // Include all operations for cost tracking (both success and failed)
    // Failed operations may still incur API costs
    const operations = await collection.find({
      timestamp: {
        $gte: start.toISOString(),
        $lte: end.toISOString()
      }
    }).toArray();

    const breakdown = {
      analysis: { count: 0, cost: 0, tokens: 0 },
      insights: { count: 0, cost: 0, tokens: 0 },
      feedbackGeneration: { count: 0, cost: 0, tokens: 0 }
    };

    let totalCost = 0;
    let totalTokens = 0;

    // Explicit operation type mapping to handle both naming conventions
    const operationTypeMap = {
      'analysis': 'analysis',
      'insights': 'insights',
      'feedback_generation': 'feedbackGeneration',
      'feedbackGeneration': 'feedbackGeneration'
    };

    operations.forEach(op => {
      const category = operationTypeMap[op.operation] || 'feedbackGeneration';
      
      breakdown[category].count++;
      breakdown[category].cost += op.cost || 0;
      breakdown[category].tokens += op.tokensUsed || 0;
      
      totalCost += op.cost || 0;
      totalTokens += op.tokensUsed || 0;
    });

    return {
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalCost,
      totalTokens,
      operationBreakdown: breakdown,
      averageCostPerOperation: operations.length > 0 ? totalCost / operations.length : 0
    };
  } catch (error) {
    log.error('Failed to get cost metrics', { error: error.message });
    return null;
  }
}

/**
 * Check for anomalies and create alerts
 * @param {Object} metrics - Current metrics
 * @returns {Promise<void>}
 */
async function checkForAnomalies(metrics) {
  try {
    const collection = await getCollection('ai_operations');
    
    // Get historical baseline (last 7 days) - include ALL operations for proper error rate calculation
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const historical = await collection.find({
      timestamp: { $gte: sevenDaysAgo.toISOString() }
    }).toArray();

    if (historical.length < 10) {
      // Not enough data for anomaly detection
      return;
    }

    // Calculate baseline metrics in a single pass through historical data
    let totalDuration = 0;
    let totalCost = 0;
    let successCount = 0;
    let failureCount = 0;
    
    for (const op of historical) {
      if (op.success) {
        totalDuration += op.duration || 0;
        totalCost += op.cost || 0;
        successCount++;
      } else {
        failureCount++;
      }
    }

    const avgDuration = successCount > 0 ? totalDuration / successCount : 0;
    const avgCost = successCount > 0 ? totalCost / successCount : 0;
    const errorRate = failureCount / historical.length;

    // Check for cost spike (3x average)
    if (metrics.cost && avgCost > 0 && metrics.cost > avgCost * 3) {
      await createAlert({
        severity: 'high',
        type: 'cost_spike',
        message: `Cost spike detected: $${metrics.cost.toFixed(4)} vs avg $${avgCost.toFixed(4)}`,
        metadata: { current: metrics.cost, average: avgCost }
      });
    }

    // Check for latency spike (2x average)
    if (metrics.duration && avgDuration > 0 && metrics.duration > avgDuration * 2) {
      await createAlert({
        severity: 'medium',
        type: 'latency',
        message: `Latency spike detected: ${metrics.duration}ms vs avg ${avgDuration.toFixed(0)}ms`,
        metadata: { current: metrics.duration, average: avgDuration }
      });
    }

    // Check recent error rate (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOps = await collection.find({
      timestamp: { $gte: oneHourAgo.toISOString() }
    }).toArray();

    if (recentOps.length > 5) {
      const recentErrorRate = recentOps.filter(op => !op.success).length / recentOps.length;
      
      if (recentErrorRate > 0.3 && recentErrorRate > errorRate * 2) {
        await createAlert({
          severity: 'critical',
          type: 'error_rate',
          message: `High error rate detected: ${(recentErrorRate * 100).toFixed(1)}% vs baseline ${(errorRate * 100).toFixed(1)}%`,
          metadata: { current: recentErrorRate, baseline: errorRate }
        });
      }
    }
  } catch (error) {
    log.error('Failed to check for anomalies', { error: error.message });
  }
}

/**
 * Get realtime performance metrics
 * @returns {Promise<Object>} Realtime metrics
 */
async function getRealtimeMetrics() {
  try {
    const collection = await getCollection('ai_operations');
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Operations in last minute
    const lastMinute = await collection.find({
      timestamp: { $gte: oneMinuteAgo.toISOString() }
    }).toArray();

    // Operations in last 5 minutes for latency
    const lastFiveMinutes = await collection.find({
      timestamp: { $gte: fiveMinutesAgo.toISOString() },
      success: true
    }).toArray();

    const avgLatency = lastFiveMinutes.length > 0
      ? lastFiveMinutes.reduce((sum, op) => sum + op.duration, 0) / lastFiveMinutes.length
      : 0;

    const errorRate = lastMinute.length > 0
      ? lastMinute.filter(op => !op.success).length / lastMinute.length
      : 0;

    return {
      currentOperationsPerMinute: lastMinute.length,
      averageLatency: Math.round(avgLatency),
      errorRate: Math.round(errorRate * 100) / 100,
      circuitBreakerStatus: 'CLOSED' // Will be updated from actual circuit breaker status
    };
  } catch (error) {
    log.error('Failed to get realtime metrics', { error: error.message });
    return {
      currentOperationsPerMinute: 0,
      averageLatency: 0,
      errorRate: 0,
      circuitBreakerStatus: 'UNKNOWN'
    };
  }
}

module.exports = {
  logAIOperation,
  recordMetric,
  createAlert,
  resolveAlert,
  trackFeedbackImplementation,
  getCostMetrics,
  checkForAnomalies,
  getRealtimeMetrics,
  calculateGeminiCost,
  getCurrentModelInfo,
  getModelPricing,
  GEMINI_PRICING
};
