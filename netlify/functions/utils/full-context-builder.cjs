// @ts-nocheck
/**
 * Full Context Builder
 * Aggregates ALL available data points and tool outputs for comprehensive AI analysis
 */

const { createLogger } = require('./logger.cjs');
const { getCollection } = require('./mongodb.cjs');

// Configuration constants for feedback context
const FEEDBACK_RETENTION_DAYS = 90; // Days of feedback history to include
const FEEDBACK_DESCRIPTION_TRUNCATE_LENGTH = 200; // Max chars for description in context
const FEEDBACK_QUERY_LIMIT = 50; // Maximum feedback items to fetch

/**
 * Build complete context with all available data points
 * @param {string} systemId - BMS system ID
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Complete context package
 */
async function buildCompleteContext(systemId, options = {}) {
  const log = createLogger('full-context-builder');
  const startTime = Date.now();
  
  try {
    log.info('Building complete context', { systemId, options });
    
    // Get all raw data
    const raw = await getRawData(systemId, options);
    
    // Run analytical tools
    const toolOutputs = await runAnalyticalTools(systemId, raw, options);
    
    // Get external data sources
    const external = await getExternalData(systemId, raw, options);
    
    // Get system metadata
    const metadata = await getSystemMetadata(systemId, options);
    
    // Calculate computed metrics
    const computed = await calculateComputedMetrics(systemId, raw, options);
    
    // Get existing feedback to prevent duplicates
    const existingFeedback = await getExistingFeedback(systemId, options);
    
    const context = {
      raw,
      toolOutputs,
      external,
      metadata,
      computed,
      existingFeedback, // Include existing feedback for deduplication
      buildTimestamp: new Date().toISOString(),
      buildDurationMs: Date.now() - startTime,
      systemId
    };
    
    log.info('Complete context built successfully', {
      systemId,
      rawDataPoints: countDataPoints(raw),
      existingFeedbackCount: existingFeedback.length,
      totalSize: JSON.stringify(context).length,
      durationMs: Date.now() - startTime
    });
    
    return context;
  } catch (error) {
    log.error('Failed to build complete context', { systemId, error: error.message });
    throw error;
  }
}

/**
 * Get existing feedback items to prevent duplicates
 * @param {string} systemId - BMS system ID
 * @param {Object} options - Configuration options
 * @returns {Promise<Array>} List of existing feedback items
 */
async function getExistingFeedback(systemId, options = {}) {
  const log = createLogger('full-context-builder:existing-feedback');
  
  try {
    const feedbackCollection = await getCollection('ai_feedback');
    
    // Get recent feedback that hasn't been rejected
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - FEEDBACK_RETENTION_DAYS);
    
    const existingFeedback = await feedbackCollection.find({
      $or: [
        { systemId }, // System-specific feedback
        { systemId: { $exists: false } } // Global feedback
      ],
      timestamp: { $gte: retentionDate },
      status: { $nin: ['rejected', 'implemented'] } // Only pending/approved items
    }).sort({ timestamp: -1 }).limit(FEEDBACK_QUERY_LIMIT).toArray();
    
    // Return summarized feedback for context (reduce token usage)
    return existingFeedback.map(fb => {
      const description = fb.suggestion?.description;
      const truncatedDescription = description 
        ? (description.length > FEEDBACK_DESCRIPTION_TRUNCATE_LENGTH 
            ? description.substring(0, FEEDBACK_DESCRIPTION_TRUNCATE_LENGTH) + '...'
            : description)
        : null;
      
      return {
        id: fb.id,
        type: fb.feedbackType,
        category: fb.category,
        priority: fb.priority,
        status: fb.status,
        title: fb.suggestion?.title,
        description: truncatedDescription,
        timestamp: fb.timestamp
      };
    });
  } catch (error) {
    log.warn('Failed to fetch existing feedback, continuing without', { error: error.message });
    return []; // Non-fatal - continue without existing feedback
  }
}

/**
 * Get all raw data for the system
 */
async function getRawData(systemId, options) {
  const log = createLogger('full-context-builder:raw-data');
  const timeRange = getTimeRange(options);
  
  try {
    const analysisCollection = await getCollection('analysis-results');
    
    // Get all analyses within time range
    const allAnalyses = await analysisCollection.find({
      systemId,
      timestamp: { $gte: timeRange.start, $lte: timeRange.end }
    }).sort({ timestamp: 1 }).toArray();
    
    // Extract specific data arrays
    const allCellData = allAnalyses.map(a => ({
      timestamp: a.timestamp,
      cellVoltages: a.analysis?.cellVoltages || [],
      highestCell: a.analysis?.highestCellVoltage,
      lowestCell: a.analysis?.lowestCellVoltage,
      difference: a.analysis?.cellVoltageDifference
    }));
    
    const allTemperatureReadings = allAnalyses.map(a => ({
      timestamp: a.timestamp,
      temperature: a.analysis?.temperature,
      temperatures: a.analysis?.temperatures,
      mosTemperature: a.analysis?.mosTemperature
    }));
    
    const allVoltageReadings = allAnalyses.map(a => ({
      timestamp: a.timestamp,
      voltage: a.analysis?.overallVoltage
    }));
    
    const allCurrentReadings = allAnalyses.map(a => ({
      timestamp: a.timestamp,
      current: a.analysis?.current,
      power: a.analysis?.power
    }));
    
    const allAlarms = allAnalyses.flatMap(a => 
      (a.analysis?.alerts || []).map(alert => ({
        timestamp: a.timestamp,
        alert
      }))
    );
    
    const allStateChanges = detectStateChanges(allAnalyses);
    
    return {
      allAnalyses,
      allCellData,
      allTemperatureReadings,
      allVoltageReadings,
      allCurrentReadings,
      allAlarms,
      allStateChanges,
      timeRange,
      totalDataPoints: allAnalyses.length
    };
  } catch (error) {
    log.error('Failed to get raw data', { systemId, error: error.message });
    return {
      allAnalyses: [],
      allCellData: [],
      allTemperatureReadings: [],
      allVoltageReadings: [],
      allCurrentReadings: [],
      allAlarms: [],
      allStateChanges: [],
      timeRange,
      totalDataPoints: 0,
      error: error.message
    };
  }
}

/**
 * Run all analytical tools
 */
async function runAnalyticalTools(systemId, rawData, options) {
  const log = createLogger('full-context-builder:tools');
  
  try {
    // Import statistical tools
    const stats = require('./statistical-tools.cjs');
    
    // Extract time series data
    const voltageTimeSeries = rawData.allVoltageReadings
      .filter(r => r.voltage != null)
      .map(r => ({ timestamp: r.timestamp, value: r.voltage }));
    
    const currentTimeSeries = rawData.allCurrentReadings
      .filter(r => r.current != null)
      .map(r => ({ timestamp: r.timestamp, value: r.current }));
    
    const socTimeSeries = rawData.allAnalyses
      .filter(a => a.analysis?.stateOfCharge != null)
      .map(a => ({ timestamp: a.timestamp, value: a.analysis.stateOfCharge }));
    
    // Run tools in parallel
    const [
      statisticalAnalysis,
      trendAnalysis,
      anomalyDetection,
      correlationAnalysis
    ] = await Promise.allSettled([
      stats.runStatisticalAnalysis(voltageTimeSeries.map(t => t.value)),
      stats.runTrendAnalysis(socTimeSeries),
      stats.runAnomalyDetection(voltageTimeSeries.map(t => t.value)),
      stats.runCorrelationAnalysis({
        voltage: voltageTimeSeries.map(t => t.value),
        current: currentTimeSeries.map(t => t.value),
        soc: socTimeSeries.map(t => t.value)
      })
    ]);
    
    return {
      statisticalAnalysis: statisticalAnalysis.status === 'fulfilled' ? statisticalAnalysis.value : null,
      trendAnalysis: trendAnalysis.status === 'fulfilled' ? trendAnalysis.value : null,
      anomalyDetection: anomalyDetection.status === 'fulfilled' ? anomalyDetection.value : null,
      correlationAnalysis: correlationAnalysis.status === 'fulfilled' ? correlationAnalysis.value : null,
      errors: [
        statisticalAnalysis.status === 'rejected' ? statisticalAnalysis.reason : null,
        trendAnalysis.status === 'rejected' ? trendAnalysis.reason : null,
        anomalyDetection.status === 'rejected' ? anomalyDetection.reason : null,
        correlationAnalysis.status === 'rejected' ? correlationAnalysis.reason : null
      ].filter(Boolean)
    };
  } catch (error) {
    log.error('Failed to run analytical tools', { systemId, error: error.message });
    return { error: error.message };
  }
}

/**
 * Get external data sources
 */
async function getExternalData(systemId, rawData, options) {
  const log = createLogger('full-context-builder:external');
  
  try {
    // Get weather history from analysis records
    const weatherHistory = rawData.allAnalyses
      .filter(a => a.weather)
      .map(a => ({
        timestamp: a.timestamp,
        ...a.weather
      }));
    
    // Solar production data (if available)
    const solarProduction = rawData.allAnalyses
      .filter(a => a.analysis?.predictedSolarChargeAmphours != null)
      .map(a => ({
        timestamp: a.timestamp,
        predicted: a.analysis.predictedSolarChargeAmphours,
        actual: a.analysis.remainingCapacity
      }));
    
    return {
      weatherHistory,
      solarProduction,
      gridPricing: null, // Future enhancement
      maintenanceRecords: null // Future enhancement
    };
  } catch (error) {
    log.error('Failed to get external data', { systemId, error: error.message });
    return {
      weatherHistory: [],
      solarProduction: [],
      error: error.message
    };
  }
}

/**
 * Get system metadata
 */
async function getSystemMetadata(systemId, options) {
  const log = createLogger('full-context-builder:metadata');
  
  try {
    const systemsCollection = await getCollection('systems');
    const systemConfig = await systemsCollection.findOne({ id: systemId });
    
    if (!systemConfig) {
      log.warn('System not found', { systemId });
      return { error: 'System not found' };
    }
    
    return {
      systemConfig: {
        name: systemConfig.name,
        chemistry: systemConfig.chemistry,
        voltage: systemConfig.voltage,
        capacity: systemConfig.capacity,
        location: {
          latitude: systemConfig.latitude,
          longitude: systemConfig.longitude
        }
      },
      batterySpecs: {
        nominalVoltage: systemConfig.voltage,
        capacityAh: systemConfig.capacity,
        chemistry: systemConfig.chemistry
      },
      installationDate: null, // Future enhancement
      warrantyInfo: null, // Future enhancement
      operationalHours: null // Future enhancement
    };
  } catch (error) {
    log.error('Failed to get system metadata', { systemId, error: error.message });
    return { error: error.message };
  }
}

/**
 * Calculate computed metrics
 */
async function calculateComputedMetrics(systemId, rawData, options) {
  const log = createLogger('full-context-builder:computed');
  
  try {
    const latestAnalysis = rawData.allAnalyses[rawData.allAnalyses.length - 1];
    
    if (!latestAnalysis || !latestAnalysis.analysis) {
      return {
        healthScore: null,
        remainingLifeExpectancy: null,
        performanceDegradation: null,
        efficiencyMetrics: null,
        costAnalysis: null
      };
    }
    
    // Calculate basic health score (0-100)
    const healthScore = calculateHealthScore(latestAnalysis.analysis);
    
    // Estimate remaining life based on cycle count
    const remainingLifeExpectancy = estimateRemainingLife(latestAnalysis.analysis);
    
    // Calculate degradation rate from historical data
    const performanceDegradation = calculateDegradationRate(rawData.allAnalyses);
    
    return {
      healthScore,
      remainingLifeExpectancy,
      performanceDegradation,
      efficiencyMetrics: null, // Future enhancement
      costAnalysis: null // Future enhancement
    };
  } catch (error) {
    log.error('Failed to calculate computed metrics', { systemId, error: error.message });
    return { error: error.message };
  }
}

/**
 * Helper functions
 */

// Health score thresholds
const HEALTH_SCORE_THRESHOLDS = {
  CELL_VOLTAGE_DIFF_MAX: 0.1,          // Maximum acceptable cell voltage difference (V)
  CELL_VOLTAGE_DIFF_PENALTY: 10,       // Points deducted for high cell voltage difference
  ALERT_PENALTY_PER_ITEM: 5,           // Points deducted per alert
  SOC_LOW_THRESHOLD: 20,               // SOC percentage considered low
  SOC_LOW_PENALTY: 15,                 // Points deducted for low SOC
  TEMP_HIGH_THRESHOLD: 45,             // Temperature (°C) considered high
  TEMP_HIGH_PENALTY: 10                // Points deducted for high temp
};

function getTimeRange(options) {
  const end = new Date();
  const start = new Date();
  
  // Default to last 90 days
  const days = options.contextWindowDays || 90;
  start.setDate(start.getDate() - days);
  
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    days
  };
}

function detectStateChanges(analyses) {
  const changes = [];
  let prevStatus = null;
  
  for (const analysis of analyses) {
    const status = analysis.analysis?.status;
    if (status && status !== prevStatus) {
      changes.push({
        timestamp: analysis.timestamp,
        from: prevStatus,
        to: status
      });
      prevStatus = status;
    }
  }
  
  return changes;
}

function calculateHealthScore(analysis) {
  let score = 100;
  
  // Deduct points for issues using configurable thresholds
  if (analysis.cellVoltageDifference > HEALTH_SCORE_THRESHOLDS.CELL_VOLTAGE_DIFF_MAX) {
    score -= HEALTH_SCORE_THRESHOLDS.CELL_VOLTAGE_DIFF_PENALTY;
  }
  if (analysis.alerts && analysis.alerts.length > 0) {
    score -= analysis.alerts.length * HEALTH_SCORE_THRESHOLDS.ALERT_PENALTY_PER_ITEM;
  }
  if (analysis.stateOfCharge < HEALTH_SCORE_THRESHOLDS.SOC_LOW_THRESHOLD) {
    score -= HEALTH_SCORE_THRESHOLDS.SOC_LOW_PENALTY;
  }
  if (analysis.temperature > HEALTH_SCORE_THRESHOLDS.TEMP_HIGH_THRESHOLD) {
    score -= HEALTH_SCORE_THRESHOLDS.TEMP_HIGH_PENALTY;
  }
  
  return Math.max(0, Math.min(100, score));
}

function estimateRemainingLife(analysis) {
  const cycleCount = analysis.cycleCount || 0;
  const typicalLifeCycles = 3000; // LiFePO4 typical
  
  const remainingCycles = Math.max(0, typicalLifeCycles - cycleCount);
  const remainingYears = remainingCycles / 365; // Assuming 1 cycle per day
  
  return {
    remainingCycles,
    remainingYears: Math.round(remainingYears * 10) / 10,
    estimatedEndDate: new Date(Date.now() + remainingYears * 365 * 24 * 60 * 60 * 1000).toISOString()
  };
}

function calculateDegradationRate(analyses) {
  if (analyses.length < 2) return null;
  
  const first = analyses[0];
  const last = analyses[analyses.length - 1];
  
  const firstCapacity = first.analysis?.fullCapacity;
  const lastCapacity = last.analysis?.fullCapacity;
  
  if (!firstCapacity || !lastCapacity) return null;
  
  const degradation = ((firstCapacity - lastCapacity) / firstCapacity) * 100;
  const timeDays = (new Date(last.timestamp) - new Date(first.timestamp)) / (1000 * 60 * 60 * 24);
  const degradationPerYear = (degradation / timeDays) * 365;
  
  return {
    totalDegradation: Math.round(degradation * 100) / 100,
    degradationPerYear: Math.round(degradationPerYear * 100) / 100,
    timeRangeDays: Math.round(timeDays)
  };
}

function countDataPoints(obj) {
  let count = 0;
  
  function traverse(item) {
    if (Array.isArray(item)) {
      count += item.length;
      item.forEach(traverse);
    } else if (item && typeof item === 'object') {
      Object.values(item).forEach(traverse);
    }
  }
  
  traverse(obj);
  return count;
}

module.exports = {
  buildCompleteContext,
  countDataPoints
};
