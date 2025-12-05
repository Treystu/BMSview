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
    let job;
    try {
      console.log('[ASYNC-TRIGGER] Creating job with params:', { systemId: sanitizedSystemId, hasAnalysisData: !!analysisData });
      job = await createInsightsJob({
        systemId: sanitizedSystemId,
        analysisData,
        customPrompt,
        contextWindowDays,
        maxIterations,
        modelOverride,
        fullContextMode
      }, log);  // Pass log as second argument
      console.log('[ASYNC-TRIGGER] Job created successfully:', job.id);
      log.info('Job created', { jobId: job.id });
    } catch (jobError) {
      console.error('[ASYNC-TRIGGER] Job creation failed:', jobError.message, jobError.stack);
      log.error('Failed to create job', { error: jobError.message, stack: jobError.stack });
      throw new Error(`Job creation failed: ${jobError.message}`);
    }

    // Trigger async workload via Netlify's HTTP API
    // Netlify auto-generates async-workloads-* functions that provide the async workload system
    // Using HTTP API avoids package import and 250MB bundle size issues
    let result;
    try {
      console.log('[ASYNC-TRIGGER] Triggering workload via HTTP API');
      const apiUrl = `${process.env.URL}/.netlify/functions/async-workloads-api`;
      console.log('[ASYNC-TRIGGER] API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workload: 'generate-insights',
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
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      result = await response.json();
      console.log('[ASYNC-TRIGGER] Workload triggered successfully:', result);
      log.info('Async workload triggered', { workloadId: result.id || result.eventId });
    } catch (sendError) {
      console.error('[ASYNC-TRIGGER] Workload trigger failed:', sendError.message, sendError.stack);
      log.error('Failed to trigger async workload', { error: sendError.message, stack: sendError.stack });
      throw new Error(`Async workload trigger failed: ${sendError.message}`);
    }

    log.info('Async workload triggered', {
      jobId: job.id,
      workloadId: result.id || result.eventId,
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
        workloadId: result.id || result.eventId,
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

    console.error('[ASYNC-TRIGGER] Error caught in handler:', {
      errorType: error.constructor.name,
      message: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: error.message, // Show specific error message, not generic
        errorType: error.constructor.name,
        details: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : error.message
      })
    };
  }
};
