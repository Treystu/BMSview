/**
 * Unified Deduplication Utility
 * 
 * **SINGLE SOURCE OF TRUTH** for all deduplication logic across BMSview.
 * 
 * This module consolidates duplicate detection to ensure consistency across:
 * - Image content hashing (SHA-256 from base64)
 * - Analysis result deduplication  
 * - AI feedback deduplication
 * - Quality-based upgrade detection
 * 
 * **Usage Guidelines:**
 * - All backend endpoints MUST use these functions for duplicate detection
 * - Frontend MUST call backend APIs, NOT implement duplicate logic locally
 * - Use `calculateImageHash()` for content hashing (replaces sha256HexFromBase64)
 * - Use `findDuplicateByHash()` + `checkNeedsUpgrade()` for duplicate checks
 * - Use `detectAnalysisDuplicate()` for comprehensive duplicate detection with upgrade logic
 * 
 * **Architecture:**
 * - Backend: analyze.cjs, check-duplicates-batch.cjs → unified-deduplication.cjs
 * - Frontend: duplicateChecker.ts, geminiService.ts → backend API → unified-deduplication.cjs
 * 
 * @module unified-deduplication
 */

const crypto = require('crypto');
const { getCollection } = require('./mongodb.cjs');
const { COLLECTIONS } = require('./collections.cjs');

/**
 * Generate a short preview of a hash for safe logging.
 * @param {string} hash
 * @returns {string}
 */
const formatHashPreview = (hash) => (hash ? `${hash.substring(0, 16)}...` : 'null');

/**
 * Strip padding from a base64 string for comparison during validation.
 * @param {string} value
 * @returns {string}
 */
const stripPadding = (value = '') => value.replace(/=+$/, '');

// Import existing constants for backward compatibility
const {
  DUPLICATE_UPGRADE_THRESHOLD,
  MIN_QUALITY_IMPROVEMENT,
  CRITICAL_FIELDS
} = require('./duplicate-constants.cjs');

/**
 * Calculate SHA-256 hash from base64-encoded image
 * 
 * **This is the canonical method for image content hashing across BMSview.**
 * Replaces all previous uses of `sha256HexFromBase64` in analyze.cjs and check-duplicates-batch.cjs.
 * 
 * @param {string} base64String - Base64-encoded image data (without data:image/... prefix)
 * @param {Object} [log] - Optional logger with error/debug methods
 * @param {{ skipValidation?: boolean }} [options] - Optional controls (set skipValidation=true for trusted inputs to bypass round-trip validation and the extra re-encode cost)
 * @returns {string|null} - Hex-encoded SHA-256 hash (64 chars) or null on error
 * 
 * @example
 * const hash = calculateImageHash(base64ImageData);
 * if (hash) {
 *   // Hash successfully calculated: "a1b2c3d4..."
 * }
 */
function calculateImageHash(base64String, log = null, { skipValidation = false } = {}) {
  try {
    if (!base64String || typeof base64String !== 'string') {
      if (log?.warn) {
        log.warn('Image hash calculation skipped: missing or invalid base64 payload', {
          hasString: typeof base64String === 'string',
          event: 'HASH_INPUT_INVALID'
        });
      }
      return null;
    }

    // Normalize payload: trim whitespace and strip data URL prefix if present
    const normalized = base64String.trim();
    const cleaned = normalized.startsWith('data:')
      ? normalized.slice(normalized.indexOf(',') + 1)
      : normalized;

    // Remove whitespace that may be introduced by transport layers
    const sanitized = cleaned.replace(/\s+/g, '');

    // Validate base64 by round-tripping through Buffer
    let buffer;
    try {
      buffer = Buffer.from(sanitized, 'base64');
    } catch (decodeError) {
      if (log?.error) {
        log.error('Image hash calculation failed: invalid base64 payload', {
          length: sanitized.length,
          error: decodeError.message,
          event: 'HASH_INVALID_BASE64'
        });
      } else {
        console.error('Error calculating image hash:', decodeError);
      }
      return null;
    }

    // Round-trip validation guards against malformed/poisoned base64.
    // Set skipValidation=true for trusted/prevalidated callers to avoid the extra encode step on large payloads.
    if (!skipValidation) {
      const inputNoPadding = stripPadding(sanitized);
      const roundTripNoPadding = stripPadding(buffer.toString('base64'));
      if (roundTripNoPadding !== inputNoPadding) {
        if (log?.error) {
          log.error('Image hash calculation failed: base64 validation mismatch', {
            length: sanitized.length,
            event: 'HASH_INVALID_BASE64'
          });
        } else {
          console.error('Error calculating image hash: base64 validation mismatch');
        }
        return null;
      }
    }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    if (log?.debug) {
      log.debug('Image hash generated', {
        hashPreview: formatHashPreview(hash),
        imageLength: sanitized.length,
        event: 'HASH_GENERATED'
      });
    }

    return hash;
  } catch (error) {
    if (log?.error) {
      log.error('Error calculating image hash', { error: error.message, event: 'HASH_ERROR' });
    } else {
      console.error('Error calculating image hash:', error);
    }
    return null;
  }
}

/**
 * Calculate SHA-256 hash from JSON object
 * Used for AI feedback and structured data deduplication
 * 
 * @param {Object} content - Object to hash
 * @returns {string} - Hex-encoded SHA-256 hash
 */
function calculateContentHash(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Check if an analysis record needs quality upgrade
 * 
 * **Core upgrade decision logic used by all endpoints.**
 * Determines if a duplicate should be re-analyzed to improve quality.
 * 
 * **Upgrade triggers:**
 * 1. Missing any critical fields (overallVoltage, current, stateOfCharge, etc.)
 * 2. Validation score < 80% (DUPLICATE_UPGRADE_THRESHOLD) AND extractionAttempts < 2
 * 
 * **Upgrade prevention:**
 * - Already retried (extractionAttempts >= 2) with no improvement (< MIN_QUALITY_IMPROVEMENT)
 * - Quality score >= 80% (acceptable quality, no need to waste API calls)
 * 
 * @param {Object} record - Analysis record to check
 * @param {number} [record.validationScore] - Quality/confidence score (0-100)
 * @param {Object} record.analysis - Analysis data object with BMS metrics
 * @param {number} [record.extractionAttempts] - Number of extraction attempts (default: 1)
 * @param {boolean} [record._wasUpgraded] - Flag indicating previous upgrade
 * @param {number} [record._previousQuality] - Quality score before upgrade
 * @param {number} [record._newQuality] - Quality score after upgrade
 * @param {boolean} [record.isComplete] - Flag indicating record is marked as complete
 * @returns {Object} Result object with:
 *   - {boolean} needsUpgrade - Whether the record needs re-analysis
 *   - {string|null} reason - Reason for upgrade decision or null
 *   - {boolean} [shouldMarkComplete] - Signal that record should be marked complete (optional)
 *   - {boolean} [isComplete] - Indicates record is marked complete (optional)
 * 
 * @example
 * const upgradeCheck = checkNeedsUpgrade(existingRecord);
 * if (upgradeCheck.needsUpgrade) {
 *   console.log('Upgrade reason:', upgradeCheck.reason);
 *   // Re-analyze to improve quality
 * }
 */
function checkNeedsUpgrade(record) {
  if (!record || !record.analysis) {
    return { needsUpgrade: true, reason: 'Missing analysis data' };
  }

  // Check if record is marked as complete (admin override or confident extraction)
  // Complete records are NEVER upgraded unless explicitly forced by admin
  // FIX: Treat legacy records (undefined) as complete to prevent them from being filtered out
  if (record.isComplete === true || record.isComplete === undefined) {
    return {
      needsUpgrade: false,
      reason: 'Record marked as complete (or legacy)',
      isComplete: true,
      shouldMarkComplete: true // Signal to backfill isComplete=true in DB
    };
  }

  // Check for validated obstruction (New Feature)
  // If the AI previously determined the image was obstructed, don't retry endlessly.
  if (record.analysis && record.analysis.obstructionDetected === true) {
    return {
      needsUpgrade: false,
      reason: `Obstruction detected: ${record.analysis.obstructionReason || 'Unknown'}`,
      shouldMarkComplete: true
    };
  }

  // CRITICAL: Check for missing critical fields FIRST (highest priority)
  // This must come before validation score check
  const hasAllCriticalFields = CRITICAL_FIELDS.every(field => {
    const value = record.analysis && record.analysis[field];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') {
      const upper = value.toUpperCase();
      if (upper === 'UNIDENTIFIED' || upper === 'UNKNOWN') return false;
    }
    return true;
  });

  if (!hasAllCriticalFields) {
    const missingFields = CRITICAL_FIELDS.filter(field => {
      const value = record.analysis && record.analysis[field];
      if (value === null || value === undefined) return true;
      if (typeof value === 'string') {
        const upper = value.toUpperCase();
        if (upper === 'UNIDENTIFIED' || upper === 'UNKNOWN') return true;
      }
      return false;
    });
    return {
      needsUpgrade: true,
      reason: `Missing ${missingFields.length} critical fields: ${missingFields.slice(0, 3).join(', ')}`
    };
  }

  // Check if this record has already been retried with no improvement
  // If so, mark as complete and don't upgrade again (prevents infinite retry loops)
  const hasBeenRetriedWithNoImprovement =
    (record.validationScore !== undefined && record.validationScore < 100) &&
    (record.extractionAttempts || 1) >= 2 &&
    record._wasUpgraded &&
    record._previousQuality !== undefined &&
    record._newQuality !== undefined &&
    Math.abs(record._previousQuality - record._newQuality) < MIN_QUALITY_IMPROVEMENT;

  if (hasBeenRetriedWithNoImprovement) {
    return {
      needsUpgrade: false,
      reason: 'Already retried with no improvement',
      shouldMarkComplete: true // Signal that this should be marked complete
    };
  }

  // Check validation score (only if critical fields are present and not already retried)
  // FIX: Default to 100 (acceptable quality) if validationScore is not stored
  // The 'history' collection doesn't have validationScore, so we assume records there are valid
  // if they have all critical fields (which was already checked above)
  const validationScore = record.validationScore ?? 100;

  if (validationScore < DUPLICATE_UPGRADE_THRESHOLD && (record.extractionAttempts || 1) < 2) {
    return {
      needsUpgrade: true,
      reason: `Low quality score: ${validationScore}% < ${DUPLICATE_UPGRADE_THRESHOLD}%`
    };
  }

  // Record has acceptable quality (all critical fields + score ≥ 80%)
  // Mark as complete if score is high or if we've exhausted retries
  const shouldMarkComplete = validationScore >= DUPLICATE_UPGRADE_THRESHOLD || (record.extractionAttempts || 1) >= 2;

  return {
    needsUpgrade: false,
    reason: null,
    shouldMarkComplete
  };
}

/**
 * Find duplicate analysis record by content hash
 * 
 * **Core MongoDB query for duplicate detection.**
 * Used by analyze.cjs and check-duplicates-batch.cjs via wrapper functions.
 * 
 * @param {string} contentHash - SHA-256 hash of image content (from calculateImageHash)
 * @param {Object} collection - MongoDB collection instance (history)
 * @param {Object} log - Logger instance for structured logging
 * @returns {Promise<Object|null>} - Duplicate record or null if not found
 * 
 * @example
 * const resultsCol = await getCollection('history');
 * const duplicate = await findDuplicateByHash(contentHash, resultsCol, log);
 * if (duplicate) {
 *   const upgradeCheck = checkNeedsUpgrade(duplicate);
 *   // Handle duplicate or upgrade
 * }
 */
async function findDuplicateByHash(contentHash, collection, log) {
  const startTime = Date.now();
  try {
    log.info('DUPLICATE_LOOKUP: Querying MongoDB for content hash', {
      contentHashPreview: contentHash.substring(0, 16) + '...',
      fullHashLength: contentHash.length,
      event: 'MONGO_QUERY_START'
    });

    const duplicate = await collection.findOne({ contentHash });

    const durationMs = Date.now() - startTime;

    if (duplicate) {
      log.info('DUPLICATE_LOOKUP: Found matching record in MongoDB', {
        recordId: duplicate._id?.toString?.() || duplicate._id || duplicate.id,
        contentHashPreview: contentHash.substring(0, 16) + '...',
        timestamp: duplicate.timestamp,
        validationScore: duplicate.validationScore,
        hasAnalysis: !!duplicate.analysis,
        durationMs,
        event: 'MONGO_FOUND'
      });

      return duplicate;
    }

    log.info('DUPLICATE_LOOKUP: No matching record found in MongoDB', {
      contentHashPreview: contentHash.substring(0, 16) + '...',
      durationMs,
      event: 'MONGO_NOT_FOUND'
    });

    return null;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('DUPLICATE_LOOKUP: MongoDB query failed', {
      error: error.message,
      contentHashPreview: contentHash.substring(0, 16) + '...',
      durationMs,
      event: 'MONGO_ERROR'
    });
    return null;
  }
}

/**
 * Comprehensive duplicate detection for analysis records
 * 
 * **High-level duplicate detection with automatic upgrade logic.**
 * Combines image hashing + duplicate lookup + upgrade check in one call.
 * 
 * **Workflow:**
 * 1. Calculate content hash from base64 image (SHA-256)
 * 2. Search MongoDB for existing record with same hash
 * 3. If found, check if upgrade is needed (checkNeedsUpgrade)
 * 4. Return comprehensive result object
 * 
 * **Use this when:**
 * - You have a base64 image and want to check for duplicates in one call
 * - You need to know both duplicate status AND upgrade recommendation
 * 
 * **Use findDuplicateByHash + checkNeedsUpgrade when:**
 * - You already have the content hash
 * - You want more control over the process
 * 
 * @param {string} base64Image - Base64-encoded image (without data:image/... prefix)
 * @param {Object} collection - MongoDB history collection
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Result object with:
 *   - {boolean} isDuplicate - True if duplicate exists
 *   - {boolean} needsUpgrade - True if existing record needs re-analysis
 *   - {Object|null} existingRecord - Full existing record or null
 *   - {string|null} contentHash - Calculated SHA-256 hash or null on error
 *   - {string} [upgradeReason] - Reason for upgrade (if needsUpgrade=true)
 *   - {string} [error] - Error message if hash calculation failed
 * 
 * @example
 * const result = await detectAnalysisDuplicate(base64Image, collection, log);
 * 
 * if (!result.isDuplicate) {
 *   // New analysis - proceed with full analysis
 * } else if (result.needsUpgrade) {
 *   // Low-quality duplicate - re-analyze to upgrade
 *   console.log('Upgrade reason:', result.upgradeReason);
 * } else {
 *   // High-quality duplicate - return existing record
 *   return result.existingRecord;
 * }
 */
async function detectAnalysisDuplicate(base64Image, collection, log) {
  // Calculate content hash
  const contentHash = calculateImageHash(base64Image);

  if (!contentHash) {
    return {
      isDuplicate: false,
      needsUpgrade: false,
      existingRecord: null,
      contentHash: null,
      error: 'Failed to calculate content hash'
    };
  }

  // Find existing record
  const existingRecord = await findDuplicateByHash(contentHash, collection, log);

  if (!existingRecord) {
    return {
      isDuplicate: false,
      needsUpgrade: false,
      existingRecord: null,
      contentHash
    };
  }

  // Check if existing record needs upgrade
  const upgradeCheck = checkNeedsUpgrade(existingRecord);

  return {
    isDuplicate: true,
    needsUpgrade: upgradeCheck.needsUpgrade,
    upgradeReason: upgradeCheck.reason,
    existingRecord,
    contentHash
  };
}

/**
 * Calculate text similarity using Jaccard index
 * Used for semantic duplicate detection in AI feedback
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score between 0 and 1
 */
function calculateTextSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.length === 0 && s2.length === 0) return 1.0;

  const words1 = new Set(s1.split(/\s+/).filter(w => w.length > 0));
  const words2 = new Set(s2.split(/\s+/).filter(w => w.length > 0));

  if (words1.size === 0 && words2.size === 0) return 1.0;
  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Detect semantic duplicates in AI feedback
 * Combines exact hash matching with similarity scoring
 * 
 * @param {Object} newFeedback - New feedback to check
 * @param {Object} collection - MongoDB feedback collection
 * @param {Object} options - { similarityThreshold: number }
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} - { isDuplicate, matchType, existingId, similarity, similarItems }
 */
async function detectFeedbackDuplicate(newFeedback, collection, options = {}, log) {
  const similarityThreshold = options.similarityThreshold || 0.7;

  try {
    // 1. Exact hash match
    const contentHash = calculateContentHash(newFeedback.suggestion);

    const exactMatch = await collection.findOne({
      contentHash,
      status: { $in: ['pending', 'reviewed', 'accepted'] }
    });

    if (exactMatch) {
      log.info('Exact feedback duplicate found', { existingId: exactMatch.id });
      return {
        isDuplicate: true,
        matchType: 'exact',
        existingId: exactMatch.id,
        similarity: 1.0,
        similarItems: []
      };
    }

    // 2. Semantic similarity check
    const recentFeedback = await collection
      .find({
        systemId: newFeedback.systemId,
        status: { $nin: ['rejected'] }
      })
      .limit(100)
      .toArray();

    const similarItems = [];

    for (const existing of recentFeedback) {
      if (existing.status === 'rejected' || existing.status === 'implemented') {
        continue;
      }

      const titleSim = calculateTextSimilarity(
        newFeedback.suggestion.title,
        existing.suggestion.title
      );
      const descSim = calculateTextSimilarity(
        newFeedback.suggestion.description,
        existing.suggestion.description
      );
      const ratSim = calculateTextSimilarity(
        newFeedback.suggestion.rationale,
        existing.suggestion.rationale
      );

      const overallSim = titleSim * 0.5 + descSim * 0.3 + ratSim * 0.2;

      if (overallSim >= similarityThreshold) {
        similarItems.push({
          feedbackId: existing.id,
          similarity: Math.round(overallSim * 100) / 100,
          existing: {
            title: existing.suggestion.title,
            status: existing.status,
            priority: existing.priority
          }
        });
      }
    }

    similarItems.sort((a, b) => b.similarity - a.similarity);

    if (similarItems.length > 0 && similarItems[0].similarity >= 0.9) {
      log.info('High similarity feedback duplicate found', {
        existingId: similarItems[0].feedbackId,
        similarity: similarItems[0].similarity
      });
      return {
        isDuplicate: true,
        matchType: 'similar',
        existingId: similarItems[0].feedbackId,
        similarity: similarItems[0].similarity,
        similarItems: similarItems.slice(0, 5)
      };
    }

    return {
      isDuplicate: false,
      matchType: 'none',
      existingId: null,
      similarity: 0,
      similarItems: similarItems.slice(0, 5)
    };
  } catch (error) {
    log.error('Feedback duplicate detection failed', { error: error.message });
    return {
      isDuplicate: false,
      matchType: 'error',
      error: error.message,
      similarItems: []
    };
  }
}

/**
 * Checks for existing analysis by content hash using unified deduplication
 * Now centralized in unified-deduplication.cjs (moved from analyze.cjs)
 * 
 * @param {string} contentHash - Content hash to check
 * @param {any} log - Logger instance
 * @param {string} [fileName] - Optional filename for legacy lookup
 * @returns {Promise<any>} Existing analysis if found, { _isUpgrade: true, _existingRecord } if upgrade needed, or null
 */
async function checkExistingAnalysis(contentHash, log, fileName = null) {
  const startTime = Date.now();
  try {
    const preview = contentHash ? contentHash.substring(0, 16) + '...' : 'null';
    const hashLen = contentHash ? contentHash.length : 0;
    
    log.info('DUPLICATE_CHECK: Starting database lookup', {
      contentHashPreview: preview,
      fullHashLength: hashLen,
      fileName,
      event: 'DB_LOOKUP_START'
    });

    const resultsCol = await getCollection(COLLECTIONS.ANALYSIS_RESULTS);
    const historyCol = await getCollection(COLLECTIONS.HISTORY);

    // 1. Try unified deduplication module (Hash Match)
    let existingRecord = await findDuplicateByHash(contentHash, resultsCol, log);

    // 2. Fallback: Filename/Timestamp Match (Legacy Recovery)
    if (!existingRecord && fileName) {
        let matchMethod = null;

        // Method A: Exact Filename Match
        if (fileName.includes('Screenshot_') || fileName.match(/\d{8}-\d{6}/)) {
            existingRecord = await resultsCol.findOne({ fileName });
            if (!existingRecord) {
                 existingRecord = await historyCol.findOne({ fileName });
            }
            if (existingRecord) matchMethod = 'filename';
        }

        // Method B: Timestamp Extraction Match (The "Smart" Check)
        if (!existingRecord) {
            const tsMatch = fileName.match(/Screenshot_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
            if (tsMatch) {
                const [_, y, m, d, h, min, s] = tsMatch;
                const fileDate = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
                
                if (!isNaN(fileDate.getTime())) {
                    // Create a 5-second window around the filename time
                    const start = new Date(fileDate.getTime() - 2500);
                    const end = new Date(fileDate.getTime() + 2500);
                    
                    // Look in HISTORY (where legacy records live)
                    existingRecord = await historyCol.findOne({
                        timestamp: { $gte: start.toISOString(), $lte: end.toISOString() }
                    });
                    
                    if (existingRecord) matchMethod = 'timestamp_heuristic';
                }
            }
        }

        if (existingRecord) {
            const recId = existingRecord._id || existingRecord.id;
            log.info(`DUPLICATE_CHECK: Found legacy record by ${matchMethod}`, {
                fileName,
                matchMethod,
                recordId: recId,
                event: 'LEGACY_FALLBACK_FOUND'
            });

            // AUTO-HEAL: Backfill the contentHash
            try {
                // Upsert into analysis-results
                const update = { 
                    contentHash, 
                    updatedAt: new Date(),
                    id: existingRecord.id,
                    analysis: existingRecord.analysis,
                    timestamp: existingRecord.timestamp,
                    fileName: fileName
                };
                
                await resultsCol.updateOne(
                    { id: existingRecord.id },
                    { $set: update },
                    { upsert: true }
                );
                
                // Update history collection hash
                await historyCol.updateOne(
                    { id: existingRecord.id },
                    { $set: { analysisKey: contentHash, contentHash } }
                );

                log.info('DUPLICATE_CHECK: Backfilled contentHash for legacy record');
                if (!existingRecord.validationScore) existingRecord.validationScore = 100;
            } catch (e) {
                log.warn('Failed to backfill hash', { error: e.message });
            }
        }
    }

    const totalDurationMs = Date.now() - startTime;

    if (!existingRecord) {
      log.info('DUPLICATE_CHECK: No existing analysis found in database', {
        contentHashPreview: preview,
        totalDurationMs,
        event: 'NOT_FOUND'
      });
      return null;
    }

    const recId = existingRecord._id || existingRecord.id;

    log.info('DUPLICATE_CHECK: Found existing record, checking quality', {
      recordId: recId,
      validationScore: existingRecord.validationScore,
      extractionAttempts: existingRecord.extractionAttempts || 1,
      isComplete: existingRecord.isComplete || false,
      hasAnalysis: !!existingRecord.analysis,
      contentHashPreview: preview,
      event: 'RECORD_FOUND'
    });

    const upgradeCheck = checkNeedsUpgrade(existingRecord);

    log.info('DUPLICATE_CHECK: Upgrade check result', {
      needsUpgrade: upgradeCheck.needsUpgrade,
      reason: upgradeCheck.reason,
      shouldMarkComplete: upgradeCheck.shouldMarkComplete,
      contentHashPreview: preview,
      event: 'UPGRADE_CHECK_RESULT'
    });

    if (upgradeCheck.shouldMarkComplete && !existingRecord.isComplete) {
      try {
        await resultsCol.updateOne(
          { _id: existingRecord._id },
          { $set: { isComplete: true, completedAt: new Date() } }
        );
        existingRecord.isComplete = true;
      } catch (markError) {
        log.warn('DUPLICATE_CHECK: Failed to mark record as complete', { error: markError.message });
      }
    }

    if (upgradeCheck.needsUpgrade) {
      log.info('DUPLICATE_CHECK: Returning upgrade needed response', {
        contentHashPreview: preview,
        upgradeReason: upgradeCheck.reason,
        recordId: recId,
        totalDurationMs,
        event: 'UPGRADE_NEEDED'
      });
      return { _isUpgrade: true, _existingRecord: existingRecord };
    }

    log.info('DUPLICATE_CHECK: Returning high-quality duplicate', {
      contentHashPreview: preview,
      validationScore: existingRecord.validationScore,
      isComplete: existingRecord.isComplete || false,
      recordId: recId,
      totalDurationMs,
      event: 'HIGH_QUALITY_DUPLICATE'
    });

    return existingRecord;
  } catch (error) {
    const totalDurationMs = Date.now() - startTime;
    const preview = contentHash ? contentHash.substring(0, 16) + '...' : 'null';
    log.error('DUPLICATE_CHECK: Database lookup failed', {
      error: error.message,
      stack: error.stack?.substring?.(0, 500),
      contentHashPreview: preview,
      totalDurationMs,
      event: 'DB_LOOKUP_ERROR'
    });
    // Re-throw to let caller decide how to handle
    throw error;
  }
}

/**
 * Batch check for existing analyses by content hash with legacy filename fallback
 * 
 * **Unified Batch Processing Logic**
 * Handles both fast hash lookups and slow legacy recovery with dual-write backfill.
 * 
 * @param {Array<{fileName: string, contentHash: string}>} validHashEntries - Array of { fileName, contentHash } objects
 * @param {import('./jsdoc-types.cjs').LogLike} log - Logger instance
 * @param {boolean} [includeData=false] - Whether to include full record data (PR #339)
 * @returns {Promise<Map<string, any>>} Map of contentHash -> existing record
 */
async function batchCheckExistingAnalyses(validHashEntries, log, includeData = false) {
  const startTime = Date.now();
  // Extract just the hashes for the primary query
  const contentHashes = validHashEntries.map(e => e.contentHash);

  try {
    const collectionStartTime = Date.now();
    // CRITICAL FIX: Use 'history' collection, NOT 'analysis-results'
    // Records are saved to 'history', so duplicate detection must check there
    // The 'analysis-results' collection was not being populated, causing missed duplicates
    const resultsCol = await getCollection('history');
    
    // For dual-write backfill
    const analysisResultsCol = await getCollection('analysis-results');
    
    const collectionDurationMs = Date.now() - collectionStartTime;

    // Use $in query to fetch all matching records in one go
    const queryStartTime = Date.now();

    // Optimization: Use projection if full data is not requested (PR #339)
    // We still need metadata for checkIfNeedsUpgrade to work correctly
    // FIX: 'history' collection stores hash as 'analysisKey', not 'contentHash'
    const projection = includeData ? {} : {
      _id: 1,
      analysisKey: 1,
      contentHash: 1, // Include contentHash for analysis-results check
      timestamp: 1,
      fileName: 1, // Needed for legacy matching
      validationScore: 1,
      extractionAttempts: 1,
      isComplete: 1,
      analysis: 1, // We fetch the analysis object but it's much smaller than rawOutput or images if stored
      _wasUpgraded: 1,
      _previousQuality: 1,
      _newQuality: 1
    };

    // 1. Primary Check: 'analysis-results' collection (Source of Truth)
    // This collection uses 'contentHash' field
    const primaryRecords = await analysisResultsCol.find(
      { contentHash: { $in: contentHashes } },
      { projection }
    ).toArray();

    // Map primary records to contentHash
    const resultMap = new Map();
    for (const record of primaryRecords) {
      if (record.contentHash) {
        resultMap.set(record.contentHash, record);
      }
    }

    // 2. Secondary Check: 'history' collection (Legacy)
    // Only check for hashes not found in primary source
    const foundPrimaryHashes = new Set(primaryRecords.map(r => r.contentHash));
    const pendingHashes = contentHashes.filter(h => !foundPrimaryHashes.has(h));

    const existingRecords = [];
    
    if (pendingHashes.length > 0) {
      // FIX: Query on 'analysisKey' field - that's what 'history' collection uses
      const historyRecords = await resultsCol.find(
        { analysisKey: { $in: pendingHashes } },
        { projection }
      ).toArray();
      
      existingRecords.push(...historyRecords);
      
      // Add history records to map (using analysisKey as hash)
      for (const record of historyRecords) {
        if (record.analysisKey) {
          resultMap.set(record.analysisKey, record);
        }
      }
    }

    // -------------------------------------------------------------------------
    // LEGACY RECOVERY: Fallback to filename matching for items not found by hash
    // -------------------------------------------------------------------------
    // Combine found hashes from both sources
    const allFoundHashes = new Set([...foundPrimaryHashes, ...existingRecords.map(r => r.analysisKey)]);
    const missingEntries = validHashEntries.filter(e => !allFoundHashes.has(e.contentHash));

    let recoveredCount = 0;
    
    if (missingEntries.length > 0) {
      const legacyStartTime = Date.now();
      const missingFileNames = missingEntries.map(e => e.fileName);
      
      // Find potential legacy records by filename
      // Note: Filenames might not be unique globally, but within a batch context/source of truth re-upload,
      // it's a strong signal. Ideally we'd check timestamps too but we don't have them in hash-only mode.
      const legacyMatches = await resultsCol.find(
        { 
          fileName: { $in: missingFileNames },
          analysisKey: { $exists: false } // Only match records that DON'T have a hash yet (true legacy)
        },
        { projection }
      ).toArray();

      if (legacyMatches.length > 0) {
        log.info('Batch duplicate check: Found potential legacy records by filename', {
          count: legacyMatches.length,
          totalMissing: missingEntries.length
        });

        // Prepare bulk update to backfill hashes
        const historyBulkOps = [];
        const resultsBulkOps = [];
        
        for (const match of legacyMatches) {
          // Find which input entry corresponds to this legacy record
          // Note: If multiple inputs have same filename, this might pick one. 
          // But inputs are unique by file instance usually.
          const entry = missingEntries.find(e => e.fileName === match.fileName);
          
          if (entry) {
            // MATCH FOUND!
            // 1. Add to existingRecords (as if we found it by hash)
            // We must inject the analysisKey so the map below works
            match.analysisKey = entry.contentHash; 
            existingRecords.push(match);
            recoveredCount++;

            const updateData = { 
              analysisKey: entry.contentHash, 
              contentHash: entry.contentHash, 
              updatedAt: new Date() 
            };

            // 2. Queue backfill operation for HISTORY
            historyBulkOps.push({
              updateOne: {
                filter: { _id: match._id },
                update: { $set: updateData }
              }
            });

            // 3. Queue upsert/backfill operation for ANALYSIS-RESULTS
            // We need to mirror the record to analysis-results to ensure consistency
            // The match object from 'history' has _id, analysis, timestamp, fileName etc.
            // We need to map it to analysis-results schema (which uses 'id' string primarily, not _id ObjectId)
            // match.id is likely the string ID.
            if (match.id) {
                const resultRecord = {
                    id: match.id,
                    contentHash: entry.contentHash,
                    fileName: match.fileName,
                    timestamp: match.timestamp,
                    analysis: match.analysis,
                    updatedAt: new Date(),
                    // Carry over other fields if present
                    validationScore: match.validationScore || 100,
                    systemId: match.systemId || match.analysis?.systemId
                };

                resultsBulkOps.push({
                    updateOne: {
                        filter: { id: match.id },
                        update: { $set: resultRecord },
                        upsert: true
                    }
                });
            }
          }
        }

        // Execute backfill for HISTORY
        if (historyBulkOps.length > 0) {
          try {
            const bulkWriteResult = await resultsCol.bulkWrite(historyBulkOps, { ordered: false });
            log.info('Batch duplicate check: Backfilled hashes for legacy records (HISTORY)', {
              matched: bulkWriteResult.matchedCount,
              modified: bulkWriteResult.modifiedCount,
              durationMs: Date.now() - legacyStartTime
            });
          } catch (writeError) {
            log.warn('Batch duplicate check: Failed to backfill hashes (HISTORY)', { error: writeError.message });
          }
        }

        // Execute backfill for ANALYSIS-RESULTS
        if (resultsBulkOps.length > 0) {
            try {
              const bulkWriteResult = await analysisResultsCol.bulkWrite(resultsBulkOps, { ordered: false });
              log.info('Batch duplicate check: Backfilled hashes for legacy records (ANALYSIS-RESULTS)', {
                matched: bulkWriteResult.matchedCount,
                modified: bulkWriteResult.modifiedCount,
                upserted: bulkWriteResult.upsertedCount,
                durationMs: Date.now() - legacyStartTime
              });
            } catch (writeError) {
              log.warn('Batch duplicate check: Failed to backfill hashes (ANALYSIS-RESULTS)', { error: writeError.message });
            }
          }
      }
    }

    const queryDurationMs = Date.now() - queryStartTime;
    const totalDurationMs = Date.now() - startTime;

    log.info('Batch duplicate check complete', {
      requestedCount: contentHashes.length,
      foundPrimaryCount: primaryRecords.length,
      foundLegacyCount: existingRecords.length,
      legacyRecovered: recoveredCount,
      collectionDurationMs,
      queryDurationMs,
      totalDurationMs,
      avgPerHashMs: (totalDurationMs / contentHashes.length).toFixed(2),
      event: 'BATCH_CHECK_COMPLETE'
    });

    // Convert array to Map for O(1) lookups
    // Map is already built above!
    // Just return it.
    
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

module.exports = {
  // ============================================
  // Image Hashing
  // ============================================

  /**
   * calculateImageHash: SHA-256 hash from base64 image
   * Canonical method for content hashing across all endpoints
   */
  calculateImageHash,
  formatHashPreview,

  /**
   * calculateContentHash: SHA-256 hash from JSON object
   * Used for AI feedback and structured data deduplication
   */
  calculateContentHash,

  // ============================================
  // Analysis Duplicate Detection
  // ============================================

  /**
   * detectAnalysisDuplicate: High-level duplicate detection (image → hash → lookup → upgrade check)
   * Use when you have base64 image and want comprehensive check
   */
  detectAnalysisDuplicate,

  /**
   * findDuplicateByHash: MongoDB lookup by content hash
   * Use when you already have the hash
   */
  findDuplicateByHash,

  /**
   * checkExistingAnalysis: High-level check with Legacy Fallback (Filename/Timestamp)
   * Use this when checking for duplicates before analysis
   */
  checkExistingAnalysis,

  /**
   * batchCheckExistingAnalyses: Batch check with Legacy Fallback and Dual-Write Backfill
   * Use this for bulk upload duplicate checking
   */
  batchCheckExistingAnalyses,

  /**
   * checkNeedsUpgrade: Determine if record needs quality upgrade
   * Core upgrade decision logic used by all endpoints
   */
  checkNeedsUpgrade,

  // ============================================
  // Feedback Duplicate Detection
  // ============================================

  /**
   * detectFeedbackDuplicate: Semantic duplicate detection for AI feedback
   * Combines exact hash matching with similarity scoring
   */
  detectFeedbackDuplicate,

  /**
   * calculateTextSimilarity: Jaccard similarity for text comparison
   * Used by feedback duplicate detection
   */
  calculateTextSimilarity,

  // ============================================
  // Constants (re-exported from duplicate-constants.cjs)
  // ============================================

  /**
   * DUPLICATE_UPGRADE_THRESHOLD: Validation score threshold (80%)
   * Records below this score are candidates for upgrade
   */
  DUPLICATE_UPGRADE_THRESHOLD,

  /**
   * MIN_QUALITY_IMPROVEMENT: Minimum improvement required (5%)
   * Prevents wasteful retries when quality doesn't improve
   */
  MIN_QUALITY_IMPROVEMENT,

  /**
   * CRITICAL_FIELDS: Required BMS metrics
   * Missing any of these fields triggers upgrade
   */
  CRITICAL_FIELDS
};