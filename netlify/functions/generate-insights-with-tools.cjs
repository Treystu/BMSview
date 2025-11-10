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

const { createLogger, createTimer } = require('./utils/logger.cjs');
const { createInsightsJob, ensureIndexes, failJob } = require('./utils/insights-jobs.cjs');
const { generateInitialSummary } = require('./utils/insights-summary.cjs');
const { runGuruConversation } = require('./utils/insights-guru-runner.cjs');
const { getAIModelWithTools } = require('./utils/insights-processor.cjs');

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
      customPromptLength: typeof customPrompt === 'string' ? customPrompt.length : 0,
      measurementCount: Array.isArray(analysisData?.measurements) ? analysisData.measurements.length : 0,
      dataStructure: analysisData ? Object.keys(analysisData) : 'none',
      queryParams,
      resolvedMode: runMode,
      explicitModeRequested: !!(queryParams.mode || queryParams.sync || body.mode || body.sync)
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
        const dispatchStartedAt = Date.now();
        const dispatchInfo = await dispatchBackgroundProcessing({
          jobId: job.id,
          event,
          log
        });

        log.info('Background processing dispatched', {
          jobId: job.id,
          dispatchUrl: dispatchInfo.url,
          status: dispatchInfo.status,
          dispatchDurationMs: Date.now() - dispatchStartedAt
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

    let conversationResult;
    const conversationStartedAt = Date.now();
    try {
      conversationResult = await runGuruConversation({
        model,
        analysisData,
        systemId,
        customPrompt,
        log,
        mode: runMode,
        maxIterations: MAX_TOOL_ITERATIONS,
        iterationTimeoutMs: ITERATION_TIMEOUT_MS,
        totalTimeoutMs: TOTAL_TIMEOUT_MS,
        conversationTokenLimit: MAX_CONVERSATION_TOKENS
      });
      const conversationDurationMs = Date.now() - conversationStartedAt;
      log.info('Guru conversation completed', {
        durationMs: conversationDurationMs,
        iterations: conversationResult.iterations,
        toolCallCount: Array.isArray(conversationResult.toolCalls) ? conversationResult.toolCalls.length : 0,
        usedFunctionCalling: conversationResult.usedFunctionCalling,
        warning: conversationResult.warning
      });
    } catch (conversationError) {
      const err = conversationError instanceof Error ? conversationError : new Error(String(conversationError));
      log.error('Guru conversation failed', {
        error: err.message,
        stack: err.stack,
        durationMs: Date.now() - conversationStartedAt
      });

      const { userMessage, technicalDetails } = mapConversationError(err);
      const errorInsights = {
        rawText: `❌ Error: ${userMessage}`,
        formattedText: `❌ Error: ${userMessage}\n\nTechnical details: ${technicalDetails}`,
        healthStatus: 'Error',
        performance: { trend: 'Error' }
      };

      timer.end();
      return respond(200, {
        success: false,
        insights: errorInsights,
        analysisMode: runMode,
        error: userMessage,
        timestamp: new Date().toISOString()
      });
    }

    timer.end();

    return respond(200, {
      success: true,
      insights: conversationResult.insights,
      toolCalls: conversationResult.toolCalls,
      usedFunctionCalling: conversationResult.usedFunctionCalling,
      analysisMode: runMode,
      contextSummary: conversationResult.contextSummary,
      iterations: conversationResult.iterations,
      warning: conversationResult.warning,
      durationMs: Date.now() - conversationStartedAt,
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

async function dispatchBackgroundProcessing({ jobId, event, log }) {
  if (!jobId) {
    throw new Error('dispatchBackgroundProcessing called without jobId');
  }

  const url = resolveBackgroundFunctionUrl(event);
  if (!url) {
    log.error('Failed to resolve background function URL', {
      envVars: {
        URL: process.env.URL,
        DEPLOY_URL: process.env.DEPLOY_URL,
        NETLIFY_DEV: process.env.NETLIFY_DEV
      },
      eventHeaders: event?.headers ? Object.keys(event.headers) : 'none'
    });
    throw new Error('Unable to resolve background function URL');
  }

  log.info('Dispatching background insights function', { jobId, url });

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
    log.error('Background function dispatch failed', {
      jobId,
      url,
      status: response.status,
      statusText: response.statusText,
      errorText
    });
    throw new Error(`Background function responded with status ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }

  log.info('Background function dispatched successfully', {
    jobId,
    url,
    status: response.status
  });

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

function mapConversationError(error) {
  const message = error && error.message ? error.message : String(error);
  let userMessage = 'Failed to generate insights. Please try again.';

  if (message.includes('404') || message.includes('not found')) {
    userMessage = 'AI model temporarily unavailable. Please try again in a few moments.';
  } else if (message.includes('timeout') || message.includes('timed out') || message.includes('time limit')) {
    userMessage = message;
  } else if (message.includes('quota') || message.includes('rate limit')) {
    userMessage = 'Service temporarily unavailable due to high demand. Please try again in a few minutes.';
  } else if (message.includes('blocked') || message.includes('SAFETY')) {
    userMessage = 'Response was blocked by safety filters. Please rephrase your question.';
  }

  return {
    userMessage,
    technicalDetails: message
  };
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

  // Explicit mode from query parameters takes highest priority
  const modeFromQuery = normalize(queryParams.mode);
  if (modeFromQuery === 'sync') return 'sync';
  if (modeFromQuery === 'background' || modeFromQuery === 'async') return 'background';

  if (queryParams.sync === 'true') return 'sync';
  if (queryParams.sync === 'false') return 'background';

  // Explicit mode from body
  const modeFromBody = normalize(body.mode);
  if (modeFromBody === 'sync') return 'sync';
  if (modeFromBody === 'background' || modeFromBody === 'async') return 'background';

  if (body.sync === true) return 'sync';
  if (body.sync === false) return 'background';
  if (body.runAsync === true) return 'background';
  if (body.runAsync === false) return 'sync';

  // Intelligent routing based on data characteristics
  const measurementCount = Array.isArray(analysisData?.measurements) ? analysisData.measurements.length : 0;
  const customPromptLength = typeof customPrompt === 'string' ? customPrompt.length : 0;

  // Large datasets or complex prompts → background
  if (customPromptLength > 400 || measurementCount > 360) {
    return 'background';
  }

  // **DEFAULT CHANGED TO BACKGROUND MODE**
  // Background mode is more reliable for production use:
  // - Has 14-minute timeout (vs 58s for sync)
  // - Provides progress updates to user
  // - Handles long-running AI queries gracefully
  // - Gemini API + tool calls often exceed 58s even for simple queries
  //
  // Sync mode can still be explicitly requested via ?sync=true for testing
  return 'background';
}

exports.handler = handler;

