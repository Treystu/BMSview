const { createLogger, createTimer } = require('./utils/logger.cjs');

// Clean single-file generate-insights handler
// - Normalizes multiple input shapes
// - Uses a small deterministic fallback summary (no external LLM dependency)
// - Token safety guard and input sanitization

const estimateTokens = (str) => Math.ceil(((str || '') + '').length / 4);
const MAX_TOKENS = 32000;
const BASE_PROMPT_TOKENS = 1200;

async function generateHandler(event = {}, context = {}, genAIOverride) {
  const log = createLogger ? createLogger('generate-insights', context) : console;
  const timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => {} };
  try {
    let body = {};
    try { body = event && event.body ? JSON.parse(event.body) : {}; } catch (e) { body = {}; }

    let batteryData = null;
    if (Array.isArray(body)) batteryData = { measurements: body };
    else if (Array.isArray(body.measurements)) batteryData = { ...body, measurements: body.measurements };
    else if (Array.isArray(body.analysisData)) batteryData = { measurements: body.analysisData };
    else if (Array.isArray(body.analysisData?.measurements)) batteryData = { ...body.analysisData, measurements: body.analysisData.measurements };
    else if (Array.isArray(body.batteryData?.measurements)) batteryData = { ...body.batteryData, measurements: body.batteryData.measurements };
    else if (Array.isArray(body.data)) batteryData = { measurements: body.data };
    else if (body && body.measurements && Array.isArray(body.measurements.items)) batteryData = { measurements: body.measurements.items };

    if (body && (body.batteryData === null || body.analysisData === null)) throw new Error('Failed to generate insights');
    if (!batteryData && body && (body.batteryData || body.analysisData || body.measurements || body.data)) batteryData = { measurements: [] };
    if (!batteryData) throw new Error('Failed to generate insights');
    if (!Array.isArray(batteryData.measurements)) batteryData.measurements = [];

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
        log && log.warn && log.warn('LLM generation failed, using fallback', { error: e.message });
        insightsText = fallbackTextSummary(batteryData);
      }
    } else {
      insightsText = fallbackTextSummary(batteryData);
    }
    
    const structured = parseInsights(insightsText, batteryData);

    return { statusCode: 200, body: JSON.stringify({ success: true, insights: structured, tokenUsage: { prompt: promptTokens, generated: estimateTokens(insightsText), total: promptTokens + estimateTokens(insightsText) }, timestamp: new Date().toISOString() }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate insights' }) };
  } finally {
    try { timer && timer.end && timer.end(); } catch (e) {}
  }
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
      estimatedRuntime: {
        atCurrentDraw: string,
        atAverageUse: string,
        atMaximumUse: string
      }
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
  const perf = analyzePerformance(batteryData);
  let rec = [];
  if (perf.trend === 'Poor') rec.push('Consider replacement'); else rec.push('Routine monitoring');
  return `Health status: ${perf.trend}\nPerformance trends: capacityRetention ${perf.capacityRetention}%\nRecommendations: ${rec.join('; ')}\nEstimated lifespan: ${perf.trend === 'Excellent' ? '3-5 years' : perf.trend === 'Good' ? '2-4 years' : 'Unknown'}`;
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

function parseInsights(raw, batteryData) {
  try {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      
      // If it's a response to a specific query
      if (parsed.answer) {
        return {
          healthStatus: extractHealthStatus(raw),
          performance: {
            ...analyzePerformance(batteryData),
            currentState: parsed.currentState,
            estimatedRuntime: parsed.estimates?.remainingTime
          },
          recommendations: parsed.recommendations || [],
          estimatedLifespan: parsed.estimates?.remainingTime?.atAverageUse || 'Unknown',
          efficiency: {
            ...calculateEfficiency(batteryData),
            ...parsed.historicalData
          },
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
          estimatedRuntime: parsed.performance?.estimatedRuntime || performance.estimatedRuntime
        },
        recommendations: parsed.recommendations || extractRecommendations(raw, batteryData),
        estimatedLifespan: parsed.estimatedLifespan || extractLifespan(raw),
        efficiency: {
          ...calculateEfficiency(batteryData),
          averageDischargeRate: calculateAverageDischargeRate(batteryData),
          maximumDischargeRate: calculateMaximumDischargeRate(batteryData),
          ...(parsed.efficiency || {})
        },
        rawText: raw
      };
    }
  } catch (e) {}
  
  // Fallback to basic analysis
  const performance = analyzePerformance(batteryData);
  const efficiency = calculateEfficiency(batteryData);
  
  return {
    healthStatus: extractHealthStatus(raw),
    performance: {
      ...performance
    },
    recommendations: extractRecommendations(raw, batteryData),
    estimatedLifespan: extractLifespan(raw),
    efficiency: {
      ...efficiency,
      averageDischargeRate: calculateAverageDischargeRate(batteryData),
      maximumDischargeRate: calculateMaximumDischargeRate(batteryData)
    },
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
  let totalRatio = 0; let count = 0;
  for (let i = 1; i < m.length; i++) {
    const prev = m[i-1]; const curr = m[i];
    if (!prev || !curr) continue;
    if (typeof prev.energyIn === 'number' && typeof curr.energyOut === 'number' && prev.energyIn > 0) {
      const ratio = (curr.energyOut || 0) / (prev.energyIn || 1);
      totalRatio += ratio; count++;
    }
  }
  const avg = count ? parseFloat((totalRatio / count).toFixed(4)) : 0;
  return { chargeEfficiency: avg, dischargeEfficiency: parseFloat((avg * 0.92).toFixed(4)), cyclesAnalyzed: count };
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
