// @ts-nocheck
/**
 * Weather Analysis Utility
 *
 * Analyzes weather impact on battery performance and solar generation.
 * Provides temperature-based capacity adjustments and weather warnings.
 */

const { createLogger } = require('./logger.cjs');

/**
 * Analyze weather impact on battery performance
 *
 * @param {Object} params
 * @param {Object} params.weatherData - Weather data from API
 * @param {Object} params.analysisData - BMS analysis data
 * @param {Object} params.systemConfig - System configuration
 * @param {any} log - Logger instance
 * @returns {Object} Weather impact analysis
 */
function analyzeWeatherImpact(params, log) {
  const { weatherData, analysisData, systemConfig } = params;

  if (!weatherData) {
    log.debug('No weather data available for analysis');
    return null;
  }

  try {
    // Temperature impact on capacity
    const temperatureImpact = analyzeTemperatureImpact(
      weatherData.temp || weatherData.temperature,
      analysisData,
      log
    );

    // Cloud cover impact on solar
    const cloudImpact = analyzeCloudImpact(
      weatherData.clouds,
      log
    );

    // Generate weather warnings
    const warnings = generateWeatherWarnings(
      temperatureImpact,
      cloudImpact,
      weatherData,
      log
    );

    const analysis = {
      temperature: temperatureImpact,
      cloudCover: cloudImpact,
      warnings,
      conditions: weatherData.weather_main || weatherData.description || 'Unknown',
      timestamp: new Date().toISOString()
    };

    log.info('Weather impact analyzed', {
      tempImpact: temperatureImpact.capacityAdjustment,
      cloudImpact: cloudImpact.solarReduction,
      warningCount: warnings.length
    });

    return analysis;

  } catch (error) {
    log.error('Failed to analyze weather impact', {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Analyze temperature impact on battery capacity
 *
 * Battery capacity is temperature-dependent:
 * - Optimal: 20-25°C (68-77°F)
 * - Cold: -2% per 5°C below 25°C
 * - Hot: +1% per 5°C above 25°C (but increased degradation)
 *
 * @param {number} temperature - Temperature in Celsius
 * @param {Object} analysisData - BMS analysis data
 * @param {any} log
 * @returns {Object} Temperature impact analysis
 */
function analyzeTemperatureImpact(temperature, analysisData, log) {
  const optimalTemp = 25; // 25°C is optimal for lithium batteries

  // Calculate temperature delta from optimal
  const tempDelta = temperature - optimalTemp;

  // Calculate capacity adjustment factor
  let capacityAdjustment = 0;

  if (temperature < optimalTemp) {
    // Cold: -2% per 5°C below optimal
    capacityAdjustment = (tempDelta / 5) * -2;
  } else if (temperature > optimalTemp) {
    // Hot: +1% per 5°C above optimal (but warn about degradation)
    capacityAdjustment = (tempDelta / 5) * 1;
  }

  // Cap adjustment at reasonable limits (-30% to +10%)
  capacityAdjustment = Math.max(-30, Math.min(10, capacityAdjustment));

  // Determine severity
  const severity = temperature < 0 ? 'high'
    : temperature < 10 ? 'medium'
    : temperature > 40 ? 'medium'
    : temperature > 50 ? 'high'
    : 'low';

  const impact = {
    temperature,
    tempDelta,
    capacityAdjustment: Math.round(capacityAdjustment),
    severity,
    description: generateTempDescription(temperature, capacityAdjustment)
  };

  log.debug('Temperature impact calculated', {
    temp: temperature,
    adjustment: impact.capacityAdjustment,
    severity
  });

  return impact;
}

/**
 * Analyze cloud cover impact on solar generation
 *
 * Cloud cover reduces solar generation:
 * - 0-20%: Minimal impact (-5%)
 * - 20-50%: Moderate impact (-25%)
 * - 50-80%: Significant impact (-60%)
 * - 80-100%: Severe impact (-85%)
 *
 * @param {number} cloudCover - Cloud cover percentage (0-100)
 * @param {any} log
 * @returns {Object} Cloud impact analysis
 */
function analyzeCloudImpact(cloudCover, log) {
  if (cloudCover === undefined || cloudCover === null) {
    return {
      cloudCover: null,
      solarReduction: 0,
      severity: 'unknown',
      description: 'Cloud cover data not available'
    };
  }

  // Calculate solar reduction based on cloud cover
  let solarReduction = 0;
  let severity = 'low';
  let description = '';

  if (cloudCover < 20) {
    solarReduction = 5;
    severity = 'low';
    description = 'Clear conditions - excellent solar generation expected';
  } else if (cloudCover < 50) {
    solarReduction = 25;
    severity = 'low';
    description = 'Partly cloudy - solar generation moderately reduced';
  } else if (cloudCover < 80) {
    solarReduction = 60;
    severity = 'medium';
    description = 'Mostly cloudy - solar generation significantly reduced';
  } else {
    solarReduction = 85;
    severity = 'high';
    description = 'Overcast - solar generation severely limited';
  }

  const impact = {
    cloudCover,
    solarReduction,
    severity,
    description
  };

  log.debug('Cloud cover impact calculated', {
    clouds: cloudCover,
    reduction: solarReduction,
    severity
  });

  return impact;
}

/**
 * Generate weather warnings for user
 *
 * @param {Object} temperatureImpact
 * @param {Object} cloudImpact
 * @param {Object} weatherData
 * @param {any} log
 * @returns {Array<Object>} Weather warnings
 */
function generateWeatherWarnings(temperatureImpact, cloudImpact, weatherData, log) {
  const warnings = [];

  // Temperature warnings
  if (temperatureImpact.severity === 'high' || temperatureImpact.severity === 'medium') {
    warnings.push({
      type: 'temperature',
      severity: temperatureImpact.severity,
      message: temperatureImpact.description,
      value: `${temperatureImpact.temperature}°C`,
      impact: `${temperatureImpact.capacityAdjustment}% capacity adjustment`
    });
  }

  // Cloud cover warnings
  if (cloudImpact.severity === 'high' || cloudImpact.severity === 'medium') {
    warnings.push({
      type: 'cloud_cover',
      severity: cloudImpact.severity,
      message: cloudImpact.description,
      value: `${cloudImpact.cloudCover}% cloud cover`,
      impact: `Solar generation reduced by ${cloudImpact.solarReduction}%`
    });
  }

  // UV index warnings (if available)
  if (weatherData.uvi !== undefined && weatherData.uvi !== null) {
    if (weatherData.uvi < 2) {
      warnings.push({
        type: 'low_uv',
        severity: 'low',
        message: 'Low UV index - reduced solar generation expected',
        value: `UV Index: ${weatherData.uvi}`,
        impact: 'Solar charging may be slower than normal'
      });
    }
  }

  log.debug('Generated weather warnings', { count: warnings.length });

  return warnings;
}

/**
 * Generate temperature description for user
 *
 * @param {number} temperature
 * @param {number} capacityAdjustment
 * @returns {string}
 */
function generateTempDescription(temperature, capacityAdjustment) {
  if (temperature < 0) {
    return `Freezing conditions (${temperature}°C) - Battery capacity severely reduced. Expect ${Math.abs(capacityAdjustment)}% less runtime.`;
  } else if (temperature < 10) {
    return `Cold conditions (${temperature}°C) - Battery capacity reduced. Expect ${Math.abs(capacityAdjustment)}% less runtime.`;
  } else if (temperature < 20) {
    return `Cool conditions (${temperature}°C) - Battery capacity slightly reduced. Expect ${Math.abs(capacityAdjustment)}% less runtime.`;
  } else if (temperature <= 30) {
    return `Optimal conditions (${temperature}°C) - Battery operating at full capacity.`;
  } else if (temperature <= 40) {
    return `Warm conditions (${temperature}°C) - Battery capacity slightly increased, but watch for increased degradation.`;
  } else if (temperature <= 50) {
    return `Hot conditions (${temperature}°C) - Risk of thermal stress. Monitor battery temperature closely.`;
  } else {
    return `Extreme heat (${temperature}°C) - CRITICAL: Risk of thermal damage. Reduce load immediately.`;
  }
}

/**
 * Calculate adjusted capacity based on temperature
 *
 * @param {number} nominalCapacity - Nominal battery capacity (Ah)
 * @param {number} temperature - Current temperature (°C)
 * @param {any} log
 * @returns {number} Adjusted capacity (Ah)
 */
function calculateAdjustedCapacity(nominalCapacity, temperature, log) {
  if (!nominalCapacity || !temperature) {
    return nominalCapacity;
  }

  const tempImpact = analyzeTemperatureImpact(temperature, {}, log);
  const adjustmentFactor = 1 + (tempImpact.capacityAdjustment / 100);
  const adjustedCapacity = nominalCapacity * adjustmentFactor;

  log.debug('Calculated adjusted capacity', {
    nominal: nominalCapacity,
    adjusted: adjustedCapacity,
    adjustment: tempImpact.capacityAdjustment
  });

  return Math.round(adjustedCapacity * 100) / 100; // Round to 2 decimals
}

module.exports = {
  analyzeWeatherImpact,
  analyzeTemperatureImpact,
  analyzeCloudImpact,
  generateWeatherWarnings,
  calculateAdjustedCapacity
};
