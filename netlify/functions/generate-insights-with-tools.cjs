// @ts-nocheck
/**
 * Generate Insights With Tools - Full ReAct Loop Implementation
 *
 * This is the MAIN endpoint for generating battery insights using the ReAct loop.
 * Supports both sync and background modes with full function calling.
 * Sync mode no longer falls back to background - returns error on timeout instead.
 * 
 * SECURITY HARDENING:
 * - Rate limiting per user/system
 * - Input sanitization to prevent injection attacks
 * - Audit logging for compliance
 * - Consent verification
 */

const { createLogger } = require('./utils/logger.cjs');
const { executeReActLoop } = require('./utils/react-loop.cjs');
const { applyRateLimit, RateLimitError } = require('./utils/rate-limiter.cjs');
const { sanitizeInsightsRequest, SanitizationError } = require('./utils/security-sanitizer.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  if (!process.env.GEMINI_API_KEY) {
    log.error('Missing GEMINI_API_KEY environment variable');
    return false;
  }
  return true;
}

const {
  createInsightsJob,
  getInsightsJob,
  updateJobStatus,
  saveCheckpoint // Add saveCheckpoint for emergency saves
} = require('./utils/insights-jobs.cjs');
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const {
  getOrCreateResumableJob,
  validateCheckpoint,
  createCheckpointCallback,
  planResume
} = require('./utils/checkpoint-manager.cjs');

// Mode constants
// CRITICAL: Netlify has hard timeout limits:
// - Free tier: 10 seconds
// - Pro/Business: 26 seconds  
// - Enterprise: Can be configured higher
// We use 20s as safe limit to allow for cleanup/response before hard timeout
const NETLIFY_FUNCTION_TIMEOUT_MS = parseInt(process.env.NETLIFY_FUNCTION_TIMEOUT_MS || '20000'); // 20s safe limit
const SYNC_MODE_TIMEOUT_MS = NETLIFY_FUNCTION_TIMEOUT_MS; // Align with Netlify limits
const DEFAULT_MODE = 'sync';

/**
 * Main handler for insights generation
 */
const { PassThrough } = require('stream');

exports.handler = async (event, context) => {
  const stream = new PassThrough();

  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLogger('generate-insights-with-tools', context);
  log.info('Received event', { event });
  log.info('Received context', { context });
  const startTime = Date.now();

  // Extract client IP for security logging
  const clientIp = event?.headers?.['x-nf-client-connection-ip'] || 'unknown';

  try {
    // =====================
    // SECURITY: Rate Limiting
    // =====================
    let rateLimitResult;
    try {
      rateLimitResult = await applyRateLimit(event, 'insights', log);
      log.rateLimit('allowed', {
        endpoint: 'insights',
        clientIp,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit
      });
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitError) {
        log.rateLimit('blocked', {
          endpoint: 'insights',
          clientIp,
          retryAfterMs: rateLimitError.retryAfterMs
        });
        return {
          statusCode: 429,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(rateLimitError.retryAfterMs / 1000))
          },
          body: JSON.stringify({
            success: false,
            error: 'rate_limit_exceeded',
            message: rateLimitError.message,
            retryAfterSeconds: Math.ceil(rateLimitError.retryAfterMs / 1000)
          })
        };
      }
      // Non-rate-limit errors: log and continue (fail open)
      log.warn('Rate limit check error, continuing', { error: rateLimitError.message });
    }

    // Add rate limit headers to response
    const rateLimitHeaders = rateLimitResult?.headers || {};

    // =====================
    // SECURITY: Input Sanitization
    // =====================
    let rawBody;
    try {
      rawBody = event.body ? JSON.parse(event.body) : {};
    } catch (parseError) {
      log.warn('Invalid JSON in request body', { error: parseError.message, clientIp });
      return {
        statusCode: 400,
        headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'invalid_json',
          message: 'Request body must be valid JSON'
        })
      };
    }

    // Sanitize all inputs
    let sanitizedBody;
    try {
      sanitizedBody = sanitizeInsightsRequest(rawBody, log);

      // Log any sanitization warnings
      if (sanitizedBody.warnings && sanitizedBody.warnings.length > 0) {
        log.sanitization('request', 'Input modified during sanitization', {
          warnings: sanitizedBody.warnings,
          clientIp
        });
      }
    } catch (sanitizeError) {
      if (sanitizeError instanceof SanitizationError) {
        log.audit('injection_blocked', {
          field: sanitizeError.field,
          type: sanitizeError.type,
          clientIp
        });
        return {
          statusCode: 400,
          headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'invalid_input',
            message: sanitizeError.message,
            field: sanitizeError.field
          })
        };
      }
      throw sanitizeError;
    }

    // Extract sanitized values
    // Support legacy payloads where analysis data is provided directly (e.g., batteryData)
    // Both analysisData and batteryData are sanitized in sanitizeInsightsRequest
    const analysisData = sanitizedBody.analysisData || sanitizedBody.batteryData || null;
    const systemId = sanitizedBody.systemId;
    const customPrompt = sanitizedBody.customPrompt;
    const mode = sanitizedBody.mode || DEFAULT_MODE;
    const insightMode = sanitizedBody.insightMode || 'with_tools';
    const contextWindowDays = sanitizedBody.contextWindowDays;
    const maxIterations = sanitizedBody.maxIterations;
    const modelOverride = sanitizedBody.modelOverride;
    const initializationComplete = sanitizedBody.initializationComplete;
    const resumeJobId = sanitizedBody.resumeJobId;
    const consentGranted = sanitizedBody.consentGranted;

    // =====================
    // SECURITY: Consent Verification with Audit Logging
    // =====================
    // Verify user consent for AI processing BEFORE validating other fields
    // Strict type checking to prevent bypass via type coercion
    // Note: Resume requests (resumeJobId) bypass consent check because:
    // 1. The original job was created with explicit consent
    // 2. Resume is just continuing an already-authorized analysis
    // 3. No new data is being submitted (just continuing from checkpoint)
    if ((typeof consentGranted !== 'boolean' || consentGranted !== true) && !resumeJobId) {
      log.consent(false, {
        systemId,
        clientIp,
        consentValue: consentGranted,
        consentType: typeof consentGranted
      });
      log.warn('Insights request rejected: Missing or invalid user consent', { systemId, consentGranted, consentType: typeof consentGranted });
      return {
        statusCode: 403,
        headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'consent_required',
          message: 'User consent is required for AI analysis. Please opt-in to continue. (consentGranted must be boolean true)'
        })
      };
    }

    // Log successful consent
    if (!resumeJobId) {
      log.consent(true, {
        systemId,
        clientIp
      });
    }

    // Validate input: Must have either (analysisData AND systemId) OR resumeJobId
    if ((!analysisData || !systemId) && !resumeJobId) {
      return {
        statusCode: 400,
        headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Either analysisData and systemId, or resumeJobId is required'
        })
      };
    }

    log.info('Insights request received', {
      hasAnalysisData: !!analysisData,
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      hasResumeJobId: !!resumeJobId,
      mode,
      contextWindowDays,
      maxIterations,
      modelOverride,
      initializationComplete,
      consentGranted
    });

    // =====================
    // SECURITY: Audit log data access
    // =====================
    log.dataAccess('insights_generation', {
      systemId,
      clientIp,
      mode,
      hasCustomPrompt: !!customPrompt,
      isResume: !!resumeJobId
    });

    // SYNC MODE: Execute ReAct loop with checkpoint/resume support
    if (mode === 'sync') {
      // Get or create resumable job
      const { job, isResume, isComplete, checkpoint } = await getOrCreateResumableJob({
        resumeJobId,
        analysisData,
        systemId,
        customPrompt,
        contextWindowDays,
        maxIterations,
        modelOverride
      }, log);

      // If job already complete, return results immediately
      if (isComplete) {
        log.info('Returning completed job results', { jobId: job.id });
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            insights: job.finalInsights,
            metadata: {
              mode: 'sync',
              jobId: job.id,
              wasResumed: false,
              fromCache: true
            }
          })
        };
      }

      // Validate checkpoint if resuming
      let resumeConfig = null;
      if (isResume && checkpoint) {
        const validation = validateCheckpoint(checkpoint, log);
        if (!validation.valid) {
          log.warn('Invalid checkpoint, starting fresh', {
            error: validation.error,
            jobId: job.id
          });
        } else {
          resumeConfig = planResume(checkpoint, { maxIterations, contextWindowDays }, log);
          log.info('Resuming from checkpoint', {
            jobId: job.id,
            checkpointTurn: checkpoint.turnCount,
            remainingTurns: resumeConfig.maxRemainingTurns
          });
        }
      }

      try {
        log.info(isResume ? 'Resuming sync ReAct loop' : 'Starting sync ReAct loop', {
          jobId: job.id
        });

        // Create checkpoint callback for this job
        const checkpointCallback = createCheckpointCallback(job.id, SYNC_MODE_TIMEOUT_MS, log);

        // CRITICAL: Do NOT use Promise.race here!
        // The ReAct loop handles its own timeout internally and saves checkpoints properly.
        // Promise.race would interrupt checkpoint saving and cause data loss.
        const params = {
          analysisData: job.analysisData || analysisData,
          systemId: job.systemId || systemId,
          customPrompt: job.customPrompt || customPrompt,
          log,
          mode: 'sync',
          contextWindowDays: job.contextWindowDays || contextWindowDays,
          maxIterations: job.maxIterations || maxIterations,
          modelOverride: job.modelOverride || modelOverride,
          skipInitialization: resumeConfig?.skipInitialization || initializationComplete,
          checkpointState: resumeConfig, // Pass resume config if available
          onCheckpoint: checkpointCallback, // Auto-save checkpoints
          stream,
          insightMode // Pass insight mode for specialized behavior
        };
        log.info('Calling executeReActLoop with params', params);
        const result = await executeReActLoop(params);

        // Check if the result indicates timeout
        if (result && result.timedOut) {
          log.info('ReAct loop timed out gracefully, verifying checkpoint', {
            jobId: job.id,
            turns: result.turns || 0,
            toolCalls: result.toolCalls || 0,
            durationMs: result.durationMs || 0
          });

          // EDGE CASE PROTECTION #7: Verify checkpoint was actually saved
          // @ts-nocheckpoint save failed, make one final attempt
          try {
            const verifyJob = await getInsightsJob(job.id, log);
            if (!verifyJob || !verifyJob.checkpointState) {
              log.warn('Checkpoint missing after timeout, attempting emergency save', {
                jobId: job.id
              });

              // Emergency checkpoint save - preserve conversation history if available
              // If result doesn't have conversationHistory, fallback to empty array
              const emergencyCheckpoint = {
                conversationHistory: result.conversationHistory || [], // Preserve history if available
                turnCount: result.turns || 0,
                toolCallCount: result.toolCalls || 0,
                contextSummary: result.contextSummary || {},
                startTime: result.startTime || Date.now(),
                emergency: true
              };

              await saveCheckpoint(job.id, emergencyCheckpoint, log);
            }
          } catch (verifyError) {
            log.error('Failed to verify/save emergency checkpoint', {
              jobId: job.id,
              error: verifyError.message
            });
            // Continue anyway - client will retry and may succeed
          }

          // Return 408 to trigger automatic retry
          return {
            statusCode: 408,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'insights_timeout',
              message: `Insights generation timed out after ${SYNC_MODE_TIMEOUT_MS}ms. A checkpoint was saved - retry with resumeJobId to continue.`,
              details: {
                jobId: job.id,
                durationMs: result.durationMs || 0,
                timeoutMs: SYNC_MODE_TIMEOUT_MS,
                canResume: true,
                wasResumed: isResume,
                turns: result.turns || 0,
                toolCalls: result.toolCalls || 0
              }
            })
          };
        }

        if (!result || !result.success) {
          const errorMsg = result?.error || 'ReAct loop failed without error details';
          log.warn('Sync ReAct loop completed with failure', {
            error: errorMsg,
            jobId: job.id
          });
          throw new Error(errorMsg);
        }

        const durationMs = Date.now() - startTime;

        log.info('Sync insights completed successfully', {
          jobId: job.id,
          durationMs,
          turns: result.turns || 0,
          toolCalls: result.toolCalls || 0,
          hasAnswer: !!result.finalAnswer,
          wasResumed: isResume
        });

        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            insights: {
              formattedText: result.finalAnswer || '',
              rawText: result.finalAnswer || '',
              contextSummary: result.contextSummary || {}
            },
            metadata: {
              mode: 'sync',
              jobId: job.id,
              turns: result.turns || 0,
              toolCalls: result.toolCalls || 0,
              durationMs,
              wasResumed: isResume,
              usedFunctionCalling: true
            }
          })
        };

      } catch (syncError) {
        if (syncError.message.includes('token')) {
          return await handleTokenLimitExceeded(job, log);
        }

        log.error('Sync mode failed', {
          error: syncError.message,
          jobId: job.id,
          durationMs: Date.now() - startTime,
          timeoutMs: SYNC_MODE_TIMEOUT_MS,
          wasResumed: isResume
        });

        // Return error with jobId so client can resume
        return {
          statusCode: 408, // Request Timeout
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'insights_timeout',
            message: `Insights generation timed out after ${SYNC_MODE_TIMEOUT_MS}ms. A checkpoint was saved - retry with resumeJobId to continue.`,
            details: {
              jobId: job.id, // Include jobId for resumption
              durationMs: Date.now() - startTime,
              timeoutMs: SYNC_MODE_TIMEOUT_MS,
              canResume: true, // Always can resume since checkpoint saved
              wasResumed: isResume
            }
          })
        };
      }
    }

    // BACKGROUND MODE: Create job and process asynchronously (only if mode === 'background')
    if (mode !== 'background') {
      log.warn('Invalid mode specified, expected sync or background', { mode });
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'invalid_mode',
          message: `Invalid mode: ${mode}. Must be 'sync' or 'background'.`
        })
      };
    }

    log.info('Starting background insights job');

    let job;
    try {
      job = await createInsightsJob({
        analysisData,
        systemId,
        customPrompt,
        initialSummary: null,
        contextWindowDays,
        maxIterations
      }, log);

      if (!job || !job.id) {
        throw new Error('Job creation returned no job ID');
      }

      log.info('Background job created successfully', { jobId: job.id });
    } catch (jobError) {
      log.error('Failed to create background job', {
        error: jobError.message,
        stack: jobError.stack
      });
      throw new Error(`Failed to create insights job: ${jobError.message}`);
    }

    // Start background processing (don't await)
    // Pass all parameters including contextWindowDays, maxIterations, and modelOverride
    processInsightsInBackground(
      job.id,
      analysisData,
      systemId,
      customPrompt,
      log,
      {
        contextWindowDays,
        maxIterations,
        modelOverride
      }
    ).catch(err => {
      log.error('Background processing error (logged, not thrown)', {
        jobId: job.id,
        error: err.message,
        stack: err.stack
      });
      // Update job status to failed
      updateJobStatus(job.id, 'failed', err.message, log).catch(() => {
        // Silent fail on status update
      });
    });

    return {
      statusCode: 202,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId: job.id,
        status: 'processing',
        message: 'Insights generation started in background',
        statusUrl: `/.netlify/functions/generate-insights-status?jobId=${job.id}`
      })
    };

  } catch (error) {
    log.error('Insights generation failed', {
      error: error.message,
      stack: error.stack,
      errorType: error.constructor?.name,
      durationMs: Date.now() - startTime
    });

    // Determine appropriate status code
    const statusCode = getInsightsErrorStatusCode(error);
    const errorCode = getInsightsErrorCode(error);

    return {
      statusCode,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: errorCode,
        message: error.message,
        details: {
          type: error.constructor?.name,
          recoverable: statusCode < 500
        }
      })
    };
  }
};

/**
 * Determine appropriate HTTP status code for insights errors
 */
function getInsightsErrorStatusCode(error) {
  const message = error.message || '';

  if (message.includes('invalid') || message.includes('required')) return 400;
  if (message.includes('timeout') || message.includes('TIMEOUT')) return 408;
  if (message.includes('quota') || message.includes('rate limit')) return 429;
  if (message.includes('ECONNREFUSED') || message.includes('unavailable')) return 503;

  return 500;
}

/**
 * Determine appropriate error code for insights errors
 */
function getInsightsErrorCode(error) {
  const message = error.message || '';

  if (message.includes('timeout') || message.includes('TIMEOUT')) return 'insights_timeout';
  if (message.includes('quota')) return 'quota_exceeded';
  if (message.includes('token')) return 'token_limit_exceeded';
  if (message.includes('ECONNREFUSED')) return 'database_unavailable';
  if (message.includes('Gemini') || message.includes('API')) return 'ai_service_error';

  return 'insights_generation_failed';
}

async function handleTokenLimitExceeded(job, log) {
  log.warn('Token limit exceeded, attempting to simplify and retry', { jobId: job.id });
  // In a real implementation, you would simplify the context here.
  // For now, we'll just return an error.
  return {
    statusCode: 413, // Payload Too Large
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: false,
      error: 'token_limit_exceeded',
      message: 'The request is too large. Please reduce the amount of data or context and try again.',
      details: {
        jobId: job.id,
        canResume: false
      }
    })
  };
}
