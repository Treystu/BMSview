// Common utility functions for battery analysis

const BATTERY_HEALTH_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 80,
  FAIR: 70,
  POOR: 60
};

const buildPrompt = (systemId, dataString, customPrompt) => {
  if (customPrompt) return customPrompt;

  return `You are an expert battery management system (BMS) analyst. Analyze the following battery data and provide detailed insights about battery health, performance, and recommendations. Focus on:
1. Overall battery health status and any concerning patterns
2. Performance metrics including capacity retention and degradation rate
3. Charging and discharging efficiency patterns
4. Temperature management and its impact
5. Specific recommendations for battery maintenance and optimization
6. Estimated remaining lifespan based on usage patterns

Battery System ID: ${systemId || 'Unknown'}
Data: ${dataString}

Provide a thorough analysis in a clear, structured format that emphasizes actionable insights and specific recommendations.`;
};

const fallbackTextSummary = (batteryData) => {
  const measurements = batteryData?.measurements || [];
  if (measurements.length === 0) return 'No data available for analysis.';

  // Calculate basic statistics
  const stats = measurements.reduce((acc, m) => {
    if (m.voltage) {
      acc.voltage.sum += m.voltage;
      acc.voltage.count++;
      acc.voltage.min = Math.min(acc.voltage.min, m.voltage);
      acc.voltage.max = Math.max(acc.voltage.max, m.voltage);
    }
    if (m.current) {
      acc.current.sum += m.current;
      acc.current.count++;
      acc.current.min = Math.min(acc.current.min, m.current);
      acc.current.max = Math.max(acc.current.max, m.current);
    }
    if (m.temperature) {
      acc.temperature.sum += m.temperature;
      acc.temperature.count++;
      acc.temperature.min = Math.min(acc.temperature.min, m.temperature);
      acc.temperature.max = Math.max(acc.temperature.max, m.temperature);
    }
    if (m.stateOfCharge) {
      acc.soc.sum += m.stateOfCharge;
      acc.soc.count++;
      acc.soc.min = Math.min(acc.soc.min, m.stateOfCharge);
      acc.soc.max = Math.max(acc.soc.max, m.stateOfCharge);
    }
    return acc;
  }, {
    voltage: { sum: 0, count: 0, min: Infinity, max: -Infinity },
    current: { sum: 0, count: 0, min: Infinity, max: -Infinity },
    temperature: { sum: 0, count: 0, min: Infinity, max: -Infinity },
    soc: { sum: 0, count: 0, min: Infinity, max: -Infinity }
  });

  // Calculate averages and format summary
  const avgVoltage = stats.voltage.count ? stats.voltage.sum / stats.voltage.count : null;
  const avgCurrent = stats.current.count ? stats.current.sum / stats.current.count : null;
  const avgTemp = stats.temperature.count ? stats.temperature.sum / stats.temperature.count : null;
  const avgSoC = stats.soc.count ? stats.soc.sum / stats.soc.count : null;

  const summary = [];
  summary.push('Statistical Analysis:');
  
  if (avgVoltage !== null) {
    summary.push(`Voltage: ${avgVoltage.toFixed(2)}V (Range: ${stats.voltage.min.toFixed(2)}V - ${stats.voltage.max.toFixed(2)}V)`);
  }
  if (avgCurrent !== null) {
    summary.push(`Current: ${avgCurrent.toFixed(2)}A (Range: ${stats.current.min.toFixed(2)}A - ${stats.current.max.toFixed(2)}A)`);
  }
  if (avgTemp !== null) {
    summary.push(`Temperature: ${avgTemp.toFixed(2)}°C (Range: ${stats.temperature.min.toFixed(2)}°C - ${stats.temperature.max.toFixed(2)}°C)`);
  }
  if (avgSoC !== null) {
    summary.push(`State of Charge: ${avgSoC.toFixed(1)}% (Range: ${stats.soc.min.toFixed(1)}% - ${stats.soc.max.toFixed(1)}%)`);
  }

  // Add basic health assessment
  if (avgSoC !== null) {
    const healthStatus = avgSoC >= BATTERY_HEALTH_THRESHOLDS.EXCELLENT ? 'Excellent' :
                        avgSoC >= BATTERY_HEALTH_THRESHOLDS.GOOD ? 'Good' :
                        avgSoC >= BATTERY_HEALTH_THRESHOLDS.FAIR ? 'Fair' : 'Poor';
    summary.push(`\nHealth Assessment: ${healthStatus}`);
  }

  // Add recommendations based on measurements
  summary.push('\nRecommendations:');
  if (avgTemp !== null && avgTemp > 35) {
    summary.push('- Monitor temperature levels - current average is above optimal range');
  }
  if (stats.voltage.max - stats.voltage.min > 2) {
    summary.push('- Large voltage fluctuations detected - consider load balancing');
  }
  if (avgSoC !== null && avgSoC < BATTERY_HEALTH_THRESHOLDS.FAIR) {
    summary.push('- Battery capacity is degraded - consider maintenance or replacement');
  }

  return summary.join('\n');
};

const parseInsights = (rawText, batteryData, log) => {
  try {
    // Extract metrics from the raw text
    const measurements = batteryData?.measurements || [];
    const latestMeasurement = measurements[measurements.length - 1] || {};
    const firstMeasurement = measurements[0] || {};

    // Calculate metrics
    const timeSpan = measurements.length > 1 ? 
      (new Date(latestMeasurement.timestamp) - new Date(firstMeasurement.timestamp)) / (1000 * 60 * 60 * 24) : 0;
    
    const voltageRange = measurements.reduce((acc, m) => {
      if (typeof m.voltage === 'number') {
        acc.min = Math.min(acc.min, m.voltage);
        acc.max = Math.max(acc.max, m.voltage);
      }
      return acc;
    }, { min: Infinity, max: -Infinity });

    const avgTemp = measurements.reduce((sum, m) => sum + (m.temperature || 0), 0) / measurements.length;
    const maxTemp = Math.max(...measurements.map(m => m.temperature || 0));

    // Determine health status
    const healthStatus = determineHealthStatus(measurements, maxTemp);
    
    // Calculate performance metrics
    const performance = calculatePerformance(measurements, timeSpan);
    
    // Generate recommendations
    const recommendations = generateRecommendations(measurements, maxTemp, performance);

    return {
      healthStatus,
      performance: {
        trend: performance.trend,
        capacityRetention: performance.capacityRetention,
        degradationRate: performance.degradationRate
      },
      recommendations,
      estimatedLifespan: estimateLifespan(performance.degradationRate, performance.capacityRetention),
      efficiency: {
        chargeEfficiency: calculateChargeEfficiency(measurements),
        dischargeEfficiency: calculateDischargeEfficiency(measurements),
        cyclesAnalyzed: measurements.length
      },
      rawText
    };
  } catch (error) {
    log.warn('Failed to parse insights', { error: error.message });
    return fallbackAnalysis(batteryData);
  }
};

// Helper functions
function determineHealthStatus(measurements, maxTemp) {
  if (!measurements.length) return 'Unknown';
  
  const latestSoC = measurements[measurements.length - 1].stateOfCharge;
  const avgSoC = measurements.reduce((sum, m) => sum + (m.stateOfCharge || 0), 0) / measurements.length;
  
  if (maxTemp > 45) return 'Critical - Overheating';
  if (avgSoC >= BATTERY_HEALTH_THRESHOLDS.EXCELLENT) return 'Excellent';
  if (avgSoC >= BATTERY_HEALTH_THRESHOLDS.GOOD) return 'Good';
  if (avgSoC >= BATTERY_HEALTH_THRESHOLDS.FAIR) return 'Fair';
  return 'Poor';
}

function calculatePerformance(measurements, timeSpan) {
  if (measurements.length < 2) {
    return { trend: 'Unknown', capacityRetention: 100, degradationRate: 0 };
  }

  const initialCapacity = measurements[0].capacity || 100;
  const finalCapacity = measurements[measurements.length - 1].capacity || initialCapacity;
  const capacityRetention = (finalCapacity / initialCapacity) * 100;
  const degradationRate = timeSpan ? ((100 - capacityRetention) / timeSpan) : 0;

  return {
    trend: determineTrend(measurements),
    capacityRetention: Math.round(capacityRetention * 10) / 10,
    degradationRate: Math.round(degradationRate * 100) / 100
  };
}

function determineTrend(measurements) {
  if (measurements.length < 2) return 'Stable';
  
  const recentMeasurements = measurements.slice(-10);
  const avgRecent = recentMeasurements.reduce((sum, m) => sum + (m.stateOfCharge || 0), 0) / recentMeasurements.length;
  const avgAll = measurements.reduce((sum, m) => sum + (m.stateOfCharge || 0), 0) / measurements.length;

  if (Math.abs(avgRecent - avgAll) < 5) return 'Stable';
  return avgRecent > avgAll ? 'Improving' : 'Declining';
}

function generateRecommendations(measurements, maxTemp, performance) {
  const recommendations = [];
  
  if (maxTemp > 40) {
    recommendations.push('Urgent: Implement better cooling solutions - temperature exceeds safe limits');
  } else if (maxTemp > 35) {
    recommendations.push('Monitor temperature levels closely - approaching upper limits');
  }

  if (performance.capacityRetention < 70) {
    recommendations.push('Consider battery replacement - significant capacity degradation detected');
  } else if (performance.capacityRetention < 80) {
    recommendations.push('Schedule maintenance check - moderate capacity degradation observed');
  }

  if (performance.trend === 'Declining') {
    recommendations.push('Investigate usage patterns - battery performance is declining');
  }

  return recommendations;
}

function calculateChargeEfficiency(measurements) {
  const chargeCycles = measurements.filter(m => m.current > 0);
  if (!chargeCycles.length) return 0;
  
  const avgChargeRate = chargeCycles.reduce((sum, m) => sum + (m.current || 0), 0) / chargeCycles.length;
  return Math.min(98, Math.round((1 - Math.abs(avgChargeRate - 1) / 2) * 100));
}

function calculateDischargeEfficiency(measurements) {
  const dischargeCycles = measurements.filter(m => m.current < 0);
  if (!dischargeCycles.length) return 0;
  
  const avgDischargeRate = dischargeCycles.reduce((sum, m) => sum + Math.abs(m.current || 0), 0) / dischargeCycles.length;
  return Math.min(95, Math.round((1 - Math.abs(avgDischargeRate - 1) / 2) * 100));
}

function estimateLifespan(degradationRate, capacityRetention) {
  if (degradationRate <= 0 || capacityRetention >= 95) return '5+ years';
  if (degradationRate > 2 || capacityRetention < 60) return '< 1 year';
  
  const yearsToEnd = (capacityRetention - 60) / (degradationRate * 365);
  if (yearsToEnd < 1) return '< 1 year';
  if (yearsToEnd > 5) return '5+ years';
  return `${Math.round(yearsToEnd)} years`;
}

function fallbackAnalysis(batteryData) {
  return {
    healthStatus: 'Unknown',
    performance: { trend: 'Unknown', capacityRetention: 0, degradationRate: 0 },
    recommendations: [],
    estimatedLifespan: 'Unknown',
    efficiency: { chargeEfficiency: 0, dischargeEfficiency: 0, cyclesAnalyzed: 0 },
    rawText: ''
  };
}

module.exports = {
  buildPrompt,
  fallbackTextSummary,
  parseInsights
};