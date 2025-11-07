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
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');

// Constants for function calling
const MAX_TOOL_ITERATIONS = 10; // Maximum number of tool call rounds to prevent infinite loops
const DEFAULT_DAYS_LOOKBACK = 30; // Default time range for initial data
const ITERATION_TIMEOUT_MS = 25000; // 25 seconds per iteration (increased from 20)
const TOTAL_TIMEOUT_MS = 58000; // 58 seconds total (increased, leaving 2s buffer for Netlify's 60s limit)
const MAX_CONVERSATION_TOKENS = 60000; // Maximum tokens for conversation history (rough estimate)
const TOKENS_PER_CHAR = 0.25; // Rough estimate: 1 token ≈ 4 characters

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
      
      // CRITICAL: Start background processing but DON'T WAIT
      // This must complete BEFORE the handler returns so the Lambda environment stays alive
      const processingPromise = processInsightsInBackground(
        job.id, 
        analysisData, 
        systemId, 
        customPrompt, 
        log
      );
      
      // Store the promise reference to keep the event loop alive
      // Return response immediately but wait for processing to finish
      // This gives us the best of both worlds:
      // 1. Frontend gets jobId quickly
      // 2. Processing continues and completes
      processingPromise
        .then(() => {
          log.info('Background insights processing completed', { jobId: job.id });
        })
        .catch(err => {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error('Background insights processing failed', { 
            jobId: job.id,
            error: error.message,
            stack: error.stack
          });
        });
      
      // IMPORTANT: We return immediately to the client
      // But the event loop will stay alive due to the pending promise
      // Netlify will keep the function alive until all promises resolve or timeout
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
 * 
 * Includes intelligent conversation history management to prevent token overflow
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

      // Prune conversation history if it's getting too large
      const prunedHistory = pruneConversationHistory(conversationHistory, log);

      // Generate response from Gemini with timeout
      const iterationStartTime = Date.now();
      let response;
      
      try {
        // Build conversation text once per iteration
        // Note: Gemini 2.5 Flash doesn't yet support structured conversation history,
        // so we format as a single text prompt. This will be optimized when the SDK
        // supports native multi-turn conversations.
        const conversationText = prunedHistory.map(msg => 
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

        // Send tool result back to Gemini (in compact format)
        const compactResult = compactifyToolResult(toolResult, parsedResponse.tool_call, log);
        
        conversationHistory.push({
          role: 'assistant',
          content: JSON.stringify(parsedResponse)
        });
        conversationHistory.push({
          role: 'user',
          content: `Tool response from ${parsedResponse.tool_call}:\n${JSON.stringify(compactResult, null, 2)}`
        });

        log.debug('Tool result sent back to Gemini', {
          iteration: iterationCount,
          originalSize: JSON.stringify(toolResult).length,
          compactSize: JSON.stringify(compactResult).length
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
            formattedText: formatInsightsResponse(parsedResponse.final_answer, toolCallsExecuted),
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
          formattedText: formatInsightsResponse(responseText, toolCallsExecuted),
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
        formattedText: formatInsightsResponse(fallbackAnswer, toolCallsExecuted),
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
 * Prune conversation history to prevent token overflow
 * Keeps system prompt, recent context, and essential exchanges
 */
function pruneConversationHistory(history, log) {
  if (history.length <= 3) {
    return history; // Too short to prune
  }

  // Estimate token count
  const totalChars = history.reduce((sum, msg) => sum + msg.content.length, 0);
  const estimatedTokens = totalChars * TOKENS_PER_CHAR;

  if (estimatedTokens < MAX_CONVERSATION_TOKENS) {
    return history; // Within limits
  }

  log.info('Pruning conversation history', {
    originalMessages: history.length,
    estimatedTokens,
    maxTokens: MAX_CONVERSATION_TOKENS
  });

  // Strategy: Keep first message (system prompt), last 4 messages (recent context)
  // and most important middle exchanges
  const pruned = [];
  
  // Always keep first message (system prompt with initial data)
  pruned.push(history[0]);
  
  // Keep last 4 messages for immediate context
  const recentMessages = history.slice(-4);
  
  // Calculate how many middle messages we can keep
  const firstMsgTokens = history[0].content.length * TOKENS_PER_CHAR;
  const recentTokens = recentMessages.reduce((sum, msg) => sum + msg.content.length * TOKENS_PER_CHAR, 0);
  const remainingTokens = MAX_CONVERSATION_TOKENS - firstMsgTokens - recentTokens;
  
  // Sample middle messages if we have room
  const middleMessages = history.slice(1, -4);
  if (middleMessages.length > 0 && remainingTokens > 0) {
    // Keep every nth middle message to fit in remaining budget
    const avgMiddleTokens = middleMessages.reduce((sum, msg) => sum + msg.content.length * TOKENS_PER_CHAR, 0) / middleMessages.length;
    const canKeepMiddle = Math.floor(remainingTokens / avgMiddleTokens);
    
    if (canKeepMiddle > 0) {
      const step = Math.ceil(middleMessages.length / canKeepMiddle);
      for (let i = 0; i < middleMessages.length; i += step) {
        pruned.push(middleMessages[i]);
      }
    }
  }
  
  // Add recent messages
  pruned.push(...recentMessages);

  const prunedChars = pruned.reduce((sum, msg) => sum + msg.content.length, 0);
  const prunedTokens = prunedChars * TOKENS_PER_CHAR;

  log.info('Conversation history pruned', {
    originalMessages: history.length,
    prunedMessages: pruned.length,
    originalTokens: estimatedTokens,
    prunedTokens,
    savedTokens: estimatedTokens - prunedTokens
  });

  return pruned;
}

/**
 * Compactify tool results to reduce token usage
 * For large data responses, summarize or sample intelligently
 */
function compactifyToolResult(result, toolName, log) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  // If result has a large data array, consider summarizing
  if (result.data && Array.isArray(result.data) && result.data.length > 100) {
    log.info('Compactifying large tool result', {
      toolName,
      originalSize: result.data.length
    });

    // For very large datasets, provide summary statistics instead of all data
    if (result.data.length > 200) {
      const compactData = result.data.filter((_, i) => i % Math.ceil(result.data.length / 100) === 0);
      return {
        ...result,
        data: compactData,
        note: `Dataset sampled from ${result.data.length} to ${compactData.length} points for optimization. Use more specific time ranges or metrics if you need more detail.`
      };
    }
  }

  return result;
}

/**
 * Format insights response for better display with off-grid context
 */
function formatInsightsResponse(text, toolCalls = [], confidence = null) {
  // If already formatted with headers, return as-is
  if (text.includes('═══') || text.includes('🔋')) {
    return text;
  }
  
  // Calculate confidence if not provided
  if (confidence === null && toolCalls) {
    confidence = calculateConfidence(text, toolCalls);
  }
  
  // Otherwise, wrap in off-grid intelligence format
  const lines = [];
  lines.push('═══════════════════════════════════════════════════');
  lines.push('🔋 OFF-GRID ENERGY INTELLIGENCE');
  lines.push('═══════════════════════════════════════════════════');
  
  if (confidence !== null) {
    const confidenceIcon = confidence >= 80 ? '✓' : confidence >= 60 ? '~' : '!';
    lines.push(`📊 Analysis Confidence: ${confidenceIcon} ${confidence}%`);
  }
  
  if (toolCalls && toolCalls.length > 0) {
    lines.push(`🔍 Data Sources Used: ${toolCalls.length} tool queries`);
    
    // Show which analysis types were used
    const toolTypes = [...new Set(toolCalls.map(t => t.name))];
    const hasPredict = toolTypes.some(t => t.includes('predict'));
    const hasPattern = toolTypes.some(t => t.includes('pattern'));
    const hasBudget = toolTypes.some(t => t.includes('budget'));
    
    const analysisTypes = [];
    if (hasPredict) analysisTypes.push('Predictive');
    if (hasPattern) analysisTypes.push('Pattern');
    if (hasBudget) analysisTypes.push('Budget');
    if (analysisTypes.length > 0) {
      lines.push(`🧠 Analysis Type: ${analysisTypes.join(', ')}`);
    }
  }
  
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
 * Calculate confidence score for insights
 */
function calculateConfidence(insightsText, toolCalls) {
  let confidence = 100;
  
  // Reduce confidence based on factors
  if (!toolCalls || toolCalls.length === 0) {
    confidence -= 15; // No additional data requested
  }
  
  // Check for uncertainty indicators in text
  const uncertaintyPhrases = [
    'insufficient data',
    'limited data',
    'cannot determine',
    'unable to calculate',
    'not enough',
    'unavailable'
  ];
  
  for (const phrase of uncertaintyPhrases) {
    if (insightsText.toLowerCase().includes(phrase)) {
      confidence -= 20;
      break;
    }
  }
  
  // Check for prediction/analysis quality indicators
  const qualityIndicators = [
    'high confidence',
    'strong correlation',
    'consistent pattern',
    'reliable data'
  ];
  
  for (const indicator of qualityIndicators) {
    if (insightsText.toLowerCase().includes(indicator)) {
      confidence += 5;
      break;
    }
  }
  
  // Bonus for using advanced tools
  if (toolCalls && toolCalls.length > 0) {
    const advancedTools = toolCalls.filter(t => 
      t.name.includes('predict') || 
      t.name.includes('pattern') || 
      t.name.includes('budget')
    );
    if (advancedTools.length > 0) {
      confidence += 10;
    }
  }
  
  // Ensure confidence is between 0 and 100
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

/**
 * Build enhanced prompt with system instructions for function calling
 * Uses compact statistical summaries for initial data to prevent token overflow
 */
async function buildEnhancedPrompt(analysisData, systemId, customPrompt, log) {
  const { toolDefinitions } = require('./utils/gemini-tools.cjs');

  // Build system prompt with off-grid intelligence and function calling instructions
  let prompt = `You are an expert off-grid energy systems analyst with deep knowledge of battery management, solar integration, and energy storage optimization.

**YOUR EXPERTISE:**
- Battery degradation patterns and lifespan prediction
- Solar charging efficiency and weather correlation
- Energy consumption analysis and demand forecasting
- Off-grid system optimization and backup planning
- Predictive maintenance and anomaly detection

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

3. **STRATEGIC DATA REQUESTS**: When requesting data, be efficient:
   - For specific metric queries, request ONLY that metric
   - For trend analysis, use "hourly_avg" or "daily_avg" granularity
   - For predictive analysis, use predict_battery_trends tool
   - For usage patterns, use analyze_usage_patterns tool
   - For scenario planning, use calculate_energy_budget tool

**AVAILABLE TOOLS:**

${JSON.stringify(toolDefinitions, null, 2)}

**CURRENT BATTERY SNAPSHOT:**
${JSON.stringify(analysisData, null, 2)}
`;

  // Load initial 30 days of data as COMPACT SUMMARY (not full data)
  let initialHistoricalData = null;
  if (systemId) {
    try {
      const { getHourlyAveragedData, createCompactSummary } = require('./utils/data-aggregation.cjs');
      
      log.info('Loading initial 30 days as compact summary', { systemId });
      const hourlyData = await getHourlyAveragedData(systemId, DEFAULT_DAYS_LOOKBACK, log);
      
      if (hourlyData && hourlyData.length > 0) {
        // Use compact summary instead of full data
        initialHistoricalData = createCompactSummary(hourlyData, log);
        
        prompt += `

**SYSTEM ID:** ${systemId}

**HISTORICAL DATA SUMMARY (past ${DEFAULT_DAYS_LOOKBACK} days):**
${JSON.stringify(initialHistoricalData, null, 2)}

**Note**: This is a statistical summary of ${hourlyData.length} hours of data. It includes:
- Time range and data coverage
- Min/max/avg/latest values for all key metrics
- Sample data points (first, middle, last) for trend context

If you need more detailed data for specific time ranges or metrics, use the request_bms_data tool with:
- Specific metric (e.g., "temperature", "soc", "current")
- Targeted time range
- Appropriate granularity ("hourly_avg" for trends, "daily_avg" for long periods)
`;
        
        log.info('Compact historical summary included in prompt', {
          hours: hourlyData.length,
          summarySize: JSON.stringify(initialHistoricalData).length,
          fullDataSize: JSON.stringify(hourlyData).length,
          compressionRatio: (JSON.stringify(hourlyData).length / JSON.stringify(initialHistoricalData).length).toFixed(2)
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
    // Custom query mode with off-grid analysis framework
    prompt += `**USER QUESTION:**
${customPrompt}

**ANALYSIS FRAMEWORK:**
1. **Understand the Question**: Parse what specific insight the user needs
2. **Assess Data Requirements**: Determine what historical data, patterns, or predictions are needed
3. **Strategic Tool Usage**:
   - For predictions → use predict_battery_trends (capacity degradation, efficiency, lifetime)
   - For usage patterns → use analyze_usage_patterns (daily/weekly/seasonal, anomalies)
   - For planning/scenarios → use calculate_energy_budget (current/worst-case/average/emergency)
   - For specific metrics → use request_bms_data (targeted time ranges and metrics)
4. **Deep Analysis**: Apply statistical methods, pattern recognition, forecasting
5. **Off-Grid Context**: Consider solar availability, weather impacts, backup needs
6. **Actionable Insights**: Provide specific, data-driven recommendations with confidence levels

**OFF-GRID ANALYSIS PATTERNS:**
- **Energy Sufficiency**: Compare consumption vs generation with weather factors
- **System Health**: Predict maintenance needs, identify degradation trends
- **Optimization**: Suggest load shifting, solar expansion, backup strategies
- **Emergency Planning**: Model worst-case scenarios and backup requirements

**TOOL SELECTION EXAMPLES:**
- "How long will my battery last?" → predict_battery_trends with metric="lifetime"
- "When do I use the most power?" → analyze_usage_patterns with patternType="daily"
- "Can I run a fridge 24/7?" → calculate_energy_budget with scenario="current", then analyze if surplus exists
- "Should I add solar panels?" → calculate_energy_budget with scenario="current" to see deficit
- "Any unusual behavior?" → analyze_usage_patterns with patternType="anomalies"

**RESPONSE REQUIREMENTS:**
- Use tool_call for data requests (JSON only)
- Use final_answer for complete analysis (include confidence levels when making predictions)
- Always explain methodology and data sources
- Provide specific numbers and timeframes
- Consider off-grid living context (self-sufficiency, backup power, seasonal variations)
- Always respond with valid JSON (either tool_call or final_answer)
`;
  } else {
    // Default comprehensive analysis mode with off-grid focus
    prompt += `**YOUR TASK:**
Provide a comprehensive off-grid energy system analysis with deep insights based on available data.

**ANALYSIS AREAS:**

1. **SYSTEM HEALTH & DEGRADATION**:
   - Compare current values to historical min/max/avg
   - Identify degradation patterns (capacity loss, efficiency decline)
   - Use predict_battery_trends for lifespan forecasting if system has sufficient history
   - Temperature patterns and thermal management
   - Cell balance and voltage consistency

2. **ENERGY FLOW & SUFFICIENCY**:
   - Solar charging patterns and efficiency
   - Consumption patterns (use analyze_usage_patterns for daily/weekly trends)
   - Energy balance (generation vs consumption)
   - Use calculate_energy_budget to assess solar sufficiency
   - Identify opportunities for load optimization

3. **OFF-GRID OPTIMIZATION**:
   - Peak usage times and load shifting opportunities
   - Solar utilization efficiency
   - Battery autonomy (days of backup power)
   - Seasonal variations and planning
   - Emergency backup requirements

4. **PREDICTIVE INSIGHTS**:
   - Capacity degradation trends and replacement timeline
   - System lifespan projection
   - Anomaly detection for preventive maintenance
   - Weather-dependent performance patterns

**STRATEGIC TOOL USAGE**:
- Use predict_battery_trends for degradation analysis and lifespan estimation
- Use analyze_usage_patterns to identify daily/weekly consumption cycles
- Use calculate_energy_budget to assess solar sufficiency and backup needs
- Use request_bms_data only for specific metric queries not covered by other tools

**GUIDELINES:**
- The summary data includes min/max/avg/latest for all metrics - use these for initial assessment
- Leverage predictive and pattern analysis tools for deeper insights
- Focus on off-grid specific concerns: self-sufficiency, backup power, seasonal planning
- Provide specific, actionable recommendations with data support
- Include confidence levels for predictions
- Consider worst-case scenarios for emergency preparedness
- Always respond with valid JSON (either tool_call or final_answer)

**Note**: You have access to ${initialHistoricalData ? initialHistoricalData.timeRange.hours : 0} hours of statistical data. Use the new predictive and pattern analysis tools for comprehensive off-grid intelligence.
`;
  }

  return prompt;
}

/**
 * Get AI model instance with proper configuration
 * Uses standard production models only (no experimental)
 * Tries: gemini-2.5-flash → gemini-1.5-flash → gemini-1.5-pro
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

  // Try models in order of preference - PRODUCTION MODELS ONLY
  const modelsToTry = [
    { 
      name: 'gemini-2.5-flash', 
      description: 'latest stable model with function calling'
    },
    { 
      name: 'gemini-1.5-flash', 
      description: 'stable fallback model'
    },
    { 
      name: 'gemini-1.5-pro', 
      description: 'advanced fallback model'
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

