const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getCollection } = require('./utils/mongodb.cjs');
const { createLogger, createTimer } = require('./utils/logger.cjs');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.handler = async (event, context) => {
  const log = createLogger('predictive-maintenance', context);
  const timer = createTimer(log, 'predictive-maintenance-handler');
  log.entry({ method: event.httpMethod, path: event.path });
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  const clientIp = event.headers['x-nf-client-connection-ip'];
  const logContext = { clientIp, httpMethod: event.httpMethod };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    log.debug('OPTIONS preflight request', logContext);
    const durationMs = timer.end();
    log.exit(200);
    return {
      statusCode: 200,
      headers
    };
  }

  if (event.httpMethod !== 'POST') {
    log.warn('Method not allowed', { ...logContext, allowedMethods: ['POST'] });
    const durationMs = timer.end();
    log.exit(405);
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    log.debug('Parsing request body', logContext);
    const { systemId, timeHorizon = '30' } = JSON.parse(event.body);

    const requestContext = { ...logContext, systemId, timeHorizon };
    log.info('Processing predictive maintenance request', requestContext);

    if (!systemId) {
      log.warn('Missing systemId parameter', requestContext);
      const durationMs = timer.end();
      log.exit(400);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing systemId parameter' })
      };
    }

    // Get system data
    log.debug('Fetching system data', requestContext);
    const systemData = await getSystemData(systemId, log);

    if (!systemData) {
      log.warn('System not found', requestContext);
      const durationMs = timer.end();
      log.exit(404);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'System not found' })
      };
    }

    log.debug('System data retrieved', { ...requestContext, dataPoints: systemData.dataPoints });

    // Generate predictive maintenance insights
    log.info('Generating predictive maintenance insights', requestContext);
    const predictions = await generatePredictiveInsights(systemData, parseInt(timeHorizon), log);

    // Store predictions for historical tracking
    log.debug('Storing predictions', requestContext);
    await storePredictions(systemId, predictions, log);

    log.info('Predictive maintenance completed successfully', requestContext);
    const durationMs = timer.end({ success: true });
    log.exit(200, requestContext);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        systemId,
        timeHorizon: `${timeHorizon} days`,
        predictions,
        generatedAt: new Date().toISOString()
      })
    };

  } catch (error) {
    log.error('Predictive maintenance error', { ...logContext, error: error.message, stack: error.stack });
    const durationMs = timer.end({ success: false });
    log.exit(500);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Predictive maintenance failed',
        details: error.message
      })
    };
  }
};

async function getSystemData(systemId, log) {
  try {
    log.debug('Fetching system data from database', { systemId });
    // Get system information
    const systemsCollection = await getCollection('systems');
    const system = await systemsCollection.findOne({
      _id: systemId
    });

    if (!system) {
      return null;
    }

    // Get recent battery measurements
    const measurementsCollection = await getCollection('measurements');
    const measurements = await measurementsCollection
      .find({ systemId })
      .sort({ timestamp: -1 })
      .limit(1000)
      .toArray();
    log.debug('Retrieved measurements', { systemId, count: measurements.length });

    // Get maintenance history
    const maintenanceCollection = await getCollection('maintenance');
    const maintenanceHistory = await maintenanceCollection
      .find({ systemId })
      .sort({ date: -1 })
      .limit(50)
      .toArray();
    log.debug('Retrieved maintenance history', { systemId, count: maintenanceHistory.length });

    // Get component data
    const componentsCollection = await getCollection('components');
    const components = await componentsCollection
      .find({ systemId })
      .toArray();
    log.debug('Retrieved components', { systemId, count: components.length });

    return {
      system,
      measurements,
      maintenanceHistory,
      components,
      dataPoints: measurements.length,
      lastMeasurement: measurements[0]?.timestamp || null
    };
  } catch (error) {
    log.error('Error getting system data', { systemId, error: error.message, stack: error.stack });
    throw error;
  }
}

async function generatePredictiveInsights(systemData, timeHorizon, log) {
  log.debug('Generating predictive insights', { timeHorizon, dataPoints: systemData.dataPoints });
  const { system, measurements, maintenanceHistory, components } = systemData;

  // Calculate failure risk
  const failureRisk = calculateFailureRisk(measurements, maintenanceHistory);

  // Identify weak components
  const componentAnalysis = identifyWeakComponents(components, measurements);

  // Generate optimal maintenance schedule
  const maintenanceSchedule = generateOptimalSchedule(
    measurements,
    maintenanceHistory,
    timeHorizon
  );

  // Use AI for enhanced predictions
  const aiInsights = await generateAIInsights(systemData, timeHorizon);

  return {
    overall: {
      failureRisk: failureRisk.level,
      confidence: failureRisk.confidence,
      riskFactors: failureRisk.factors
    },
    components: componentAnalysis,
    maintenance: {
      schedule: maintenanceSchedule,
      urgency: maintenanceSchedule.urgency,
      estimatedCost: maintenanceSchedule.estimatedCost
    },
    performance: {
      expectedDegradation: calculateExpectedDegradation(measurements, timeHorizon),
      capacityForecast: generateCapacityForecast(measurements, timeHorizon),
      efficiencyTrend: calculateEfficiencyTrend(measurements)
    },
    ai: aiInsights,
    recommendations: generateRecommendations(failureRisk, componentAnalysis, maintenanceSchedule)
  };
}

function calculateFailureRisk(measurements, maintenanceHistory) {
  if (measurements.length === 0) {
    return { level: 'Unknown', confidence: 0, factors: [] };
  }

  const latest = measurements[0];
  const riskFactors = [];
  let riskScore = 0;

  // Check capacity degradation
  if (measurements.length >= 2) {
    const capacityLoss = measurements[0].capacity - measurements[measurements.length - 1].capacity;
    const degradationRate = capacityLoss / measurements.length;

    if (degradationRate > 0.5) {
      riskScore += 30;
      riskFactors.push('High capacity degradation rate');
    }
  }

  // Check temperature trends
  const avgTemperature = measurements.reduce((sum, m) => sum + m.temperature, 0) / measurements.length;
  if (avgTemperature > 40) {
    riskScore += 25;
    riskFactors.push('Elevated operating temperature');
  }

  // Check voltage stability
  const voltageVariation = calculateVoltageVariation(measurements);
  if (voltageVariation > 0.1) {
    riskScore += 20;
    riskFactors.push('Voltage instability');
  }

  // Check maintenance frequency
  const daysSinceLastMaintenance = maintenanceHistory.length > 0
    ? (new Date() - new Date(maintenanceHistory[0].date)) / (1000 * 60 * 60 * 24)
    : 365;

  if (daysSinceLastMaintenance > 90) {
    riskScore += 15;
    riskFactors.push('Overdue for maintenance');
  }

  // Check charge cycle count
  const cycleCount = countChargeCycles(measurements);
  if (cycleCount > 800) {
    riskScore += 10;
    riskFactors.push('High cycle count');
  }

  // Determine risk level
  let level;
  if (riskScore >= 70) level = 'Critical';
  else if (riskScore >= 50) level = 'High';
  else if (riskScore >= 30) level = 'Medium';
  else if (riskScore >= 10) level = 'Low';
  else level = 'Very Low';

  return {
    level,
    confidence: Math.min(95, 50 + riskScore),
    factors: riskFactors
  };
}

function identifyWeakComponents(components, measurements) {
  const analysis = [];

  for (const component of components) {
    let riskLevel = 'Low';
    let issues = [];

    // Analyze based on component type and measurement data
    switch (component.type) {
      case 'battery_cell':
        const cellEfficiency = calculateCellEfficiency(component, measurements);
        if (cellEfficiency < 0.7) {
          riskLevel = 'High';
          issues.push('Low cell efficiency');
        } else if (cellEfficiency < 0.85) {
          riskLevel = 'Medium';
          issues.push('Moderate efficiency degradation');
        }
        break;

      case 'thermal_sensor':
        const tempVariation = calculateTemperatureVariation(measurements);
        if (tempVariation > 10) {
          riskLevel = 'Medium';
          issues.push('Temperature reading instability');
        }
        break;

      case 'voltage_regulator':
        const voltageVariation = calculateVoltageVariation(measurements);
        if (voltageVariation > 0.15) {
          riskLevel = 'High';
          issues.push('Voltage regulation issues');
        }
        break;

      case 'cooling_system':
        const avgTemp = measurements.reduce((sum, m) => sum + m.temperature, 0) / measurements.length;
        if (avgTemp > 45) {
          riskLevel = 'High';
          issues.push('Inadequate cooling performance');
        } else if (avgTemp > 40) {
          riskLevel = 'Medium';
          issues.push('Reduced cooling efficiency');
        }
        break;
    }

    analysis.push({
      id: component.id,
      name: component.name,
      type: component.type,
      riskLevel,
      issues,
      recommendation: generateComponentRecommendation(component.type, riskLevel),
      estimatedLifespan: estimateComponentLifespan(component, measurements)
    });
  }

  return analysis.sort((a, b) => {
    const riskOrder = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
    return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
  });
}

function generateOptimalSchedule(measurements, maintenanceHistory, timeHorizon) {
  const urgency = calculateMaintenanceUrgency(measurements, maintenanceHistory);
  const schedule = [];

  // Base schedule items
  const baseItems = [
    {
      task: 'Visual Inspection',
      frequency: urgency === 'Critical' ? 7 : 30, // days
      duration: 30, // minutes
      priority: 'Medium'
    },
    {
      task: 'Capacity Test',
      frequency: urgency === 'Critical' ? 14 : 90,
      duration: 120,
      priority: 'High'
    },
    {
      task: 'Thermal System Check',
      frequency: 30,
      duration: 45,
      priority: 'Medium'
    },
    {
      task: 'Voltage Calibration',
      frequency: 60,
      duration: 60,
      priority: 'Low'
    }
  ];

  // Generate schedule for the time horizon
  for (let day = 1; day <= timeHorizon; day++) {
    for (const item of baseItems) {
      if (day % item.frequency === 0) {
        schedule.push({
          date: new Date(Date.now() + day * 24 * 60 * 60 * 1000).toISOString(),
          task: item.task,
          duration: item.duration,
          priority: urgency === 'Critical' ? 'High' : item.priority,
          estimatedCost: calculateTaskCost(item.task, item.duration)
        });
      }
    }
  }

  // Add urgent tasks if needed
  if (urgency === 'Critical') {
    schedule.unshift({
      date: new Date().toISOString(),
      task: 'Immediate System Diagnosis',
      duration: 180,
      priority: 'Critical',
      estimatedCost: 500
    });
  }

  return {
    urgency,
    nextMaintenance: schedule[0]?.date || null,
    totalTasks: schedule.length,
    schedule: schedule.slice(0, 10), // Return next 10 tasks
    estimatedCost: schedule.reduce((sum, task) => sum + task.estimatedCost, 0)
  };
}

async function generateAIInsights(systemData, timeHorizon, log) {
  try {
    log.debug('Calling Gemini API for AI insights', { systemName: systemData.system?.name, timeHorizon });
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
      Analyze this battery system data and provide predictive maintenance insights:
      
      System: ${systemData.system.name}
      Data Points: ${systemData.dataPoints}
      Time Horizon: ${timeHorizon} days
      
      Recent Measurements (last 5):
      ${JSON.stringify(systemData.measurements.slice(0, 5), null, 2)}
      
      Recent Maintenance:
      ${JSON.stringify(systemData.maintenanceHistory.slice(0, 3), null, 2)}
      
      Components:
      ${JSON.stringify(systemData.components, null, 2)}
      
      Please provide:
      1. Predicted failure probability percentage
      2. Key performance indicators to monitor
      3. Proactive maintenance recommendations
      4. Potential cost savings from preventive maintenance
      5. Optimization suggestions
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const insights = response.text();
    log.debug('Received AI insights from Gemini', { insightsLength: insights.length });

    return {
      text: insights,
      processedAt: new Date().toISOString(),
      confidence: 85 // Placeholder confidence score
    };
  } catch (error) {
    log.error('Error generating AI insights', { error: error.message, stack: error.stack });
    return {
      text: 'AI insights unavailable at this time',
      error: error.message,
      processedAt: new Date().toISOString()
    };
  }
}

// Helper functions
function countChargeCycles(measurements) {
  let cycles = 0;
  let wasCharging = false;

  for (const measurement of measurements) {
    if (measurement.state === 'charging' && !wasCharging) {
      cycles++;
    }
    wasCharging = measurement.state === 'charging';
  }

  return cycles;
}

function calculateVoltageVariation(measurements) {
  if (measurements.length < 2) return 0;

  const voltages = measurements.map(m => m.voltage);
  const avg = voltages.reduce((sum, v) => sum + v, 0) / voltages.length;
  const variance = voltages.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / voltages.length;

  return Math.sqrt(variance) / avg;
}

function calculateTemperatureVariation(measurements) {
  if (measurements.length < 2) return 0;

  const temperatures = measurements.map(m => m.temperature);
  return Math.max(...temperatures) - Math.min(...temperatures);
}

function calculateCellEfficiency(component, measurements) {
  // Mock calculation - in real implementation would use specific cell data
  return 0.8 + Math.random() * 0.2;
}

function generateComponentRecommendation(type, riskLevel) {
  const recommendations = {
    battery_cell: {
      High: 'Immediate cell balancing and capacity test',
      Medium: 'Schedule cell health assessment',
      Low: 'Monitor during routine maintenance'
    },
    thermal_sensor: {
      High: 'Replace thermal sensors',
      Medium: 'Calibrate sensors and verify readings',
      Low: 'Include in next maintenance cycle'
    },
    voltage_regulator: {
      High: 'Immediate regulator inspection and replacement',
      Medium: 'Test regulator performance',
      Low: 'Monitor voltage stability'
    },
    cooling_system: {
      High: 'Service cooling system immediately',
      Medium: 'Clean cooling components',
      Low: 'Check cooling performance'
    }
  };

  return recommendations[type]?.[riskLevel] || 'Standard maintenance recommended';
}

function estimateComponentLifespan(component, measurements) {
  const baseLifespan = {
    battery_cell: 2000,
    thermal_sensor: 5000,
    voltage_regulator: 3000,
    cooling_system: 4000
  };

  const cycles = countChargeCycles(measurements);
  const remaining = Math.max(0, baseLifespan[component.type] - cycles);

  return {
    estimatedCycles: remaining,
    estimatedDays: Math.round(remaining / 2), // Assuming 2 cycles per day
    condition: remaining > baseLifespan[component.type] * 0.5 ? 'Good' : 'Worn'
  };
}

function calculateMaintenanceUrgency(measurements, maintenanceHistory) {
  const riskScore = calculateFailureRisk(measurements, maintenanceHistory);

  if (riskScore.level === 'Critical' || riskScore.level === 'High') {
    return 'Critical';
  } else if (riskScore.level === 'Medium') {
    return 'High';
  } else {
    return 'Normal';
  }
}

function calculateTaskCost(task, duration) {
  const hourlyRate = 75; // $75 per hour
  return Math.round((duration / 60) * hourlyRate);
}

function calculateExpectedDegradation(measurements, timeHorizon) {
  if (measurements.length < 2) return 0;

  const first = measurements[measurements.length - 1];
  const last = measurements[0];
  const daysSpan = Math.floor((new Date(last.timestamp) - new Date(first.timestamp)) / (1000 * 60 * 60 * 24));

  const dailyDegradation = (first.capacity - last.capacity) / daysSpan;
  return Math.abs(dailyDegradation * timeHorizon);
}

function generateCapacityForecast(measurements, timeHorizon) {
  if (measurements.length === 0) return [];

  const latest = measurements[0];
  const forecast = [];

  for (let day = 1; day <= Math.min(timeHorizon, 30); day += 7) {
    const degradation = 0.001 * day; // 0.1% degradation per day
    forecast.push({
      day,
      predictedCapacity: latest.capacity * (1 - degradation)
    });
  }

  return forecast;
}

function calculateEfficiencyTrend(measurements) {
  if (measurements.length < 10) return 'insufficient_data';

  const recent = measurements.slice(0, 10);
  const older = measurements.slice(10, 20);

  const recentAvg = recent.reduce((sum, m) => sum + (m.efficiency || 0.8), 0) / recent.length;
  const olderAvg = older.reduce((sum, m) => sum + (m.efficiency || 0.8), 0) / older.length;

  if (recentAvg > olderAvg + 0.05) return 'improving';
  if (recentAvg < olderAvg - 0.05) return 'declining';
  return 'stable';
}

function generateRecommendations(failureRisk, componentAnalysis, maintenanceSchedule) {
  const recommendations = [];

  if (failureRisk.level === 'Critical' || failureRisk.level === 'High') {
    recommendations.push({
      priority: 'Critical',
      action: 'Schedule immediate professional inspection',
      reason: 'High failure risk detected'
    });
  }

  const highRiskComponents = componentAnalysis.filter(c => c.riskLevel === 'High');
  if (highRiskComponents.length > 0) {
    recommendations.push({
      priority: 'High',
      action: 'Address high-risk components',
      reason: `${highRiskComponents.length} components require immediate attention`
    });
  }

  if (maintenanceSchedule.urgency === 'Critical') {
    recommendations.push({
      priority: 'High',
      action: 'Follow accelerated maintenance schedule',
      reason: 'System requires frequent monitoring'
    });
  }

  recommendations.push({
    priority: 'Medium',
    action: 'Implement performance monitoring dashboard',
    reason: 'Continuous monitoring will help prevent failures'
  });

  return recommendations;
}

async function storePredictions(systemId, predictions, log) {
  try {
    log.debug('Storing predictions in database', { systemId });
    const predictionsCollection = await getCollection('predictions');
    await predictionsCollection.insertOne({
      systemId,
      predictions,
      createdAt: new Date()
    });
    log.debug('Predictions stored successfully', { systemId });
  } catch (error) {
    log.error('Error storing predictions', { systemId, error: error.message, stack: error.stack });
  }
}
