/**
 * Comprehensive Analytics Module - Deep Battery System Insights
 * 
 * This module extracts EVERY meaningful insight from BMS data:
 * - Load profiling (day vs night, weekday vs weekend)
 * - Charging efficiency and solar performance
 * - Battery health indicators (degradation, imbalance, temperature)
 * - Usage patterns and anomaly detection
 * - Predictive forecasts and trend analysis
 * - Energy balance and autonomy calculations
 * 
 * Goal: Feed Gemini a complete analytical picture so it can generate
 * truly insightful recommendations without needing additional tool calls.
 * 
 * @module netlify/functions/utils/comprehensive-analytics
 */

const { getCollection } = require('./mongodb.cjs');

/**
 * Generate comprehensive analytics for a battery system
 * This is the "beef up context" function that calculates EVERYTHING
 */
async function generateComprehensiveAnalytics(systemId, analysisData, log) {
  log.info('Generating comprehensive analytics', { systemId });

  const analytics = {
    metadata: {
      systemId,
      generatedAt: new Date().toISOString(),
      analysisVersion: '2.0-comprehensive'
    },
    
    // Core system state
    currentState: null,
    
    // Load analysis
    loadProfile: null,
    
    // Energy balance
    energyBalance: null,
    
    // Solar performance
    solarPerformance: null,
    
    // Battery health
    batteryHealth: null,
    
    // Usage patterns
    usagePatterns: null,
    
    // Trends and forecasts
    trends: null,
    
    // Anomalies and alerts
    anomalies: null,
    
    // Weather correlation
    weatherImpact: null,
    
    // Recommendations context
    recommendationContext: null
  };

  try {
    // Get system profile
    const systemsCollection = await getCollection('systems');
    const system = await systemsCollection.findOne({ id: systemId });
    
    // Get historical data (90 days for comprehensive analysis)
    const historyCollection = await getCollection('history');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: ninetyDaysAgo.toISOString() }
      })
      .sort({ timestamp: 1 })
      .toArray();
    
    log.info('Historical data loaded', { 
      systemId, 
      recordCount: records.length,
      dateRange: records.length > 0 ? {
        start: records[0].timestamp,
        end: records[records.length - 1].timestamp
      } : null
    });

    // Extract current state from latest data
    analytics.currentState = extractCurrentState(analysisData, records, system);
    
    // Analyze load patterns (day/night, weekday/weekend)
    analytics.loadProfile = await analyzeLoadProfile(records, system, log);
    
    // Calculate comprehensive energy balance
    analytics.energyBalance = await calculateEnergyBalance(records, system, analytics.currentState, log);
    
    // Analyze solar performance with irradiance correlation
    analytics.solarPerformance = await analyzeSolarPerformance(records, system, log);
    
    // Assess battery health (degradation, imbalance, temperature)
    analytics.batteryHealth = await assessBatteryHealth(records, system, analysisData, log);
    
    // Identify usage patterns and cycles
    analytics.usagePatterns = await identifyUsagePatterns(records, log);
    
    // Calculate trends and forecasts
    analytics.trends = await calculateTrends(records, system, log);
    
    // Detect anomalies and analyze alerts
    analytics.anomalies = await detectAnomalies(records, log);
    
    // Correlate with weather data
    analytics.weatherImpact = await analyzeWeatherImpact(records, system, log);
    
    // Build recommendation context
    analytics.recommendationContext = buildRecommendationContext(analytics, system);
    
    log.info('Comprehensive analytics complete', {
      systemId,
      dataPoints: records.length,
      sections: Object.keys(analytics).filter(k => analytics[k] !== null).length
    });
    
    return analytics;
    
  } catch (error) {
    log.error('Comprehensive analytics failed', {
      error: error.message,
      stack: error.stack,
      systemId
    });
    throw error;
  }
}

/**
 * Extract current system state from latest measurements
 */
function extractCurrentState(analysisData, records, system) {
  const latest = records.length > 0 ? records[records.length - 1] : null;
  const a = analysisData || latest?.analysis || {};
  
  const voltage = a.overallVoltage || system?.voltage || 48;
  const current = a.current || 0;
  const power = a.power || (voltage * current);
  const soc = a.stateOfCharge || 0;
  const remainingAh = a.remainingCapacity || 0;
  const fullCapacityAh = a.fullCapacity || system?.capacity || 0;
  const remainingKwh = (remainingAh * voltage) / 1000;
  const fullCapacityKwh = (fullCapacityAh * voltage) / 1000;
  
  // Determine operational mode
  let mode = 'idle';
  let modeDescription = 'Battery is idle (minimal current flow)';
  
  if (current > 0.5) {
    mode = 'charging';
    modeDescription = `Charging at ${Math.abs(current).toFixed(1)}A (${Math.abs(power).toFixed(0)}W)`;
  } else if (current < -0.5) {
    mode = 'discharging';
    modeDescription = `Discharging at ${Math.abs(current).toFixed(1)}A (${Math.abs(power).toFixed(0)}W)`;
  }
  
  // Calculate runtime at current load
  let runtimeHours = null;
  let runtimeDescription = null;
  
  if (current < -0.5) {
    // Discharging - calculate time until empty
    runtimeHours = (remainingAh * 0.8) / Math.abs(current); // 80% DoD
    const days = Math.floor(runtimeHours / 24);
    const hours = Math.round(runtimeHours % 24);
    runtimeDescription = days > 0 
      ? `${days}d ${hours}h until empty at current ${Math.abs(current).toFixed(1)}A load`
      : `${Math.round(runtimeHours)}h until empty at current load`;
  }
  
  return {
    timestamp: a.timestamp || latest?.timestamp || new Date().toISOString(),
    voltage: roundTo(voltage, 2),
    current: roundTo(current, 2),
    power: roundTo(power, 1),
    soc: roundTo(soc, 1),
    remainingAh: roundTo(remainingAh, 1),
    remainingKwh: roundTo(remainingKwh, 2),
    fullCapacityAh: roundTo(fullCapacityAh, 1),
    fullCapacityKwh: roundTo(fullCapacityKwh, 2),
    mode,
    modeDescription,
    runtimeHours: runtimeHours ? roundTo(runtimeHours, 1) : null,
    runtimeDescription,
    temperature: a.temperature ? roundTo(a.temperature, 1) : null,
    cellVoltageDiff: a.cellVoltageDifference ? roundTo(a.cellVoltageDifference * 1000, 1) : null,
    cycleCount: a.cycleCount || null,
    alerts: a.alerts || []
  };
}

/**
 * Analyze load profile - when and how energy is consumed
 */
async function analyzeLoadProfile(records, system, log) {
  if (records.length < 24) {
    return { insufficient_data: true, message: 'Need at least 24 hours of data for load profiling' };
  }
  
  const hourlyLoads = Array(24).fill(0).map(() => ({ samples: 0, totalWatts: 0 }));
  const dayOfWeekLoads = Array(7).fill(0).map(() => ({ samples: 0, totalWatts: 0 }));
  
  let nighttimeLoad = { samples: 0, totalWatts: 0, totalAh: 0 };
  let daytimeLoad = { samples: 0, totalWatts: 0, totalAh: 0 };
  
  const voltage = system?.voltage || 48;
  
  for (const record of records) {
    const timestamp = new Date(record.timestamp);
    const hour = timestamp.getHours();
    const dayOfWeek = timestamp.getDay();
    const current = record.analysis?.current || 0;
    const power = record.analysis?.power || (current * voltage);
    
    // Only count discharge (negative current)
    if (current < -0.5) {
      const watts = Math.abs(power);
      const amps = Math.abs(current);
      
      hourlyLoads[hour].samples++;
      hourlyLoads[hour].totalWatts += watts;
      
      dayOfWeekLoads[dayOfWeek].samples++;
      dayOfWeekLoads[dayOfWeek].totalWatts += watts;
      
      // Night: 6 PM to 6 AM
      if (hour >= 18 || hour < 6) {
        nighttimeLoad.samples++;
        nighttimeLoad.totalWatts += watts;
        nighttimeLoad.totalAh += amps;
      } else {
        daytimeLoad.samples++;
        daytimeLoad.totalWatts += watts;
        daytimeLoad.totalAh += amps;
      }
    }
  }
  
  // Calculate averages
  const hourlyProfile = hourlyLoads.map((h, hour) => ({
    hour,
    avgWatts: h.samples > 0 ? roundTo(h.totalWatts / h.samples, 1) : 0,
    samples: h.samples
  }));
  
  const weekdayProfile = dayOfWeekLoads.map((d, day) => ({
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
    avgWatts: d.samples > 0 ? roundTo(d.totalWatts / d.samples, 1) : 0,
    samples: d.samples
  }));
  
  // Find peak load times
  const peakHour = hourlyProfile.reduce((max, curr) => 
    curr.avgWatts > max.avgWatts ? curr : max, hourlyProfile[0]);
  
  const peakDay = weekdayProfile.reduce((max, curr) => 
    curr.avgWatts > max.avgWatts ? curr : max, weekdayProfile[0]);
  
  // Night vs day comparison
  const avgNightWatts = nighttimeLoad.samples > 0 
    ? roundTo(nighttimeLoad.totalWatts / nighttimeLoad.samples, 1) 
    : 0;
  const avgDayWatts = daytimeLoad.samples > 0 
    ? roundTo(daytimeLoad.totalWatts / daytimeLoad.samples, 1) 
    : 0;
  
  // Calculate night vs day energy consumption (kWh per typical period)
  const avgNightKwh = nighttimeLoad.samples > 0
    ? roundTo((nighttimeLoad.totalWatts / nighttimeLoad.samples) * 12 / 1000, 2) // 12h night
    : 0;
  const avgDayKwh = daytimeLoad.samples > 0
    ? roundTo((daytimeLoad.totalWatts / daytimeLoad.samples) * 12 / 1000, 2) // 12h day
    : 0;
  
  return {
    hourlyProfile,
    weekdayProfile,
    peakLoadHour: peakHour.hour,
    peakLoadWatts: peakHour.avgWatts,
    peakLoadDay: peakDay.day,
    nightVsDay: {
      nightAvgWatts: avgNightWatts,
      dayAvgWatts: avgDayWatts,
      nightKwh: avgNightKwh,
      dayKwh: avgDayKwh,
      nightDominant: avgNightWatts > avgDayWatts,
      interpretation: avgNightWatts > avgDayWatts * 1.5
        ? 'Heavy nighttime loads - consider load shifting to daylight hours when solar is available'
        : avgDayWatts > avgNightWatts * 1.5
          ? 'Heavy daytime loads - good for solar utilization but may reduce net charging'
          : 'Balanced day/night load distribution'
    },
    baseload: {
      estimatedWatts: Math.min(...hourlyProfile.filter(h => h.samples > 0).map(h => h.avgWatts)),
      description: 'Minimum continuous load (refrigeration, standby power, etc.)'
    }
  };
}

/**
 * Calculate comprehensive energy balance with kWh standardization
 */
async function calculateEnergyBalance(records, system, currentState, log) {
  if (records.length < 48) {
    return { insufficient_data: true, message: 'Need at least 48 hours for energy balance' };
  }
  
  const voltage = system?.voltage || currentState?.voltage || 48;
  
  // Group by day for daily energy calculations
  const dailyData = {};
  
  for (let i = 0; i < records.length - 1; i++) {
    const current = records[i];
    const next = records[i + 1];
    
    const date = new Date(current.timestamp).toISOString().split('T')[0];
    const power = current.analysis?.power || 0;
    const currentA = current.analysis?.current || 0;
    
    // Time delta in hours
    const timeDelta = (new Date(next.timestamp) - new Date(current.timestamp)) / (1000 * 60 * 60);
    
    if (timeDelta > 0 && timeDelta < 2) { // Filter outliers
      if (!dailyData[date]) {
        dailyData[date] = {
          generationKwh: 0,
          consumptionKwh: 0,
          generationAh: 0,
          consumptionAh: 0,
          samples: 0
        };
      }
      
      const energyKwh = Math.abs(power) * timeDelta / 1000; // kWh
      const energyAh = Math.abs(currentA) * timeDelta; // Ah
      
      if (power > 0 || currentA > 0) {
        dailyData[date].generationKwh += energyKwh;
        dailyData[date].generationAh += energyAh;
      } else if (power < 0 || currentA < 0) {
        dailyData[date].consumptionKwh += energyKwh;
        dailyData[date].consumptionAh += energyAh;
      }
      
      dailyData[date].samples++;
    }
  }
  
  const dailyEntries = Object.entries(dailyData).map(([date, data]) => ({
    date,
    generationKwh: roundTo(data.generationKwh, 2),
    consumptionKwh: roundTo(data.consumptionKwh, 2),
    netKwh: roundTo(data.generationKwh - data.consumptionKwh, 2),
    generationAh: roundTo(data.generationAh, 1),
    consumptionAh: roundTo(data.consumptionAh, 1),
    netAh: roundTo(data.generationAh - data.consumptionAh, 1),
    samples: data.samples
  }));
  
  // Calculate averages
  const avgDailyGenKwh = roundTo(
    dailyEntries.reduce((sum, d) => sum + d.generationKwh, 0) / dailyEntries.length, 
    2
  );
  const avgDailyConsKwh = roundTo(
    dailyEntries.reduce((sum, d) => sum + d.consumptionKwh, 0) / dailyEntries.length,
    2
  );
  const avgDailyNetKwh = roundTo(avgDailyGenKwh - avgDailyConsKwh, 2);
  
  // Solar sufficiency
  const solarSufficiency = avgDailyConsKwh > 0
    ? roundTo((avgDailyGenKwh / avgDailyConsKwh) * 100, 1)
    : 0;
  
  // Days with deficit
  const deficitDays = dailyEntries.filter(d => d.netKwh < -0.1);
  const surplusDays = dailyEntries.filter(d => d.netKwh > 0.1);
  
  // Battery autonomy calculation (CORRECTED)
  const batteryCapacityKwh = currentState?.fullCapacityKwh || 0;
  const avgLoadWatts = (avgDailyConsKwh * 1000) / 24; // Average load in watts
  
  const autonomyHours = batteryCapacityKwh > 0 && avgLoadWatts > 0
    ? roundTo((batteryCapacityKwh * 1000 * 0.8) / avgLoadWatts, 1) // 80% DoD
    : null;
  const autonomyDays = autonomyHours ? roundTo(autonomyHours / 24, 1) : null;
  
  return {
    dailyAverages: {
      generationKwh: avgDailyGenKwh,
      consumptionKwh: avgDailyConsKwh,
      netKwh: avgDailyNetKwh,
      solarSufficiency: solarSufficiency,
      sufficiencyStatus: solarSufficiency >= 100 ? 'surplus' : solarSufficiency >= 80 ? 'adequate' : 'deficit'
    },
    dailyBreakdown: dailyEntries.slice(-30), // Last 30 days
    deficitAnalysis: {
      deficitDays: deficitDays.length,
      surplusDays: surplusDays.length,
      avgDeficitKwh: deficitDays.length > 0 
        ? roundTo(deficitDays.reduce((sum, d) => sum + Math.abs(d.netKwh), 0) / deficitDays.length, 2)
        : 0,
      avgSurplusKwh: surplusDays.length > 0
        ? roundTo(surplusDays.reduce((sum, d) => sum + d.netKwh, 0) / surplusDays.length, 2)
        : 0
    },
    autonomy: {
      hours: autonomyHours,
      days: autonomyDays,
      calculation: `${batteryCapacityKwh} kWh battery ÷ ${roundTo(avgLoadWatts, 0)}W avg load × 0.8 DoD = ${autonomyHours}h (${autonomyDays} days)`,
      context: 'This is RUNTIME until battery depletes at current load. NOT the service life (years until replacement).'
    }
  };
}

/**
 * Analyze solar performance with expected vs actual comparison
 */
async function analyzeSolarPerformance(records, system, log) {
  if (records.length < 24 || !system?.maxAmpsSolarCharging) {
    return { 
      insufficient_data: true, 
      message: 'Need solar configuration and 24+ hours of data for solar analysis'
    };
  }
  
  const voltage = system.voltage || 48;
  const maxSolarAmps = system.maxAmpsSolarCharging;
  const maxSolarWatts = maxSolarAmps * voltage;
  
  // Extract charging periods
  const chargingPeriods = [];
  let currentPeriod = null;
  
  for (const record of records) {
    const current = record.analysis?.current || 0;
    const timestamp = new Date(record.timestamp);
    const hour = timestamp.getHours();
    
    // Solar hours: 6 AM to 6 PM
    const isSolarHours = hour >= 6 && hour < 18;
    
    if (current > 0.5 && isSolarHours) {
      if (!currentPeriod) {
        currentPeriod = {
          start: timestamp,
          end: timestamp,
          samples: [],
          totalAh: 0
        };
      }
      
      currentPeriod.end = timestamp;
      currentPeriod.samples.push({
        timestamp,
        current,
        power: record.analysis?.power || (current * voltage)
      });
    } else if (currentPeriod) {
      // End of charging period
      if (currentPeriod.samples.length >= 2) {
        chargingPeriods.push(currentPeriod);
      }
      currentPeriod = null;
    }
  }
  
  // Analyze charging periods
  let totalChargeKwh = 0;
  let totalChargeHours = 0;
  let peakChargingWatts = 0;
  
  for (const period of chargingPeriods) {
    const durationHours = (period.end - period.start) / (1000 * 60 * 60);
    const avgCurrent = period.samples.reduce((sum, s) => sum + s.current, 0) / period.samples.length;
    const avgPower = period.samples.reduce((sum, s) => sum + s.power, 0) / period.samples.length;
    const energyKwh = (avgPower * durationHours) / 1000;
    
    totalChargeKwh += energyKwh;
    totalChargeHours += durationHours;
    peakChargingWatts = Math.max(peakChargingWatts, ...period.samples.map(s => s.power));
  }
  
  const avgDailyChargeKwh = chargingPeriods.length > 0
    ? roundTo(totalChargeKwh / (chargingPeriods.length / 2), 2) // Rough daily estimate
    : 0;
  
  // Expected solar (rough estimate: 5 peak sun hours)
  const expectedDailySolarKwh = roundTo((maxSolarWatts * 5) / 1000, 2);
  
  // Performance ratio
  const performanceRatio = expectedDailySolarKwh > 0
    ? roundTo((avgDailyChargeKwh / expectedDailySolarKwh) * 100, 1)
    : 0;
  
  return {
    maxSolarCapacity: {
      watts: maxSolarWatts,
      amps: maxSolarAmps
    },
    actualPerformance: {
      avgDailyKwh: avgDailyChargeKwh,
      peakWatts: roundTo(peakChargingWatts, 0),
      avgChargingHoursPerDay: chargingPeriods.length > 0 
        ? roundTo(totalChargeHours / (chargingPeriods.length / 2), 1)
        : 0
    },
    expectedPerformance: {
      dailyKwh: expectedDailySolarKwh,
      note: 'Based on 5 peak sun hours (typical average)'
    },
    performanceRatio: {
      percent: performanceRatio,
      status: performanceRatio >= 80 ? 'excellent' : performanceRatio >= 60 ? 'good' : performanceRatio >= 40 ? 'fair' : 'poor',
      context: 'Performance ratio accounts for weather, shading, panel degradation, and charging efficiency'
    }
  };
}

/**
 * Assess battery health indicators
 */
async function assessBatteryHealth(records, system, analysisData, log) {
  if (records.length < 10) {
    return { insufficient_data: true, message: 'Need more data for health assessment' };
  }
  
  const a = analysisData || records[records.length - 1]?.analysis || {};
  const voltage = system?.voltage || a.overallVoltage || 48;
  
  // Cell imbalance tracking
  const imbalanceReadings = records
    .filter(r => r.analysis?.cellVoltageDifference != null)
    .map(r => ({
      timestamp: r.timestamp,
      diffMv: r.analysis.cellVoltageDifference * 1000
    }));
  
  const avgImbalanceMv = imbalanceReadings.length > 0
    ? roundTo(imbalanceReadings.reduce((sum, r) => sum + r.diffMv, 0) / imbalanceReadings.length, 1)
    : null;
  
  const maxImbalanceMv = imbalanceReadings.length > 0
    ? roundTo(Math.max(...imbalanceReadings.map(r => r.diffMv)), 1)
    : null;
  
  const currentImbalanceMv = a.cellVoltageDifference 
    ? roundTo(a.cellVoltageDifference * 1000, 1)
    : null;
  
  const imbalanceStatus = !currentImbalanceMv ? 'unknown'
    : currentImbalanceMv < 30 ? 'excellent'
    : currentImbalanceMv < 50 ? 'good'
    : currentImbalanceMv < 100 ? 'fair'
    : 'poor';
  
  // Temperature tracking
  const tempReadings = records
    .filter(r => r.analysis?.temperature != null)
    .map(r => ({
      timestamp: r.timestamp,
      temp: r.analysis.temperature
    }));
  
  const avgTemp = tempReadings.length > 0
    ? roundTo(tempReadings.reduce((sum, r) => sum + r.temp, 0) / tempReadings.length, 1)
    : null;
  
  const maxTemp = tempReadings.length > 0
    ? roundTo(Math.max(...tempReadings.map(r => r.temp)), 1)
    : null;
  
  const minTemp = tempReadings.length > 0
    ? roundTo(Math.min(...tempReadings.map(r => r.temp)), 1)
    : null;
  
  const currentTemp = a.temperature ? roundTo(a.temperature, 1) : null;
  
  const tempStatus = !currentTemp ? 'unknown'
    : currentTemp < 0 || currentTemp > 45 ? 'critical'
    : currentTemp < 5 || currentTemp > 35 ? 'warning'
    : 'normal';
  
  // Capacity retention (high-SOC measurements only)
  const highSocRecords = records.filter(r => {
    const soc = r.analysis?.stateOfCharge;
    return soc != null && soc >= 80 && r.analysis?.remainingCapacity;
  });
  
  const ratedCapacity = system?.capacity || a.fullCapacity || null;
  
  let capacityTrend = null;
  if (highSocRecords.length >= 10 && ratedCapacity) {
    const retentions = highSocRecords.map(r => {
      const remaining = r.analysis.remainingCapacity;
      return (remaining / ratedCapacity) * 100;
    });
    
    const avgRetention = roundTo(retentions.reduce((sum, r) => sum + r, 0) / retentions.length, 1);
    const currentRetention = retentions[retentions.length - 1];
    const firstRetention = retentions[0];
    const retentionChange = roundTo(currentRetention - firstRetention, 2);
    
    capacityTrend = {
      currentRetention: roundTo(currentRetention, 1),
      avgRetention,
      changeOverPeriod: retentionChange,
      status: avgRetention >= 95 ? 'excellent'
        : avgRetention >= 90 ? 'good'
        : avgRetention >= 85 ? 'fair'
        : avgRetention >= 80 ? 'aging'
        : 'degraded',
      context: 'Capacity retention below 80% typically indicates replacement needed'
    };
  }
  
  // Cycle count
  const cycleCount = a.cycleCount || null;
  const chemistry = (a.chemistry || system?.chemistry || '').toLowerCase();
  const isLiFePO4 = chemistry.includes('lifepo4');
  
  let cycleLifeStatus = null;
  if (cycleCount != null) {
    const expectedLife = isLiFePO4 ? 3000 : 1000;
    const percentUsed = roundTo((cycleCount / expectedLife) * 100, 1);
    
    cycleLifeStatus = {
      cycles: cycleCount,
      expectedLifeCycles: expectedLife,
      percentUsed,
      status: percentUsed < 20 ? 'new'
        : percentUsed < 50 ? 'early-life'
        : percentUsed < 75 ? 'mid-life'
        : percentUsed < 90 ? 'mature'
        : 'end-of-life',
      context: `${isLiFePO4 ? 'LiFePO4' : 'Lithium-ion'} batteries typically last ${expectedLife} cycles`
    };
  }
  
  return {
    cellImbalance: {
      currentMv: currentImbalanceMv,
      avgMv: avgImbalanceMv,
      maxMv: maxImbalanceMv,
      status: imbalanceStatus,
      context: 'Cell imbalance >50mV may indicate balancing issues. >100mV suggests replacement needed.'
    },
    temperature: {
      currentC: currentTemp,
      avgC: avgTemp,
      minC: minTemp,
      maxC: maxTemp,
      status: tempStatus,
      context: 'Optimal temperature: 15-25°C. Below 0°C or above 45°C damages cells.'
    },
    capacityRetention: capacityTrend || {
      insufficient_data: true,
      message: 'Need more high-SOC measurements for capacity tracking'
    },
    cycleLife: cycleLifeStatus || {
      unknown: true,
      message: 'Cycle count not available from BMS'
    },
    overallHealth: {
      score: calculateHealthScore(imbalanceStatus, tempStatus, capacityTrend, cycleLifeStatus),
      recommendation: generateHealthRecommendation(imbalanceStatus, tempStatus, capacityTrend, cycleLifeStatus)
    }
  };
}

/**
 * Calculate overall health score
 */
function calculateHealthScore(imbalanceStatus, tempStatus, capacityTrend, cycleLifeStatus) {
  let score = 100;
  
  // Imbalance penalties
  if (imbalanceStatus === 'poor') score -= 20;
  else if (imbalanceStatus === 'fair') score -= 10;
  else if (imbalanceStatus === 'good') score -= 5;
  
  // Temperature penalties
  if (tempStatus === 'critical') score -= 30;
  else if (tempStatus === 'warning') score -= 15;
  
  // Capacity penalties
  if (capacityTrend?.status === 'degraded') score -= 30;
  else if (capacityTrend?.status === 'aging') score -= 15;
  else if (capacityTrend?.status === 'fair') score -= 10;
  
  // Cycle life penalties
  if (cycleLifeStatus?.status === 'end-of-life') score -= 20;
  else if (cycleLifeStatus?.status === 'mature') score -= 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate health recommendation
 */
function generateHealthRecommendation(imbalanceStatus, tempStatus, capacityTrend, cycleLifeStatus) {
  const issues = [];
  
  if (imbalanceStatus === 'poor') {
    issues.push('CRITICAL: Cell imbalance >100mV - battery may need replacement');
  } else if (imbalanceStatus === 'fair') {
    issues.push('WARNING: Cell imbalance increasing - monitor closely');
  }
  
  if (tempStatus === 'critical') {
    issues.push('CRITICAL: Temperature outside safe range - check ventilation and thermal management');
  } else if (tempStatus === 'warning') {
    issues.push('WARNING: Temperature suboptimal - consider environmental controls');
  }
  
  if (capacityTrend?.status === 'degraded') {
    issues.push('CRITICAL: Capacity below 80% - plan for battery replacement soon');
  } else if (capacityTrend?.status === 'aging') {
    issues.push('WARNING: Capacity declining - budget for replacement within 6-12 months');
  }
  
  if (cycleLifeStatus?.status === 'end-of-life') {
    issues.push('INFO: Battery approaching end of rated cycle life - monitor capacity closely');
  }
  
  return issues.length > 0 
    ? issues.join('; ')
    : 'Battery health is good - no immediate concerns';
}

/**
 * Identify usage patterns and cycles
 */
async function identifyUsagePatterns(records, log) {
  if (records.length < 72) {
    return { insufficient_data: true, message: 'Need at least 3 days for pattern identification' };
  }
  
  // Identify charging/discharging cycles
  const cycles = [];
  let currentCycle = null;
  
  for (const record of records) {
    const current = record.analysis?.current || 0;
    const soc = record.analysis?.stateOfCharge || 0;
    
    const isCharging = current > 0.5;
    const isDischarging = current < -0.5;
    
    if (isCharging && (!currentCycle || currentCycle.type !== 'charge')) {
      if (currentCycle) cycles.push(currentCycle);
      currentCycle = {
        type: 'charge',
        start: record.timestamp,
        startSoc: soc,
        samples: 1,
        peakCurrent: current
      };
    } else if (isDischarging && (!currentCycle || currentCycle.type !== 'discharge')) {
      if (currentCycle) cycles.push(currentCycle);
      currentCycle = {
        type: 'discharge',
        start: record.timestamp,
        startSoc: soc,
        samples: 1,
        peakCurrent: Math.abs(current)
      };
    } else if (currentCycle) {
      currentCycle.samples++;
      currentCycle.end = record.timestamp;
      currentCycle.endSoc = soc;
      if (currentCycle.type === 'charge') {
        currentCycle.peakCurrent = Math.max(currentCycle.peakCurrent, current);
      } else {
        currentCycle.peakCurrent = Math.max(currentCycle.peakCurrent, Math.abs(current));
      }
    }
  }
  
  if (currentCycle) cycles.push(currentCycle);
  
  // Calculate cycle statistics
  const chargeCycles = cycles.filter(c => c.type === 'charge' && c.endSoc);
  const dischargeCycles = cycles.filter(c => c.type === 'discharge' && c.endSoc);
  
  const avgChargeDepth = chargeCycles.length > 0
    ? roundTo(chargeCycles.reduce((sum, c) => sum + Math.abs(c.endSoc - c.startSoc), 0) / chargeCycles.length, 1)
    : null;
  
  const avgDischargeDepth = dischargeCycles.length > 0
    ? roundTo(dischargeCycles.reduce((sum, c) => sum + Math.abs(c.endSoc - c.startSoc), 0) / dischargeCycles.length, 1)
    : null;
  
  // Find deepest discharge
  const deepestDischarge = dischargeCycles.length > 0
    ? dischargeCycles.reduce((min, c) => c.endSoc < (min?.endSoc ?? 100) ? c : min, null)
    : null;
  
  // Daily cycling pattern
  const daysSpan = records.length > 0
    ? (new Date(records[records.length - 1].timestamp) - new Date(records[0].timestamp)) / (1000 * 60 * 60 * 24)
    : 0;
  
  const cyclesPerDay = daysSpan > 0 ? roundTo(cycles.length / daysSpan / 2, 1) : null; // Divide by 2 for charge+discharge pairs
  
  return {
    totalCycles: Math.floor(cycles.length / 2), // Count charge+discharge as one cycle
    cyclesPerDay,
    chargingCycles: {
      count: chargeCycles.length,
      avgDepth: avgChargeDepth,
      avgDuration: chargeCycles.length > 0
        ? roundTo(chargeCycles.reduce((sum, c) => {
          const duration = (new Date(c.end) - new Date(c.start)) / (1000 * 60 * 60);
          return sum + duration;
        }, 0) / chargeCycles.length, 1)
        : null
    },
    dischargingCycles: {
      count: dischargeCycles.length,
      avgDepth: avgDischargeDepth,
      avgDuration: dischargeCycles.length > 0
        ? roundTo(dischargeCycles.reduce((sum, c) => {
          const duration = (new Date(c.end) - new Date(c.start)) / (1000 * 60 * 60);
          return sum + duration;
        }, 0) / dischargeCycles.length, 1)
        : null,
      deepestSoc: deepestDischarge?.endSoc || null,
      deepestTimestamp: deepestDischarge?.end || null
    },
    cyclingPattern: {
      type: cyclesPerDay >= 2 ? 'frequent'
        : cyclesPerDay >= 1 ? 'daily'
        : cyclesPerDay >= 0.5 ? 'occasional'
        : 'rare',
      interpretation: avgDischargeDepth > 50 
        ? 'Deep discharge cycles - accelerates degradation'
        : avgDischargeDepth > 30
          ? 'Moderate discharge depth - normal usage'
          : 'Shallow discharge cycles - extends battery life'
    }
  };
}

/**
 * Calculate trends and forecasts
 */
async function calculateTrends(records, system, log) {
  if (records.length < 30) {
    return { insufficient_data: true, message: 'Need at least 30 data points for trend analysis' };
  }
  
  // Extract time series data
  const socData = records
    .filter(r => r.analysis?.stateOfCharge != null)
    .map(r => ({
      timestamp: new Date(r.timestamp).getTime(),
      value: r.analysis.stateOfCharge
    }));
  
  const voltageData = records
    .filter(r => r.analysis?.overallVoltage != null)
    .map(r => ({
      timestamp: new Date(r.timestamp).getTime(),
      value: r.analysis.overallVoltage
    }));
  
  const currentData = records
    .filter(r => r.analysis?.current != null)
    .map(r => ({
      timestamp: new Date(r.timestamp).getTime(),
      value: r.analysis.current
    }));
  
  // Calculate linear regression for each metric
  const socTrend = linearRegression(socData);
  const voltageTrend = linearRegression(voltageData);
  const currentTrend = linearRegression(currentData);
  
  // Determine trend direction and significance
  const msPerDay = 24 * 60 * 60 * 1000;
  
  const socChangePerDay = socTrend.slope * msPerDay;
  const voltageChangePerDay = voltageTrend.slope * msPerDay;
  const currentChangePerDay = currentTrend.slope * msPerDay;
  
  return {
    soc: {
      trend: socChangePerDay > 0.5 ? 'increasing' 
        : socChangePerDay < -0.5 ? 'decreasing' 
        : 'stable',
      changePerDay: roundTo(socChangePerDay, 2),
      rSquared: roundTo(socTrend.rSquared, 3),
      confidence: socTrend.rSquared > 0.7 ? 'high' 
        : socTrend.rSquared > 0.4 ? 'medium' 
        : 'low',
      interpretation: socChangePerDay < -1
        ? 'SOC declining - energy deficit or increased consumption'
        : socChangePerDay > 1
          ? 'SOC increasing - energy surplus or decreased consumption'
          : 'SOC stable - balanced energy system'
    },
    voltage: {
      trend: voltageChangePerDay > 0.05 ? 'increasing'
        : voltageChangePerDay < -0.05 ? 'decreasing'
        : 'stable',
      changePerDay: roundTo(voltageChangePerDay, 3),
      rSquared: roundTo(voltageTrend.rSquared, 3),
      confidence: voltageTrend.rSquared > 0.7 ? 'high' 
        : voltageTrend.rSquared > 0.4 ? 'medium' 
        : 'low'
    },
    current: {
      trend: currentChangePerDay > 0.1 ? 'increasing (more charging/less load)'
        : currentChangePerDay < -0.1 ? 'decreasing (less charging/more load)'
        : 'stable',
      changePerDay: roundTo(currentChangePerDay, 2),
      rSquared: roundTo(currentTrend.rSquared, 3),
      confidence: currentTrend.rSquared > 0.7 ? 'high'
        : currentTrend.rSquared > 0.4 ? 'medium'
        : 'low'
    }
  };
}

/**
 * Linear regression helper
 */
function linearRegression(dataPoints) {
  if (dataPoints.length < 2) {
    return { slope: 0, intercept: 0, rSquared: 0 };
  }
  
  const n = dataPoints.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  
  for (const point of dataPoints) {
    sumX += point.timestamp;
    sumY += point.value;
    sumXY += point.timestamp * point.value;
    sumXX += point.timestamp * point.timestamp;
    sumYY += point.value * point.value;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R²
  const meanY = sumY / n;
  let ssTotal = 0, ssResidual = 0;
  
  for (const point of dataPoints) {
    const predicted = slope * point.timestamp + intercept;
    ssTotal += Math.pow(point.value - meanY, 2);
    ssResidual += Math.pow(point.value - predicted, 2);
  }
  
  const rSquared = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;
  
  return { slope, intercept, rSquared: Math.max(0, Math.min(1, rSquared)) };
}

/**
 * Detect anomalies
 */
async function detectAnomalies(records, log) {
  if (records.length < 50) {
    return { insufficient_data: true, message: 'Need at least 50 data points for anomaly detection' };
  }
  
  const anomalies = [];
  
  // Extract metrics for anomaly detection
  const voltages = records.map(r => r.analysis?.overallVoltage).filter(v => v != null);
  const currents = records.map(r => r.analysis?.current).filter(c => c != null);
  const temps = records.map(r => r.analysis?.temperature).filter(t => t != null);
  const socs = records.map(r => r.analysis?.stateOfCharge).filter(s => s != null);
  
  // Calculate statistical bounds (mean ± 3σ for outliers)
  const voltageMean = voltages.reduce((sum, v) => sum + v, 0) / voltages.length;
  const voltageStdDev = Math.sqrt(voltages.reduce((sum, v) => sum + Math.pow(v - voltageMean, 2), 0) / voltages.length);
  
  const currentMean = currents.reduce((sum, c) => sum + c, 0) / currents.length;
  const currentStdDev = Math.sqrt(currents.reduce((sum, c) => sum + Math.pow(c - currentMean, 2), 0) / currents.length);
  
  const tempMean = temps.length > 0 ? temps.reduce((sum, t) => sum + t, 0) / temps.length : null;
  const tempStdDev = temps.length > 0 
    ? Math.sqrt(temps.reduce((sum, t) => sum + Math.pow(t - tempMean, 2), 0) / temps.length)
    : null;
  
  // Detect anomalies
  for (const record of records) {
    const voltage = record.analysis?.overallVoltage;
    const current = record.analysis?.current;
    const temp = record.analysis?.temperature;
    const soc = record.analysis?.stateOfCharge;
    
    // Voltage anomalies
    if (voltage != null && Math.abs(voltage - voltageMean) > 3 * voltageStdDev) {
      anomalies.push({
        timestamp: record.timestamp,
        type: 'voltage',
        value: voltage,
        expected: roundTo(voltageMean, 2),
        deviation: roundTo(Math.abs(voltage - voltageMean) / voltageStdDev, 1),
        severity: 'high'
      });
    }
    
    // Current anomalies
    if (current != null && Math.abs(current - currentMean) > 3 * currentStdDev) {
      anomalies.push({
        timestamp: record.timestamp,
        type: 'current',
        value: roundTo(current, 1),
        expected: roundTo(currentMean, 1),
        deviation: roundTo(Math.abs(current - currentMean) / currentStdDev, 1),
        severity: 'medium'
      });
    }
    
    // Temperature anomalies
    if (temp != null && tempMean != null && Math.abs(temp - tempMean) > 3 * tempStdDev) {
      anomalies.push({
        timestamp: record.timestamp,
        type: 'temperature',
        value: roundTo(temp, 1),
        expected: roundTo(tempMean, 1),
        deviation: roundTo(Math.abs(temp - tempMean) / tempStdDev, 1),
        severity: temp < 0 || temp > 45 ? 'critical' : 'medium'
      });
    }
    
    // Rapid SOC changes (>20% in <1 hour)
    const nextRecord = records[records.indexOf(record) + 1];
    if (soc != null && nextRecord?.analysis?.stateOfCharge != null) {
      const socChange = Math.abs(nextRecord.analysis.stateOfCharge - soc);
      const timeDiff = (new Date(nextRecord.timestamp) - new Date(record.timestamp)) / (1000 * 60 * 60);
      
      if (socChange > 20 && timeDiff < 1) {
        anomalies.push({
          timestamp: record.timestamp,
          type: 'rapid_soc_change',
          value: roundTo(socChange, 1),
          timespan: roundTo(timeDiff * 60, 0) + ' min',
          severity: 'high',
          note: 'Possible measurement error or system event'
        });
      }
    }
  }
  
  return {
    totalAnomalies: anomalies.length,
    byType: {
      voltage: anomalies.filter(a => a.type === 'voltage').length,
      current: anomalies.filter(a => a.type === 'current').length,
      temperature: anomalies.filter(a => a.type === 'temperature').length,
      rapid_soc_change: anomalies.filter(a => a.type === 'rapid_soc_change').length
    },
    recent: anomalies.slice(-10), // Last 10 anomalies
    severity: {
      critical: anomalies.filter(a => a.severity === 'critical').length,
      high: anomalies.filter(a => a.severity === 'high').length,
      medium: anomalies.filter(a => a.severity === 'medium').length
    }
  };
}

/**
 * Analyze weather impact
 */
async function analyzeWeatherImpact(records, system, log) {
  if (records.length < 24 || !system?.latitude || !system?.longitude) {
    return {
      insufficient_data: true,
      message: 'Need location data and 24+ hours for weather correlation'
    };
  }
  
  // Group records by day and analyze solar correlation with weather
  const dailyData = {};
  
  for (const record of records) {
    const date = new Date(record.timestamp).toISOString().split('T')[0];
    const current = record.analysis?.current || 0;
    const weather = record.weather || {};
    
    if (!dailyData[date]) {
      dailyData[date] = {
        chargingSamples: 0,
        totalChargeCurrent: 0,
        avgClouds: [],
        avgUvi: [],
        avgTemp: []
      };
    }
    
    if (current > 0.5) {
      dailyData[date].chargingSamples++;
      dailyData[date].totalChargeCurrent += current;
    }
    
    if (weather.clouds != null) dailyData[date].avgClouds.push(weather.clouds);
    if (weather.uvi != null) dailyData[date].avgUvi.push(weather.uvi);
    if (weather.temp != null) dailyData[date].avgTemp.push(weather.temp);
  }
  
  // Calculate correlations
  const correlations = [];
  
  for (const [date, data] of Object.entries(dailyData)) {
    if (data.chargingSamples > 0) {
      const avgChargeCurrent = data.totalChargeCurrent / data.chargingSamples;
      const avgClouds = data.avgClouds.length > 0
        ? data.avgClouds.reduce((sum, c) => sum + c, 0) / data.avgClouds.length
        : null;
      const avgUvi = data.avgUvi.length > 0
        ? data.avgUvi.reduce((sum, u) => sum + u, 0) / data.avgUvi.length
        : null;
      const avgTemp = data.avgTemp.length > 0
        ? data.avgTemp.reduce((sum, t) => sum + t, 0) / data.avgTemp.length
        : null;
      
      correlations.push({
        date,
        chargeCurrent: roundTo(avgChargeCurrent, 1),
        clouds: avgClouds ? roundTo(avgClouds, 0) : null,
        uvi: avgUvi ? roundTo(avgUvi, 1) : null,
        temp: avgTemp ? roundTo(avgTemp, 1) : null
      });
    }
  }
  
  // Find best and worst solar days
  const sortedByCharge = [...correlations].sort((a, b) => b.chargeCurrent - a.chargeCurrent);
  const bestDay = sortedByCharge[0];
  const worstDay = sortedByCharge[sortedByCharge.length - 1];
  
  // Calculate average metrics for cloudy vs sunny days
  const sunnyDays = correlations.filter(c => c.clouds != null && c.clouds < 30);
  const cloudyDays = correlations.filter(c => c.clouds != null && c.clouds > 70);
  
  const sunnyAvgCharge = sunnyDays.length > 0
    ? roundTo(sunnyDays.reduce((sum, d) => sum + d.chargeCurrent, 0) / sunnyDays.length, 1)
    : null;
  
  const cloudyAvgCharge = cloudyDays.length > 0
    ? roundTo(cloudyDays.reduce((sum, d) => sum + d.chargeCurrent, 0) / cloudyDays.length, 1)
    : null;
  
  return {
    bestSolarDay: bestDay ? {
      date: bestDay.date,
      chargeCurrent: bestDay.chargeCurrent,
      clouds: bestDay.clouds,
      uvi: bestDay.uvi
    } : null,
    worstSolarDay: worstDay ? {
      date: worstDay.date,
      chargeCurrent: worstDay.chargeCurrent,
      clouds: worstDay.clouds,
      uvi: worstDay.uvi
    } : null,
    sunnyDayPerformance: {
      days: sunnyDays.length,
      avgChargeCurrent: sunnyAvgCharge,
      conditions: '<30% cloud cover'
    },
    cloudyDayPerformance: {
      days: cloudyDays.length,
      avgChargeCurrent: cloudyAvgCharge,
      conditions: '>70% cloud cover'
    },
    weatherImpact: sunnyAvgCharge && cloudyAvgCharge ? {
      chargeReduction: roundTo(((sunnyAvgCharge - cloudyAvgCharge) / sunnyAvgCharge) * 100, 1),
      interpretation: sunnyAvgCharge > cloudyAvgCharge * 2
        ? 'Heavy cloud cover significantly reduces solar charging (>50% reduction)'
        : sunnyAvgCharge > cloudyAvgCharge * 1.3
          ? 'Cloud cover moderately impacts solar charging (30-50% reduction)'
          : 'Cloud cover has minimal impact on solar charging'
    } : null
  };
}

/**
 * Build recommendation context
 */
function buildRecommendationContext(analytics, system) {
  const context = {
    priorities: [],
    opportunities: [],
    constraints: [],
    metrics: {}
  };
  
  // Analyze current state for priorities
  if (analytics.currentState) {
    const state = analytics.currentState;
    
    if (state.soc < 20) {
      context.priorities.push({
        level: 'critical',
        category: 'capacity',
        issue: `SOC critically low at ${state.soc}%`,
        action: 'Immediate charging needed or reduce loads'
      });
    } else if (state.soc < 40) {
      context.priorities.push({
        level: 'high',
        category: 'capacity',
        issue: `SOC low at ${state.soc}%`,
        action: 'Plan for charging or load reduction'
      });
    }
    
    if (state.runtimeHours && state.runtimeHours < 12) {
      context.priorities.push({
        level: 'critical',
        category: 'autonomy',
        issue: `Only ${state.runtimeHours}h runtime remaining at current load`,
        action: 'Reduce loads immediately or start generator'
      });
    }
  }
  
  // Analyze energy balance
  if (analytics.energyBalance?.dailyAverages) {
    const balance = analytics.energyBalance.dailyAverages;
    
    if (balance.solarSufficiency < 80) {
      context.priorities.push({
        level: 'high',
        category: 'energy_balance',
        issue: `Solar sufficiency only ${balance.solarSufficiency}%`,
        action: 'Expand solar capacity or reduce consumption'
      });
    }
    
    if (balance.netKwh < -1) {
      context.priorities.push({
        level: 'high',
        category: 'deficit',
        issue: `Daily deficit of ${Math.abs(balance.netKwh)} kWh`,
        action: 'Requires generator runtime or solar expansion'
      });
    }
    
    context.metrics.dailySolarSufficiency = balance.solarSufficiency;
    context.metrics.dailyNetKwh = balance.netKwh;
  }
  
  // Analyze battery health
  if (analytics.batteryHealth?.overallHealth) {
    const health = analytics.batteryHealth.overallHealth;
    
    if (health.score < 60) {
      context.priorities.push({
        level: 'high',
        category: 'battery_health',
        issue: `Battery health score ${health.score}/100`,
        action: health.recommendation
      });
    }
    
    context.metrics.batteryHealthScore = health.score;
  }
  
  // Identify opportunities
  if (analytics.loadProfile?.nightVsDay) {
    const nightDay = analytics.loadProfile.nightVsDay;
    
    if (nightDay.nightDominant && nightDay.dayKwh < nightDay.nightKwh * 0.5) {
      context.opportunities.push({
        category: 'load_shifting',
        description: 'Shift loads from night to day for better solar utilization',
        potential: `Could reduce nighttime consumption by ${roundTo((nightDay.nightKwh - nightDay.dayKwh) / 2, 1)} kWh`
      });
    }
  }
  
  if (analytics.solarPerformance?.performanceRatio) {
    const perf = analytics.solarPerformance.performanceRatio;
    
    if (perf.percent < 70) {
      context.opportunities.push({
        category: 'solar_optimization',
        description: 'Solar array underperforming - check for shading, dirt, or misalignment',
        potential: `Could increase generation by ${roundTo((80 - perf.percent) * analytics.solarPerformance.actualPerformance.avgDailyKwh / perf.percent, 1)} kWh/day`
      });
    }
  }
  
  // Note constraints
  if (analytics.weatherImpact?.weatherImpact) {
    const impact = analytics.weatherImpact.weatherImpact;
    
    context.constraints.push({
      category: 'weather',
      description: `Cloud cover reduces charging by ${impact.chargeReduction}%`,
      mitigation: 'Size solar array for worst-case weather or plan generator runtime'
    });
  }
  
  return context;
}

/**
 * Helper: Round to specified decimal places
 */
function roundTo(value, decimals) {
  if (value == null || !isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

module.exports = {
  generateComprehensiveAnalytics
};
