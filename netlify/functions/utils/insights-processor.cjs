/**
 * Insights Processor - Background AI Processing Logic
 * 
 * Extracted from generate-insights-background.cjs to be reusable.
 * Handles the core AI function calling loop with progress tracking.
 * 
 * @module netlify/functions/utils/insights-processor
 */

const { GoogleGenAI } = require('@google/genai');
const {
  updateJobStatus,
  addProgressEvent,
  updatePartialInsights,
  completeJob,
  failJob
} = require('./insights-jobs.cjs');
const { runGuruConversation, DEFAULT_CONVERSATION_TOKEN_LIMIT, TOKENS_PER_CHAR } = require('./insights-guru-runner.cjs');

// Processing constants
const MAX_TOOL_ITERATIONS = 8; // Reduced from 15 to match sync mode and prevent excessive tool calls
const ITERATION_TIMEOUT_MS = 30000; // 30 seconds
const TOTAL_TIMEOUT_MS = 14 * 60 * 1000; // 14 minutes

/**
 * Main background processing function
 * 
 * @param {string} jobId - Job identifier
 * @param {Object} analysisData - Battery analysis data
 * @param {string} systemId - Optional system ID
 * @param {string} customPrompt - Optional custom user prompt
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Processing result
 */
async function processInsightsInBackground(jobId, analysisData, systemId, customPrompt, log) {
  // CRITICAL: Log immediately at function entry for debugging
  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: new Date().toISOString(),
    message: 'processInsightsInBackground ENTRY',
    context: { jobId, hasSystemId: !!systemId, hasCustomPrompt: !!customPrompt }
  }));

  try {
    log.info('Background processing started', { jobId, hasSystemId: !!systemId });

    // Update job status
    await updateJobStatus(jobId, 'processing', log);
    await addProgressEvent(jobId, {
      type: 'status',
      data: { message: 'AI analysis starting...' }
    }, log);

    const model = await getAIModelWithTools(log);
    if (!model) {
      throw new Error('AI model not available - cannot generate insights');
    }

    log.info('AI model loaded, starting conversation', { jobId });

    const result = await runGuruConversation({
      model,
      analysisData,
      systemId,
      customPrompt,
      log,
      mode: 'background',
      maxIterations: MAX_TOOL_ITERATIONS,
      iterationTimeoutMs: ITERATION_TIMEOUT_MS,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
      conversationTokenLimit: DEFAULT_CONVERSATION_TOKEN_LIMIT,
      tokensPerChar: TOKENS_PER_CHAR,
      hooks: {
        onContextBuilt: async ({ contextSummary, promptLength, mode }) => {
          console.log(JSON.stringify({
            level: 'INFO',
            timestamp: new Date().toISOString(),
            message: 'Guru context built',
            context: { jobId, promptLength, mode }
          }));
          
          // Build a human-readable summary of what's pre-loaded
          const contextParts = [];
          if (contextSummary) {
            if (contextSummary.systemProfile) {
              contextParts.push(`System: ${contextSummary.systemProfile.name || 'Unknown'}`);
              if (contextSummary.systemProfile.chemistry) {
                contextParts.push(`${contextSummary.systemProfile.chemistry}`);
              }
              if (contextSummary.systemProfile.nominalVoltage) {
                contextParts.push(`${contextSummary.systemProfile.nominalVoltage}V`);
              }
            }
            if (contextSummary.snapshot) {
              contextParts.push(`Live snapshot: ${contextSummary.snapshot.voltage?.toFixed(2) || '?'}V`);
              if (contextSummary.snapshot.current !== null) {
                contextParts.push(`${contextSummary.snapshot.current?.toFixed(1) || '?'}A`);
              }
              if (contextSummary.snapshot.soc !== null) {
                contextParts.push(`${contextSummary.snapshot.soc?.toFixed(1) || '?'}% SOC`);
              }
            }
            if (contextSummary.energyBudgets?.autonomyDays) {
              contextParts.push(`Energy budget: ${contextSummary.energyBudgets.solarPercentage || 0}% Solar`);
              contextParts.push(`${contextSummary.energyBudgets.autonomyDays?.toFixed(1) || '?'} days autonomy`);
            }
            if (contextSummary.analytics?.anomalyCount) {
              contextParts.push(`${contextSummary.analytics.anomalyCount} anomalies`);
              if (contextSummary.analytics.highSeverityCount) {
                contextParts.push(`${contextSummary.analytics.highSeverityCount} high severity`);
              }
            }
            if (contextSummary.weather) {
              contextParts.push(`Weather: ${contextSummary.weather.temp?.toFixed(1) || '?'}°C`);
              contextParts.push(`${contextSummary.weather.clouds || '?'}% clouds`);
              if (contextSummary.weather.uvi !== null) {
                contextParts.push(`UVI ${contextSummary.weather.uvi?.toFixed(1) || '?'}`);
              }
            }
            if (contextSummary.recentSnapshots?.count) {
              contextParts.push(`Recent logs: ${contextSummary.recentSnapshots.count} samples`);
              if (contextSummary.recentSnapshots.netSocDelta !== null) {
                const delta = contextSummary.recentSnapshots.netSocDelta;
                contextParts.push(`ΔSOC ${delta > 0 ? '+' : ''}${delta?.toFixed(1) || '?'}%`);
              }
              if (contextSummary.recentSnapshots.netAhDelta !== null) {
                const delta = contextSummary.recentSnapshots.netAhDelta;
                contextParts.push(`ΔAh ${delta > 0 ? '+' : ''}${delta?.toFixed(2) || '?'}`);
              }
            }
            if (contextSummary.meta?.contextBuildMs) {
              contextParts.push(`Context build time: ${contextSummary.meta.contextBuildMs} ms`);
            }
          }
          
          const contextMessage = contextParts.length > 0 
            ? `🧠 Guru Context Primer:\n\n${contextParts.map(p => `• ${p}`).join('\n')}`
            : '🧠 Guru Context Primer: Basic snapshot data loaded';
          
          try {
            await addProgressEvent(jobId, {
              type: 'context_built',
              data: {
                contextSummary,
                promptLength,
                mode,
                message: contextMessage
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record context built', { jobId, error: err.message });
          }
        },
        onIterationStart: async ({ iteration, elapsedMs }) => {
          console.log(JSON.stringify({
            level: 'INFO',
            timestamp: new Date().toISOString(),
            message: 'Insights iteration started',
            context: { jobId, iteration, elapsedSeconds: Math.floor(elapsedMs / 1000) }
          }));
          try {
            await addProgressEvent(jobId, {
              type: 'iteration',
              data: {
                iteration,
                elapsedSeconds: Math.floor(elapsedMs / 1000),
                message: `📈 Iteration ${iteration} of ?`
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record iteration progress', { jobId, error: err.message });
          }
        },
        onPromptSent: async ({ iteration, promptLength, messageCount, promptPreview, fullPrompt }) => {
          console.log(JSON.stringify({
            level: 'DEBUG',
            timestamp: new Date().toISOString(),
            message: 'Prompt sent to Gemini',
            context: { jobId, iteration, promptLength, messageCount }
          }));
          
          // Create a truncated version for UI display (last 800 chars of last message)
          const lastMessage = fullPrompt ? fullPrompt.split('\n\n').slice(-1)[0] : '';
          const displayText = lastMessage.length > 800 
            ? `...${lastMessage.substring(lastMessage.length - 800)}`
            : lastMessage;
          
          try {
            await addProgressEvent(jobId, {
              type: 'prompt_sent',
              data: {
                iteration,
                promptLength,
                messageCount,
                promptPreview: displayText,
                message: `📤 Iteration ${iteration} sent - waiting for reply...\n\n📝 Request Preview:\n${displayText}`
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record prompt sent', { jobId, error: err.message });
          }
        },
        onResponseReceived: async ({ iteration, responseLength, responsePreview, fullResponse, isEmpty }) => {
          console.log(JSON.stringify({
            level: isEmpty ? 'WARN' : 'DEBUG',
            timestamp: new Date().toISOString(),
            message: 'Response received from Gemini',
            context: { jobId, iteration, responseLength, isEmpty }
          }));
          
          // Show the actual response
          const displayResponse = fullResponse && fullResponse.length > 1500
            ? `${fullResponse.substring(0, 1500)}...\n\n[Response truncated - ${fullResponse.length} total chars]`
            : fullResponse || '(empty)';
          
          try {
            await addProgressEvent(jobId, {
              type: 'response_received',
              data: {
                iteration,
                responseLength,
                isEmpty,
                responsePreview: displayResponse,
                message: isEmpty 
                  ? `⚠️ Reply received - EMPTY RESPONSE`
                  : `📥 Reply received (${Math.round(responseLength / 1000)}KB):\n\n${displayResponse}`
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record response received', { jobId, error: err.message });
          }
        },
        onToolCall: async ({ iteration, name, parameters, fullRequest }) => {
          console.log(JSON.stringify({
            level: 'INFO',
            timestamp: new Date().toISOString(),
            message: 'Tool call requested',
            context: { jobId, iteration, tool: name }
          }));
          try {
            // Format parameters for display
            const paramsSummary = Object.entries(parameters || {})
              .map(([key, value]) => {
                if (typeof value === 'string' && value.length > 30) {
                  return `  ${key}: ${value.substring(0, 30)}...`;
                }
                return `  ${key}: ${JSON.stringify(value)}`;
              })
              .join('\n');
            
            const requestDisplay = fullRequest || JSON.stringify({ tool_call: name, parameters }, null, 2);
            
            await addProgressEvent(jobId, {
              type: 'tool_call',
              data: {
                tool: name,
                parameters,
                iteration,
                fullRequest: requestDisplay,
                message: `🔧 AI requesting more information:\n\n${requestDisplay}\n\nExecuting tool...`
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record tool call', { jobId, error: err.message });
          }
        },
        onToolResult: async ({ iteration, name, durationMs, result, fullResult, error, parameters }) => {
          console.log(JSON.stringify({
            level: error ? 'WARN' : 'INFO',
            timestamp: new Date().toISOString(),
            message: 'Tool call completed',
            context: { jobId, iteration, tool: name, success: !error, durationMs }
          }));
          try {
            const dataSize = result ? JSON.stringify(result).length : 0;
            const resultDisplay = fullResult && fullResult.length > 2000
              ? `${fullResult.substring(0, 2000)}...\n\n[Result truncated - ${fullResult.length} total chars]`
              : fullResult || JSON.stringify(result, null, 2);
            
            await addProgressEvent(jobId, {
              type: 'tool_response',
              data: {
                tool: name,
                success: !error,
                dataSize,
                durationMs,
                iteration,
                fullResult: resultDisplay,
                message: error
                  ? `❌ Tool ${name} failed: ${error}`
                  : `📊 Bundled information received (${(durationMs / 1000).toFixed(1)}s):\n\n${resultDisplay}\n\nSending to AI for analysis...`
              }
            }, log);
          } catch (errLike) {
            const err = errLike instanceof Error ? errLike : new Error(String(errLike));
            log.warn('Failed to record tool response', { jobId, error: err.message });
          }
        },
        onPartialUpdate: async ({ text }) => {
          try {
            await updatePartialInsights(jobId, text, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record partial insights', { jobId, error: err.message });
          }
        },
        onFinalAnswer: async ({ iteration, warning }) => {
          try {
            await addProgressEvent(jobId, {
              type: 'ai_response',
              data: {
                type: warning ? 'warning' : 'final_answer',
                iteration
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record AI response event', { jobId, error: err.message });
          }
        },
        onError: async ({ error }) => {
          try {
            await addProgressEvent(jobId, {
              type: 'error',
              data: { error: error instanceof Error ? error.message : String(error) }
            }, log);
          } catch (errLike) {
            const err = errLike instanceof Error ? errLike : new Error(String(errLike));
            log.warn('Failed to record AI error event', { jobId, error: err.message });
          }
        }
      }
    });

    // Mark job as complete
    await completeJob(jobId, result.insights, log);
    await addProgressEvent(jobId, {
      type: 'status',
      data: { message: 'Analysis completed successfully' }
    }, log);

    log.info('Background processing completed', {
      jobId,
      iterations: result.iterations,
      toolCallsUsed: result.toolCalls?.length || 0
    });

    return result;

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Background processing failed', {
      jobId,
      error: err.message,
      stack: err.stack
    });

    // Mark job as failed
    await failJob(jobId, err.message, log);
    await addProgressEvent(jobId, {
      type: 'error',
      data: { error: err.message }
    }, log);

    throw error;
  }
}

async function getAIModelWithTools(log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log.error('GEMINI_API_KEY not configured');
    return null;
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });

    // Use environment variable for model with fallback
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    log.info(`Initializing Gemini model: ${modelName}`);

    // Create a wrapper object that matches the old model API
    // The new @google/genai SDK uses ai.models.generateContent() directly
    const modelWrapper = {
      generateContent: async (prompt) => {
        const response = await genAI.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
          }
        });
        return response;
      }
    };

    log.info(`Model ${modelName} initialized successfully`);
    return modelWrapper;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Failed to initialize AI model', { error: error.message });
    return null;
  }
}

module.exports = {
  processInsightsInBackground,
  getAIModelWithTools
};
