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
const { sha256HexFromBase64 } = require('./utils/hash.cjs');
const { getCollection } = require('./utils/mongodb.cjs');

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

    // CHECK FOR DUPLICATES FIRST (same as analyze.cjs)
    // Calculate content hash from image to check if we've already analyzed this exact screenshot
    console.log('[ASYNC-TRIGGER] Checking for duplicate analysis');
    let contentHash = null;
    if (analysisData && analysisData.image) {
      try {
        console.log('[ASYNC-TRIGGER] Calculating content hash from image');
        contentHash = sha256HexFromBase64(analysisData.image);
        console.log('[ASYNC-TRIGGER] Content hash calculated:', contentHash ? contentHash.substring(0, 16) + '...' : 'null');
      } catch (hashError) {
        console.warn('[ASYNC-TRIGGER] Failed to calculate content hash:', hashError.message);
        log.warn('Content hash calculation failed', { error: hashError.message });
      }
    }

    // Check for existing analysis with same content hash
    if (contentHash) {
      try {
        console.log('[ASYNC-TRIGGER] Querying database for existing analysis');
        const resultsCol = await getCollection('analysis-results');
        const existingAnalysis = await resultsCol.findOne({ contentHash });
        
        if (existingAnalysis) {
          console.log('[ASYNC-TRIGGER] Duplicate found! Returning existing analysis:', {
            recordId: existingAnalysis._id,
            timestamp: existingAnalysis.timestamp,
            hasAnalysis: !!existingAnalysis.analysis
          });
          
          log.info('Duplicate analysis found, returning existing result', {
            contentHash: contentHash.substring(0, 16) + '...',
            recordId: existingAnalysis._id
          });

          // Return existing analysis immediately (no job creation needed)
          return {
            statusCode: 200,
            headers: {
              ...headers,
              ...rateLimitHeaders
            },
            body: JSON.stringify({
              isDuplicate: true,
              recordId: existingAnalysis._id,
              timestamp: existingAnalysis.timestamp,
              analysisData: existingAnalysis.analysis,
              message: 'This image has already been analyzed. Returning existing results.'
            })
          };
        } else {
          console.log('[ASYNC-TRIGGER] No duplicate found - proceeding with new analysis');
        }
      } catch (dbError) {
        console.error('[ASYNC-TRIGGER] Database check failed:', dbError.message);
        log.warn('Duplicate check failed, proceeding with analysis', { error: dbError.message });
        // Continue with job creation if duplicate check fails
      }
    }

    log.info('Creating insights job', {
      systemId: sanitizedSystemId,
      hasCustomPrompt: !!customPrompt,
      contextWindowDays,
      maxIterations,
      fullContextMode,
      contentHash: contentHash ? contentHash.substring(0, 16) + '...' : 'none'
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

    // Trigger async workload using package import (NOT HTTP API)
    // HTTP API approach failed with 404 - async-workloads-api is internal Netlify infrastructure
    // Using dynamic import() to load ES Module package from node_modules (included in function zip)
    let result;
    try {
      console.log('[ASYNC-TRIGGER] Attempting dynamic import of @netlify/async-workloads package');
      const { AsyncWorkloadsClient } = await import('@netlify/async-workloads');
      console.log('[ASYNC-TRIGGER] Package imported successfully, typeof AsyncWorkloadsClient:', typeof AsyncWorkloadsClient);
      
      console.log('[ASYNC-TRIGGER] Creating AsyncWorkloadsClient instance');
      const client = new AsyncWorkloadsClient();
      console.log('[ASYNC-TRIGGER] Client created, typeof client.send:', typeof client.send);
      
      console.log('[ASYNC-TRIGGER] Sending event to generate-insights workload');
      const payload = {
        jobId: job.id,
        analysisData,
        systemId: sanitizedSystemId,
        customPrompt,
        contextWindowDays,
        maxIterations,
        modelOverride,
        fullContextMode
      };
      console.log('[ASYNC-TRIGGER] Payload keys:', Object.keys(payload));
      
      result = await client.send('generate-insights', payload);
      console.log('[ASYNC-TRIGGER] Workload event sent successfully, result:', result);
      log.info('Async workload triggered via package', { eventId: result.id || result.eventId });
    } catch (sendError) {
      console.error('[ASYNC-TRIGGER] Package import/send failed:', {
        errorType: sendError.constructor.name,
        message: sendError.message,
        stack: sendError.stack
      });
      log.error('Failed to trigger async workload', { error: sendError.message, stack: sendError.stack });
      throw new Error(`Async workload trigger failed: ${sendError.message}`);
    }

    log.info('Async workload triggered', {
      jobId: job.id,
      eventId: result.id || result.eventId,
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
        eventId: result.id || result.eventId,
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
