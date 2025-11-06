/**
 * Data Aggregation Utilities for BMS Analysis
 * 
 * This module provides functions to aggregate and prepare BMS data for AI analysis.
 * Implements hourly averaging and data summarization to optimize token usage.
 * 
 * @module netlify/functions/utils/data-aggregation
 */

/**
 * Aggregate BMS records into hourly averages
 * 
 * @param {Array} records - Array of AnalysisRecord objects sorted by timestamp
 * @param {Object} log - Logger instance
 * @returns {Array} Array of hourly aggregated data points
 */
function aggregateHourlyData(records, log) {
  if (!records || records.length === 0) {
    log.debug('No records to aggregate');
    return [];
  }

  log.info('Starting hourly aggregation', { totalRecords: records.length });

  // Group records by hour bucket
  const hourlyBuckets = new Map();

  for (const record of records) {
    if (!record.timestamp || !record.analysis) continue;

    // Get hour bucket (truncate to hour)
    const timestamp = new Date(record.timestamp);
    const hourBucket = new Date(timestamp);
    hourBucket.setMinutes(0, 0, 0);
    const bucketKey = hourBucket.toISOString();

    if (!hourlyBuckets.has(bucketKey)) {
      hourlyBuckets.set(bucketKey, []);
    }
    hourlyBuckets.get(bucketKey).push(record);
  }

  log.debug('Records grouped into hour buckets', { bucketCount: hourlyBuckets.size });

  // Compute averages for each bucket
  const hourlyData = [];

  for (const [bucketKey, bucketRecords] of hourlyBuckets.entries()) {
    const aggregated = {
      timestamp: bucketKey,
      dataPoints: bucketRecords.length,
      metrics: computeBucketMetrics(bucketRecords, log)
    };
    hourlyData.push(aggregated);
  }

  // Sort by timestamp ascending
  hourlyData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  log.info('Hourly aggregation complete', {
    outputHours: hourlyData.length,
    inputRecords: records.length,
    compressionRatio: (records.length / hourlyData.length).toFixed(2)
  });

  return hourlyData;
}

/**
 * Compute average metrics for a bucket of records
 */
function computeBucketMetrics(records, log) {
  const metrics = {
    voltage: { sum: 0, count: 0 },
    current: { sum: 0, count: 0 },
    power: { sum: 0, count: 0 },
    soc: { sum: 0, count: 0 },
    capacity: { sum: 0, count: 0 },
    temperature: { sum: 0, count: 0 },
    mosTemperature: { sum: 0, count: 0 },
    cellVoltageDiff: { sum: 0, count: 0 },
    // Track charging vs discharging separately
    chargingCurrent: { sum: 0, count: 0 },
    dischargingCurrent: { sum: 0, count: 0 },
    chargingPower: { sum: 0, count: 0 },
    dischargingPower: { sum: 0, count: 0 }
  };

  for (const record of records) {
    const a = record.analysis;
    if (!a) continue;

    // Accumulate values
    if (typeof a.overallVoltage === 'number') {
      metrics.voltage.sum += a.overallVoltage;
      metrics.voltage.count++;
    }
    if (typeof a.current === 'number') {
      metrics.current.sum += a.current;
      metrics.current.count++;
      // Separate charging and discharging
      if (a.current > 0) {
        metrics.chargingCurrent.sum += a.current;
        metrics.chargingCurrent.count++;
      } else if (a.current < 0) {
        metrics.dischargingCurrent.sum += Math.abs(a.current);
        metrics.dischargingCurrent.count++;
      }
    }
    if (typeof a.power === 'number') {
      metrics.power.sum += a.power;
      metrics.power.count++;
      // Separate charging and discharging power
      if (a.power > 0) {
        metrics.chargingPower.sum += a.power;
        metrics.chargingPower.count++;
      } else if (a.power < 0) {
        metrics.dischargingPower.sum += Math.abs(a.power);
        metrics.dischargingPower.count++;
      }
    }
    if (typeof a.stateOfCharge === 'number') {
      metrics.soc.sum += a.stateOfCharge;
      metrics.soc.count++;
    }
    if (typeof a.remainingCapacity === 'number') {
      metrics.capacity.sum += a.remainingCapacity;
      metrics.capacity.count++;
    }
    if (typeof a.temperature === 'number') {
      metrics.temperature.sum += a.temperature;
      metrics.temperature.count++;
    }
    if (typeof a.mosTemperature === 'number') {
      metrics.mosTemperature.sum += a.mosTemperature;
      metrics.mosTemperature.count++;
    }
    if (typeof a.cellVoltageDifference === 'number') {
      metrics.cellVoltageDiff.sum += a.cellVoltageDifference;
      metrics.cellVoltageDiff.count++;
    }
  }

  // Compute averages, rounding to reasonable precision
  const result = {};
  
  if (metrics.voltage.count > 0) {
    result.avgVoltage = parseFloat((metrics.voltage.sum / metrics.voltage.count).toFixed(2));
  }
  if (metrics.current.count > 0) {
    result.avgCurrent = parseFloat((metrics.current.sum / metrics.current.count).toFixed(2));
  }
  if (metrics.power.count > 0) {
    result.avgPower = parseFloat((metrics.power.sum / metrics.power.count).toFixed(1));
  }
  if (metrics.soc.count > 0) {
    result.avgSoC = parseFloat((metrics.soc.sum / metrics.soc.count).toFixed(1));
  }
  if (metrics.capacity.count > 0) {
    result.avgCapacity = parseFloat((metrics.capacity.sum / metrics.capacity.count).toFixed(1));
  }
  if (metrics.temperature.count > 0) {
    result.avgTemperature = parseFloat((metrics.temperature.sum / metrics.temperature.count).toFixed(1));
  }
  if (metrics.mosTemperature.count > 0) {
    result.avgMosTemperature = parseFloat((metrics.mosTemperature.sum / metrics.mosTemperature.count).toFixed(1));
  }
  if (metrics.cellVoltageDiff.count > 0) {
    result.avgCellVoltageDiff = parseFloat((metrics.cellVoltageDiff.sum / metrics.cellVoltageDiff.count).toFixed(4));
  }

  // Add charging/discharging specific metrics
  if (metrics.chargingCurrent.count > 0) {
    result.avgChargingCurrent = parseFloat((metrics.chargingCurrent.sum / metrics.chargingCurrent.count).toFixed(2));
    result.chargingCount = metrics.chargingCurrent.count;
  }
  if (metrics.dischargingCurrent.count > 0) {
    result.avgDischargingCurrent = parseFloat((metrics.dischargingCurrent.sum / metrics.dischargingCurrent.count).toFixed(2));
    result.dischargingCount = metrics.dischargingCurrent.count;
  }
  if (metrics.chargingPower.count > 0) {
    result.avgChargingPower = parseFloat((metrics.chargingPower.sum / metrics.chargingPower.count).toFixed(1));
  }
  if (metrics.dischargingPower.count > 0) {
    result.avgDischargingPower = parseFloat((metrics.dischargingPower.sum / metrics.dischargingPower.count).toFixed(1));
  }

  return result;
}

/**
 * Get hourly averaged data for a time range
 * 
 * @param {string} systemId - System ID to query
 * @param {number} daysBack - Number of days to look back (default: 30)
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} Hourly aggregated data
 */
async function getHourlyAveragedData(systemId, daysBack = 30, log) {
  const { getCollection } = require('./mongodb.cjs');
  
  log.info('Fetching hourly averaged data', { systemId, daysBack });

  const historyCollection = await getCollection('history');

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

  log.debug('Date range for query', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString()
  });

  // Query database
  const query = {
    systemId,
    timestamp: {
      $gte: startDate.toISOString(),
      $lte: endDate.toISOString()
    }
  };

  const records = await historyCollection
    .find(query, { projection: { _id: 0, timestamp: 1, analysis: 1 } })
    .sort({ timestamp: 1 })
    .toArray();

  log.info('Raw records fetched from database', { count: records.length });

  if (records.length === 0) {
    log.warn('No records found for time range');
    return [];
  }

  // Aggregate into hourly buckets
  const hourlyData = aggregateHourlyData(records, log);

  return hourlyData;
}

/**
 * Format hourly data into a compact summary for AI consumption
 * Reduces token usage while preserving key information
 */
function formatHourlyDataForAI(hourlyData, log) {
  if (!hourlyData || hourlyData.length === 0) {
    return null;
  }

  log.debug('Formatting hourly data for AI', { hours: hourlyData.length });

  // Calculate overall statistics
  const allMetrics = hourlyData.map(h => h.metrics);
  
  const summary = {
    timeRange: {
      start: hourlyData[0].timestamp,
      end: hourlyData[hourlyData.length - 1].timestamp,
      totalHours: hourlyData.length,
      totalDataPoints: hourlyData.reduce((sum, h) => sum + h.dataPoints, 0)
    },
    hourlyData: hourlyData.map(h => ({
      time: h.timestamp,
      dataPoints: h.dataPoints,
      ...h.metrics
    }))
  };

  const outputSize = JSON.stringify(summary).length;
  log.info('Hourly data formatted for AI', {
    hours: hourlyData.length,
    outputSize,
    estimatedTokens: Math.ceil(outputSize / 4)
  });

  return summary;
}

module.exports = {
  aggregateHourlyData,
  getHourlyAveragedData,
  formatHourlyDataForAI,
  computeBucketMetrics
};
