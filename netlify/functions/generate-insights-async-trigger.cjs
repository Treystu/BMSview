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
 * 
 * NOTE: This is CommonJS (.cjs) using dynamic import() for ES Module package.
 * @netlify/async-workloads is an ES Module - we use dynamic import() to load it.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { createInsightsJob } = require('./utils/insights-jobs.cjs');
const { applyRateLimit, RateLimitError } = require('./utils/rate-limiter.cjs');
const { sanitizeJobId, sanitizeSystemId, SanitizationError } = require('./utils/security-sanitizer.cjs');

/**
 * Handler for triggering async workload
 * 
 * NOTE: Using dynamic import() for @netlify/async-workloads (ES Module).
 * This is the ONLY way to use ES Module packages from CommonJS.
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('generate-insights-async-trigger', event);
  const timer = createTimer();
  
  try {
    log.info('Async trigger invoked', {
      method: event.httpMethod,
      path: event.path,
      clientIp: event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip']
    });

    // Apply rate limiting
    const rateLimitResult = await applyRateLimit(event, 'async-insights', log);
    if (rateLimitResult.limited) {
      log.warn('Rate limit exceeded', {
        identifier: rateLimitResult.identifier,
        limit: rateLimitResult.limit
      });
      
      return {
        statusCode: 429,
        headers: {
          ...headers,
          ...rateLimitResult.headers
        },
        body: JSON.stringify({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: rateLimitResult.headers['Retry-After']
        })
      };
    }

    const rateLimitHeaders = rateLimitResult?.headers || {};
    
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      analysisData,
      systemId,
      customPrompt,
      contextWindowDays = 30,
      maxIterations = 10,
      modelOverride,
      fullContextMode = false,
      consentGranted = false
    } = body;

    // Validate required fields
    if (!analysisData || !systemId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'MISSING_REQUIRED_FIELDS',
          message: 'analysisData and systemId are required'
        })
      };
    }

    // Validate user consent
    if (!consentGranted) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'CONSENT_REQUIRED',
          message: 'User consent is required for async processing mode'
        })
      };
    }

    // Sanitize inputs
    const sanitizedSystemId = sanitizeSystemId(systemId, log);

    log.info('Creating insights job', {
      systemId: sanitizedSystemId,
      hasCustomPrompt: !!customPrompt,
      contextWindowDays,
      maxIterations,
      fullContextMode
    });

    // Create job in MongoDB
    const job = await createInsightsJob({
      systemId: sanitizedSystemId,
      analysisData,
      customPrompt,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode
    });

    log.info('Job created', { jobId: job.id });

    // Trigger async workload using dynamic import
    // Dynamic import() is required because @netlify/async-workloads is an ES Module
    const { AsyncWorkloadsClient } = await import('@netlify/async-workloads');
    const client = new AsyncWorkloadsClient();
    const result = await client.send('generate-insights', {
      data: {
        jobId: job.id,
        analysisData,
        systemId: sanitizedSystemId,
        customPrompt,
        contextWindowDays,
        maxIterations,
        modelOverride,
        fullContextMode
      },
      priority: 5 // Normal priority (0-10 scale, 5 = default)
    });

    log.info('Async workload triggered', {
      jobId: job.id,
      eventId: result.eventId,
      duration: timer.end()
    });

    // Return immediately with job ID
    return {
      statusCode: 202, // Accepted
      headers: {
        ...headers,
        ...rateLimitHeaders
      },
      body: JSON.stringify({
        jobId: job.id,
        eventId: result.eventId,
        status: 'processing',
        statusUrl: `/.netlify/functions/generate-insights-status?jobId=${job.id}`,
        message: 'Insights generation started. Poll the statusUrl for updates.'
      })
    };

  } catch (error) {
    if (error instanceof RateLimitError) {
      log.warn('Rate limit error caught', { error: error.message });
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: 'RATE_LIMIT_ERROR',
          message: error.message
        })
      };
    }

    if (error instanceof SanitizationError) {
      log.warn('Sanitization error caught', { error: error.message });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'INVALID_INPUT',
          message: error.message
        })
      };
    }

    log.error('Async trigger error', {
      error: error.message,
      stack: error.stack,
      duration: timer.end({ error: true })
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to trigger async workload. Please try again later.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};
