/**
 * Lambda function handler for analyzing image data.
 * 
 * **PRIVACY NOTICE**: This is an unauthenticated API endpoint. Analysis results are stored
 * and retrieved based on image content hash (SHA-256) only, without user isolation. 
 * Anyone with the same BMS screenshot can view the analysis results. Do not upload
 * screenshots containing sensitive or private information.
 * 
 * Dependencies:
 * - utils/errors: { errorResponse } - Error handling utilities
 * - utils/validation: { parseJsonBody, validateAnalyzeRequest, validateImagePayload } - Request validation
 * - utils/logger: { createLogger, createTimer } - Logging and timing utilities
 * - utils/analysis-pipeline: { performAnalysisPipeline } - Core analysis implementation
 * - utils/hash: { sha256HexFromBase64 } - Content hashing utilities
 * - utils/mongodb: { getCollection } - MongoDB connection and collection access
 * - utils/retry: { withTimeout, retryAsync, circuitBreaker } - Retry and circuit breaker patterns
 * - utils/duplicate-constants: Shared constants for duplicate detection logic
 * * Required Environment Variables:
 * - ANALYSIS_TIMEOUT_MS: Analysis pipeline timeout (default: 60000)
 * - ANALYSIS_RETRIES: Number of retry attempts (default: 2)
 * - ANALYSIS_RETRY_BASE_MS: Base delay between retries (default: 250)
 * - ANALYSIS_RETRY_JITTER_MS: Jitter added to retry delay (default: 200)
 * - CB_FAILURES: Circuit breaker failure threshold (default: 5)
 * - CB_OPEN_MS: Circuit breaker open duration (default: 30000)
 * * MongoDB Collections Used:
 * - idempotent-requests: Stores request/response pairs for idempotency
 * - analysis-results: Stores analysis results and content hashes for deduplication
 * - progress-events: Stores legacy job progress events
 */

const { errorResponse } = require('./utils/errors.cjs');
const { parseJsonBody, validateAnalyzeRequest, validateImagePayload } = require('./utils/validation.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');
const { sha256HexFromBase64 } = require('./utils/hash.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { withTimeout, retryAsync, circuitBreaker } = require('./utils/retry.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { handleStoryModeAnalysis } = require('./utils/story-mode.cjs');
const { 
  DUPLICATE_UPGRADE_THRESHOLD, 
  MIN_QUALITY_IMPROVEMENT, 
  CRITICAL_FIELDS 
} = require('./utils/duplicate-constants.cjs');

/**
 * Validate that required environment variables are set
 * @param {any} log - Logger instance
 * @returns {any} Validation result { ok: boolean, error?: string, details?: Object }
 */
function validateEnvironment(log) {
  const missing = [];
  const warnings = [];

  // Critical: Must have Gemini API key
  if (!process.env.GEMINI_API_KEY) {
    missing.push('GEMINI_API_KEY');
  }

  // Critical: Must have MongoDB URI
  if (!process.env.MONGODB_URI) {
    missing.push('MONGODB_URI');
  }

  // Warning: Should have database name
  if (!process.env.MONGODB_DB_NAME && !process.env.MONGODB_DB) {
    warnings.push('MONGODB_DB_NAME (will use default: bmsview)');
  }

  if (missing.length > 0) {
    const error = `Missing required environment variables: ${missing.join(', ')}`;
    log.error('Environment validation failed', { missing, warnings });
    return {
      ok: false,
      error,
      details: {
        missing,
        warnings,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasMongoUri: !!process.env.MONGODB_URI
      }
    };
  }

  if (warnings.length > 0) {
    log.warn('Environment has warnings', { warnings });
  }

  return { ok: true };
}

/**
 * Determine appropriate HTTP status code for an error
 * @param {Error} error - The error object
 * @returns {number} HTTP status code
 */
function getErrorStatusCode(error) {
  const message = error.message || '';
  const code = error.code || '';

  // Gateway timeout for backend service timeouts (504)
  if (code === 'operation_timeout' || message.includes('operation_timeout')) {
    return 504;
  }
  
  // Client errors (400-499)
  if (message.includes('invalid') || message.includes('validation')) return 400;
  if (message.includes('unauthorized') || message.includes('authentication')) return 401;
  if (message.includes('forbidden')) return 403;
  if (message.includes('not found')) return 404;
  // Client-side timeout (408) for generic timeout messages
  if (message.includes('timeout') || message.includes('TIMEOUT') || message.includes('timed out')) return 408;
  if (message.includes('quota') || message.includes('rate limit')) return 429;

  // Service errors (500-599)
  if (message.includes('service_unavailable') || message.includes('ECONNREFUSED')) return 503;
  if (message.includes('circuit_open')) return 503;

  // Default to 500 for unknown errors
  return 500;
}

/**
 * Determine appropriate error code for an error
 * @param {Error} error - The error object
 * @returns {string} Error code
 */
function getErrorCode(error) {
  const message = error.message || '';

  const code = error.code || '';
  
  // Gateway timeout for backend service timeouts
  if (code === 'operation_timeout' || message.includes('operation_timeout')) return 'gateway_timeout';
  if (message.includes('timeout') || message.includes('TIMEOUT')) return 'analysis_timeout';
  if (message.includes('quota') || message.includes('rate limit')) return 'quota_exceeded';
  if (message.includes('ECONNREFUSED') || message.includes('connection')) return 'database_unavailable';
  if (message.includes('circuit_open')) return 'service_degraded';
  if (message.includes('Gemini')) return 'ai_service_error';

  return 'analysis_failed';
}

/**
 * @param {import('@netlify/functions').HandlerEvent} event
 * @param {import('@netlify/functions').HandlerContext} context
 */
exports.handler = async (event, context) => {
  // Get CORS headers (strict mode in production, permissive in development)
  const headers = getCorsHeaders(event);

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
  }

  // Logger and request-scoped context
  /** @type {any} */
  const log = createLoggerFromEvent('analyze', event, context);
  log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });
  /** @type {any} */
  const timer = createTimer(log, 'analyze');

  // Validate environment before processing
  const envValidation = validateEnvironment(log);
  if (!envValidation.ok) {
    log.error('Environment validation failed', envValidation);
    timer.end({ error: 'env_validation_failed' });
    log.exit(503);
    return errorResponse(503, 'service_unavailable', envValidation.error, envValidation.details, headers);
  }

  const isSync = (event.queryStringParameters && event.queryStringParameters.sync === 'true');
  const forceReanalysis = (event.queryStringParameters && event.queryStringParameters.force === 'true');
  const checkOnly = (event.queryStringParameters && event.queryStringParameters.check === 'true');
  const headersIn = event.headers || {};
  const idemKey = headersIn['Idempotency-Key'] || headersIn['idempotency-key'] || headersIn['IDEMPOTENCY-KEY'];
  let requestContext = { jobId: undefined };

  try {
    // Parse and validate request body
    const parsed = parseJsonBody(event, log);
    if (!parsed.ok) {
      log.warn('Invalid JSON body for analyze request.', { error: parsed.error });
      timer.end({ error: 'invalid_json' });
      log.exit(400);
      return errorResponse(400, 'invalid_request', parsed.error || 'Invalid JSON', undefined, headers);
    }

    log.debug('Processing analysis', { isSync, forceReanalysis, checkOnly, hasIdemKey: !!idemKey });

    if (isSync) {
      // Synchronous analysis path with comprehensive error handling
      const result = await handleSyncAnalysis(parsed.value, idemKey || '', !!forceReanalysis, !!checkOnly, headers, log, context);
      timer.end({ mode: 'sync', statusCode: result.statusCode });
      log.exit(result.statusCode);
      return result;
    }

    // Legacy asynchronous analysis path
    const result = await handleLegacyAnalysis(parsed.value, headers, log, requestContext);
    timer.end({ mode: 'async', statusCode: result.statusCode });
    log.exit(result.statusCode);
    return result;

  } catch (/** @type {any} */ error) {
    timer.end({ error: true });
    log.error('Analyze function failed.', {
      error: error && error.message ? error.message : String(error),
      stack: error.stack,
      errorType: error.constructor?.name
    });

    // Best-effort legacy progress event logging
    try {
      if (requestContext.jobId) {
        await storeProgressEvent(requestContext.jobId, {
          stage: 'error',
          progress: 0,
          message: `Analysis failed: ${error.message}`
        });
      }
    } catch (_) {
      // Swallow cleanup errors to avoid masking primary error
    }

    // Determine appropriate status code and error type
    const statusCode = getErrorStatusCode(error);
    const errorCode = getErrorCode(error);

    log.exit(statusCode, { error: error.message, errorCode });
    return errorResponse(
      statusCode,
      errorCode,
      'Analysis failed',
      {
        message: error.message,
        type: error.constructor?.name,
        recoverable: statusCode < 500
      },
      { ...headers, 'Content-Type': 'application/json' }
    );
  }
};

/**
 * Handles synchronous image analysis requests
 * @param {any} requestBody - Parsed request body
 * @param {string} idemKey - Idempotency key if provided
 * @param {boolean} forceReanalysis - Whether to bypass duplicate detection
 * @param {boolean} checkOnly - Whether to only check for duplicates without full analysis
 * @param {any} headers - Response headers
 * @param {any} log - Logger instance
 * @param {any} context - Lambda context
 */
async function handleSyncAnalysis(requestBody, idemKey, forceReanalysis, checkOnly, headers, log, context) {
  /** @type {any} */
  const timer = createTimer(log, 'sync-analysis');

  // Story Mode is admin-only - requires explicit isAdmin flag
  if (requestBody.storyMode) {
    // Verify this is an admin request (isAdmin flag must be explicitly set)
    if (!requestBody.isAdmin) {
      log.warn('Story mode requested without admin privileges');
      return errorResponse(403, 'forbidden', 'Story mode is only available to administrators', undefined, { ...headers, 'Content-Type': 'application/json' });
    }
    log.info('Admin story mode analysis requested');
    return await handleStoryModeAnalysis(requestBody, idemKey, forceReanalysis, headers, log, context);
  }

  const imagePayload = requestBody && requestBody.image;

  try {
    // Validate image payload
    const imageValidation = validateImagePayload(imagePayload, log);
    if (!imageValidation.ok) {
      log.warn('Sync analyze image validation failed.', { reason: imageValidation.error });
      log.exit(400);
      return errorResponse(400, 'invalid_image', imageValidation.error || 'Invalid image', undefined, { ...headers, 'Content-Type': 'application/json' });
    }

    // Calculate content hash for deduplication
    const hashStartTime = Date.now();
    const contentHash = sha256HexFromBase64(imagePayload.image);
    const hashDurationMs = Date.now() - hashStartTime;
    
    if (!contentHash) {
      return errorResponse(400, 'invalid_image', 'Could not generate content hash', undefined, { ...headers, 'Content-Type': 'application/json' });
    }
    
    log.debug('Content hash calculated', {
      contentHash: contentHash.substring(0, 16) + '...',
      hashDurationMs,
      imageSize: imagePayload.image?.length || 0,
      fileName: imagePayload.fileName,
      event: 'HASH_CALCULATED'
    });

    // ***NEW: Check-only mode - return duplicate status without full analysis***
    if (checkOnly) {
      const checkOnlyStartTime = Date.now();
      try {
        log.info('Check-only mode: starting duplicate check', {
          contentHash: contentHash.substring(0, 16) + '...',
          fileName: imagePayload.fileName,
          event: 'CHECK_ONLY_START'
        });
        
        const existingAnalysis = await checkExistingAnalysis(contentHash || '', log);

        // Distinguish between true duplicates and upgrades needed
        const isDuplicate = !!existingAnalysis;
        const needsUpgrade = existingAnalysis?._isUpgrade || false;

        const checkResponse = {
          isDuplicate,
          needsUpgrade,
          recordId: existingAnalysis?.id || existingAnalysis?._id,
          timestamp: existingAnalysis?.timestamp,
          analysisData: !needsUpgrade && existingAnalysis ? existingAnalysis.analysis : null
        };

        const durationMs = timer.end({ checkOnly: true, isDuplicate, needsUpgrade });
        const checkOnlyDurationMs = Date.now() - checkOnlyStartTime;
        log.info('Check-only request complete', { 
          isDuplicate, 
          needsUpgrade, 
          durationMs,
          checkOnlyDurationMs,
          fileName: imagePayload.fileName,
          event: 'CHECK_ONLY_COMPLETE'
        });
        log.exit(200);

        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(checkResponse)
        };
      } catch (/** @type {any} */ checkError) {
        const checkOnlyDurationMs = Date.now() - checkOnlyStartTime;
        log.warn('Check-only request failed', { 
          error: checkError.message,
          checkOnlyDurationMs,
          fileName: imagePayload.fileName,
          event: 'CHECK_ONLY_ERROR'
        });
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ isDuplicate: false, needsUpgrade: false })
        };
      }
    }

    // Check idempotency cache (skip if force=true)
    if (idemKey && !forceReanalysis) {
      try {
        const idemResponse = await checkIdempotency(idemKey, log);
        if (idemResponse) {
          const durationMs = timer.end({ idempotent: true });
          log.exit(200, { mode: 'sync', idempotent: true, durationMs });
          return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(idemResponse)
          };
        }
      } catch (/** @type {any} */ idemError) {
        // Log but continue - idempotency is not critical
        log.warn('Idempotency check failed, continuing with analysis', {
          error: idemError.message,
          idemKey
        });
      }
    }

    // Check for existing analysis by content hash (skip if force=true)
    let isUpgrade = !!imagePayload._isUpgrade;
    let existingRecordToUpgrade = null;


    if (!forceReanalysis) {
      try {
        const existingAnalysis = await checkExistingAnalysis(contentHash || '', log);

        if (existingAnalysis) {
          // Check if checkExistingAnalysis flagged this as needing upgrade
          // (returns { _isUpgrade: true, _existingRecord: existing } when critical fields are missing)
          if (existingAnalysis._isUpgrade) {
            isUpgrade = true;
            existingRecordToUpgrade = existingAnalysis._existingRecord;
            log.info('Low-quality duplicate found, proceeding with upgrade.', {
              contentHash: contentHash.substring(0, 16) + '...',
              recordId: existingRecordToUpgrade._id
            });
          } else if (isUpgrade) {
            // Caller explicitly requested upgrade via imagePayload._isUpgrade
            existingRecordToUpgrade = existingAnalysis;
            log.info('Upgrade requested by caller, proceeding with upgrade.', {
              contentHash: contentHash.substring(0, 16) + '...',
              recordId: existingAnalysis._id
            });
          } else {
            // High-quality duplicate - return it
            const responseBody = {
              analysis: existingAnalysis.analysis,
              recordId: existingAnalysis._id?.toString?.() || existingAnalysis.id,
              fileName: existingAnalysis.fileName,
              timestamp: existingAnalysis.timestamp,
              isDuplicate: true
            };

            await storeIdempotentResponse(idemKey, responseBody, 'dedupe_hit');
            const durationMs = timer.end({ recordId: responseBody.recordId, dedupe: true });
            log.exit(200, { mode: 'sync', dedupe: true, durationMs });
            return {
              statusCode: 200,
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify(responseBody)
            };
          }
        }
      } catch (/** @type {any} */ dedupeError) {
        // Log but continue - deduplication is not critical
        log.warn('Duplicate check failed, continuing with analysis', {
          error: dedupeError.message,
          contentHash: contentHash.substring(0, 16) + '...'
        });
      }
    } else {
      log.info('Force re-analysis requested, bypassing duplicate detection.', {
        contentHash: contentHash.substring(0, 16) + '...',
        auditEvent: 'force_reanalysis',
        timestamp: new Date().toISOString()
      });
    }

    // Perform new analysis (critical path - errors thrown here are caught by main handler)
    log.info('Starting synchronous analysis via pipeline.', {
      fileName: imagePayload.fileName,
      mimeType: imagePayload.mimeType,
      imageSize: imagePayload.image?.length || 0
    });

    const record = await executeAnalysisPipeline(imagePayload, log, context);

    // Validate analysis result
    if (!record || !record.analysis) {
      throw new Error('Analysis pipeline returned invalid result');
    }

    // Store results for future deduplication (best effort)
    try {
      await storeAnalysisResults(record, contentHash || '', log, forceReanalysis, isUpgrade, existingRecordToUpgrade);
    } catch (/** @type {any} */ storageError) {
      // Log but don't fail - storage is not critical for immediate response
      log.warn('Failed to store analysis results for deduplication', {
        error: storageError.message,
        recordId: record.id
      });
    }

    const responseBody = {
      analysis: record.analysis,
      recordId: record.id,
      fileName: record.fileName,
      timestamp: record.timestamp,
      wasUpgraded: isUpgrade // Indicate if this was a quality upgrade
    };

    // Store idempotent response (best effort)
    try {
      const reasonCode = isUpgrade ? 'quality_upgrade' : (forceReanalysis ? 'force_reanalysis' : 'new_analysis');
      await storeIdempotentResponse(idemKey, responseBody, reasonCode);
    } catch (/** @type {any} */ idemStoreError) {
      // Log but don't fail
      log.warn('Failed to store idempotent response', { error: idemStoreError.message });
    }

    const durationMs = timer.end({ recordId: record.id });
    log.exit(200, { mode: 'sync', recordId: record.id, durationMs });
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(responseBody)
    };
  } catch (/** @type {any} */ error) {
    // Let main handler deal with the error
    timer.end({ error: error.message });
    throw error;
  }
}

/**
 * Handles legacy asynchronous analysis requests
 * @param {any} requestBody - Parsed request body
 * @param {any} headers - Response headers
 * @param {any} log - Logger instance
 * @param {any} requestContext - Request context for error handling
 */
async function handleLegacyAnalysis(requestBody, headers, log, requestContext) {
  const validated = validateAnalyzeRequest(requestBody, log);
  if (!validated.ok) {
    log.warn('Legacy analyze request missing parameters.', { details: validated.details });
    log.exit(400);
    return errorResponse(400, 'missing_parameters', validated.error || 'Missing parameters', validated.details, { ...headers, 'Content-Type': 'application/json' });
  }

  const { jobId, fileData } = /** @type {any} */ (validated).value;
  requestContext.jobId = jobId;

  log.info('Legacy analyze request received.', { jobId, fileBytes: fileData ? fileData.length : 0 });
  log.exit(202, { mode: 'legacy' });
  return {
    statusCode: 202,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, jobId, message: 'Legacy analysis accepted for processing' })
  };
}

/**
 * Checks for existing idempotent response
 * @param {string} idemKey - Idempotency key
 * @param {any} log - Logger instance
 * @returns {Promise<any>} Stored response if found
 */
async function checkIdempotency(idemKey, log) {
  if (!idemKey) return null;

  try {
    const idemCol = await getCollection('idempotent-requests');
    const existingIdem = await idemCol.findOne({ key: idemKey });
    if (existingIdem && existingIdem.response) {
      log.info('Idempotency hit: returning stored response.', { idemKey });
      return existingIdem.response;
    }
    return null;
  } catch (/** @type {any} */ error) {
    log.warn('Idempotency check failed', { error: /** @type {Error} */ (error).message, idemKey });
    // Re-throw to let caller decide how to handle
    throw error;
  }
}

/**
 * Checks for existing analysis by content hash
 * @param {string} contentHash - Content hash to check
 * @param {any} log - Logger instance
 * @returns {Promise<any>} Existing analysis if found and high quality, null if should re-analyze
 */
async function checkExistingAnalysis(contentHash, log) {
  const startTime = Date.now();
  try {
    const collectionStartTime = Date.now();
    const resultsCol = await getCollection('analysis-results');
    const collectionDurationMs = Date.now() - collectionStartTime;
    
    // Check for index existence on first call (log once)
    if (!checkExistingAnalysis._indexChecked) {
      try {
        const indexes = await resultsCol.indexes();
        const hasContentHashIndex = indexes.some(idx => 
          idx.key && idx.key.contentHash !== undefined
        );
        log.info('MongoDB index status for contentHash', {
          hasContentHashIndex,
          totalIndexes: indexes.length,
          indexNames: indexes.map(i => i.name).join(', '),
          event: 'INDEX_CHECK'
        });
        checkExistingAnalysis._indexChecked = true;
      } catch (indexErr) {
        log.warn('Failed to check indexes', { error: indexErr.message });
      }
    }
    
    const queryStartTime = Date.now();
    const existing = await resultsCol.findOne({ contentHash });
    const queryDurationMs = Date.now() - queryStartTime;
    
    if (existing) {
      log.info('Dedupe: existing analysis found for content hash.', {
        contentHash: contentHash.substring(0, 16) + '...',
        needsReview: existing.needsReview,
        validationScore: existing.validationScore,
        extractionAttempts: existing.extractionAttempts || 1,
        collectionDurationMs,
        queryDurationMs,
        event: 'FOUND'
      });

      const hasAllCriticalFields = CRITICAL_FIELDS.every(field =>
        existing.analysis &&
        existing.analysis[field] !== null &&
        existing.analysis[field] !== undefined
      );

      // Check for missing critical fields first (highest priority)
      if (!hasAllCriticalFields) {
        const missingFields = CRITICAL_FIELDS.filter(field => 
          !existing.analysis || 
          existing.analysis[field] === null || 
          existing.analysis[field] === undefined
        );
        
        log.warn('Existing record is missing critical fields. Will re-analyze to improve.', {
          contentHash: contentHash.substring(0, 16) + '...',
          extractionAttempts: existing.extractionAttempts || 1,
          missingFieldCount: missingFields.length,
          missingFields: missingFields.slice(0, 5), // Log first 5 to avoid log spam
          fileName: existing.fileName,
          recordId: existing._id || existing.id,
          decision: 'UPGRADE',
          event: 'UPGRADE_NEEDED'
        });
        return { _isUpgrade: true, _existingRecord: existing };
      }

      // ***FIXED: Check if this record has already been retried with no improvement***
      // Use epsilon comparison for floating point and validate both quality scores exist
      const hasBeenRetriedWithNoImprovement =
        (existing.validationScore !== undefined && existing.validationScore < 100) &&
        (existing.extractionAttempts || 1) >= 2 &&
        existing._wasUpgraded &&
        existing._previousQuality !== undefined &&
        existing._newQuality !== undefined &&
        Math.abs(existing._previousQuality - existing._newQuality) < MIN_QUALITY_IMPROVEMENT;

      if (hasBeenRetriedWithNoImprovement) {
        log.info('Existing record was already retried with identical results - assuming full extraction.', {
          contentHash: contentHash.substring(0, 16) + '...',
          validationScore: existing.validationScore,
          extractionAttempts: existing.extractionAttempts,
          previousQuality: existing._previousQuality,
          newQuality: existing._newQuality,
          fileName: existing.fileName,
          recordId: existing._id || existing.id,
          decision: 'RETURN_EXISTING',
          event: 'NO_IMPROVEMENT'
        });
        return existing; // Return as-is, no further retry needed
      }

      // ***FIXED: More conservative auto-retry - only if confidence score < 80% (not 100%)***
      // Gemini often returns 95-99% confidence even for perfect extractions, so using
      // 80% threshold prevents wasteful re-analysis of high-quality records while still
      // catching genuinely poor extractions. This reduces API calls by ~90%.
      const validationScore = existing.validationScore ?? 0; // Default to 0 if undefined
      
      if (validationScore < DUPLICATE_UPGRADE_THRESHOLD && (existing.extractionAttempts || 1) < 2) {
        log.warn('Existing record has low confidence score. Will re-analyze to improve.', {
          contentHash: contentHash.substring(0, 16) + '...',
          validationScore: validationScore,
          threshold: DUPLICATE_UPGRADE_THRESHOLD,
          extractionAttempts: existing.extractionAttempts || 1,
          fileName: existing.fileName,
          recordId: existing._id || existing.id,
          decision: 'UPGRADE',
          event: 'LOW_CONFIDENCE_UPGRADE'
        });
        return { _isUpgrade: true, _existingRecord: existing };
      }
      
      // Log when we skip upgrade for good-quality records
      if (validationScore >= DUPLICATE_UPGRADE_THRESHOLD && validationScore < 100) {
        log.info('Existing record has acceptable quality - not upgrading.', {
          contentHash: contentHash.substring(0, 16) + '...',
          validationScore: validationScore,
          threshold: DUPLICATE_UPGRADE_THRESHOLD,
          fileName: existing.fileName,
          recordId: existing._id || existing.id,
          decision: 'RETURN_EXISTING',
          event: 'ACCEPTABLE_QUALITY'
        });
      }

      const totalDurationMs = Date.now() - startTime;
      log.info('Dedupe: high-quality duplicate found, will return existing.', {
        contentHash: contentHash.substring(0, 16) + '...',
        validationScore: existing.validationScore,
        hasAllCriticalFields: true,
        fileName: existing.fileName,
        recordId: existing._id || existing.id,
        totalDurationMs,
        decision: 'RETURN_EXISTING',
        event: 'HIGH_QUALITY_DUPLICATE'
      });
      
      return existing;
    }
    
    const totalDurationMs = Date.now() - startTime;
    log.info('Dedupe: no existing analysis found, will perform new analysis.', {
      contentHash: contentHash.substring(0, 16) + '...',
      collectionDurationMs,
      queryDurationMs,
      totalDurationMs,
      event: 'NOT_FOUND'
    });
    return null;
  } catch (/** @type {any} */ error) {
    const totalDurationMs = Date.now() - startTime;
    log.warn('Duplicate check failed', {
      error: error.message,
      contentHash: contentHash.substring(0, 16) + '...',
      totalDurationMs,
      event: 'ERROR'
    });
    // Re-throw to let caller decide how to handle
    throw error;
  }
}

/**
 * Executes the analysis pipeline with retry and circuit breaker patterns
 * @param {any} imagePayload - Image data and metadata
 * @param {any} log - Logger instance
 * @param {Object} context - Lambda context
 * @returns {Promise<any>} Analysis results
 */
async function executeAnalysisPipeline(imagePayload, log, context) {
  return await circuitBreaker('syncAnalysis', () =>
    retryAsync(() => withTimeout(
      performAnalysisPipeline(
        {
          image: imagePayload.image,
          mimeType: imagePayload.mimeType,
          fileName: imagePayload.fileName,
          force: !!imagePayload.force,
          sequenceId: imagePayload.sequenceId,
          timelinePosition: imagePayload.timelinePosition
        },
        /** @type {any} */(null),
        log,
        context
      ),
      parseInt(process.env.ANALYSIS_TIMEOUT_MS || '60000'),
      () => log.warn('performAnalysisPipeline timed out'),
      log
    ), {
      retries: parseInt(process.env.ANALYSIS_RETRIES || '2'),
      baseDelayMs: parseInt(process.env.ANALYSIS_RETRY_BASE_MS || '250'),
      jitterMs: parseInt(process.env.ANALYSIS_RETRY_JITTER_MS || '200'),
      shouldRetry: (e) => e && e.code !== 'operation_timeout' && e.code !== 'circuit_open',
      log
    }), {
    failureThreshold: parseInt(process.env.CB_FAILURES || '5'),
    openMs: parseInt(process.env.CB_OPEN_MS || '30000'),
    log
  });
}

/**
 * Stores analysis results for future deduplication
 * @param {any} record - Analysis record to store
 * @param {string} contentHash - Content hash for deduplication
 * @param {any} log - Logger instance
 * @param {boolean} forceReanalysis - Whether this was a forced reanalysis
 * @param {boolean} isUpgrade - Whether this is upgrading a low-quality record
 * @param {any} existingRecordToUpgrade - Existing record being upgraded (if applicable)
 */
async function storeAnalysisResults(record, contentHash, log, forceReanalysis = false, isUpgrade = false, existingRecordToUpgrade = null) {
  try {
    const resultsCol = await getCollection('analysis-results');

    // If upgrading, update the existing record instead of inserting
    if (isUpgrade && existingRecordToUpgrade) {
      const previousAttempts = existingRecordToUpgrade.extractionAttempts || 1;
      const newAttempts = previousAttempts + 1;
      const previousQuality = existingRecordToUpgrade.validationScore;
      const newQuality = record.validationScore;

      // ***CRITICAL FIX: Preserve the original record ID and handle ObjectId properly***
      const originalId = existingRecordToUpgrade.id ||
        (existingRecordToUpgrade._id?.toString ? existingRecordToUpgrade._id.toString() : existingRecordToUpgrade._id);

      // Use contentHash as the primary deduplication key
      // NOTE: This is a single-tenant application - all admins share the same analysis data.
      // The contentHash uniquely identifies an image across all users.
      const updateResult = await resultsCol.updateOne(
        { contentHash },
        {
          $set: {
            // Keep the original ID - do NOT overwrite with new UUID
            id: originalId,
            fileName: record.fileName,
            timestamp: record.timestamp,
            analysis: record.analysis,
            updatedAt: new Date(),
            _wasUpgraded: true,
            _previousQuality: previousQuality,
            _newQuality: newQuality,
            needsReview: record.needsReview,
            validationWarnings: record.validationWarnings,
            validationScore: newQuality,
            extractionAttempts: newAttempts
          }
        }
      );

      log.info('Analysis results upgraded with improved quality', {
        recordId: originalId, // Log the original ID
        contentHash: contentHash.substring(0, 16) + '...',
        previousQuality,
        newQuality,
        extractionAttempts: newAttempts,
        qualityImproved: newQuality > previousQuality,
        matchedCount: updateResult.matchedCount,
        modifiedCount: updateResult.modifiedCount
      });

      // ***CRITICAL FIX: Update the record object to return the original ID to the caller***
      record.id = originalId;

      // DUAL-WRITE: Update history collection as well
      try {
        const historyCol = await getCollection('history');
        await historyCol.updateOne(
          { id: originalId },
          {
            $set: {
              analysis: record.analysis,
              timestamp: record.timestamp,
              fileName: record.fileName,
              validationScore: newQuality
            }
          }
        );
        log.debug('Dual-write update to history collection successful', { recordId: originalId });
      } catch (/** @type {any} */ historyError) {
        log.warn('Dual-write update to history collection failed (non-fatal)', {
          error: historyError && historyError.message ? historyError.message : String(historyError),
          recordId: originalId
        });
      }
    } else {
      // New record - insert
      const newRecord = {
        id: record.id,
        fileName: record.fileName,
        timestamp: record.timestamp,
        analysis: record.analysis,
        contentHash,
        createdAt: new Date(),
        _forceReanalysis: forceReanalysis,
        needsReview: record.needsReview,
        validationWarnings: record.validationWarnings,
        validationScore: record.validationScore,
        extractionAttempts: 1
      };
      
      // Add userId only if provided (for multi-tenancy)
      if (userId) {
        newRecord.userId = userId;
        log.debug('Storing new record with userId for multi-tenancy', { userId: userId.substring(0, 8) + '...' });
      } else {
        log.debug('Storing new record without userId (backwards compatibility)');
      }

      await resultsCol.insertOne(newRecord);

      log.info('Analysis results stored for deduplication', {
        recordId: record.id,
        contentHash: contentHash.substring(0, 16) + '...',
        qualityScore: record.validationScore
      });

      // DUAL-WRITE: Also save to history collection for backward compatibility
      // This ensures tools (request_bms_data, insights-guru) can access the data
      try {
        const historyCol = await getCollection('history');
        const historyRecord = {
          id: record.id,
          timestamp: record.timestamp,
          systemId: record.analysis?.systemId || null,
          systemName: null, // Will be filled when linked to a system
          analysis: record.analysis,
          weather: record.weather || null,
          dlNumber: record.analysis?.dlNumber || null,
          fileName: record.fileName,
          analysisKey: contentHash // Use contentHash as analysisKey for consistency
        };
        
        await historyCol.insertOne(historyRecord);
        
        log.info('Dual-write to history collection successful', {
          recordId: record.id,
          systemId: record.analysis?.systemId
        });
      } catch (/** @type {any} */ historyError) {
        log.warn('Dual-write to history collection failed (non-fatal)', {
          error: historyError && historyError.message ? historyError.message : String(historyError),
          recordId: record.id
        });
        // Don't throw - this is best effort dual-write
      }
    }
  } catch (/** @type {any} */ e) {
    log.warn('Failed to persist analysis-results record.', {
      error: e && e.message ? e.message : String(e),
      recordId: record.id
    });
    // Don't throw - this is best effort
  }
}

/**
 * Stores response for idempotency
 * @param {string} idemKey - Idempotency key
 * @param {any} response - Response to store
 * @param {string} reasonCode - Reason code for tracking (e.g., 'new_analysis', 'force_reanalysis', 'dedupe_hit')
 */
async function storeIdempotentResponse(idemKey, response, reasonCode = 'new_analysis') {
  if (!idemKey) return;

  try {
    const idemCol = await getCollection('idempotent-requests');
    await idemCol.updateOne(
      { key: idemKey },
      { $set: { key: idemKey, response, reasonCode, createdAt: new Date() } },
      { upsert: true }
    );
    // Success - no logging needed (best effort operation)
  } catch (/** @type {any} */ e) {
    // Silent fail - this is best effort and we don't want to break the response
  }
}

/**
 * Stores a progress event for legacy jobs
 * @param {string} jobId - Job identifier
 * @param {any} eventData - Event data to store
 */
async function storeProgressEvent(jobId, eventData) {
  try {
    const collection = await getCollection('progress-events');
    await collection.insertOne({ jobId, ...eventData, timestamp: new Date() });
  } catch (/** @type {any} */ error) {
    // Intentionally swallow errors to avoid masking primary failure
  }
}