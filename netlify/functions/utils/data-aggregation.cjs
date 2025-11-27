/**
 * Data Aggregation Utilities for BMS Analysis
 * 
 * This module provides functions to aggregate and prepare BMS data for AI analysis.
 * Implements hourly averaging and data summarization to optimize token usage.
 * 
 * Performance optimizations:
 * - Caching layer for frequently accessed data
 * - Batch processing for large datasets
 * - Query optimization with proper indexing hints
 * 
 * @module netlify/functions/utils/data-aggregation
 */

const { getCollection } = require('./mongodb.cjs');
const { getHistoryCache, generateCacheKey } = require('./cache.cjs');

/**
 * Aggregate BMS records into hourly averages
 * 
 * @param {Array} records - Array of AnalysisRecord objects sorted by timestamp
 * @param {Object} log - Logger instance
 * @returns {Array} Array of hourly aggregated data points
 */
function aggregateHourlyData(records, log) {
  try {
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
      // Explicitly pass bucketHours: 1 for hourly aggregation to ensure correct energy calculations
      metrics: computeBucketMetrics(bucketRecords, log, { bucketHours: 1 })
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
  } catch (error) {
    log.error('Error in aggregateHourlyData', { error: error.message, stack: error.stack });
    return [];
  }
}

/**
 * Compute average metrics for a bucket of records
 * 
 * ENERGY CALCULATION METHODOLOGY:
 * ================================
 * This function calculates both POWER (instantaneous, in Watts) and ENERGY (accumulated, in Wh).
 * 
 * - Power (W) = Instantaneous rate of energy transfer
 * - Energy (Wh) = Power × Time = How much work was done
 * 
 * DUAL CALCULATION APPROACH:
 * ==========================
 * Energy is calculated using TWO methods when both data sources are available:
 * 
 * 1. **Current-based**: chargingWh/chargingKWh (from Ah × Voltage)
 *    - More accurate when voltage measurements are precise
 *    - Used when power data is unavailable
 * 
 * 2. **Power-based**: chargingEnergyWh/chargingEnergyKWh (from Power × Time)
 *    - More direct measurement
 *    - Preferred when available (used in netEnergyWh calculation)
 * 
 * The net energy balance (netEnergyWh) preferentially uses power-based values,
 * with fallback to current-based values if power data is missing.
 * 
 * TIME ESTIMATION:
 * ================
 * For energy calculations, we estimate the time interval based on the proportion
 * of active (charging + discharging) records. Records with current between -0.5A 
 * and +0.5A are excluded from both charging and discharging counts to prevent
 * time proportions from summing to >100%.
 * 
 * NOTE: This assumes relatively even distribution of data points. For clustered
 * data points, actual time-based calculations would be more accurate but require
 * timestamp processing.
 * 
 * @param {Array} records - Records to aggregate
 * @param {Object} log - Logger instance
 * @param {Object} options - Configuration options
 * @param {number} options.chargingThreshold - Current threshold for charging (default: 0.5A)
 * @param {number} options.dischargingThreshold - Current threshold for discharging (default: -0.5A)
 * @param {number} options.bucketHours - Duration of this bucket in hours (default: 1 for hourly aggregation)
 * @returns {Object} Aggregated metrics including both power (W) and energy (Wh)
 */
function computeBucketMetrics(records, log, options = {}) {
  const { 
    chargingThreshold = 0.5, 
    dischargingThreshold = -0.5,
    bucketHours = 1 // Default to 1 hour for hourly aggregation
  } = options;
  
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
      // Separate charging and discharging using configurable thresholds
      if (a.current >= chargingThreshold) {
        metrics.chargingCurrent.sum += a.current;
        metrics.chargingCurrent.count++;
      } else if (a.current <= dischargingThreshold) {
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
    result.avgVoltage_V = parseFloat((metrics.voltage.sum / metrics.voltage.count).toFixed(2));
    // Keep old field name for backward compatibility
    result.avgVoltage = result.avgVoltage_V;
  }
  if (metrics.current.count > 0) {
    result.avgCurrent_A = parseFloat((metrics.current.sum / metrics.current.count).toFixed(2));
    result.avgCurrent = result.avgCurrent_A;
  }
  if (metrics.power.count > 0) {
    result.avgPower_W = parseFloat((metrics.power.sum / metrics.power.count).toFixed(1));
    result.avgPower = result.avgPower_W;
  }
  if (metrics.soc.count > 0) {
    result.avgSoC_percent = parseFloat((metrics.soc.sum / metrics.soc.count).toFixed(1));
    result.avgSoC = result.avgSoC_percent;
  }
  if (metrics.capacity.count > 0) {
    result.avgCapacity_Ah = parseFloat((metrics.capacity.sum / metrics.capacity.count).toFixed(1));
    result.avgCapacity = result.avgCapacity_Ah;
  }
  if (metrics.temperature.count > 0) {
    result.avgTemperature_C = parseFloat((metrics.temperature.sum / metrics.temperature.count).toFixed(1));
    result.avgTemperature = result.avgTemperature_C;
  }
  if (metrics.mosTemperature.count > 0) {
    result.avgMosTemperature_C = parseFloat((metrics.mosTemperature.sum / metrics.mosTemperature.count).toFixed(1));
    result.avgMosTemperature = result.avgMosTemperature_C;
  }
  if (metrics.cellVoltageDiff.count > 0) {
    result.avgCellVoltageDiff_V = parseFloat((metrics.cellVoltageDiff.sum / metrics.cellVoltageDiff.count).toFixed(4));
    result.avgCellVoltageDiff = result.avgCellVoltageDiff_V;
  }

  // Add charging/discharging specific metrics with BOTH power and energy
  if (metrics.chargingCurrent.count > 0) {
    const avgChargingCurrent = metrics.chargingCurrent.sum / metrics.chargingCurrent.count;
    result.avgChargingCurrent_A = parseFloat(avgChargingCurrent.toFixed(2));
    result.avgChargingCurrent = result.avgChargingCurrent_A;
    result.chargingCount = metrics.chargingCurrent.count;
    
    // Calculate charging Ah for this bucket: current × time
    // Use only records that are either charging or discharging as denominator
    // to prevent time proportions from summing to >100%
    const activeRecordsCount = metrics.chargingCurrent.count + metrics.dischargingCurrent.count;
    const chargingHoursProportion = activeRecordsCount > 0
        ? metrics.chargingCurrent.count / activeRecordsCount
        : 0;
    const estimatedChargingHours = bucketHours * chargingHoursProportion;
    result.chargingAh = parseFloat((avgChargingCurrent * estimatedChargingHours).toFixed(2));
    
    // If we have voltage, also calculate Wh
    if (result.avgVoltage_V) {
      result.chargingWh = parseFloat((result.chargingAh * result.avgVoltage_V).toFixed(1));
      result.chargingKWh = parseFloat((result.chargingWh / 1000).toFixed(3));
    }
  }
  if (metrics.dischargingCurrent.count > 0) {
    const avgDischargingCurrent = metrics.dischargingCurrent.sum / metrics.dischargingCurrent.count;
    result.avgDischargingCurrent_A = parseFloat(avgDischargingCurrent.toFixed(2));
    result.avgDischargingCurrent = result.avgDischargingCurrent_A;
    result.dischargingCount = metrics.dischargingCurrent.count;
    
    // Calculate discharging Ah for this bucket
    // Use only records that are either charging or discharging as denominator
    const activeRecordsCount = metrics.chargingCurrent.count + metrics.dischargingCurrent.count;
    const dischargingHoursProportion = activeRecordsCount > 0
        ? metrics.dischargingCurrent.count / activeRecordsCount
        : 0;
    const estimatedDischargingHours = bucketHours * dischargingHoursProportion;
    result.dischargingAh = parseFloat((avgDischargingCurrent * estimatedDischargingHours).toFixed(2));
    
    // If we have voltage, also calculate Wh
    if (result.avgVoltage_V) {
      result.dischargingWh = parseFloat((result.dischargingAh * result.avgVoltage_V).toFixed(1));
      result.dischargingKWh = parseFloat((result.dischargingWh / 1000).toFixed(3));
    }
  }
  
  // Power-based energy calculations (more direct from power measurements)
  if (metrics.chargingPower.count > 0) {
    const avgChargingPower = metrics.chargingPower.sum / metrics.chargingPower.count;
    result.avgChargingPower_W = parseFloat(avgChargingPower.toFixed(1));
    result.avgChargingPower = result.avgChargingPower_W;
    
    // Calculate energy from power × time
    // Use proportion of active (charging + discharging) records
    const activeRecordsCount = metrics.chargingPower.count + metrics.dischargingPower.count;
    const chargingHoursProportion = activeRecordsCount > 0
        ? metrics.chargingPower.count / activeRecordsCount
        : 0;
    const estimatedChargingHours = bucketHours * chargingHoursProportion;
    result.chargingEnergyWh = parseFloat((avgChargingPower * estimatedChargingHours).toFixed(1));
    result.chargingEnergyKWh = parseFloat((result.chargingEnergyWh / 1000).toFixed(3));
  }
  if (metrics.dischargingPower.count > 0) {
    const avgDischargingPower = metrics.dischargingPower.sum / metrics.dischargingPower.count;
    result.avgDischargingPower_W = parseFloat(avgDischargingPower.toFixed(1));
    result.avgDischargingPower = result.avgDischargingPower_W;
    
    // Calculate energy from power × time
    const activeRecordsCount = metrics.chargingPower.count + metrics.dischargingPower.count;
    const dischargingHoursProportion = activeRecordsCount > 0
        ? metrics.dischargingPower.count / activeRecordsCount
        : 0;
    const estimatedDischargingHours = bucketHours * dischargingHoursProportion;
    result.dischargingEnergyWh = parseFloat((avgDischargingPower * estimatedDischargingHours).toFixed(1));
    result.dischargingEnergyKWh = parseFloat((result.dischargingEnergyWh / 1000).toFixed(3));
  }
  
  // Net energy for this bucket
  // Prefer power-based calculations, but fall back to current-based if power data unavailable
  const chargingEnergy = result.chargingEnergyWh || result.chargingWh || 0;
  const dischargingEnergy = result.dischargingEnergyWh || result.dischargingWh || 0;
  if (chargingEnergy > 0 || dischargingEnergy > 0) {
    result.netEnergyWh = parseFloat((chargingEnergy - dischargingEnergy).toFixed(1));
    result.netEnergyKWh = parseFloat((result.netEnergyWh / 1000).toFixed(3));
  }

  return result;
}

/**
 * Get hourly averaged data for a time range
 * 
 * Performance optimized with:
 * - In-memory caching (10 minute TTL for historical data)
 * - Efficient query projection (only fetches needed fields)
 * - Indexed query on systemId and timestamp
 * 
 * @param {string} systemId - System ID to query
 * @param {number} daysBack - Number of days to look back (default: 30)
 * @param {Object} log - Logger instance
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.useCache=true] - Whether to use caching
 * @param {number} [options.cacheTTL=600000] - Cache TTL in ms (default 10 min)
 * @returns {Promise<Array>} Hourly aggregated data
 */
async function getHourlyAveragedData(systemId, daysBack = 30, log, options = {}) {
  const { useCache = true, cacheTTL = 600000 } = options;
  
  log.info('Fetching hourly averaged data', { systemId, daysBack, useCache });
  
  // Check cache first
  if (useCache) {
    const cache = getHistoryCache();
    const cacheKey = generateCacheKey('hourlyAvg', { systemId, daysBack });
    
    const cached = cache.get(cacheKey);
    if (cached) {
      log.info('Cache hit for hourly averaged data', { 
        systemId, 
        daysBack,
        cachedRecords: cached.length 
      });
      return cached;
    }
  }
  
  const startTime = Date.now();
  const historyCollection = await getCollection('history');

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

  log.debug('Date range for query', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString()
  });

  // Query database - optimized projection for minimal data transfer
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

  const queryDuration = Date.now() - startTime;
  log.info('Raw records fetched from database', { 
    count: records.length,
    queryDurationMs: queryDuration 
  });

  if (records.length === 0) {
    log.warn('No records found for time range');
    return [];
  }

  // Aggregate into hourly buckets
  const hourlyData = aggregateHourlyData(records, log);
  
  // Cache the result
  if (useCache && hourlyData.length > 0) {
    const cache = getHistoryCache();
    const cacheKey = generateCacheKey('hourlyAvg', { systemId, daysBack });
    cache.set(cacheKey, hourlyData, cacheTTL);
    log.debug('Cached hourly averaged data', { 
      systemId, 
      daysBack,
      records: hourlyData.length 
    });
  }

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

/**
 * Create a compact statistical summary of historical data
 * Used for initial context without overwhelming token budget
 * 
 * @param {Array} hourlyData - Array of hourly aggregated data
 * @param {Object} log - Logger instance
 * @returns {Object} Compact statistical summary
 */
function createCompactSummary(hourlyData, log) {
  if (!hourlyData || hourlyData.length === 0) {
    return null;
  }

  log.debug('Creating compact summary', { hours: hourlyData.length });

  // Extract all metrics
  const metrics = hourlyData.map(h => h.metrics);
  
  // Helper to calculate stats for a metric
  const calcStats = (values) => {
    const filtered = values.filter(v => v != null);
    if (filtered.length === 0) return null;
    
    const sorted = [...filtered].sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: filtered.reduce((sum, v) => sum + v, 0) / filtered.length,
      latest: values[values.length - 1]
    };
  };

  // Aggregate all metrics
  const summary = {
    timeRange: {
      start: hourlyData[0].timestamp,
      end: hourlyData[hourlyData.length - 1].timestamp,
      hours: hourlyData.length,
      dataPoints: hourlyData.reduce((sum, h) => sum + h.dataPoints, 0)
    },
    statistics: {}
  };

  // Voltage stats
  const voltages = metrics.map(m => m.avgVoltage).filter(v => v != null);
  if (voltages.length > 0) {
    summary.statistics.voltage = calcStats(voltages);
  }

  // Current stats (overall and charge/discharge separately)
  const currents = metrics.map(m => m.avgCurrent).filter(v => v != null);
  if (currents.length > 0) {
    summary.statistics.current = calcStats(currents);
  }
  
  const chargingCurrents = metrics.map(m => m.avgChargingCurrent).filter(v => v != null);
  if (chargingCurrents.length > 0) {
    summary.statistics.chargingCurrent = calcStats(chargingCurrents);
  }
  
  const dischargingCurrents = metrics.map(m => m.avgDischargingCurrent).filter(v => v != null);
  if (dischargingCurrents.length > 0) {
    summary.statistics.dischargingCurrent = calcStats(dischargingCurrents);
  }

  // Power stats
  const powers = metrics.map(m => m.avgPower).filter(v => v != null);
  if (powers.length > 0) {
    summary.statistics.power = calcStats(powers);
  }

  // SoC stats
  const socs = metrics.map(m => m.avgSoC).filter(v => v != null);
  if (socs.length > 0) {
    summary.statistics.soc = calcStats(socs);
  }

  // Capacity stats
  const capacities = metrics.map(m => m.avgCapacity).filter(v => v != null);
  if (capacities.length > 0) {
    summary.statistics.capacity = calcStats(capacities);
  }

  // Temperature stats
  const temps = metrics.map(m => m.avgTemperature).filter(v => v != null);
  if (temps.length > 0) {
    summary.statistics.temperature = calcStats(temps);
  }

  // Cell voltage difference stats
  const cellDiffs = metrics.map(m => m.avgCellVoltageDiff).filter(v => v != null);
  if (cellDiffs.length > 0) {
    summary.statistics.cellVoltageDiff = calcStats(cellDiffs);
  }

  // Add sample data points (first, middle, last) for trend visualization
  const samplePoints = [];
  if (hourlyData.length > 0) {
    samplePoints.push({ time: hourlyData[0].timestamp, ...hourlyData[0].metrics });
  }
  if (hourlyData.length > 2) {
    const midIndex = Math.floor(hourlyData.length / 2);
    samplePoints.push({ time: hourlyData[midIndex].timestamp, ...hourlyData[midIndex].metrics });
  }
  if (hourlyData.length > 1) {
    const lastIndex = hourlyData.length - 1;
    samplePoints.push({ time: hourlyData[lastIndex].timestamp, ...hourlyData[lastIndex].metrics });
  }
  summary.sampleDataPoints = samplePoints;

  const outputSize = JSON.stringify(summary).length;
  log.info('Compact summary created', {
    originalHours: hourlyData.length,
    outputSize,
    estimatedTokens: Math.ceil(outputSize / 4),
    compressionRatio: ((JSON.stringify(hourlyData).length / outputSize).toFixed(2))
  });

  return summary;
}

/**
 * Intelligently sample data points based on time range
 * For very large datasets, returns strategically sampled points
 * 
 * @param {Array} hourlyData - Array of hourly aggregated data
 * @param {number} maxPoints - Maximum number of points to return
 * @param {Object} log - Logger instance
 * @returns {Array} Sampled data points
 */
function sampleDataPoints(hourlyData, maxPoints = 100, log) {
  if (!hourlyData || hourlyData.length === 0) {
    return [];
  }

  if (hourlyData.length <= maxPoints) {
    log.debug('Data within limit, no sampling needed', { 
      hours: hourlyData.length, 
      maxPoints 
    });
    return hourlyData;
  }

  log.info('Sampling data points', { 
    originalHours: hourlyData.length, 
    maxPoints 
  });

  // Use systematic sampling (every nth point)
  const step = hourlyData.length / maxPoints;
  const sampled = [];
  
  for (let i = 0; i < maxPoints; i++) {
    const index = Math.floor(i * step);
    sampled.push(hourlyData[index]);
  }

  // Always include the last point if not already included
  const lastPoint = hourlyData[hourlyData.length - 1];
  if (sampled[sampled.length - 1].timestamp !== lastPoint.timestamp) {
    sampled[sampled.length - 1] = lastPoint;
  }

  log.debug('Sampling complete', { 
    sampledPoints: sampled.length,
    compressionRatio: (hourlyData.length / sampled.length).toFixed(2)
  });

  return sampled;
}

/**
 * Aggregate records into daily summaries
 * Optimized for batch processing of large datasets
 * 
 * @param {Array} records - Array of AnalysisRecord objects sorted by timestamp
 * @param {Object} log - Logger instance
 * @param {Object} [options] - Aggregation options
 * @returns {Array} Array of daily aggregated data points
 */
function aggregateDailyData(records, log, options = {}) {
  try {
    if (!records || records.length === 0) {
      log.debug('No records to aggregate for daily data');
      return [];
    }

    log.info('Starting daily aggregation', { totalRecords: records.length });

    // Group records by day bucket
    const dailyBuckets = new Map();

    for (const record of records) {
      if (!record.timestamp || !record.analysis) continue;

      // Get day bucket (truncate to day)
      const timestamp = new Date(record.timestamp);
      const dayBucket = new Date(timestamp);
      dayBucket.setHours(0, 0, 0, 0);
      const bucketKey = dayBucket.toISOString().split('T')[0];

      if (!dailyBuckets.has(bucketKey)) {
        dailyBuckets.set(bucketKey, []);
      }
      dailyBuckets.get(bucketKey).push(record);
    }

    log.debug('Records grouped into day buckets', { bucketCount: dailyBuckets.size });

    // Compute averages for each bucket
    const dailyData = [];

    for (const [bucketKey, bucketRecords] of dailyBuckets.entries()) {
      const aggregated = {
        date: bucketKey,
        timestamp: `${bucketKey}T00:00:00.000Z`,
        dataPoints: bucketRecords.length,
        // Pass bucketHours: 24 for daily aggregation
        metrics: computeBucketMetrics(bucketRecords, log, { bucketHours: 24 })
      };
      dailyData.push(aggregated);
    }

    // Sort by date ascending
    dailyData.sort((a, b) => new Date(a.date) - new Date(b.date));

    log.info('Daily aggregation complete', {
      outputDays: dailyData.length,
      inputRecords: records.length,
      compressionRatio: (records.length / dailyData.length).toFixed(2)
    });

    return dailyData;
  } catch (error) {
    log.error('Error in aggregateDailyData', { error: error.message, stack: error.stack });
    return [];
  }
}

/**
 * Get daily aggregated data for a time range with caching
 * 
 * @param {string} systemId - System ID to query
 * @param {number} daysBack - Number of days to look back (default: 90)
 * @param {Object} log - Logger instance
 * @param {Object} [options] - Additional options
 * @returns {Promise<Array>} Daily aggregated data
 */
async function getDailyAggregatedData(systemId, daysBack = 90, log, options = {}) {
  const { useCache = true, cacheTTL = 1800000 } = options; // 30 min default for daily data
  
  log.info('Fetching daily aggregated data', { systemId, daysBack, useCache });
  
  // Check cache first
  if (useCache) {
    const cache = getHistoryCache();
    const cacheKey = generateCacheKey('dailyAgg', { systemId, daysBack });
    
    const cached = cache.get(cacheKey);
    if (cached) {
      log.info('Cache hit for daily aggregated data', { 
        systemId, 
        daysBack,
        cachedDays: cached.length 
      });
      return cached;
    }
  }
  
  const startTime = Date.now();
  const historyCollection = await getCollection('history');

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

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

  const queryDuration = Date.now() - startTime;
  log.info('Raw records fetched for daily aggregation', { 
    count: records.length,
    queryDurationMs: queryDuration 
  });

  if (records.length === 0) {
    log.warn('No records found for daily aggregation time range');
    return [];
  }

  // Aggregate into daily buckets
  const dailyData = aggregateDailyData(records, log);
  
  // Cache the result
  if (useCache && dailyData.length > 0) {
    const cache = getHistoryCache();
    const cacheKey = generateCacheKey('dailyAgg', { systemId, daysBack });
    cache.set(cacheKey, dailyData, cacheTTL);
    log.debug('Cached daily aggregated data', { 
      systemId, 
      daysBack,
      days: dailyData.length 
    });
  }

  return dailyData;
}

/**
 * Invalidate cache for a specific system
 * Call this when new data is added for a system
 * 
 * @param {string} systemId - System ID to invalidate cache for
 */
function invalidateSystemCache(systemId) {
  const cache = getHistoryCache();
  const pattern = new RegExp(`systemId=${systemId}`);
  const invalidated = cache.invalidateByPattern(pattern);
  return invalidated;
}

/**
 * Get cache statistics for monitoring
 * 
 * @returns {Object} Cache statistics
 */
function getCacheStats() {
  const cache = getHistoryCache();
  return cache.getStats();
}

module.exports = {
  aggregateHourlyData,
  getHourlyAveragedData,
  formatHourlyDataForAI,
  computeBucketMetrics,
  createCompactSummary,
  sampleDataPoints,
  aggregateDailyData,
  getDailyAggregatedData,
  invalidateSystemCache,
  getCacheStats
};
