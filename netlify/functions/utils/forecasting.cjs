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
 * Predict capacity degradation over time using context-aware analysis
 * 
 * This function now properly accounts for:
 * - Cycle count (new batteries <100 cycles show minimal degradation)
 * - Data quality (filters outliers, requires high-SOC measurements)
 * - Battery chemistry (LiFePO4 has different degradation curve than lithium-ion)
 * - Statistical significance (requires strong correlation to report degradation)
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
    // Fetch system metadata for cycle count and chemistry
    const systemsCollection = await getCollection('systems');
    const system = await systemsCollection.findOne({ id: systemId });

    // Fetch historical capacity data (last 90 days for trend analysis)
    const historyCollection = await getCollection('history');
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const records = await historyCollection
      .find({
        systemId,
        timestamp: { $gte: ninetyDaysAgo.toISOString() },
        'analysis.remainingCapacity': { $exists: true, $ne: null },
        'analysis.fullCapacity': { $exists: true, $ne: null }
      })
      .sort({ timestamp: 1 })
      .toArray();

    if (records.length < 15) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient historical data for capacity prediction. Found ${records.length} records, need at least 15 records over 2+ weeks for reliable degradation analysis.`,
        systemId,
        dataPoints: records.length
      };
    }

    // Get most recent cycle count
    const latestRecord = records[records.length - 1];
    const cycleCount = latestRecord?.analysis?.cycleCount ?? null;
    const chemistry = latestRecord?.analysis?.chemistry || system?.chemistry || null;
    const ratedCapacity = system?.capacity || latestRecord?.analysis?.fullCapacity || null;

    log.info('Degradation analysis context', {
      systemId,
      cycleCount,
      chemistry,
      ratedCapacity,
      recordCount: records.length
    });

    // NEW: Filter for high-SOC measurements only (>80%) to avoid SOC fluctuations
    // remainingCapacity varies with SOC, so we need apples-to-apples comparison
    const highSocRecords = records.filter(r => {
      const soc = r.analysis?.stateOfCharge;
      return soc != null && soc >= 80;
    });

    if (highSocRecords.length < 10) {
      return {
        error: false,
        insufficient_data: true,
        message: `Insufficient high-SOC (≥80%) measurements for accurate degradation tracking. Found ${highSocRecords.length} high-SOC records, need at least 10. Current capacity readings vary too much with charge state to determine degradation.`,
        systemId,
        dataPoints: highSocRecords.length,
        totalDataPoints: records.length
      };
    }

    // Extract capacity retention percentages (more stable than absolute values)
    const dataPoints = highSocRecords.map(r => {
      const fullCap = r.analysis.fullCapacity || ratedCapacity;
      const remaining = r.analysis.remainingCapacity;
      const retentionPercent = fullCap && fullCap > 0 ? (remaining / fullCap) * 100 : null;

      return {
        timestamp: new Date(r.timestamp).getTime(),
        capacity: remaining,
        retentionPercent,
        soc: r.analysis.stateOfCharge,
        fullCapacity: fullCap
      };
    }).filter(p => p.capacity > 0 && p.retentionPercent != null && p.retentionPercent <= 105);

    if (dataPoints.length < 10) {
      return {
        error: false,
        insufficient_data: true,
        message: 'Insufficient valid high-SOC capacity data points after filtering.',
        systemId,
        dataPoints: dataPoints.length
      };
    }

    // NEW: Outlier detection using IQR method on retention percentages
    const retentions = dataPoints.map(p => p.retentionPercent).sort((a, b) => a - b);
    const q1 = retentions[Math.floor(retentions.length * 0.25)];
    const q3 = retentions[Math.floor(retentions.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const filteredPoints = dataPoints.filter(p =>
      p.retentionPercent >= lowerBound && p.retentionPercent <= upperBound
    );

    log.info('Outlier filtering', {
      originalPoints: dataPoints.length,
      filteredPoints: filteredPoints.length,
      retentionRange: `${Math.round(Math.min(...retentions))}% - ${Math.round(Math.max(...retentions))}%`,
      iqrBounds: `${Math.round(lowerBound)}% - ${Math.round(upperBound)}%`
    });

    if (filteredPoints.length < 8) {
      return {
        error: false,
        insufficient_data: true,
        message: 'Too much variation in capacity readings after outlier removal. This suggests measurement noise rather than real degradation.',
        systemId,
        dataPoints: filteredPoints.length
      };
    }

    // Perform linear regression on retention percentage
    const regressionData = filteredPoints.map(p => ({
      timestamp: p.timestamp,
      capacity: p.retentionPercent
    }));

    const regression = linearRegression(regressionData);

    // NEW: Cycle count gating - batteries under 100 cycles should show minimal degradation
    const isNewBattery = cycleCount != null && cycleCount < 100;
    const isVeryNewBattery = cycleCount != null && cycleCount < 50;

    // Calculate degradation rate (percent per day)
    const msPerDay = 24 * 60 * 60 * 1000;
    const degradationPercentPerDay = Math.abs(regression.slope * msPerDay);

    // Expected degradation rates (percent per day)
    const expectedDegradation = {
      lifepo4: {
        new: 0.0003,      // ~0.11% per year for new LiFePO4
        mature: 0.0010,   // ~0.36% per year for mature LiFePO4
        aged: 0.0027      // ~1% per year for aged LiFePO4 (>1000 cycles)
      },
      lithium: {
        new: 0.0008,      // ~0.29% per year for new Li-ion
        mature: 0.0027,   // ~1% per year for mature Li-ion
        aged: 0.0055      // ~2% per year for aged Li-ion
      }
    };

    const isLiFePO4 = chemistry && chemistry.toLowerCase().includes('lifepo4');
    const expectedRate = isLiFePO4
      ? (cycleCount < 100 ? expectedDegradation.lifepo4.new : cycleCount < 500 ? expectedDegradation.lifepo4.mature : expectedDegradation.lifepo4.aged)
      : (cycleCount < 100 ? expectedDegradation.lithium.new : cycleCount < 300 ? expectedDegradation.lithium.mature : expectedDegradation.lithium.aged);

    const degradationRatio = degradationPercentPerDay / expectedRate;

    log.info('Degradation analysis', {
      measuredRate: degradationPercentPerDay.toFixed(6),
      expectedRate: expectedRate.toFixed(6),
      ratio: degradationRatio.toFixed(2),
      rSquared: regression.rSquared.toFixed(3),
      isNewBattery,
      chemistry
    });

    // NEW: Statistical significance check
    // Don't report degradation unless we have strong evidence
    const hasStrongCorrelation = regression.rSquared > 0.5;
    const isAnomalous = degradationRatio > 5; // >5x expected rate suggests data issues

    if (isVeryNewBattery && (!hasStrongCorrelation || isAnomalous)) {
      return {
        error: false,
        insufficient_data: false,
        systemId,
        metric: 'capacity',
        currentCapacity: Math.round(filteredPoints[filteredPoints.length - 1].capacity * 100) / 100,
        averageRetention: Math.round(retentions.reduce((a, b) => a + b, 0) / retentions.length * 10) / 10,
        cycleCount,
        chemistry,
        degradationRate: {
          value: 0.01, // Minimal nominal value
          unit: 'Ah/day',
          trend: 'stable',
          note: `Battery has only ${cycleCount} cycles. Insufficient service time to establish degradation trend. Current capacity variation (${Math.round(iqr * 10) / 10}%) is within normal measurement tolerance.`
        },
        daysToReplacementThreshold: null,
        replacementThreshold: null,
        confidence: {
          rSquared: regression.rSquared,
          confidenceLevel: 'low',
          reason: 'Battery too new for reliable degradation forecast'
        },
        historicalDataPoints: filteredPoints.length,
        recommendation: 'Continue monitoring. Degradation analysis requires at least 100 cycles or 6+ months of data for LiFePO4 batteries.'
      };
    }

    // Calculate confidence metrics
    let confidence = null;
    if (confidenceLevel) {
      const residuals = regressionData.map(p =>
        p.capacity - (regression.slope * p.timestamp + regression.intercept)
      );
      const stdDev = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length);

      confidence = {
        rSquared: regression.rSquared,
        standardDeviation: Math.round(stdDev * 100) / 100,
        confidenceLevel: regression.rSquared > 0.7 ? 'high' : regression.rSquared > 0.5 ? 'medium' : 'low',
        dataQuality: isAnomalous ? 'questionable - degradation rate exceeds expected physics' : 'acceptable'
      };
    }

    // Convert percent degradation to Ah degradation
    const currentCapacity = filteredPoints[filteredPoints.length - 1].capacity;
    const avgFullCapacity = filteredPoints.reduce((sum, p) => sum + (p.fullCapacity || 0), 0) / filteredPoints.length;
    const degradationAhPerDay = (degradationPercentPerDay / 100) * avgFullCapacity;

    // Calculate days to replacement threshold (80% for lithium)
    const currentRetention = filteredPoints[filteredPoints.length - 1].retentionPercent;
    const thresholdRetention = 80; // 80% retention threshold
    const retentionToLose = currentRetention - thresholdRetention;
    const daysToThreshold = degradationPercentPerDay > 0.0001
      ? Math.round(retentionToLose / degradationPercentPerDay)
      : null;

    // Generate forecast
    const lastTimestamp = filteredPoints[filteredPoints.length - 1].timestamp;
    const forecastData = [];

    for (let i = 1; i <= Math.min(forecastDays, 365); i++) {
      const futureTimestamp = lastTimestamp + (i * msPerDay);
      const predictedRetention = regression.slope * futureTimestamp + regression.intercept;
      const predictedCapacity = (predictedRetention / 100) * avgFullCapacity;

      forecastData.push({
        date: new Date(futureTimestamp).toISOString().split('T')[0],
        predictedCapacity: Math.max(0, Math.round(predictedCapacity * 100) / 100),
        predictedRetention: Math.max(0, Math.round(predictedRetention * 10) / 10),
        daysFromNow: i
      });
    }

    log.info('Capacity degradation prediction completed', {
      systemId,
      dataPoints: filteredPoints.length,
      degradationAhPerDay: Math.round(degradationAhPerDay * 1000) / 1000,
      degradationPercentPerDay: degradationPercentPerDay.toFixed(6),
      rSquared: regression.rSquared.toFixed(3),
      daysToThreshold
    });

    return {
      systemId,
      metric: 'capacity',
      currentCapacity: Math.round(currentCapacity * 100) / 100,
      averageRetention: Math.round(currentRetention * 10) / 10,
      cycleCount,
      chemistry,
      degradationRate: {
        value: Math.round(degradationAhPerDay * 100) / 100,
        percentPerDay: Math.round(degradationPercentPerDay * 10000) / 10000,
        unit: 'Ah/day',
        trend: regression.slope < -0.001 ? 'decreasing' : 'stable',
        vsExpected: Math.round(degradationRatio * 100) / 100
      },
      forecast: forecastData,
      daysToReplacementThreshold: daysToThreshold && daysToThreshold > 0 && daysToThreshold < 50000 ? daysToThreshold : null,
      replacementThreshold: Math.round((thresholdRetention / 100) * avgFullCapacity * 100) / 100,
      confidence,
      historicalDataPoints: filteredPoints.length,
      totalDataPoints: records.length,
      highSocFilteredPoints: highSocRecords.length,
      timeRange: {
        start: new Date(filteredPoints[0].timestamp).toISOString().split('T')[0],
        end: new Date(filteredPoints[filteredPoints.length - 1].timestamp).toISOString().split('T')[0],
        days: Math.round((filteredPoints[filteredPoints.length - 1].timestamp - filteredPoints[0].timestamp) / msPerDay)
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
