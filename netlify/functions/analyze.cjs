// @ts-nocheck
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
 * - utils/unified-deduplication: Canonical duplicate detection and content hashing
 * - utils/mongodb: { getCollection } - MongoDB connection and collection access
 * - utils/retry: { withTimeout, retryAsync, circuitBreaker } - Retry and circuit breaker patterns
 * 
 * Required Environment Variables:
 * - ANALYSIS_TIMEOUT_MS: Analysis pipeline timeout (default: 60000)
 * - ANALYSIS_RETRIES: Number of retry attempts (default: 2)
 * - ANALYSIS_RETRY_BASE_MS: Base delay between retries (default: 250)
 * - ANALYSIS_RETRY_JITTER_MS: Jitter added to retry delay (default: 200)
 * - CB_FAILURES: Circuit breaker failure threshold (default: 5)
 * - CB_OPEN_MS: Circuit breaker open duration (default: 30000)
 * 
 * MongoDB Collections Used:
 * - idempotent-requests: Stores request/response pairs for idempotency
 * - analysis-results: Stores analysis results and content hashes for deduplication
 * - progress-events: Stores async job progress events
 */

const { errorResponse } = require('./utils/errors.cjs');
const { parseJsonBody, validateAnalyzeRequest, validateImagePayload } = require('./utils/validation.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { withTimeout, retryAsync, circuitBreaker } = require('./utils/retry.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { handleStoryModeAnalysis } = require('./utils/story-mode.cjs');
const { COLLECTIONS } = require('./utils/collections.cjs');
// @ts-nocheck
"use strict";
const {
  calculateImageHash,
  findDuplicateByHash,
  checkExistingAnalysis, // Now imported from unified-deduplication.cjs
  checkNeedsUpgrade
} = require('./utils/unified-deduplication.cjs');
// Import unified logic from analysis-helpers and intelligent-associator
const { normalizeHardwareId } = require('./utils/analysis-helpers.cjs');
const { IntelligentAssociator } = require('./utils/intelligent-associator.cjs');

/**
 * Ensure a record is linked to a system using Hardware ID if unlinked.
 * Uses IntelligentAssociator for robust matching (Strict -> Fuzzy -> Semantic).
 * @param {any} record - Analysis or history record
 * @param {any} log - Logger
 * @returns {Promise<any>} Updated record (or original if unchanged)
 */
async function ensureSystemAssociation(record, log) {
  try {
    if (!record || record.systemId) return record;

    // Use IntelligentAssociator logic
    const systemsCollection = await getCollection(COLLECTIONS.SYSTEMS);
    const systems = await systemsCollection.find({}).toArray();

    // We need limited stats for semantic validation (optional but good)
    // For immediate analysis, we might not have full stats handy, so we pass empty stats
    // or we could do a quick aggregation if latency permits. 
    // For now, let's trust the Associator's fuzzy/strict logic primarily.
    const associator = new IntelligentAssociator(systems, {});

    const result = associator.findMatch(record);

    if (result.systemId) {
      const system = systems.find(s => s.id === result.systemId);
      if (!system) return record; // Should not happen given result.systemId comes from systems

      const historyCollection = await getCollection(COLLECTIONS.HISTORY);
      const resultsCollection = await getCollection(COLLECTIONS.ANALYSIS_RESULTS);

      // Use the matched ID (which might be the canonical one from the system, not the raw one)
      // USER REQUEST: Keep the exact data as in the photo as the source of truth.
      // So, if we have a raw hardwareSystemId from the record, PRESERVE IT.
      // Only use the matched/normalized ID if the record doesn't have one.
      const finalHwId = record.hardwareSystemId || result.matchedId || normalizeHardwareId(record.hardwareSystemId);

      await historyCollection.updateOne(
        { id: record.id },
        {
          $set: {
            systemId: system.id,
            systemName: system.name,
            hardwareSystemId: finalHwId,
            dlNumber: finalHwId
          }
        }
      );

      await resultsCollection.updateOne(
        { id: record.id },
        { $set: { systemId: system.id, systemName: system.name } }
      );

      const updated = {
        ...record,
        systemId: system.id,
        systemName: system.name,
        hardwareSystemId: finalHwId,
        dlNumber: finalHwId
      };

      log.info('Auto-associated record using Intelligent Associator', {
        recordId: record.id,
        status: result.status,
        reason: result.reason,
        systemId: system.id,
        systemName: system.name
      });

      return updated;
    } else {
      log.info('Auto-association: No matching system found', {
        status: result.status,
        reason: result.reason,
        isNewCandidate: result.isNewCandidate
      });
      return record;
    }
  } catch (error) {
    const err = /** @type {any} */ (error);
    log.warn('Failed to auto-associate record by Hardware ID', { error: err?.message, recordId: record?.id });
    return record;
  }
}

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
 * Extract record ID from an analysis record
 * Handles both MongoDB ObjectId and string ID formats
 * @param {Object} record - Analysis record
 * @returns {string|undefined} Record ID as string
 */
function extractRecordId(record) {
  if (!record) return undefined;
  return record.id || record._id?.toString?.() || record._id;
}

/**
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
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
  log.entry(createStandardEntryMeta(event));
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
  const requestContext = { jobId: undefined };

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
      const systemId = event.queryStringParameters && event.queryStringParameters.systemId;
      // Synchronous analysis path with comprehensive error handling
      const result = await handleSyncAnalysis(parsed.value, idemKey || '', !!forceReanalysis, !!checkOnly, headers, log, context, systemId);
      timer.end({ mode: 'sync', statusCode: result.statusCode });
      log.exit(result.statusCode);
      return result;
    }

    // Asynchronous analysis path
    const result = await handleAsyncAnalysis(parsed.value, headers, log, requestContext);
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

    // Best-effort async progress event logging
    try {
      if (requestContext.jobId) {
        await storeProgressEvent(requestContext.jobId, {
          stage: 'error',
          progress: 0,
          message: `Analysis failed: ${error.message}`
        });
      }
    } catch {
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

// Exported for testing
module.exports.ensureSystemAssociation = ensureSystemAssociation;

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
async function handleSyncAnalysis(requestBody, idemKey, forceReanalysis, checkOnly, headers, log, context, systemId) {
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

    // Calculate content hash for deduplication using unified function
    const hashStartTime = Date.now();
    const contentHash = calculateImageHash(imagePayload.image, log);
    const hashDurationMs = Date.now() - hashStartTime;

    if (!contentHash) {
      log.error('Failed to generate content hash for image payload', {
        fileName: imagePayload.fileName,
        imageSize: imagePayload.image?.length || 0,
        event: 'HASH_FAILED'
      });
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
        log.info('DUPLICATE_CHECK: Starting check-only mode', {
          contentHash: contentHash.substring(0, 16) + '...',
          fileName: imagePayload.fileName,
          imageSize: imagePayload.image?.length || 0,
          event: 'CHECK_ONLY_START'
        });

        // Use IMPORTED checkExistingAnalysis which now includes filename fallback
        const existingAnalysis = await checkExistingAnalysis(contentHash || '', log, imagePayload.fileName);

        // Distinguish between true duplicates and upgrades needed
        const isDuplicate = !!existingAnalysis;
        const needsUpgrade = existingAnalysis?._isUpgrade === true;

        // Extract the actual record for upgrade cases
        const actualRecord = needsUpgrade ? existingAnalysis._existingRecord : existingAnalysis;

        const checkResponse = {
          isDuplicate,
          needsUpgrade,
          recordId: extractRecordId(actualRecord),
          timestamp: actualRecord?.timestamp,
          analysisData: (!needsUpgrade && actualRecord) ? actualRecord.analysis : null
        };

        const durationMs = timer.end({ checkOnly: true, isDuplicate, needsUpgrade });
        const checkOnlyDurationMs = Date.now() - checkOnlyStartTime;

        log.info('DUPLICATE_CHECK: Check-only complete', {
          isDuplicate,
          needsUpgrade,
          hasRecordId: !!checkResponse.recordId,
          checkOnlyDurationMs,
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
        log.error('DUPLICATE_CHECK: Check-only failed', {
          error: checkError.message,
          checkOnlyDurationMs,
          event: 'CHECK_ONLY_ERROR'
        });
        return errorResponse(500, 'check_failed', 'Duplicate check failed', { error: checkError.message }, headers);
      }
    }

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
        // Use IMPORTED checkExistingAnalysis with filename fallback
        const existingAnalysis = await checkExistingAnalysis(contentHash || '', log, imagePayload.fileName);

        if (!existingAnalysis) {
          log.info('Duplicate check: No existing analysis found.', { contentHash: contentHash.substring(0, 16) + '...' });
        }

        if (existingAnalysis) {
          // Check if checkExistingAnalysis flagged this as needing upgrade
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
            // High-quality duplicate - ensure Hardware ID-based association before returning
            const associatedExisting = await ensureSystemAssociation(existingAnalysis, log);

            const responseBody = {
              analysis: associatedExisting.analysis,
              recordId: associatedExisting._id?.toString?.() || associatedExisting.id,
              fileName: associatedExisting.fileName,
              timestamp: associatedExisting.timestamp,
              systemId: associatedExisting.systemId || null,
              systemName: associatedExisting.systemName || null,
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

    let record = await executeAnalysisPipeline({
      ...imagePayload,
      force: forceReanalysis
    }, log, context, systemId);

    // Ensure Hardware ID-based association for new/updated record before persisting responses
    record = await ensureSystemAssociation(record, log);

    // --- POST-ANALYSIS DEDUPLICATION (Safety Net) ---
    // If the image hash was new (so we ran analysis), we might STILL have a "Functional Duplicate"
    // (e.g. same System + same Timestamp + same SOC, but different screenshot file).
    // If so, we should link this new file hash to the OLD record and discard the new record data to avoid DB clutter.
    try {
      if (record.systemId && record.timestamp) {
        const historyCol = await getCollection(COLLECTIONS.HISTORY);
        const resultsCol = await getCollection(COLLECTIONS.ANALYSIS_RESULTS);

        // Look for existing record with same System + Time (Minute precision)
        const date = new Date(record.timestamp);
        date.setSeconds(0, 0);
        const timeStart = date.toISOString();
        const timeEnd = new Date(date.getTime() + 60000).toISOString();

        const functionalDup = await historyCol.findOne({
          systemId: record.systemId,
          timestamp: { $gte: timeStart, $lt: timeEnd },
          id: { $ne: record.id } // Don't find self
        });

        if (functionalDup) {
          log.info('Functional Duplicate Detected (Post-Analysis)', {
            newRecordId: record.id,
            existingRecordId: functionalDup.id,
            systemId: record.systemId,
            timestamp: record.timestamp
          });

          // 1. Update the EXISTING record to include the NEW contentHash (if possible)
          // Actually, we can't easily have multiple hashes per record in the current schema without an array.
          // But we CAN update the 'analysis-results' collection to point the NEW hash to the OLD record ID.
          // This ensures future uploads of this file hit the OLD record.

          if (contentHash) {
            // Upsert result to point contentHash -> functionalDup.id
            await resultsCol.updateOne(
              { contentHash },
              {
                $set: {
                  id: functionalDup.id, // Point to OLD ID
                  // Copy other metadata from old record if needed, or keep new analysis?
                  // Let's keep the NEW analysis if it's better?
                  // For now, just linking the ID is the key.
                  updatedAt: new Date()
                }
              },
              { upsert: true }
            );

            log.info('Redirected new contentHash to existing record', { contentHash, targetId: functionalDup.id });

            // 2. Return the EXISTING record to the client
            record = {
              ...functionalDup,
              isDuplicate: true,
              _functionalDuplicate: true
            };
          }
        }
      }
    } catch (postDedupeError) {
      log.warn('Post-analysis deduplication failed', { error: postDedupeError.message });
    }

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

    if (record.analysis) {
      log.info('AI Analysis Complete', {
        recordId: record.id,
        confidenceScore: record.analysis.confidenceScore,
        modelUsed: record.analysis.modelUsed || 'unknown',
        batteryType: record.analysis.batteryType,
        tokenUsage: record.analysis.tokenUsage
      });
    }

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
 * Handles asynchronous analysis requests
 * @param {any} requestBody - Parsed request body
 * @param {any} headers - Response headers
 * @param {any} log - Logger instance
 * @param {any} requestContext - Request context for error handling
 */
async function handleAsyncAnalysis(requestBody, headers, log, requestContext) {
  const validated = validateAnalyzeRequest(requestBody, log);
  if (!validated.ok) {
    log.warn('Async analyze request missing parameters.', { details: validated.details });
    log.exit(400);
    return errorResponse(400, 'missing_parameters', validated.error || 'Missing parameters', validated.details, { ...headers, 'Content-Type': 'application/json' });
  }

  const { jobId, fileData } = /** @type {any} */ (validated).value;
  requestContext.jobId = jobId;

  log.info('Async analyze request received.', { jobId, fileBytes: fileData ? fileData.length : 0 });

  // Import async client dynamically to avoid bundle issues
  const { triggerAnalysisAsync } = require('./utils/analysis-async-client.cjs');

  try {
    // Extract additional data from request body if available
    const { fileName, mimeType, systemId, forceReanalysis, systems } = requestBody || {};

    // Trigger the async workload
    const result = await triggerAnalysisAsync({
      jobId,
      fileData,
      fileName: fileName || 'unknown.png',
      mimeType: mimeType || 'image/png',
      systemId,
      forceReanalysis,
      systems
    }, log);

    log.info('Async analysis job triggered successfully.', { jobId, eventId: result.eventId });
    log.exit(202, { mode: 'async', eventId: result.eventId });

    return {
      statusCode: 202,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId,
        message: 'Async analysis accepted for processing',
        eventId: result.eventId
      })
    };

  } catch (error) {
    log.error('Failed to trigger async analysis job.', {
      jobId,
      error: error.message,
      stack: error.stack
    });

    // Store error progress event
    await storeProgressEvent(jobId, {
      stage: 'error',
      progress: 0,
      message: `Failed to start analysis: ${error.message}`
    });

    log.exit(500);
    return errorResponse(
      500,
      'async_trigger_failed',
      'Failed to trigger async analysis',
      { error: error.message },
      { ...headers, 'Content-Type': 'application/json' }
    );
  }
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
    const idemCol = await getCollection(COLLECTIONS.IDEMPOTENT_REQUESTS);
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

// NOTE: checkExistingAnalysis was moved to unified-deduplication.cjs to fix duplicate declaration errors

/**
 * Executes the analysis pipeline with retry and circuit breaker patterns
 * @param {any} imagePayload - Image data and metadata
 * @param {any} log - Logger instance
 * @param {Object} context - Lambda context
 * @returns {Promise<any>} Analysis results
 */
async function executeAnalysisPipeline(imagePayload, log, context, systemId) {
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
        context,
        systemId
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
    const resultsCol = await getCollection(COLLECTIONS.ANALYSIS_RESULTS);

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
            systemId: record.systemId || null, // Top-level for query efficiency (FIXED: was incorrectly reading from analysis)
            systemName: record.systemName || null, // Preserve system name
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
        const historyCol = await getCollection(COLLECTIONS.HISTORY);
        await historyCol.updateOne(
          { id: originalId },
          {
            $set: {
              systemId: record.systemId || null, // FIXED: was incorrectly reading from analysis
              systemName: record.systemName || null,
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
        systemId: record.systemId || null, // FIXED: was incorrectly reading from analysis
        systemName: record.systemName || null, // Preserve system name for linked records
        analysis: record.analysis,
        contentHash,
        createdAt: new Date(),
        _forceReanalysis: forceReanalysis,
        needsReview: record.needsReview,
        validationWarnings: record.validationWarnings,
        validationScore: record.validationScore,
        extractionAttempts: 1
      };

      // NOTE: This is a single-tenant application - no userId segregation needed
      // All admins share the same analysis data indexed by contentHash
      log.debug('Storing new analysis record', {
        recordId: record.id,
        systemId: record.systemId || null, // FIXED: was incorrectly reading from analysis
        hasContentHash: !!contentHash,
        qualityScore: record.validationScore
      });

      await resultsCol.insertOne(newRecord);

      log.info('Analysis results stored for deduplication', {
        recordId: record.id,
        systemId: record.systemId || null, // FIXED: was incorrectly reading from analysis
        contentHash: contentHash.substring(0, 16) + '...',
        qualityScore: record.validationScore
      });

      // DUAL-WRITE: Also save to history collection for backward compatibility
      // This ensures tools (request_bms_data, insights-guru) can access the data
      try {
        const historyCol = await getCollection(COLLECTIONS.HISTORY);
        const historyRecord = {
          id: record.id,
          timestamp: record.timestamp,
          systemId: record.systemId || null, // FIXED: was incorrectly reading from analysis
          systemName: record.systemName || null, // FIXED: was always null, now propagates linked name
          analysis: record.analysis,
          weather: record.weather || null,
          dlNumber: record.analysis?.dlNumber || record.analysis?.hardwareSystemId || null,
          hardwareSystemId: record.analysis?.hardwareSystemId || null, // Ensure hardware ID is persisted
          fileName: record.fileName,
          analysisKey: contentHash // Use contentHash as analysisKey for consistency
        };

        await historyCol.insertOne(historyRecord);

        log.info('Dual-write to history collection successful', {
          recordId: record.id,
          systemId: record.systemId || null // FIXED: was incorrectly reading from analysis
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
    const idemCol = await getCollection(COLLECTIONS.IDEMPOTENT_REQUESTS);
    await idemCol.updateOne(
      { key: idemKey },
      { $set: { key: idemKey, response, reasonCode, createdAt: new Date() } },
      { upsert: true }
    );
    // Success - no logging needed (best effort operation)
  } catch {
    // Silent fail - this is best effort and we don't want to break the response
  }
}

/**
 * Stores a progress event for async jobs
 * @param {string} jobId - Job identifier
 * @param {any} eventData - Event data to store
 */
async function storeProgressEvent(jobId, eventData) {
  try {
    const collection = await getCollection(COLLECTIONS.PROGRESS_EVENTS);
    await collection.insertOne({ jobId, ...eventData, timestamp: new Date() });
  } catch {
    // Intentionally swallow errors to avoid masking primary failure
  }
}
