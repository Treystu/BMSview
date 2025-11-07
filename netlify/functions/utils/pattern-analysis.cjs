/**
 * Pattern Analysis Module - Usage Pattern Recognition and Anomaly Detection
 * 
 * Analyzes daily, weekly, and seasonal energy consumption patterns.
 * Detects anomalies and unusual behavior in battery usage.
 * Essential for off-grid optimization and load planning.
 * 
 * @module netlify/functions/utils/pattern-analysis
 */

const { getCollection } = require('./mongodb.cjs');

/**
 * Parse time range string (e.g., "7d", "30d", "90d", "1y") to days
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
 * Analyze daily usage patterns (hourly consumption profiles)
 * 
 * @param {string} systemId - Battery system identifier
 * @param {string} timeRange - Analysis period (e.g., "30d")
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Daily pattern analysis
 */
async function analyzeDailyPatterns(systemId, timeRange = '30d', log) {
  log.info('Analyzing daily patterns', { systemId, timeRange });
  
  try {
    const days = parseTimeRange(timeRange);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const historyCollection = await getCollection('history');
    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: startDate.toISOString() },
        'analysis.current': { $exists: true },
        'analysis.power': { $exists: true }
      })
      .sort({ timestamp: 1 })
      .toArray();
    
    if (records.length < 24) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient data for daily pattern analysis. Need at least 24 hours of data, found ${records.length} records.`,
        systemId
      };
    }
    
    // Group data by hour of day (0-23)
    const hourlyBuckets = Array.from({ length: 24 }, () => ({
      samples: [],
      avgPower: 0,
      avgCurrent: 0,
      avgSoC: 0
    }));
    
    for (const record of records) {
      const hour = new Date(record.timestamp).getHours();
      const { current, power, stateOfCharge } = record.analysis;
      
      hourlyBuckets[hour].samples.push({
        power: power || 0,
        current: current || 0,
        soc: stateOfCharge || 0
      });
    }
    
    // Calculate averages for each hour
    const hourlyProfile = hourlyBuckets.map((bucket, hour) => {
      if (bucket.samples.length === 0) {
        return { hour, avgPower: 0, avgCurrent: 0, avgSoC: 0, samples: 0 };
      }
      
      const avgPower = bucket.samples.reduce((sum, s) => sum + s.power, 0) / bucket.samples.length;
      const avgCurrent = bucket.samples.reduce((sum, s) => sum + s.current, 0) / bucket.samples.length;
      const avgSoC = bucket.samples.reduce((sum, s) => sum + s.soc, 0) / bucket.samples.length;
      
      return {
        hour,
        avgPower: Math.round(avgPower * 100) / 100,
        avgCurrent: Math.round(avgCurrent * 100) / 100,
        avgSoC: Math.round(avgSoC * 100) / 100,
        samples: bucket.samples.length,
        usage: avgCurrent < 0 ? 'discharging' : avgCurrent > 0 ? 'charging' : 'idle'
      };
    });
    
    // Identify peak usage hours (highest discharge)
    const dischargingHours = hourlyProfile.filter(h => h.avgCurrent < -0.5);
    const peakDischargeHour = dischargingHours.length > 0
      ? dischargingHours.reduce((max, h) => h.avgCurrent < max.avgCurrent ? h : max)
      : null;
    
    // Identify peak charging hours
    const chargingHours = hourlyProfile.filter(h => h.avgCurrent > 0.5);
    const peakChargeHour = chargingHours.length > 0
      ? chargingHours.reduce((max, h) => h.avgCurrent > max.avgCurrent ? h : max)
      : null;
    
    // Calculate total daily energy flow
    const totalDailyCharge = chargingHours.reduce((sum, h) => sum + Math.abs(h.avgCurrent), 0);
    const totalDailyDischarge = dischargingHours.reduce((sum, h) => sum + Math.abs(h.avgCurrent), 0);
    
    log.info('Daily pattern analysis completed', {
      systemId,
      dataPoints: records.length,
      peakDischargeHour: peakDischargeHour?.hour,
      peakChargeHour: peakChargeHour?.hour
    });
    
    return {
      systemId,
      patternType: 'daily',
      timeRange: `${days} days`,
      dataPoints: records.length,
      hourlyProfile,
      peakUsage: {
        discharge: peakDischargeHour ? {
          hour: peakDischargeHour.hour,
          avgCurrent: peakDischargeHour.avgCurrent,
          avgPower: peakDischargeHour.avgPower,
          timeOfDay: `${peakDischargeHour.hour}:00`
        } : null,
        charge: peakChargeHour ? {
          hour: peakChargeHour.hour,
          avgCurrent: peakChargeHour.avgCurrent,
          avgPower: peakChargeHour.avgPower,
          timeOfDay: `${peakChargeHour.hour}:00`
        } : null
      },
      dailySummary: {
        avgDailyCharge: Math.round(totalDailyCharge * 100) / 100,
        avgDailyDischarge: Math.round(totalDailyDischarge * 100) / 100,
        netBalance: Math.round((totalDailyCharge - totalDailyDischarge) * 100) / 100,
        chargingHours: chargingHours.length,
        dischargingHours: dischargingHours.length
      },
      insights: generateDailyInsights(hourlyProfile, peakDischargeHour, peakChargeHour)
    };
    
  } catch (error) {
    log.error('Daily pattern analysis failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Generate insights from daily patterns
 */
function generateDailyInsights(hourlyProfile, peakDischarge, peakCharge) {
  const insights = [];
  
  if (peakDischarge) {
    const timeOfDay = peakDischarge.hour < 12 ? 'morning' : peakDischarge.hour < 18 ? 'afternoon' : 'evening';
    insights.push(`Peak energy consumption occurs in the ${timeOfDay} around ${peakDischarge.hour}:00.`);
  }
  
  if (peakCharge) {
    insights.push(`Maximum solar charging typically occurs around ${peakCharge.hour}:00.`);
  }
  
  // Check for nighttime discharge patterns
  const nightHours = hourlyProfile.filter(h => h.hour >= 22 || h.hour <= 6);
  const avgNightDischarge = nightHours.reduce((sum, h) => sum + Math.abs(Math.min(0, h.avgCurrent)), 0) / nightHours.length;
  
  if (avgNightDischarge > 5) {
    insights.push('Significant nighttime energy consumption detected. Consider reducing loads during sleeping hours.');
  }
  
  return insights;
}

/**
 * Analyze weekly patterns (weekday vs weekend)
 */
async function analyzeWeeklyPatterns(systemId, timeRange = '30d', log) {
  log.info('Analyzing weekly patterns', { systemId, timeRange });
  
  try {
    const days = parseTimeRange(timeRange);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const historyCollection = await getCollection('history');
    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: startDate.toISOString() },
        'analysis.current': { $exists: true }
      })
      .sort({ timestamp: 1 })
      .toArray();
    
    if (records.length < 7 * 24) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient data for weekly pattern analysis. Need at least 1 week of data.`,
        systemId
      };
    }
    
    // Separate weekday vs weekend data
    const weekdayData = [];
    const weekendData = [];
    
    for (const record of records) {
      const date = new Date(record.timestamp);
      const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
      
      const dataPoint = {
        current: record.analysis.current || 0,
        power: record.analysis.power || 0
      };
      
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekendData.push(dataPoint);
      } else {
        weekdayData.push(dataPoint);
      }
    }
    
    // Calculate averages
    const weekdayAvg = weekdayData.length > 0
      ? weekdayData.reduce((sum, d) => sum + Math.abs(d.current), 0) / weekdayData.length
      : 0;
    
    const weekendAvg = weekendData.length > 0
      ? weekendData.reduce((sum, d) => sum + Math.abs(d.current), 0) / weekendData.length
      : 0;
    
    const difference = Math.abs(weekendAvg - weekdayAvg);
    const percentDifference = weekdayAvg > 0 
      ? Math.round((difference / weekdayAvg) * 100)
      : 0;
    
    return {
      systemId,
      patternType: 'weekly',
      timeRange: `${days} days`,
      weekdayUsage: {
        avgCurrent: Math.round(weekdayAvg * 100) / 100,
        samples: weekdayData.length
      },
      weekendUsage: {
        avgCurrent: Math.round(weekendAvg * 100) / 100,
        samples: weekendData.length
      },
      comparison: {
        difference: Math.round(difference * 100) / 100,
        percentDifference,
        pattern: weekendAvg > weekdayAvg 
          ? `${percentDifference}% higher usage on weekends`
          : weekdayAvg > weekendAvg
            ? `${percentDifference}% higher usage on weekdays`
            : 'Similar usage patterns throughout the week'
      },
      insight: percentDifference > 20
        ? 'Significant difference between weekday and weekend usage detected. Consider this in energy planning.'
        : 'Consistent usage patterns throughout the week.'
    };
    
  } catch (error) {
    log.error('Weekly pattern analysis failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Analyze seasonal patterns (monthly trends)
 */
async function analyzeSeasonalPatterns(systemId, timeRange = '90d', log) {
  log.info('Analyzing seasonal patterns', { systemId, timeRange });
  
  try {
    const days = Math.max(90, parseTimeRange(timeRange)); // Minimum 90 days for seasonal
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const historyCollection = await getCollection('history');
    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: startDate.toISOString() },
        'analysis.current': { $exists: true },
        'analysis.stateOfCharge': { $exists: true }
      })
      .sort({ timestamp: 1 })
      .toArray();
    
    if (records.length < 90) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient data for seasonal analysis. Need at least 90 days of data.`,
        systemId
      };
    }
    
    // Group by month
    const monthlyData = {};
    
    for (const record of records) {
      const date = new Date(record.timestamp);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          samples: [],
          month: monthKey
        };
      }
      
      monthlyData[monthKey].samples.push({
        current: record.analysis.current || 0,
        soc: record.analysis.stateOfCharge || 0,
        temperature: record.analysis.temperature || null
      });
    }
    
    // Calculate monthly averages
    const monthlyTrends = Object.entries(monthlyData).map(([month, data]) => {
      const avgCurrent = data.samples.reduce((sum, s) => sum + Math.abs(s.current), 0) / data.samples.length;
      const avgSoC = data.samples.reduce((sum, s) => sum + s.soc, 0) / data.samples.length;
      const avgTemp = data.samples.filter(s => s.temperature !== null).length > 0
        ? data.samples.filter(s => s.temperature !== null).reduce((sum, s) => sum + s.temperature, 0) / 
          data.samples.filter(s => s.temperature !== null).length
        : null;
      
      return {
        month,
        avgUsage: Math.round(avgCurrent * 100) / 100,
        avgSoC: Math.round(avgSoC * 100) / 100,
        avgTemperature: avgTemp ? Math.round(avgTemp * 10) / 10 : null,
        samples: data.samples.length
      };
    }).sort((a, b) => a.month.localeCompare(b.month));
    
    // Identify trend
    const firstMonth = monthlyTrends[0];
    const lastMonth = monthlyTrends[monthlyTrends.length - 1];
    const usageChange = lastMonth.avgUsage - firstMonth.avgUsage;
    const percentChange = firstMonth.avgUsage > 0
      ? Math.round((usageChange / firstMonth.avgUsage) * 100)
      : 0;
    
    return {
      systemId,
      patternType: 'seasonal',
      timeRange: `${days} days`,
      monthlyTrends,
      overallTrend: {
        direction: usageChange > 0.5 ? 'increasing' : usageChange < -0.5 ? 'decreasing' : 'stable',
        change: Math.round(usageChange * 100) / 100,
        percentChange
      },
      insight: Math.abs(percentChange) > 15
        ? `Usage has ${usageChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(percentChange)}% over the analysis period.`
        : 'Usage patterns are relatively stable across seasons.'
    };
    
  } catch (error) {
    log.error('Seasonal pattern analysis failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Detect anomalies in battery usage using statistical methods
 */
async function detectAnomalies(systemId, timeRange = '30d', log) {
  log.info('Detecting anomalies', { systemId, timeRange });
  
  try {
    const days = parseTimeRange(timeRange);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const historyCollection = await getCollection('history');
    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: startDate.toISOString() },
        'analysis.current': { $exists: true },
        'analysis.temperature': { $exists: true }
      })
      .sort({ timestamp: 1 })
      .toArray();
    
    if (records.length < 100) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient data for anomaly detection. Need at least 100 data points.`,
        systemId
      };
    }
    
    // Extract metrics
    const currentValues = records.map(r => r.analysis.current || 0);
    const tempValues = records.map(r => r.analysis.temperature || 0).filter(t => t > 0);
    const socValues = records.map(r => r.analysis.stateOfCharge || 0).filter(s => s > 0);
    
    // Calculate statistics
    const currentStats = calculateStats(currentValues);
    const tempStats = tempValues.length > 0 ? calculateStats(tempValues) : null;
    const socStats = socValues.length > 0 ? calculateStats(socValues) : null;
    
    // Detect anomalies (values beyond 2.5 standard deviations)
    const anomalies = [];
    const threshold = 2.5;
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const current = record.analysis.current || 0;
      const temp = record.analysis.temperature || 0;
      const soc = record.analysis.stateOfCharge || 0;
      
      // Check for current anomalies
      if (Math.abs(current - currentStats.mean) > threshold * currentStats.stdDev) {
        anomalies.push({
          timestamp: record.timestamp,
          type: 'current',
          value: Math.round(current * 100) / 100,
          expected: Math.round(currentStats.mean * 100) / 100,
          deviation: Math.round(Math.abs(current - currentStats.mean) / currentStats.stdDev * 10) / 10,
          severity: Math.abs(current - currentStats.mean) > 3 * currentStats.stdDev ? 'high' : 'medium'
        });
      }
      
      // Check for temperature anomalies
      if (tempStats && temp > 0 && Math.abs(temp - tempStats.mean) > threshold * tempStats.stdDev) {
        anomalies.push({
          timestamp: record.timestamp,
          type: 'temperature',
          value: Math.round(temp * 10) / 10,
          expected: Math.round(tempStats.mean * 10) / 10,
          deviation: Math.round(Math.abs(temp - tempStats.mean) / tempStats.stdDev * 10) / 10,
          severity: Math.abs(temp - tempStats.mean) > 3 * tempStats.stdDev ? 'high' : 'medium'
        });
      }
    }
    
    // Sort by severity and timestamp
    anomalies.sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity === 'high' ? -1 : 1;
      }
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // Limit to top 20 most recent anomalies
    const topAnomalies = anomalies.slice(0, 20);
    
    log.info('Anomaly detection completed', {
      systemId,
      totalAnomalies: anomalies.length,
      highSeverity: anomalies.filter(a => a.severity === 'high').length
    });
    
    return {
      systemId,
      patternType: 'anomalies',
      timeRange: `${days} days`,
      dataPoints: records.length,
      statistics: {
        current: {
          mean: Math.round(currentStats.mean * 100) / 100,
          stdDev: Math.round(currentStats.stdDev * 100) / 100,
          min: Math.round(currentStats.min * 100) / 100,
          max: Math.round(currentStats.max * 100) / 100
        },
        temperature: tempStats ? {
          mean: Math.round(tempStats.mean * 10) / 10,
          stdDev: Math.round(tempStats.stdDev * 10) / 10,
          min: Math.round(tempStats.min * 10) / 10,
          max: Math.round(tempStats.max * 10) / 10
        } : null
      },
      anomaliesDetected: topAnomalies.length,
      anomalies: topAnomalies,
      summary: {
        total: anomalies.length,
        highSeverity: anomalies.filter(a => a.severity === 'high').length,
        currentAnomalies: anomalies.filter(a => a.type === 'current').length,
        temperatureAnomalies: anomalies.filter(a => a.type === 'temperature').length
      },
      insight: topAnomalies.length === 0
        ? 'No significant anomalies detected. System operating within normal parameters.'
        : `${topAnomalies.length} anomalies detected. Review ${anomalies.filter(a => a.severity === 'high').length} high severity events.`
    };
    
  } catch (error) {
    log.error('Anomaly detection failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Calculate statistics (mean, std dev, min, max)
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

module.exports = {
  analyzeDailyPatterns,
  analyzeWeeklyPatterns,
  analyzeSeasonalPatterns,
  detectAnomalies
};
