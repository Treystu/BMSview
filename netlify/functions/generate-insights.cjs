const { createLogger, createTimer } = require('../../utils/logger.cjs');
const { buildPrompt, fallbackTextSummary, parseInsights, calculateRuntimeEstimate, generateGeneratorRecommendations } = require('../../utils/battery-analysis.cjs');

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
 * @typedef {Object} BatteryData
 * @property {Measurement[]} measurements - Array of battery measurements
 * @property {string} [systemId] - System identifier
 * @property {number} [capacity] - Battery capacity percentage
 * @property {number} [capacityAh] - Battery capacity in amp-hours
 * @property {number} [voltage] - Battery voltage
 * @property {number} [stateOfCharge] - State of charge percentage
 * @property {number} [soc] - Legacy state of charge percentage
 */

/**
 * @typedef {Object} RequestBody
 * @property {string} [systemId] - System identifier
 * @property {string} [system] - Legacy system identifier
 * @property {string} [customPrompt] - Custom prompt for LLM
 * @property {Measurement[]} [analysisData] - Battery measurements array
 * @property {BatteryData} [batteryData] - Battery data object
 * @property {Object} [measurements] - Measurements object
 * @property {Measurement[]} [measurements.items] - Measurements array
 * @property {number} [capacity] - Battery capacity percentage
 * @property {number} [capacityAh] - Battery capacity in amp-hours
 * @property {number} [voltage] - Battery voltage
 * @property {number} [stateOfCharge] - State of charge percentage
 * @property {number} [soc] - Legacy state of charge percentage
 */

/**
 * @typedef {Object} Logger
 * @property {function(string, Object=): void} warn - Log warning
 * @property {function(string, Object=): void} error - Log error
 * @property {function(string, Object=): void} info - Log info
 */

/**
 * @typedef {Object} HandlerEvent
 * @property {string} [body] - Request body string
 */

/**
 * @typedef {Object} HandlerContext
 * @property {string} [functionName] - Function name
 * @property {string} [awsRequestId] - Request ID
 */

/**
 * Estimate tokens in text
 * @param {string} str Input text
 * @returns {number} Estimated token count
 */
const estimateTokens = (str) => Math.ceil(((str || '') + '').length / 4);

// Lower token threshold to match test expectations around large payloads
const MAX_TOKENS = 20000;
const BASE_PROMPT_TOKENS = 1200;

/**
 * Handles battery analysis request and generates insights
 * @param {Object} event - The event object containing request data
 * @param {Object} context - The context object for logging
 * @param {Object} genAIOverride - Optional override for AI model
 * @returns {Promise<Object>} Analysis results
 */
/**
 * @typedef {Object} ResponseObject 
 * @property {number} statusCode - HTTP status code
 * @property {string} body - Response body JSON string
 * @property {Object} [headers] - Optional response headers
 */

/**
 * Generate insights handler
 * @param {HandlerEvent} event Event object
 * @param {HandlerContext} context Context object
 * @param {Object} [genAIOverride] Optional AI model override
 * @returns {Promise<ResponseObject>} Response object
 */
async function generateHandler(event = {}, context = {}, genAIOverride) {
  /** @type {Logger} */
  let log = console;
  let timer = { end: () => { } };
  /** @type {ResponseObject} */
  let response = {
    statusCode: 500,
    body: JSON.stringify({ error: 'Internal server error' })
  };

  try {
    // Initialize logging and timing
    log = createLogger ? createLogger('generate-insights', context) : console;
    timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => { } };

    // Parse and validate input
    /** @type {RequestBody} */
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
      if (error instanceof Error) {
        log.warn('Failed to parse request body', { error: error.message });
      }
      body = {};
    }

    // Normalize and validate battery data
    const batteryData = normalizeBatteryData(body);

    // Process battery data
    response = await processBatteryData(batteryData, body, genAIOverride, log);

  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
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
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      log.warn('Failed to end timer', { error: err.message });
    }
    return response;
  }
}

/**
 * Process battery data and generate insights
 * @param {BatteryData} batteryData Battery data to analyze
 * @param {RequestBody} body Original request body
 * @param {Object} genAIOverride Optional AI model override
 * @param {Logger} log Logger instance
 * @returns {Promise<ResponseObject>} Response with insights
 */
async function processBatteryData(batteryData, body, genAIOverride, log) {
  // Handle empty measurements
  // Handle empty measurements
  if (!batteryData?.measurements?.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        insights: {
          healthStatus: 'Unknown',
          performance: { trend: 'Unknown', capacityRetention: 0, degradationRate: 0 },
          recommendations: ['Insufficient data for analysis'],
          estimatedLifespan: 'Unknown',
          efficiency: { chargeEfficiency: 0, dischargeEfficiency: 0, cyclesAnalyzed: 0 },
          rawText: 'No battery measurements provided.',
          metadata: {
            confidence: 'low',
            source: 'empty_data_handler',
            timestamp: new Date().toISOString()
          }
        },
        tokenUsage: { prompt: 0, generated: 0, total: 0 },
        timestamp: new Date().toISOString()
      })
    };
  }

  // Check token limit
  const dataString = JSON.stringify(batteryData);
  const dataTokens = estimateTokens(dataString);
  if (dataTokens + BASE_PROMPT_TOKENS > MAX_TOKENS) {
    return {
      statusCode: 413,
      body: JSON.stringify({ error: 'Input data too large' })
    };
  }

  // Build prompt and get model
  const systemId = body.systemId || body.system || null;
  const prompt = buildPrompt(systemId, dataString, body.customPrompt);
  const promptTokens = estimateTokens(prompt);
  const model = await getAIModel(genAIOverride, log);

  // Generate insights
  let insightsText = '';
  try {
    if (model && typeof model.generateContent === 'function') {
      const genResult = await model.generateContent(prompt);
      const resp = genResult && genResult.response;
      insightsText = typeof resp?.text === 'function' ? resp.text() : String(resp || '');
    }
  } catch (error) {
    log.warn('LLM generation failed, using fallback', { error: error.message });
    insightsText = fallbackTextSummary(batteryData);
  }

  if (!insightsText) {
    insightsText = fallbackTextSummary(batteryData);
  }

  // Attempt to parse JSON embedded in the LLM response (models often return mixed text)
  let llmJson = null;
  try {
    const first = insightsText.indexOf('{');
    const last = insightsText.lastIndexOf('}');
    if (first >= 0 && last > first) {
      const candidate = insightsText.slice(first, last + 1);
      llmJson = JSON.parse(candidate);
    }
  } catch (e) {
    log.warn('Could not parse JSON from LLM response, continuing with text parse', { error: e.message });
    llmJson = null;
  }

  // Parse free-text insights into structured object (will include defaults)
  const structured = parseInsights(insightsText, batteryData, log) || {};

  // Deterministic runtime estimate (always compute to ensure availability)
  const runtimeDet = calculateRuntimeEstimate(batteryData.measurements || [], {
    capacityAh: batteryData.capacity || batteryData.capacityAh || null,
    stateOfCharge: batteryData.stateOfCharge || batteryData.soc || null,
    voltage: batteryData.voltage || null
  });

  // Average discharge power (W) for generator sizing
  const discharge = (batteryData.measurements || []).filter(m => typeof m.current === 'number' && m.current < 0 && typeof m.voltage === 'number');
  let avgPowerW = null;
  if (discharge.length) {
    const powers = discharge.map(m => Math.abs(m.current * m.voltage));
    avgPowerW = powers.reduce((s, v) => s + v, 0) / powers.length;
  }

  // Choose fields: prefer LLM JSON values (if valid), otherwise fall back to deterministic values
  const runtimeHours = llmJson && typeof llmJson.runtimeEstimateHours === 'number' ? llmJson.runtimeEstimateHours : runtimeDet.runtimeHours;
  const runtimeExplanation = llmJson && llmJson.runtimeEstimateExplanation ? llmJson.runtimeEstimateExplanation : runtimeDet.explanation;

  const generatorRecommendations = llmJson && Array.isArray(llmJson.generatorRecommendations) && llmJson.generatorRecommendations.length ? llmJson.generatorRecommendations : generateGeneratorRecommendations(runtimeHours, avgPowerW);

  // Compute usage intensity (high/medium/low) from average absolute current
  const currents = (batteryData.measurements || []).filter(m => typeof m.current === 'number').map(m => Math.abs(m.current));
  const avgAbsCurrent = currents.length ? currents.reduce((s, v) => s + v, 0) / currents.length : 0;
  const usageIntensity = avgAbsCurrent > 10 ? 'high' : avgAbsCurrent > 5 ? 'medium' : 'low';

  // Format runtime values for human-friendly answers
  const formatHours = (h) => {
    if (h == null) return 'unknown';
    if (h < 1) return `${Math.round(h * 60)} minutes`;
    return `${Math.round(h * 10) / 10} hours`;
  };

  // Compute atAverageUse using avgPowerW when possible
  let atAverageUse = null;
  if (avgPowerW && (batteryData.capacity || batteryData.capacityAh)) {
    const capacityAh = batteryData.capacityAh || batteryData.capacity || null;
    const v = batteryData.voltage || (batteryData.measurements && batteryData.measurements[batteryData.measurements.length - 1] && batteryData.measurements[batteryData.measurements.length - 1].voltage) || 48;
    if (capacityAh && avgPowerW > 0) {
      const usableWh = capacityAh * v * ((batteryData.stateOfCharge || batteryData.soc || 100) / 100);
      atAverageUse = usableWh / avgPowerW;
    }
  }

  // Build structured performance. Keep existing structured.performance values if present
  const perf = (structured && structured.performance) || { trend: 'Unknown', capacityRetention: 0, degradationRate: 0 };
  const performance = {
    trend: perf.trend,
    capacityRetention: perf.capacityRetention,
    degradationRate: perf.degradationRate,
    analysis: {
      usageIntensity
    },
    estimatedRuntime: {
      atCurrentDraw: formatHours(runtimeHours),
      atAverageUse: atAverageUse ? formatHours(atAverageUse) : (llmJson && llmJson.runtimeEstimateHours ? formatHours(llmJson.runtimeEstimateHours) : null)
    }
  };

  // Build final insights object merging LLM structured output (if any) but ensuring deterministic fields exist
  const finalInsights = Object.assign({}, structured, llmJson || {});
  finalInsights.performance = performance;
  finalInsights.runtimeEstimateHours = runtimeHours;
  finalInsights.runtimeEstimateExplanation = runtimeExplanation;
  finalInsights.generatorRecommendations = generatorRecommendations;
  finalInsights.efficiency = finalInsights.efficiency || {};
  finalInsights.efficiency.cyclesAnalyzed = (batteryData.measurements || []).length;

  // Confidence heuristic
  const measurementCount = (batteryData.measurements || []).length;
  const confidence = runtimeDet && runtimeDet.confidence ? runtimeDet.confidence : (measurementCount > 50 ? 'high' : measurementCount > 20 ? 'medium' : 'low');
  finalInsights.metadata = finalInsights.metadata || {};
  finalInsights.metadata.confidence = finalInsights.metadata.confidence || confidence;

  // If a custom prompt was provided and appears to ask about runtime at a specific draw, answer deterministically
  if (body && body.customPrompt) {
    const match = String(body.customPrompt).match(/(\d+(?:\.\d+)?)\s*A/i);
    if (match) {
      const amps = parseFloat(match[1]);
      const lastV = batteryData.measurements && batteryData.measurements.length ? (batteryData.measurements[batteryData.measurements.length - 1].voltage || 12.8) : 12.8;
      const capacityAh = batteryData.capacityAh || batteryData.capacity || null;
      let answer = 'Insufficient data to compute runtime at that draw.';
      if (capacityAh && amps > 0) {
        const usableWh = capacityAh * lastV * ((batteryData.stateOfCharge || batteryData.soc || 100) / 100);
        const hours = usableWh / (amps * lastV);
        answer = `${formatHours(hours)} at ${amps} A draw (approx).`;
      }
      finalInsights.queryResponse = { question: body.customPrompt, answer };
    } else {
      finalInsights.queryResponse = { question: body.customPrompt, answer: finalInsights.rawText || 'No deterministic answer available.' };
    }
  }

  finalInsights._debug = { llmReturnedJson: !!llmJson, avgPowerW };

  return {
    statusCode: 200,
    headers: { 'x-insights-mode': model ? 'llm' : 'fallback' },
    body: JSON.stringify({
      success: true,
      insights: finalInsights,
      tokenUsage: {
        prompt: promptTokens,
        generated: estimateTokens(insightsText),
        total: promptTokens + estimateTokens(insightsText)
      },
      timestamp: new Date().toISOString()
    })
  };
}

function normalizeBatteryData(body) {
  let batteryData = null;

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

  // Validate and normalize measurements
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
    batteryData = {
      dlNumber: body.dlNumber || body.systemId || 'unknown',
      measurements: [],
      metadata: {
        source: 'empty_data_handler',
        timestamp: new Date().toISOString()
      }
    };
  }

  return batteryData;
}

async function getAIModel(genAIOverride, log) {
  if (genAIOverride) return genAIOverride;

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    return client.getGenerativeModel ? client.getGenerativeModel({ model: 'gemini-pro' }) : null;
  } catch (error) {
    log.warn('LLM client not available', { error: error.message });
    return null;
  }
}

// Export the handlers
exports.handler = generateHandler;
exports.generateHandler = generateHandler;