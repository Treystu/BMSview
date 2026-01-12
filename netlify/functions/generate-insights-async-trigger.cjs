/**
 * Generate Insights Async Trigger - DB-free enqueue endpoint
 * 
 * This endpoint validates input, rate-limits, generates a jobId, and enqueues
 * the async workload. MongoDB access and job persistence are handled entirely
 * by the background handler to keep this trigger bundle lightweight.
 * 
 * ARCHITECTURE:
 * 1. Trigger endpoint (this file): Generate jobId + enqueue async workload event
 * 2. Netlify async workloads: Invoke generate-insights-background.mjs with event data
 * 3. Background handler: Creates/updates job in MongoDB and processes the job
 * 
 * SECURITY HARDENING:
 * - Rate limiting per user/system
 * - Input sanitization (jobId, systemId validation)
 * - Audit logging for compliance
 * 
 * INSIGHTS-SPECIFIC DUPLICATE CHECK:
 * - This is DIFFERENT from main app analysis duplicate detection
 * - Main app: Checks if user uploaded same screenshot (duplicate upload)
 * - Insights: Checks if screenshot was already ANALYZED (avoids re-processing)
 * - Purpose: Save API calls by returning cached analysis if image already processed
 * - Note: User can still generate different insights on same analysis with different prompts
 * 
 * NOTE: This is CommonJS (.cjs) for compatibility. @netlify/async-workloads is
 * only touched by the async client (externalized) and the background handler.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { sanitizeSystemId, SanitizationError } = require('./utils/security-sanitizer.cjs');
const { calculateImageHash } = require('./utils/unified-deduplication.cjs');
const { triggerInsightsWorkload } = require('./utils/insights-async-client.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

const generateJobId = () => `insights_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Lightweight in-memory rate limiter (per-instance) to avoid bundling MongoDB
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20; // conservative cap for async insights trigger
const rateBuckets = new Map();

const applyInMemoryRateLimit = (event, log) => {
  const identifier = event.headers['x-forwarded-for']
    || event.headers['x-nf-client-connection-ip']
    || event.headers['client-ip']
    || 'global';

  const now = Date.now();
  const existing = rateBuckets.get(identifier) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now >= existing.resetAt) {
    existing.count = 0;
    existing.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  existing.count += 1;
  rateBuckets.set(identifier, existing);

  if (existing.count > RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    log?.warn?.('Rate limit exceeded (in-memory)', { identifier, count: existing.count, limit: RATE_LIMIT_MAX });
    return {
      limited: true,
      identifier,
      limit: RATE_LIMIT_MAX,
      headers: { 'Retry-After': `${retryAfterSeconds}` }
    };
  }

  return {
    limited: false,
    headers: { 'X-RateLimit-Limit': `${RATE_LIMIT_MAX}`, 'X-RateLimit-Remaining': `${Math.max(0, RATE_LIMIT_MAX - existing.count)}` }
  };
};

/**
 * Handler for triggering async workload via job creation
 * 
 * NOTE: This function does NOT import or use @netlify/async-workloads package.
 * That package is only for use inside the async workload handler itself.
 * This trigger just creates a job in MongoDB, and Netlify's infrastructure
 * will automatically invoke the background handler to process it.
 */
exports.handler = async (event) => {
  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('generate-insights-async-trigger', event);
  const timer = createTimer();

  // Unified logging: also forward to centralized collector
  const forwardLog = createForwardingLogger('generate-insights-async-trigger');

  try {
    log.info('Async trigger invoked', {
      method: event.httpMethod,
      path: event.path,
      clientIp: event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip']
    });

    // Apply lightweight in-memory rate limiting (per Lambda instance)
    const rateLimitResult = applyInMemoryRateLimit(event, log);
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
    // For Full Context mode, analysisData is optional (we analyze history)
    // For other modes, analysisData is required
    const requiresAnalysisData = !fullContextMode;

    if ((requiresAnalysisData && !analysisData) || !systemId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'MISSING_REQUIRED_FIELDS',
          message: requiresAnalysisData ? 'analysisData and systemId are required' : 'systemId is required'
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

    // Optional: content hash for downstream dedup (background owns DB lookup)
    let contentHash = null;
    if (analysisData && analysisData.image) {
      try {
        console.log('[ASYNC-TRIGGER] Calculating content hash from image');
        contentHash = calculateImageHash(analysisData.image, log);
        console.log('[ASYNC-TRIGGER] Content hash calculated:', contentHash ? contentHash.substring(0, 16) + '...' : 'null');
      } catch (hashError) {
        console.warn('[ASYNC-TRIGGER] Failed to calculate content hash:', hashError.message);
        log.warn('Content hash calculation failed', { error: hashError.message });
      }
    }

    const jobId = generateJobId();

    log.info('Enqueuing async insights workload', {
      jobId,
      systemId: sanitizedSystemId,
      hasCustomPrompt: !!customPrompt,
      contextWindowDays,
      maxIterations,
      fullContextMode,
      contentHash: contentHash ? contentHash.substring(0, 16) + '...' : 'none'
    });

    const { eventId } = await triggerInsightsWorkload({
      jobId,
      analysisData,
      systemId: sanitizedSystemId,
      customPrompt,
      contextWindowDays,
      maxIterations,
      modelOverride,
      fullContextMode
    });

    log.info('Async workload queued', {
      jobId,
      eventId,
      status: 'queued',
      duration: timer.end()
    });

    return {
      statusCode: 202, // Accepted
      headers: {
        ...headers,
        ...rateLimitHeaders
      },
      body: JSON.stringify({
        jobId,
        eventId,
        status: 'queued',
        statusUrl: `/.netlify/functions/generate-insights-status?jobId=${jobId}`,
        message: 'Job accepted. Background processing will begin shortly. Poll the statusUrl for updates.'
      })
    };

  } catch (error) {
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
