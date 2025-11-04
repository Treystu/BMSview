const { createLogger, createTimer } = require('./utils/logger.cjs');

// Simple token estimate (1 token ~= 4 chars)
const estimateTokens = (str) => Math.ceil(((str || '') + '').length / 4);
const MAX_TOKENS = 32000;
const BASE_PROMPT_TOKENS = 1200;

/**
 * Handles battery analysis request and generates insights
 * @param {Object} event - The event object containing request data
 * @param {Object} context - The context object for logging
 * @param {Object} genAIOverride - Optional override for AI model
 * @returns {Promise<Object>} Analysis results
 */
async function generateHandler(event = {}, context = {}, genAIOverride) {
  let log = console;
  let timer = { end: () => {} };
  let response = { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  
  try {
    // Initialize logging and timing
    log = createLogger ? createLogger('generate-insights', context) : console;
    timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => {} };

  try {
    let body = {};
    try { body = event && event.body ? JSON.parse(event.body) : {}; } catch (e) { body = {}; }

    // Normalize input
    // Normalize and validate input data
    let batteryData = null;
    try {
      // Handle various input formats
      if (Array.isArray(body)) {
        batteryData = { measurements: body };
      } else if (Array.isArray(body.measurements)) {
        batteryData = { ...body, measurements: body.measurements };
      } else if (Array.isArray(body.analysisData)) {
        batteryData = { measurements: body.analysisData };
      } else if (Array.isArray(body.analysisData?.measurements)) {
        batteryData = { ...body.analysisData, measurements: body.analysisData.measurements };
      } else if (Array.isArray(body.batteryData?.measurements)) {
        batteryData = { ...body.batteryData, measurements: body.batteryData.measurements };
      } else if (Array.isArray(body.data)) {
        batteryData = { measurements: body.data };
      } else if (body?.measurements?.items && Array.isArray(body.measurements.items)) {
        batteryData = { measurements: body.measurements.items };
      }

      // Validate measurement structure
      if (batteryData?.measurements) {
        batteryData.measurements = batteryData.measurements
          .filter(m => m && typeof m === 'object')
          .map(m => ({
            timestamp: m.timestamp || new Date().toISOString(),
            voltage: typeof m.voltage === 'number' ? m.voltage : null,
            current: typeof m.current === 'number' ? m.current : null,
            temperature: typeof m.temperature === 'number' ? m.temperature : null,
            stateOfCharge: typeof m.stateOfCharge === 'number' ? m.stateOfCharge : null,
            capacity: typeof m.capacity === 'number' ? m.capacity : null
          }))
          .filter(m => 
            m.voltage !== null || 
            m.current !== null || 
            m.temperature !== null || 
            m.stateOfCharge !== null
          );
      }

      // Handle empty or invalid data
      if (!batteryData || !Array.isArray(batteryData.measurements)) {
        if (body && (body.batteryData || body.analysisData || body.measurements || body.data)) {
          batteryData = {
            dlNumber: body.dlNumber || body.systemId || 'unknown',
            measurements: [],
            metadata: {
              source: 'empty_data_handler',
              timestamp: new Date().toISOString()
            }
          };
        } else {
          throw new Error('Invalid battery data structure');
        }
      }

      // Add metadata if not present
      batteryData.metadata = batteryData.metadata || {
        dlNumber: body.dlNumber || body.systemId || 'unknown',
        timestamp: new Date().toISOString(),
        source: 'data_normalizer'
      };

    if (batteryData.measurements.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, insights: { healthStatus: 'Unknown', performance: { trend: 'Unknown', capacityRetention: 0, degradationRate: 0 }, recommendations: [], estimatedLifespan: 'Unknown', efficiency: { chargeEfficiency: 0, dischargeEfficiency: 0, cyclesAnalyzed: 0 }, rawText: '' }, tokenUsage: { prompt: 0, generated: 0, total: 0 }, timestamp: new Date().toISOString() }) };
    }

    const dataString = JSON.stringify(batteryData);
    const dataTokens = estimateTokens(dataString);
    if (dataTokens + BASE_PROMPT_TOKENS > MAX_TOKENS) return { statusCode: 413, body: JSON.stringify({ error: 'Input data too large' }) };

    const systemId = body.systemId || body.system || null;
    const prompt = buildPrompt(systemId, dataString, body.customPrompt);
    const promptTokens = estimateTokens(prompt);

    let model = null;
    if (genAIOverride) model = genAIOverride;
    else {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
        model = client.getGenerativeModel ? client.getGenerativeModel({ model: 'gemini-pro' }) : null;
      } catch (e) {
        log && log.warn && log.warn('LLM client not available, using fallback', { error: e.message });
        model = null;
      }
    }

    let insightsText = '';
    if (model && typeof model.generateContent === 'function') {
      try {
        const genResult = await model.generateContent(prompt);
        const resp = genResult && genResult.response;
        insightsText = typeof resp?.text === 'function' ? resp.text() : String(resp || '');
      } catch (e) {
        insightsText = fallbackTextSummary(batteryData);
      }
    } else {
      insightsText = fallbackTextSummary(batteryData);
    }

    const structured = parseInsights(insightsText, batteryData, log);

    response = { 
      statusCode: 200, 
      body: JSON.stringify({ 
        success: true, 
        insights: structured, 
        tokenUsage: { 
          prompt: promptTokens, 
          generated: estimateTokens(insightsText), 
          total: promptTokens + estimateTokens(insightsText) 
        }, 
        timestamp: new Date().toISOString() 
      }) 
    };
  } catch (err) {
    log.error('Failed to generate insights', { error: err.message, stack: err.stack });
    response = { 
      statusCode: 500, 
      body: JSON.stringify({ 
        error: 'Failed to generate insights',
        message: err.message,
        timestamp: new Date().toISOString()
      }) 
    };
  } finally {
    try { 
      await timer.end(); 
    } catch (e) {
      log.warn('Failed to end timer', { error: e.message });
    }
  }
  
  return response;
}

exports.handler = generateHandler;
exports.generateHandler = generateHandler;

function buildPrompt(systemId, dataString, customPrompt) {
  const base = `SYSTEM_ID: ${systemId || 'N/A'}\nDATA: ${dataString.substring(0, 2000)}`;
  
  if (customPrompt) {
    return `You are an expert battery analyst. Analyze the battery data and answer the user's question.
Given the following battery data, provide detailed insights and specific numeric estimates.
Include historical averages, current state analysis, and projections where relevant.
Focus on practical, quantitative answers with specific numbers and time estimates.

${base}

USER_QUERY: ${sanitizePrompt(customPrompt)}

REQUIRED RESPONSE FORMAT:
{
  "answer": "Direct answer to the user's question with specific numbers",
  "currentState": {
    "voltage": number,
    "current": number,
    "soc": number
  },
  "estimates": {
    "remainingTime": {
      "atCurrentDraw": string,
      "atAverageUse": string,
      "atMaximumUse": string
    }
  },
  "historicalData": {
    "averageDischargeRate": number,
    "maximumDischargeRate": number,
    "typicalDuration": string
  },
  "recommendations": [string],
  "confidence": "high" | "medium" | "low"
}`;
  }
  
  return `${base}\nANALYZE_AND_RETURN_JSON: { 
    healthStatus, 
    performance: {
      trend,
      capacityRetention,
      degradationRate,
      currentDraw,
      estimatedRuntime
    }, 
    recommendations, 
    estimatedLifespan,
    efficiency: {
      chargeEfficiency,
      dischargeEfficiency,
      averageDischargeRate,
      maximumDischargeRate,
      cyclesAnalyzed
    }
  }`;
}

function sanitizePrompt(p) { return (p || '').replace(/[{}<>\\[\\]]/g, '').substring(0, 1000); }

function fallbackTextSummary(batteryData) {
  // Get comprehensive analysis
  const performance = analyzePerformance(batteryData);
  const efficiency = calculateEfficiency(batteryData);
  const runtime = calculateEstimatedRuntime(batteryData);
  
  // Generate recommendations
  const recommendations = [];
  
  // Health-based recommendations
  if (performance.capacityRetention < 70) {
    recommendations.push({
      priority: 'high',
      action: 'Consider battery replacement',
      reason: `Battery capacity at ${performance.capacityRetention}%`,
      impact: 'Reduced runtime and reliability'
    });
  }
  
  // Efficiency-based recommendations
  if (efficiency.chargeEfficiency < 0.8) {
    recommendations.push({
      priority: 'medium',
      action: 'Check charging system',
      reason: 'Low charging efficiency detected',
      impact: 'Increased charging time and energy costs'
    });
  }
  
  // Usage pattern recommendations
  if (performance.analysis.usageIntensity === 'high') {
    recommendations.push({
      priority: 'medium',
      action: 'Review load distribution',
      reason: 'High intensity usage pattern detected',
      impact: 'Accelerated battery wear'
    });
  }
  
  // Anomaly-based recommendations
  performance.anomalies.forEach(anomaly => {
    if (anomaly.severity === 'high') {
      recommendations.push({
        priority: 'high',
        action: `Investigate ${anomaly.type}`,
        reason: `Anomaly detected at ${new Date(anomaly.timestamp).toLocaleString()}`,
        impact: 'Potential system instability'
      });
    }
  });
  
  // Format comprehensive response
  const response = {
    systemHealth: {
      status: performance.trend,
      confidence: performance.confidence,
      factors: [],
      metrics: performance.historicalMetrics
    },
    performance: {
      trend: performance.trend,
      capacityRetention: performance.capacityRetention,
      degradationRate: performance.degradationRate,
      patterns: performance.analysis,
      anomalies: performance.anomalies
    },
    efficiency: {
      ...efficiency,
      patterns: efficiency.patterns,
      metrics: efficiency.metrics
    },
    runtime: {
      estimates: runtime,
      confidence: runtime?.confidence || 'low',
      factors: runtime?.factors || []
    },
    recommendations: recommendations.sort((a, b) => 
      b.priority === 'high' ? 1 : a.priority === 'high' ? -1 : 0
    ),
    metadata: {
      generatedAt: new Date().toISOString(),
      dataPoints: performance.historicalMetrics.dataPoints,
      monitoringPeriod: `${Math.round(performance.historicalMetrics.monitoringHours)} hours`,
      overallConfidence: determineOverallConfidence([
        performance.confidence,
        efficiency.confidence,
        runtime?.confidence || 'low'
      ])
    }
  };
  
  // Add health factors based on analysis
  if (performance.capacityRetention < 80) {
    response.systemHealth.factors.push(`Significant capacity loss: ${performance.capacityRetention}% remaining`);
  }
  if (performance.anomalies.length > 0) {
    response.systemHealth.factors.push(`${performance.anomalies.length} anomalies detected`);
  }
  if (efficiency.patterns.includes('deep_cycling')) {
    response.systemHealth.factors.push('Deep discharge cycles detected');
  }
  
  return JSON.stringify(response, null, 2);
}

function determineOverallConfidence(confidences) {
  const levels = { low: 1, medium: 2, high: 3 };
  const avg = confidences.reduce((sum, conf) => sum + levels[conf], 0) / confidences.length;
  return avg <= 1.5 ? 'low' : avg <= 2.5 ? 'medium' : 'high';
}

function parseInsights(raw, batteryData, log) {
  try {
    // First try to parse the raw JSON response
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      
      // Get comprehensive analysis
      const performance = analyzePerformance(batteryData);
      const efficiency = calculateEfficiency(batteryData);
      const runtime = calculateEstimatedRuntime(batteryData);
      
      // If it's a response to a specific query
      if (parsed.answer) {
        return {
          success: true,
          healthStatus: performance.trend,
          performance: {
            ...performance,
            currentState: parsed.currentState || performance.currentState,
            estimatedRuntime: parsed.estimates?.remainingTime || runtime
          },
          recommendations: parsed.recommendations || generateRecommendations(performance, efficiency),
          estimatedLifespan: calculateEstimatedLifespan(performance, efficiency),
          efficiency: {
            ...efficiency,
            ...parsed.historicalData
          },
          queryResponse: {
            answer: parsed.answer,
            confidence: parsed.confidence || performance.confidence,
            estimates: parsed.estimates || runtime,
            historicalData: parsed.historicalData || performance.historicalMetrics
          },
          metadata: {
            generatedAt: new Date().toISOString(),
            source: parsed.source || 'query_handler',
            confidence: determineOverallConfidence([
              performance.confidence,
              efficiency.confidence,
              parsed.confidence || 'medium'
            ])
          }
        };
      }
      
      // For standard analysis, merge Gemini insights with local analysis
      return {
        success: true,
        healthStatus: parsed.healthStatus || performance.trend,
        performance: {
          ...performance,
          ...parsed.performance
        },
        recommendations: parsed.recommendations || generateRecommendations(performance, efficiency),
        estimatedLifespan: calculateEstimatedLifespan(performance, efficiency),
        efficiency: {
          ...efficiency,
          ...(parsed.efficiency || {})
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          source: 'hybrid_analysis',
          confidence: determineOverallConfidence([
            performance.confidence,
            efficiency.confidence,
            parsed.confidence || 'medium'
          ])
        }
      };
    }
  } catch (e) {
    log && log.warn && log.warn('Failed to parse Gemini response', { error: e.message });
  }
  
  // Fallback to local analysis
  return generateLocalAnalysis(batteryData);
}

function generateLocalAnalysis(batteryData) {
  const performance = analyzePerformance(batteryData);
  const efficiency = calculateEfficiency(batteryData);
  const runtime = calculateEstimatedRuntime(batteryData);
  
  return {
    success: true,
    healthStatus: performance.trend,
    performance: {
      ...performance,
      estimatedRuntime: runtime
    },
    recommendations: generateRecommendations(performance, efficiency),
    estimatedLifespan: calculateEstimatedLifespan(performance, efficiency),
    efficiency: {
      ...efficiency,
      averageDischargeRate: calculateAverageDischargeRate(batteryData),
      maximumDischargeRate: calculateMaximumDischargeRate(batteryData)
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      source: 'local_analysis',
      confidence: determineOverallConfidence([
        performance.confidence,
        efficiency.confidence,
        runtime?.confidence || 'low'
      ])
    }
  };
}

function generateRecommendations(performance, efficiency) {
  const recommendations = [];
  
  // Health-based recommendations
  if (performance.capacityRetention < 70) {
    recommendations.push('Battery replacement recommended');
  } else if (performance.capacityRetention < 85) {
    recommendations.push('Monitor battery health closely');
  }
  
  // Efficiency-based recommendations
  if (efficiency.chargeEfficiency < 0.8) {
    recommendations.push('Check charging system efficiency');
  }
  
  // Usage pattern recommendations
  if (performance.analysis.usageIntensity === 'high') {
    recommendations.push('Consider load balancing to extend battery life');
  }
  
  return recommendations;
}

function calculateEstimatedLifespan(performance, efficiency) {
  if (performance.trend === 'Excellent') return '3-5 years';
  if (performance.trend === 'Good') return '2-3 years';
  if (performance.trend === 'Fair') return '1-2 years';
  if (performance.trend === 'Poor') return '6-12 months';
  if (performance.trend === 'Critical') return '1-6 months';
  return 'Unknown';
}

function analyzePerformance(batteryData) {
  const m = batteryData?.measurements || [];
  if (!Array.isArray(m) || m.length < 2) {
    return {
      trend: 'Unknown',
      capacityRetention: 0,
      degradationRate: 0,
      confidence: 'low',
      reason: 'Insufficient data points'
    };
  }

  // Sort measurements by timestamp
  const sortedM = [...m].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const first = sortedM[0];
  const last = sortedM[sortedM.length - 1];
  
  // Calculate time-based metrics
  const startTime = new Date(first.timestamp);
  const endTime = new Date(last.timestamp);
  const monitoringHours = (endTime - startTime) / (1000 * 60 * 60);
  
  // Extract and validate current readings
  const firstCap = Number(first.capacity) || 0;
  const lastCap = Number(last.capacity) || 0;
  const lastCurrent = Math.abs(Number(last.current) || 0);
  const lastVoltage = Number(last.voltage) || 0;
  const lastSoc = Number(last.stateOfCharge) || 0;

  // Calculate capacity metrics
  let capacityRetention = 0;
  let degradationRate = 0;
  let trend = 'Unknown';
  let confidence = 'low';

  if (firstCap > 0 && lastCap > 0) {
    capacityRetention = Math.round((lastCap / firstCap) * 100);
    degradationRate = parseFloat(((firstCap - lastCap) / Math.max(1, monitoringHours / 24)).toFixed(4));
    
    // Analyze trend with more nuanced thresholds
    if (capacityRetention > 95) {
      trend = 'Excellent';
    } else if (capacityRetention > 85) {
      trend = 'Good';
    } else if (capacityRetention > 70) {
      trend = 'Fair';
    } else if (capacityRetention > 50) {
      trend = 'Poor';
    } else {
      trend = 'Critical';
    }

    // Determine confidence based on data quality
    if (monitoringHours > 168) { // More than 1 week of data
      confidence = 'high';
    } else if (monitoringHours > 24) { // More than 1 day of data
      confidence = 'medium';
    }
  }

  // Calculate additional performance metrics
  const voltageStats = calculateStatistics(sortedM.map(m => m.voltage));
  const currentStats = calculateStatistics(sortedM.map(m => m.current));
  const socStats = calculateStatistics(sortedM.map(m => m.stateOfCharge));

  // Detect anomalies
  const anomalies = detectAnomalies(sortedM);
  
  return {
    trend,
    capacityRetention,
    degradationRate,
    currentState: {
      voltage: lastVoltage,
      current: lastCurrent,
      soc: lastSoc,
      timestamp: last.timestamp
    },
    historicalMetrics: {
      voltage: voltageStats,
      current: currentStats,
      soc: socStats,
      monitoringHours,
      dataPoints: sortedM.length
    },
    anomalies,
    confidence,
    analysis: {
      voltageStability: voltageStats.stdDev < 1 ? 'stable' : 'unstable',
      currentProfile: calculateCurrentProfile(currentStats),
      socPattern: calculateSocPattern(socStats),
      usageIntensity: calculateUsageIntensity(currentStats)
    }
  };
}

function calculateStatistics(values) {
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (validValues.length === 0) return { min: 0, max: 0, avg: 0, stdDev: 0 };
  
  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const avg = validValues.reduce((a, b) => a + b, 0) / validValues.length;
  
  const variance = validValues.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / validValues.length;
  const stdDev = Math.sqrt(variance);
  
  return { min, max, avg, stdDev };
}

function detectAnomalies(measurements) {
  const anomalies = [];
  
  for (let i = 1; i < measurements.length; i++) {
    const prev = measurements[i-1];
    const curr = measurements[i];
    const timeDiff = (new Date(curr.timestamp) - new Date(prev.timestamp)) / (1000 * 60); // minutes
    
    // Voltage spikes
    if (Math.abs((curr.voltage || 0) - (prev.voltage || 0)) > 2) {
      anomalies.push({
        type: 'voltage_spike',
        timestamp: curr.timestamp,
        severity: 'high',
        details: {
          previous: prev.voltage,
          current: curr.voltage,
          timeDiff
        }
      });
    }
    
    // Rapid SOC changes
    if (Math.abs((curr.stateOfCharge || 0) - (prev.stateOfCharge || 0)) > 20) {
      anomalies.push({
        type: 'rapid_soc_change',
        timestamp: curr.timestamp,
        severity: 'medium',
        details: {
          previous: prev.stateOfCharge,
          current: curr.stateOfCharge,
          timeDiff
        }
      });
    }
  }
  
  return anomalies;
}

function calculateCurrentProfile(stats) {
  if (Math.abs(stats.avg) < 1) return 'minimal_usage';
  if (Math.abs(stats.avg) < 5) return 'light_usage';
  if (Math.abs(stats.avg) < 10) return 'moderate_usage';
  return 'heavy_usage';
}

function calculateSocPattern(stats) {
  if (stats.stdDev < 5) return 'minimal_cycling';
  if (stats.stdDev < 15) return 'shallow_cycling';
  if (stats.stdDev < 30) return 'moderate_cycling';
  return 'deep_cycling';
}

function calculateUsageIntensity(stats) {
  const intensity = Math.abs(stats.avg) * (stats.stdDev / stats.avg);
  if (intensity < 2) return 'low';
  if (intensity < 5) return 'medium';
  return 'high';
}

function calculateEfficiency(batteryData) {
  const m = batteryData?.measurements || [];
  if (!Array.isArray(m) || m.length < 2) {
    return {
      chargeEfficiency: 0,
      dischargeEfficiency: 0,
      cyclesAnalyzed: 0,
      confidence: 'low'
    };
  }

  // Sort measurements by timestamp
  const sortedM = [...m].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  let cycles = [];
  let currentCycle = null;
  let totalChargeEnergy = 0;
  let totalDischargeEnergy = 0;
  let cycleCount = 0;

  for (let i = 1; i < sortedM.length; i++) {
    const prev = sortedM[i-1];
    const curr = sortedM[i];
    
    const timeDiff = (new Date(curr.timestamp) - new Date(prev.timestamp)) / (1000 * 60 * 60); // hours
    const voltage = (curr.voltage + prev.voltage) / 2;
    const current = curr.current || 0;
    
    if (!isNaN(voltage) && !isNaN(current) && timeDiff > 0) {
      const energy = voltage * Math.abs(current) * timeDiff;
      
      if (current > 0) { // Charging
        if (currentCycle && currentCycle.type === 'discharge') {
          // Complete discharge cycle
          cycles.push(currentCycle);
          cycleCount++;
        }
        totalChargeEnergy += energy;
        currentCycle = currentCycle || { type: 'charge', energy: 0, startSoc: prev.stateOfCharge };
        currentCycle.energy += energy;
      } else if (current < 0) { // Discharging
        if (currentCycle && currentCycle.type === 'charge') {
          // Complete charge cycle
          cycles.push(currentCycle);
          cycleCount++;
        }
        totalDischargeEnergy += energy;
        currentCycle = currentCycle || { type: 'discharge', energy: 0, startSoc: prev.stateOfCharge };
        currentCycle.energy += energy;
      }
    }
  }

  // Add final cycle if exists
  if (currentCycle) {
    cycles.push(currentCycle);
    cycleCount++;
  }

  // Calculate efficiencies
  const chargeEfficiency = totalChargeEnergy > 0 ? 
    parseFloat((totalDischargeEnergy / totalChargeEnergy).toFixed(4)) : 0;
  
  const dischargeEfficiency = parseFloat((chargeEfficiency * 0.92).toFixed(4));

  // Analyze cycle patterns
  const cycleAnalysis = analyzeCyclePatterns(cycles);

  return {
    chargeEfficiency,
    dischargeEfficiency,
    cyclesAnalyzed: cycleCount,
    confidence: cycleCount > 10 ? 'high' : cycleCount > 3 ? 'medium' : 'low',
    patterns: cycleAnalysis.patterns,
    metrics: {
      totalChargeEnergy,
      totalDischargeEnergy,
      averageCycleDepth: cycleAnalysis.averageDepth,
      cycleFrequency: cycleAnalysis.frequency
    }
  };
}

function analyzeCyclePatterns(cycles) {
  if (!cycles.length) {
    return {
      patterns: [],
      averageDepth: 0,
      frequency: 'unknown'
    };
  }

  const depths = cycles
    .filter(c => c.startSoc != null)
    .map(c => Math.abs(c.startSoc - (c.endSoc || 0)));
  
  const averageDepth = depths.length > 0 ?
    depths.reduce((a, b) => a + b, 0) / depths.length : 0;

  const patterns = [];
  
  // Analyze cycle depth pattern
  if (averageDepth > 80) patterns.push('deep_cycling');
  else if (averageDepth > 40) patterns.push('moderate_cycling');
  else if (averageDepth > 0) patterns.push('shallow_cycling');

  // Analyze cycle frequency
  const frequency = cycles.length < 5 ? 'infrequent' :
                   cycles.length < 10 ? 'moderate' : 'frequent';

  return {
    patterns,
    averageDepth,
    frequency
  };
}
}

function extractHealthStatus(text) {
  const found = (text || '').match(/(excellent|good|fair|poor|critical|unknown)/i);
  return found ? found[1] : 'unknown';
}

function extractRecommendations(text) {
  return (text || '').split('\n').filter(l => /recommend|suggest|advise|should|consider|replacement|monitor/i.test(l)).slice(0,3).map(l=>l.trim());
}

function extractLifespan(text) {
  const match = (text || '').match(/(\d+\s*-\s*\d+|\d+)\s*(months|years)/i);
  return match ? match[0] : 'Unknown';
}

function calculateAverageDischargeRate(batteryData) {
  const m = batteryData?.measurements || [];
  const dischargeMeasurements = m.filter(measurement => 
    measurement.current && measurement.current < 0
  );
  
  if (dischargeMeasurements.length === 0) return 0;
  
  const sum = dischargeMeasurements.reduce((acc, curr) => 
    acc + Math.abs(curr.current || 0), 0
  );
  
  return parseFloat((sum / dischargeMeasurements.length).toFixed(2));
}

function calculateMaximumDischargeRate(batteryData) {
  const m = batteryData?.measurements || [];
  const dischargeMeasurements = m.filter(measurement => 
    measurement.current && measurement.current < 0
  );
  
  if (dischargeMeasurements.length === 0) return 0;
  
  return Math.max(...dischargeMeasurements.map(m => 
    Math.abs(m.current || 0)
  ));
}

function calculateEstimatedRuntime(batteryData) {
  const m = batteryData?.measurements || [];
  if (m.length === 0) return null;
  
  // Sort measurements by timestamp
  const sortedM = [...m].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const latest = sortedM[sortedM.length - 1];
  
  // Get current state
  const currentDraw = Math.abs(latest.current || 0);
  const soc = latest.stateOfCharge || 0;
  const voltage = latest.voltage || 0;
  
  if (!soc || !voltage) return null;
  
  // Calculate battery metrics
  const capacity = latest.capacity || calculateEffectiveCapacity(sortedM);
  const totalCapacity = voltage * capacity / 100; // Ah
  const remainingCapacity = totalCapacity * (soc / 100);
  
  // Calculate average and maximum discharge rates
  const dischargeStats = calculateDischargeStatistics(sortedM);
  
  // Calculate runtimes for different scenarios
  const estimates = {
    atCurrentDraw: null,
    atAverageUse: null,
    atMaximumUse: null,
    confidence: 'low',
    factors: []
  };
  
  // Current draw estimate
  if (currentDraw > 0) {
    const hoursRemaining = remainingCapacity / currentDraw;
    estimates.atCurrentDraw = formatDuration(hoursRemaining);
    estimates.factors.push(`Based on current draw of ${currentDraw.toFixed(1)}A`);
  }
  
  // Average use estimate
  if (dischargeStats.avgRate > 0) {
    const avgHoursRemaining = remainingCapacity / dischargeStats.avgRate;
    estimates.atAverageUse = formatDuration(avgHoursRemaining);
    estimates.factors.push(`Based on average use of ${dischargeStats.avgRate.toFixed(1)}A`);
  }
  
  // Maximum use estimate
  if (dischargeStats.maxRate > 0) {
    const minHoursRemaining = remainingCapacity / dischargeStats.maxRate;
    estimates.atMaximumUse = formatDuration(minHoursRemaining);
    estimates.factors.push(`Based on maximum observed draw of ${dischargeStats.maxRate.toFixed(1)}A`);
  }
  
  // Set confidence based on data quality
  if (dischargeStats.cycleCount > 10) {
    estimates.confidence = 'high';
  } else if (dischargeStats.cycleCount > 3) {
    estimates.confidence = 'medium';
  }
  
  return estimates;
}

function calculateEffectiveCapacity(measurements) {
  let maxObservedCapacity = 0;
  let dischargeCycles = 0;
  
  for (let i = 1; i < measurements.length; i++) {
    const prev = measurements[i-1];
    const curr = measurements[i];
    
    if (!prev || !curr) continue;
    
    // Detect discharge cycles
    if ((prev.stateOfCharge || 0) > (curr.stateOfCharge || 0)) {
      const socDiff = prev.stateOfCharge - curr.stateOfCharge;
      const energyDiff = Math.abs((prev.voltage || 0) * (prev.current || 0) * 
                                 ((new Date(curr.timestamp) - new Date(prev.timestamp)) / (1000 * 60 * 60)));
      
      if (socDiff > 10 && energyDiff > 0) { // Significant discharge
        const effectiveCapacity = (energyDiff / socDiff) * 100;
        maxObservedCapacity = Math.max(maxObservedCapacity, effectiveCapacity);
        dischargeCycles++;
      }
    }
  }
  
  return maxObservedCapacity > 0 ? maxObservedCapacity : 100; // Default to 100 if no cycles observed
}

function calculateDischargeStatistics(measurements) {
  let totalDischarge = 0;
  let maxRate = 0;
  let cycleCount = 0;
  let dischargeDuration = 0;
  
  for (let i = 1; i < measurements.length; i++) {
    const prev = measurements[i-1];
    const curr = measurements[i];
    
    if (!prev || !curr) continue;
    
    const timeDiff = (new Date(curr.timestamp) - new Date(prev.timestamp)) / (1000 * 60 * 60); // hours
    const current = Math.abs(curr.current || 0);
    
    if (current > 0) {
      totalDischarge += current * timeDiff;
      maxRate = Math.max(maxRate, current);
      dischargeDuration += timeDiff;
      
      // Detect cycle transitions
      if (i > 1 && (measurements[i-2].current || 0) >= 0 && (prev.current || 0) < 0) {
        cycleCount++;
      }
    }
  }
  
  return {
    avgRate: dischargeDuration > 0 ? totalDischarge / dischargeDuration : 0,
    maxRate,
    cycleCount,
    totalDischargeDuration: dischargeDuration
  };
}

function formatDuration(hours) {
  if (!isFinite(hours) || hours <= 0) return 'Unknown';
  
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} minutes`;
  }
  
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  
  if (minutes === 0) {
    return `${wholeHours} hours`;
  }
  
  return `${wholeHours} hours ${minutes} minutes`;
}
