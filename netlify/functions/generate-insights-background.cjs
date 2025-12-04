/**
 * Generate Insights Background - Long-Running Job Processor
 * 
 * @deprecated This endpoint is no longer used in the normal workflow.
 * Background insights processing is now handled directly in generate-insights-with-tools.cjs
 * via in-process async execution of processInsightsInBackground().
 * 
 * This file is kept temporarily for backward compatibility and emergency manual invocation,
 * but will be removed in a future release.
 * 
 * Migration: Use generate-insights-with-tools.cjs with mode='background' instead.
 * 
 * SECURITY HARDENING:
 * - Rate limiting per user/system
 * - Input sanitization (jobId validation)
 * - Audit logging for compliance
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');
const { getInsightsJob, failJob } = require('./utils/insights-jobs.cjs');
const { applyRateLimit, RateLimitError } = require('./utils/rate-limiter.cjs');
const { sanitizeJobId, sanitizeSystemId, SanitizationError } = require('./utils/security-sanitizer.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

/**
 * Handler for background job invocations
 * Can be triggered via HTTP or direct invocation
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  // Extract jobId early for logging context
  let jobId = null;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    jobId = body.jobId;
  } catch (e) {
    // Will handle parse error later
  }
  
  const log = createLoggerFromEvent('generate-insights-background', event, context, { jobId });
  log.entry({ method: event.httpMethod, path: event.path, jobId });
  const timer = createTimer(log, 'background-insights');
  
  if (!validateEnvironment(log)) {
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // Extract client IP for security logging
  const clientIp = event?.headers?.['x-nf-client-connection-ip'] || 'unknown';

  try {
    // =====================
    // SECURITY: Rate Limiting
    // =====================
    log.debug('Checking rate limits', { endpoint: 'insights-background', clientIp });
    let rateLimitResult;
    try {
      rateLimitResult = await applyRateLimit(event, 'insights', log);
      log.rateLimit('allowed', {
        endpoint: 'insights-background',
        clientIp,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit
      });
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitError) {
        log.rateLimit('blocked', {
          endpoint: 'insights-background',
          clientIp,
          retryAfterMs: rateLimitError.retryAfterMs
        });
        timer.end({ rateLimited: true });
        log.exit(429);
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

    const rateLimitHeaders = rateLimitResult?.headers || {};

    // Parse job details from event
    let jobId, analysisData, systemId, customPrompt;

    if (event.body) {
      let body;
      try {
        body = JSON.parse(event.body);
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

      // =====================
      // SECURITY: Input Sanitization
      // =====================
      try {
        if (body.jobId) {
          jobId = sanitizeJobId(body.jobId, log);
        }
      } catch (sanitizeError) {
        if (sanitizeError instanceof SanitizationError) {
          log.audit('injection_blocked', {
            field: 'jobId',
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
              field: 'jobId'
            })
          };
        }
        throw sanitizeError;
      }
      
      // If only jobId is provided, fetch job data from database
      if (jobId && !body.analysisData) {
        log.info('Fetching job data from database', { jobId });
        
        // Audit log data access
        log.dataAccess('job_fetch', {
          jobId,
          clientIp
        });
        
        const job = await getInsightsJob(jobId, log);
        
        if (!job) {
          log.warn('Job not found', { jobId });
          await failJob(jobId, 'Job not found during background processing', log);
          return {
            statusCode: 200,
            headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'Job not found',
              jobId
            })
          };
        }
        
        analysisData = job.analysisData;
        systemId = job.systemId;
        customPrompt = job.customPrompt;
      } else {
        // Use data from request body (sanitize systemId if provided)
        analysisData = body.analysisData;
        if (body.systemId) {
          try {
            systemId = sanitizeSystemId(body.systemId, log);
          } catch (sanitizeError) {
            if (sanitizeError instanceof SanitizationError) {
              log.audit('injection_blocked', {
                field: 'systemId',
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
                  field: 'systemId'
                })
              };
            }
            throw sanitizeError;
          }
        }
        customPrompt = body.customPrompt;
      }
    } else if (event.jobId) {
      // Direct invocation - still sanitize jobId
      try {
        jobId = sanitizeJobId(event.jobId, log);
      } catch (sanitizeError) {
        log.audit('injection_blocked', {
          field: 'jobId',
          type: 'direct_invocation',
          clientIp
        });
        return {
          statusCode: 400,
          headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'invalid_input',
            message: 'Invalid jobId format'
          })
        };
      }
      analysisData = event.analysisData;
      systemId = event.systemId;
      customPrompt = event.customPrompt;
    }

    // Validate we have required data
    if (!jobId) {
      return {
        statusCode: 400,
        headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing jobId'
        })
      };
    }

    // Audit log background job start
    log.dataAccess('background_job_start', {
      jobId,
      systemId,
      clientIp,
      hasAnalysisData: !!analysisData,
      hasCustomPrompt: !!customPrompt
    });

    log.info('Background job started', {
      jobId,
      hasAnalysisData: !!analysisData,
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt
    });

    // Process the insights job
    log.debug('Starting background processing', { jobId });
    const processingTimer = createTimer(log, 'background-processing');
    const result = await processInsightsInBackground(
      jobId,
      analysisData,
      systemId,
      customPrompt,
      log
    );
    processingTimer.end({ jobId, success: result.success });

    const durationMs = timer.end({ jobId, success: result.success });
    log.info('Background job completed', {
      jobId,
      success: result.success,
      durationMs
    });

    log.exit(200, { jobId, success: result.success });
    return {
      statusCode: 200,
      headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId,
        result
      })
    };

  } catch (error) {
    timer.end({ error: true });
    log.error('Background job failed', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      errorType: error.constructor?.name
    });

    // Try to mark job as failed if we have a jobId
    let errorJobId;
    try {
      if (event.body) {
        const body = JSON.parse(event.body);
        if (body.jobId) {
          // Re-sanitize for safety
          try {
            errorJobId = sanitizeJobId(body.jobId, log);
          } catch {
            // Ignore sanitization errors in error handler
          }
        }
      } else if (event.jobId) {
        try {
          errorJobId = sanitizeJobId(event.jobId, log);
        } catch {
          // Ignore sanitization errors in error handler
        }
      }
      
      if (errorJobId) {
        await failJob(errorJobId, error.message, log);
        log.info('Job marked as failed', { jobId: errorJobId });
      }
    } catch (failError) {
      log.error('Failed to mark job as failed', {
        error: failError.message,
        stack: failError.stack,
        originalError: error.message
      });
    }

    log.exit(200, { error: true, jobId: errorJobId });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        jobId: errorJobId
      })
    };
  }
};
