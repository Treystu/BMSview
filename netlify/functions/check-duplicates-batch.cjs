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
const { sha256HexFromBase64 } = require('./utils/hash.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

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
 * Determine if an existing record needs upgrade
 * @param {any} existing - Existing analysis record
 * @returns {{ needsUpgrade: boolean, reason?: string }}
 */
function checkIfNeedsUpgrade(existing) {
  if (!existing) {
    return { needsUpgrade: false };
  }
  
  const criticalFields = [
    'dlNumber', 'stateOfCharge', 'overallVoltage', 'current', 'remainingCapacity',
    'chargeMosOn', 'dischargeMosOn', 'balanceOn', 'highestCellVoltage',
    'lowestCellVoltage', 'averageCellVoltage', 'cellVoltageDifference',
    'cycleCount', 'power'
  ];
  
  const hasAllCriticalFields = criticalFields.every(field =>
    existing.analysis &&
    existing.analysis[field] !== null &&
    existing.analysis[field] !== undefined
  );
  
  if (!hasAllCriticalFields) {
    const missingFields = criticalFields.filter(field => 
      !existing.analysis || 
      existing.analysis[field] === null || 
      existing.analysis[field] === undefined
    );
    return { 
      needsUpgrade: true, 
      reason: `Missing ${missingFields.length} critical fields: ${missingFields.slice(0, 3).join(', ')}` 
    };
  }
  
  // Check if already retried with no improvement
  const hasBeenRetriedWithNoImprovement =
    (existing.validationScore !== undefined && existing.validationScore < 100) &&
    (existing.extractionAttempts || 1) >= 2 &&
    existing._wasUpgraded &&
    existing._previousQuality !== undefined &&
    existing._newQuality !== undefined &&
    Math.abs(existing._previousQuality - existing._newQuality) < 0.01;
  
  if (hasBeenRetriedWithNoImprovement) {
    return { needsUpgrade: false, reason: 'Already retried with no improvement' };
  }
  
  // ***CONSERVATIVE: Only upgrade if validation score < 80% (not 100%)***
  const validationScore = existing.validationScore ?? 0;
  const UPGRADE_THRESHOLD = 80;
  
  if (validationScore < UPGRADE_THRESHOLD && (existing.extractionAttempts || 1) < 2) {
    return { 
      needsUpgrade: true, 
      reason: `Low confidence score: ${validationScore}% (threshold: ${UPGRADE_THRESHOLD}%)` 
    };
  }
  
  // Record has acceptable quality (80%+)
  return { needsUpgrade: false, reason: `Acceptable quality: ${validationScore}%` };
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
        const contentHash = sha256HexFromBase64(file.image);
        if (!contentHash) {
          hashErrors.push({ index: i, fileName: file.fileName, error: 'Failed to generate hash' });
          fileHashes.push({ index: i, fileName: file.fileName, contentHash: null });
        } else {
          fileHashes.push({ index: i, fileName: file.fileName, contentHash });
        }
      } catch (hashErr) {
        hashErrors.push({ index: i, fileName: file.fileName, error: hashErr.message });
        fileHashes.push({ index: i, fileName: file.fileName, contentHash: null });
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
        errors: hashErrors.slice(0, 5).map(e => ({
          fileName: e.fileName,
          errorType: e.error && e.error.includes('read') ? 'read_failed' : 'hash_failed'
        }), // Log first 5 sanitized errors
        event: 'HASH_ERRORS'
      });
    }
    
    // Get all valid hashes
    const validHashes = fileHashes
      .filter(h => h.contentHash)
      .map(h => h.contentHash);
    
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
      
      return {
        fileName,
        isDuplicate: true,
        needsUpgrade: upgradeCheck.needsUpgrade,
        recordId: existing._id?.toString() || existing.id,
        timestamp: existing.timestamp,
        validationScore: existing.validationScore,
        extractionAttempts: existing.extractionAttempts || 1,
        upgradeReason: upgradeCheck.reason,
        analysisData: !upgradeCheck.needsUpgrade ? existing.analysis : null
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
