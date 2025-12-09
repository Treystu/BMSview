/**
 * Batch duplicate checking endpoint
 * Optimized for checking multiple files at once without full analysis
 * 
 * POST /.netlify/functions/check-duplicates-batch
 * Body: { files: [{ image: base64, mimeType: string, fileName: string }, ...] }
 * Response: { results: [{ fileName: string, isDuplicate: boolean, needsUpgrade: boolean, ... }, ...] }
 */

const { errorResponse } = require('./utils/errors.cjs');
const { parseJsonBody } = require('./utils/validation.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
// Use unified deduplication module as canonical source
const {
  calculateImageHash,
  checkNeedsUpgrade,
  formatHashPreview
} = require('./utils/unified-deduplication.cjs');

const MAX_FILE_NAMES_LOGGED = 10;

/**
 * Batch check for existing analyses by content hash
 * @param {string[]} contentHashes - Array of content hashes to check
 * @param {any} log - Logger instance
 * @returns {Promise<Map<string, any>>} Map of contentHash -> existing record
 */
async function batchCheckExistingAnalyses(contentHashes, log) {
  const startTime = Date.now();
  
  try {
    const collectionStartTime = Date.now();
    const resultsCol = await getCollection('analysis-results');
    const collectionDurationMs = Date.now() - collectionStartTime;
    
    // Use $in query to fetch all matching records in one go
    const queryStartTime = Date.now();
    const existingRecords = await resultsCol.find({
      contentHash: { $in: contentHashes }
    }).toArray();
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
    log.error('Batch duplicate check failed', {
      error: error.message,
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
  return checkNeedsUpgrade(existing);
}

/**
 * @param {import('@netlify/functions').HandlerEvent} event
 * @param {import('@netlify/functions').HandlerContext} context
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
  }
  
  const log = createLoggerFromEvent('check-duplicates-batch', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'check-duplicates-batch');
  
  try {
    // Parse request body
    const parsed = parseJsonBody(event, log);
    if (!parsed.ok) {
      log.warn('Invalid JSON body', { error: parsed.error });
      timer.end({ error: 'invalid_json' });
      log.exit(400);
      return errorResponse(400, 'invalid_request', parsed.error || 'Invalid JSON', undefined, headers);
    }
    
    const { files } = parsed.value;
    
    if (!Array.isArray(files) || files.length === 0) {
      log.warn('Invalid files array', { filesType: typeof files, filesLength: files?.length });
      timer.end({ error: 'invalid_files' });
      log.exit(400);
      return errorResponse(400, 'invalid_request', 'files must be a non-empty array', undefined, headers);
    }
    
    if (files.length > 100) {
      log.warn('Too many files in batch', { fileCount: files.length });
      timer.end({ error: 'too_many_files' });
      log.exit(400);
      return errorResponse(400, 'invalid_request', 'Maximum 100 files per batch', undefined, headers);
    }
    
    log.info('Processing batch duplicate check', {
      fileCount: files.length,
      fileNames: files.slice(0, MAX_FILE_NAMES_LOGGED).map(f => f?.fileName || 'unknown'),
      event: 'BATCH_START'
    });
    
    // Calculate content hashes for all files
    const hashStartTime = Date.now();
    const fileHashes = [];
    const hashErrors = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      if (!file.image || !file.fileName) {
        hashErrors.push({ index: i, fileName: file.fileName || `file-${i}`, error: 'Missing image or fileName' });
        fileHashes.push({ index: i, fileName: file.fileName || `file-${i}`, contentHash: null });
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
        hashErrors.push({ index: i, fileName: file.fileName, error: hashErr.message });
        fileHashes.push({ index: i, fileName: file.fileName, contentHash: null });
        log.warn('Hash calculation failed for file', {
          fileName: file.fileName || `file-${i}`,
          error: hashErr.message,
          event: 'HASH_FAILED'
        });
      }
    }
    
    const hashDurationMs = Date.now() - hashStartTime;
    
    log.info('Hash calculation complete', {
      totalFiles: files.length,
      successfulHashes: fileHashes.filter(h => h.contentHash).length,
      failedHashes: hashErrors.length,
      hashDurationMs,
      avgHashMs: (hashDurationMs / files.length).toFixed(2),
      event: 'HASH_COMPLETE'
    });
    
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
      .map(h => h.contentHash);

    if (validHashes.length === 0) {
      log.warn('No valid hashes generated, returning non-duplicate results', {
        fileCount: files.length,
        event: 'NO_VALID_HASHES'
      });
    }
    
    // Batch check MongoDB
    let existingRecordsMap = new Map();
    if (validHashes.length > 0) {
      existingRecordsMap = await batchCheckExistingAnalyses(validHashes, log);
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
      
      // Note: analysisData intentionally excluded to prevent PII leakage
      // Clients should use the recordId to fetch full analysis via authenticated endpoint
      return {
        fileName,
        isDuplicate: true,
        needsUpgrade: upgradeCheck.needsUpgrade,
        recordId: existing._id?.toString() || existing.id,
        timestamp: existing.timestamp,
        validationScore: existing.validationScore,
        extractionAttempts: existing.extractionAttempts || 1,
        upgradeReason: upgradeCheck.reason
      };
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
    timer.end({ error: true });
    log.error('Batch duplicate check failed', {
      error: error.message,
      stack: error.stack,
      fileCount: Array.isArray(parsed?.value?.files) ? parsed.value.files.length : undefined,
      event: 'BATCH_ERROR'
    });
    
    const statusCode = error.message?.includes('timeout') ? 408 : 500;
    log.exit(statusCode);
    
    return errorResponse(
      statusCode,
      'batch_check_failed',
      'Batch duplicate check failed',
      { message: error.message },
      headers
    );
  }
};
