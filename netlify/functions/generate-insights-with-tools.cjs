/**
 * Generate Insights - Enhanced AI-Powered Analysis with True Function Calling
 * 
 * This is the primary insights generation endpoint that uses Gemini 2.5 Flash with
 * TRUE function calling capabilities to provide comprehensive, data-driven analysis.
 * 
 * **What it does:**
 * 1. Accepts battery measurement data and system context
 * 2. Provides Gemini with structured tool definitions (following Gemini's recommended pattern)
 * 3. Implements multi-turn conversation loop where Gemini can:
 *    - Request specific BMS data with customizable time ranges and granularity
 *    - Query weather, solar, and analytics data
 *    - Receive data and continue analysis
 * 4. Validates tool call requests and responses using JSON schemas
 * 5. Returns comprehensive, data-driven insights without generic recommendations
 * 
 * **Function Calling Flow:**
 * 1. User sends initial query + current snapshot
 * 2. Gemini analyzes and may respond with tool_call (JSON) if more data needed
 * 3. Backend executes tool call and sends results back to Gemini
 * 4. Loop continues until Gemini responds with final_answer
 * 5. Return final insights to user
 * 
 * @module netlify/functions/generate-insights-with-tools
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createInsightsJob, ensureIndexes } = require('./utils/insights-jobs.cjs');
const { generateInitialSummary } = require('./utils/insights-summary.cjs');

// Constants for function calling
const MAX_TOOL_ITERATIONS = 10; // Maximum number of tool call rounds to prevent infinite loops
const DEFAULT_DAYS_LOOKBACK = 30; // Default time range for initial data
const ITERATION_TIMEOUT_MS = 20000; // 20 seconds per iteration
const TOTAL_TIMEOUT_MS = 55000; // 55 seconds total (under Netlify's 60s limit for function execution)

/**
 * Main handler for insights generation with function calling
 * 
 * Supports two modes:
 * 1. Synchronous (legacy): ?sync=true or ?mode=sync - Returns insights immediately (up to 55s)
 * 2. Background (default): Starts background job, returns jobId for polling
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
    
    // Check if sync mode is requested (for backward compatibility)
    const queryParams = event.queryStringParameters || {};
    const isSyncMode = queryParams.sync === 'true' || queryParams.mode === 'sync' || body.sync === true;

    log.info('Starting enhanced AI insights generation', {
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      dataStructure: analysisData ? Object.keys(analysisData) : 'none',
      mode: isSyncMode ? 'sync' : 'background'
    });

    // BACKGROUND MODE (default): Create job and trigger background processing
    if (!isSyncMode) {
      // Ensure database indexes (safe to call multiple times)
      await ensureIndexes(log).catch(err => {
        log.warn('Failed to ensure indexes', { error: err.message });
        // Continue anyway
      });
      
      // Generate initial summary
      const initialSummary = await generateInitialSummary(analysisData, systemId, log);
      
      // Create job
      const job = await createInsightsJob({
        analysisData,
        systemId,
        customPrompt,
        initialSummary
      }, log);
      
      log.info('Insights job created', { jobId: job.id });
      
      // Trigger background function
      try {
        const backgroundUrl = `${process.env.URL || ''}/.netlify/functions/generate-insights-background`;
        
        log.info('Invoking background function', { 
          backgroundUrl,
          jobId: job.id
        });
        
        // Fire and forget - don't wait for response
        fetch(backgroundUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-netlify-background': 'true'
          },
          body: JSON.stringify({ jobId: job.id })
        }).catch(err => {
          log.error('Failed to invoke background function', { 
            error: err.message,
            jobId: job.id 
          });
        });
        
      } catch (invokeError) {
        log.error('Error invoking background function', { 
          error: invokeError.message,
          jobId: job.id
        });
        // Job is created, so frontend can still poll for status
      }
      
      timer.end();
      
      // Return immediate response with jobId and initial summary
      return respond(200, {
        success: true,
        jobId: job.id,
        status: 'processing',
        initialSummary: job.initialSummary,
        message: 'Background processing started. Poll for status updates.',
        analysisMode: 'background',
        timestamp: new Date().toISOString()
      });
    }

    // SYNC MODE (legacy): Execute immediately and return results
    log.info('Using synchronous mode (legacy)');
    
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
    const initialPrompt = await buildEnhancedPrompt(analysisData, systemId, customPrompt, log);

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
      analysisMode: 'sync',
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
 * Extract and distill key trending metrics from historical data
 * This creates a compact summary instead of sending all raw data to Gemini
 */
/**
 * Execute Gemini conversation with TRUE function calling loop
 * Implements the pattern described by Gemini where:
 * 1. AI receives system prompt + data
 * 2. AI responds with either tool_call OR final_answer
 * 3. If tool_call, execute it and loop back
 * 4. If final_answer, return to user
 */
async function executeWithFunctionCalling(model, initialPrompt, analysisData, systemId, customPrompt, log) {
  const conversationHistory = [];
  const toolCallsExecuted = [];
  let iterationCount = 0;
  
  const startTime = Date.now();
  
  log.info('Starting function calling loop', { 
    hasSystemId: !!systemId, 
    hasCustomPrompt: !!customPrompt 
  });

  try {
    // Initial message to Gemini
    conversationHistory.push({
      role: 'user',
      content: initialPrompt
    });

    // Multi-turn conversation loop
    while (iterationCount < MAX_TOOL_ITERATIONS) {
      iterationCount++;
      
      // Check total timeout
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > TOTAL_TIMEOUT_MS) {
        log.warn('Function calling loop exceeded total timeout', {
          elapsedTime,
          iterationCount,
          toolCallsExecuted: toolCallsExecuted.length
        });
        throw new Error(`Analysis exceeded time limit (${TOTAL_TIMEOUT_MS / 1000}s). Try a simpler question or smaller time range.`);
      }

      log.info(`Function calling iteration ${iterationCount}`, {
        conversationLength: conversationHistory.length,
        elapsedTime: `${elapsedTime}ms`
      });

      // Generate response from Gemini with timeout
      const iterationStartTime = Date.now();
      let response;
      
      try {
        // Build conversation text once per iteration
        // Note: Gemini 2.5 Flash doesn't yet support structured conversation history,
        // so we format as a single text prompt. This will be optimized when the SDK
        // supports native multi-turn conversations.
        const conversationText = conversationHistory.map(msg => 
          `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join('\n\n');

        const responsePromise = model.generateContent(conversationText);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Iteration timeout')), ITERATION_TIMEOUT_MS)
        );

        response = await Promise.race([responsePromise, timeoutPromise]);
      } catch (error) {
        if (error.message === 'Iteration timeout') {
          log.warn('Gemini iteration timed out', { 
            iteration: iterationCount,
            duration: Date.now() - iterationStartTime
          });
          throw new Error('AI processing took too long. Try simplifying your question.');
        }
        throw error;
      }

      const iterationDuration = Date.now() - iterationStartTime;
      log.debug('Gemini response received', {
        iteration: iterationCount,
        duration: `${iterationDuration}ms`
      });

      const responseText = response.response.text();
      
      // Try to parse as JSON - handle various formatting issues
      let parsedResponse;
      try {
        // First, try to parse as-is (trimmed)
        parsedResponse = JSON.parse(responseText.trim());
      } catch {
        // If that fails, try to extract JSON from markdown code blocks
        const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          try {
            parsedResponse = JSON.parse(jsonMatch[1].trim());
          } catch {
            // Still not valid JSON, treat as plain text
            parsedResponse = null;
          }
        } else {
          // Try to find JSON object in the text
          const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonObjectMatch) {
            try {
              parsedResponse = JSON.parse(jsonObjectMatch[0]);
            } catch {
              // Not valid JSON, treat as plain text
              parsedResponse = null;
            }
          } else {
            // No JSON found, treat as plain text
            parsedResponse = null;
          }
        }
      }

      // Check if it's a tool call
      if (parsedResponse && parsedResponse.tool_call) {
        log.info('Gemini requested tool call', {
          toolName: parsedResponse.tool_call,
          parameters: parsedResponse.parameters,
          iteration: iterationCount
        });

        // Validate tool call structure
        if (!parsedResponse.parameters) {
          throw new Error('Tool call missing parameters object');
        }

        // Execute the tool
        const { toolDefinitions, executeToolCall } = require('./utils/gemini-tools.cjs');
        const toolResult = await executeToolCall(
          parsedResponse.tool_call,
          parsedResponse.parameters,
          log
        );

        toolCallsExecuted.push({
          name: parsedResponse.tool_call,
          parameters: parsedResponse.parameters,
          iteration: iterationCount
        });

        // Check if tool execution failed
        if (toolResult.error) {
          log.warn('Tool execution returned error', { 
            toolName: parsedResponse.tool_call,
            error: toolResult.message 
          });
          
          // Send error back to Gemini so it can adjust
          conversationHistory.push({
            role: 'assistant',
            content: JSON.stringify(parsedResponse)
          });
          conversationHistory.push({
            role: 'user',
            content: `Tool execution error: ${toolResult.message}. Please adjust your request or provide an answer with available data.`
          });
          continue;
        }

        // Send tool result back to Gemini
        conversationHistory.push({
          role: 'assistant',
          content: JSON.stringify(parsedResponse)
        });
        conversationHistory.push({
          role: 'user',
          content: `Tool response from ${parsedResponse.tool_call}:\n${JSON.stringify(toolResult, null, 2)}`
        });

        log.debug('Tool result sent back to Gemini', {
          iteration: iterationCount,
          resultSize: JSON.stringify(toolResult).length
        });

        // Continue loop for next iteration
        continue;
      }

      // Check if it's a final answer
      if (parsedResponse && parsedResponse.final_answer) {
        log.info('Received final answer from Gemini', {
          iterations: iterationCount,
          toolCallsUsed: toolCallsExecuted.length,
          answerLength: parsedResponse.final_answer.length
        });

        return {
          insights: {
            rawText: parsedResponse.final_answer,
            formattedText: formatInsightsResponse(parsedResponse.final_answer),
            healthStatus: 'Generated',
            performance: { trend: 'See analysis above' }
          },
          toolCalls: toolCallsExecuted,
          usedFunctionCalling: toolCallsExecuted.length > 0,
          iterations: iterationCount
        };
      }

      // No JSON structure, treat as final answer (plain text)
      log.info('Received plain text response (treating as final answer)', {
        iterations: iterationCount,
        toolCallsUsed: toolCallsExecuted.length
      });

      return {
        insights: {
          rawText: responseText,
          formattedText: formatInsightsResponse(responseText),
          healthStatus: 'Generated',
          performance: { trend: 'See analysis above' }
        },
        toolCalls: toolCallsExecuted,
        usedFunctionCalling: toolCallsExecuted.length > 0,
        iterations: iterationCount
      };
    }

    // Max iterations reached
    log.warn('Max iterations reached without final answer', {
      maxIterations: MAX_TOOL_ITERATIONS,
      toolCallsExecuted: toolCallsExecuted.length
    });

    // Get last assistant message as best-effort answer
    const lastAssistantMsg = conversationHistory
      .filter(msg => msg.role === 'assistant')
      .pop();

    const fallbackAnswer = lastAssistantMsg 
      ? `Analysis incomplete (max iterations reached). Partial results:\n\n${lastAssistantMsg.content}`
      : 'Analysis could not be completed within iteration limit. Please try a simpler question.';

    return {
      insights: {
        rawText: fallbackAnswer,
        formattedText: formatInsightsResponse(fallbackAnswer),
        healthStatus: 'Incomplete',
        performance: { trend: 'Analysis incomplete' }
      },
      toolCalls: toolCallsExecuted,
      usedFunctionCalling: toolCallsExecuted.length > 0,
      iterations: iterationCount,
      warning: 'Max iterations reached'
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Error during function calling loop', { 
      error: error.message, 
      stack: error.stack,
      iteration: iterationCount,
      toolCallsExecuted: toolCallsExecuted.length
    });

    // Provide user-friendly error message
    let userMessage = 'Failed to generate insights. Please try again.';
    let technicalDetails = error.message;
    
    if (error.message.includes('404') || error.message.includes('not found')) {
      userMessage = 'AI model temporarily unavailable. Please try again in a few moments.';
    } else if (error.message.includes('timeout') || error.message.includes('timed out') || error.message.includes('time limit')) {
      userMessage = error.message; // Use our detailed timeout message
    } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
      userMessage = 'Service temporarily unavailable due to high demand. Please try again in a few minutes.';
    } else if (error.message.includes('blocked') || error.message.includes('SAFETY')) {
      userMessage = 'Response was blocked by safety filters. Please rephrase your question.';
    }
    
    log.warn('User-friendly error message generated', { userMessage, technicalDetails });

    return {
      insights: {
        rawText: `❌ Error: ${userMessage}`,
        formattedText: `❌ Error: ${userMessage}\n\nTechnical details: ${technicalDetails}`,
        healthStatus: 'Error',
        performance: { trend: 'Error' }
      },
      toolCalls: toolCallsExecuted,
      usedFunctionCalling: false,
      iterations: iterationCount,
      error: true
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
 * Build enhanced prompt with system instructions for function calling
 */
async function buildEnhancedPrompt(analysisData, systemId, customPrompt, log) {
  const { toolDefinitions } = require('./utils/gemini-tools.cjs');

  // Build system prompt with function calling instructions
  let prompt = `You are a BMS (Battery Management System) data analyst. Your goal is to answer the user's question based on the data provided.

You will receive an initial data set (current battery snapshot and recent historical data if available).

**IMPORTANT INSTRUCTIONS FOR DATA REQUESTS:**

1. If you can answer the user's question with the data provided, you **must** respond with a JSON object containing ONLY a \`final_answer\` key:
   {
     "final_answer": "Your detailed analysis here..."
   }

2. If the data is insufficient, you **must** request more data by responding with ONLY a JSON object that calls a tool. Do not add any conversational text. Format:
   {
     "tool_call": "tool_name",
     "parameters": {
       "param1": "value1",
       "param2": "value2"
     }
   }

**AVAILABLE TOOLS:**

${JSON.stringify(toolDefinitions, null, 2)}

**CURRENT BATTERY SNAPSHOT:**
${JSON.stringify(analysisData, null, 2)}
`;

  // Load initial 30 days of hourly data if systemId is provided
  let initialHistoricalData = null;
  if (systemId) {
    try {
      const { getHourlyAveragedData, formatHourlyDataForAI } = require('./utils/data-aggregation.cjs');
      
      log.info('Loading initial 30 days of hourly averaged data', { systemId });
      const hourlyData = await getHourlyAveragedData(systemId, DEFAULT_DAYS_LOOKBACK, log);
      
      if (hourlyData && hourlyData.length > 0) {
        initialHistoricalData = formatHourlyDataForAI(hourlyData, log);
        
        prompt += `

**SYSTEM ID:** ${systemId}

**INITIAL HISTORICAL DATA (${DEFAULT_DAYS_LOOKBACK} days of hourly averages):**
${JSON.stringify(initialHistoricalData, null, 2)}

Note: This is ${hourlyData.length} hours of data. If you need different metrics, time ranges, or granularity, use the request_bms_data tool.
`;
        
        log.info('Initial historical data included in prompt', {
          hours: hourlyData.length,
          dataSize: JSON.stringify(initialHistoricalData).length
        });
      } else {
        prompt += `

**SYSTEM ID:** ${systemId}

No historical data found for the past ${DEFAULT_DAYS_LOOKBACK} days. You can use request_bms_data to query different time ranges.
`;
        log.warn('No historical data found for initial load', { systemId, daysBack: DEFAULT_DAYS_LOOKBACK });
      }
    } catch (error) {
      log.error('Failed to load initial historical data', {
        error: error.message,
        systemId
      });
      prompt += `

**SYSTEM ID:** ${systemId}

Historical data temporarily unavailable. You can use request_bms_data tool to query historical data if needed.
`;
    }
  } else {
    prompt += `

No system ID provided - limited to current snapshot analysis. If you need historical data, it must be provided by the user.
`;
  }

  prompt += '\n\n';

  if (customPrompt) {
    // Custom query mode
    prompt += `**USER QUESTION:**
${customPrompt}

**YOUR TASK:**
1. Analyze what data you need to answer this question comprehensively
2. If you need more data than provided, use request_bms_data tool with specific parameters
3. Calculate trends, deltas, and patterns from the data
4. Provide a detailed, data-driven answer in the final_answer JSON

**GUIDELINES:**
- Use actual calculations from real data (charge/discharge deltas, capacity changes, energy calculations)
- Be specific with time-based trends and patterns
- Provide actionable insights based on the data
- Show your methodology and calculations
- DO NOT include generic recommendations without data support
- Always respond with valid JSON (either tool_call or final_answer)
`;
  } else {
    // Default comprehensive analysis mode
    prompt += `**YOUR TASK:**
Provide a comprehensive battery health analysis with deep insights based on available data.

**ANALYSIS AREAS:**

1. **TREND ANALYSIS** (use historical data provided):
   - Calculate charging rate deltas over time
   - Calculate discharging rate deltas over time  
   - Track voltage degradation patterns
   - Compute real efficiency metrics from charge/discharge cycles
   - Analyze capacity retention trends
   - Identify usage patterns and anomalies

2. **PERFORMANCE METRICS:**
   - Current vs historical performance comparison
   - Degradation rates and projections
   - Efficiency trends (charge/discharge)
   - Peak usage times and patterns
   - Temperature correlation analysis

3. **ACTIONABLE INSIGHTS:**
   - Specific issues detected from trends
   - Preventive maintenance recommendations based on data
   - Optimization opportunities from usage patterns
   - Projected lifespan based on degradation trends

**GUIDELINES:**
- Focus on data-driven insights from actual measurements
- Use trend analysis and pattern detection
- Provide specific, actionable recommendations
- Clear explanations with supporting data
- DO NOT include generic placeholder recommendations
- DO NOT suggest generator sizing without data support
- Always respond with valid JSON (either tool_call or final_answer)

If you need more historical data for comprehensive analysis, you can use request_bms_data tool.
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

