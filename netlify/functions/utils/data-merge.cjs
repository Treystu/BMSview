/**
 * Data Merge Utilities for Historical Analysis
 * 
 * Merges BMS screenshot data with Cloud hourly data for unified timeline visualization
 * 
 * @module netlify/functions/utils/data-merge
 */

const { getCollection } = require('./mongodb.cjs');

/**
 * Linear interpolation between two values
 * @param {number} y0 - Value at t0
 * @param {number} y1 - Value at t1
 * @param {number} t0 - Start time (ms)
 * @param {number} t1 - End time (ms)
 * @param {number} t - Current time (ms)
 * @returns {number} Interpolated value
 */
function linearInterpolate(y0, y1, t0, t1, t) {
  try {
    if (t1 === t0) return y0; // Avoid division by zero
    const ratio = (t - t0) / (t1 - t0);
  return y0 + ratio * (y1 - y0);
  } catch (error) {
    console.error('Error in linearInterpolate:', error);
    return y0;
  }
}

/**
 * Merge BMS screenshot data with Cloud hourly data
 * 
 * @param {string} systemId - System ID to query
 * @param {string} startDate - Start date ISO string
 * @param {string} endDate - End date ISO string
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} Merged and sorted array of data points
 */
async function mergeBmsAndCloudData(systemId, startDate, endDate, log) {
  log.info('Starting data merge', { systemId, startDate, endDate });

  const historyCollection = await getCollection('history');
  const hourlyWeatherCollection = await getCollection('hourly-weather');

  // Fetch BMS screenshot data
  const bmsRecords = await historyCollection
    .find({
      systemId,
      timestamp: {
        $gte: startDate,
        $lte: endDate
      }
    }, { projection: { _id: 0 } })
    .sort({ timestamp: 1 })
    .toArray();

  log.info('Fetched BMS records', { count: bmsRecords.length });

  // Convert BMS records to data points with 'bms' source flag
  const bmsPoints = bmsRecords.map(record => ({
    timestamp: record.timestamp,
    source: 'bms',
    data: {
      stateOfCharge: record.analysis?.stateOfCharge ?? null,
      overallVoltage: record.analysis?.overallVoltage ?? null,
      current: record.analysis?.current ?? null,
      power: record.analysis?.power ?? null,
      temperature: record.analysis?.temperature ?? null,
      mosTemperature: record.analysis?.mosTemperature ?? null,
      cellVoltageDifference: record.analysis?.cellVoltageDifference ?? null,
      clouds: record.weather?.clouds ?? null,
      uvi: record.weather?.uvi ?? null,
      temp: record.weather?.temp ?? null,
      remainingCapacity: record.analysis?.remainingCapacity ?? null,
      fullCapacity: record.analysis?.fullCapacity ?? null
    },
    recordId: record.id,
    fileName: record.fileName
  }));

  // Fetch Cloud hourly data
  // Parse start/end to get date range
  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDate);
  
  // Get all days in range
  const dateQueries = [];
  const currentDate = new Date(startDateObj);
  currentDate.setHours(0, 0, 0, 0);
  
  while (currentDate <= endDateObj) {
    const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
    dateQueries.push(dateStr);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  log.debug('Querying cloud data for dates', { dates: dateQueries.length });

  const cloudDocs = await hourlyWeatherCollection
    .find({
      systemId,
      date: { $in: dateQueries }
    })
    .toArray();

  log.info('Fetched cloud hourly docs', { count: cloudDocs.length });

  // Extract hourly data points from cloud docs
  const cloudPoints = [];
  
  for (const doc of cloudDocs) {
    if (!doc.hourlyData || !Array.isArray(doc.hourlyData)) continue;
    
    for (const hourData of doc.hourlyData) {
      const hourTimestamp = hourData.timestamp;
      const hourDate = new Date(hourTimestamp);
      
      // Only include if within our time range
      if (hourDate >= startDateObj && hourDate <= endDateObj) {
        cloudPoints.push({
          timestamp: hourTimestamp,
          source: 'cloud',
          data: {
            clouds: hourData.clouds ?? null,
            temp: hourData.temp ?? null,
            uvi: hourData.uvi ?? null,
            weather_main: hourData.weather_main ?? null,
            estimated_irradiance_w_m2: hourData.estimated_irradiance_w_m2 ?? null
          }
        });
      }
    }
  }

  log.info('Extracted cloud hourly points', { count: cloudPoints.length });

  // Merge BMS and Cloud points
  // Create a map of BMS timestamps for quick lookup
  const bmsTimestampMap = new Map();
  for (const point of bmsPoints) {
    bmsTimestampMap.set(point.timestamp, point);
  }

  // Add interpolated BMS data between cloud hourly points
  const mergedPoints = [...bmsPoints];

  // Sort cloud points by timestamp
  cloudPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // For each cloud point, if no BMS data exists at that exact timestamp, create an estimated point
  for (let i = 0; i < cloudPoints.length; i++) {
    const cloudPoint = cloudPoints[i];
    const cloudTime = new Date(cloudPoint.timestamp).getTime();

    // Check if we already have BMS data at this timestamp
    if (!bmsTimestampMap.has(cloudPoint.timestamp)) {
      // Find surrounding BMS points for interpolation
      const bmsBefore = findClosestBmsBefore(bmsPoints, cloudTime);
      const bmsAfter = findClosestBmsAfter(bmsPoints, cloudTime);

      if (bmsBefore && bmsAfter) {
        // We can interpolate
        const t0 = new Date(bmsBefore.timestamp).getTime();
        const t1 = new Date(bmsAfter.timestamp).getTime();

        const estimatedData = {
          clouds: cloudPoint.data.clouds,
          temp: cloudPoint.data.temp,
          uvi: cloudPoint.data.uvi,
          weather_main: cloudPoint.data.weather_main,
          estimated_irradiance_w_m2: cloudPoint.data.estimated_irradiance_w_m2
        };

        // Interpolate BMS metrics
        const bmsMetrics = ['stateOfCharge', 'overallVoltage', 'current', 'power', 'temperature', 
                            'mosTemperature', 'cellVoltageDifference', 'remainingCapacity', 'fullCapacity'];
        
        for (const metric of bmsMetrics) {
          const y0 = bmsBefore.data[metric];
          const y1 = bmsAfter.data[metric];
          
          if (y0 !== null && y1 !== null) {
            estimatedData[metric] = linearInterpolate(y0, y1, t0, t1, cloudTime);
          } else {
            estimatedData[metric] = null;
          }
        }

        mergedPoints.push({
          timestamp: cloudPoint.timestamp,
          source: 'estimated',
          data: estimatedData
        });
      } else {
        // Can't interpolate, just add cloud data without BMS metrics
        mergedPoints.push({
          timestamp: cloudPoint.timestamp,
          source: 'cloud',
          data: cloudPoint.data
        });
      }
    } else {
      // BMS data exists at this timestamp, merge cloud weather data into it
      const bmsPoint = bmsTimestampMap.get(cloudPoint.timestamp);
      // Prefer cloud hourly data for weather metrics (more precise/recent than BMS snapshot weather)
      bmsPoint.data.clouds = cloudPoint.data.clouds ?? bmsPoint.data.clouds;
      bmsPoint.data.temp = cloudPoint.data.temp ?? bmsPoint.data.temp;
      bmsPoint.data.uvi = cloudPoint.data.uvi ?? bmsPoint.data.uvi;
      bmsPoint.data.weather_main = cloudPoint.data.weather_main ?? bmsPoint.data.weather_main;
      bmsPoint.data.estimated_irradiance_w_m2 = cloudPoint.data.estimated_irradiance_w_m2 ?? bmsPoint.data.estimated_irradiance_w_m2;
    }
  }

  // Sort merged points by timestamp
  mergedPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  log.info('Data merge complete', {
    totalPoints: mergedPoints.length,
    bmsPoints: mergedPoints.filter(p => p.source === 'bms').length,
    cloudPoints: mergedPoints.filter(p => p.source === 'cloud').length,
    estimatedPoints: mergedPoints.filter(p => p.source === 'estimated').length
  });

  return mergedPoints;
}

/**
 * Find closest BMS point before given timestamp
 */
function findClosestBmsBefore(bmsPoints, targetTime) {
  for (let i = bmsPoints.length - 1; i >= 0; i--) {
    const pointTime = new Date(bmsPoints[i].timestamp).getTime();
    if (pointTime < targetTime) {
      return bmsPoints[i];
    }
  }
  return null;
}

/**
 * Find closest BMS point after given timestamp
 */
function findClosestBmsAfter(bmsPoints, targetTime) {
  for (let i = 0; i < bmsPoints.length; i++) {
    const pointTime = new Date(bmsPoints[i].timestamp).getTime();
    if (pointTime > targetTime) {
      return bmsPoints[i];
    }
  }
  return null;
}

/**
 * Downsample merged data when point count exceeds threshold
 * 
 * @param {Array} mergedPoints - Merged data points
 * @param {number} maxPoints - Maximum points to return (default: 2000)
 * @param {Object} log - Logger instance
 * @returns {Array} Downsampled data points with min/max/avg
 */
function downsampleMergedData(mergedPoints, maxPoints = 2000, log) {
  if (mergedPoints.length <= maxPoints) {
    log.debug('Data within limit, no downsampling needed', { 
      points: mergedPoints.length,
      maxPoints
    });
    return mergedPoints;
  }

  log.info('Downsampling merged data', {
    originalPoints: mergedPoints.length,
    maxPoints
  });

  const bucketSize = Math.ceil(mergedPoints.length / maxPoints);
  const downsampled = [];

  for (let i = 0; i < mergedPoints.length; i += bucketSize) {
    const bucket = mergedPoints.slice(i, Math.min(i + bucketSize, mergedPoints.length));
    
    if (bucket.length === 0) continue;

    // Compute min/max/avg for each metric
    const aggregated = {
      timestamp: bucket[0].timestamp, // Use first timestamp in bucket
      timestampLast: bucket[bucket.length - 1].timestamp, // Last timestamp
      source: bucket[0].source, // Use first point's source (most are BMS ideally)
      dataPoints: bucket.length,
      data: {}
    };

    // Metrics to aggregate
    const metrics = ['stateOfCharge', 'overallVoltage', 'current', 'power', 'temperature',
                     'mosTemperature', 'cellVoltageDifference', 'clouds', 'uvi', 'temp',
                     'remainingCapacity', 'fullCapacity'];

    for (const metric of metrics) {
      const values = bucket
        .map(p => p.data[metric])
        .filter(v => v !== null && v !== undefined && typeof v === 'number');

      if (values.length > 0) {
        aggregated.data[metric] = values[0]; // Default to first value (avg)
        aggregated.data[`${metric}_min`] = Math.min(...values);
        aggregated.data[`${metric}_max`] = Math.max(...values);
        aggregated.data[`${metric}_avg`] = values.reduce((sum, v) => sum + v, 0) / values.length;
      } else {
        aggregated.data[metric] = null;
      }
    }

    downsampled.push(aggregated);
  }

  log.info('Downsampling complete', {
    originalPoints: mergedPoints.length,
    downsampledPoints: downsampled.length,
    compressionRatio: (mergedPoints.length / downsampled.length).toFixed(2)
  });

  return downsampled;
}

module.exports = {
  mergeBmsAndCloudData,
  downsampleMergedData,
  linearInterpolate
};
