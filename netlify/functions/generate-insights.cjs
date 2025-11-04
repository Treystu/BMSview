const { createLogger, createTimer } = require('../../utils/logger.cjs');
const { buildPrompt, fallbackTextSummary, parseInsights } = require('../../utils/battery-analysis.cjs');

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
  let response = { 
    statusCode: 500, 
    body: JSON.stringify({ error: 'Internal server error' }) 
  };

  try {
    // Initialize logging and timing
    log = createLogger ? createLogger('generate-insights', context) : console;
    timer = createTimer ? createTimer(log, 'generate-insights') : { end: () => {} };

    // Parse and validate input
    let body = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch (parseError) {
      log.warn('Failed to parse request body', { error: parseError.message });
      body = {};
    }

    // Normalize and validate battery data
    let batteryData = normalizeBatteryData(body);
    
    // Process battery data
    const result = await processBatteryData(batteryData, body, genAIOverride, log);
    
    response = result;

  } catch (error) {
    log.error('Failed to generate insights', { error: error.message, stack: error.stack });
    response = { 
      statusCode: 500, 
      body: JSON.stringify({
        error: 'Failed to generate insights',
        message: error.message,
        timestamp: new Date().toISOString()
      })
    };
  } finally {
    try {
      await timer.end();
    } catch (error) {
      log.warn('Failed to end timer', { error: error.message });
    }
    return response;
  }
}

async function processBatteryData(batteryData, body, genAIOverride, log) {
  // Handle empty measurements
  if (!batteryData?.measurements?.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        insights: {
          healthStatus: 'Unknown',
          performance: { trend: 'Unknown', capacityRetention: 0, degradationRate: 0 },
          recommendations: [],
          estimatedLifespan: 'Unknown',
          efficiency: { chargeEfficiency: 0, dischargeEfficiency: 0, cyclesAnalyzed: 0 },
          rawText: ''
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

  // Parse and structure insights
  const structured = parseInsights(insightsText, batteryData, log);

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