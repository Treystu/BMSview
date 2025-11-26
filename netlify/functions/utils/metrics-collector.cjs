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
 * Gemini API Pricing (as of 2024)
 * Based on Google's published rates
 */
const GEMINI_PRICING = {
  'gemini-2.5-flash': {
    inputTokens: 0.075 / 1000000,   // $0.075 per million input tokens
    outputTokens: 0.30 / 1000000,   // $0.30 per million output tokens
  },
  'gemini-1.5-flash': {
    inputTokens: 0.075 / 1000000,
    outputTokens: 0.30 / 1000000,
  },
  'gemini-1.5-pro': {
    inputTokens: 1.25 / 1000000,
    outputTokens: 5.00 / 1000000,
  }
};

/**
 * Calculate cost for Gemini API usage
 * @param {string} model - Model name
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @returns {number} Cost in USD
 */
function calculateGeminiCost(model = 'gemini-2.5-flash', inputTokens = 0, outputTokens = 0) {
  const pricing = GEMINI_PRICING[model] || GEMINI_PRICING['gemini-2.5-flash'];
  return (inputTokens * pricing.inputTokens) + (outputTokens * pricing.outputTokens);
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

    const operations = await collection.find({
      timestamp: {
        $gte: start.toISOString(),
        $lte: end.toISOString()
      },
      success: true
    }).toArray();

    const breakdown = {
      analysis: { count: 0, cost: 0, tokens: 0 },
      insights: { count: 0, cost: 0, tokens: 0 },
      feedbackGeneration: { count: 0, cost: 0, tokens: 0 }
    };

    let totalCost = 0;
    let totalTokens = 0;

    operations.forEach(op => {
      const category = op.operation === 'analysis' ? 'analysis' :
                      op.operation === 'insights' ? 'insights' : 'feedbackGeneration';
      
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
    
    // Get historical baseline (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const historical = await collection.find({
      timestamp: { $gte: sevenDaysAgo.toISOString() },
      success: true
    }).toArray();

    if (historical.length < 10) {
      // Not enough data for anomaly detection
      return;
    }

    // Calculate baseline metrics
    const avgDuration = historical.reduce((sum, op) => sum + op.duration, 0) / historical.length;
    const avgCost = historical.reduce((sum, op) => sum + (op.cost || 0), 0) / historical.length;
    const errorRate = historical.filter(op => !op.success).length / historical.length;

    // Check for cost spike (3x average)
    if (metrics.cost && metrics.cost > avgCost * 3) {
      await createAlert({
        severity: 'high',
        type: 'cost_spike',
        message: `Cost spike detected: $${metrics.cost.toFixed(4)} vs avg $${avgCost.toFixed(4)}`,
        metadata: { current: metrics.cost, average: avgCost }
      });
    }

    // Check for latency spike (2x average)
    if (metrics.duration && metrics.duration > avgDuration * 2) {
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
  calculateGeminiCost
};
