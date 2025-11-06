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
const { toolDefinitions, executeToolCall } = require('./utils/gemini-tools.cjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MAX_TOOL_ITERATIONS = 10; // Allow more iterations for complex queries

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
 * Execute Gemini conversation with proper function calling support
 * This uses Gemini's native function calling API to allow the AI to intelligently
 * request historical data, weather info, solar estimates, and analytics as needed.
 */
async function executeWithFunctionCalling(model, initialPrompt, analysisData, systemId, customPrompt, log) {
  const toolCalls = [];
  let iteration = 0;
  
  try {
    // Start the chat with function calling enabled
    const chat = model.startChat({
      history: [],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192, // Increased from 2048 for complete responses
      },
      tools: [{
        functionDeclarations: toolDefinitions.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }))
      }]
    });

    log.info('Starting function calling conversation');
    
    // Send initial prompt
    let result = await chat.sendMessage(initialPrompt);
    let response = result.response;
    
    // Handle multi-turn function calling
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      
      const functionCalls = response.functionCalls();
      
      // If no function calls, we have the final response
      if (!functionCalls || functionCalls.length === 0) {
        const finalText = response.text();
        
        if (!finalText || finalText.trim() === '') {
          throw new Error('AI model returned empty response');
        }
        
        log.info('Function calling completed', { 
          iterations: iteration,
          toolCallsCount: toolCalls.length,
          responseLength: finalText.length 
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
      }
      
      // Execute each function call
      const functionResponses = [];
      
      for (const functionCall of functionCalls) {
        const { name, args } = functionCall;
        log.info('AI requested tool execution', { tool: name, args, iteration });
        
        toolCalls.push({ name, args, iteration });
        
        try {
          const toolResult = await executeToolCall(name, args, log);
          functionResponses.push({
            name,
            response: toolResult
          });
          
          log.info('Tool execution successful', { tool: name, resultSize: JSON.stringify(toolResult).length });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error('Tool execution failed', { tool: name, error: error.message });
          functionResponses.push({
            name,
            response: { 
              error: true, 
              message: `Failed to execute ${name}: ${error.message}` 
            }
          });
        }
      }
      
      // Send function results back to the model
      result = await chat.sendMessage(functionResponses);
      response = result.response;
    }
    
    // If we hit max iterations, return what we have
    log.warn('Max function calling iterations reached', { maxIterations: MAX_TOOL_ITERATIONS });
    const finalText = response.text() || 'Analysis incomplete due to complexity. Please try a more specific query.';
    
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
    log.error('Error during function calling', { error: error.message, stack: error.stack });

    // Provide user-friendly error message
    let userMessage = 'Failed to generate insights. Please try again.';
    if (error.message.includes('404') || error.message.includes('not found')) {
      userMessage = 'AI model temporarily unavailable. Please try again in a few moments.';
    } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
      userMessage = 'Request timed out. Your query may be too complex. Try asking for specific information.';
    } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
      userMessage = 'Service temporarily unavailable due to high demand. Please try again in a few minutes.';
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
 * Get AI model instance with function calling support
 * Tries: gemini-2.0-flash-exp (supports function calling) → gemini-2.5-flash → null
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

  // Try models in order of preference - experimental models with function calling first
  const modelsToTry = [
    { 
      name: 'gemini-2.0-flash-exp', 
      description: 'experimental model with function calling',
      supportsTools: true 
    },
    { 
      name: 'gemini-2.5-flash', 
      description: 'latest stable model',
      supportsTools: true 
    },
    { 
      name: 'gemini-1.5-flash', 
      description: 'fallback stable model',
      supportsTools: true 
    }
  ];

  for (const { name, description, supportsTools } of modelsToTry) {
    try {
      log.info(`Attempting to use ${name} (${description})`);
      
      const model = genAI.getGenerativeModel({
        model: name,
        // Don't set generation config here - it will be set per chat
      });

      // Quick test to verify model is available
      try {
        await model.generateContent('test');
        log.info(`Model ${name} verified and ready`);
        return model;
      } catch (testErr) {
        const testError = testErr instanceof Error ? testErr : new Error(String(testErr));
        // If it's a 404 or not found error, try next model
        if (testError.message.includes('404') || 
            testError.message.includes('not found') ||
            testError.message.includes('does not exist')) {
          log.warn(`Model ${name} not available (404), trying next fallback`, { error: testError.message });
          continue;
        }
        // For other errors, the model exists but test failed - return it anyway
        log.info(`Model ${name} initialized (test failed but model exists)`);
        return model;
      }
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

