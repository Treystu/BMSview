/**
 * Forecasting Module - Predictive Analytics for Battery Systems
 * 
 * Implements time series analysis, linear regression, and statistical forecasting
 * for battery capacity degradation, efficiency trends, and lifespan prediction.
 * 
 * @module netlify/functions/utils/forecasting
 */

const { getCollection } = require('./mongodb.cjs');
const { BATTERY_REPLACEMENT_THRESHOLDS } = require('./analysis-utilities.cjs');

/**
 * Predict capacity degradation over time using linear regression
 * 
 * @param {string} systemId - Battery system identifier
 * @param {number} forecastDays - Number of days to forecast
 * @param {boolean} confidenceLevel - Include confidence intervals
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Prediction results with trend data
 */
async function predictCapacityDegradation(systemId, forecastDays = 30, confidenceLevel = true, log) {
  log.info('Predicting capacity degradation', { systemId, forecastDays });

  try {
    // Fetch historical capacity data (last 90 days for better trend analysis)
    const historyCollection = await getCollection('history');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: ninetyDaysAgo.toISOString() },
        'analysis.remainingCapacity': { $exists: true, $ne: null }
      })
      .sort({ timestamp: 1 })
      .toArray();

    if (records.length < 10) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient historical data for capacity prediction. Found ${records.length} records, need at least 10 records over time.`,
        systemId,
        dataPoints: records.length
      };
    }

    // Extract capacity values with timestamps
    const dataPoints = records.map(r => ({
      timestamp: new Date(r.timestamp).getTime(),
      capacity: r.analysis.remainingCapacity
    })).filter(p => p.capacity > 0);

    if (dataPoints.length < 10) {
      return {
        error: false,
        insufficient_data: true,
        message: 'Insufficient valid capacity data points for prediction.',
        systemId,
        dataPoints: dataPoints.length
      };
    }

    // Perform linear regression
    const regression = linearRegression(dataPoints);

    // Generate forecast
    const lastTimestamp = dataPoints[dataPoints.length - 1].timestamp;
    const forecastData = [];
    const msPerDay = 24 * 60 * 60 * 1000;

    for (let i = 1; i <= forecastDays; i++) {
      const futureTimestamp = lastTimestamp + (i * msPerDay);
      const predictedCapacity = regression.slope * futureTimestamp + regression.intercept;

      forecastData.push({
        date: new Date(futureTimestamp).toISOString().split('T')[0],
        predictedCapacity: Math.max(0, Math.round(predictedCapacity * 100) / 100),
        daysFromNow: i
      });
    }

    // Calculate confidence metrics if requested
    let confidence = null;
    if (confidenceLevel) {
      const residuals = dataPoints.map(p =>
        p.capacity - (regression.slope * p.timestamp + regression.intercept)
      );
      const stdDev = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length);

      confidence = {
        rSquared: regression.rSquared,
        standardDeviation: Math.round(stdDev * 100) / 100,
        confidenceLevel: regression.rSquared > 0.7 ? 'high' : regression.rSquared > 0.4 ? 'medium' : 'low'
      };
    }

    // Calculate degradation rate (Ah per day)
    const degradationPerDay = Math.abs(regression.slope * msPerDay);

    // Current capacity (latest reading)
    const currentCapacity = dataPoints[dataPoints.length - 1].capacity;

    // Estimated days until replacement threshold
    // Using configurable threshold (default 80% for lithium batteries)
    // For lead-acid batteries, use BATTERY_REPLACEMENT_THRESHOLDS.leadAcid (70%)
    const replacementThresholdPercent = BATTERY_REPLACEMENT_THRESHOLDS.default;
    const capacityThreshold = currentCapacity * replacementThresholdPercent;
    const daysToThreshold = degradationPerDay > 0
      ? Math.round((currentCapacity - capacityThreshold) / degradationPerDay)
      : null;

    log.info('Capacity degradation prediction completed', {
      systemId,
      dataPoints: dataPoints.length,
      degradationPerDay: Math.round(degradationPerDay * 100) / 100,
      rSquared: regression.rSquared
    });

    return {
      systemId,
      metric: 'capacity',
      currentCapacity: Math.round(currentCapacity * 100) / 100,
      degradationRate: {
        value: Math.round(degradationPerDay * 100) / 100,
        unit: 'Ah/day',
        trend: regression.slope < 0 ? 'decreasing' : 'stable'
      },
      forecast: forecastData,
      daysToReplacementThreshold: daysToThreshold,
      replacementThreshold: Math.round(capacityThreshold * 100) / 100,
      confidence,
      historicalDataPoints: dataPoints.length,
      timeRange: {
        start: new Date(dataPoints[0].timestamp).toISOString().split('T')[0],
        end: new Date(dataPoints[dataPoints.length - 1].timestamp).toISOString().split('T')[0]
      }
    };

  } catch (error) {
    log.error('Capacity degradation prediction failed', {
      error: error.message,
      systemId
    });
    throw error;
  }
}

/**
 * Simple linear regression implementation
 * Returns slope, intercept, and R-squared
 * 
 * @param {Array<{timestamp: number, capacity: number}>} dataPoints - Data points for regression
 * @returns {Object} Regression results
 */
function linearRegression(dataPoints) {
  const n = dataPoints.length;

  // Calculate means
  const meanX = dataPoints.reduce((sum, p) => sum + p.timestamp, 0) / n;
  const meanY = dataPoints.reduce((sum, p) => sum + p.capacity, 0) / n;

  // Calculate slope and intercept
  let numerator = 0;
  let denominator = 0;

  for (const point of dataPoints) {
    const xDiff = point.timestamp - meanX;
    const yDiff = point.capacity - meanY;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;

  // Calculate R-squared
  const predictedValues = dataPoints.map(p => slope * p.timestamp + intercept);
  const ssRes = dataPoints.reduce((sum, p, i) =>
    sum + Math.pow(p.capacity - predictedValues[i], 2), 0
  );
  const ssTot = dataPoints.reduce((sum, p) =>
    sum + Math.pow(p.capacity - meanY, 2), 0
  );

  const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;

  return {
    slope,
    intercept,
    rSquared: Math.max(0, Math.min(1, rSquared))
  };
}

/**
 * Predict charge/discharge efficiency trends
 */
async function predictEfficiency(systemId, forecastDays, confidenceLevel, log) {
  log.info('Predicting efficiency trends', { systemId, forecastDays });

  try {
    const historyCollection = await getCollection('history');
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: sixtyDaysAgo.toISOString() },
        'analysis.current': { $exists: true },
        'analysis.power': { $exists: true }
      })
      .sort({ timestamp: 1 })
      .toArray();

    if (records.length < 10) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient data for efficiency prediction. Found ${records.length} records.`,
        systemId
      };
    }

    // Calculate efficiency metrics from historical data
    // Efficiency = (Energy Out) / (Energy In) during charge/discharge cycles
    const efficiencyData = [];

    for (const record of records) {
      const { current, power, stateOfCharge } = record.analysis;
      if (current && power && stateOfCharge) {
        // Simple efficiency proxy: power/current ratio stability
        const efficiency = Math.abs(current) > 0.1 ? Math.abs(power / current) : null;
        if (efficiency && efficiency < 100) { // Filter outliers
          efficiencyData.push({
            timestamp: new Date(record.timestamp).getTime(),
            efficiency,
            soc: stateOfCharge
          });
        }
      }
    }

    if (efficiencyData.length < 5) {
      return {
        error: false,
        insufficient_data: true,
        message: 'Insufficient efficiency data points for analysis.',
        systemId
      };
    }

    // Calculate average efficiency and trend
    const avgEfficiency = efficiencyData.reduce((sum, d) => sum + d.efficiency, 0) / efficiencyData.length;
    const regression = linearRegression(efficiencyData.map(d => ({ timestamp: d.timestamp, capacity: d.efficiency })));

    return {
      systemId,
      metric: 'efficiency',
      currentEfficiency: Math.round(avgEfficiency * 100) / 100,
      trend: regression.slope < -0.0001 ? 'decreasing' : regression.slope > 0.0001 ? 'increasing' : 'stable',
      rateOfChange: Math.round(regression.slope * 1000000) / 1000000,
      confidence: confidenceLevel ? {
        rSquared: regression.rSquared,
        confidenceLevel: regression.rSquared > 0.5 ? 'medium' : 'low'
      } : null,
      dataPoints: efficiencyData.length,
      message: 'Efficiency tracking based on power/current ratio analysis. Stable values indicate good battery health.'
    };

  } catch (error) {
    log.error('Efficiency prediction failed', { error: error.message, systemId });
    throw error;
  }
}

/**
 * Predict temperature patterns
 */
async function predictTemperature(systemId, forecastDays, confidenceLevel, log) {
  log.info('Predicting temperature patterns', { systemId, forecastDays });

  return {
    systemId,
    metric: 'temperature',
    message: 'Temperature prediction requires weather data integration. Use historical temperature data to identify thermal management issues.',
    suggestion: 'Check for temperature anomalies using the analyze_usage_patterns tool with patternType="anomalies"'
  };
}

/**
 * Predict voltage trends
 */
async function predictVoltage(systemId, forecastDays, confidenceLevel, log) {
  log.info('Predicting voltage trends', { systemId, forecastDays });

  return {
    systemId,
    metric: 'voltage',
    message: 'Voltage prediction is best analyzed through capacity degradation trends. Voltage should remain stable unless there are cell balance issues.',
    suggestion: 'Use predict_battery_trends with metric="capacity" for degradation analysis, or check cell voltage differences in historical data.'
  };
}

/**
 * Predict battery SERVICE LIFE (time until replacement threshold based on degradation)
 * 
 * NOTE: This is NOT the same as "runtime" or "autonomy" (how long until discharge).
 * This predicts when the battery will reach end-of-service-life (typically 70% capacity).
 * For runtime calculations, use the energy budget tools (daysOfAutonomy).
 */
async function predictLifetime(systemId, confidenceLevel, log) {
  log.info('Predicting battery service lifetime', { systemId });

  try {
    // Use capacity degradation to estimate lifetime
    const capacityPrediction = await predictCapacityDegradation(systemId, 365, confidenceLevel, log);

    if (capacityPrediction.error || capacityPrediction.insufficient_data) {
      return capacityPrediction;
    }

    const { currentCapacity, degradationRate, daysToReplacementThreshold } = capacityPrediction;

    // Estimate total service lifetime based on degradation rate
    // Assume battery is replaced at 70% of original capacity
    // Estimate original capacity from system data or use current + degradation extrapolation

    let estimatedMonthsRemaining = null;
    let estimatedYearsRemaining = null;

    if (daysToReplacementThreshold && daysToReplacementThreshold > 0) {
      estimatedMonthsRemaining = Math.round(daysToReplacementThreshold / 30);
      estimatedYearsRemaining = Math.round((daysToReplacementThreshold / 365) * 10) / 10;
    }

    return {
      systemId,
      metric: 'lifetime',
      currentCapacity,
      degradationRate: degradationRate.value,
      estimatedRemainingLife: {
        days: daysToReplacementThreshold,
        months: estimatedMonthsRemaining,
        years: estimatedYearsRemaining
      },
      replacementThreshold: capacityPrediction.replacementThreshold,
      confidence: capacityPrediction.confidence,
      note: 'SERVICE LIFE estimate based on capacity degradation trends until replacement threshold (70% capacity). This is NOT runtime/autonomy. Actual service life may vary based on usage patterns, temperature, and maintenance.',
      recommendation: degradationRate.value > 0.5
        ? 'High degradation rate detected. Consider reviewing charging practices and temperature management.'
        : 'Normal degradation rate. Continue monitoring monthly.'
    };

  } catch (error) {
    log.error('Lifetime prediction failed', { error: error.message, systemId });
    throw error;
  }
}

module.exports = {
  linearRegression,
  predictCapacityDegradation,
  predictEfficiency,
  predictTemperature,
  predictVoltage,
  predictLifetime
};
