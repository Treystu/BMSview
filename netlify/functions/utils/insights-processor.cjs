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
const MAX_TOOL_ITERATIONS = 15;
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
                elapsedSeconds: Math.floor(elapsedMs / 1000)
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record iteration progress', { jobId, error: err.message });
          }
        },
        onToolCall: async ({ iteration, name, parameters }) => {
          console.log(JSON.stringify({
            level: 'INFO',
            timestamp: new Date().toISOString(),
            message: 'Tool call requested',
            context: { jobId, iteration, tool: name }
          }));
          try {
            await addProgressEvent(jobId, {
              type: 'tool_call',
              data: {
                tool: name,
                parameters,
                iteration
              }
            }, log);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn('Failed to record tool call', { jobId, error: err.message });
          }
        },
        onToolResult: async ({ iteration, name, durationMs, result, error }) => {
          console.log(JSON.stringify({
            level: error ? 'WARN' : 'INFO',
            timestamp: new Date().toISOString(),
            message: 'Tool call completed',
            context: { jobId, iteration, tool: name, success: !error, durationMs }
          }));
          try {
            await addProgressEvent(jobId, {
              type: 'tool_response',
              data: {
                tool: name,
                success: !error,
                dataSize: result ? JSON.stringify(result).length : 0,
                durationMs,
                iteration
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

  const genAI = new GoogleGenAI(apiKey);

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
          maxOutputTokens: 8192,
        }
      });

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

module.exports = {
  processInsightsInBackground,
  getAIModelWithTools
};
