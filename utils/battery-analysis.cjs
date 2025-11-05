/**
 * @typedef {Object} Measurement
 * @property {string} timestamp - ISO timestamp
 * @property {number} [capacity] - Battery capacity percentage
 * @property {number} [voltage] - Battery voltage
 * @property {number} [current] - Current draw
 * @property {number} [temperature] - Temperature in degrees C
 * @property {number} [stateOfCharge] - State of charge percentage
 */

/**
 * @typedef {Object} BatteryState
 * @property {number} [capacityAh] - Battery capacity in amp-hours
 * @property {number} [capacity] - Battery capacity percentage
 * @property {number} [voltage] - Battery voltage
 * @property {number} [stateOfCharge] - State of charge percentage 
 */

/**
 * @typedef {Object} Performance
 * @property {string} trend - Performance trend (Excellent, Good, Fair, Poor)
 * @property {number} capacityRetention - Capacity retention percentage
 * @property {number} degradationRate - Degradation rate per day
 */

/**
 * @typedef {Object} RuntimeResult
 * @property {number|null} runtimeHours - Estimated runtime in hours
 * @property {string} explanation - Explanation of estimate
 * @property {string} confidence - Confidence level (low|medium|high)
 */

/**
 * @typedef {Object} BatteryData
 * @property {Measurement[]} measurements - Array of battery measurements
 * @property {string} [systemId] - Battery system ID 
 */

/**
 * @typedef {Object} BatteryAnalysisLogger
 * @property {Function} warn - Log warning messages
 * @property {Function} error - Log error messages
 * @property {Function} info - Log info messages
 */

/**
 * Battery health thresholds
 */
const BATTERY_HEALTH_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 80,
  FAIR: 70,
  POOR: 60
};

/**
 * Calculate battery capacity retention
 * @param {Measurement[]} measurements Battery measurements
 * @returns {number} Retention percentage (0-100)
 */
function calculateCapacityRetention(measurements) {
  if (!measurements?.length || measurements.length < 2) return 100;

  const latest = measurements[measurements.length - 1];
  const first = measurements[0];

  if (!latest?.capacity || !first?.capacity) return 100;

  // Calculate retention as percentage
  const retention = (latest.capacity / first.capacity) * 100;

  // Bound between 0-100
  return Math.max(0, Math.min(100, retention));
}

/**
 * Determine battery health status
 * @param {Measurement[]} measurements Battery measurements
 * @param {number} maxTemp Maximum temperature
 * @returns {string} Health status
 */
function determineHealthStatus(measurements, maxTemp) {
  if (!measurements?.length) return 'Unknown';

  const capacityRetention = calculateCapacityRetention(measurements);

  // Calculate average SoC if available
  let avgSoC = 0;
  const socMeasurements = measurements.filter(m => typeof m.stateOfCharge === 'number');
  if (socMeasurements.length > 0) {
    avgSoC = socMeasurements.reduce((sum, m) => sum + (m.stateOfCharge || 0), 0) / socMeasurements.length;
  }

  // Critical conditions
  if (maxTemp > 45 || capacityRetention < BATTERY_HEALTH_THRESHOLDS.POOR) return 'Critical';

  // Health based on capacity retention and state of charge
  if (capacityRetention >= BATTERY_HEALTH_THRESHOLDS.EXCELLENT && avgSoC >= 80) return 'Excellent';
  if (capacityRetention >= BATTERY_HEALTH_THRESHOLDS.GOOD && avgSoC >= 70) return 'Good';
  if (capacityRetention >= BATTERY_HEALTH_THRESHOLDS.FAIR && avgSoC >= 60) return 'Fair';

  return 'Poor';
}

/**
 * Calculate battery performance metrics
 * @param {Measurement[]} measurements Battery measurements
 * @param {number} timeSpan Time span in days
 * @returns {Performance} Performance metrics
 */
function calculatePerformance(measurements, timeSpan) {
  if (!measurements?.length || measurements.length < 2) {
    return { trend: 'Unknown', capacityRetention: 100, degradationRate: 0 };
  }

  const capacityRetention = calculateCapacityRetention(measurements);

  // Calculate degradation per day
  const degradationPerDay = timeSpan > 0 ? ((100 - capacityRetention) / timeSpan) : 0;
  const degradationRate = Math.max(0, Math.min(10, degradationPerDay));

  // Determine trend based on retention
  const trend = capacityRetention >= 90 ? 'Excellent' :
    capacityRetention >= 80 ? 'Good' :
      capacityRetention >= 70 ? 'Fair' : 'Poor';

  return {
    trend,
    capacityRetention: Math.round(capacityRetention * 10) / 10,
    degradationRate: Math.round(degradationRate * 100) / 100
  };
}

/**
 * Calculate charge efficiency 
 * @param {Measurement[]} measurements Battery measurements
 * @returns {number} Efficiency percentage
 */
function calculateChargeEfficiency(measurements) {
  if (!measurements?.length) return 0; // Return 0 for no data

  // Get charge cycles with valid current and voltage
  const chargeCycles = measurements.filter(m =>
    typeof m?.current === 'number' &&
    typeof m?.voltage === 'number' &&
    m.current > 0
  );

  if (!chargeCycles.length) return 0; // Return 0 if no charge cycles

  // Calculate average charging metrics
  const avgCurrent = chargeCycles.reduce((sum, m) => m.current ? sum + m.current : sum, 0) / chargeCycles.length;
  const maxTemp = Math.max(...measurements.map(m => m.temperature || 25));

  // Start with baseline efficiency and adjust based on factors
  let efficiency = 98;

  // High charging current reduces efficiency
  if (avgCurrent > 0.3) {
    efficiency -= Math.min(8, avgCurrent * 2);
  }

  // High temperature reduces efficiency
  if (maxTemp > 35) {
    efficiency -= Math.min(5, (maxTemp - 35) * 0.5);
  }

  // Ensure reasonable bounds
  return Math.round(Math.max(85, Math.min(98, efficiency)));
}

/**
 * Calculate runtime estimate
 * @param {Measurement[]} measurements Battery measurements
 * @param {BatteryState} lastKnown Last known battery state
 * @returns {RuntimeResult} Runtime estimate
 */
function calculateRuntimeEstimate(measurements, lastKnown = {}) {
  const msToHours = (ms) => ms / (1000 * 60 * 60);

  // Default conservative estimate
  const defaultResult = {
    runtimeHours: null,
    explanation: 'Insufficient data for runtime estimate',
    confidence: 'low'
  };

  if (!measurements?.length) return defaultResult;

  // Get capacity and voltage from measurements or lastKnown
  const capacity = lastKnown.capacityAh || lastKnown.capacity ||
    measurements[measurements.length - 1]?.capacity || null;
  const voltage = lastKnown.voltage || measurements[measurements.length - 1]?.voltage || null;
  const soc = lastKnown.stateOfCharge ?? measurements[measurements.length - 1]?.stateOfCharge ?? null;

  if (capacity === null || voltage === null || soc === null) {
    return defaultResult;
  }

  // Calculate usable energy
  const usableWh = capacity * voltage * (soc / 100);

  // Get discharge measurements with valid current and voltage
  const discharge = measurements.filter(m =>
    typeof m?.current === 'number' &&
    typeof m?.voltage === 'number' &&
    m.current < 0
  );

  let runtime = null;
  let explanation = '';
  let confidence = 'low';

  if (discharge.length > 0) {
    // Calculate average power draw
    const powers = discharge.map(m => {
      const current = m.current || 0;
      const voltage = m.voltage || 0;
      return Math.abs(current * voltage);
    });
    const avgPowerW = powers.reduce((sum, p) => sum + p, 0) / discharge.length;

    if (avgPowerW > 0) {
      runtime = usableWh / avgPowerW;
      explanation = `Based on average power draw of ${Math.round(avgPowerW)}W`;
      confidence = discharge.length > 100 ? 'high' : 'medium';
    }
  }

  // Fallback to SoC-based estimate
  if (runtime === null) {
    const socRecords = measurements.filter(m => typeof m.stateOfCharge === 'number');
    if (socRecords.length >= 2) {
      const first = socRecords[0];
      const last = socRecords[socRecords.length - 1];
      const hours = msToHours(new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime());
      const socDrop = (first.stateOfCharge || 0) - (last.stateOfCharge || 0);

      if (hours > 0 && socDrop > 0) {
        runtime = ((last.stateOfCharge || 0) / (socDrop / hours));
        explanation = `Based on SoC trend over ${Math.round(hours)}h`;
        confidence = 'low';
      }
    }
  }

  // Ensure reasonable bounds
  if (runtime !== null) {
    runtime = Math.max(1, Math.min(168, runtime)); // 1h to 1 week
    runtime = Math.round(runtime * 10) / 10;
  }

  return {
    runtimeHours: runtime,
    explanation,
    confidence
  };
}

/**
 * Generate recommendations based on battery state
 * @param {Measurement[]} measurements Battery measurements 
 * @param {number} maxTemp Maximum temperature
 * @param {Performance} performance Battery performance
 * @returns {string[]} List of recommendations
 */
function generateRecommendations(measurements, maxTemp, performance) {
  const recommendations = [];

  if (maxTemp > 40) {
    recommendations.push('Urgent: Implement better cooling - temperature exceeds safe limits');
  } else if (maxTemp > 35) {
    recommendations.push('Monitor temperature levels - approaching upper limits');
  }

  if (performance.capacityRetention < 70) {
    recommendations.push('Consider battery replacement - significant capacity loss');
  } else if (performance.capacityRetention < 80) {
    recommendations.push('Schedule maintenance check - moderate capacity degradation');
  }

  if (performance.trend === 'Poor') {
    recommendations.push('Investigate usage patterns - battery performance declining');
  }

  return recommendations;
}

/**
 * Build prompt for Gemini model
 * @param {string} systemId System identifier
 * @param {string} batteryData Battery data string
 * @param {string} [customPrompt] Optional custom prompt
 * @param {Object} [metadata] Optional metadata for single-point analysis
 * @returns {string} Generated prompt
 */
function buildPrompt(systemId, batteryData, customPrompt, metadata) {
  // Parse batteryData to detect if it's single-point or time-series
  let isSinglePoint = false;
  let measurementCount = 0;
  try {
    const parsed = JSON.parse(batteryData);
    measurementCount = parsed.measurements ? parsed.measurements.length : 0;
    isSinglePoint = measurementCount === 1;
  } catch (e) {
    // If we can't parse, assume it's a string representation
  }

  // If custom prompt is provided, use it as the primary instruction
  if (customPrompt) {
    const customBase = `You are an expert battery system analyst.

Battery Performance Data:
systemId: ${systemId || 'unknown'}
${batteryData}

USER QUESTION:
${customPrompt}

Please answer the user's question based on the battery data provided above.`;
    return customBase.trim();
  }

  // For single-point data (e.g., from screenshot analysis), use a different prompt
  if (isSinglePoint) {
    const base = `You are an expert battery system analyst. Analyze this battery snapshot and provide insights:

systemId: ${systemId || 'unknown'}
${batteryData}

IMPORTANT: This is a single snapshot in time, not historical data. Focus on:
1. Current battery health status based on the snapshot
2. Current performance indicators (voltage, current, temperature, SOC)
3. Any alerts or issues visible in the data
4. Immediate recommendations based on current state
5. What the data tells us about battery condition RIGHT NOW

Do NOT attempt to calculate degradation rates or trends since this is a single measurement.
Instead, focus on interpreting the current values and what they indicate about battery health.`;

    return base.trim();
  }

  // Default comprehensive analysis prompt for time-series data
  const base = `Analyze this battery performance data and provide insights:
systemId: ${systemId || 'unknown'}
${batteryData}

Provide an analysis covering:
1. Overall health and performance
2. Capacity retention and degradation
3. Charging efficiency
4. Runtime estimates
5. Key recommendations`;

  return base.trim();
}

/**
 * Generate fallback summary when LLM fails
 * @param {BatteryData} batteryData Battery data
 * @returns {string} Summary text
 */
function fallbackTextSummary(batteryData) {
  const measurements = batteryData?.measurements || [];
  const perf = calculatePerformance(measurements, 30);
  const health = determineHealthStatus(measurements, 35);

  return `Battery Analysis Summary:
Health Status: ${health}
Performance Trend: ${perf.trend}
Capacity Retention: ${perf.capacityRetention}%
Degradation Rate: ${perf.degradationRate}% per day`;
}

/**
 * Parse insights from LLM output
 * @param {string} text Raw LLM output text
 * @param {BatteryData} batteryData Battery data
 * @param {BatteryAnalysisLogger} log Logger instance
 * @returns {Object} Parsed insights
 */
function parseInsights(text, batteryData, log = console) {
  const measurements = batteryData?.measurements || [];
  const maxTemp = Math.max(...measurements.map(m => m.temperature ?? 0));

  // Get deterministic values
  const performance = calculatePerformance(measurements, 30);
  const baseHealth = determineHealthStatus(measurements, maxTemp);
  const chargeEfficiency = calculateChargeEfficiency(measurements);
  const dischargeEfficiency = chargeEfficiency > 0 ? chargeEfficiency - 2 : 0; // Only calculate if charge efficiency exists

  // Adjust health based on performance trends to better flag degrading batteries
  let healthStatus = baseHealth;
  if (performance.trend === 'Poor') {
    healthStatus = 'Poor';
  }
  if (performance.degradationRate > 5) {
    healthStatus = 'Critical';
  }
  // Capacity retention below 75% should be considered Poor in our heuristics
  if (performance.capacityRetention < 75 && healthStatus !== 'Critical') {
    healthStatus = 'Poor';
  }

  const recommendations = generateRecommendations(measurements, maxTemp, performance);

  return {
    healthStatus,
    performance,
    efficiency: {
      chargeEfficiency,
      dischargeEfficiency,
      cyclesAnalyzed: measurements.length || 0
    },
    recommendations,
    estimatedLifespan: performance.degradationRate > 0 ?
      `${Math.round(100 / performance.degradationRate)} days` : 'Unknown',
    rawText: text
  };
}

/**
 * Generate generator recommendations
 * @param {number|null} runtimeHours Runtime estimate in hours
 * @param {number|null} avgPowerW Average power draw in watts
 * @returns {string[]} Generator recommendations
 */
function generateGeneratorRecommendations(runtimeHours, avgPowerW) {
  const recommendations = [];

  if (typeof runtimeHours !== 'number' || typeof avgPowerW !== 'number') {
    return ['Insufficient data for generator recommendations'];
  }

  const dailyKwh = (avgPowerW * 24) / 1000;

  // Size recommendations
  if (avgPowerW < 1000) {
    recommendations.push('Small portable generator (1-2kW) suitable for basic backup');
  } else if (avgPowerW < 3000) {
    recommendations.push('Mid-sized generator (3-5kW) recommended for reliable coverage');
  } else {
    recommendations.push('Large standby generator (6kW+) required for full power needs');
  }

  // Runtime recommendations
  if (runtimeHours < 4) {
    recommendations.push('Consider adding battery capacity for longer runtime');
  } else if (runtimeHours > 24) {
    recommendations.push('Current capacity sufficient for extended outages');
  }

  // Daily consumption guidance
  recommendations.push(`Estimated daily consumption: ${Math.round(dailyKwh)}kWh`);

  return recommendations;
}

module.exports = {
  calculateCapacityRetention,
  determineHealthStatus,
  calculatePerformance,
  calculateChargeEfficiency,
  calculateRuntimeEstimate,
  generateRecommendations,
  buildPrompt,
  fallbackTextSummary,
  parseInsights,
  generateGeneratorRecommendations,
  BATTERY_HEALTH_THRESHOLDS
};