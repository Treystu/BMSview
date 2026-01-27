/**
 * BMS Image Analyzer - Uses Gemini AI to extract battery data from screenshots
 * Simplified version for local use with model selection and cost estimation
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Available Gemini models with pricing (per 1M tokens in USD)
 * Updated: January 2026 - Only stable, non-deprecated models with vision support
 * Model IDs must match exactly what the API expects
 */
const MODELS = {
  // === RECOMMENDED FOR BMS EXTRACTION (Cost-effective) ===
  'gemini-2.0-flash-lite': {
    name: 'Gemini 2.0 Flash-Lite',
    description: 'Cheapest option ($0.075 in) - great for simple text extraction',
    inputPrice: 0.075,    // per 1M tokens
    outputPrice: 0.30,    // per 1M tokens
    imagePrice: 0.075,    // images counted as input tokens
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

  // === GOOD OPTIONS ===
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

  // === PRO MODELS (Overkill for BMS extraction) ===
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    description: 'Best for coding ($1.25 in) - overkill for extraction',
    inputPrice: 1.25,     // ≤200k tokens
    outputPrice: 10.00,
    imagePrice: 1.25,
    recommended: false
  },
  'gemini-3-pro-preview': {
    name: 'Gemini 3 Pro Preview',
    description: 'Most powerful model ($2.00 in) - overkill for extraction',
    inputPrice: 2.00,     // ≤200k tokens
    outputPrice: 12.00,
    imagePrice: 2.00,
    recommended: false
  }
};

// Default model - cheapest that works well
const DEFAULT_MODEL = 'gemini-2.0-flash-lite';

// Estimated tokens for BMS extraction
const ESTIMATED_PROMPT_TOKENS = 800;    // Our extraction prompt
const ESTIMATED_IMAGE_TOKENS = 600;     // Typical BMS screenshot
const ESTIMATED_OUTPUT_TOKENS = 400;    // JSON response

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
 * @param {string} modelId - Model to use
 * @returns {object} Cost estimate details
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
 * @param {object} usageMetadata - From Gemini API response
 * @param {string} modelId - Model used
 * @returns {object} Actual cost details
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

  // Replace spaces and underscores with dashes
  normalized = normalized.replace(/[\s_]+/g, '-');

  // Insert dash after letter prefix if missing (DL12345 -> DL-12345)
  normalized = normalized.replace(/^([A-Z]{1,4})(\d)/, '$1-$2');

  // Clean up multiple dashes
  normalized = normalized.replace(/-+/g, '-');

  return normalized;
}

/**
 * Get the extraction prompt for Gemini
 */
function getExtractionPrompt() {
  return `You are a meticulous data extraction AI. Analyze the provided BMS screenshot and extract its data into a JSON object, strictly following these rules:

**CRITICAL: MANDATORY FIELDS**
The following fields are MANDATORY and MUST ALWAYS be extracted. If a field is not clearly visible, use these defaults:
- hardwareSystemId: Look in the TOP LEFT corner. Format: "DL-12345". If not visible, use "UNKNOWN".
- stateOfCharge: SOC percentage. If not visible, use 0
- overallVoltage: Overall battery voltage. If not visible, use 0
- current: Current in Amps. CRITICAL: Preserve negative sign if discharging. If not visible, use 0
- remainingCapacity: Remaining capacity in Ah. If not visible, use 0
- chargeMosOn: Charge MOS status (true=on/green, false=off/grey). If not visible, use false
- dischargeMosOn: Discharge MOS status. If not visible, use false
- balanceOn: Balance status. If not visible, use false
- highestCellVoltage: Maximum cell voltage. Calculate from cellVoltages if available, otherwise use 0
- lowestCellVoltage: Minimum cell voltage. Calculate from cellVoltages if available, otherwise use 0
- averageCellVoltage: Average cell voltage. Calculate from cellVoltages if available, otherwise use 0
- cellVoltageDifference: Voltage difference in V. If in mV, convert by dividing by 1000. If not visible, use 0
- cycleCount: Cycle count. If not visible, use 0
- power: Power in Watts. If in kW, multiply by 1000. If current is negative, power MUST be negative too.

**OPTIONAL FIELDS**
- timestampFromImage: Date/time from the image if visible
- fullCapacity: Full capacity in Ah
- cellVoltages: Array of individual cell voltages (only if numbered list visible)
- temperatures: Array of temperature readings (T1, T2, etc.)
- mosTemperature: MOS temperature
- serialNumber, softwareVersion, hardwareVersion, snCode: If visible

**RULES**
1. Output ONLY a valid JSON object - no markdown, no explanations
2. Preserve negative signs for current and power when discharging
3. Convert mV to V by dividing by 1000
4. Convert kW to W by multiplying by 1000
5. For MOS status, green/lit = true, grey/unlit = false

Example output format:
{
  "hardwareSystemId": "DL-12345",
  "stateOfCharge": 85.5,
  "overallVoltage": 48.2,
  "current": -12.5,
  "remainingCapacity": 95.2,
  "power": -602.5,
  "chargeMosOn": false,
  "dischargeMosOn": true,
  "balanceOn": false,
  "highestCellVoltage": 3.42,
  "lowestCellVoltage": 3.38,
  "averageCellVoltage": 3.40,
  "cellVoltageDifference": 0.04,
  "cycleCount": 127,
  "temperatures": [25, 26],
  "cellVoltages": []
}`;
}

/**
 * Clean and parse JSON from Gemini response
 */
function parseJsonResponse(text) {
  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  // Find JSON object in response
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
 */
function processAnalysis(extracted) {
  if (!extracted || typeof extracted !== 'object') {
    throw new Error('Invalid extraction result');
  }

  // Normalize hardware ID
  const hardwareSystemId = normalizeHardwareId(extracted.hardwareSystemId);

  // Build analysis object with defaults
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
    timestampFromImage: extracted.timestampFromImage || null,
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

  return analysis;
}

/**
 * Analyze a BMS screenshot image
 * @param {string} base64Image - Base64 encoded image data
 * @param {string} mimeType - Image MIME type
 * @param {string} apiKey - Gemini API key
 * @param {string} modelId - Model to use (optional, defaults to gemini-2.0-flash-lite)
 * @returns {Promise<object>} Extracted BMS data with cost info
 */
async function analyzeImage(base64Image, mimeType, apiKey, modelId = DEFAULT_MODEL) {
  // Validate model
  if (!MODELS[modelId]) {
    console.warn(`Unknown model "${modelId}", falling back to ${DEFAULT_MODEL}`);
    modelId = DEFAULT_MODEL;
  }

  const url = `${GEMINI_API_URL}/${modelId}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: getExtractionPrompt() },
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,  // Low temperature for consistent extraction
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

  // Extract text from response
  const candidates = result?.candidates;
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Invalid response structure from Gemini API');
  }

  const text = candidates[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text in Gemini response');
  }

  // Parse and process the response
  const extracted = parseJsonResponse(text);
  const analysis = processAnalysis(extracted);

  // Calculate actual cost from usage metadata
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
  MODELS,
  DEFAULT_MODEL
};
