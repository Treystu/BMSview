/**
 * Batch duplicate checking endpoint
 * Optimized for checking multiple files at once without full analysis
 * 
 * POST /.netlify/functions/check-duplicates-batch
 * Body: { files: [{ image: base64, mimeType: string, fileName: string }, ...] }
 * Response: { results: [{ fileName: string, isDuplicate: boolean, needsUpgrade: boolean, ... }, ...] }
 */

// Defensive module initialization to catch and log any module loading errors
/** @type {Error|null} */
let initError = null;
/** @type {(...args: any[]) => any} */
let errorResponse;
/** @type {(...args: any[]) => any} */
let parseJsonBody;
/** @type {(...args: any[]) => any} */
let createLoggerFromEvent;
/** @type {(...args: any[]) => any} */
let createTimer;
/** @type {(...args: any[]) => any} */
let getCollection;
/** @type {(...args: any[]) => any} */
let getCorsHeaders;
/** @type {(...args: any[]) => any} */
let calculateImageHash;
/** @type {(...args: any[]) => any} */
let checkNeedsUpgrade;
/** @type {(...args: any[]) => any} */
let formatHashPreview;
/** @type {(...args: any[]) => any} */
let createStandardEntryMeta;
/** @type {(...args: any[]) => any} */
let logDebugRequestSummary;

try {
  ({ errorResponse } = require('./utils/errors.cjs'));
  ({ parseJsonBody } = require('./utils/validation.cjs'));
  ({ createLoggerFromEvent, createTimer } = require('./utils/logger.cjs'));
  ({ getCollection } = require('./utils/mongodb.cjs'));
  ({ getCorsHeaders } = require('./utils/cors.cjs'));
  ({ createStandardEntryMeta, logDebugRequestSummary } = require('./utils/handler-logging.cjs'));
  // Use unified deduplication module as canonical source
  ({ calculateImageHash, checkNeedsUpgrade, formatHashPreview } = require('./utils/unified-deduplication.cjs'));
} catch (e) {
  const initException = e instanceof Error ? e : new Error(String(e));
  initError = initException;
  console.error('CHECK-DUPLICATES-BATCH MODULE INIT ERROR:', initException.message, initException.stack);
}

// Limit logged file names to avoid log bloat while keeping context for debugging
const MAX_FILE_NAMES_LOGGED = 10;
/**
 * @typedef {{ fileName?: string, hash?: string, image?: string, mimeType?: string }} BatchDuplicateFile
 */
/**
 * @typedef {{ index: number, fileName: string, contentHash: string | null }} BatchHashEntry
 */
/**
 * @typedef {{ index: number, fileName: string, error: string }} BatchHashError
 */
/**
 * @param {BatchDuplicateFile} file
 * @param {number} index
 */
const formatFileNameForLog = (file, index) => file?.fileName || `file-${index}`;

// Shared constant for hash validation (SHA-256 produces 64 hex characters)
const VALID_HASH_REGEX = /^[a-f0-9]{64}$/i;

/**
 * Batch check for existing analyses by content hash
 * @param {string[]} contentHashes - Array of content hashes to check
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log - Logger instance
 * @param {boolean} [includeData=false] - Whether to include full record data (PR #339)
 * @returns {Promise<Map<string, any>>} Map of contentHash -> existing record
 */
async function batchCheckExistingAnalyses(contentHashes, log, includeData = false) {
  const startTime = Date.now();

  try {
    const collectionStartTime = Date.now();
    const resultsCol = await getCollection('analysis-results');
    const collectionDurationMs = Date.now() - collectionStartTime;

    // Use $in query to fetch all matching records in one go
    const queryStartTime = Date.now();

    // Optimization: Use projection if full data is not requested (PR #339)
    // We still need metadata for checkIfNeedsUpgrade to work correctly
    const projection = includeData ? {} : {
      _id: 1,
      contentHash: 1,
      timestamp: 1,
      validationScore: 1,
      extractionAttempts: 1,
      isComplete: 1,
      analysis: 1, // We fetch the analysis object but it's much smaller than rawOutput or images if stored
      _wasUpgraded: 1,
      _previousQuality: 1,
      _newQuality: 1
    };

    const existingRecords = await resultsCol.find(
      { contentHash: { $in: contentHashes } },
      { projection }
    ).toArray();
    const queryDurationMs = Date.now() - queryStartTime;

    const totalDurationMs = Date.now() - startTime;

    log.info('Batch duplicate check complete', {
      requestedCount: contentHashes.length,
      foundCount: existingRecords.length,
      collectionDurationMs,
      queryDurationMs,
      totalDurationMs,
      avgPerHashMs: (totalDurationMs / contentHashes.length).toFixed(2),
      event: 'BATCH_CHECK_COMPLETE'
    });

    // Convert array to Map for O(1) lookups
    const resultMap = new Map();
    for (const record of existingRecords) {
      resultMap.set(record.contentHash, record);
    }

    return resultMap;
  } catch (error) {
    const totalDurationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Batch duplicate check failed', {
      error: errorMessage,
      hashCount: contentHashes.length,
      totalDurationMs,
      event: 'BATCH_CHECK_ERROR'
    });
    throw error;
  }
}

/**
 * Determine if an existing record needs upgrade using unified deduplication
 * This is now a wrapper around checkNeedsUpgrade from unified-deduplication.cjs
 * @param {any} existing - Existing analysis record
 * @returns {{ needsUpgrade: boolean, reason?: string }}
 */
function checkIfNeedsUpgrade(existing) {
  if (!existing) {
    return { needsUpgrade: false };
  }

  // Use the canonical checkNeedsUpgrade function from unified deduplication
  return /** @type {{ needsUpgrade: boolean, reason?: string }} */ (checkNeedsUpgrade(existing));
}

/**
 * @param {import('@netlify/functions').HandlerEvent} event
 * @param {import('@netlify/functions').HandlerContext} context
 */
exports.handler = async (event, context) => {
  // Handle module initialization errors
  if (initError) {
    console.error('Handler called but module failed to initialize:', initError.message);
    // Basic CORS headers for error response (getCorsHeaders may not be available if init failed)
    const basicCorsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    return {
      statusCode: 500,
      headers: basicCorsHeaders,
      body: JSON.stringify({
        error: {
          code: 'module_init_failed',
          message: 'Function failed to initialize',
          details: { error: initError.message }
        }
      })
    };
  }

  if (
    !errorResponse ||
    !parseJsonBody ||
    !createLoggerFromEvent ||
    !createTimer ||
    !getCollection ||
    !getCorsHeaders ||
    !createStandardEntryMeta ||
    !logDebugRequestSummary ||
    !calculateImageHash ||
    !checkNeedsUpgrade ||
    !formatHashPreview
  ) {
    console.error('CHECK-DUPLICATES-BATCH missing helper modules after initialization');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          code: 'module_init_failed',
          message: 'Required dependencies are unavailable'
        }
      })
    };
  }

  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
  }

  /** @type {any} */
  const log = createLoggerFromEvent('check-duplicates-batch', event, context);
  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, {
    label: 'Batch duplicate check request',
    includeBody: true,
    bodyMaxStringLength: 20000
  });
  /** @type {any} */
  const timer = createTimer(log, 'check-duplicates-batch');

  // Log request body size for debugging payload issues (PR #339)
  const bodySize = event.body ? event.body.length : 0;
  const bodySizeMB = (bodySize / (1024 * 1024)).toFixed(2);
  log.info('Request body size', {
    bodySizeBytes: bodySize,
    bodySizeMB,
    event: 'REQUEST_SIZE'
  });

  // Check for payload too large (Netlify limit is 6MB) (PR #339)
  const MAX_PAYLOAD_SIZE = 6 * 1024 * 1024; // 6MB in bytes
  if (bodySize > MAX_PAYLOAD_SIZE) {
    const maxSizeMB = (MAX_PAYLOAD_SIZE / (1024 * 1024)).toFixed(2);
    log.warn('Request body too large', {
      bodySizeMB,
      maxSizeMB,
      event: 'PAYLOAD_TOO_LARGE'
    });
    timer.end({ error: 'payload_too_large' });
    log.exit(413);
    return errorResponse(
      413,
      'payload_too_large',
      `Request body too large (${bodySizeMB}MB). Maximum allowed is ${maxSizeMB}MB. Consider using client-side hashing or smaller batches.`,
      { bodySizeMB, maxSizeMB, suggestion: 'Use hash-only mode or reduce batch size to 10 files' },
      headers
    );
  }

  /**
   * @type {{ ok?: boolean, value?: { files?: BatchDuplicateFile[] }, error?: string } | undefined }
   */
  let parsed;
  try {
    // Parse request body
    parsed = parseJsonBody(event, log);
    if (!parsed || !parsed.ok) {
      log.warn('Invalid JSON body', { error: parsed?.error });
      timer.end({ error: 'invalid_json' });
      log.exit(400);
      return errorResponse(400, 'invalid_request', parsed?.error || 'Invalid JSON', undefined, headers);
    }

    const { files, includeData } = /** @type {{ files: BatchDuplicateFile[], includeData?: boolean }} */ (parsed.value);

    if (!Array.isArray(files) || files.length === 0) {
      log.warn('Invalid files array', { filesType: typeof files, filesLength: files?.length });
      timer.end({ error: 'invalid_files' });
      log.exit(400);
      return errorResponse(400, 'invalid_request', 'files must be a non-empty array', undefined, headers);
    }

    if (files.length > 1000) {
      log.warn('Too many files in batch', { fileCount: files.length });
      timer.end({ error: 'too_many_files' });
      log.exit(400);
      return errorResponse(400, 'invalid_request', 'Maximum 1000 files per batch', undefined, headers);
    }

    log.info('Processing batch duplicate check', {
      fileCount: files.length,
      fileNames: files.slice(0, MAX_FILE_NAMES_LOGGED).map((f, idx) => formatFileNameForLog(f, idx)),
      event: 'BATCH_START'
    });

    // Detect mode: hash-only or image mode (PR #339)
    // Validate that all files follow the same mode (no mixed batches allowed)
    const hasHash = files.some(f => f.hash);
    const hasImage = files.some(f => f.image);

    if (hasHash && hasImage) {
      log.warn('Mixed mode batch detected (some files have hash, some have image)', {
        filesWithHash: files.filter(f => f.hash).length,
        filesWithImage: files.filter(f => f.image).length,
        event: 'MIXED_MODE_ERROR'
      });
      timer.end({ error: 'mixed_mode' });
      log.exit(400);
      return errorResponse(
        400,
        'invalid_request',
        'Mixed mode batch not allowed. All files must use either hash-only mode or image mode.',
        { suggestion: 'Ensure all files have either "hash" or "image" property, not both' },
        headers
      );
    }

    const isHashOnlyMode = hasHash;
    const isImageMode = hasImage;

    log.info('Batch mode detected', {
      mode: isHashOnlyMode ? 'hash-only' : isImageMode ? 'image' : 'unknown',
      filesWithHash: files.filter(f => f.hash).length,
      filesWithImage: files.filter(f => f.image).length,
      event: 'MODE_DETECTED'
    });

    // Process based on mode (PR #339)
    /** @type {BatchHashEntry[]} */
    let fileHashes = [];
    /** @type {BatchHashError[]} */
    const hashErrors = [];

    if (isHashOnlyMode) {
      // Hash-only mode: Use provided hashes directly (no calculation needed)
      const hashStartTime = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (!file.hash || !file.fileName) {
          const fileName = formatFileNameForLog(file, i);
          hashErrors.push({ index: i, fileName, error: 'Missing hash or fileName' });
          fileHashes.push({ index: i, fileName, contentHash: null });
          continue;
        }

        // Validate hash format (should be 64 hex characters)
        if (!VALID_HASH_REGEX.test(file.hash)) {
          hashErrors.push({ index: i, fileName: file.fileName, error: 'Invalid hash format (expected 64 hex chars)' });
          fileHashes.push({ index: i, fileName: file.fileName, contentHash: null });
          continue;
        }

        fileHashes.push({ index: i, fileName: file.fileName, contentHash: file.hash.toLowerCase() });

        log.debug('Hash received from client', {
          fileName: file.fileName,
          hashPreview: formatHashPreview(file.hash),
          index: i,
          event: 'HASH_RECEIVED'
        });
      }

      const hashDurationMs = Date.now() - hashStartTime;

      log.info('Hash-only mode processing complete', {
        totalFiles: files.length,
        validHashes: fileHashes.filter(h => h.contentHash).length,
        invalidHashes: hashErrors.length,
        hashDurationMs,
        event: 'HASH_ONLY_COMPLETE'
      });

    } else {
      // Image mode: Calculate content hashes from base64 images
      const hashStartTime = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (!file.image || !file.fileName) {
          const fileName = formatFileNameForLog(file, i);
          hashErrors.push({ index: i, fileName, error: 'Missing image or fileName' });
          fileHashes.push({ index: i, fileName, contentHash: null });
          continue;
        }

        try {
          const contentHash = calculateImageHash(file.image, log);
          if (!contentHash) {
            hashErrors.push({ index: i, fileName: file.fileName, error: 'Failed to generate hash' });
            fileHashes.push({ index: i, fileName: file.fileName, contentHash: null });
          } else {
            fileHashes.push({ index: i, fileName: file.fileName, contentHash });
            log.debug('Hash generated for file', {
              fileName: file.fileName,
              hashPreview: formatHashPreview(contentHash),
              index: i,
              event: 'HASH_GENERATED'
            });
          }
        } catch (hashErr) {
          const fileName = formatFileNameForLog(file, i);
          const hashErrMessage = hashErr instanceof Error ? hashErr.message : String(hashErr);
          hashErrors.push({ index: i, fileName, error: hashErrMessage });
          fileHashes.push({ index: i, fileName, contentHash: null });
          log.warn('Hash calculation failed for file', {
            fileName,
            error: hashErrMessage,
            event: 'HASH_FAILED'
          });
        }
      }

      const hashDurationMs = Date.now() - hashStartTime;

      log.info('Image mode hash calculation complete', {
        totalFiles: files.length,
        successfulHashes: fileHashes.filter(h => h.contentHash).length,
        failedHashes: hashErrors.length,
        hashDurationMs,
        avgHashMs: files.length > 0 ? (hashDurationMs / files.length).toFixed(2) : '0.00',
        event: 'IMAGE_MODE_COMPLETE'
      });
    }

    if (hashErrors.length > 0) {
      log.warn('Some files failed hash calculation', {
        errorCount: hashErrors.length,
        // Log first 5 sanitized errors
        errors: hashErrors.slice(0, 5).map(e => ({
          fileName: e.fileName,
          errorType: e.error && e.error.includes('read') ? 'read_failed' : 'hash_failed'
        })),
        event: 'HASH_ERRORS'
      });
    }

    // Get all valid hashes
    const validHashes = fileHashes
      .filter(h => h.contentHash)
      .map(h => /** @type {string} */(h.contentHash));

    if (validHashes.length === 0) {
      log.warn('No valid hashes generated, returning non-duplicate results', {
        fileCount: files.length,
        event: 'NO_VALID_HASHES'
      });
    }

    // Batch check MongoDB
    let existingRecordsMap = new Map();
    if (validHashes.length > 0) {
      existingRecordsMap = await batchCheckExistingAnalyses(validHashes, log, includeData);
    }

    // Build results array
    const results = fileHashes.map(fileHash => {
      const { fileName, contentHash } = fileHash;

      if (!contentHash) {
        return {
          fileName,
          isDuplicate: false,
          needsUpgrade: false,
          error: 'Failed to calculate content hash'
        };
      }

      const existing = existingRecordsMap.get(contentHash);

      if (!existing) {
        return {
          fileName,
          isDuplicate: false,
          needsUpgrade: false
        };
      }

      const upgradeCheck = checkIfNeedsUpgrade(existing);

      // Note: analysisData intentionally excluded by default to prevent PII leakage
      // Clients should use the recordId to fetch full analysis via authenticated endpoint
      // or set includeData: true if they have permission (e.g. restoration)
      const result = {
        fileName,
        isDuplicate: true,
        needsUpgrade: upgradeCheck.needsUpgrade,
        recordId: existing._id?.toString() || existing.id,
        timestamp: existing.timestamp,
        validationScore: existing.validationScore,
        extractionAttempts: existing.extractionAttempts || 1,
        upgradeReason: upgradeCheck.reason,
        ...(includeData ? { analysisData: existing } : {})
      };

      return result;
    });

    const duplicateCount = results.filter(r => r.isDuplicate && !r.needsUpgrade).length;
    const upgradeCount = results.filter(r => r.needsUpgrade).length;
    const newCount = results.filter(r => !r.isDuplicate).length;

    const durationMs = timer.end({
      fileCount: files.length,
      duplicates: duplicateCount,
      upgrades: upgradeCount,
      new: newCount
    });

    log.info('Batch duplicate check complete', {
      totalFiles: files.length,
      duplicates: duplicateCount,
      upgrades: upgradeCount,
      new: newCount,
      durationMs,
      avgPerFileMs: (durationMs / files.length).toFixed(2),
      event: 'BATCH_COMPLETE'
    });

    log.exit(200);

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results,
        summary: {
          total: files.length,
          duplicates: duplicateCount,
          upgrades: upgradeCount,
          new: newCount,
          durationMs
        }
      })
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    timer.end({ error: true });
    log.error('Batch duplicate check failed', {
      error: errorMessage,
      stack: errorStack,
      fileCount: Array.isArray(parsed?.value?.files) ? parsed.value.files.length : undefined,
      event: 'BATCH_ERROR'
    });

    const statusCode = errorMessage.includes('timeout') ? 408 : 500;
    log.exit(statusCode);

    return errorResponse(
      statusCode,
      'batch_check_failed',
      'Batch duplicate check failed',
      { message: errorMessage },
      headers
    );
  }
};
