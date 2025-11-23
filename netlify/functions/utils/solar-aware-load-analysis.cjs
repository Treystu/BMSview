/**
 * Solar-Aware Load Analysis Module
 * 
 * CRITICAL INSIGHT: BMS "current" during daylight is NET = Solar - Load
 * We must separate these components to understand true load consumption.
 * 
 * Key Principles:
 * a) Power draw exists 24/7/365 - loads never stop
 * b) During daylight: observed current = solar generation - load consumption
 * c) During night: observed current = pure load (no solar)
 * d) Time of day matters - loads vary by hour (cooking, HVAC, etc.)
 * 
 * This module calculates:
 * - True baseline load by hour (not obscured by solar)
 * - Expected solar generation using irradiance models
 * - Actual solar generation (inferred from day vs night data)
 * - Load patterns by time of day
 * 
 * @module netlify/functions/utils/solar-aware-load-analysis
 */

const { getCollection } = require('./mongodb.cjs');

/**
 * Calculate sun position and irradiance for a given time and location
 * This is the foundation for understanding what solar SHOULD generate
 */
function calculateSolarIrradiance(timestamp, latitude, longitude, maxSolarWatts) {
  const date = new Date(timestamp);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const dayOfYear = getDayOfYear(date);
  
  // Solar declination (angle of sun)
  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
  
  // Hour angle (solar noon = 0, morning negative, afternoon positive)
  const solarNoon = 12; // Simplified - should account for longitude
  const hourAngle = 15 * (hour + minute / 60 - solarNoon);
  
  // Solar altitude angle (elevation above horizon)
  const latRad = latitude * Math.PI / 180;
  const declRad = declination * Math.PI / 180;
  const hourAngleRad = hourAngle * Math.PI / 180;
  
  const sinAltitude = 
    Math.sin(latRad) * Math.sin(declRad) + 
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  
  const altitude = Math.asin(sinAltitude) * 180 / Math.PI;
  
  // If sun is below horizon, no solar
  if (altitude <= 0) {
    return {
      altitude: 0,
      isSunUp: false,
      expectedWatts: 0,
      expectedAmps: 0
    };
  }
  
  // Air mass coefficient (atmospheric absorption)
  const airMass = 1 / sinAltitude;
  
  // Solar irradiance at surface (W/m²)
  // Peak is ~1000 W/m² on clear day at solar noon
  const clearSkyIrradiance = 1000 * Math.pow(0.7, airMass) * sinAltitude;
  
  // Expected panel output (accounting for panel efficiency ~15-20%)
  // This is what panels SHOULD generate in clear sky
  const expectedWatts = maxSolarWatts * (clearSkyIrradiance / 1000);
  
  return {
    altitude: roundTo(altitude, 1),
    isSunUp: true,
    clearSkyIrradiance: roundTo(clearSkyIrradiance, 0),
    expectedWatts: roundTo(expectedWatts, 0),
    hourAngle,
    airMass: roundTo(airMass, 2)
  };
}

/**
 * Adjust expected solar for cloud cover
 */
function adjustForClouds(expectedWatts, cloudCoverPercent) {
  if (cloudCoverPercent == null || expectedWatts === 0) {
    return expectedWatts;
  }
  
  // Cloud transmission factor
  // 0% clouds = 100% transmission
  // 100% clouds = ~10% transmission (diffuse light)
  const transmission = 1 - (cloudCoverPercent / 100) * 0.9;
  
  return roundTo(expectedWatts * transmission, 0);
}

/**
 * Analyze loads with solar-aware separation
 * This is the core function that separates solar from load
 */
async function analyzeSolarAwareLoads(systemId, system, records, log) {
  if (records.length < 48) {
    return {
      insufficient_data: true,
      message: 'Need at least 48 hours for solar-aware load analysis'
    };
  }
  
  const voltage = system?.voltage || 48;
  const maxSolarWatts = system?.maxAmpsSolarCharging 
    ? system.maxAmpsSolarCharging * voltage 
    : 0;
  const latitude = system?.latitude || null;
  const longitude = system?.longitude || null;
  
  if (!latitude || !longitude || maxSolarWatts === 0) {
    log.warn('Missing location or solar capacity - falling back to basic analysis', {
      hasLocation: !!(latitude && longitude),
      hasSolarCapacity: maxSolarWatts > 0
    });
    return analyzeFallback(records, voltage, log);
  }
  
  log.info('Starting solar-aware load analysis', {
    systemId,
    maxSolarWatts,
    latitude,
    longitude,
    recordCount: records.length
  });
  
  // Hourly load analysis (24 hours)
  const hourlyData = Array(24).fill(null).map((_, hour) => ({
    hour,
    nightSamples: [],      // Pure load measurements (no solar)
    nightChargingSamples: [], // Generator/grid charging during night (NEW)
    daySamples: [],         // Net measurements (solar - load)
    expectedSolar: [],      // What solar SHOULD generate
    actualSolar: [],        // What solar ACTUALLY generated (inferred)
    trueLoad: [],           // Calculated true load
    validationSamples: []   // SOC/Capacity delta validation (NEW)
  }));
  
  // Process each record
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const nextRecord = records[i + 1];
    
    const timestamp = new Date(record.timestamp);
    const hour = timestamp.getHours();
    const observedCurrent = record.analysis?.current || 0;
    const observedWatts = record.analysis?.power || (observedCurrent * voltage);
    const cloudCover = record.weather?.clouds || null;
    const soc = record.analysis?.stateOfCharge || null;
    const remainingAh = record.analysis?.remainingCapacity || null;
    
    // NEW: Calculate capacity delta and SOC delta for validation
    let capacityDelta = null;
    let socDelta = null;
    let timeDeltaHours = null;
    let predictedCapacityDelta = null;
    let deltaAccuracy = null;
    
    if (nextRecord) {
      const nextSoc = nextRecord.analysis?.stateOfCharge || null;
      const nextRemainingAh = nextRecord.analysis?.remainingCapacity || null;
      const nextTimestamp = new Date(nextRecord.timestamp);
      
      timeDeltaHours = (nextTimestamp - timestamp) / (1000 * 60 * 60);
      
      // Only validate if we have good data and reasonable time delta
      if (soc != null && nextSoc != null && remainingAh != null && nextRemainingAh != null 
          && timeDeltaHours > 0 && timeDeltaHours < 2) {
        
        // Actual changes from BMS
        capacityDelta = nextRemainingAh - remainingAh; // Positive = charging, negative = discharging
        socDelta = nextSoc - soc; // Positive = increasing, negative = decreasing
        
        // Predicted capacity change based on observed current
        // Ah change = Current × Hours
        predictedCapacityDelta = observedCurrent * timeDeltaHours;
        
        // Validation: Does predicted match actual?
        if (Math.abs(capacityDelta) > 0.1) { // Only validate meaningful changes
          const error = Math.abs(capacityDelta - predictedCapacityDelta);
          const errorPercent = (error / Math.abs(capacityDelta)) * 100;
          deltaAccuracy = {
            actualCapacityDelta: roundTo(capacityDelta, 2),
            predictedCapacityDelta: roundTo(predictedCapacityDelta, 2),
            error: roundTo(error, 2),
            errorPercent: roundTo(errorPercent, 1),
            socDelta: roundTo(socDelta, 2),
            timeDeltaHours: roundTo(timeDeltaHours, 2),
            isAccurate: errorPercent < 20, // Within 20% is acceptable
            note: errorPercent > 20 
              ? 'Significant mismatch - possible BMS calibration issue or unmeasured load/generation'
              : 'Good match between predicted and actual'
          };
        }
      }
    }
    
    // Calculate expected solar for this timestamp
    const solar = calculateSolarIrradiance(timestamp, latitude, longitude, maxSolarWatts);
    const expectedSolarWatts = adjustForClouds(solar.expectedWatts, cloudCover);
    const expectedSolarAmps = voltage > 0 ? expectedSolarWatts / voltage : 0;
    
    // CRITICAL LOGIC: Separate solar from load
    if (solar.isSunUp) {
      // During daylight: observedCurrent = solarGeneration - load
      // Therefore: load = solarGeneration - observedCurrent
      
      // Store day sample (net measurement)
      hourlyData[hour].daySamples.push({
        timestamp,
        observedCurrent,
        observedWatts,
        cloudCover
      });
      
      hourlyData[hour].expectedSolar.push(expectedSolarAmps);
      
      // If we're seeing positive current (charging), that means solar > load
      // If we're seeing negative current (discharging), that means solar < load
      // In both cases: trueLoad = expectedSolar - observedCurrent
      const inferredLoad = expectedSolarAmps - observedCurrent;
      
      if (inferredLoad > 0) {
        hourlyData[hour].trueLoad.push(inferredLoad);
        hourlyData[hour].actualSolar.push(inferredLoad + Math.abs(observedCurrent));
      }
      
      // Store validation data
      if (deltaAccuracy) {
        hourlyData[hour].validationSamples.push(deltaAccuracy);
      }
    } else {
      // During night: NO SOLAR
      
      // CRITICAL NEW LOGIC: Detect generator/grid charging during night
      if (observedCurrent > 0.5) {
        // Positive current at night = GENERATOR/GRID charging!
        hourlyData[hour].nightChargingSamples.push({
          timestamp,
          chargingCurrent: observedCurrent,
          chargingWatts: observedWatts,
          source: 'generator_or_grid' // Could be generator, grid, or wind
        });
        
        // We can't directly measure load during charging, but we know:
        // observedCurrent = generatorOutput - load
        // Without knowing generator output, we use adjacent non-charging hours
        // This will be calculated in post-processing
      } else {
        // Negative current at night = pure load (no solar interference)
        hourlyData[hour].nightSamples.push({
          timestamp,
          observedCurrent: Math.abs(observedCurrent), // Load is always positive
          observedWatts: Math.abs(observedWatts)
        });
        
        // This is our ground truth for load
        hourlyData[hour].trueLoad.push(Math.abs(observedCurrent));
      }
      
      // Store validation data
      if (deltaAccuracy) {
        hourlyData[hour].validationSamples.push(deltaAccuracy);
      }
    }
  }
  
  // Calculate averages and patterns
  const hourlyProfile = hourlyData.map(h => {
    const avgNightLoad = h.nightSamples.length > 0
      ? h.nightSamples.reduce((sum, s) => sum + s.observedCurrent, 0) / h.nightSamples.length
      : null;
    
    // NEW: Analyze night charging (generator/grid)
    const avgNightCharging = h.nightChargingSamples.length > 0
      ? h.nightChargingSamples.reduce((sum, s) => sum + s.chargingCurrent, 0) / h.nightChargingSamples.length
      : null;
    
    const hasGeneratorCharging = h.nightChargingSamples.length > 0;
    
    // Estimate load during generator charging
    // Use adjacent non-charging night hours as baseline
    const estimatedLoadDuringCharging = avgNightLoad || 
      (h.trueLoad.length > 0 ? h.trueLoad.reduce((sum, l) => sum + l, 0) / h.trueLoad.length : null);
    
    const avgExpectedSolar = h.expectedSolar.length > 0
      ? h.expectedSolar.reduce((sum, s) => sum + s, 0) / h.expectedSolar.length
      : 0;
    
    const avgActualSolar = h.actualSolar.length > 0
      ? h.actualSolar.reduce((sum, s) => sum + s, 0) / h.actualSolar.length
      : null;
    
    const avgTrueLoad = h.trueLoad.length > 0
      ? h.trueLoad.reduce((sum, l) => sum + l, 0) / h.trueLoad.length
      : avgNightLoad; // Fallback to night load if no day data
    
    const avgDayNetCurrent = h.daySamples.length > 0
      ? h.daySamples.reduce((sum, s) => sum + s.observedCurrent, 0) / h.daySamples.length
      : null;
    
    return {
      hour: h.hour,
      trueLoadAmps: roundTo(avgTrueLoad, 2),
      trueLoadWatts: roundTo(avgTrueLoad * voltage, 0),
      nightLoadAmps: roundTo(avgNightLoad, 2),
      nightLoadWatts: avgNightLoad ? roundTo(avgNightLoad * voltage, 0) : null,
      generatorChargingAmps: roundTo(avgNightCharging, 2),
      generatorChargingWatts: avgNightCharging ? roundTo(avgNightCharging * voltage, 0) : null,
      hasGeneratorCharging,
      generatorChargingSamples: h.nightChargingSamples.length,
      expectedSolarAmps: roundTo(avgExpectedSolar, 2),
      expectedSolarWatts: roundTo(avgExpectedSolar * voltage, 0),
      actualSolarAmps: roundTo(avgActualSolar, 2),
      actualSolarWatts: avgActualSolar ? roundTo(avgActualSolar * voltage, 0) : null,
      observedNetAmps: roundTo(avgDayNetCurrent, 2),
      solarEfficiency: avgExpectedSolar > 0 && avgActualSolar
        ? roundTo((avgActualSolar / avgExpectedSolar) * 100, 1)
        : null,
      nightSamples: h.nightSamples.length,
      daySamples: h.daySamples.length
    };
  });
  
  // Calculate daily totals and patterns
  const totalDailyLoadKwh = hourlyProfile.reduce((sum, h) => 
    sum + ((h.trueLoadWatts || 0) / 1000), 0
  );
  
  const totalExpectedSolarKwh = hourlyProfile.reduce((sum, h) => 
    sum + ((h.expectedSolarWatts || 0) / 1000), 0
  );
  
  const totalActualSolarKwh = hourlyProfile
    .filter(h => h.actualSolarWatts != null)
    .reduce((sum, h) => sum + (h.actualSolarWatts / 1000), 0);
  
  // NEW: Calculate generator charging totals
  const totalGeneratorKwh = hourlyProfile
    .filter(h => h.generatorChargingWatts != null)
    .reduce((sum, h) => sum + (h.generatorChargingWatts / 1000), 0);
  
  const generatorChargingHours = hourlyProfile.filter(h => h.hasGeneratorCharging);
  const hasGeneratorCharging = generatorChargingHours.length > 0;
  
  // Analyze generator usage patterns
  const generatorAnalysis = hasGeneratorCharging 
    ? analyzeGeneratorPatterns(hourlyProfile, hourlyData, voltage)
    : null;
  
  // NEW: Analyze SOC/Capacity delta validation
  const validationAnalysis = analyzeValidation(hourlyData, system?.capacity, log);
  
  // Identify load patterns by time of day
  const timeOfDayPatterns = analyzeTimeOfDayPatterns(hourlyProfile);
  
  // Calculate baseline vs peak loads
  const baselineLoad = Math.min(...hourlyProfile.map(h => h.trueLoadWatts || Infinity));
  const peakLoad = Math.max(...hourlyProfile.map(h => h.trueLoadWatts || 0));
  const peakHour = hourlyProfile.find(h => h.trueLoadWatts === peakLoad)?.hour;
  
  log.info('Solar-aware load analysis complete', {
    systemId,
    totalDailyLoadKwh: roundTo(totalDailyLoadKwh, 2),
    totalExpectedSolarKwh: roundTo(totalExpectedSolarKwh, 2),
    totalActualSolarKwh: roundTo(totalActualSolarKwh, 2),
    totalGeneratorKwh: roundTo(totalGeneratorKwh, 2),
    baselineLoadWatts: roundTo(baselineLoad, 0),
    peakLoadWatts: roundTo(peakLoad, 0),
    peakHour
  });
  
  return {
    hourlyProfile,
    dailySummary: {
      totalLoadKwh: roundTo(totalDailyLoadKwh, 2),
      avgLoadWatts: roundTo(totalDailyLoadKwh * 1000 / 24, 0),
      baselineLoadWatts: roundTo(baselineLoad, 0),
      peakLoadWatts: roundTo(peakLoad, 0),
      peakLoadHour: peakHour,
      expectedSolarKwh: roundTo(totalExpectedSolarKwh, 2),
      actualSolarKwh: totalActualSolarKwh > 0 ? roundTo(totalActualSolarKwh, 2) : null,
      solarEfficiency: totalExpectedSolarKwh > 0 && totalActualSolarKwh > 0
        ? roundTo((totalActualSolarKwh / totalExpectedSolarKwh) * 100, 1)
        : null,
      generatorKwh: totalGeneratorKwh > 0 ? roundTo(totalGeneratorKwh, 2) : null,
      hasGeneratorCharging
    },
    timeOfDayPatterns,
    solarPerformance: {
      expectedGeneration: roundTo(totalExpectedSolarKwh, 2),
      actualGeneration: totalActualSolarKwh > 0 ? roundTo(totalActualSolarKwh, 2) : null,
      efficiency: totalExpectedSolarKwh > 0 && totalActualSolarKwh > 0
        ? roundTo((totalActualSolarKwh / totalExpectedSolarKwh) * 100, 1)
        : null,
      status: getSolarStatus(totalExpectedSolarKwh, totalActualSolarKwh),
      context: 'Actual solar accounts for cloud cover, panel degradation, shading, and temperature effects'
    },
    generatorAnalysis,
    validationAnalysis,
    energyBalance: {
      dailyLoadKwh: roundTo(totalDailyLoadKwh, 2),
      dailySolarKwh: totalActualSolarKwh > 0 ? roundTo(totalActualSolarKwh, 2) : roundTo(totalExpectedSolarKwh, 2),
      dailyGeneratorKwh: totalGeneratorKwh > 0 ? roundTo(totalGeneratorKwh, 2) : 0,
      totalGenerationKwh: roundTo(
        (totalActualSolarKwh > 0 ? totalActualSolarKwh : totalExpectedSolarKwh) + totalGeneratorKwh, 
        2
      ),
      netDailyKwh: roundTo(
        (totalActualSolarKwh > 0 ? totalActualSolarKwh : totalExpectedSolarKwh) + totalGeneratorKwh - totalDailyLoadKwh,
        2
      ),
      solarSufficiency: totalDailyLoadKwh > 0
        ? roundTo(((totalActualSolarKwh > 0 ? totalActualSolarKwh : totalExpectedSolarKwh) / totalDailyLoadKwh) * 100, 1)
        : 0,
      totalSufficiency: totalDailyLoadKwh > 0
        ? roundTo((((totalActualSolarKwh > 0 ? totalActualSolarKwh : totalExpectedSolarKwh) + totalGeneratorKwh) / totalDailyLoadKwh) * 100, 1)
        : 0
    }
  };
}

/**
 * Analyze load patterns by time of day
 */
function analyzeTimeOfDayPatterns(hourlyProfile) {
  // Define time periods
  const overnight = hourlyProfile.filter(h => h.hour >= 22 || h.hour < 6); // 10 PM - 6 AM
  const morning = hourlyProfile.filter(h => h.hour >= 6 && h.hour < 12);   // 6 AM - 12 PM
  const afternoon = hourlyProfile.filter(h => h.hour >= 12 && h.hour < 18); // 12 PM - 6 PM
  const evening = hourlyProfile.filter(h => h.hour >= 18 && h.hour < 22);   // 6 PM - 10 PM
  
  const avgLoad = (period) => {
    const loads = period.map(p => p.trueLoadWatts).filter(w => w != null && w > 0);
    return loads.length > 0 ? loads.reduce((sum, w) => sum + w, 0) / loads.length : 0;
  };
  
  return {
    overnight: {
      hours: '10 PM - 6 AM',
      avgLoadWatts: roundTo(avgLoad(overnight), 0),
      context: 'Baseline loads: refrigeration, standby power, always-on devices'
    },
    morning: {
      hours: '6 AM - 12 PM',
      avgLoadWatts: roundTo(avgLoad(morning), 0),
      context: 'Morning routine: coffee, cooking, lighting, increased activity'
    },
    afternoon: {
      hours: '12 PM - 6 PM',
      avgLoadWatts: roundTo(avgLoad(afternoon), 0),
      context: 'Midday loads: HVAC, appliances, work/activity loads'
    },
    evening: {
      hours: '6 PM - 10 PM',
      avgLoadWatts: roundTo(avgLoad(evening), 0),
      context: 'Evening peak: cooking, lighting, entertainment, HVAC'
    },
    pattern: determineLoadPattern(avgLoad(overnight), avgLoad(morning), avgLoad(afternoon), avgLoad(evening))
  };
}

/**
 * Determine load pattern type
 */
function determineLoadPattern(overnight, morning, afternoon, evening) {
  const max = Math.max(overnight, morning, afternoon, evening);
  const min = Math.min(overnight, morning, afternoon, evening);
  const variation = ((max - min) / min) * 100;
  
  let peakPeriod = 'overnight';
  if (morning === max) peakPeriod = 'morning';
  else if (afternoon === max) peakPeriod = 'afternoon';
  else if (evening === max) peakPeriod = 'evening';
  
  let pattern = 'flat';
  if (variation > 50) pattern = 'highly variable';
  else if (variation > 25) pattern = 'variable';
  
  return {
    type: pattern,
    variation: roundTo(variation, 1),
    peakPeriod,
    interpretation: variation > 50
      ? `High load variation (${roundTo(variation, 0)}%) - peak during ${peakPeriod}. Significant optimization opportunity.`
      : variation > 25
        ? `Moderate load variation (${roundTo(variation, 0)}%) - peak during ${peakPeriod}. Some optimization possible.`
        : `Flat load profile (${roundTo(variation, 0)}%) - consistent 24/7 consumption.`
  };
}

/**
 * Get solar performance status
 */
function getSolarStatus(expected, actual) {
  if (!actual) return 'unknown';
  
  const efficiency = (actual / expected) * 100;
  
  if (efficiency >= 80) return 'excellent';
  if (efficiency >= 65) return 'good';
  if (efficiency >= 50) return 'fair';
  if (efficiency >= 35) return 'poor';
  return 'critical';
}

/**
 * Analyze generator charging patterns
 */
function analyzeGeneratorPatterns(hourlyProfile, hourlyData, voltage) {
  const generatorHours = hourlyProfile.filter(h => h.hasGeneratorCharging);
  
  if (generatorHours.length === 0) {
    return null;
  }
  
  // Find all generator charging sessions across all data
  const sessions = [];
  let currentSession = null;
  
  for (const hourData of hourlyData) {
    for (const sample of hourData.nightChargingSamples) {
      if (!currentSession) {
        currentSession = {
          start: sample.timestamp,
          end: sample.timestamp,
          samples: [sample],
          totalAh: 0
        };
      } else {
        const timeSinceLastSample = (new Date(sample.timestamp) - new Date(currentSession.end)) / (1000 * 60 * 60);
        
        if (timeSinceLastSample <= 1) {
          // Continue current session
          currentSession.end = sample.timestamp;
          currentSession.samples.push(sample);
        } else {
          // New session
          sessions.push(currentSession);
          currentSession = {
            start: sample.timestamp,
            end: sample.timestamp,
            samples: [sample],
            totalAh: 0
          };
        }
      }
    }
  }
  
  if (currentSession) {
    sessions.push(currentSession);
  }
  
  // Analyze sessions
  for (const session of sessions) {
    const durationHours = (new Date(session.end) - new Date(session.start)) / (1000 * 60 * 60);
    const avgCurrent = session.samples.reduce((sum, s) => sum + s.chargingCurrent, 0) / session.samples.length;
    const totalAh = avgCurrent * durationHours;
    const totalKwh = (totalAh * voltage) / 1000;
    
    session.durationHours = roundTo(durationHours, 2);
    session.avgCurrent = roundTo(avgCurrent, 1);
    session.totalAh = roundTo(totalAh, 1);
    session.totalKwh = roundTo(totalKwh, 2);
    session.startHour = new Date(session.start).getHours();
  }
  
  // Calculate totals and patterns
  const totalSessions = sessions.length;
  const totalGeneratorKwh = sessions.reduce((sum, s) => sum + s.totalKwh, 0);
  const avgSessionDuration = sessions.reduce((sum, s) => sum + s.durationHours, 0) / totalSessions;
  const avgSessionKwh = totalGeneratorKwh / totalSessions;
  
  // Find most common charging times
  const hourCounts = Array(24).fill(0);
  for (const session of sessions) {
    hourCounts[session.startHour]++;
  }
  
  const mostCommonHour = hourCounts.indexOf(Math.max(...hourCounts));
  
  return {
    totalSessions,
    totalKwh: roundTo(totalGeneratorKwh, 2),
    avgSessionDuration: roundTo(avgSessionDuration, 2),
    avgSessionKwh: roundTo(avgSessionKwh, 2),
    mostCommonStartHour: mostCommonHour,
    sessions: sessions.slice(-5), // Last 5 sessions
    pattern: {
      frequency: totalSessions > 20 ? 'daily' : totalSessions > 10 ? 'frequent' : 'occasional',
      typicalTime: `${mostCommonHour}:00`,
      interpretation: totalSessions > 20
        ? 'Generator runs daily - indicates solar deficit or high nighttime loads'
        : totalSessions > 10
          ? 'Generator runs frequently - may need solar expansion'
          : 'Generator used occasionally - backup only'
    },
    recommendations: generateGeneratorRecommendations(totalGeneratorKwh, totalSessions, avgSessionDuration)
  };
}

/**
 * Generate generator recommendations
 */
function generateGeneratorRecommendations(totalKwh, sessions, avgDuration) {
  const recommendations = [];
  
  if (totalKwh > 5) {
    recommendations.push({
      priority: 'high',
      action: `Generator providing ${roundTo(totalKwh, 1)} kWh/day - consider expanding solar array to reduce fuel costs`,
      savings: `Replacing ${roundTo(totalKwh, 1)} kWh/day of generator with solar could save significant fuel costs`
    });
  }
  
  if (sessions > 20) {
    recommendations.push({
      priority: 'medium',
      action: 'Generator runs daily - this is expensive and high-maintenance',
      suggestion: 'Analyze load patterns to identify reduction opportunities or expand renewable generation'
    });
  }
  
  if (avgDuration > 3) {
    recommendations.push({
      priority: 'medium',
      action: `Long generator runtime (${roundTo(avgDuration, 1)}h avg) - may indicate undersized solar or battery`,
      suggestion: 'Consider battery capacity expansion to reduce generator dependency'
    });
  }
  
  return recommendations;
}

/**
 * Analyze SOC/Capacity delta validation
 * Validates BMS measurements against known system capacity and current flow
 */
function analyzeValidation(hourlyData, systemCapacity, log) {
  const allValidations = [];
  
  for (const hourData of hourlyData) {
    allValidations.push(...hourData.validationSamples);
  }
  
  if (allValidations.length === 0) {
    return {
      insufficient_data: true,
      message: 'No validation samples available - need SOC and capacity measurements'
    };
  }
  
  // Calculate accuracy statistics
  const accurateSamples = allValidations.filter(v => v.isAccurate);
  const inaccurateSamples = allValidations.filter(v => !v.isAccurate);
  
  const avgError = allValidations.reduce((sum, v) => sum + v.error, 0) / allValidations.length;
  const avgErrorPercent = allValidations.reduce((sum, v) => sum + v.errorPercent, 0) / allValidations.length;
  
  const maxError = Math.max(...allValidations.map(v => v.error));
  const maxErrorSample = allValidations.find(v => v.error === maxError);
  
  // Determine overall accuracy status
  const accuracyRate = (accurateSamples.length / allValidations.length) * 100;
  
  let status = 'excellent';
  if (accuracyRate < 95) status = 'good';
  if (accuracyRate < 85) status = 'fair';
  if (accuracyRate < 70) status = 'poor';
  if (accuracyRate < 50) status = 'critical';
  
  // Identify systematic bias
  const avgPredictedDelta = allValidations.reduce((sum, v) => sum + v.predictedCapacityDelta, 0) / allValidations.length;
  const avgActualDelta = allValidations.reduce((sum, v) => sum + v.actualCapacityDelta, 0) / allValidations.length;
  const systematicBias = avgActualDelta - avgPredictedDelta;
  
  // NEW: Validate SOC calculations against known system capacity
  // SOC% should match remainingAh / systemCapacity
  const socValidations = allValidations.filter(v => v.socDelta != null && v.actualCapacityDelta != null);
  let socAccuracy = null;
  
  if (socValidations.length > 0 && systemCapacity) {
    const socErrors = socValidations.map(v => {
      // Expected SOC change = (capacity delta / system capacity) * 100
      const expectedSocDelta = (v.actualCapacityDelta / systemCapacity) * 100;
      const actualSocDelta = v.socDelta;
      const socError = Math.abs(actualSocDelta - expectedSocDelta);
      return {
        expectedSocDelta: roundTo(expectedSocDelta, 2),
        actualSocDelta: roundTo(actualSocDelta, 2),
        error: roundTo(socError, 2),
        errorPercent: expectedSocDelta !== 0 ? roundTo((socError / Math.abs(expectedSocDelta)) * 100, 1) : 0
      };
    });
    
    const avgSocError = socErrors.reduce((sum, e) => sum + e.error, 0) / socErrors.length;
    const avgSocErrorPercent = socErrors.reduce((sum, e) => sum + e.errorPercent, 0) / socErrors.length;
    
    socAccuracy = {
      samples: socErrors.length,
      avgError: roundTo(avgSocError, 2),
      avgErrorPercent: roundTo(avgSocErrorPercent, 1),
      status: avgSocErrorPercent < 10 ? 'excellent' 
        : avgSocErrorPercent < 20 ? 'good'
        : avgSocErrorPercent < 30 ? 'fair'
        : 'poor',
      interpretation: avgSocErrorPercent < 10
        ? 'SOC% calculations are accurate - BMS using correct capacity value'
        : avgSocErrorPercent < 30
          ? `SOC% has ${roundTo(avgSocErrorPercent, 0)}% error - BMS may be using wrong capacity value or needs calibration`
          : `SOC% significantly inaccurate - BMS capacity setting likely wrong (should be ${systemCapacity}Ah)`
    };
  }
  
  log.info('Validation analysis complete', {
    totalSamples: allValidations.length,
    accuracyRate: roundTo(accuracyRate, 1),
    avgErrorPercent: roundTo(avgErrorPercent, 1),
    status,
    systematicBias: roundTo(systematicBias, 2),
    socAccuracy: socAccuracy?.status || 'unknown',
    knownSystemCapacity: systemCapacity
  });
  
  return {
    totalSamples: allValidations.length,
    accurateSamples: accurateSamples.length,
    inaccurateSamples: inaccurateSamples.length,
    accuracyRate: roundTo(accuracyRate, 1),
    status,
    avgError: roundTo(avgError, 2),
    avgErrorPercent: roundTo(avgErrorPercent, 1),
    maxError: roundTo(maxError, 2),
    maxErrorSample: maxErrorSample ? {
      actualDelta: maxErrorSample.actualCapacityDelta,
      predictedDelta: maxErrorSample.predictedCapacityDelta,
      error: maxErrorSample.error,
      errorPercent: maxErrorSample.errorPercent
    } : null,
    systematicBias: {
      value: roundTo(systematicBias, 2),
      interpretation: Math.abs(systematicBias) < 0.5
        ? 'No significant systematic bias - predictions match reality'
        : systematicBias > 0
          ? `BMS reports ${roundTo(Math.abs(systematicBias), 2)} Ah more capacity change than predicted - possible unmeasured generation source`
          : `BMS reports ${roundTo(Math.abs(systematicBias), 2)} Ah less capacity change than predicted - possible unmeasured load or BMS calibration issue`
    },
    socAccuracy,
    systemCapacity: {
      configured: systemCapacity,
      note: systemCapacity 
        ? `System configured with ${systemCapacity}Ah capacity (tested capacity, may be higher than rated 314Ah cells)`
        : 'No system capacity configured - unable to validate SOC calculations'
    },
    recommendations: generateValidationRecommendations(status, accuracyRate, systematicBias, inaccurateSamples, socAccuracy)
  };
}

/**
 * Generate validation recommendations
 */
function generateValidationRecommendations(status, accuracyRate, bias, inaccurateSamples, socAccuracy) {
  const recommendations = [];
  
  if (status === 'critical' || status === 'poor') {
    recommendations.push({
      priority: 'high',
      issue: `Prediction accuracy is ${status} (${roundTo(accuracyRate, 0)}%)`,
      action: 'BMS may need recalibration - capacity readings not matching current flow',
      steps: [
        'Check BMS calibration settings',
        'Verify shunt/current sensor accuracy',
        'Consider full charge/discharge calibration cycle'
      ]
    });
  }
  
  if (socAccuracy && socAccuracy.status === 'poor') {
    recommendations.push({
      priority: 'high',
      issue: `SOC% calculations are inaccurate (${socAccuracy.avgErrorPercent}% error)`,
      action: 'BMS capacity setting may be wrong or BMS needs calibration',
      steps: [
        'Verify BMS is configured with correct total capacity (rated capacity for your battery pack)',
        'Check if BMS is reporting tested capacity vs rated capacity',
        'Perform BMS capacity learning cycle (full charge to full discharge)'
      ]
    });
  }
  
  if (Math.abs(bias) > 1) {
    recommendations.push({
      priority: 'medium',
      issue: `Systematic bias detected: ${roundTo(bias, 2)} Ah`,
      action: bias > 0
        ? 'BMS showing more charge than expected - possible unmeasured generation (wind, grid?) or BMS calibration drift'
        : 'BMS showing less charge than expected - possible unmeasured loads or parasitic drain',
      investigation: 'Look for unmeasured energy sources/sinks or recalibrate BMS'
    });
  }
  
  if (inaccurateSamples.length > 5) {
    const avgInaccurateError = inaccurateSamples.reduce((sum, s) => sum + s.errorPercent, 0) / inaccurateSamples.length;
    
    recommendations.push({
      priority: 'low',
      issue: `${inaccurateSamples.length} measurements with >20% error (avg ${roundTo(avgInaccurateError, 0)}% error)`,
      note: 'Some error is normal due to sporadic screenshot timing - not a major concern unless persistent'
    });
  }
  
  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'info',
      message: 'Excellent validation accuracy - BMS measurements align well with current flow predictions'
    });
  }
  
  return recommendations;
}

/**
 * Fallback analysis when location/solar data unavailable
 */
function analyzeFallback(records, voltage, log) {
  log.warn('Using fallback analysis - limited accuracy without location/solar data');
  
  const hourlyLoads = Array(24).fill(null).map(() => ({ samples: [], totalAmps: 0 }));
  
  for (const record of records) {
    const hour = new Date(record.timestamp).getHours();
    const current = record.analysis?.current || 0;
    
    // Only count discharge
    if (current < -0.5) {
      hourlyLoads[hour].samples.push(Math.abs(current));
      hourlyLoads[hour].totalAmps += Math.abs(current);
    }
  }
  
  const hourlyProfile = hourlyLoads.map((h, hour) => ({
    hour,
    trueLoadAmps: h.samples.length > 0 ? roundTo(h.totalAmps / h.samples.length, 2) : 0,
    trueLoadWatts: h.samples.length > 0 ? roundTo((h.totalAmps / h.samples.length) * voltage, 0) : 0,
    samples: h.samples.length
  }));
  
  const totalDailyLoadKwh = hourlyProfile.reduce((sum, h) => sum + (h.trueLoadWatts / 1000), 0);
  
  return {
    hourlyProfile,
    dailySummary: {
      totalLoadKwh: roundTo(totalDailyLoadKwh, 2),
      avgLoadWatts: roundTo(totalDailyLoadKwh * 1000 / 24, 0),
      note: 'Fallback analysis - limited accuracy without location and solar capacity data'
    },
    insufficient_config: true
  };
}

/**
 * Get day of year (1-365)
 */
function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
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
  analyzeSolarAwareLoads,
  calculateSolarIrradiance,
  adjustForClouds
};
