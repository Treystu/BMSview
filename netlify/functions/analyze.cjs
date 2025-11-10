/**
 * Lambda function handler for analyzing image data.
 * * Dependencies:
 * - utils/errors: { errorResponse } - Error handling utilities
 * - utils/validation: { parseJsonBody, validateAnalyzeRequest, validateImagePayload } - Request validation
 * - utils/logger: { createLogger, createTimer } - Logging and timing utilities
 * - utils/analysis-pipeline: { performAnalysisPipeline } - Core analysis implementation
 * - utils/hash: { sha256HexFromBase64 } - Content hashing utilities
 * - utils/mongodb: { getCollection } - MongoDB connection and collection access
 * - utils/retry: { withTimeout, retryAsync, circuitBreaker } - Retry and circuit breaker patterns
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
const { createLogger, createTimer } = require('./utils/logger.cjs');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');
const { sha256HexFromBase64 } = require('./utils/hash.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { withTimeout, retryAsync, circuitBreaker } = require('./utils/retry.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

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
  const log = createLogger('analyze', context);
  log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });
  const isSync = (event.queryStringParameters && event.queryStringParameters.sync === 'true');
  const forceReanalysis = (event.queryStringParameters && event.queryStringParameters.force === 'true');
  const headersIn = event.headers || {};
  const idemKey = headersIn['Idempotency-Key'] || headersIn['idempotency-key'] || headersIn['IDEMPOTENCY-KEY'];
  let requestContext = { jobId: undefined };

  try {
    // Parse and validate request body
    const parsed = parseJsonBody(event, log);
    if (!parsed.ok) {
      log.warn('Invalid JSON body for analyze request.', { error: parsed.error });
      log.exit(400);
      return errorResponse(400, 'invalid_request', parsed.error, undefined, headers);
    }

    if (isSync) {
      // Synchronous analysis path
      // *** FIX: Removed the 'timer' variable which was not defined in this scope. ***
      return await handleSyncAnalysis(parsed.value, idemKey, forceReanalysis, headers, log, context);
    }

    // Legacy asynchronous analysis path
    return await handleLegacyAnalysis(parsed.value, headers, log, requestContext);

  } catch (error) {
    log.error('Analyze function failed.', { error: error && error.message ? error.message : String(error), stack: error.stack });

    // Best-effort legacy progress event logging
    try {
      if (requestContext.jobId) {
        await storeProgressEvent(requestContext.jobId, {
          stage: 'error',
          progress: 0,
          message: `Analysis failed: ${error.message}`
        });
      }
    } catch (_) { }

    log.exit(500, { error: error.message });
    return errorResponse(500, 'analysis_failed', 'Analysis failed', { message: error.message }, { ...headers, 'Content-Type': 'application/json' });
  }
};

/**
 * Handles synchronous image analysis requests
 * @param {Object} requestBody - Parsed request body
 * @param {string} idemKey - Idempotency key if provided
 * @param {boolean} forceReanalysis - Whether to bypass duplicate detection
 * @param {Object} headers - Response headers
 * @param {Object} log - Logger instance
 * @param {Object} context - Lambda context
 */
async function handleSyncAnalysis(requestBody, idemKey, forceReanalysis, headers, log, context) {
  const timer = createTimer(log, 'sync-analysis');
  const imagePayload = requestBody && requestBody.image;

  // Validate image payload
  const imageValidation = validateImagePayload(imagePayload, log);
  if (!imageValidation.ok) {
    log.warn('Sync analyze image validation failed.', { reason: imageValidation.error });
    log.exit(400);
    return errorResponse(400, 'invalid_image', imageValidation.error, undefined, { ...headers, 'Content-Type': 'application/json' });
  }

  // Calculate content hash for deduplication
  const contentHash = sha256HexFromBase64(imagePayload.image);

  // Check idempotency cache (skip if force=true)
  if (idemKey && !forceReanalysis) {
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
  }

  // Check for existing analysis by content hash (skip if force=true)
  if (!forceReanalysis) {
    const existingAnalysis = await checkExistingAnalysis(contentHash, log);
    if (existingAnalysis) {
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
  } else {
    log.info('Force re-analysis requested, bypassing duplicate detection.', { contentHash, auditEvent: 'force_reanalysis', timestamp: new Date().toISOString() });
  }

  // Perform new analysis
  log.info('Starting synchronous analysis via pipeline.', { fileName: imagePayload.fileName, mimeType: imagePayload.mimeType });
  const record = await executeAnalysisPipeline(imagePayload, log, context);

  // Store results for future deduplication
  await storeAnalysisResults(record, contentHash, log, forceReanalysis);

  const responseBody = {
    analysis: record.analysis,
    recordId: record.id,
    fileName: record.fileName,
    timestamp: record.timestamp
  };

  await storeIdempotentResponse(idemKey, responseBody, forceReanalysis ? 'force_reanalysis' : 'new_analysis');

  const durationMs = timer.end({ recordId: record.id });
  log.exit(200, { mode: 'sync', recordId: record.id, durationMs });
  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(responseBody)
  };
}

/**
 * Handles legacy asynchronous analysis requests
 * @param {Object} requestBody - Parsed request body
 * @param {Object} headers - Response headers
 * @param {Object} log - Logger instance
 * @param {Object} requestContext - Request context for error handling
 */
async function handleLegacyAnalysis(requestBody, headers, log, requestContext) {
  const validated = validateAnalyzeRequest(requestBody, log);
  if (!validated.ok) {
    log.warn('Legacy analyze request missing parameters.', { details: validated.details });
    log.exit(400);
    return errorResponse(400, 'missing_parameters', validated.error, validated.details, { ...headers, 'Content-Type': 'application/json' });
  }

  const { jobId, fileData, userId } = validated.value;
  requestContext.jobId = jobId;

  log.info('Legacy analyze request received.', { jobId, userId, fileBytes: fileData ? fileData.length : 0 });
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
 * @param {Object} log - Logger instance
 * @returns {Object|null} Stored response if found
 */
async function checkIdempotency(idemKey, log) {
  if (!idemKey) return null;

  const idemCol = await getCollection('idempotent-requests');
  const existingIdem = await idemCol.findOne({ key: idemKey });
  if (existingIdem && existingIdem.response) {
    log.info('Idempotency hit: returning stored response.', { idemKey });
    return existingIdem.response;
  }
  return null;
}

/**
 * Checks for existing analysis by content hash
 * @param {string} contentHash - Content hash to check
 * @param {Object} log - Logger instance
 * @returns {Object|null} Existing analysis if found
 */
async function checkExistingAnalysis(contentHash, log) {
  const resultsCol = await getCollection('analysis-results');
  const existing = await resultsCol.findOne({ contentHash });
  if (existing) {
    log.info('Dedupe: existing analysis found for content hash.', { contentHash });
    return existing;
  }
  return null;
}

/**
 * Executes the analysis pipeline with retry and circuit breaker patterns
 * @param {Object} imagePayload - Image data and metadata
 * @param {Object} log - Logger instance
 * @param {Object} context - Lambda context
 * @returns {Object} Analysis results
 */
async function executeAnalysisPipeline(imagePayload, log, context) {
  return await circuitBreaker('syncAnalysis', () =>
    retryAsync(() => withTimeout(
      performAnalysisPipeline(
        {
          image: imagePayload.image,
          mimeType: imagePayload.mimeType,
          fileName: imagePayload.fileName,
          force: !!imagePayload.force
        },
        null,
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
    })
    , {
      failureThreshold: parseInt(process.env.CB_FAILURES || '5'),
      openMs: parseInt(process.env.CB_OPEN_MS || '30000'),
      log
    });
}

/**
 * Stores analysis results for future deduplication
 * @param {Object} record - Analysis record to store
 * @param {string} contentHash - Content hash for deduplication
 * @param {Object} log - Logger instance
 * @param {boolean} forceReanalysis - Whether this was a forced reanalysis
 */
async function storeAnalysisResults(record, contentHash, log, forceReanalysis = false) {
  const resultsCol = await getCollection('analysis-results');
  try {
    await resultsCol.insertOne({
      id: record.id,
      fileName: record.fileName,
      timestamp: record.timestamp,
      analysis: record.analysis,
      contentHash,
      createdAt: new Date(),
      _forceReanalysis: forceReanalysis
    });
  } catch (e) {
    log.warn('Failed to persist analysis-results record.', { error: e && e.message ? e.message : String(e) });
  }
}

/**
 * Stores response for idempotency
 * @param {string} idemKey - Idempotency key
 * @param {Object} response - Response to store
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
  } catch (_) { }
}

/**
 * Stores a progress event for legacy jobs
 * @param {string} jobId - Job identifier
 * @param {Object} eventData - Event data to store
 */
async function storeProgressEvent(jobId, eventData) {
  try {
    const collection = await getCollection('progress-events');
    await collection.insertOne({ jobId, ...eventData, timestamp: new Date() });
  } catch (error) {
    // Intentionally swallow errors to avoid masking primary failure
  }
}
