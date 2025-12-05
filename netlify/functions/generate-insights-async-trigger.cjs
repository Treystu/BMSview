/**
 * Generate Insights Async Trigger - Trigger Endpoint for Async Workload
 * 
 * This endpoint triggers the Netlify Async Workload for insights generation.
 * It creates a job, sends an event to the async workload system, and returns immediately.
 * 
 * The actual processing happens in generate-insights-background.mjs via async workload.
 * 
 * SECURITY HARDENING:
 * - Rate limiting per user/system
 * - Input sanitization (jobId, systemId validation)
 * - Audit logging for compliance
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { createInsightsJob } = require('./utils/insights-jobs.cjs');
const { AsyncWorkloadsClient } = require('@netlify/async-workloads');
const { applyRateLimit, RateLimitError } = require('./utils/rate-limiter.cjs');
const { sanitizeJobId, sanitizeSystemId, SanitizationError } = require('./utils/security-sanitizer.cjs');

/**
 * Handler for triggering async workload
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLoggerFromEvent('generate-insights-async-trigger', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'async-trigger');
  
  // Extract client IP for security logging
  const clientIp = event?.headers?.['x-nf-client-connection-ip'] || 'unknown';
  
  try {
    // =====================
    // SECURITY: Rate Limiting
    // =====================
    log.debug('Checking rate limits', { endpoint: 'async-insights', clientIp });
    let rateLimitResult;
    try {
      rateLimitResult = await applyRateLimit(event, 'async-insights', log);
      log.rateLimit('allowed', {
        endpoint: 'async-insights',
        clientIp,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit
      });
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitError) {
        log.rateLimit('blocked', {
          endpoint: 'async-insights',
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
    
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      analysisData,
      systemId,
      customPrompt,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode,
      consentGranted
    } = body;
    
    if (!analysisData || !systemId) {
      return {
        statusCode: 400,
        headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'analysisData and systemId are required'
        })
      };
    }
    
    if (!consentGranted) {
      return {
        statusCode: 400,
        headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'User consent is required for async workload processing'
        })
      };
    }
    
    // =====================
    // SECURITY: Input Sanitization
    // =====================
    let sanitizedSystemId;
    try {
      sanitizedSystemId = sanitizeSystemId(systemId, log);
      log.debug('System ID sanitized', { original: systemId, sanitized: sanitizedSystemId });
    } catch (sanitizeError) {
      if (sanitizeError instanceof SanitizationError) {
        log.warn('Input sanitization failed', {
          field: 'systemId',
          value: systemId,
          reason: sanitizeError.message,
          clientIp
        });
        timer.end({ sanitizationFailed: true });
        log.exit(400);
        return {
          statusCode: 400,
          headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'invalid_input',
            message: sanitizeError.message
          })
        };
      }
      throw sanitizeError;
    }
    
    log.info('Creating job for async workload', {
      hasAnalysisData: !!analysisData,
      systemId: sanitizedSystemId,
      contextWindowDays,
      maxIterations,
      fullContextMode,
      clientIp
    });
    
    // Create job in database
    const job = await createInsightsJob({
      analysisData,
      systemId: sanitizedSystemId,
      customPrompt,
      initialSummary: null,
      contextWindowDays,
      maxIterations,
      fullContextMode
    }, log);
    
    log.info('Job created, triggering async workload', { jobId: job.id });
    
    // Trigger async workload event directly using AsyncWorkloadsClient
    // Package is externalized via netlify.toml, not bundled into function
    const client = new AsyncWorkloadsClient();
    const eventData = {
      jobId: job.id,
      analysisData,
      systemId: sanitizedSystemId,
      customPrompt,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode
    };
    
    const result = await client.send('generate-insights', {
      data: eventData,
      priority: 5 // Normal priority
    });
    
    const eventId = result.eventId;
    
    const durationMs = timer.end({ jobId: job.id, eventId });
    log.info('Async workload triggered successfully', { jobId: job.id, eventId, durationMs });
    log.exit(202);
    
    // Return job info immediately (workload runs asynchronously)
    return {
      statusCode: 202,
      headers: { ...headers, ...rateLimitHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId: job.id,
        eventId,
        status: 'queued',
        message: 'Async workload triggered successfully. Use jobId to poll for status.',
        statusUrl: `/.netlify/functions/generate-insights-status?jobId=${job.id}`,
        mode: 'async-workload',
        info: {
          maxTimeout: 'unlimited',
          retries: 'automatic with exponential backoff',
          steps: 6,
          features: ['durable execution', 'state persistence', 'event chaining']
        }
      })
    };
    
  } catch (error) {
    timer.end({ error: true });
    log.error('Failed to trigger async workload', {
      error: error.message,
      stack: error.stack
    });
    
    log.exit(500);
    
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
