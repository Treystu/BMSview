const { createLogger, createTimer } = require('./utils/logger.cjs');

// Clean single-file generate-insights handler
// - Normalizes multiple input shapes
// - Uses a small deterministic fallback summary (no external LLM dependency)
// - Token safety guard and input sanitization

const estimateTokens = (str) => Math.ceil(((str || '') + '').length / 4);
const MAX_TOKENS = 32000;
const BASE_PROMPT_TOKENS = 1200;

// Response schema for consistent typing and validation
const INSIGHTS_SCHEMA = {
  healthStatus: ['Excellent', 'Good', 'Fair', 'Poor', 'Critical', 'Unknown'],
  confidence: ['high', 'medium', 'low'],
  metricUnits: {
    voltage: 'V',
    current: 'A',
    power: 'W',
    temperature: '°C',
    capacity: 'Ah',
    energy: 'Wh'
  }
};

// Calculates the statistical ranges for battery metrics
function calculateMetricRanges(measurements) {
  if (!Array.isArray(measurements) || measurements.length === 0) return null;
  
  const stats = {
    voltage: { min: Infinity, max: -Infinity, avg: 0, count: 0 },
    current: { min: Infinity, max: -Infinity, avg: 0, count: 0 },
    temperature: { min: Infinity, max: -Infinity, avg: 0, count: 0 },
    stateOfCharge: { min: Infinity, max: -Infinity, avg: 0, count: 0 }
  };
  
  measurements.forEach(m => {
    Object.keys(stats).forEach(key => {
      const value = Number(m[key]);
      if (!isNaN(value)) {
        stats[key].min = Math.min(stats[key].min, value);
        stats[key].max = Math.max(stats[key].max, value);
        stats[key].avg += value;
        stats[key].count++;
      }
    });
  });
  
  Object.keys(stats).forEach(key => {
    if (stats[key].count > 0) {
      stats[key].avg /= stats[key].count;
    } else {
      stats[key] = null;
    }
  });
  
  return stats;
}

// Analyzes historical patterns and anomalies
function analyzeHistoricalPatterns(measurements) {
  if (!Array.isArray(measurements) || measurements.length < 2) return null;
  
  const patterns = {
    dischargeCycles: [],
    chargeCycles: [],
    anomalies: [],
    timeRanges: {
      start: new Date(measurements[0].timestamp),
      end: new Date(measurements[measurements.length - 1].timestamp),
      durationHours: 0
    }
  };
  
  patterns.timeRanges.durationHours = (patterns.timeRanges.end - patterns.timeRanges.start) / (1000 * 60 * 60);
  
  let currentCycle = null;
  measurements.forEach((m, i) => {
    const current = Number(m.current);
    const timestamp = new Date(m.timestamp);
    
    // Detect charge/discharge cycles
    if (!isNaN(current)) {
      if (current < 0 && (!currentCycle || currentCycle.type !== 'discharge')) {
        if (currentCycle) {
          if (currentCycle.type === 'charge') {
            patterns.chargeCycles.push(currentCycle);
          }
        }
        currentCycle = { type: 'discharge', start: timestamp, startIndex: i, minCurrent: current };
      } else if (current > 0 && (!currentCycle || currentCycle.type !== 'charge')) {
        if (currentCycle) {
          if (currentCycle.type === 'discharge') {
            currentCycle.end = timestamp;
            currentCycle.duration = (timestamp - currentCycle.start) / (1000 * 60 * 60);
            patterns.dischargeCycles.push(currentCycle);
          }
        }
        currentCycle = { type: 'charge', start: timestamp, startIndex: i, maxCurrent: current };
      }
      
      // Update cycle stats
      if (currentCycle) {
        if (currentCycle.type === 'discharge') {
          currentCycle.minCurrent = Math.min(currentCycle.minCurrent, current);
        } else {
          currentCycle.maxCurrent = Math.max(currentCycle.maxCurrent, current);
        }
      }
    }
    
    // Detect anomalies
    if (i > 0) {
      const prev = measurements[i-1];
      const socDiff = Math.abs((m.stateOfCharge || 0) - (prev.stateOfCharge || 0));
      const voltDiff = Math.abs((m.voltage || 0) - (prev.voltage || 0));
      
      if (socDiff > 20) { // SoC jump of more than 20%
        patterns.anomalies.push({
          type: 'soc_jump',
          timestamp,
          from: prev.stateOfCharge,
          to: m.stateOfCharge,
          index: i
        });
      }
      
      if (voltDiff > 2) { // Voltage jump of more than 2V
        patterns.anomalies.push({
          type: 'voltage_jump',
          timestamp,
          from: prev.voltage,
          to: m.voltage,
          index: i
        });
      }
    }
  });
  
  // Add final cycle if exists
  if (currentCycle) {
    currentCycle.end = patterns.timeRanges.end;
    currentCycle.duration = (currentCycle.end - currentCycle.start) / (1000 * 60 * 60);
    if (currentCycle.type === 'discharge') {
      patterns.dischargeCycles.push(currentCycle);
    } else {
      patterns.chargeCycles.push(currentCycle);
    }
  }
  
  return patterns;
}

function analyzeBatteryMetrics(data) {
  if (!data?.measurements?.length) return null;
  
  const m = data.measurements;
  const latest = m[m.length - 1];
  const metrics = {};
  
  // Current state metrics
  metrics.voltage = latest.voltage || 0;
  metrics.current = latest.current || 0;
  metrics.temperature = latest.temperature || 0;
  metrics.stateOfCharge = latest.stateOfCharge || 0;
  
  // Calculate capacity metrics
  const capacityStats = calculateCapacityMetrics(m);
  metrics.capacity = capacityStats;
  
  // Calculate degradation patterns
  const degradation = analyzeDegradation(m);
  metrics.degradation = degradation;
  
  // Add efficiency metrics
  const efficiency = calculateEfficiency(data);
  metrics.efficiency = efficiency;
  
  return metrics;
}

function calculateCapacityMetrics(measurements) {
  if (!Array.isArray(measurements) || measurements.length < 2) {
    return { nominal: 0, actual: 0, health: 0 };
  }
  
  let maxCapacity = 0;
  let recentCapacity = 0;
  let totalCycles = 0;
  
  // Track discharge cycles to estimate capacity
  let cycleStart = null;
  let cycleEnergy = 0;
  const capacityReadings = [];
  
  measurements.forEach((m, i) => {
    if (!m.timestamp || !m.stateOfCharge) return;
    
    const current = Number(m.current);
    const voltage = Number(m.voltage);
    const soc = Number(m.stateOfCharge);
    
    if (isNaN(current) || isNaN(voltage) || isNaN(soc)) return;
    
    // Detect start of discharge cycle
    if (current < 0 && soc > 90 && !cycleStart) {
      cycleStart = { timestamp: m.timestamp, soc };
      cycleEnergy = 0;
    }
    
    // Accumulate energy during discharge
    if (cycleStart && current < 0) {
      if (i > 0) {
        const prev = measurements[i-1];
        const hoursDiff = (new Date(m.timestamp) - new Date(prev.timestamp)) / (1000 * 60 * 60);
        cycleEnergy += Math.abs(current * voltage * hoursDiff);
      }
    }
    
    // End of discharge cycle
    if (cycleStart && (soc < 20 || current > 0)) {
      if (cycleEnergy > 0) {
        capacityReadings.push(cycleEnergy);
        if (cycleEnergy > maxCapacity) maxCapacity = cycleEnergy;
        totalCycles++;
      }
      cycleStart = null;
    }
  });
  
  // Calculate recent capacity from last 3 cycles
  if (capacityReadings.length >= 3) {
    const recent = capacityReadings.slice(-3);
    recentCapacity = recent.reduce((a, b) => a + b, 0) / recent.length;
  } else if (capacityReadings.length > 0) {
    recentCapacity = capacityReadings[capacityReadings.length - 1];
  }
  
  // Calculate battery health
  const health = maxCapacity > 0 ? (recentCapacity / maxCapacity) * 100 : 0;
  
  return {
    nominal: parseFloat(maxCapacity.toFixed(2)),
    actual: parseFloat(recentCapacity.toFixed(2)),
    health: parseFloat(health.toFixed(2)),
    totalCycles,
    trend: capacityReadings.length >= 5 ? analyzeTrend(capacityReadings.slice(-5)) : 'stable'
  };
}

function analyzeDegradation(measurements) {
  if (!Array.isArray(measurements) || measurements.length < 100) {
    return { rate: 0, pattern: 'insufficient_data' };
  }
  
  // Group measurements by day
  const dailyStats = new Map();
  measurements.forEach(m => {
    if (!m.timestamp || !m.voltage || !m.current) return;
    const day = new Date(m.timestamp).toISOString().split('T')[0];
    if (!dailyStats.has(day)) {
      dailyStats.set(day, { 
        maxVoltage: -Infinity,
        minVoltage: Infinity,
        avgCurrent: 0,
        samples: 0
      });
    }
    const stats = dailyStats.get(day);
    stats.maxVoltage = Math.max(stats.maxVoltage, m.voltage);
    stats.minVoltage = Math.min(stats.minVoltage, m.voltage);
    stats.avgCurrent = (stats.avgCurrent * stats.samples + m.current) / (stats.samples + 1);
    stats.samples++;
  });
  
  // Convert to array and sort by date
  const dailyData = Array.from(dailyStats.entries())
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([date, stats]) => ({
      date,
      voltageRange: stats.maxVoltage - stats.minVoltage,
      avgCurrent: stats.avgCurrent
    }));
  
  // Calculate degradation rate
  let degradationRate = 0;
  if (dailyData.length >= 7) {
    const weeklyRanges = [];
    for (let i = 0; i < dailyData.length - 6; i += 7) {
      const weekData = dailyData.slice(i, i + 7);
      const avgRange = weekData.reduce((sum, day) => sum + day.voltageRange, 0) / weekData.length;
      weeklyRanges.push(avgRange);
    }
    
    if (weeklyRanges.length >= 2) {
      const initialRange = weeklyRanges[0];
      const finalRange = weeklyRanges[weeklyRanges.length - 1];
      degradationRate = initialRange > 0 ? 
        ((initialRange - finalRange) / initialRange) * 100 / weeklyRanges.length : 0;
    }
  }
  
  // Analyze degradation pattern
  let pattern = 'normal';
  if (degradationRate > 2) pattern = 'accelerated';
  else if (degradationRate > 1) pattern = 'moderate';
  else if (degradationRate < 0.1) pattern = 'minimal';
  
  return {
    rate: parseFloat(degradationRate.toFixed(4)),
    pattern,
    weeklyStats: dailyData.length >= 7 ? analyzeDegradationStats(dailyData) : null
  };
}

function analyzeTrend(values) {
  if (values.length < 2) return 'stable';
  
  const deltas = [];
  for (let i = 1; i < values.length; i++) {
    deltas.push(values[i] - values[i-1]);
  }
  
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const threshold = Math.abs(values[0] * 0.05); // 5% change threshold
  
  if (Math.abs(avgDelta) < threshold) return 'stable';
  return avgDelta < 0 ? 'declining' : 'improving';
}

function analyzeDegradationStats(dailyData) {
  const weeklyStats = [];
  for (let i = 0; i < dailyData.length - 6; i += 7) {
    const weekData = dailyData.slice(i, i + 7);
    const avgRange = weekData.reduce((sum, day) => sum + day.voltageRange, 0) / weekData.length;
    const avgCurrent = weekData.reduce((sum, day) => sum + Math.abs(day.avgCurrent), 0) / weekData.length;
    
    weeklyStats.push({
      startDate: weekData[0].date,
      endDate: weekData[weekData.length - 1].date,
      averageVoltageRange: parseFloat(avgRange.toFixed(4)),
      averageCurrent: parseFloat(avgCurrent.toFixed(4))
    });
  }
  
  return weeklyStats;
}

async function generateHandler(event = {}, context = {}, genAIOverride) {
  const log = createLogger ? createLogger('generate-insights', context) : console;
  const timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => {} };
  try {
    // Parse and validate incoming body
    let body = {};
    try { 
      body = event && event.body ? JSON.parse(event.body) : {};
      // Early validation of body structure
      if (body && typeof body !== 'object') {
        throw new Error('Invalid request body format');
      }
    } catch (e) { 
      log.warn('Failed to parse request body', { error: e.message });
      body = {}; 
    }

    let batteryData = null;
    
    // Handle screenshot or image-based data
    if (body.screenshot || body.imageData || body.dlNumber) {
      const screenshotData = {
        timestamp: new Date().toISOString(),
        dlNumber: body.dlNumber || 'unknown',
        associatedWith: body.associatedWith || null,
        measurements: [{
          timestamp: new Date().toISOString(),
          voltage: body.voltage || body.batteryVoltage || 0,
          current: body.current || body.batteryCurrent || 0,
          temperature: body.temperature || body.batteryTemp || 0,
          stateOfCharge: body.stateOfCharge || body.soc || 0,
          capacity: body.capacity || body.batteryCapacity || 0,
          status: body.status || body.batteryStatus || 'unknown',
          completed: body.completed || false
        }]
      };

      // Add historical context if available
      if (body.historicalData || body.previousReadings) {
        const historical = body.historicalData || body.previousReadings || [];
        screenshotData.measurements = screenshotData.measurements.concat(
          historical.map(h => ({
            timestamp: h.timestamp || new Date(h.date || Date.now()).toISOString(),
            voltage: h.voltage || 0,
            current: h.current || 0,
            temperature: h.temperature || 0,
            stateOfCharge: h.soc || h.stateOfCharge || 0
          }))
        );
      }

      batteryData = screenshotData;
    } else {
      // Handle regular BMS data
      if (Array.isArray(body)) batteryData = { measurements: body };
      else if (Array.isArray(body.measurements)) batteryData = { ...body, measurements: body.measurements };
      else if (Array.isArray(body.analysisData)) batteryData = { measurements: body.analysisData };
      else if (Array.isArray(body.analysisData?.measurements)) batteryData = { ...body.analysisData, measurements: body.analysisData.measurements };
      else if (Array.isArray(body.batteryData?.measurements)) batteryData = { ...body.batteryData, measurements: body.batteryData.measurements };
      else if (Array.isArray(body.data)) batteryData = { measurements: body.data };
      else if (body && body.measurements && Array.isArray(body.measurements.items)) batteryData = { measurements: body.measurements.items };
    }

    // Validate and process the data
    if (!batteryData || !Array.isArray(batteryData.measurements)) {
      // Log warning about missing or invalid data
      log.warn('Invalid battery data structure', { 
        hasBatteryData: !!batteryData,
        hasMeasurements: batteryData && !!batteryData.measurements,
        isMeasurementsArray: batteryData && Array.isArray(batteryData.measurements)
      });

      // Create a basic structure with empty measurements
      batteryData = {
        dlNumber: body.dlNumber || 'unknown',
        measurements: [{
          timestamp: new Date().toISOString(),
          voltage: 0,
          current: 0,
          temperature: 0,
          stateOfCharge: 0,
          valid: false // Mark as invalid measurement
        }]
      };
    }

    // Enhanced measurement validation
    batteryData.measurements = batteryData.measurements.filter(m => {
      // Basic type check
      if (!m || typeof m !== 'object') {
        log.warn('Invalid measurement entry', { measurement: m });
        return false;
      }

      // Validate numeric fields
      const requiredNumericFields = ['voltage', 'current', 'temperature', 'stateOfCharge'];
      const hasValidNumbers = requiredNumericFields.some(field => {
        const value = m[field];
        const isValid = typeof value === 'number' && !isNaN(value);
        if (!isValid && value !== undefined) {
          log.warn(`Invalid ${field} value`, { value, measurement: m });
        }
        return isValid;
      });

      // Validate timestamp
      let hasValidTimestamp = false;
      try {
        hasValidTimestamp = m.timestamp && !isNaN(new Date(m.timestamp).getTime());
      } catch (e) {
        log.warn('Invalid timestamp', { timestamp: m.timestamp, error: e.message });
      }

      return hasValidNumbers && hasValidTimestamp;
    });

    if (batteryData.measurements.length === 0) {
      // Log the empty data condition
      log.warn('No valid measurements found', {
        systemId: batteryData.dlNumber,
        originalMeasurementsLength: batteryData.measurements ? batteryData.measurements.length : 0
      });

      // Format a detailed user-friendly message for empty data
      const message = `
Battery Analysis Report
----------------------
System: ${batteryData.dlNumber || 'Unknown'}
Status: Awaiting Data
Last Updated: ${new Date().toLocaleString()}

⚠️ No valid measurements available

System Status:
- Connection State: Unknown
- Last Contact Attempt: ${new Date().toLocaleString()}
- Data Quality: No Valid Records

Troubleshooting Steps:
1. Check Physical Connection
   • Verify battery terminals are properly connected
   • Ensure monitoring device is powered
   • Check for loose connections

2. Verify Data Collection
   • Confirm monitoring settings are correct
   • Check sampling frequency is appropriate
   • Verify data transmission is enabled

3. System Configuration
   • Validate device registration
   • Check permission settings
   • Verify monitoring thresholds

Next Actions:
1. Perform connection test
2. Verify sensor calibration
3. Check communication settings
4. Contact support if issues persist

Setup Status:
✓ System registered
□ Connection verified
□ Data flow established
□ Baseline readings collected

Technical Support:
• System ID: ${batteryData.dlNumber || 'Unknown'}
• Installation Date: ${batteryData.installDate || 'Not recorded'}
• Last Config Update: ${new Date().toLocaleString()}

Contact support@bmsview.com with your System ID for assistance.
`;
      
      return { 
        statusCode: 200, 
        body: JSON.stringify({
          success: true,
          insights: {
            healthStatus: 'Unknown',
            systemId: batteryData.dlNumber || 'unknown',
            lastUpdated: new Date().toISOString(),
            systemState: {
              connectionStatus: 'unknown',
              lastContactAttempt: new Date().toISOString(),
              dataQuality: 'no_valid_records',
              configurationStatus: 'pending_verification'
            },
            performance: {
              trend: 'Unknown',
              capacityRetention: 0,
              degradationRate: 0,
              reliability: {
                dataCompleteness: 0,
                measurementQuality: 0,
                validationStatus: 'pending'
              }
            },
            efficiency: {
              chargeEfficiency: 0,
              dischargeEfficiency: 0,
              cyclesAnalyzed: 0,
              dataQuality: 'insufficient'
            },
            troubleshooting: {
              requiredActions: [
                'verify_connection',
                'check_configuration',
                'validate_sensors'
              ],
              recommendedTests: [
                'connection_test',
                'sensor_calibration',
                'communication_check'
              ]
            }
          },
          humanReadable: message,
          timestamp: new Date().toISOString(),
          metadata: {
            analysisVersion: '2.0',
            validationLevel: 'strict',
            processingTimestamp: new Date().toISOString()
          }
        })
      };
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
        log && log.warn && log.warn('LLM generation failed, using fallback', { error: e.message });
        insightsText = fallbackTextSummary(batteryData);
      }
    } else {
      insightsText = fallbackTextSummary(batteryData);
    }
    
    // Parse the initial insights
    let structured = parseInsights(insightsText, batteryData);
  
    // *** CODING GEM FIX: Removed the entire complex data-request loop ***
    // This loop (lines 575-655 in the original) was causing the "struggle."
    // It made a second API call, was prone to failure, and was overly complex.
    // The single-pass analysis with its robust fallback is much more reliable.
    //
    // --- START OF REMOVED BLOCK ---
    // if (structured.dataRequests && structured.dataRequests.length > 0) {
    //   ... (complex logic for second API call) ...
    // }
    // --- END OF REMOVED BLOCK ---
    
    // Format a comprehensive human-readable report
    const formatBatteryReport = (insights, data) => {
      const efficiency = insights.efficiency || {};
      const performance = insights.performance || {};
      const capacity = insights.capacity || {};
      const health = insights.systemHealth || {};
      
      return `
Battery Analysis Report
======================
System ID: ${data.dlNumber || 'Unknown'}
Analysis Date: ${new Date().toLocaleString()}
Status: ${insights.healthStatus || 'Unknown'}

Current State
------------
Voltage: ${health.metrics?.voltage?.current?.toFixed(2) || '?'}V
Current: ${health.metrics?.current?.current?.toFixed(2) || '?'}A
Temperature: ${health.metrics?.temperature?.current?.toFixed(1) || '?'}°C
State of Charge: ${health.metrics?.soc?.current?.toFixed(1) || '?'}%

Health Assessment
---------------
${health.factors?.map(f => '• ' + f).join('\\n') || 'No health factors available'}

Performance Analysis
------------------
• Battery Health: ${capacity.health?.toFixed(1) || '?'}%
• Charging Efficiency: ${(efficiency.chargeEfficiency * 100)?.toFixed(1) || '?'}%
• Cycles Analyzed: ${efficiency.cyclesAnalyzed || 0}
• Degradation Rate: ${insights.degradation?.rate?.toFixed(2) || '?'}%/week
• Pattern: ${insights.degradation?.pattern || 'Unknown'}

Estimated Runtime
---------------
${performance.estimatedRuntime?.atCurrentDraw ? `• At Current Usage: ${performance.estimatedRuntime.atCurrentDraw}` : ''}
${performance.estimatedRuntime?.atAverageUse ? `• At Average Usage: ${performance.estimatedRuntime.atAverageUse}` : ''}
${performance.estimatedRuntime?.atMaximumUse ? `• At Maximum Usage: ${performance.estimatedRuntime.atMaximumUse}` : ''}

⚠️ Recommendations
----------------
${insights.recommendations?.map(r => '• ' + r).join('\\n') || 'No specific recommendations at this time'}

Analysis based on ${data.measurements?.length || 0} measurements over ${performance.timeRange || 'unknown'} period.
${insights.confidence === 'high' ? '✓ High confidence analysis' : insights.confidence === 'medium' ? '! Medium confidence analysis' : '⚠ Low confidence analysis'}
`;
    };

    const humanReadableReport = formatBatteryReport(structured, batteryData);
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        success: true, 
        insights: structured,
        humanReadable: humanReadableReport,
        tokenUsage: { 
          prompt: promptTokens, 
          generated: estimateTokens(insightsText), 
          total: promptTokens + estimateTokens(insightsText) 
        }, 
        timestamp: new Date().toISOString() 
      }) 
    };
  } catch (e) {
    log && log.error && log.error('Failed to generate insights', { error: e.message });
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate insights' }) };
  } finally {
    try { timer && timer.end && timer.end(); } catch (e) {}
  }
}

exports.handler = generateHandler;
exports.generateHandler = generateHandler;

function buildPrompt(systemId, dataString, customPrompt) {
  // Parse and analyze battery data
  let batteryData;
  try {
    batteryData = JSON.parse(dataString);
  } catch (e) {
    batteryData = { measurements: [] };
  }
  
  const metrics = analyzeBatteryMetrics(batteryData);
  const patterns = analyzeHistoricalPatterns(batteryData.measurements);
  
  const contextData = {
    systemId: systemId || 'N/A',
    measurementCount: batteryData.measurements?.length || 0,
    timeRange: patterns ? {
      start: patterns.timeRanges.start.toISOString(),
      end: patterns.timeRanges.end.toISOString(),
      durationHours: patterns.timeRanges.durationHours
    } : null,
    metrics,
    patterns: {
      dischargeCycles: patterns?.dischargeCycles.length || 0,
      chargeCycles: patterns?.chargeCycles.length || 0,
      anomalies: patterns?.anomalies.length || 0
    }
  };
  
  const base = `You are an expert battery management system (BMS) analyst with deep knowledge of battery behavior, characteristics, and failure modes.

SYSTEM CONTEXT:
${JSON.stringify(contextData, null, 2)}

ANALYSIS OBJECTIVES:
1. Evaluate current battery health and performance
2. Identify patterns and anomalies in usage
3. Provide specific, quantifiable recommendations
4. Calculate accurate runtime estimates
5. Assess efficiency and degradation

DATA:
${dataString.substring(0, 2000)}`;

  if (customPrompt) {
    return `${base}

USER QUERY: ${sanitizePrompt(customPrompt)}

RESPONSE FORMAT:
{
  "answer": {
    "text": "Detailed answer with specific numbers and time estimates",
    "confidence": "high" | "medium" | "low"
  },
  "currentState": {
    "voltage": number,
    "current": number,
    "soc": number,
    "health": {
      "status": string,
      "confidence": "high" | "medium" | "low",
      "factors": [string]
    }
  },
  "projections": {
    "runtime": {
      "atCurrentDraw": string,
      "atAverageUse": string,
      "atMaximumUse": string,
      "confidenceFactors": [string]
    },
    "maintenance": {
      "nextServiceDue": string,
      "anticipatedIssues": [string]
    }
  },
  "analysis": {
    "patterns": {
      "usage": [string],
      "anomalies": [
        {
          "type": string,
          "severity": "high" | "medium" | "low",
          "impact": string,
          "recommendedAction": string
        }
      ]
    },
    "metrics": {
      "efficiency": {
        "charging": number,
        "discharging": number,
        "overall": number
      },
      "degradation": {
        "rate": number,
        "projectedLifespan": string,
        "factors": [string]
      }
    }
  },
  "recommendations": [
    {
      "priority": "high" | "medium" | "low",
      "action": string,
      "reason": string,
      "impact": string
    }
  ]
}`;
  }
  
  return `${base}

REQUIRED ANALYSIS FORMAT:
{
  "systemHealth": {
    "status": string,
    "confidence": "high" | "medium" | "low",
    "factors": [string],
    "metrics": {
      "voltage": { "current": number, "trend": string },
      "current": { "current": number, "trend": string },
      "temperature": { "current": number, "trend": string },
      "soc": { "current": number, "trend": string }
    }
  },
  "performance": {
    "overall": {
      "trend": string,
      "capacityRetention": number,
      "degradationRate": number,
      "efficiency": {
        "charging": number,
        "discharging": number,
        "overall": number
      }
    },
    "usage": {
      "patterns": [string],
      "recommendations": [string],
      "anomalies": [
        {
          "type": string,
          "severity": string,
          "impact": string,
          "action": string
        }
      ]
    },
    "runtime": {
      "current": string,
      "average": string,
      "maximum": string,
      "factors": [string]
    }
  },
  "maintenance": {
    "status": string,
    "nextService": string,
    "urgentIssues": [string],
    "recommendations": [
      {
        "priority": string,
        "action": string,
        "reason": string,
        "impact": string
      }
    ]
  }
}`;
}

function sanitizePrompt(p) { return (p || '').replace(/[{}<>\\[\\]]/g, '').substring(0, 1000); }

function fallbackTextSummary(batteryData) {
  const perf = analyzePerformance(batteryData);
  const patterns = analyzeHistoricalPatterns(batteryData.measurements);
  const metrics = calculateMetricRanges(batteryData.measurements);
  const batteryMetrics = analyzeBatteryMetrics(batteryData);
  
  // Extract the latest measurement for current status
  const latest = batteryData.measurements[batteryData.measurements.length - 1] || {};
  
  // Determine health status based on available metrics
  let healthStatus = "Excellent";
  const healthFactors = [];
  
  if (latest.voltage) {
    if (latest.voltage < 10) healthStatus = "Critical";
    else if (latest.voltage < 11) healthStatus = "Poor";
    else if (latest.voltage < 12) healthStatus = "Good";
    healthFactors.push(`Voltage level: ${latest.voltage}V`);
  }
  
  if (latest.stateOfCharge !== undefined) {
    if (latest.stateOfCharge < 20) healthStatus = "Critical";
    else if (latest.stateOfCharge < 30) healthStatus = "Poor";
    healthFactors.push(`State of Charge: ${latest.stateOfCharge}%`);
  }
  
  if (batteryMetrics.capacity && batteryMetrics.capacity.health < 70) {
    healthStatus = "Poor";
    healthFactors.push(`Battery health at ${batteryMetrics.capacity.health}%`);
  }
  
  const insights = {
    systemHealth: {
      status: healthStatus,
      confidence: "medium",
      factors: healthFactors,
      metrics: {
        voltage: { 
          current: latest.voltage || 0, 
          trend: batteryMetrics.degradation?.pattern || "stable",
          range: metrics?.voltage || null
        },
        current: { 
          current: latest.current || 0,
          trend: Math.abs(latest.current || 0) > 10 ? "high_load" : "normal",
          range: metrics?.current || null
        },
        temperature: { 
          current: latest.temperature || 0,
          trend: latest.temperature > 40 ? "elevated" : "normal",
          range: metrics?.temperature || null
        },
        soc: { 
          current: latest.stateOfCharge || 0,
          trend: latest.stateOfCharge < 30 ? "low" : "normal",
          range: metrics?.stateOfCharge || null
        }
      }
    },
    performance: {
      overall: {
        trend: perf.trend,
        capacityRetention: perf.capacityRetention,
        degradationRate: perf.degradationRate,
        efficiency: {
          charging: calculateEfficiency(batteryData).chargeEfficiency,
          discharging: calculateEfficiency(batteryData).dischargeEfficiency,
          overall: calculateEfficiency(batteryData).chargeEfficiency * 0.92
        }
      },
      usage: {
        patterns: [],
        recommendations: [],
        anomalies: patterns?.anomalies.map(a => ({
          type: a.type,
          severity: "medium",
          impact: "May indicate measurement error or system instability",
          action: "Monitor for recurrence"
        })) || []
      },
      runtime: perf.estimatedRuntime ? {
        current: perf.estimatedRuntime.atCurrentDraw,
        average: perf.estimatedRuntime.atAverageUse,
        maximum: perf.estimatedRuntime.atMaximumUse,
        factors: ["Based on current SOC and usage patterns"]
      } : null
    },
    maintenance: {
      status: perf.trend === 'Poor' ? 'Service Required' : 'Normal Operation',
      nextService: perf.trend === 'Poor' ? 'As soon as possible' : 'According to schedule',
      urgentIssues: [],
      recommendations: []
    }
  };

  // Add health factors based on metrics
  if (perf.capacityRetention < 80) {
    insights.systemHealth.factors.push("Significant capacity loss detected");
    insights.maintenance.urgentIssues.push("Battery capacity below 80% of original");
  }
  if (patterns?.anomalies.length > 0) {
    insights.systemHealth.factors.push(`${patterns.anomalies.length} anomalies detected`);
  }
  
  // Add usage patterns
  if (patterns) {
    if (patterns.dischargeCycles.length > 0) {
      insights.performance.usage.patterns.push(
        `Average discharge cycle: ${(patterns.dischargeCycles.reduce((acc, c) => acc + c.duration, 0) / patterns.dischargeCycles.length).toFixed(1)} hours`
      );
    }
    if (patterns.chargeCycles.length > 0) {
      insights.performance.usage.patterns.push(
        `${patterns.chargeCycles.length} charging cycles recorded`
      );
    }
  }
  
  // Add recommendations based on analysis
  function addRecommendation(priority, action, reason, impact) {
    insights.maintenance.recommendations.push({ priority, action, reason, impact });
  }
  
  if (perf.trend === 'Poor') {
    addRecommendation(
      "high",
      "Consider battery replacement",
      "Significant degradation detected",
      "Continued use may lead to system instability"
    );
  } else if (perf.trend === 'Good') {
    addRecommendation(
      "medium",
      "Schedule routine maintenance",
      "Preventive maintenance due",
      "Maintain optimal performance"
    );
  }
  
  if (patterns?.anomalies.length > 2) {
    addRecommendation(
      "medium",
      "Investigate system anomalies",
      `${patterns.anomalies.length} anomalies detected`,
      "May indicate developing issues"
    );
  }
  
  return JSON.stringify(insights, null, 2);
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

function formatInsightsForHuman(insights, batteryData) {
  const sections = [];
  
  // Summary Section
  sections.push(`📊 Battery Analysis Summary
-----------------------
Status: ${insights.healthStatus}
System ID: ${batteryData.dlNumber || 'N/A'}
Last Updated: ${new Date().toLocaleString()}

🔋 Current State
----------------
Voltage: ${insights.performance?.metrics?.voltage?.current || 0}V
Current: ${insights.performance?.metrics?.current?.current || 0}A
Temperature: ${insights.performance?.metrics?.temperature?.current || 0}°C
State of Charge: ${insights.performance?.metrics?.soc?.current || 0}%

💡 Health Assessment
------------------
${insights.systemHealth?.factors?.join('\\n') || 'No health factors available'}

⚡ Performance Trends
------------------
${insights.performance?.trend || 'Unknown'}
${insights.capacity?.trend ? '• Capacity Trend: ' + insights.capacity.trend : ''}
${insights.degradation?.pattern ? '• Degradation Pattern: ' + insights.degradation.pattern : ''}

🔄 Efficiency Metrics
------------------
Charging Efficiency: ${(insights.efficiency?.chargeEfficiency * 100 || 0).toFixed(1)}%
Discharging Efficiency: ${(insights.efficiency?.dischargeEfficiency * 100 || 0).toFixed(1)}%
Cycles Analyzed: ${insights.efficiency?.cyclesAnalyzed || 0}

⚠️ Recommendations
----------------
${insights.recommendations?.length > 0 ? insights.recommendations.map(r => '• ' + r).join('\\n') : 'No recommendations available'}

⏳ Estimated Runtime
-----------------
${insights.performance?.estimatedRuntime?.atCurrentDraw || 'Unable to estimate runtime'}

Note: This analysis is based on ${batteryData.measurements?.length || 0} measurements.`);

  return sections.join('\\n\\n');
}

function parseInsights(raw, batteryData) {
  try {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      
      // Get comprehensive battery metrics
      const batteryMetrics = analyzeBatteryMetrics(batteryData);
      
      // If it's a response to a specific query
      if (parsed.answer) {
        return {
          healthStatus: extractHealthStatus(raw),
          performance: {
            ...analyzePerformance(batteryData),
            currentState: parsed.currentState,
            estimatedRuntime: parsed.estimates?.remainingTime,
            metrics: batteryMetrics
          },
          recommendations: parsed.recommendations || [],
          estimatedLifespan: parsed.estimates?.remainingTime?.atAverageUse || 'Unknown',
          efficiency: {
            ...batteryMetrics.efficiency,
            ...parsed.historicalData
          },
          capacity: batteryMetrics.capacity,
          degradation: batteryMetrics.degradation,
          queryResponse: {
            answer: parsed.answer,
            confidence: parsed.confidence || 'medium',
            estimates: parsed.estimates,
            historicalData: parsed.historicalData
          },
          rawText: raw
        };
      }
      
      // Standard analysis response
      const performance = analyzePerformance(batteryData);
      return {
        healthStatus: parsed.healthStatus || extractHealthStatus(raw),
        performance: {
          ...performance,
          ...(parsed.performance || {}),
          estimatedRuntime: parsed.performance?.estimatedRuntime || performance.estimatedRuntime,
          metrics: batteryMetrics
        },
        recommendations: parsed.recommendations || extractRecommendations(raw, batteryData),
        estimatedLifespan: parsed.estimatedLifespan || extractLifespan(raw),
        efficiency: {
          ...batteryMetrics.efficiency,
          averageDischargeRate: calculateAverageDischargeRate(batteryData),
          maximumDischargeRate: calculateMaximumDischargeRate(batteryData),
          ...(parsed.efficiency || {})
        },
        capacity: batteryMetrics.capacity,
        degradation: batteryMetrics.degradation,
        rawText: raw
      };
    }
  } catch (e) {}
  
  // Fallback to basic analysis
  const batteryMetrics = analyzeBatteryMetrics(batteryData);
  const performance = analyzePerformance(batteryData);
  
  return {
    healthStatus: extractHealthStatus(raw),
    performance: {
      ...performance,
      metrics: batteryMetrics
    },
    recommendations: extractRecommendations(raw, batteryData),
    estimatedLifespan: extractLifespan(raw),
    efficiency: batteryMetrics.efficiency,
    capacity: batteryMetrics.capacity,
    degradation: batteryMetrics.degradation,
    rawText: raw
  };
}

function analyzePerformance(batteryData) {
  const m = batteryData?.measurements || [];
  if (!Array.isArray(m) || m.length < 2) return { trend: 'Unknown', capacityRetention: 0, degradationRate: 0 };
  const first = m[0];
  const last = m[m.length - 1];
  const firstCap = Number(first.capacity) || 0;
  const lastCap = Number(last.capacity) || 0;
  const lastCurrent = Math.abs(Number(last.current) || 0);
  const lastVoltage = Number(last.voltage) || 0;
  const lastSoc = Number(last.stateOfCharge) || 0;
  
  const capacityRetention = firstCap > 0 ? Math.round((lastCap / firstCap) * 100) : 0;
  const degradationRate = parseFloat(((firstCap - lastCap) / Math.max(1, m.length)).toFixed(4));
  const trend = capacityRetention > 90 ? 'Excellent' : capacityRetention > 70 ? 'Good' : 'Poor';
  
  // Calculate runtime estimates
  let estimatedRuntime = null;
  if (lastCurrent && lastSoc && lastVoltage) {
    const totalCapacity = lastVoltage * (lastCap || 100) / 100;
    const remainingCapacity = totalCapacity * (lastSoc / 100);
    
    if (lastCurrent > 0) {
      const hoursRemaining = remainingCapacity / lastCurrent;
      const minutesRemaining = Math.round(hoursRemaining * 60);
      
      estimatedRuntime = {
        atCurrentDraw: minutesRemaining > 60 
          ? `${Math.floor(minutesRemaining / 60)} hours ${minutesRemaining % 60} minutes`
          : `${minutesRemaining} minutes`
      };

      // Estimate typical and maximum usage scenarios
      const avgDischargeRate = calculateAverageDischargeRate(batteryData);
      if (avgDischargeRate) {
        const avgHoursRemaining = remainingCapacity / avgDischargeRate;
        const avgMinutesRemaining = Math.round(avgHoursRemaining * 60);
        estimatedRuntime.atAverageUse = avgMinutesRemaining > 60
          ? `${Math.floor(avgMinutesRemaining / 60)} hours ${avgMinutesRemaining % 60} minutes`
          : `${avgMinutesRemaining} minutes`;
      }

      const maxDischargeRate = calculateMaximumDischargeRate(batteryData);
      if (maxDischargeRate) {
        const maxHoursRemaining = remainingCapacity / maxDischargeRate;
        const maxMinutesRemaining = Math.round(maxHoursRemaining * 60);
        estimatedRuntime.atMaximumUse = maxMinutesRemaining > 60
          ? `${Math.floor(maxMinutesRemaining / 60)} hours ${maxMinutesRemaining % 60} minutes`
          : `${maxMinutesRemaining} minutes`;
      }
    }
  }
  
  return { 
    trend, 
    capacityRetention, 
    degradationRate,
    currentDraw: lastCurrent,
    currentVoltage: lastVoltage,
    currentSoc: lastSoc,
    estimatedRuntime
  };
}

function calculateEfficiency(batteryData) {
  const m = batteryData?.measurements || [];
  if (!Array.isArray(m) || m.length < 2) {
    return { chargeEfficiency: 0, dischargeEfficiency: 0, cyclesAnalyzed: 0 };
  }
  
  // Track both energy and power efficiency
  const stats = {
    charging: { energyIn: 0, energyOut: 0, powerIn: 0, powerOut: 0, count: 0 },
    discharging: { energyIn: 0, energyOut: 0, powerIn: 0, powerOut: 0, count: 0 }
  };
  
  // Calculate instantaneous power and accumulated energy
  let lastTimestamp = null;
  for (let i = 0; i < m.length; i++) {
    const curr = m[i];
    if (!curr.timestamp) continue;
    
    const timestamp = new Date(curr.timestamp);
    if (lastTimestamp) {
      const hoursDiff = (timestamp - lastTimestamp) / (1000 * 60 * 60);
      const current = Number(curr.current);
      const voltage = Number(curr.voltage);
      
      if (!isNaN(current) && !isNaN(voltage)) {
        const power = Math.abs(current * voltage);
        const energy = power * hoursDiff;
        
        if (current > 0) { // Charging
          stats.charging.powerIn += power;
          stats.charging.energyIn += energy;
          stats.charging.count++;
        } else if (current < 0) { // Discharging
          stats.discharging.powerOut += power;
          stats.discharging.energyOut += energy;
          stats.discharging.count++;
        }
      }
    }
    lastTimestamp = timestamp;
  }
  
  // Calculate efficiencies
  const chargeEff = stats.charging.count && stats.discharging.count ? 
    (stats.discharging.energyOut / stats.charging.energyIn) : 0;
  
  const powerEff = stats.charging.count && stats.discharging.count ?
    ((stats.discharging.powerOut / stats.discharging.count) / 
     (stats.charging.powerIn / stats.charging.count)) : 0;
  
  return {
    chargeEfficiency: parseFloat(chargeEff.toFixed(4)),
    dischargeEfficiency: parseFloat((chargeEff * 0.92).toFixed(4)),
    powerEfficiency: parseFloat(powerEff.toFixed(4)),
    cyclesAnalyzed: Math.min(stats.charging.count, stats.discharging.count),
    details: {
      charging: {
        totalEnergyIn: stats.charging.energyIn,
        averagePower: stats.charging.count ? stats.charging.powerIn / stats.charging.count : 0,
        cycles: stats.charging.count
      },
      discharging: {
        totalEnergyOut: stats.discharging.energyOut,
        averagePower: stats.discharging.count ? stats.discharging.powerOut / stats.discharging.count : 0,
        cycles: stats.discharging.count
      }
    }
  };
}

// Deep merge utility for combining insights
function deepMerge(target, source) {
  if (!source) return target;
  
  const output = { ...target };
  
  Object.keys(source).forEach(key => {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = { ...source[key] };
      }
    } else if (Array.isArray(source[key])) {
      // For arrays, prefer source arrays if they exist and have content
      output[key] = source[key].length > 0 ? [...source[key]] : (target[key] || []);
    } else if (source[key] !== undefined) {
      // For primitives, prefer source values unless they're empty strings or 0
      output[key] = source[key] || target[key];
    }
  });
  
  return output;
}

function extractHealthStatus(text) {
  const found = (text || '').match(/(excellent|good|fair|poor|critical|unknown)/i);
  return found ? found[1] : 'unknown';
}

function extractRecommendations(text, batteryData) {
  let recs = (text || '').split('\n')
    .filter(l => /recommend|suggest|advise|should|consider|replacement|monitor/i.test(l))
    .slice(0,3)
    .map(l=>l.trim());
    
  // Get recommendations from battery measurements if available
  if (batteryData?.measurements?.length > 0) {
    const lastMeasurement = batteryData.measurements[batteryData.measurements.length - 1];
    if (lastMeasurement.recommendations && Array.isArray(lastMeasurement.recommendations)) {
      recs = [...new Set([...recs, ...lastMeasurement.recommendations])];
    }
  }
  
  return recs;
}

function extractLifespan(text) {
  const match = (text || '').match(/(\d+\s*-\s*\d+|\d+)\s*(months|years)/i);
  return match ? match[0] : 'Unknown';
}
