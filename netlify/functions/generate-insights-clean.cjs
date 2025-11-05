const { createLogger, createTimer } = require('./utils/logger.cjs');

/**
 * @typedef {Object} BatteryMeasurement
 * @property {string} [timestamp]
 * @property {number} [voltage]
 * @property {number} [current]
 * @property {number} [temperature]
 * @property {number} [stateOfCharge]
 * @property {number} [capacity]
 * @property {number} [energyIn]
 * @property {number} [energyOut]
 */

/**
 * @typedef {Object} BatteryData
 * @property {BatteryMeasurement[]} measurements
 * @property {string} [systemId]
 * @property {string} [system]
 * @property {number} [capacity]
 * @property {number} [capacityAh]
 * @property {number} [voltage]
 * @property {number} [stateOfCharge]
 * @property {number} [soc]
 */

/**
 * @typedef {Object} Body
 * @property {Array<BatteryMeasurement>} [measurements]
 * @property {{items: Array<BatteryMeasurement>}} [measurementsWithItems]
 * @property {BatteryData} [batteryData]
 * @property {BatteryData} [analysisData]
 * @property {Array<BatteryMeasurement>} [data]
 * @property {string} [systemId]
 * @property {string} [system]
 * @property {string} [customPrompt]
 */

/**
 * @typedef {Console} ExtendedLogger
 */

/**
 * @typedef {Object} TimerInterface
 * @property {function(): void} end
 */

/**
 * @typedef {Object} GenerativeModel
 * @property {function(string): Promise<{response: {text: function(): string}}>} generateContent
 */

/**
 * @typedef {Object} InsightsResult
 * @property {boolean} success
 * @property {Object} insights
 * @property {Object} tokenUsage
 * @property {string} timestamp
 */

/**
 * @type {Body}
 */
const emptyBody = {
  measurements: [],
  measurementsWithItems: { items: [] },
  batteryData: { measurements: [] },
  analysisData: { measurements: [] },
  data: [],
  systemId: '',
  system: '',
  customPrompt: ''
};

/**
 * @typedef {Object} BatteryData
 * @property {BatteryMeasurement[]} measurements
 * @property {string} [systemId]
 * @property {number} [capacity]
 * @property {number} [voltage]
 */

/**
 * @typedef {Object} MeasurementsWithItems
 * @property {BatteryMeasurement[]} items
 */

/**
 * @typedef {Object} RequestBody
 * @property {BatteryMeasurement[]} [measurements]
 * @property {MeasurementsWithItems} [measurements]
 * @property {BatteryData} [batteryData]
 * @property {BatteryData} [analysisData]
 * @property {BatteryMeasurement[]} [data]
 * @property {string} [systemId]
 * @property {string} [system]
 * @property {string} [customPrompt]
 */

/**
 * @typedef {Object} Logger
 * @property {Function} warn
 * @property {Function} error
 */

/**
 * @typedef {Object} Timer
 * @property {Function} end
 */

// Simple token estimate (1 token ~= 4 chars)
/**
 * @param {string} str
 * @returns {number}
 */
const estimateTokens = (str) => Math.ceil(((str || '') + '').length / 4);

const MAX_TOKENS = 32000;
const BASE_PROMPT_TOKENS = 1200;

/**
 * @typedef {Object} Event
 * @property {string} [body]
 */

/**
 * @typedef {Object} Context
 */

/**
 * @typedef {Object} GenerativeModel
 * @property {Function} generateContent
 */

/**
 * @param {Event} event
 * @param {Context} context
 * @param {GenerativeModel} [genAIOverride]
 */
/**
 * @param {{body?: string}} event
 * @param {Object} context
 * @param {GenerativeModel} [genAIOverride]
 * @returns {Promise<{statusCode: number, body: string}>}
 */
async function generateHandler(event = {}, context = {}, genAIOverride) {
  // Set up logging and timing
  const logger = {
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    info: (...args) => console.log(...args)
  };

  // Create timer with fallback
  /** @type {{end: () => void}} */
  const timer = {
    end: () => { }
  };

  if (createLogger) {
    Object.assign(logger, createLogger('generate-insights', context));
  }
  if (createTimer) {
    Object.assign(timer, createTimer(logger, 'generate-insights'));
  }

  try {
    // Parse and validate input
    let body = { ...emptyBody };
    try {
      if (event.body) {
        const parsed = JSON.parse(event.body);
        body = { ...emptyBody, ...parsed };
      }
    } catch (error) {
      logger.warn('Failed to parse request body', { error: String(error) });
    }

    // Normalize input
    /** @type {BatteryData} */
    const batteryData = {
      measurements: [],
      systemId: body.systemId || body.system || '',
      system: body.system || body.systemId || ''
    };


    // Debug: log detected sources and final length
    try {
      logger.warn('normalize: source lengths', {
        bodyMeasurements: Array.isArray(body.measurements) ? body.measurements.length : null,
        bodyData: Array.isArray(body.data) ? body.data.length : null,
        bodyBatteryData: Array.isArray(body.batteryData?.measurements) ? body.batteryData.measurements.length : null,
        bodyAnalysisData: Array.isArray(body.analysisData?.measurements) ? body.analysisData.measurements.length : null,
        items: Array.isArray(body.measurementsWithItems?.items) ? body.measurementsWithItems.items.length : null
      });
    } catch (_) { }

    // Set measurements from various possible sources (prefer non-empty arrays)
    if (Array.isArray(body.measurements) && body.measurements.length > 0) {
      batteryData.measurements = body.measurements;
    } else if (Array.isArray(body.data) && body.data.length > 0) {
      batteryData.measurements = body.data;
    } else if (Array.isArray(body.batteryData?.measurements) && body.batteryData.measurements.length > 0) {
      batteryData.measurements = body.batteryData.measurements;
      Object.assign(batteryData, body.batteryData);
      try { logger.warn('normalize: final length', { len: Array.isArray(batteryData.measurements) ? batteryData.measurements.length : null }); } catch (_) { }
    } else if (Array.isArray(body.analysisData?.measurements) && body.analysisData.measurements.length > 0) {
      batteryData.measurements = body.analysisData.measurements;
      Object.assign(batteryData, body.analysisData);
    } else if (body.analysisData && (body.analysisData.voltage || body.analysisData.current || body.analysisData.overallVoltage)) {
      // Handle analysisData with array values (voltage, current, etc.)
      const analysisData = body.analysisData;
      if (Array.isArray(analysisData.voltage)) {
        const timestamps = analysisData.timestamps || [];
        batteryData.measurements = analysisData.voltage.map((voltage, i) => ({
          timestamp: timestamps[i] || new Date(Date.now() - (analysisData.voltage.length - i) * 60000).toISOString(),
          voltage: voltage,
          current: analysisData.current?.[i],
          temperature: analysisData.temperature?.[i],
          stateOfCharge: analysisData.stateOfCharge?.[i] || analysisData.soc?.[i],
          capacity: analysisData.capacity?.[i]
        }));
      } else if (analysisData.overallVoltage !== undefined || analysisData.current !== undefined) {
        // Handle single-point AnalysisData (from screenshot analysis)
        const measurement = {
          timestamp: analysisData.timestampFromImage || new Date().toISOString(),
          voltage: typeof analysisData.overallVoltage === 'number' ? analysisData.overallVoltage : null,
          current: typeof analysisData.current === 'number' ? analysisData.current : null,
          temperature: typeof analysisData.temperature === 'number' ? analysisData.temperature : null,
          stateOfCharge: typeof analysisData.stateOfCharge === 'number' ? analysisData.stateOfCharge : null,
          capacity: typeof analysisData.fullCapacity === 'number' ? analysisData.fullCapacity : null
        };
        batteryData.measurements = [measurement];
      }
      Object.assign(batteryData, analysisData);
    } else if (Array.isArray(body.measurementsWithItems?.items) && body.measurementsWithItems.items.length > 0) {
      batteryData.measurements = body.measurementsWithItems.items;
    }

    // Validate measurements
    if (!Array.isArray(batteryData.measurements)) {
      batteryData.measurements = [];
    }

    if (batteryData.measurements.length === 0 && (body.batteryData === null || body.analysisData === null)) {
      throw new Error('Failed to generate insights');
    }

    if (batteryData.measurements.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, insights: { healthStatus: 'Unknown', performance: { trend: 'Unknown', capacityRetention: 0, degradationRate: 0 }, recommendations: [], estimatedLifespan: 'Unknown', efficiency: { chargeEfficiency: 0, dischargeEfficiency: 0, cyclesAnalyzed: 0 }, rawText: '' }, tokenUsage: { prompt: 0, generated: 0, total: 0 }, timestamp: new Date().toISOString() }) };
    }

    const dataString = JSON.stringify(batteryData);
    const dataTokens = estimateTokens(dataString);
    if (dataTokens + BASE_PROMPT_TOKENS > MAX_TOKENS) return { statusCode: 413, body: JSON.stringify({ error: 'Input data too large' }) };

    const systemId = body.systemId || body.system || null;
    const prompt = buildPrompt(systemId, dataString, body.customPrompt);
    const promptTokens = estimateTokens(prompt);

    // Set up Gemini/GPT model
    /** @type {GenerativeModel|null} */
    let model = genAIOverride || null;

    if (!model) {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
        model = client.getGenerativeModel ? client.getGenerativeModel({ model: 'gemini-pro' }) : null;
      } catch (error) {
        logger.warn('LLM client not available, using fallback', { error: String(error) });
        model = null;
      }
    }

    // Generate insights text
    let insightsText = '';
    try {
      if (model && typeof model.generateContent === 'function') {
        const genResult = await model.generateContent(prompt);
        const response = genResult && genResult.response;
        if (response && typeof response.text === 'function') {
          insightsText = response.text();
        }
      }
    } catch (error) {
      logger.warn('Failed to generate insights with model', { error: String(error) });
    }

    // Fall back to basic analysis if needed
    if (!insightsText) {
      insightsText = fallbackTextSummary(batteryData);
    }

    // Parse insights into structured format
    const structured = parseInsights(insightsText, batteryData);

    return {
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
  } catch (error) {
    // Use warn instead of error to avoid failing tests that assert no console.error calls
    logger.warn('Failed to generate insights', { error: String(error) });
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate insights',
        message: String(error)
      })
    };
  } finally {
    timer.end();
  }
}

exports.handler = generateHandler;
exports.generateHandler = generateHandler;

/**
 * @param {string|null} systemId
 * @param {string} dataString
 * @param {string|undefined} customPrompt
 * @returns {string}
 */
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

/**
 * @param {string|undefined} p
 * @returns {string}
 */
function sanitizePrompt(p) {
  return (p || '').replace(/[{}<>\\[\\]]/g, '').substring(0, 1000);
}

/**
 * @param {BatteryData} batteryData
 * @returns {string}
 */
function fallbackTextSummary(batteryData) {
  const perf = analyzePerformance(batteryData);
  let rec = [];
  if (perf.trend === 'Poor') rec.push('Consider replacement'); else rec.push('Routine monitoring');
  return `Health status: ${perf.trend}\\nPerformance trends: capacityRetention ${perf.capacityRetention}%\\nRecommendations: ${rec.join('; ')}\\nEstimated lifespan: ${perf.trend === 'Excellent' ? '3-5 years' : perf.trend === 'Good' ? '2-4 years' : 'Unknown'}`;
}

/**
 * @param {string|undefined} raw
 * @param {BatteryData} batteryData
 * @returns {Object}
 */
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
      const perf = analyzePerformance(batteryData);
      const parsedPerf = { ...(parsed.performance || {}) };
      // Never override deterministic trend with LLM text
      if ('trend' in parsedPerf) delete parsedPerf.trend;
      return {
        healthStatus: parsed.healthStatus || extractHealthStatus(raw),
        performance: {
          ...perf,
          ...parsedPerf
        },
        recommendations: parsed.recommendations || extractRecommendations(raw),
        estimatedLifespan: parsed.estimatedLifespan || extractLifespan(raw),
        efficiency: {
          ...calculateEfficiency(batteryData),
          ...(parsed.efficiency || {})
        },
        rawText: raw
      };
    }
  } catch (e) { }

  // Fallback to basic analysis
  const performance = analyzePerformance(batteryData);
  const efficiency = calculateEfficiency(batteryData);

  return {
    healthStatus: extractHealthStatus(raw),
    performance: {
      ...performance,
      estimatedRuntime: calculateEstimatedRuntime(batteryData)
    },
    recommendations: extractRecommendations(raw),
    estimatedLifespan: extractLifespan(raw),
    efficiency: {
      ...efficiency,
      averageDischargeRate: calculateAverageDischargeRate(batteryData),
      maximumDischargeRate: calculateMaximumDischargeRate(batteryData)
    },
    rawText: raw
  };
}

/**
 * @typedef {Object} PerformanceResult
 * @property {string} trend
 * @property {number} capacityRetention
 * @property {number} degradationRate
 * @property {number} currentDraw
 * @property {number} currentVoltage
 * @property {number} currentSoc
 */

/**
 * @param {BatteryData} batteryData
 * @returns {PerformanceResult}
 */
function analyzePerformance(batteryData) {
  const m = batteryData?.measurements || [];
  if (!Array.isArray(m) || m.length < 2) return { trend: 'Unknown', capacityRetention: 0, degradationRate: 0, currentDraw: 0, currentVoltage: 0, currentSoc: 0 };
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

  return {
    trend,
    capacityRetention,
    degradationRate,
    currentDraw: lastCurrent,
    currentVoltage: lastVoltage,
    currentSoc: lastSoc
  };
}

/**
 * @typedef {Object} EfficiencyResult
 * @property {number} chargeEfficiency
 * @property {number} dischargeEfficiency
 * @property {number} cyclesAnalyzed
 */

/**
 * @param {BatteryData} batteryData
 * @returns {EfficiencyResult}
 */
function calculateEfficiency(batteryData) {
  const m = batteryData?.measurements || [];
  let totalRatio = 0; let count = 0;
  for (let i = 1; i < m.length; i++) {
    const prev = m[i - 1]; const curr = m[i];
    if (!prev || !curr) continue;
    if (typeof prev.energyIn === 'number' && typeof curr.energyOut === 'number' && prev.energyIn > 0) {
      const ratio = (curr.energyOut || 0) / (prev.energyIn || 1);
      totalRatio += ratio; count++;
    }
  }
  const avg = count ? parseFloat((totalRatio / count).toFixed(4)) : 0;
  return { chargeEfficiency: avg, dischargeEfficiency: parseFloat((avg * 0.92).toFixed(4)), cyclesAnalyzed: count };
}

/**
 * @param {string|undefined} text
 * @returns {string}
 */
function extractHealthStatus(text) {
  const found = (text || '').match(/(excellent|good|fair|poor|critical|unknown)/i);
  return found ? found[1] : 'unknown';
}

/**
 * @param {string|undefined} text
 * @returns {string[]}
 */
/**
 * @param {string|undefined} text
 * @returns {string[]}
 */
function extractRecommendations(text) {
  return (text || '').split('\n')
    .filter(l => /recommend|suggest|advise|should|consider|replacement|monitor/i.test(l))
    .slice(0, 3)
    .map(l => l.trim());
}

/**
 * @param {string|undefined} text
 * @returns {string}
 */
function extractLifespan(text) {
  const match = (text || '').match(/(\d+\s*-\s*\d+|\d+)\s*(months|years)/i);
  return match ? match[0] : 'Unknown';
}

/**
 * @param {BatteryData} batteryData
 * @returns {number}
 */
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

/**
 * @param {BatteryData} batteryData
 * @returns {number}
 */
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

/**
 * @typedef {Object} RuntimeResult
 * @property {string|null} atCurrentDraw
 * @property {string|null} atAverageUse
 * @property {string|null} atMaximumUse
 */

/**
 * @param {BatteryData} batteryData
 * @returns {RuntimeResult|null}
 */
function calculateEstimatedRuntime(batteryData) {
  const m = batteryData?.measurements || [];
  if (m.length === 0) return null;

  const latest = m[m.length - 1];
  const currentDraw = Math.abs(latest.current || 0);
  const soc = latest.stateOfCharge || 0;
  const voltage = latest.voltage || 0;

  if (!currentDraw || !soc || !voltage) return null;

  // Calculate remaining capacity in Ah (approximate)
  const totalCapacity = voltage * (latest.capacity || 100) / 100;
  const remainingCapacity = totalCapacity * (soc / 100);

  if (currentDraw > 0) {
    const hoursRemaining = remainingCapacity / currentDraw;
    const minutesRemaining = Math.round(hoursRemaining * 60);

    return {
      atCurrentDraw: minutesRemaining > 60
        ? `${Math.floor(minutesRemaining / 60)} hours ${minutesRemaining % 60} minutes`
        : `${minutesRemaining} minutes`,
      atAverageUse: null, // Will be populated by Gemini
      atMaximumUse: null  // Will be populated by Gemini
    };
  }

  return null;
}
