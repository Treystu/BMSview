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
  const avgSoC = measurements.reduce((sum, m) => sum + (m.stateOfCharge || 0), 0) / measurements.length;

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
  if (!measurements?.length) return 95; // Default for no data

  // Get charge cycles with valid current and voltage
  const chargeCycles = measurements.filter(m => 
    typeof m?.current === 'number' && 
    typeof m?.voltage === 'number' &&
    m.current > 0
  );

  if (!chargeCycles.length) return 95;

  // Start with baseline efficiency
  let efficiency = 98;

  // Calculate average charging metrics
  const avgCurrent = chargeCycles.reduce((sum, m) => sum + m.current, 0) / chargeCycles.length;
  const maxTemp = Math.max(...measurements.map(m => m.temperature || 25));

  // Reduce efficiency based on factors:
  
  // High charging current reduces efficiency
  if (avgCurrent > 0.3) {
    efficiency -= Math.min(8, avgCurrent * 2);
  }

  // High temperature reduces efficiency
  if (maxTemp > 35) {
    efficiency -= Math.min(5, (maxTemp - 35) * 0.5);
  }

  // Ensure reasonable bounds
  return Math.round(Math.max(90, Math.min(98, efficiency)));
}

/**
 * Calculate runtime estimate
 * @param {Measurement[]} measurements Battery measurements
 * @param {Object} lastKnown Last known battery state
 * @returns {RuntimeResult} Runtime estimate
 */
function calculateRuntimeEstimate(measurements, lastKnown = {}) {
  const msToHours = ms => ms / (1000 * 60 * 60);
  
  // Default conservative estimate
  const defaultResult = {
    runtimeHours: 12,
    explanation: 'Using conservative default estimate',
    confidence: 'low'
  };

  if (!measurements?.length) return defaultResult;

  // Get capacity and voltage from measurements or lastKnown
  const capacity = lastKnown.capacityAh || lastKnown.capacity || 
                  measurements[measurements.length - 1]?.capacity || 100;
  const voltage = lastKnown.voltage || measurements[measurements.length - 1]?.voltage || 48;
  const soc = lastKnown.stateOfCharge ?? measurements[measurements.length - 1]?.stateOfCharge ?? 100;

  // Calculate usable energy
  const usableWh = capacity * voltage * (soc / 100);

  // Get discharge measurements
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
    const powers = discharge.map(m => Math.abs(m.current * m.voltage));
    const avgPowerW = powers.reduce((sum, p) => sum + p, 0) / powers.length;

    if (avgPowerW > 0) {
      runtime = usableWh / avgPowerW;
      explanation = `Based on average power draw of ${Math.round(avgPowerW)}W`;
      confidence = 'medium';
    }
  }

  // Fallback to SoC-based estimate
  if (runtime === null) {
    const socRecords = measurements.filter(m => typeof m.stateOfCharge === 'number');
    if (socRecords.length >= 2) {
      const first = socRecords[0];
      const last = socRecords[socRecords.length - 1];
      const hours = msToHours(new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime());
      const socDrop = first.stateOfCharge - last.stateOfCharge;
      
      if (hours > 0 && socDrop > 0) {
        runtime = (last.stateOfCharge / (socDrop / hours));
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

module.exports = {
  calculateCapacityRetention,
  determineHealthStatus,
  calculatePerformance,
  calculateChargeEfficiency,
  calculateRuntimeEstimate,
  generateRecommendations,
  BATTERY_HEALTH_THRESHOLDS
};