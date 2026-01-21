// @ts-nocheck
/**
 * Solar Correlation Utility
 *
 * Calculates solar generation efficiency by comparing expected solar output
 * to actual battery charging. Accounts for daytime load consumption.
 *
 * CRITICAL INTERPRETATION:
 * Delta between expected and actual charge often represents daytime load,
 * NOT solar underperformance.
 *
 * Formula: expectedSolar - actualCharge = daytimeLoad
 *
 * Only flag solar issues when:
 * - Variance >15% AND weather was favorable (low clouds, good irradiance)
 */

const { createLogger } = require('./logger.cjs');

/**
 * Calculate solar correlation for an analysis record
 *
 * @param {Object} params
 * @param {Object} params.analysisData - BMS analysis data
 * @param {Object} params.solarEstimate - Solar estimate data from API
 * @param {Object} params.weatherData - Weather data (optional)
 * @param {Object} params.systemConfig - System configuration
 * @param {any} log - Logger instance
 * @returns {Promise<Object>} Solar correlation data
 */
async function calculateSolarCorrelation(params, log) {
  const { analysisData, solarEstimate, weatherData, systemConfig } = params;

  if (!solarEstimate || !solarEstimate.dailyEstimates) {
    log.debug('No solar estimate data available for correlation');
    return null;
  }

  try {
    // Extract analysis timestamp
    const analysisTimestamp = analysisData.timestamp || new Date().toISOString();
    const analysisDate = analysisTimestamp.split('T')[0]; // YYYY-MM-DD

    // Find matching daily estimate
    const dailyEstimate = solarEstimate.dailyEstimates.find(
      day => day.date === analysisDate
    );

    if (!dailyEstimate) {
      log.debug('No solar estimate for analysis date', { analysisDate });
      return null;
    }

    // Calculate expected solar generation for the day (Wh)
    const expectedSolarWh = dailyEstimate.estimatedWh;

    // Calculate actual battery charge from BMS data
    const actualChargeWh = calculateActualCharge(analysisData, systemConfig, log);

    if (actualChargeWh === null) {
      log.debug('Could not calculate actual charge from BMS data');
      return null;
    }

    // Calculate efficiency (percentage)
    const efficiency = expectedSolarWh > 0
      ? Math.round((actualChargeWh / expectedSolarWh) * 100)
      : 0;

    // Calculate daytime load (the "missing" energy)
    const daytimeLoadWh = Math.max(0, expectedSolarWh - actualChargeWh);

    // Determine if this represents solar underperformance or just high load
    const solarIssue = detectSolarIssue(
      efficiency,
      expectedSolarWh,
      actualChargeWh,
      weatherData,
      log
    );

    // Determine if daytime (for display purposes)
    const isDaytime = checkIsDaytime(analysisTimestamp, solarEstimate.hourlyBreakdown);

    const correlation = {
      expectedSolarWh,
      actualChargeWh,
      efficiency,
      daytimeLoadWh,
      solarIssue,
      isDaytime,
      date: analysisDate,
      weatherImpact: weatherData ? calculateWeatherImpact(weatherData) : null
    };

    log.info('Solar correlation calculated', {
      expectedWh: expectedSolarWh,
      actualWh: actualChargeWh,
      efficiency,
      daytimeLoadWh,
      hasSolarIssue: solarIssue.detected
    });

    return correlation;

  } catch (error) {
    log.error('Failed to calculate solar correlation', {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Calculate actual battery charge from BMS data
 *
 * Uses current and SOC data to estimate energy added to battery.
 *
 * @param {Object} analysisData
 * @param {Object} systemConfig
 * @param {any} log
 * @returns {number|null} Actual charge in Wh
 */
function calculateActualCharge(analysisData, systemConfig, log) {
  try {
    // Method 1: Use current × voltage × time (if current data available)
    if (analysisData.current && analysisData.overallVoltage) {
      const current = analysisData.current; // Amps
      const voltage = analysisData.overallVoltage; // Volts

      // If current is positive (charging), estimate energy added
      if (current > 0) {
        // Assume snapshot represents 1 hour of charging (conservative estimate)
        const estimatedHours = 1;
        const chargeWh = current * voltage * estimatedHours;

        log.debug('Calculated charge from current', {
          current,
          voltage,
          hours: estimatedHours,
          chargeWh
        });

        return Math.round(chargeWh);
      }
    }

    // Method 2: Use SOC change (if available)
    if (analysisData.stateOfCharge && systemConfig?.fullCapacityAh) {
      const soc = analysisData.stateOfCharge; // Percentage
      const capacityAh = systemConfig.fullCapacityAh;
      const voltage = systemConfig.nominalVoltage || analysisData.overallVoltage || 48;

      // Estimate charge based on current SOC
      // This is less accurate but better than nothing
      const currentCapacityAh = (soc / 100) * capacityAh;
      const chargeWh = currentCapacityAh * voltage;

      log.debug('Estimated charge from SOC', {
        soc,
        capacityAh,
        voltage,
        chargeWh
      });

      return Math.round(chargeWh);
    }

    log.debug('Insufficient data to calculate actual charge');
    return null;

  } catch (error) {
    log.error('Error calculating actual charge', { error: error.message });
    return null;
  }
}

/**
 * Detect if low efficiency represents actual solar issue or just high load
 *
 * Only flag solar issues when variance >15% AND weather was favorable.
 *
 * @param {number} efficiency - Calculated efficiency (%)
 * @param {number} expectedWh - Expected solar generation
 * @param {number} actualWh - Actual charge measured
 * @param {Object|null} weatherData - Weather data
 * @param {any} log
 * @returns {Object} Solar issue detection result
 */
function detectSolarIssue(efficiency, expectedWh, actualWh, weatherData, log) {
  const variance = Math.abs(100 - efficiency);

  // If efficiency is within 15%, consider it normal
  if (variance <= 15) {
    return {
      detected: false,
      reason: 'normal',
      message: 'Solar efficiency within expected range'
    };
  }

  // If weather was poor, explain reduced solar as expected
  if (weatherData) {
    const cloudCover = weatherData.clouds || 0;

    if (cloudCover > 70) {
      return {
        detected: false,
        reason: 'weather',
        message: `Heavy cloud cover (${cloudCover}%) explains reduced solar output`
      };
    }

    if (cloudCover > 40) {
      return {
        detected: false,
        reason: 'weather',
        message: `Moderate cloud cover (${cloudCover}%) likely reduced solar output`
      };
    }
  }

  // If efficiency is low despite good weather, flag potential solar issue
  if (efficiency < 70) {
    return {
      detected: true,
      reason: 'underperformance',
      message: 'Solar efficiency significantly below expected despite favorable weather. Check panel orientation, shading, or connections.',
      severity: efficiency < 50 ? 'high' : 'medium'
    };
  }

  // Otherwise, assume high daytime load
  return {
    detected: false,
    reason: 'high_load',
    message: 'Expected solar generation exceeded battery charge - likely due to daytime power consumption'
  };
}

/**
 * Check if analysis timestamp is during daytime
 *
 * @param {string} timestamp - ISO 8601 timestamp
 * @param {Array} hourlyBreakdown - Hourly solar data
 * @returns {boolean}
 */
function checkIsDaytime(timestamp, hourlyBreakdown) {
  if (!hourlyBreakdown || hourlyBreakdown.length === 0) {
    // Assume daytime if no data (better UX than hiding solar)
    return true;
  }

  // Find matching hour in breakdown
  const hour = timestamp.substring(0, 13); // YYYY-MM-DDTHH
  const matchingHour = hourlyBreakdown.find(
    h => h.timestamp && h.timestamp.startsWith(hour)
  );

  if (matchingHour) {
    return matchingHour.is_daylight || false;
  }

  // Default to daytime if no match
  return true;
}

/**
 * Calculate weather impact on solar generation
 *
 * @param {Object} weatherData
 * @returns {Object} Weather impact analysis
 */
function calculateWeatherImpact(weatherData) {
  const cloudCover = weatherData.clouds || 0;
  const temperature = weatherData.temperature;

  // Cloud factor: 0% at 0% clouds, 80% at 100% clouds
  const cloudFactor = cloudCover * 0.008; // 0.8 / 100
  const expectedReduction = Math.round(cloudFactor * 100);

  return {
    cloudCover,
    temperature,
    expectedReduction,
    description: cloudCover > 70
      ? 'Heavy cloud cover significantly reducing solar output'
      : cloudCover > 40
        ? 'Moderate cloud cover may reduce solar output'
        : 'Clear conditions favorable for solar generation'
  };
}

/**
 * Fetch solar estimate from solar-estimate function
 *
 * @param {Object} params
 * @param {string} params.location - Zip code or "lat,lon"
 * @param {number} params.panelWatts - Panel wattage
 * @param {string} params.date - Date in YYYY-MM-DD format
 * @param {any} log
 * @returns {Promise<Object|null>} Solar estimate data
 */
async function fetchSolarEstimate(params, log) {
  const { location, panelWatts, date } = params;

  if (!location || !panelWatts || !date) {
    log.debug('Missing required parameters for solar estimate', { location, panelWatts, date });
    return null;
  }

  try {
    // Use internal Netlify function URL
    const baseUrl = process.env.URL || 'http://localhost:8888';
    const url = new URL('/.netlify/functions/solar-estimate', baseUrl);

    url.searchParams.append('location', location);
    url.searchParams.append('panelWatts', panelWatts.toString());
    url.searchParams.append('startDate', date);
    url.searchParams.append('endDate', date); // Same day for snapshot analysis

    log.debug('Fetching solar estimate', { url: url.toString().replace(/appid=[^&]+/, 'appid=***') });

    const response = await fetch(url.toString());

    if (!response.ok) {
      log.warn('Solar estimate fetch failed', { status: response.status });
      return null;
    }

    const data = await response.json();

    log.info('Solar estimate fetched successfully', {
      dailyEstimates: data.dailyEstimates?.length || 0
    });

    return data;

  } catch (error) {
    log.error('Failed to fetch solar estimate', {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

module.exports = {
  calculateSolarCorrelation,
  fetchSolarEstimate,
  calculateActualCharge,
  detectSolarIssue,
  calculateWeatherImpact
};
