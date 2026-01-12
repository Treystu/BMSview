const { GoogleGenAI } = require('@google/genai');
const { getCollection } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const {
  createStandardEntryMeta,
  logDebugRequestSummary
} = require('./utils/handler-logging.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

/**
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  if (!process.env.GEMINI_API_KEY) {
    log.error('Missing GEMINI_API_KEY environment variable');
    return false;
  }
  return true;
}

// Initialize Gemini AI (will be called per request with proper config)
function getGenAI() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/**
 * @param {import('@netlify/functions').HandlerEvent} event
 * @param {import('@netlify/functions').HandlerContext} context
 */
exports.handler = async (event, context) => {
  /** @type {import('./utils/logger.cjs').LogFunction} */
  const log = createLoggerFromEvent('predictive-maintenance', event, context);
  /** @type {any} */
  const timer = createTimer(log, 'predictive-maintenance-handler');
  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Predictive maintenance request', includeBody: true, bodyMaxStringLength: 20000 });

  // Unified logging: also forward to centralized collector
  const forwardLog = createForwardingLogger('predictive-maintenance');
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
    const parsedBody = event.body ? JSON.parse(event.body) : {};
    const { systemId, timeHorizon = '30' } = parsedBody;

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error('Predictive maintenance error', { ...logContext, error: errorMessage, stack: errorStack });
    const durationMs = timer.end({ success: false });
    log.exit(500);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Predictive maintenance failed',
        details: errorMessage
      })
    };
  }
};

/**
 * @param {string} systemId
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
async function getSystemData(systemId, log) {
  try {
    log.debug('Fetching system data from database', { systemId });
    // Get system information
    const systemsCollection = await getCollection('systems');
    const system = await systemsCollection.findOne(/** @type {any} */({
      _id: systemId
    }));

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error('Error getting system data', { systemId, error: errorMessage, stack: errorStack });
    throw error;
  }
}

/**
 * @param {any} systemData
 * @param {number} timeHorizon
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
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
  const aiInsights = await generateAIInsights(systemData, timeHorizon, log);

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

/**
 * @param {any[]} measurements
 * @param {any[]} maintenanceHistory
 */
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
  const avgTemperature = measurements.length > 0
    ? measurements.reduce((sum, /** @type {any} */ m) => sum + (m?.temperature || 0), 0) / measurements.length
    : 0;
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
    ? (Number(new Date()) - Number(new Date(maintenanceHistory[0].date))) / (1000 * 60 * 60 * 24)
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
    confidence: null,
    factors: riskFactors
  };
}

/**
 * @param {any[]} components
 * @param {any[]} measurements
 */
function identifyWeakComponents(components, measurements) {
  const analysis = [];

  for (const component of components) {
    let riskLevel = 'Low';
    const issues = [];

    // Analyze based on component type and measurement data
    switch (component.type) {
      case 'battery_cell':
        {
          const cellEfficiency = calculateCellEfficiency(component, measurements);
          if (cellEfficiency != null && cellEfficiency < 0.7) {
            riskLevel = 'High';
            issues.push('Low cell efficiency');
          } else if (cellEfficiency != null && cellEfficiency < 0.85) {
            riskLevel = 'Medium';
            issues.push('Moderate efficiency degradation');
          }
          break;
        }

      case 'thermal_sensor':
        {
          const tempVariation = calculateTemperatureVariation(measurements);
          if (tempVariation > 10) {
            riskLevel = 'Medium';
            issues.push('Temperature reading instability');
          }
          break;
        }

      case 'voltage_regulator':
        {
          const voltageVariation = calculateVoltageVariation(measurements);
          if (voltageVariation > 0.15) {
            riskLevel = 'High';
            issues.push('Voltage regulation issues');
          }
          break;
        }

      case 'cooling_system':
        {
          const avgTemp = measurements.length > 0
            ? measurements.reduce((sum, /** @type {any} */ m) => sum + (m.temperature || 0), 0) / measurements.length
            : 0;

          if (avgTemp > 45) {
            riskLevel = 'High';
            issues.push('Inadequate cooling performance');
          } else if (avgTemp > 40) {
            riskLevel = 'Medium';
            issues.push('Reduced cooling efficiency');
          }
          break;
        }
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
    const riskOrder = /** @type {Record<string, number>} */ ({ 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 });
    return (riskOrder[b.riskLevel] ?? 0) - (riskOrder[a.riskLevel] ?? 0);
  });
}

/**
 * @param {any[]} measurements
 * @param {any[]} maintenanceHistory
 * @param {number} timeHorizon
 */
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
    estimatedCost: schedule.reduce((sum, /** @type {any} */ task) => sum + (task.estimatedCost || 0), 0)
  };
}

/**
 * @param {any} systemData
 * @param {number} timeHorizon
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
async function generateAIInsights(systemData, timeHorizon, log) {
  try {
    log.debug('Calling Gemini API for AI insights', { systemName: systemData.system?.name, timeHorizon });
    const genAI = getGenAI();

    // Use environment variable with fallback
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

    const response = await genAI.models.generateContent({
      model: modelName,
      contents: prompt
    });

    const insights = response.text || '';
    log.debug('Received AI insights from Gemini', { insightsLength: insights.length });

    return {
      text: insights,
      processedAt: new Date().toISOString(),
      confidence: null // Placeholder confidence score
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error('Error generating AI insights', { error: errorMessage, stack: errorStack });
    return {
      text: 'AI insights unavailable at this time',
      error: errorMessage,
      processedAt: new Date().toISOString()
    };
  }
}

// Helper functions
/**
 * @param {any[]} measurements
 */
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

/**
 * @param {any[]} measurements
 */
function calculateVoltageVariation(measurements) {
  if (measurements.length < 2) return 0;

  const voltages = measurements.map((/** @type {any} */ m) => m.voltage || 0);
  const avg = voltages.reduce((sum, v) => sum + v, 0) / voltages.length;
  const variance = voltages.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / voltages.length;

  return Math.sqrt(variance) / avg;
}

/**
 * @param {any[]} measurements
 */
function calculateTemperatureVariation(measurements) {
  if (measurements.length < 2) return 0;

  const temperatures = measurements.map((/** @type {any} */ m) => m.temperature || 0);
  return Math.max(...temperatures) - Math.min(...temperatures);
}

/**
 * @param {any} component
 * @param {any[]} measurements
 */
function calculateCellEfficiency(component, measurements) {
  // A more realistic calculation based on remaining and original capacity
  if (component.originalCapacity && component.remainingCapacity) {
    return component.remainingCapacity / component.originalCapacity;
  }
  // Fallback to null if capacity is not available
  return null;
}

/**
 * @param {string} type
 * @param {string} riskLevel
 */
function generateComponentRecommendation(type, riskLevel) {
  const recommendations = /** @type {Record<string, Record<string, string>>} */({
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
  });

  return recommendations[type]?.[riskLevel] || 'Standard maintenance recommended';
}

/**
 * @param {any} component
 * @param {any[]} measurements
 */
function estimateComponentLifespan(component, measurements) {
  const baseLifespan = {
    battery_cell: 2000,
    thermal_sensor: 5000,
    voltage_regulator: 3000,
    cooling_system: 4000
  };

  const cycles = countChargeCycles(measurements);
  const typeKey = /** @type {keyof typeof baseLifespan} */ (component.type);
  const remaining = Math.max(0, (baseLifespan[typeKey] || 0) - cycles);

  return {
    estimatedCycles: remaining,
    estimatedDays: Math.round(remaining / 2), // Assuming 2 cycles per day
    condition: remaining > (baseLifespan[typeKey] || 0) * 0.5 ? 'Good' : 'Worn'
  };
}

/**
 * @param {any[]} measurements
 * @param {any[]} maintenanceHistory
 */
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

/**
 * @param {string} task
 * @param {number} duration
 */
function calculateTaskCost(task, duration) {
  const hourlyRate = 100;
  return (duration / 60) * hourlyRate + (task.includes('Immediate') ? 200 : 0);
}

/**
 * @param {any[]} measurements
 * @param {number} timeHorizon
 */
function calculateExpectedDegradation(measurements, timeHorizon) {
  if (measurements.length < 2) return 0;

  const recent = measurements[0];
  const oldest = measurements[measurements.length - 1];
  const daysSpan = Math.floor((Number(new Date(recent.timestamp)) - Number(new Date(oldest.timestamp))) / (1000 * 60 * 60 * 24));

  if (!daysSpan) return 0;

  const dailyDegradation = (oldest.capacity - recent.capacity) / daysSpan;
  return dailyDegradation * timeHorizon;
}

/**
 * @param {any[]} measurements
 * @param {number} timeHorizon
 */
function generateCapacityForecast(measurements, timeHorizon) {
  if (measurements.length === 0) return [];

  const latestCapacity = measurements[0].capacity || 0;
  const expectedDegradation = calculateExpectedDegradation(measurements, timeHorizon);

  return [
    { day: 0, capacity: latestCapacity },
    { day: timeHorizon, capacity: Math.max(0, latestCapacity - expectedDegradation) }
  ];
}

/**
 * @param {any[]} measurements
 */
function calculateEfficiencyTrend(measurements) {
  if (measurements.length < 2) return 'Stable';

  const half = Math.floor(measurements.length / 2);
  const recent = measurements.slice(0, half);
  const older = measurements.slice(half);

  const recentAvg = recent.reduce((sum, /** @type {any} */ m) => sum + (m.efficiency || 0.8), 0) / recent.length;
  const olderAvg = older.reduce((sum, /** @type {any} */ m) => sum + (m.efficiency || 0.8), 0) / older.length;

  if (recentAvg > olderAvg + 0.05) return 'Improving';
  if (recentAvg < olderAvg - 0.05) return 'Declining';
  return 'Stable';
}

/**
 * @param {any} failureRisk
 * @param {any[]} componentAnalysis
 * @param {any} maintenanceSchedule
 */
function generateRecommendations(failureRisk, componentAnalysis, maintenanceSchedule) {
  const recommendations = [];

  if (failureRisk.level === 'Critical' || failureRisk.level === 'High') {
    recommendations.push('Schedule immediate full system diagnostics.');
  }

  const highRiskComponents = componentAnalysis.filter((/** @type {any} */ c) => c.riskLevel === 'High');
  if (highRiskComponents.length > 0) {
    recommendations.push(`Inspect high-risk components: ${highRiskComponents.map((c) => c.name).join(', ')}`);
  }

  if (maintenanceSchedule.urgency === 'Critical') {
    recommendations.push('Increase maintenance frequency to weekly until stability improves.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Maintain standard monthly inspections and monitoring.');
  }

  return recommendations;
}

/**
 * @param {string} systemId
 * @param {any} predictions
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
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
    const err = /** @type {Error & { message?: string; stack?: string }} */ (error);
    if (log && typeof log.error === 'function') {
      log.error('Error storing predictions', {
        systemId,
        error: err && err.message ? err.message : 'Unknown error',
        stack: err && err.stack ? err.stack : undefined
      });
    }
  }
}
