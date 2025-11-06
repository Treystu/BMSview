/**
 * Generate Insights - Enhanced AI-Powered Analysis with Trend Tracking
 * 
 * This is the primary insights generation endpoint that uses Gemini 2.5 Flash with
 * function calling capabilities to provide comprehensive, trend-based analysis.
 * 
 * **Usage:**
 * - Endpoint: /.netlify/functions/generate-insights-with-tools
 * - Used by: All insights generation (standard mode removed)
 * - Features: AI can query historical data, weather, solar, and analytics
 * 
 * **What it does:**
 * 1. Accepts battery measurement data and system context
 * 2. Provides Gemini with tools to intelligently query additional data:
 *    - getSystemHistory: Historical battery records for trend analysis
 *    - getWeatherData: Weather conditions affecting performance
 *    - getSolarEstimates: Solar generation predictions
 *    - getSystemAnalytics: Performance analytics and trends
 * 3. AI analyzes trends across datapoints:
 *    - Charging/discharging rate deltas over time
 *    - Voltage degradation patterns
 *    - Real efficiency metrics from actual data
 *    - Capacity retention tracking
 *    - Usage pattern analysis
 * 4. Returns actionable insights without generic recommendations
 * 
 * **Related Functions:**
 * - utils/gemini-tools.cjs: Tool definitions and execution logic
 * 
 * @module netlify/functions/generate-insights-with-tools
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Constants for data fetching
const DEFAULT_HISTORY_LIMIT = 30;
const CUSTOM_QUERY_HISTORY_LIMIT = 100;
const MAX_TIME_RANGE_RECORDS = 500;
const MAX_DAYS_LOOKBACK = 90;

const MAX_TOOL_ITERATIONS = 10; // Reserved for future SDK upgrade with native function calling

/**
 * Main handler for insights generation with function calling
 */
async function handler(event = {}, context = {}) {
  const log = createLogger('generate-insights-with-tools', context);
  const timer = createTimer(log, 'generate-insights-with-tools');

  try {
    // Parse request body with better error handling
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn('Failed to parse request body', { error: error.message, body: event.body });
      return respond(400, { error: 'Invalid JSON in request body' });
    }

    // Extract and normalize data
    let analysisData = body.analysisData || body.batteryData || body;

    // Handle different data structures
    if (body.measurements) {
      analysisData = { measurements: body.measurements };
    }

    if (!analysisData || (!analysisData.measurements && !analysisData.voltage && !analysisData.current && !analysisData.overallVoltage)) {
      log.warn('No analysis data found', { bodyKeys: Object.keys(body) });
      return respond(400, {
        error: 'analysisData is required',
        debug: {
          receivedKeys: Object.keys(body),
          expectedStructure: 'analysisData with measurements array or direct measurements'
        }
      });
    }

    const { systemId, customPrompt } = body;

    log.info('Starting enhanced AI insights generation', {
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      dataStructure: analysisData ? Object.keys(analysisData) : 'none'
    });

    // Get AI model with function calling support
    const model = await getAIModelWithTools(log);
    if (!model) {
      log.error('AI model not available - cannot generate insights');
      return respond(503, {
        error: 'AI service temporarily unavailable',
        message: 'Unable to initialize AI model. Please try again later.',
        timestamp: new Date().toISOString()
      });
    }

    // Build enhanced prompt with context about available tools
    const initialPrompt = buildEnhancedPrompt(analysisData, systemId, customPrompt);

    // Execute multi-turn conversation with function calling
    const result = await executeWithFunctionCalling(
      model,
      initialPrompt,
      analysisData,
      systemId,
      customPrompt,
      log
    );

    timer.end();

    return respond(200, {
      success: true,
      insights: result.insights,
      toolCalls: result.toolCalls,
      usedFunctionCalling: result.usedFunctionCalling,
      analysisMode: 'ai-enhanced',
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Error generating insights', { error: error.message, stack: error.stack });
    timer.end();
    return respond(500, { 
      error: 'Failed to generate insights', 
      message: 'An error occurred while analyzing your battery data. Please try again.',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Execute Gemini conversation with intelligent context gathering
 * Since the current SDK version doesn't support native function calling,
 * we intelligently gather relevant context upfront based on the query.
 */
async function executeWithFunctionCalling(model, initialPrompt, analysisData, systemId, customPrompt, log) {
  const toolCalls = [];
  
  try {
    const { toolDefinitions, executeToolCall } = require('./utils/gemini-tools.cjs');
    
    // Intelligently gather context based on the query and system
    let enhancedPrompt = initialPrompt;
    
    if (systemId) {
      log.info('Gathering comprehensive context for system', { systemId });

      // Always get recent history for trend analysis
      try {
        const historyData = await executeToolCall('getSystemHistory', { 
          systemId, 
          limit: customPrompt ? CUSTOM_QUERY_HISTORY_LIMIT : DEFAULT_HISTORY_LIMIT
        }, log);
        
        if (historyData && !historyData.error && historyData.records && historyData.records.length > 0) {
          toolCalls.push({ name: 'getSystemHistory', args: { systemId, limit: historyData.records.length } });
          
          // Format historical data for better analysis
          const formattedHistory = historyData.records.map((r, idx) => ({
            timestamp: r.timestamp,
            datapoint: idx + 1,
            voltage: r.analysis?.overallVoltage,
            current: r.analysis?.current,
            soc: r.analysis?.stateOfCharge,
            capacity: r.analysis?.remainingCapacity,
            temperature: r.analysis?.temperature,
            power: r.analysis?.power
          })).filter(r => r.voltage || r.current || r.soc);
          
          enhancedPrompt += `\n\nHISTORICAL DATA (${formattedHistory.length} recent datapoints for trend analysis):
${JSON.stringify(formattedHistory, null, 2)}

IMPORTANT: Use this historical data to calculate:
- Charging rate changes: Compare SoC increases during charging periods
- Discharging rate changes: Compare SoC decreases during discharging periods
- Voltage degradation: Track voltage trends over time
- Capacity retention: Compare capacity values across uploads
- Usage patterns: Identify charging/discharging cycles and times
- Temperature correlation: Relate temperature to performance
`;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn('Failed to get system history', { error: error.message });
      }

      // Get system analytics for baseline comparison
      try {
        const analyticsData = await executeToolCall('getSystemAnalytics', { systemId }, log);
        if (analyticsData && !analyticsData.error) {
          toolCalls.push({ name: 'getSystemAnalytics', args: { systemId } });
          enhancedPrompt += `\n\nSYSTEM ANALYTICS (performance baselines and patterns):
${JSON.stringify(analyticsData, null, 2)}
`;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn('Failed to get system analytics', { error: error.message });
      }
      
      // For custom prompts requesting specific time ranges, parse and fetch accordingly
      if (customPrompt) {
        const daysMatch = customPrompt.match(/(\d+)\s*days?/i);
        const weeksMatch = customPrompt.match(/(\d+)\s*weeks?/i);
        
        if (daysMatch || weeksMatch) {
          const days = daysMatch ? parseInt(daysMatch[1]) : (weeksMatch ? parseInt(weeksMatch[1]) * 7 : 0);
          if (days > 0 && days <= MAX_DAYS_LOOKBACK) {
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
            
            log.info('Custom query requests specific time range', { days, startDate, endDate });
            
            try {
              const rangeHistory = await executeToolCall('getSystemHistory', {
                systemId,
                limit: MAX_TIME_RANGE_RECORDS,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
              }, log);
              
              if (rangeHistory && !rangeHistory.error && rangeHistory.records) {
                toolCalls.push({ 
                  name: 'getSystemHistory', 
                  args: { 
                    systemId, 
                    startDate: startDate.toISOString(), 
                    endDate: endDate.toISOString(), 
                    limit: MAX_TIME_RANGE_RECORDS 
                  }
                });
                
                enhancedPrompt += `\n\nREQUESTED TIME RANGE DATA (${days} days - ${rangeHistory.records.length} datapoints):
${JSON.stringify(rangeHistory.records.map(r => ({
  timestamp: r.timestamp,
  voltage: r.analysis?.overallVoltage,
  current: r.analysis?.current,
  soc: r.analysis?.stateOfCharge,
  capacity: r.analysis?.remainingCapacity,
  power: r.analysis?.power
})), null, 2)}

NOTE: Calculate energy deltas by comparing capacity/SoC changes between datapoints, especially during daylight hours for solar generation estimates.
`;
              }
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              log.warn('Failed to get historical range', { error: error.message });
            }
          }
        }
      }
    }

    // Generate insights with all gathered context
    log.info('Generating insights with comprehensive context', { 
      promptLength: enhancedPrompt.length,
      toolCallsCount: toolCalls.length 
    });
    
    const result = await model.generateContent(enhancedPrompt);
    const response = result.response;
    const finalText = response.text();

    // Ensure we have actual content
    if (!finalText || finalText.trim() === '') {
      throw new Error('AI model returned empty response');
    }

    log.info('Successfully generated insights', { 
      responseLength: finalText.length,
      toolCallsUsed: toolCalls.length
    });

    return {
      insights: {
        rawText: finalText,
        formattedText: formatInsightsResponse(finalText),
        healthStatus: 'Generated',
        performance: { trend: 'See analysis above' }
      },
      toolCalls,
      usedFunctionCalling: toolCalls.length > 0
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Error during insights generation', { error: error.message, stack: error.stack });

    // Provide user-friendly error message
    let userMessage = 'Failed to generate insights. Please try again.';
    if (error.message.includes('404') || error.message.includes('not found')) {
      userMessage = 'AI model temporarily unavailable. Please try again in a few moments.';
    } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
      userMessage = 'Request timed out. Your query may be too complex. Try asking for specific information.';
    } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
      userMessage = 'Service temporarily unavailable due to high demand. Please try again in a few minutes.';
    } else if (error.message.includes('blocked') || error.message.includes('SAFETY')) {
      userMessage = 'Response was blocked by safety filters. Please rephrase your question.';
    }

    return {
      insights: {
        rawText: `❌ Error: ${userMessage}`,
        formattedText: `❌ Error: ${userMessage}\n\nPlease try again with a more specific question.`,
        healthStatus: 'Error',
        performance: { trend: 'Error' }
      },
      toolCalls,
      usedFunctionCalling: false
    };
  }
}

/**
 * Format insights response for better display
 */
function formatInsightsResponse(text) {
  // If already formatted with headers, return as-is
  if (text.includes('═══') || text.includes('🔋 Battery System')) {
    return text;
  }
  
  // Otherwise, wrap in a nice format
  const lines = [];
  lines.push('═══════════════════════════════════════════════════');
  lines.push('🔋 BATTERY SYSTEM INSIGHTS');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');
  lines.push(text);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('═══════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Build enhanced prompt with context about available data and tools
 */
function buildEnhancedPrompt(analysisData, systemId, customPrompt) {
  // Build comprehensive system prompt
  let prompt = `You are an expert battery system analyst with access to powerful data querying tools.

CURRENT BATTERY SNAPSHOT:
${JSON.stringify(analysisData, null, 2)}

${systemId ? `SYSTEM ID: ${systemId}

You have access to the following tools to gather additional data for comprehensive analysis:
- getSystemHistory: Query historical battery records to analyze trends over time
- getWeatherData: Get weather conditions to correlate with performance
- getSolarEstimate: Get solar generation estimates
- getSystemAnalytics: Get detailed performance analytics and baselines

IMPORTANT: Use these tools intelligently based on what analysis you need to perform.
` : ''}

`;

  if (customPrompt) {
    // Custom query mode - guide the AI to use tools intelligently
    prompt += `USER QUESTION:
${customPrompt}

INSTRUCTIONS:
1. Analyze what data you need to answer this question comprehensively
2. Use the available tools to gather that data (e.g., for "kWh generated in past 7 days", request 7 days of history)
3. Calculate trends, deltas, and patterns from the data
4. Provide a detailed, data-driven answer

Focus on:
- Actual calculations from real data (charge/discharge deltas, capacity changes, etc.)
- Time-based trends and patterns
- Specific, actionable insights
- Clear explanations of your methodology

DO NOT include generic recommendations or placeholder suggestions.
`;
  } else {
    // Default comprehensive analysis mode
    prompt += `INSTRUCTIONS:
Provide a comprehensive battery health analysis with deep insights based on available data.

${systemId ? `Since you have access to historical data, analyze:
1. TREND ANALYSIS across multiple datapoints:
   - Calculate charging rate deltas between uploads
   - Calculate discharging rate deltas between uploads  
   - Track voltage degradation patterns over time
   - Compute real efficiency metrics from actual charge/discharge cycles
   - Analyze capacity retention trends across uploads
   - Identify usage patterns and anomalies

2. PERFORMANCE METRICS:
   - Current vs historical performance comparison
   - Degradation rates and projections
   - Efficiency trends (charge/discharge)
   - Peak usage times and patterns
   - Temperature correlation analysis

3. ACTIONABLE INSIGHTS:
   - Specific issues detected from trends
   - Preventive maintenance recommendations based on data
   - Optimization opportunities identified from usage patterns
   - Projected lifespan based on degradation trends

` : ''}
Focus on:
- Data-driven insights from actual measurements
- Trend analysis and pattern detection
- Specific, actionable recommendations
- Clear explanations with supporting data

DO NOT include:
- Generic placeholder recommendations
- Generator sizing suggestions
- Speculative advice without data support

Format your response clearly with sections and bullet points for readability.
`;
  }

  return prompt;
}

/**
 * Get AI model instance with proper configuration
 * Tries: gemini-2.5-flash → gemini-2.0-flash-exp → gemini-1.5-flash → null
 * @param {*} log - Logger instance
 * @returns {Promise<*>} Model instance or null
 */
async function getAIModelWithTools(log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log.error('GEMINI_API_KEY not configured');
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  // Try models in order of preference
  const modelsToTry = [
    { 
      name: 'gemini-2.5-flash', 
      description: 'latest stable model'
    },
    { 
      name: 'gemini-2.0-flash-exp', 
      description: 'experimental model'
    },
    { 
      name: 'gemini-1.5-flash', 
      description: 'fallback stable model'
    }
  ];

  for (const { name, description } of modelsToTry) {
    try {
      log.info(`Attempting to use ${name} (${description})`);
      
      const model = genAI.getGenerativeModel({
        model: name,
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192, // Increased from 2048 for complete responses
        }
      });

      // Model initialized - return immediately for faster response
      // Actual availability will be verified on first generateContent call
      log.info(`Model ${name} initialized successfully`);
      return model;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn(`Failed to initialize ${name}`, { error: error.message });
    }
  }

  // All models failed
  log.error('All AI models unavailable');
  return null;
}

/**
 * Helper to create HTTP response
 */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = handler;

