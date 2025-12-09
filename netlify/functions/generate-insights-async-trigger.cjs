/**
 * Generate Insights Async Trigger - Job Creation Endpoint
 * 
 * This endpoint creates a job in MongoDB for background processing.
 * It does NOT trigger the async workload directly - that's handled by Netlify's
 * infrastructure which invokes generate-insights-background.mjs automatically.
 * 
 * ARCHITECTURE:
 * 1. Trigger endpoint (this file): Creates job with "pending" status in MongoDB
 * 2. Netlify infrastructure: Automatically invokes background handler for pending jobs
 * 3. Background handler: Uses @netlify/async-workloads features to process the job
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
 * NOTE: This is CommonJS (.cjs) for compatibility.
 * The @netlify/async-workloads package is ONLY used in the background handler,
 * not here in the trigger. This avoids package import issues.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { createInsightsJob } = require('./utils/insights-jobs.cjs');
const { applyRateLimit, RateLimitError } = require('./utils/rate-limiter.cjs');
const { sanitizeJobId, sanitizeSystemId, SanitizationError } = require('./utils/security-sanitizer.cjs');
const { calculateImageHash } = require('./utils/unified-deduplication.cjs');
const { getCollection } = require('./utils/mongodb.cjs');

/**
 * Handler for triggering async workload via job creation
 * 
 * NOTE: This function does NOT import or use @netlify/async-workloads package.
 * That package is only for use inside the async workload handler itself.
 * This trigger just creates a job in MongoDB, and Netlify's infrastructure
 * will automatically invoke the background handler to process it.
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

    // INSIGHTS-SPECIFIC DUPLICATE CHECK
    // This is DIFFERENT from analysis duplicate detection:
    // - Analysis duplicate: Checks if same image was uploaded (main app flow)
    // - Insights duplicate: Checks if image was already ANALYZED (to avoid wasting API calls)
    // 
    // Purpose: If the BMS screenshot was already analyzed, return existing analysis data
    // instead of re-running analysis. User can still generate insights with different
    // prompts/parameters on the same analysis data.
    console.log('[ASYNC-TRIGGER] Checking for existing analysis to avoid re-processing');
    let contentHash = null;
    if (analysisData && analysisData.image) {
      try {
        console.log('[ASYNC-TRIGGER] Calculating content hash from image');
        contentHash = calculateImageHash(analysisData.image);
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
          console.log('[ASYNC-TRIGGER] Existing analysis found! Returning cached result:', {
            recordId: existingAnalysis._id,
            timestamp: existingAnalysis.timestamp,
            hasAnalysis: !!existingAnalysis.analysis
          });
          
          log.info('Existing analysis found, returning cached result (insights duplicate check)', {
            contentHash: contentHash.substring(0, 16) + '...',
            recordId: existingAnalysis._id
          });

          // Return existing analysis immediately (no job creation needed)
          // This saves API calls and improves response time
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
          console.log('[ASYNC-TRIGGER] No existing analysis found - will process image');
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

    // Job created successfully - background handler will pick it up
    // NOTE: We do NOT import @netlify/async-workloads here. That package is ONLY for use
    // inside the async workload handler (generate-insights-background.mjs).
    // The trigger just creates a job with "pending" status, and the background handler
    // polls for pending jobs and processes them using the async workload features.
    console.log('[ASYNC-TRIGGER] Job created with pending status - background handler will process');
    
    log.info('Job created for async processing', {
      jobId: job.id,
      status: 'pending',
      duration: timer.end()
    });

    // Return immediately with job ID for status polling
    // The background handler will pick up this job and process it
    return {
      statusCode: 202, // Accepted
      headers: {
        ...headers,
        ...rateLimitHeaders
      },
      body: JSON.stringify({
        jobId: job.id,
        status: 'pending',
        statusUrl: `/.netlify/functions/generate-insights-status?jobId=${job.id}`,
        message: 'Job created successfully. Background processing will begin shortly. Poll the statusUrl for updates.'
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
