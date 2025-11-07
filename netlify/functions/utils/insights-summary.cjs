/**
 * Insights Summary Generation Utility
 * 
 * Generates initial battery summaries to display immediately while
 * background processing runs. Provides averaged statistics and trends.
 * 
 * @module netlify/functions/utils/insights-summary
 */

const { getCollection } = require('./mongodb.cjs');

/**
 * Generate initial battery summary from recent data
 * 
 * @param {Object} analysisData - Current battery snapshot
 * @param {string} systemId - BMS system ID (optional)
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Battery summary object
 */
async function generateInitialSummary(analysisData, systemId, log) {
  const summary = {
    current: extractCurrentSnapshot(analysisData),
    historical: null,
    generated: new Date().toISOString()
  };
  
  // If we have a systemId, load recent historical data
  if (systemId) {
    try {
      summary.historical = await generateHistoricalSummary(systemId, log);
    } catch (error) {
      log.warn('Failed to generate historical summary', { 
        error: error.message,
        systemId 
      });
      // Continue without historical data
    }
  }
  
  log.info('Initial summary generated', {
    hasHistorical: !!summary.historical,
    currentVoltage: summary.current.voltage,
    currentSOC: summary.current.soc
  });
  
  return summary;
}

/**
 * Extract current snapshot metrics
 * 
 * @param {Object} analysisData - Current battery data
 * @returns {Object} Current snapshot summary
 */
function extractCurrentSnapshot(analysisData) {
  const current = analysisData.current != null ? analysisData.current : null;
  
  return {
    voltage: analysisData.overallVoltage || null,
    current: current,
    power: analysisData.power || null,
    soc: analysisData.stateOfCharge || null,
    capacity: analysisData.remainingCapacity || null,
    fullCapacity: analysisData.fullCapacity || null,
    temperature: analysisData.temperature || null,
    cellCount: analysisData.cellVoltages?.length || 0,
    cellVoltageDiff: analysisData.cellVoltageDifference || null,
    isCharging: current != null && current > 0.5,
    isDischarging: current != null && current < -0.5
  };
}

/**
 * Generate historical summary from last 7 days of data
 * 
 * @param {string} systemId - BMS system ID
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Historical summary
 */
async function generateHistoricalSummary(systemId, log) {
  const collection = await getCollection('analysis-results');
  
  // Get last 7 days of data
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const records = await collection
    .find({ 
      systemId, 
      timestamp: { $gte: sevenDaysAgo } 
    })
    .sort({ timestamp: 1 })
    .toArray();
  
  if (records.length === 0) {
    log.debug('No historical data found', { systemId, daysBack: 7 });
    return null;
  }
  
  log.debug('Historical data retrieved', { 
    systemId, 
    recordCount: records.length,
    daysSpan: 7
  });
  
  // Calculate daily statistics
  const dailyStats = calculateDailyStats(records);
  
  // Calculate charging/discharging stats
  const chargingStats = calculateChargingStats(records);
  
  return {
    recordCount: records.length,
    dateRange: {
      start: records[0].timestamp,
      end: records[records.length - 1].timestamp
    },
    daily: dailyStats,
    charging: chargingStats
  };
}

/**
 * Calculate daily statistics from records
 * 
 * @param {Array} records - Analysis records
 * @returns {Object} Daily statistics
 */
function calculateDailyStats(records) {
  // Group by day
  const dayBuckets = new Map();
  
  for (const record of records) {
    if (!record.analysis) continue;
    
    const date = new Date(record.timestamp);
    const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (!dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, []);
    }
    dayBuckets.get(dayKey).push(record);
  }
  
  // Calculate stats for each day
  const dailyStats = [];
  
  for (const [day, dayRecords] of dayBuckets.entries()) {
    const stats = {
      date: day,
      dataPoints: dayRecords.length,
      avgVoltage: 0,
      avgCurrent: 0,
      avgSOC: 0,
      avgPower: 0,
      maxCurrent: -Infinity,
      minCurrent: Infinity,
      energyKwh: 0
    };
    
    let voltageSum = 0, currentSum = 0, socSum = 0, powerSum = 0;
    let voltageCount = 0, currentCount = 0, socCount = 0, powerCount = 0;
    
    for (const record of dayRecords) {
      const a = record.analysis;
      
      if (a.overallVoltage != null) {
        voltageSum += a.overallVoltage;
        voltageCount++;
      }
      
      if (a.current != null) {
        currentSum += a.current;
        currentCount++;
        stats.maxCurrent = Math.max(stats.maxCurrent, a.current);
        stats.minCurrent = Math.min(stats.minCurrent, a.current);
      }
      
      if (a.stateOfCharge != null) {
        socSum += a.stateOfCharge;
        socCount++;
      }
      
      if (a.power != null) {
        powerSum += a.power;
        powerCount++;
      }
    }
    
    stats.avgVoltage = voltageCount > 0 ? voltageSum / voltageCount : 0;
    stats.avgCurrent = currentCount > 0 ? currentSum / currentCount : 0;
    stats.avgSOC = socCount > 0 ? socSum / socCount : 0;
    stats.avgPower = powerCount > 0 ? powerSum / powerCount : 0;
    
    // Estimate energy: average power * hours (assuming roughly even distribution)
    const hoursInDay = dayRecords.length > 0 ? 24 / (24 / dayRecords.length) : 0;
    stats.energyKwh = (stats.avgPower * hoursInDay) / 1000;
    
    dailyStats.push(stats);
  }
  
  return dailyStats;
}

/**
 * Calculate charging/discharging statistics
 * 
 * @param {Array} records - Analysis records
 * @returns {Object} Charging statistics
 */
function calculateChargingStats(records) {
  let chargingCount = 0, dischargingCount = 0, idleCount = 0;
  let chargingCurrentSum = 0, dischargingCurrentSum = 0;
  let chargingPowerSum = 0, dischargingPowerSum = 0;
  
  for (const record of records) {
    const a = record.analysis;
    if (!a || a.current == null) continue;
    
    if (a.current > 0.5) {
      // Charging
      chargingCount++;
      chargingCurrentSum += a.current;
      if (a.power != null) {
        chargingPowerSum += a.power;
      }
    } else if (a.current < -0.5) {
      // Discharging
      dischargingCount++;
      dischargingCurrentSum += Math.abs(a.current);
      if (a.power != null) {
        dischargingPowerSum += Math.abs(a.power);
      }
    } else {
      // Idle
      idleCount++;
    }
  }
  
  return {
    chargingDataPoints: chargingCount,
    dischargingDataPoints: dischargingCount,
    idleDataPoints: idleCount,
    avgChargingCurrent: chargingCount > 0 ? chargingCurrentSum / chargingCount : 0,
    avgDischargingCurrent: dischargingCount > 0 ? dischargingCurrentSum / dischargingCount : 0,
    avgChargingPower: chargingCount > 0 ? chargingPowerSum / chargingCount : 0,
    avgDischargingPower: dischargingCount > 0 ? dischargingPowerSum / dischargingCount : 0,
    totalRecords: records.length
  };
}

module.exports = {
  generateInitialSummary,
  extractCurrentSnapshot,
  generateHistoricalSummary,
  calculateDailyStats,
  calculateChargingStats
};
