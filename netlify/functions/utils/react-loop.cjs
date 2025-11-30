/**
 * ReAct Loop Implementation for Agentic Insights
 * 
 * Implements a Reasoning + Acting loop that:
 * 1. Prompts Gemini with current context and tools
 * 2. Detects if Gemini wants to call tools
 * 3. Executes tools and adds results to conversation history
 * 4. Loops until final answer reached or max iterations hit
 */

const { getGeminiClient } = require('./geminiClient.cjs');
const { toolDefinitions, executeToolCall } = require('./gemini-tools.cjs');
const { buildGuruPrompt, collectAutoInsightsContext, buildQuickReferenceCatalog } = require('./insights-guru.cjs');
const { createLogger } = require('./logger.cjs');
const { validateResponseFormat, buildCorrectionPrompt, detectToolSuggestions, buildToolSuggestionCorrectionPrompt } = require('./response-validator.cjs');
const { logAIOperation, checkForAnomalies } = require('./metrics-collector.cjs');

// Default iteration limits - can be overridden via params
const DEFAULT_MAX_TURNS = 10; // Increased from 5 to 10 for standard insights
const CUSTOM_QUERY_MAX_TURNS = 20; // 20 iterations for custom queries

// CRITICAL TIMEOUT SETTINGS
// Netlify has hard limits: 10s free, 26s pro, configurable enterprise
// We use conservative values to ensure we can save checkpoint and return response
const NETLIFY_TIMEOUT_MS = parseInt(process.env.NETLIFY_FUNCTION_TIMEOUT_MS || '20000'); // 20s safe default
const CONTEXT_COLLECTION_BUFFER_MS = 3000; // Reserve 3s for context collection
const CHECKPOINT_SAVE_BUFFER_MS = 3000; // Reserve 3s for checkpoint save (response buffer is separate)
const RESPONSE_BUFFER_MS = 2000; // Reserve 2s for formatting and returning response

// Minimum safe values to prevent degenerate cases
const MIN_SYNC_CONTEXT_BUDGET_MS = 5000; // Minimum 5s for context collection
const MIN_SYNC_TOTAL_BUDGET_MS = 8000; // Minimum 8s total processing time
const MIN_CHECKPOINT_FREQUENCY_MS = 4000; // Minimum 4s between checkpoints
const MIN_GEMINI_CALL_TIMEOUT_MS = 10000; // Minimum 10s for Gemini API call (increased from 3s)
const ITERATION_SAFETY_BUFFER_MS = 1000; // 1s safety margin per iteration
const CHECKPOINT_FREQUENCY_DIVISOR = 3; // Save checkpoint every 1/3 of timeout

/**
 * @typedef {Object} CheckpointState
 * @property {Array<any>} conversationHistory
 * @property {number} startTurnCount
 * @property {number} startToolCallCount
 * @property {Object} [contextSummary]
 */

/**
 * @typedef {Object} ContextData
 * @property {string} [systemId]
 * @property {string} [startDate]
 * @property {string} [endDate]
 * @property {number} [totalRecords]
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {string} [weatherTimestamp]
 * @property {number} [panelWatts]
 */

/**
 * @typedef {Object} ReActLoopParams
 * @property {Object} analysisData
 * @property {string} systemId
 * @property {string} [customPrompt]
 * @property {import('./logger.cjs').LogFunction} [log]
 * @property {'sync'|'background'} [mode]
 * @property {string} [requestId]
 * @property {boolean} [skipInitialization]
 * @property {CheckpointState} [checkpointState]
 * @property {Function} [onCheckpoint]
 * @property {string} [insightMode]
 * @property {number} [contextWindowDays]
 * @property {number} [maxIterations]
 * @property {string} [modelOverride]
 * @property {any} [stream]
 */

/**
 * @typedef {Object} InitializationParams
 * @property {string} systemId
 * @property {number} contextWindowDays
 * @property {Array<any>} conversationHistory
 * @property {any} geminiClient - Gemini API client
 * @property {import('./logger.cjs').LogFunction} log
 * @property {number} startTime
 * @property {number} totalBudgetMs
 * @property {string} [modelOverride]
 * @property {any} [stream]
 */

/**
 * @typedef {Object} InitializationResult
 * @property {boolean} success
 * @property {number} attempts
 * @property {number} [dataPoints]
 * @property {string} [error]
 * @property {number} [toolCallsUsed]
 * @property {number} [turnsUsed]
 */

// Calculate actual budgets with safety minimums
// If mode is background, use 14 minute timeout
const getBudgets = (/** @type {string} */ mode) => {
    const isBackground = mode === 'background';
    const TIMEOUT_MS = isBackground ? 14 * 60 * 1000 : NETLIFY_TIMEOUT_MS;

    const contextBudget = Math.max(
        TIMEOUT_MS - CONTEXT_COLLECTION_BUFFER_MS - RESPONSE_BUFFER_MS,
        MIN_SYNC_CONTEXT_BUDGET_MS
    );

    const totalBudget = Math.max(
        TIMEOUT_MS - CHECKPOINT_SAVE_BUFFER_MS - RESPONSE_BUFFER_MS,
        MIN_SYNC_TOTAL_BUDGET_MS
    );

    const checkpointFreq = Math.max(
        Math.floor((TIMEOUT_MS - RESPONSE_BUFFER_MS) / CHECKPOINT_FREQUENCY_DIVISOR),
        MIN_CHECKPOINT_FREQUENCY_MS
    );

    return { contextBudget, totalBudget, checkpointFreq };
};

// Default budgets for sync mode (legacy support)
const SYNC_CONTEXT_BUDGET_MS = Math.max(
    NETLIFY_TIMEOUT_MS - CONTEXT_COLLECTION_BUFFER_MS - RESPONSE_BUFFER_MS,
    MIN_SYNC_CONTEXT_BUDGET_MS
);

const SYNC_TOTAL_BUDGET_MS = Math.max(
    NETLIFY_TIMEOUT_MS - CHECKPOINT_SAVE_BUFFER_MS - RESPONSE_BUFFER_MS,
    MIN_SYNC_TOTAL_BUDGET_MS
);

const CHECKPOINT_FREQUENCY_MS = Math.max(
    Math.floor((NETLIFY_TIMEOUT_MS - RESPONSE_BUFFER_MS) / CHECKPOINT_FREQUENCY_DIVISOR),
    MIN_CHECKPOINT_FREQUENCY_MS
);

// Initialization sequence settings
const INITIALIZATION_MAX_RETRIES = 100; // Effectively unlimited retries within timeout budget
const DEFAULT_CONTEXT_WINDOW_DAYS = 30; // Default 1-month lookback
const INITIALIZATION_BUDGET_RATIO = 0.6; // Use 60% of budget for initialization (reserve 40% for checkpoint save + response)

// Retry backoff settings - LINEAR (1s increments)
const RETRY_LINEAR_INCREMENT_MS = 1000; // Add 1 second per retry

// Lazy AI Detection settings
const RECENT_TOOL_FAILURE_WINDOW = 5; // Check last 5 messages for tool failures
const LAZY_RESPONSE_THRESHOLD = 2; // Threshold for lazy responses (triggers on 3rd consecutive)
const LAZY_AI_FALLBACK_MESSAGE = "Unable to retrieve the requested data. Please try a simpler query or check the available data range.";

// Visual Guru Disclaimer Detection - prevents AI from refusing visual output
const VISUAL_DISCLAIMER_TRIGGERS = [
    "i cannot directly send infographics",
    "i cannot send infographics",
    "i cannot generate images",
    "i cannot create visual content",
    "i cannot produce visuals",
    "i am a text-based model",
    "as a text-based ai",
    "i don't have the ability to create images",
    "cannot directly provide visual",
    "unable to generate graphical",
    "cannot create infographic"
];  // All triggers are lowercase - comparison is done against lowerAnswer
const VISUAL_DISCLAIMER_THRESHOLD = 1; // Fail fast - intervene on first disclaimer

/**
 * Analyze Gemini's response text to detect what it's struggling with
 * Uses keyword extraction to identify which tool or concept needs guidance
 * 
 * @param {string} responseText - Gemini's text response
 * @returns {Array<string>} Array of detected tool/concept names
 */
function detectStrugglingConcepts(responseText) {
    const lowercaseText = responseText.toLowerCase();
    /** @type {string[]} */
    const detectedConcepts = [];

    // Keyword mappings for each tool/concept
    const keywordMap = {
        'request_bms_data': [
            'insufficient data', 'not enough data', 'limited data', 'no data',
            'only 4 records', 'only a few records', 'historical data',
            'data points', 'time series', 'bms data', 'battery data'
        ],
        'getWeatherData': [
            'weather', 'temperature', 'clouds', 'cloud cover', 'uvi', 'uv index',
            'weather conditions', 'climate', 'meteorological'
        ],
        'getSolarEstimate': [
            'solar', 'solar production', 'solar generation', 'solar estimate',
            'solar charging', 'pv', 'photovoltaic', 'panel', 'irradiance'
        ],
        'getSystemAnalytics': [
            'analytics', 'statistics', 'baseline', 'performance metrics',
            'usage statistics', 'system statistics', 'trends'
        ],
        'predict_battery_trends': [
            'prediction', 'forecast', 'trend', 'degradation', 'capacity loss',
            'future performance', 'lifespan', 'service life', 'projections'
        ],
        'analyze_usage_patterns': [
            'usage pattern', 'consumption pattern', 'daily pattern', 'weekly pattern',
            'seasonal pattern', 'anomaly', 'anomalies', 'unusual behavior'
        ],
        'calculate_energy_budget': [
            'energy budget', 'budget', 'autonomy', 'backup power', 'days of autonomy',
            'worst case', 'emergency scenario', 'energy requirements'
        ],
        'date_format': [
            'invalid date', 'date format', 'timestamp', 'iso 8601', 'yyyy-mm-dd',
            'time range', 'date range'
        ],
        'systemid_missing': [
            'system id', 'systemid', 'no system', 'which system', 'missing system'
        ],
        'general_data_access': [
            'cannot access', 'unable to retrieve', 'failed to get', 'data unavailable',
            'no access', 'cannot get', 'missing information'
        ]
    };

    // Check each concept's keywords
    for (const [concept, keywords] of Object.entries(keywordMap)) {
        for (const keyword of keywords) {
            if (lowercaseText.includes(keyword)) {
                if (!detectedConcepts.includes(concept)) {
                    detectedConcepts.push(concept);
                }
                break; // Found match for this concept, move to next
            }
        }
    }

    return detectedConcepts;
}

/**
 * Generate context-aware recovery guidance based on detected struggles
 * Combines multiple detected issues into a comprehensive recovery prompt
 * Uses the data catalog from insights-guru.cjs to avoid duplication
 * 
 * @param {Array<string>} detectedConcepts - Concepts detected from response analysis
 * @param {{systemId?: string, startDate?: string, endDate?: string, totalRecords?: number, latitude?: number, longitude?: number, weatherTimestamp?: string, panelWatts?: number}} [contextData] - Context data
 * @returns {string|null} Combined guidance prompt
 */
function buildContextAwareGuidance(detectedConcepts, contextData = {}) {
    if (detectedConcepts.length === 0) {
        return null; // No specific issues detected
    }

    const { systemId, startDate, endDate, totalRecords } = contextData;
    let guidance = '\n\n🔧 CONTEXT-AWARE RECOVERY GUIDANCE\n\n';
    guidance += `Detected ${detectedConcepts.length} potential issue(s): ${detectedConcepts.join(', ')}\n\n`;

    // If data access issues detected, show the comprehensive quick reference catalog
    if (detectedConcepts.includes('request_bms_data') ||
        detectedConcepts.includes('general_data_access')) {

        guidance += "🚨 DETECTED: You're claiming data unavailability or insufficient data.\n";
        guidance += "📖 HERE'S THE COMPLETE DATA CATALOG showing what you can access:\n\n";

        // Use the comprehensive quick reference from insights-guru.cjs
        guidance += buildQuickReferenceCatalog(systemId, startDate, endDate, totalRecords);
        guidance += "\n";

        // Add specific instruction based on the issue
        guidance += "⚠️ IMMEDIATE ACTION REQUIRED:\n";
        guidance += "   1. Review the SYSTEM ID and QUERYABLE RANGE above\n";
        guidance += "   2. Call request_bms_data with the EXACT parameters shown in examples\n";
        guidance += "   3. Verify the response contains data (dataPoints > 0)\n";
        guidance += "   4. ONLY THEN may you proceed with analysis\n\n";

        return guidance;
    }

    // For other specific tool issues, provide targeted guidance
    const toolSpecificConcepts = detectedConcepts.filter(c =>
        c.startsWith('get') || c.startsWith('calculate') || c.startsWith('analyze') || c.startsWith('predict')
    );

    if (toolSpecificConcepts.length > 0) {
        guidance += "🎯 TOOL-SPECIFIC GUIDANCE:\n\n";

        for (const concept of toolSpecificConcepts) {
            guidance += `**Issue detected with: ${concept}**\n`;
            guidance += buildDetailedToolGuidance(concept, null, null, /** @type {ContextData} */(contextData));
            guidance += "\n\n";
        }
    }

    // Add specific fixes for common issues
    if (detectedConcepts.includes('date_format')) {
        guidance += `
📅 DATE FORMAT REQUIREMENTS:

**ISO 8601 Format (for most tools):**
- Correct: "2025-11-23T14:30:00Z" or "${startDate}"
- Incorrect: "11/23/2025", "Nov 23 2025", "2025-11-23"

**YYYY-MM-DD Format (for getSolarEstimate only):**
- Correct: "2025-11-23"
- Incorrect: "2025-11-23T14:30:00Z"

**How to use:**
- request_bms_data: ISO 8601 format
- getWeatherData: ISO 8601 format
- getSolarEstimate: YYYY-MM-DD format
- All other tools: ISO 8601 format

`;
    }

    if (detectedConcepts.includes('systemid_missing')) {
        guidance += `
🔑 SYSTEM ID INFORMATION:

Your systemId is: "${systemId}"

**Use this EXACT value in ALL system-related tool calls:**
- request_bms_data
- getSystemAnalytics
- predict_battery_trends
- analyze_usage_patterns
- calculate_energy_budget

**Do NOT:**
- Make up a systemId
- Use a different systemId
- Skip the systemId parameter

`;
    }

    return guidance;
}

/**
 * Generate detailed recovery guidance for specific tool failures
 * Provides verbose, step-by-step instructions when Gemini struggles with a particular tool
 * 
 * @param {string} toolName - Name of the tool that failed
 * @param {Object} toolArgs - Arguments that were used (if any)
 * @param {Object} errorResult - The error response from the tool
 * @param {Object} contextData - Additional context (systemId, dates, etc.)
 * @returns {string} Detailed guidance prompt
 */
function buildDetailedToolGuidance(toolName, toolArgs, errorResult, contextData = {}) {
    const { systemId, startDate, endDate } = contextData;

    const guidanceMap = {
        request_bms_data: `
📖 DETAILED GUIDE: Retrieving BMS Historical Data

The request_bms_data tool is your PRIMARY data access method. Here's exactly how to use it:

**STEP 1: Understand the Parameters**
- systemId: "${systemId}" ← USE THIS EXACT VALUE
- metric: Choose ONE metric at a time for best performance:
  * "voltage" - Battery pack voltage over time
  * "current" - Charge/discharge current (positive = charging, negative = discharging)
  * "soc" - State of charge percentage
  * "power" - Power in Watts
  * "capacity" - Remaining capacity in Ah
  * "temperature" - Battery temperature
  * "all" - All metrics (use sparingly, returns large datasets)
- time_range_start: "${startDate}" ← ISO 8601 format
- time_range_end: "${endDate}" ← ISO 8601 format
- granularity: 
  * "hourly_avg" - Best for detailed analysis (<30 days)
  * "daily_avg" - Best for trends (30-90 days)
  * "raw" - All data points (use only for specific lookups)

**STEP 2: Make the Function Call**
Call the tool with this EXACT structure:
{
  "systemId": "${systemId}",
  "metric": "all",
  "time_range_start": "${startDate}",
  "time_range_end": "${endDate}",
  "granularity": "daily_avg"
}

**STEP 3: Interpret the Response**
Success response will have:
- dataPoints: Number of data points retrieved (should be > 0)
- data: Array of time-series data
- systemId: Confirms the system queried

Error response will have:
- error: true
- message: Description of what went wrong

**COMMON MISTAKES TO AVOID:**
❌ Using wrong date format (must be ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ)
❌ Setting time_range_start after time_range_end
❌ Using a systemId that doesn't exist
❌ Requesting "all" metrics for large time ranges (causes timeout)

**WHAT WENT WRONG THIS TIME:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called or returned empty response'}

**YOUR NEXT ACTION:**
Call request_bms_data again with the EXACT parameters above. Do it now.`,

        getWeatherData: `
📖 DETAILED GUIDE: Retrieving Weather Data

The getWeatherData tool provides weather conditions for correlation with battery performance.

**STEP 1: Understand the Parameters**
- latitude: Decimal degrees (e.g., 38.8)
- longitude: Decimal degrees (e.g., -104.8)
- timestamp: ISO 8601 format for historical weather (e.g., "2025-11-15T12:00:00Z")
  * Omit this parameter for current weather
- type: "current" | "historical" | "hourly"
  * "historical" - Weather at specific past timestamp
  * "current" - Latest conditions
  * "hourly" - Hourly forecast/history

**STEP 2: Make the Function Call**
Example for historical weather:
{
  "latitude": ${contextData.latitude || 'LATITUDE_FROM_SYSTEM_PROFILE'},
  "longitude": ${contextData.longitude || 'LONGITUDE_FROM_SYSTEM_PROFILE'},
  "timestamp": "${contextData.weatherTimestamp || startDate}",
  "type": "historical"
}

**STEP 3: Interpret the Response**
Success response includes:
- temp: Temperature in Celsius
- clouds: Cloud cover percentage (0-100)
- uvi: UV index
- weather_main: Weather condition description
- weather_icon: Icon code

**COMMON MISTAKES:**
❌ Forgetting to include timestamp for historical data
❌ Using invalid latitude/longitude (must be decimal degrees)
❌ Requesting weather for dates too far in past (API has limits)

**WHAT WENT WRONG:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called or returned empty response'}

**WHERE TO GET LAT/LON:**
Check the SYSTEM PROFILE section in your context - it should contain latitude and longitude values.

**YOUR NEXT ACTION:**
Call getWeatherData with the correct parameters from the system profile.`,

        getSolarEstimate: `
📖 DETAILED GUIDE: Retrieving Solar Energy Estimates

The getSolarEstimate tool calculates expected solar generation based on location and panel specs.

**STEP 1: Understand the Parameters**
- location: Either US zip code ("80942") OR "lat,lon" format ("38.8,-104.8")
- panelWatts: Total panel wattage (e.g., 1600 for 4x400W panels)
  * Get this from SYSTEM PROFILE → maxAmpsSolarCharging * voltage
- startDate: "YYYY-MM-DD" format (e.g., "2025-11-01")
- endDate: "YYYY-MM-DD" format (e.g., "2025-11-18")

**STEP 2: Make the Function Call**
{
  "location": "${contextData.latitude && contextData.longitude ? `${contextData.latitude},${contextData.longitude}` : 'ZIP_OR_LATLON'}",
  "panelWatts": ${contextData.panelWatts || 'CALCULATE_FROM_SYSTEM_PROFILE'},
  "startDate": "${startDate ? startDate.split('T')[0] : 'YYYY-MM-DD'}",
  "endDate": "${endDate ? endDate.split('T')[0] : 'YYYY-MM-DD'}"
}

**STEP 3: Interpret the Response**
Returns daily solar estimates with:
- date: Each day in the range
- expectedWh: Expected generation in watt-hours
- irradiance: Solar irradiance value

**COMMON MISTAKES:**
❌ Using wrong date format (must be YYYY-MM-DD, not ISO 8601)
❌ Not calculating panelWatts correctly (maxAmps * voltage)
❌ Using location outside US (service may be limited)

**WHAT WENT WRONG:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called'}

**CALCULATING PANEL WATTS:**
If system has maxAmpsSolarCharging = 60A and voltage = 48V:
panelWatts = 60A * 48V = 2880W

**YOUR NEXT ACTION:**
Calculate panelWatts from system profile and call getSolarEstimate.`,

        getSystemAnalytics: `
📖 DETAILED GUIDE: Retrieving System Analytics

The getSystemAnalytics tool provides comprehensive usage statistics and baselines.

**STEP 1: Understand the Parameters**
- systemId: "${systemId}" ← USE THIS EXACT VALUE

That's it! This tool only needs the systemId.

**STEP 2: Make the Function Call**
{
  "systemId": "${systemId}"
}

**STEP 3: Interpret the Response**
Returns rich analytics including:
- hourlyUsagePatterns: Usage by hour of day
- performanceBaselines: Typical operating ranges
- alertFrequency: How often alerts occur
- statisticalSummaries: Averages, trends, etc.

**WHAT WENT WRONG:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called'}

**YOUR NEXT ACTION:**
Call getSystemAnalytics with systemId: "${systemId}"`,

        predict_battery_trends: `
📖 DETAILED GUIDE: Predicting Battery Performance Trends

The predict_battery_trends tool uses statistical forecasting for capacity, efficiency, and lifespan.

**STEP 1: Understand the Parameters**
- systemId: "${systemId}"
- metric: Choose what to predict:
  * "capacity" - Capacity degradation over time
  * "efficiency" - Charge/discharge efficiency trends
  * "temperature" - Thermal patterns
  * "voltage" - Voltage trends
  * "lifetime" - Estimated SERVICE LIFE until replacement (NOT runtime)
- forecastDays: How far to predict (default: 30, max: 365)
- confidenceLevel: Include confidence intervals (true/false)

**STEP 2: Make the Function Call**
{
  "systemId": "${systemId}",
  "metric": "capacity",
  "forecastDays": 90,
  "confidenceLevel": true
}

**STEP 3: Interpret the Response**
Returns prediction data with:
- predictions: Array of future values
- trend: Direction (improving/degrading)
- confidence: Statistical confidence if requested

**IMPORTANT TERMINOLOGY:**
- "lifetime" metric = SERVICE LIFE (years/months until replacement)
- NOT the same as "battery autonomy" or "runtime" (hours until discharge)

**WHAT WENT WRONG:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called'}

**YOUR NEXT ACTION:**
Call predict_battery_trends with systemId and desired metric.`,

        analyze_usage_patterns: `
📖 DETAILED GUIDE: Analyzing Energy Usage Patterns

The analyze_usage_patterns tool identifies consumption trends and anomalies.

**STEP 1: Understand the Parameters**
- systemId: "${systemId}"
- patternType: What to analyze:
  * "daily" - Hourly usage patterns throughout the day
  * "weekly" - Weekday vs weekend comparison
  * "seasonal" - Monthly/quarterly trends
  * "anomalies" - Detect unusual events
- timeRange: Analysis period ("7d", "30d", "90d", or "1y")

**STEP 2: Make the Function Call**
{
  "systemId": "${systemId}",
  "patternType": "daily",
  "timeRange": "30d"
}

**STEP 3: Interpret the Response**
Returns pattern analysis with:
- patterns: Identified usage patterns
- insights: Key findings
- recommendations: Optimization suggestions

**WHAT WENT WRONG:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called'}

**YOUR NEXT ACTION:**
Call analyze_usage_patterns with systemId and desired pattern type.`,

        calculate_energy_budget: `
📖 DETAILED GUIDE: Calculating Energy Budgets

The calculate_energy_budget tool models energy requirements for different scenarios.

**STEP 1: Understand the Parameters**
- systemId: "${systemId}"
- scenario: What to model:
  * "current" - Existing usage patterns
  * "worst_case" - Minimum solar + max consumption
  * "average" - Typical conditions
  * "emergency" - Backup power requirements
- includeWeather: Include weather-based solar adjustments (true/false)
- timeframe: Budget period ("7d", "30d", "90d")

**STEP 2: Make the Function Call**
{
  "systemId": "${systemId}",
  "scenario": "worst_case",
  "includeWeather": true,
  "timeframe": "30d"
}

**STEP 3: Interpret the Response**
Returns energy budget with:
- dailyProduction: Expected generation
- dailyConsumption: Expected usage
- netBalance: Surplus or deficit
- autonomyDays: Days of backup power
- recommendations: Actions to take

**CRITICAL: You are the ONLY one who can call this tool**
Users cannot "use the calculate_energy_budget tool" - YOU must call it and present results.

**WHAT WENT WRONG:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called'}

**YOUR NEXT ACTION:**
Call calculate_energy_budget NOW and include results in your response.`
    };

    return (/** @type {any} */ (guidanceMap))[toolName] || `
📖 TOOL GUIDANCE: ${toolName}

The tool "${toolName}" failed or was not called correctly.

**What went wrong:**
${errorResult ? JSON.stringify(errorResult, null, 2) : 'Tool was not called or returned empty response'}

**Tool arguments attempted:**
${toolArgs ? JSON.stringify(toolArgs, null, 2) : 'No arguments provided'}

**General guidance:**
1. Check that all required parameters are provided
2. Ensure parameter types are correct (strings, numbers, booleans)
3. Verify that date ranges are valid (start before end)
4. Use systemId: "${systemId}" if this is a system-specific tool

**Your next action:**
Review the tool definition in the AVAILABLE TOOLS section and try again with correct parameters.`;
}

/**
 * MANDATORY INITIALIZATION SEQUENCE
 * 
 * Forces Gemini to retrieve historical data before proceeding with analysis.
 * This prevents "insufficient data" errors by ensuring Gemini actually calls
 * the data retrieval tools and verifies successful data access.
 * 
 * @param {InitializationParams} params
 * @returns {Promise<{success: boolean, attempts: number, dataPoints?: number, error?: string, toolCallsUsed?: number, turnsUsed?: number}>}
 */
async function executeInitializationSequence(params) {
    const { systemId, contextWindowDays, conversationHistory, geminiClient, log, startTime, totalBudgetMs, modelOverride, stream } = params;

    if (!systemId) {
        log.warn('No systemId provided, skipping initialization sequence');
        return { success: true, attempts: 0, dataPoints: 0, toolCallsUsed: 0, turnsUsed: 0 };
    }

    // Calculate date range for data retrieval
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - contextWindowDays);

    const initPrompt = `
🔧 INITIALIZATION SEQUENCE - MANDATORY DATA VERIFICATION

Before providing any analysis, you MUST complete this initialization sequence:

1. **Call request_bms_data tool** with these EXACT parameters:
   - systemId: "${systemId}"
   - metric: "all"
   - time_range_start: "${startDate.toISOString()}"
   - time_range_end: "${endDate.toISOString()}"
   - granularity: "daily_avg"

2. **Verify the response**:
   - Check that dataPoints > 0
   - Confirm you received actual data (not an error)
   - Note the number of data points retrieved

3. **Respond with EXACTLY this format**:
   "INITIALIZATION COMPLETE: Retrieved [X] data points from [start_date] to [end_date]"

⚠️ CRITICAL: Do NOT proceed with analysis until you complete this sequence.
⚠️ Do NOT say "data unavailable" - the tool WILL return data if parameters are correct.
⚠️ If the tool returns an error, report EXACTLY what the error says so we can fix it.

Execute the initialization now.`;

    log.info('Starting initialization sequence', {
        systemId,
        contextWindowDays,
        dateRange: `${startDate.toISOString()} to ${endDate.toISOString()}`
    });

    if (stream) stream.write(JSON.stringify({ type: 'status', message: 'Initializing analysis and fetching historical data...' }) + '\n');

    let attempts = 0;
    let toolCallsUsed = 0;
    let turnsUsed = 0;

    // Retry loop until we get successful data retrieval or timeout
    for (attempts = 0; attempts < INITIALIZATION_MAX_RETRIES; attempts++) {
        // Check timeout budget
        const elapsedMs = Date.now() - startTime;
        if (elapsedMs > totalBudgetMs * INITIALIZATION_BUDGET_RATIO) {
            log.warn('Initialization sequence timeout (budget ratio exceeded)', {
                attempts,
                elapsedMs,
                budgetMs: totalBudgetMs * INITIALIZATION_BUDGET_RATIO,
                ratio: INITIALIZATION_BUDGET_RATIO
            });
            if (stream) stream.write(JSON.stringify({ type: 'error', message: 'Initialization timed out.' }) + '\n');
            return {
                success: false,
                attempts,
                error: `Initialization timed out after ${attempts} attempts`,
                toolCallsUsed,
                turnsUsed
            };
        }

        turnsUsed++;

        // Add initialization prompt (only on first attempt)
        if (attempts === 0) {
            conversationHistory.push({
                role: 'user',
                parts: [{ text: initPrompt }]
            });
        }

        log.info(`Initialization attempt ${attempts + 1}`, { elapsedMs });
        if (stream) stream.write(JSON.stringify({ type: 'status', message: `Attempting to retrieve data (attempt ${attempts + 1})...` }) + '\n');

        // Log the conversation history for debugging
        log.info('Conversation history before Gemini call in initialization', {
            turn: attempts + 1,
            history: JSON.stringify(conversationHistory, null, 2)
        });

        let geminiResponse;
        try {
            // Check circuit breaker state before making request
            const circuitState = geminiClient.getCircuitState ? geminiClient.getCircuitState() : null;
            if (circuitState === 'OPEN') {
                log.warn('Circuit breaker is OPEN, waiting for reset before retry', {
                    attempt: attempts + 1,
                    circuitState
                });
                // Wait 10 seconds for circuit to transition to HALF_OPEN
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            geminiResponse = await geminiClient.callAPI(null, {
                history: conversationHistory,
                tools: toolDefinitions,
                model: modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                maxOutputTokens: 2048 // Smaller limit for initialization
            }, log);
        } catch (geminiError) {
            const err = geminiError instanceof Error ? geminiError : new Error(String(geminiError));

            // Detect circuit breaker errors and handle specially
            const isCircuitOpen = err.message.includes('Circuit breaker') ||
                err.message.includes('circuit_open') ||
                err.message.includes('OPEN');

            log.error('Gemini API call failed during initialization', {
                attempt: attempts + 1,
                error: err.message,
                isCircuitOpen
            });

            if (isCircuitOpen) {
                // For circuit breaker errors, wait longer before retry
                if (stream) stream.write(JSON.stringify({ type: 'status', message: 'AI service recovering, please wait...' }) + '\n');
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s for circuit reset
            } else {
                if (stream) stream.write(JSON.stringify({ type: 'status', message: 'Retrying connection...' }) + '\n');
                // On other API errors, retry with linear backoff (add 1 second per attempt)
                const delayMs = Math.min(RETRY_LINEAR_INCREMENT_MS * (attempts + 1), 10000); // Cap at 10 seconds
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            continue;
        }

        // Validate response structure (reuse validation from main loop)
        const responseContent = geminiResponse?.candidates?.[0]?.content;
        if (!responseContent || !responseContent.parts || responseContent.parts.length === 0) {
            log.warn('Invalid Gemini response during initialization, retrying', {
                attempt: attempts + 1,
                hasResponse: !!geminiResponse,
                hasCandidates: !!geminiResponse?.candidates,
                candidatesLength: geminiResponse?.candidates?.length || 0
            });

            // Add error feedback to conversation
            conversationHistory.push({
                role: 'user',
                parts: [{ text: 'Your response was empty or invalid. Please call request_bms_data with the parameters specified above.' }]
            });
            continue;
        }

        // Add response to history
        conversationHistory.push(responseContent);

        // Check for tool calls
        const toolCalls = responseContent.parts.filter((/** @type {{functionCall?: object}} */ p) => p.functionCall);

        if (toolCalls.length === 0) {
            // No tool call - check if Gemini claims initialization is complete
            const textParts = responseContent.parts.filter((/** @type {{text?: string}} */ p) => p.text);
            const responseText = textParts.map((/** @type {{text: string}} */ p) => p.text).join(' ');

            log.warn('Gemini did not call request_bms_data during initialization', {
                attempt: attempts + 1,
                responseText: responseText.substring(0, 500),
                responseLength: responseText.length
            });
            if (stream) stream.write(JSON.stringify({ type: 'status', message: 'AI is not calling the required tools. Retrying...' }) + '\n');

            // Log the full response for debugging
            log.info('Full Gemini response without tool call', {
                attempt: attempts + 1,
                fullResponse: JSON.stringify(geminiResponse).substring(0, 2000)
            });

            // KEYWORD DETECTION: Analyze what Gemini is struggling with
            const detectedConcepts = detectStrugglingConcepts(responseText);

            if (detectedConcepts.length > 0) {
                log.info('Detected struggling concepts via keyword analysis', {
                    attempt: attempts + 1,
                    concepts: detectedConcepts,
                    responseExcerpt: responseText.substring(0, 300)
                });

                // Build context-aware guidance
                const contextAwareGuidance = buildContextAwareGuidance(detectedConcepts, {
                    systemId,
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                });

                if (contextAwareGuidance) {
                    conversationHistory.push({
                        role: 'user',
                        parts: [{ text: contextAwareGuidance }]
                    });
                    continue;
                }
            }

            // Fallback: Provide generic feedback
            conversationHistory.push({
                role: 'user',
                parts: [{ text: `You did not call the request_bms_data tool. You MUST call it with the exact parameters provided. Do it now.` }]
            });
            continue;
        }

        // Execute tool calls
        let dataRetrieved = false;
        let dataPoints = 0;

        for (const toolCall of toolCalls) {
            const toolName = toolCall.functionCall.name;
            const toolArgs = toolCall.functionCall.args;

            log.info(`Initialization tool call: ${toolName}`, {
                attempt: attempts + 1,
                toolArgs: JSON.stringify(toolArgs).substring(0, 500)
            });
            if (stream) stream.write(JSON.stringify({ type: 'status', message: `Calling tool: ${toolName}...` }) + '\n');

            toolCallsUsed++;

            try {
                const toolResult = await executeToolCall(toolName, toolArgs, log);

                // Add tool result to conversation
                conversationHistory.push({
                    role: 'function',
                    parts: [{
                        functionResponse: {
                            name: toolName,
                            response: { result: toolResult }
                        }
                    }]
                });

                // Check if this was request_bms_data and it succeeded
                if (toolName === 'request_bms_data' && toolResult && !toolResult.error) {
                    dataPoints = toolResult.dataPoints || 0;
                    if (dataPoints > 0) {
                        dataRetrieved = true;
                        log.info('Initialization data successfully retrieved', {
                            toolName,
                            dataPoints,
                            attempt: attempts + 1
                        });
                        if (stream) stream.write(JSON.stringify({ type: 'status', message: `Successfully retrieved ${dataPoints} data points.` }) + '\n');
                    } else {
                        log.warn('request_bms_data returned 0 data points', {
                            attempt: attempts + 1,
                            toolResult: JSON.stringify(toolResult).substring(0, 1000)
                        });
                        if (stream) stream.write(JSON.stringify({ type: 'status', message: 'Data query returned no results. Retrying...' }) + '\n');
                    }
                } else if (toolResult && toolResult.error) {
                    // Tool returned an error - log it for improvement
                    log.error('Tool execution returned error during initialization', {
                        toolName,
                        error: toolResult.message || toolResult.error,
                        attempt: attempts + 1,
                        fullResult: JSON.stringify(toolResult).substring(0, 1000)
                    });
                    if (stream) stream.write(JSON.stringify({ type: 'error', message: `Tool ${toolName} failed: ${toolResult.message}` }) + '\n');
                }
            } catch (toolError) {
                const err = toolError instanceof Error ? toolError : new Error(String(toolError));
                log.error('Tool execution threw exception during initialization', {
                    toolName,
                    error: err.message,
                    stack: err.stack,
                    attempt: attempts + 1
                });
                if (stream) stream.write(JSON.stringify({ type: 'error', message: `Tool ${toolName} threw an exception: ${err.message}` }) + '\n');

                // Add error to conversation
                conversationHistory.push({
                    role: 'function',
                    parts: [{
                        functionResponse: {
                            name: toolName,
                            response: {
                                error: true,
                                message: `Tool failed: ${err.message}`
                            }
                        }
                    }]
                });
            }
        }

        // Check if we successfully retrieved data
        if (dataRetrieved && dataPoints > 0) {
            log.info('Initialization sequence SUCCEEDED', {
                attempts: attempts + 1,
                dataPoints,
                toolCallsUsed,
                turnsUsed,
                durationMs: Date.now() - startTime
            });
            if (stream) stream.write(JSON.stringify({ type: 'status', message: 'Initialization complete. Generating insights...' }) + '\n');

            // Ask Gemini to acknowledge initialization completion
            conversationHistory.push({
                role: 'user',
                parts: [{ text: `Data retrieval successful. You now have ${dataPoints} data points available. Acknowledge with "INITIALIZATION COMPLETE" and then proceed with analysis.` }]
            });

            return {
                success: true,
                attempts: attempts + 1,
                dataPoints,
                toolCallsUsed,
                turnsUsed
            };
        }

        // Data retrieval failed or returned 0 points - retry with guidance
        log.warn('Data retrieval attempt did not succeed, retrying', {
            attempt: attempts + 1,
            dataRetrieved,
            dataPoints
        });

        conversationHistory.push({
            role: 'user',
            parts: [{ text: 'Data retrieval incomplete. Call request_bms_data again with the EXACT parameters specified. Do not proceed without data.' }]
        });
    }

    // Exhausted all retries
    log.error('Initialization sequence failed after all retries', {
        attempts,
        maxRetries: INITIALIZATION_MAX_RETRIES
    });
    if (stream) stream.write(JSON.stringify({ type: 'error', message: 'Initialization failed after multiple retries.' }) + '\n');

    return {
        success: false,
        attempts,
        error: `Failed to retrieve data after ${attempts} attempts`,
        toolCallsUsed,
        turnsUsed
    };
}

/**
 * Execute a complete ReAct loop for insights generation
 * 
 * Flow:
 * 1. Collect context (analytics, predictions, etc.) OR resume from checkpoint
 * 2. Build initial prompt with tool definitions (if not resuming)
 * 3. Initialize conversation OR load from checkpoint
 * 4. Loop: Call Gemini → check for tool calls → execute tools → add results → continue
 * 5. Return final answer when Gemini stops requesting tools
 * 6. Save checkpoint on timeout for resuming
 * @param {ReActLoopParams} params
 */
async function executeReActLoop(params) {
    const {
        analysisData,
        systemId,
        customPrompt,
        log: externalLog,
        mode = 'sync',
        contextWindowDays = DEFAULT_CONTEXT_WINDOW_DAYS,
        maxIterations, // Optional override for iteration limit
        modelOverride, // Optional model override (e.g., "gemini-2.5-pro")
        skipInitialization = false, // Skip initialization if already done separately
        checkpointState = null, // Resume from checkpoint if provided
        onCheckpoint = null, // Callback to save checkpoint before timeout
        insightMode = 'with_tools' // Insight mode (standard, full_context, etc.)
    } = params;

    const log = externalLog || createLogger('react-loop');
    const startTime = Date.now();

    // Determine max turns based on query type
    const isCustomQuery = !!customPrompt;
    const MAX_TURNS = maxIterations || (isCustomQuery ? CUSTOM_QUERY_MAX_TURNS : DEFAULT_MAX_TURNS);

    // Calculate time budgets
    const contextBudgetMs = SYNC_CONTEXT_BUDGET_MS;
    const totalBudgetMs = SYNC_TOTAL_BUDGET_MS;

    // Check if resuming from checkpoint
    const isResuming = !!(checkpointState && checkpointState.conversationHistory);

    log.info('Starting ReAct loop with checkpoint support', {
        mode,
        systemId,
        hasCustomPrompt: isCustomQuery,
        contextWindowDays,
        maxTurns: MAX_TURNS,
        contextBudgetMs,
        totalBudgetMs,
        modelOverride,
        skipInitialization,
        isResuming,
        checkpointTurn: checkpointState?.startTurnCount || 0,
        insightMode
    });

    try {
        // Step 1: Collect pre-computed context OR restore from checkpoint
        let preloadedContext;
        let conversationHistory;
        let contextSummary;
        let turnCount = 0;
        let toolCallCount = 0;

        if (isResuming) {
            // RESUME FROM CHECKPOINT: Restore conversation state
            log.info('Resuming from checkpoint', {
                checkpointTurn: checkpointState.startTurnCount,
                checkpointToolCalls: checkpointState.startToolCallCount,
                historyLength: checkpointState.conversationHistory.length
            });

            conversationHistory = checkpointState.conversationHistory;
            contextSummary = checkpointState.contextSummary || {};
            turnCount = checkpointState.startTurnCount || 0;
            toolCallCount = checkpointState.startToolCallCount || 0;
            preloadedContext = null; // Context already embedded in conversation history

        } else {
            // FRESH START: Collect context from scratch
            const contextStartTime = Date.now();

            try {
                // EDGE CASE PROTECTION #4: Add hard timeout to context collection
                // Prevent context collection from consuming entire budget
                const contextCollectionPromise = collectAutoInsightsContext(
                    systemId,
                    analysisData,
                    log,
                    { mode, maxMs: contextBudgetMs }
                );

                preloadedContext = await Promise.race([
                    contextCollectionPromise,
                    new Promise((_, reject) =>
                        setTimeout(() => {
                            reject(new Error('CONTEXT_TIMEOUT'));
                        }, contextBudgetMs + 1000) // Allow 1s extra for graceful completion
                    )
                ]);
            } catch (contextError) {
                const err = contextError instanceof Error ? contextError : new Error(String(contextError));

                if (err.message === 'CONTEXT_TIMEOUT') {
                    log.warn('Context collection exceeded budget, continuing with minimal context', {
                        budgetMs: contextBudgetMs,
                        durationMs: Date.now() - contextStartTime
                    });
                } else {
                    log.error('Context collection failed, continuing with minimal context', {
                        error: err.message,
                        durationMs: Date.now() - contextStartTime
                    });
                }

                preloadedContext = null;
            }

            const contextDurationMs = Date.now() - contextStartTime;
            log.info('Context collection completed', { durationMs: contextDurationMs });

            // Step 2: Build initial prompt
            const promptResult = await buildGuruPrompt({
                analysisData,
                systemId,
                customPrompt,
                log,
                context: preloadedContext,
                mode,
                // @ts-ignore - insightMode is not in the type definition but is handled by the function
                insightMode // Pass insight mode to prompt builder
            });

            const initialPrompt = promptResult.prompt;
            contextSummary = promptResult.contextSummary;

            log.info('Initial prompt built', {
                promptLength: initialPrompt.length,
                toolCount: toolDefinitions.length
            });

            // Step 3: Initialize conversation history
            conversationHistory = [
                {
                    role: 'user',
                    parts: [{ text: initialPrompt }]
                }
            ];
        }

        // Step 3.5: MANDATORY INITIALIZATION SEQUENCE (unless skipped or resuming)
        // Force Gemini to retrieve historical data before analysis
        const geminiClient = getGeminiClient();

        /** @type {InitializationResult} */
        let initResult = { success: true, attempts: 0, toolCallsUsed: 0, turnsUsed: 0 };
        if (!skipInitialization && !isResuming && systemId) {
            initResult = await executeInitializationSequence({
                systemId,
                contextWindowDays,
                conversationHistory,
                geminiClient,
                log,
                startTime,
                totalBudgetMs,
                modelOverride,
                stream: params.stream // Pass the stream here
            });

            if (!initResult.success) {
                // Initialization failed after retries
                // This is NOT fatal - we'll save a checkpoint and let the client retry
                log.warn('Initialization sequence incomplete, will retry on next attempt', {
                    error: initResult.error,
                    attempts: initResult.attempts,
                    durationMs: Date.now() - startTime
                });

                // Save checkpoint so we can resume later
                // Mark initialization as not complete so next attempt tries again
                if (onCheckpoint) {
                    await onCheckpoint({
                        conversationHistory,
                        turnCount: initResult.turnsUsed || 0,
                        toolCallCount: initResult.toolCallsUsed || 0,
                        contextSummary: {
                            initializationAttempted: true,
                            initializationComplete: false,
                            initializationError: initResult.error
                        },
                        startTime
                    });
                }

                // Return with timedOut flag so handler knows this is retryable
                // Using consistent pattern: success=false + timedOut=true for timeout cases
                return {
                    success: false,
                    timedOut: true, // Indicates this is a timeout, triggers 408 response
                    reason: 'initialization_timeout', // Specific reason for debugging
                    error: `Initialization in progress: ${initResult.error}. Retrying automatically...`,
                    durationMs: Date.now() - startTime,
                    turns: initResult.turnsUsed || 0,
                    toolCalls: initResult.toolCallsUsed || 0
                };
            }

            const error = (/** @type {any} */ (initResult)).error;
            const dataPoints = (/** @type {any} */ (initResult)).dataPoints;
            log.info('Initialization sequence completed successfully', {
                attempts: initResult.attempts,
                dataPointsRetrieved: dataPoints,
                error: error,
                durationMs: Date.now() - startTime
            });

            // Update counters with initialization usage
            toolCallCount = initResult.toolCallsUsed || 0;
            turnCount = initResult.turnsUsed || 0;
        } else if (skipInitialization) {
            log.info('Skipping initialization sequence (already completed separately)');
        } else if (isResuming) {
            log.info('Skipping initialization sequence (resuming from checkpoint)');
        } else {
            log.info('Skipping initialization sequence (no systemId)');
        }

        // Step 4: Main ReAct loop
        let finalAnswer = null;
        let lastCheckpointTime = startTime; // Track when we last saved a checkpoint
        let timedOut = false; // Track if we exited due to timeout
        let consecutiveLazyResponses = 0; // Track consecutive lazy AI responses to prevent infinite loops
        let consecutiveVisualDisclaimers = 0; // Track consecutive visual disclaimer responses

        for (; turnCount < MAX_TURNS; turnCount++) {
            // Check timeout and save checkpoint if needed
            const elapsedMs = Date.now() - startTime;
            const timeSinceLastCheckpoint = Date.now() - lastCheckpointTime;
            const timeRemaining = totalBudgetMs - elapsedMs;

            // CRITICAL: Check if we're approaching timeout
            if (elapsedMs > totalBudgetMs) {
                log.warn('Total budget exceeded, stopping loop and saving checkpoint', {
                    turn: turnCount,
                    elapsedMs,
                    budgetMs: totalBudgetMs,
                    timeRemaining
                });

                // Save checkpoint before timeout
                if (onCheckpoint) {
                    await onCheckpoint({
                        conversationHistory,
                        turnCount,
                        toolCallCount,
                        contextSummary,
                        startTime
                    });
                }

                const circuitState = geminiClient.getCircuitState ? geminiClient.getCircuitState() : null;
                timedOut = true; // Mark as timed out
                break;
            }

            // EDGE CASE PROTECTION: Check if we have enough time for a meaningful iteration
            // Need at least MIN_GEMINI_CALL_TIMEOUT_MS for the call, plus buffers for checkpoint and response
            const MIN_ITERATION_TIME = MIN_GEMINI_CALL_TIMEOUT_MS + CHECKPOINT_SAVE_BUFFER_MS + RESPONSE_BUFFER_MS;
            if (timeRemaining < MIN_ITERATION_TIME) {
                log.info('Insufficient time for another iteration, saving checkpoint', {
                    turn: turnCount,
                    timeRemaining,
                    minRequired: MIN_ITERATION_TIME
                });

                // Save checkpoint before exiting
                if (onCheckpoint) {
                    await onCheckpoint({
                        conversationHistory,
                        turnCount,
                        toolCallCount,
                        contextSummary,
                        startTime
                    });
                }

                finalAnswer = buildTimeoutMessage(MAX_TURNS);
                timedOut = true;
                break;
            }

            // Progressive checkpointing: Save checkpoint every CHECKPOINT_FREQUENCY_MS (~6s)
            // This ensures we don't lose much progress if Netlify kills the function
            if (onCheckpoint && turnCount > 0 && timeSinceLastCheckpoint >= CHECKPOINT_FREQUENCY_MS) {
                log.info('Saving periodic checkpoint', {
                    turn: turnCount,
                    elapsedMs,
                    timeSinceLastCheckpoint
                });

                await onCheckpoint({
                    conversationHistory,
                    turnCount,
                    toolCallCount,
                    contextSummary,
                    startTime
                });

                lastCheckpointTime = Date.now();
            }

            log.info(`ReAct turn ${turnCount + 1}/${MAX_TURNS}`, {
                elapsedMs,
                remainingMs: totalBudgetMs - elapsedMs,
                percentComplete: Math.round((elapsedMs / totalBudgetMs) * 100)
            });

            // EDGE CASE PROTECTION #1: Calculate safe timeout for this iteration
            // Since SYNC_TOTAL_BUDGET_MS already accounts for checkpoint and response buffers,
            // we only need a small safety margin for this iteration
            const safeIterationTimeout = Math.max(
                timeRemaining - ITERATION_SAFETY_BUFFER_MS,
                MIN_GEMINI_CALL_TIMEOUT_MS
            );

            log.debug('Iteration timeout calculated', {
                turn: turnCount,
                timeRemaining,
                safeIterationTimeout,
                iterationSafetyBuffer: ITERATION_SAFETY_BUFFER_MS
            });

            // Log the conversation history for debugging
            log.info('Conversation history before Gemini call', {
                turn: turnCount,
                history: JSON.stringify(conversationHistory, null, 2)
            });

            // Call Gemini with conversation history and tools
            // EDGE CASE PROTECTION #2: Wrap Gemini call with timeout to prevent hangs
            let geminiResponse;
            try {
                // Check circuit breaker state before making request
                const circuitState = geminiClient.getCircuitState ? geminiClient.getCircuitState() : null;
                if (circuitState === 'OPEN') {
                    log.warn('Circuit breaker is OPEN in main loop, waiting for reset', {
                        turn: turnCount,
                        circuitState
                    });
                    // Wait 10 seconds for circuit to transition to HALF_OPEN
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }

                const geminiCallPromise = geminiClient.callAPI(null, {
                    history: conversationHistory,
                    tools: toolDefinitions,
                    model: modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                    maxOutputTokens: 4096
                }, log);

                // Race Gemini call against iteration timeout
                geminiResponse = await Promise.race([
                    geminiCallPromise,
                    new Promise((_, reject) =>
                        setTimeout(() => {
                            reject(new Error('ITERATION_TIMEOUT'));
                        }, safeIterationTimeout)
                    )
                ]);
            } catch (geminiError) {
                const err = geminiError instanceof Error ? geminiError : new Error(String(geminiError));

                // Detect circuit breaker errors
                const isCircuitOpen = err.message.includes('Circuit breaker') ||
                    err.message.includes('circuit_open') ||
                    err.message.includes('OPEN');

                // EDGE CASE PROTECTION #3: Detect iteration timeout vs Gemini error
                if (err.message === 'ITERATION_TIMEOUT') {
                    log.warn('Gemini call exceeded iteration timeout, saving checkpoint', {
                        turn: turnCount,
                        timeoutMs: safeIterationTimeout,
                        elapsedMs: Date.now() - startTime
                    });

                    // Save checkpoint immediately
                    if (onCheckpoint) {
                        await onCheckpoint({
                            conversationHistory,
                            turnCount,
                            toolCallCount,
                            contextSummary,
                            startTime
                        });
                    }

                    // Return timeout to trigger retry
                    finalAnswer = buildTimeoutMessage(MAX_TURNS);
                    timedOut = true;
                    break;
                }

                // Handle circuit breaker errors - wait and retry instead of throwing
                if (isCircuitOpen && turnCount < MAX_TURNS - 1) {
                    log.warn('Circuit breaker error, waiting before retry', {
                        turn: turnCount,
                        error: err.message
                    });
                    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
                    continue; // Retry this turn
                }

                log.error('Gemini API call failed', {
                    turn: turnCount,
                    error: err.message,
                    isCircuitOpen,
                    elapsedMs: Date.now() - startTime
                });
                throw err;
            }

            // Extract response content with detailed validation and recovery
            if (!geminiResponse || !geminiResponse.candidates) {
                log.error('Gemini response missing candidates array - full response logged', {
                    turn: turnCount,
                    response: JSON.stringify(geminiResponse),
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });

                // Attempt recovery: provide helpful message to user
                finalAnswer = `I encountered an issue processing your request. The AI service returned an unexpected response structure. This can happen with very complex or unusual queries. Please try:\n\n1. Simplifying your question\n2. Breaking it into smaller parts\n3. Providing more specific time ranges or metrics\n\nTechnical details: Missing candidates array in Gemini response.`;
                break;
            }

            if (geminiResponse.candidates.length === 0) {
                log.error('Gemini response has empty candidates array', {
                    turn: turnCount,
                    response: JSON.stringify(geminiResponse).substring(0, 1000),
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });

                // Recovery: Check for finishReason or promptFeedback that might explain
                const promptFeedback = geminiResponse.promptFeedback;
                if (promptFeedback && promptFeedback.blockReason) {
                    finalAnswer = `Your request was blocked by content safety filters. Reason: ${promptFeedback.blockReason}. Please rephrase your question.`;
                } else {
                    finalAnswer = `The AI service could not generate a response to your request. This may be due to the complexity or phrasing of your question. Please try rephrasing or simplifying.`;
                }
                break;
            }

            const responseContent = geminiResponse.candidates[0]?.content;
            if (!responseContent) {
                log.error('Gemini response candidate missing content', {
                    turn: turnCount,
                    candidate: JSON.stringify(geminiResponse.candidates[0]).substring(0, 1000),
                    finishReason: geminiResponse.candidates[0]?.finishReason,
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });

                // Check finish reason for context
                const finishReason = geminiResponse.candidates[0]?.finishReason;
                if (finishReason === 'SAFETY') {
                    finalAnswer = `Your request triggered content safety filters. Please rephrase to avoid sensitive topics.`;
                } else if (finishReason === 'MAX_TOKENS') {
                    finalAnswer = `The response exceeded token limits. Try asking for a shorter or more focused answer.`;
                } else if (finishReason === 'RECITATION') {
                    finalAnswer = `The AI detected potential copyrighted content. Please rephrase your request.`;
                } else {
                    finalAnswer = `Unable to generate response. Finish reason: ${finishReason || 'unknown'}. Please try rephrasing your question.`;
                }
                break;
            }

            if (!responseContent.parts || !Array.isArray(responseContent.parts)) {
                log.error('Gemini response content missing or invalid parts array - attempting recovery', {
                    turn: turnCount,
                    content: JSON.stringify(responseContent).substring(0, 1000),
                    partsType: typeof responseContent.parts,
                    hasRole: !!responseContent.role,
                    customPrompt: customPrompt ? customPrompt.substring(0, 200) : null
                });

                // Recovery attempt: Check if there's a text field directly on content
                if (responseContent.text) {
                    log.info('Found text directly on content object, recovering', {
                        turn: turnCount,
                        textLength: responseContent.text.length
                    });
                    finalAnswer = responseContent.text;
                    break;
                }

                // No recovery possible
                finalAnswer = `I encountered a technical issue processing your request. The response format was unexpected. This sometimes happens with very complex questions requiring multiple data lookups. Please try:\n\n1. Asking for specific metrics or time ranges\n2. Breaking complex questions into simpler parts\n3. Using more standard phrasing\n\nTechnical: Invalid parts array structure.`;
                break;
            }

            if (responseContent.parts.length === 0) {
                log.warn('Gemini response has empty parts array - attempting to continue', {
                    turn: turnCount,
                    content: JSON.stringify(responseContent).substring(0, 500)
                });
                // Check if this is final turn - if so, provide fallback
                if (turnCount === MAX_TURNS - 1) {
                    finalAnswer = `No response generated after ${MAX_TURNS} attempts. The question may be too complex or require data that isn't available. Please try a simpler, more specific question.`;
                    break;
                }
                // Otherwise continue to next turn
                conversationHistory.push(responseContent);
                continue;
            }

            log.debug('Gemini response received', {
                turn: turnCount,
                partCount: responseContent.parts.length,
                partTypes: responseContent.parts.map((/** @type {{[key: string]: any}} */ p) => Object.keys(p)[0]),
                hasText: responseContent.parts.some((/** @type {{text?: string}} */ p) => p.text),
                hasFunctionCall: responseContent.parts.some((/** @type {{functionCall?: object}} */ p) => p.functionCall)
            });

            // Add model response to conversation history
            conversationHistory.push(responseContent);

            // Step 5: Check for tool calls in response
            const toolCalls = responseContent.parts.filter((/** @type {{functionCall?: object}} */ p) => p.functionCall);

            if (toolCalls.length === 0) {
                // No tool calls → this is potentially the final answer
                const textParts = responseContent.parts.filter((/** @type {{text?: string}} */ p) => p.text);

                if (textParts.length > 0) {
                    const rawAnswer = textParts.map((/** @type {{text: string}} */ p) => p.text).join('\n');

                    // Lazy AI Detection: Check if AI is claiming data unavailable without attempting to fetch it
                    const lowerAnswer = rawAnswer.toLowerCase();
                    const lazinessTriggers = [
                        "i do not have access to",
                        "the data is unavailable",
                        "cannot see historical data",
                        "unable to retrieve the data",
                        "no historical data is available",
                        "cannot access the requested data"
                    ];

                    // Only intervene if:
                    // 1. It's claiming data is missing
                    // 2. We haven't run many tools yet (it gave up too early)
                    // 3. It's a custom query (where users expect data lookup)
                    // 4. We have turns remaining
                    // 5. No recent tool failures (legitimate unavailability after failed attempts)
                    const isLazy = lazinessTriggers.some((/** @type {any} */ t) => lowerAnswer.includes(t));

                    // Check if recent tool calls failed (last N messages, where N = RECENT_TOOL_FAILURE_WINDOW)
                    // Tool failures can be in two forms:
                    // 1. Tool returned error object: functionResponse.response.result.error
                    // 2. Tool threw exception: functionResponse.response.error (boolean)
                    const recentToolFailures = conversationHistory.slice(-RECENT_TOOL_FAILURE_WINDOW).some((/** @type {any} */ msg) =>
                        msg.role === 'function' &&
                        Array.isArray(msg.parts) &&
                        msg.parts.some((/** @type {any} */ p) =>
                            p.functionResponse &&
                            p.functionResponse.response &&
                            (p.functionResponse.response.error || (p.functionResponse.response.result && p.functionResponse.response.result.error))
                        )
                    );

                    if (isLazy && toolCallCount === 0 && isCustomQuery && turnCount < MAX_TURNS - 1 && !recentToolFailures) {
                        consecutiveLazyResponses++;

                        if (consecutiveLazyResponses > LAZY_RESPONSE_THRESHOLD) {
                            log.error('AI repeatedly claiming no data after interventions', {
                                turn: turnCount,
                                consecutiveCount: consecutiveLazyResponses,
                                maxAllowed: LAZY_RESPONSE_THRESHOLD
                            });
                            finalAnswer = LAZY_AI_FALLBACK_MESSAGE;
                            break;
                        }

                        log.warn('Detected "Lazy AI" - claiming no data without checking tools', {
                            turn: turnCount,
                            consecutiveCount: consecutiveLazyResponses
                        });

                        // Force the loop to continue by adding an intervention message without setting finalAnswer
                        // The AI will receive this as a user message on the next iteration
                        conversationHistory.push({
                            role: 'user',
                            parts: [{
                                text: `SYSTEM INTERVENTION: You claimed data is unavailable, but you have NOT checked the tools yet.\n\n` +
                                    `You have access to 'request_bms_data', 'getSystemAnalytics', and others.\n` +
                                    `1. Look at the "DATA AVAILABILITY" section in the first message.\n` +
                                    `2. CALL A TOOL to get the data you need (e.g. request_bms_data).\n` +
                                    `3. Do not apologize. Just send the tool call JSON.`
                            }]
                        });

                        // Continue the loop to let Gemini try again
                        continue;
                    } else {
                        consecutiveLazyResponses = 0; // Reset on non-lazy response
                    }

                    // Visual Guru Disclaimer Detection: Prevent AI from refusing visual output
                    // Only applies to visual-guru mode
                    const isVisualGuruMode = insightMode === 'visual-guru' || insightMode === 'visual_guru';
                    if (isVisualGuruMode) {
                        const hasVisualDisclaimer = VISUAL_DISCLAIMER_TRIGGERS.some(
                            (/** @type {string} */ trigger) => lowerAnswer.includes(trigger)
                        );
                        
                        if (hasVisualDisclaimer) {
                            consecutiveVisualDisclaimers++;
                            
                            // Check if we've exceeded the threshold or are on the last turn
                            if (consecutiveVisualDisclaimers > VISUAL_DISCLAIMER_THRESHOLD) {
                                log.error('Visual Guru repeatedly refused to provide charts after interventions', {
                                    turn: turnCount,
                                    consecutiveCount: consecutiveVisualDisclaimers,
                                    maxAllowed: VISUAL_DISCLAIMER_THRESHOLD
                                });
                                // Accept the response but with a warning - let user see what AI said
                                finalAnswer = `⚠️ **Visual Analysis Limitation**\n\nThe AI model repeatedly indicated it cannot generate visual content. ` +
                                    `This may be a model limitation. The response below is text-only:\n\n---\n\n${rawAnswer}`;
                                break;
                            }
                            
                            // Handle last turn explicitly - can't continue, must provide fallback
                            if (turnCount >= MAX_TURNS - 1) {
                                log.warn('Visual Guru disclaimer on last turn - providing fallback', {
                                    turn: turnCount,
                                    consecutiveCount: consecutiveVisualDisclaimers
                                });
                                finalAnswer = `⚠️ **Visual Analysis Limitation**\n\nThe AI model indicated it cannot generate visual content on the final attempt. ` +
                                    `The response below is text-only:\n\n---\n\n${rawAnswer}`;
                                break;
                            }
                            
                            log.warn('Visual Guru received disclaimer response - requesting chart JSON instead', {
                                turn: turnCount,
                                consecutiveCount: consecutiveVisualDisclaimers,
                                answerPreview: rawAnswer.substring(0, 200)
                            });
                            
                            // Intervention: Remind AI that "visual" means JSON chart configs, not images
                            conversationHistory.push({
                                role: 'user',
                                parts: [{
                                    text: `SYSTEM INTERVENTION: You said you cannot send visuals/infographics. This is INCORRECT.\n\n` +
                                        `"Visual" in this context means STRUCTURED JSON DATA inside \`\`\`chart code blocks.\n` +
                                        `You are NOT being asked to generate binary images.\n\n` +
                                        `Please provide your analysis with chart configurations like:\n` +
                                        `\`\`\`chart\n{"chartType": "line", "title": "SOC Trend", "series": [...]}\n\`\`\`\n\n` +
                                        `The frontend will render these JSON configs as interactive charts.\n` +
                                        `DO NOT apologize or explain - just output the structured analysis with chart JSON.`
                                }]
                            });
                            
                            // Continue loop to let Gemini try again
                            continue;
                        } else {
                            // Reset counter on non-disclaimer response
                            consecutiveVisualDisclaimers = 0;
                        }
                    }

                    // If not lazy, accept the answer
                    finalAnswer = rawAnswer;

                    log.info('Final answer received from Gemini', {
                        turn: turnCount,
                        answerLength: finalAnswer.length,
                        toolCallsTotal: toolCallCount
                    });

                    // Validate response format
                    const validation = validateResponseFormat(finalAnswer, customPrompt || '');

                    if (!validation.valid && turnCount < MAX_TURNS - 1) {
                        log.warn('Response format validation failed, requesting correction', {
                            error: validation.error,
                            formatType: validation.formatType,
                            turn: turnCount,
                            attemptsRemaining: MAX_TURNS - turnCount - 1
                        });

                        // Add format correction request to conversation
                        const correctionPrompt = buildCorrectionPrompt(
                            finalAnswer,
                            validation.error,
                            validation.formatType,
                            customPrompt || ''
                        );

                        conversationHistory.push({
                            role: 'user',
                            parts: [{ text: correctionPrompt }]
                        });

                        // Clear finalAnswer to continue loop
                        finalAnswer = null;

                        log.info('Correction request added to conversation', {
                            turn: turnCount,
                            formatType: validation.formatType
                        });

                        // Continue to next turn for correction
                        continue;
                    } else if (!validation.valid) {
                        log.warn('Response format validation failed but no retries left, using malformed response', {
                            error: validation.error,
                            formatType: validation.formatType,
                            turn: turnCount
                        });
                        // Use the response anyway - better than nothing
                    } else {
                        log.info('Response format validated successfully', {
                            formatType: validation.formatType,
                            turn: turnCount
                        });
                    }

                    // Issue 230: Validate that AI doesn't suggest tools to users
                    // AI must EXECUTE tools itself, not tell users to run them
                    const toolSuggestionCheck = detectToolSuggestions(finalAnswer);
                    if (toolSuggestionCheck.containsToolSuggestions && turnCount < MAX_TURNS - 1) {
                        log.warn('Response contains tool suggestions for users (prohibited)', {
                            suggestions: toolSuggestionCheck.suggestions,
                            turn: turnCount,
                            attemptsRemaining: MAX_TURNS - turnCount - 1
                        });

                        // Request correction - AI must execute tools or remove suggestions
                        const toolCorrectionPrompt = buildToolSuggestionCorrectionPrompt(
                            finalAnswer,
                            toolSuggestionCheck.suggestions
                        );

                        conversationHistory.push({
                            role: 'user',
                            parts: [{ text: toolCorrectionPrompt }]
                        });

                        // Clear finalAnswer to continue loop
                        finalAnswer = null;

                        log.info('Tool suggestion correction requested', {
                            turn: turnCount,
                            suggestionsFound: toolSuggestionCheck.suggestions.length
                        });

                        // Continue to next turn for correction
                        continue;
                    } else if (toolSuggestionCheck.containsToolSuggestions) {
                        log.warn('Response contains tool suggestions but no retries left, proceeding with warning', {
                            suggestions: toolSuggestionCheck.suggestions,
                            turn: turnCount
                        });
                        // Continue with the response but log the issue
                    }
                }
                break;
            }

            // Step 6: Execute tool calls
            log.info(`Processing ${toolCalls.length} tool call(s)`, {
                turn: turnCount,
                tools: toolCalls.map(t => t.functionCall.name)
            });

            // Reset consecutive lazy response counter when AI makes tool calls
            // This indicates the intervention worked and AI is now being proactive
            consecutiveLazyResponses = 0;

            for (const toolCall of toolCalls) {
                const toolName = toolCall.functionCall.name;
                const toolArgs = toolCall.functionCall.args;

                try {
                    log.info(`Executing tool: ${toolName}`, {
                        turn: turnCount,
                        toolArgsKeys: Object.keys(toolArgs || {})
                    });

                    const toolResult = await executeToolCall(toolName, toolArgs, log);
                    toolCallCount++;

                    // Add tool result to conversation
                    if ((/** @type {any} */ (toolResult)).graceful_degradation) {
                        const degradationMsg = (/** @type {any} */ (toolResult)).message || 'AI service is degraded';
                        conversationHistory.push({
                            role: 'user',
                            parts: [{ text: `The tool ${toolName} failed with the following error: ${degradationMsg}. I will try to continue without this information.` }]
                        });
                    } else {
                        conversationHistory.push({
                            role: 'function',
                            parts: [{
                                functionResponse: {
                                    name: toolName,
                                    response: { result: toolResult }
                                }
                            }]
                        });
                    }

                    log.info(`Tool executed successfully: ${toolName}`, {
                        turn: turnCount,
                        resultSize: toolResult ? JSON.stringify(toolResult).length : 0
                    });
                } catch (toolError) {
                    const err = toolError instanceof Error ? toolError : new Error(String(toolError));
                    log.error(`Tool execution failed: ${toolName}`, {
                        turn: turnCount,
                        error: err.message
                    });

                    // Add error result to conversation so Gemini knows it failed
                    conversationHistory.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: toolName,
                                response: {
                                    error: true,
                                    message: `Tool execution failed: ${err.message}`
                                }
                            }
                        }]
                    });
                }
            }

            // EDGE CASE PROTECTION #5: Check if we have enough time for another iteration AFTER tool execution
            // Heavy tools (like request_bms_data) consume significant time. We must check budget again.
            const postToolElapsedMs = Date.now() - startTime;
            const postToolTimeRemaining = totalBudgetMs - postToolElapsedMs;
            const MIN_POST_TOOL_TIME = MIN_GEMINI_CALL_TIMEOUT_MS + CHECKPOINT_SAVE_BUFFER_MS + RESPONSE_BUFFER_MS;

            if (postToolTimeRemaining < MIN_POST_TOOL_TIME) {
                log.warn('Insufficient time for next iteration after tool execution, saving checkpoint', {
                    turn: turnCount,
                    postToolTimeRemaining,
                    minRequired: MIN_POST_TOOL_TIME,
                    elapsedMs: postToolElapsedMs
                });

                if (onCheckpoint) {
                    await onCheckpoint({
                        conversationHistory,
                        turnCount: turnCount + 1, // Advance turn count since we finished this turn's tools
                        toolCallCount,
                        contextSummary,
                        startTime
                    });
                }

                finalAnswer = buildTimeoutMessage(MAX_TURNS);
                timedOut = true;
                break;
            }
        }

        // Determine if we hit max turns without final answer
        if (!finalAnswer) {
            if (turnCount >= MAX_TURNS) {
                finalAnswer = buildMaxTurnsMessage(MAX_TURNS);
                log.warn('Reached max turns without final answer', {
                    turns: MAX_TURNS,
                    toolCalls: toolCallCount
                });
            } else {
                finalAnswer = 'Unable to generate insights at this time. Please try again.';
                log.error('Unexpected end of ReAct loop without final answer');
            }
        }

        const totalDurationMs = Date.now() - startTime;

        log.info('ReAct loop completed successfully', {
            turns: turnCount + 1,
            toolCalls: toolCallCount,
            totalDurationMs,
            answerLength: finalAnswer.length
        });

        // Log operation metrics for successful insights generation
        // Estimate token usage: sum all message lengths in conversationHistory plus finalAnswer, divide by 4 (approx chars per token)
        // Handle both content-based messages and function call parts
        const historyLength = conversationHistory.reduce((/** @type {number} */ sum, /** @type {any} */ msg) => {
            let msgLength = 0;
            if (msg.content) {
                msgLength += msg.content.length;
            }
            if (msg.parts && Array.isArray(msg.parts)) {
                const partsLength = (msg.parts || []).reduce((/** @type {number} */ partSum, /** @type {any} */ part) => {
                    if (typeof part === 'string') return partSum + part.length;
                    if (part.text) return partSum + part.text.length;
                    // For function calls, estimate based on stringified content
                    return partSum + JSON.stringify(part).length;
                }, 0);
                msgLength += partsLength;
            }
            return sum + msgLength;
        }, 0);

        const estimatedTokenCount = Math.round(
            (historyLength + (finalAnswer ? finalAnswer.length : 0)) / 4
        ); // Approximate: 4 chars per token

        try {
            await logAIOperation({
                operation: 'insights',
                systemId: systemId,
                duration: totalDurationMs,
                tokensUsed: estimatedTokenCount, // Estimated; replace with actual token tracking if Gemini API supports it
                success: true,
                model: modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                contextWindowDays: contextWindowDays,
                metadata: {
                    turns: turnCount + 1,
                    toolCalls: toolCallCount,
                    conversationLength: conversationHistory.length,
                    timedOut: timedOut,
                    isCustomQuery: isCustomQuery,
                    tokenEstimationMethod: 'char_count_div_4'
                }
            });

            // Check for anomalies
            await checkForAnomalies({
                duration: totalDurationMs
            });
        } catch (metricsError) {
            // Don't fail the operation if metrics logging fails
            log.warn('Failed to log insights metrics', { error: metricsError.message });
        }

        return {
            success: true,
            finalAnswer,
            turns: turnCount + 1,
            toolCalls: toolCallCount,
            durationMs: totalDurationMs,
            contextSummary,
            conversationLength: conversationHistory.length,
            // Include conversationHistory and startTime when timed out so the handler can
            // perform an emergency checkpoint save if the normal onCheckpoint callback failed.
            // These fields are large so we only include them when needed for recovery.
            conversationHistory: timedOut ? conversationHistory : undefined,
            startTime: timedOut ? startTime : undefined,
            timedOut // Indicate if we exited due to timeout
        };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const totalDurationMs = Date.now() - startTime;

        log.error('ReAct loop failed', {
            error: err.message,
            stack: err.stack,
            durationMs: totalDurationMs
        });

        // Log failed operation metrics
        try {
            await logAIOperation({
                operation: 'insights',
                systemId: systemId,
                duration: totalDurationMs,
                success: false,
                error: err.message,
                model: modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                contextWindowDays: contextWindowDays
            });
        } catch (metricsError) {
            const err = metricsError instanceof Error ? metricsError : new Error(String(metricsError));
            log.warn('Failed to log AI operation metrics', { error: err.message });
        }

        return {
            success: false,
            error: err.message,
            durationMs: totalDurationMs
        };
    }
}

/**
 * Build timeout message when budget is exceeded
 */
function buildTimeoutMessage(/** @type {number} */ maxTurns) {
    return `I've reached my analysis time budget during investigation. Here's what I gathered before timeout:

**Status:** Partial analysis completed due to time constraints.

**What happened:** Your question required detailed data analysis, but I ran out of time gathering information.

**Recommendations:**
1. Try a more specific question (e.g., "What's my current SOC?" vs "Analyze everything")
2. Use the background analysis mode for complex investigations
3. Check back in a few minutes and we'll provide more detailed findings

Please resubmit your question and I'll prioritize the most critical insights.`;
}

/**
 * Build message when max turns is reached
 */
function buildMaxTurnsMessage(maxTurns) {
    return `I've completed ${maxTurns} analysis iterations but need more data to fully answer your question.

**What I found:** Partial analysis available, but requires additional investigation.

**Next steps:**
1. Try asking a more focused question
2. Use background analysis mode for comprehensive investigation
3. Ask follow-up questions based on these initial findings

This typically means your question requires accessing long-term historical data or complex correlations that need the background analysis pipeline.`;
}

module.exports = {
    executeReActLoop,
    executeInitializationSequence,
    DEFAULT_MAX_TURNS,
    CUSTOM_QUERY_MAX_TURNS,
    DEFAULT_CONTEXT_WINDOW_DAYS,
    INITIALIZATION_MAX_RETRIES,
    INITIALIZATION_BUDGET_RATIO
};
