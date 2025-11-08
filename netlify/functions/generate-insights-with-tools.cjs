// @ts-nocheck

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
const { createInsightsJob, ensureIndexes, failJob } = require('./utils/insights-jobs.cjs');
const { generateInitialSummary } = require('./utils/insights-summary.cjs');
const { buildGuruPrompt } = require('./utils/insights-guru.cjs');
const { executeToolCall } = require('./utils/gemini-tools.cjs');

// Constants for function calling
const MAX_TOOL_ITERATIONS = 10; // Maximum number of tool call rounds to prevent infinite loops
const ITERATION_TIMEOUT_MS = 25000; // 25 seconds per iteration (increased from 20)
const TOTAL_TIMEOUT_MS = 58000; // 58 seconds total (increased, leaving 2s buffer for Netlify's 60s limit)
const MAX_CONVERSATION_TOKENS = 60000; // Maximum tokens for conversation history (rough estimate)
const TOKENS_PER_CHAR = 0.25; // Rough estimate: 1 token ≈ 4 characters
const BACKGROUND_FUNCTION_NAME = 'generate-insights-background';

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

    const queryParams = event.queryStringParameters || {};
    const runMode = resolveRunMode(queryParams, body, analysisData, customPrompt);
    const isSyncMode = runMode === 'sync';

    log.info('Starting enhanced AI insights generation', {
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      dataStructure: analysisData ? Object.keys(analysisData) : 'none',
      runMode
    });

    // BACKGROUND MODE: Create job and trigger background processing
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

      try {
        const dispatchInfo = await dispatchBackgroundProcessing({
          jobId: job.id,
          event,
          log
        });

        log.info('Background processing dispatched', {
          jobId: job.id,
          dispatchUrl: dispatchInfo.url,
          status: dispatchInfo.status
        });
      } catch (dispatchError) {
        const error = dispatchError instanceof Error ? dispatchError : new Error(String(dispatchError));
        log.error('Failed to dispatch background insights processing', {
          jobId: job.id,
          error: error.message
        });

        try {
          await failJob(job.id, `Background dispatch failed: ${error.message}`, log);
        } catch (failErr) {
          const failError = failErr instanceof Error ? failErr : new Error(String(failErr));
          log.error('Failed to mark job as failed after dispatch error', {
            jobId: job.id,
            error: failError.message
          });
        }

        timer.end();
        return respond(500, {
          success: false,
          error: 'Unable to start background processing. Please try again.',
          message: error.message,
          jobId: job.id,
          analysisMode: runMode,
          timestamp: new Date().toISOString()
        });
      }

      timer.end();

      // Return immediate response with jobId and initial summary
      return respond(200, {
        success: true,
        jobId: job.id,
        status: 'processing',
        initialSummary: job.initialSummary,
        message: 'Background processing started. Poll for status updates.',
        analysisMode: runMode,
        timestamp: new Date().toISOString()
      });
    }

    // SYNC MODE: Execute immediately and return results
    log.info('Using synchronous mode');

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

    // Build enhanced prompt with deep context
    const { prompt: initialPrompt, contextSummary } = await buildGuruPrompt({
      analysisData,
      systemId,
      customPrompt,
      log,
      context: undefined,
      mode: runMode
    });

    // Execute multi-turn conversation with function calling
    const result = await executeWithFunctionCalling(
      model,
      initialPrompt,
      analysisData,
      systemId,
      customPrompt,
      log
    );

    const insightsPayload = /** @type {Record<string, any>} */ (Object.assign({}, result.insights));
    if (contextSummary) {
      insightsPayload.contextSummary = contextSummary;
    }

    timer.end();

    return respond(200, {
      success: true,
      insights: insightsPayload,
      toolCalls: result.toolCalls,
      usedFunctionCalling: result.usedFunctionCalling,
      analysisMode: runMode,
      contextSummary,
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
 * @param {string} text
 * @param {Array<any>} toolCalls
 * @param {number|null} [confidence]
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
 * @param {string} insightsText
 * @param {Array<any>} toolCalls
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
    { name: 'gemini-2.5-flash', description: 'latest stable model with function calling' },
    { name: 'gemini-1.5-flash', description: 'stable fallback model' },
    { name: 'gemini-1.5-pro', description: 'advanced fallback model' }
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
/**
 * @param {number} statusCode
 * @param {any} body
 */
async function dispatchBackgroundProcessing({ jobId, event, log }) {
  if (!jobId) {
    throw new Error('dispatchBackgroundProcessing called without jobId');
  }

  const url = resolveBackgroundFunctionUrl(event);
  if (!url) {
    throw new Error('Unable to resolve background function URL');
  }

  log.debug('Dispatching background insights function', { jobId, url });

  const response = await fetchWithFallback(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Insights-Dispatch': 'generate-insights'
    },
    body: JSON.stringify({ jobId })
  });

  if (!response.ok) {
    const errorText = await readResponseText(response);
    throw new Error(`Background function responded with status ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }

  return { status: response.status, url };
}

function resolveBackgroundFunctionUrl(event) {
  const explicit = process.env.INSIGHTS_BACKGROUND_URL;
  if (explicit) {
    return buildBackgroundUrl(explicit);
  }

  const envBase = process.env.URL || process.env.DEPLOY_URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL;
  if (envBase) {
    return buildBackgroundUrl(envBase);
  }

  const host = event?.headers?.host;
  if (host) {
    const protocol = event?.headers?.['x-forwarded-proto'] || event?.headers?.['X-Forwarded-Proto'] || 'https';
    return buildBackgroundUrl(`${protocol}://${host}`);
  }

  if (process.env.NETLIFY_DEV === 'true') {
    const port = process.env.NETLIFY_DEV_PORT || process.env.PORT || 8888;
    return buildBackgroundUrl(`http://localhost:${port}`);
  }

  return null;
}

function buildBackgroundUrl(base) {
  if (!base) return null;
  const trimmed = base.trim();
  if (!trimmed) return null;

  const withoutTrailingSlash = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;

  if (withoutTrailingSlash.includes('/.netlify/functions/')) {
    if (withoutTrailingSlash.endsWith(`/${BACKGROUND_FUNCTION_NAME}`)) {
      return withoutTrailingSlash;
    }
    return `${withoutTrailingSlash}/${BACKGROUND_FUNCTION_NAME}`;
  }

  return `${withoutTrailingSlash}/.netlify/functions/${BACKGROUND_FUNCTION_NAME}`;
}

async function fetchWithFallback(url, options) {
  if (typeof fetch === 'function') {
    return fetch(url, options);
  }

  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch(url, options);
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}

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

function resolveRunMode(queryParams = {}, body = {}, analysisData = {}, customPrompt) {
  const normalize = (value) => typeof value === 'string' ? value.toLowerCase() : value;

  const modeFromQuery = normalize(queryParams.mode);
  if (modeFromQuery === 'sync') return 'sync';
  if (modeFromQuery === 'background' || modeFromQuery === 'async') return 'background';

  if (queryParams.sync === 'true') return 'sync';
  if (queryParams.sync === 'false') return 'background';

  const modeFromBody = normalize(body.mode);
  if (modeFromBody === 'sync') return 'sync';
  if (modeFromBody === 'background' || modeFromBody === 'async') return 'background';

  if (body.sync === true) return 'sync';
  if (body.sync === false) return 'background';
  if (body.runAsync === true) return 'background';
  if (body.runAsync === false) return 'sync';

  const measurementCount = Array.isArray(analysisData?.measurements) ? analysisData.measurements.length : 0;
  const customPromptLength = typeof customPrompt === 'string' ? customPrompt.length : 0;

  if (customPromptLength > 400 || measurementCount > 360) {
    return 'background';
  }

  if (!customPrompt && measurementCount > 0 && measurementCount <= 200) {
    return 'sync';
  }

  return 'background';
}

exports.handler = handler;

