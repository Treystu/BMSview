/**
 * BMS Image Analyzer - Uses Gemini AI to extract battery data from screenshots
 * Simplified version for local use with model selection and cost estimation
 *
 * IMPORTANT: This module does NOT handle timestamps.
 * Timestamps are determined exclusively by TimeAuthority from filenames.
 * The processAnalysis function REQUIRES a forcedTimestamp argument.
 */

const fs = require('fs');
const path = require('path');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Available Gemini models with pricing (per 1M tokens in USD)
 * Updated: January 2026 - Only stable, non-deprecated models with vision support
 */
const MODELS = {
  'gemini-2.0-flash-lite': {
    name: 'Gemini 2.0 Flash-Lite',
    description: 'Cheapest option ($0.075 in) - great for simple text extraction',
    inputPrice: 0.075,
    outputPrice: 0.30,
    imagePrice: 0.075,
    recommended: true
  },
  'gemini-2.5-flash-lite': {
    name: 'Gemini 2.5 Flash-Lite',
    description: 'Very cheap ($0.10 in) with thinking capability',
    inputPrice: 0.10,
    outputPrice: 0.40,
    imagePrice: 0.10,
    recommended: true
  },
  'gemini-2.0-flash': {
    name: 'Gemini 2.0 Flash',
    description: 'Balanced performance ($0.10 in)',
    inputPrice: 0.10,
    outputPrice: 0.40,
    imagePrice: 0.10,
    recommended: false
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    description: 'Hybrid reasoning ($0.30 in) with thinking budgets',
    inputPrice: 0.30,
    outputPrice: 2.50,
    imagePrice: 0.30,
    recommended: false
  },
  'gemini-3-flash-preview': {
    name: 'Gemini 3 Flash Preview',
    description: 'Most intelligent fast model ($0.50 in)',
    inputPrice: 0.50,
    outputPrice: 3.00,
    imagePrice: 0.50,
    recommended: false
  },
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    description: 'Best for coding ($1.25 in) - overkill for extraction',
    inputPrice: 1.25,
    outputPrice: 10.00,
    imagePrice: 1.25,
    recommended: false
  },
  'gemini-3-pro-preview': {
    name: 'Gemini 3 Pro Preview',
    description: 'Most powerful model ($2.00 in) - overkill for extraction',
    inputPrice: 2.00,
    outputPrice: 12.00,
    imagePrice: 2.00,
    recommended: false
  }
};

const DEFAULT_MODEL = 'gemini-2.0-flash-lite';

// Estimated tokens for BMS extraction
const ESTIMATED_PROMPT_TOKENS = 800;
const ESTIMATED_IMAGE_TOKENS = 600;
const ESTIMATED_OUTPUT_TOKENS = 400;

// Cache the prompt content
let cachedPrompt = null;

/**
 * Clear the cached prompt (useful when prompt file is updated)
 */
function clearPromptCache() {
  cachedPrompt = null;
  console.log('[Analyzer] Prompt cache cleared');
}

/**
 * Load the extraction prompt from external file
 * @returns {string} The prompt text
 */
function loadPrompt() {
  if (cachedPrompt) {
    return cachedPrompt;
  }

  const promptPath = path.join(__dirname, '..', 'prompts', 'bms-system-v1.txt');

  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`);
  }

  cachedPrompt = fs.readFileSync(promptPath, 'utf-8');
  console.log('[Analyzer] Loaded extraction prompt from', promptPath);
  return cachedPrompt;
}

/**
 * Get list of available models
 */
function getAvailableModels() {
  return Object.entries(MODELS).map(([id, info]) => ({
    id,
    ...info
  }));
}

/**
 * Estimate cost for a single analysis
 */
function estimateCost(modelId = DEFAULT_MODEL) {
  const model = MODELS[modelId] || MODELS[DEFAULT_MODEL];

  const inputCost = ((ESTIMATED_PROMPT_TOKENS + ESTIMATED_IMAGE_TOKENS) / 1_000_000) * model.inputPrice;
  const outputCost = (ESTIMATED_OUTPUT_TOKENS / 1_000_000) * model.outputPrice;
  const totalCost = inputCost + outputCost;

  return {
    model: modelId,
    modelName: model.name,
    estimatedTokens: {
      input: ESTIMATED_PROMPT_TOKENS + ESTIMATED_IMAGE_TOKENS,
      output: ESTIMATED_OUTPUT_TOKENS,
      total: ESTIMATED_PROMPT_TOKENS + ESTIMATED_IMAGE_TOKENS + ESTIMATED_OUTPUT_TOKENS
    },
    pricing: {
      inputPricePerMillion: model.inputPrice,
      outputPricePerMillion: model.outputPrice
    },
    estimatedCost: {
      input: inputCost,
      output: outputCost,
      total: totalCost,
      formatted: `$${totalCost.toFixed(6)}`,
      perThousandImages: `$${(totalCost * 1000).toFixed(2)}`
    }
  };
}

/**
 * Calculate actual cost from usage metadata
 */
function calculateActualCost(usageMetadata, modelId = DEFAULT_MODEL) {
  const model = MODELS[modelId] || MODELS[DEFAULT_MODEL];

  const promptTokens = usageMetadata.promptTokenCount || 0;
  const outputTokens = usageMetadata.candidatesTokenCount || 0;
  const totalTokens = usageMetadata.totalTokenCount || (promptTokens + outputTokens);

  const inputCost = (promptTokens / 1_000_000) * model.inputPrice;
  const outputCost = (outputTokens / 1_000_000) * model.outputPrice;
  const totalCost = inputCost + outputCost;

  return {
    model: modelId,
    modelName: model.name,
    tokens: {
      input: promptTokens,
      output: outputTokens,
      total: totalTokens
    },
    cost: {
      input: inputCost,
      output: outputCost,
      total: totalCost,
      formatted: `$${totalCost.toFixed(6)}`
    }
  };
}

/**
 * Normalize hardware ID to consistent format (DL-12345)
 */
function normalizeHardwareId(id) {
  if (!id || typeof id !== 'string') return 'UNKNOWN';

  let normalized = id.trim().toUpperCase();

  if (!normalized || normalized === 'UNKNOWN' || normalized === 'NULL' || normalized === 'UNDEFINED') {
    return 'UNKNOWN';
  }

  normalized = normalized.replace(/[\s_]+/g, '-');
  normalized = normalized.replace(/^([A-Z]{1,4})(\d)/, '$1-$2');
  normalized = normalized.replace(/-+/g, '-');

  return normalized;
}

/**
 * Clean and parse JSON from Gemini response
 */
function parseJsonResponse(text) {
  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error('No valid JSON object in response');
  }

  const jsonString = text.substring(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e.message}`);
  }
}

/**
 * Post-process analysis data
 * IMPORTANT: forcedTimestamp is REQUIRED - we never guess the time
 *
 * @param {object} extracted - Raw extracted data from Gemini
 * @param {string} forcedTimestamp - The timestamp from TimeAuthority (REQUIRED)
 * @returns {object} Processed analysis with timestamp
 * @throws {Error} If forcedTimestamp is not provided
 */
function processAnalysis(extracted, forcedTimestamp) {
  if (!extracted || typeof extracted !== 'object') {
    throw new Error('Invalid extraction result');
  }

  // ZERO-TOLERANCE: forcedTimestamp is REQUIRED
  if (!forcedTimestamp) {
    throw new Error('processAnalysis requires forcedTimestamp - timestamps must come from filenames via TimeAuthority');
  }

  const hardwareSystemId = normalizeHardwareId(extracted.hardwareSystemId);

  const analysis = {
    hardwareSystemId,
    stateOfCharge: extracted.stateOfCharge ?? 0,
    overallVoltage: extracted.overallVoltage ?? 0,
    current: extracted.current ?? 0,
    remainingCapacity: extracted.remainingCapacity ?? 0,
    fullCapacity: extracted.fullCapacity || null,
    power: extracted.power ?? 0,
    chargeMosOn: extracted.chargeMosOn ?? false,
    dischargeMosOn: extracted.dischargeMosOn ?? false,
    balanceOn: extracted.balanceOn ?? false,
    highestCellVoltage: extracted.highestCellVoltage ?? 0,
    lowestCellVoltage: extracted.lowestCellVoltage ?? 0,
    averageCellVoltage: extracted.averageCellVoltage ?? 0,
    cellVoltageDifference: extracted.cellVoltageDifference ?? 0,
    cycleCount: extracted.cycleCount ?? 0,
    temperatures: extracted.temperatures || [],
    cellVoltages: extracted.cellVoltages || [],
    mosTemperature: extracted.mosTemperature || null,
    serialNumber: extracted.serialNumber || null,
    softwareVersion: extracted.softwareVersion || null,
    hardwareVersion: extracted.hardwareVersion || null,
    snCode: extracted.snCode || null
  };

  // Auto-correct power sign if Gemini misses it
  if (analysis.current < 0 && analysis.power > 0) {
    analysis.power = -Math.abs(analysis.power);
  }

  // Calculate power if missing but we have current and voltage
  if (analysis.power === 0 && analysis.current !== 0 && analysis.overallVoltage !== 0) {
    analysis.power = analysis.current * analysis.overallVoltage;
  }

  // Auto-correct cell difference if in mV (> 1V is almost certainly mV)
  if (analysis.cellVoltageDifference > 1) {
    analysis.cellVoltageDifference = analysis.cellVoltageDifference / 1000;
  }

  // Calculate cell stats from array if we have it but stats are missing
  if (analysis.cellVoltages && analysis.cellVoltages.length > 0) {
    if (analysis.highestCellVoltage === 0) {
      analysis.highestCellVoltage = Math.max(...analysis.cellVoltages);
    }
    if (analysis.lowestCellVoltage === 0) {
      analysis.lowestCellVoltage = Math.min(...analysis.cellVoltages);
    }
    if (analysis.averageCellVoltage === 0) {
      analysis.averageCellVoltage = analysis.cellVoltages.reduce((a, b) => a + b, 0) / analysis.cellVoltages.length;
    }
    if (analysis.cellVoltageDifference === 0) {
      analysis.cellVoltageDifference = analysis.highestCellVoltage - analysis.lowestCellVoltage;
    }
  }

  // Generate alerts
  const alerts = [];
  let status = 'Normal';

  if (analysis.cellVoltageDifference > 0.1) {
    alerts.push(`CRITICAL: High cell imbalance: ${(analysis.cellVoltageDifference * 1000).toFixed(1)}mV`);
    status = 'Critical';
  } else if (analysis.cellVoltageDifference > 0.05) {
    alerts.push(`WARNING: Cell imbalance: ${(analysis.cellVoltageDifference * 1000).toFixed(1)}mV`);
    if (status === 'Normal') status = 'Warning';
  }

  if (analysis.temperatures && analysis.temperatures.length > 0) {
    const maxTemp = Math.max(...analysis.temperatures);
    if (maxTemp > 55) {
      alerts.push(`CRITICAL: High temperature: ${maxTemp}°C`);
      status = 'Critical';
    } else if (maxTemp > 45) {
      alerts.push(`WARNING: High temperature: ${maxTemp}°C`);
      if (status === 'Normal') status = 'Warning';
    }
  }

  if (analysis.stateOfCharge < 10) {
    alerts.push(`CRITICAL: Battery level critical: ${analysis.stateOfCharge}%`);
    status = 'Critical';
  } else if (analysis.stateOfCharge < 20) {
    alerts.push(`WARNING: Low battery: ${analysis.stateOfCharge}%`);
    if (status === 'Normal') status = 'Warning';
  }

  analysis.alerts = alerts;
  analysis.status = status;

  // SET THE TIMESTAMP FROM TIMEAUTHORITY - This is the ONLY source of truth
  analysis.timestampFromFilename = forcedTimestamp;

  return analysis;
}

/**
 * Analyze a BMS screenshot image
 * @param {string} base64Image - Base64 encoded image data
 * @param {string} mimeType - Image MIME type
 * @param {string} apiKey - Gemini API key
 * @param {string} modelId - Model to use
 * @param {string} forcedTimestamp - The timestamp from TimeAuthority (REQUIRED)
 * @returns {Promise<object>} Extracted BMS data with cost info
 */
async function analyzeImage(base64Image, mimeType, apiKey, modelId = DEFAULT_MODEL, forcedTimestamp) {
  // ZERO-TOLERANCE: forcedTimestamp is REQUIRED
  if (!forcedTimestamp) {
    throw new Error('analyzeImage requires forcedTimestamp - timestamps must come from filenames via TimeAuthority');
  }

  if (!MODELS[modelId]) {
    console.warn(`Unknown model "${modelId}", falling back to ${DEFAULT_MODEL}`);
    modelId = DEFAULT_MODEL;
  }

  const url = `${GEMINI_API_URL}/${modelId}:generateContent?key=${apiKey}`;
  const prompt = loadPrompt();

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = `Gemini API error: ${response.status}`;

    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch (e) {
      // Ignore parse error
    }

    throw new Error(errorMessage);
  }

  const result = await response.json();

  const candidates = result?.candidates;
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Invalid response structure from Gemini API');
  }

  const text = candidates[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text in Gemini response');
  }

  // Parse and process with the FORCED timestamp
  const extracted = parseJsonResponse(text);
  const analysis = processAnalysis(extracted, forcedTimestamp);

  // Calculate actual cost
  const usageMetadata = result.usageMetadata || {};
  const costInfo = calculateActualCost(usageMetadata, modelId);

  return {
    ...analysis,
    _meta: {
      model: modelId,
      modelName: MODELS[modelId]?.name || modelId,
      cost: costInfo.cost,
      tokens: costInfo.tokens
    }
  };
}

module.exports = {
  analyzeImage,
  normalizeHardwareId,
  getAvailableModels,
  estimateCost,
  calculateActualCost,
  processAnalysis,
  loadPrompt,
  clearPromptCache,
  MODELS,
  DEFAULT_MODEL
};
