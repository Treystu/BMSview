/**
 * Diagnostic endpoint for duplicate detection system
 * 
 * GET /.netlify/functions/duplicate-diagnostics
 * 
 * Returns:
 * - MongoDB index status for contentHash
 * - Sample query performance metrics
 * - Duplicate detection statistics
 */

const { errorResponse } = require('./utils/errors.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const {
  createStandardEntryMeta,
  logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * @param {import('@netlify/functions').HandlerEvent} event
 * @param {import('@netlify/functions').HandlerContext} context
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
  }

  const log = createLoggerFromEvent('duplicate-diagnostics', event, context);
  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Duplicate diagnostics request', includeBody: false });
  /** @type {any} */
  const timer = createTimer(log, 'duplicate-diagnostics');

  try {
    /** @type {any} */
    const resultsCol = await getCollection('analysis-results');

    // Check indexes
    const indexStartTime = Date.now();
    const indexes = await resultsCol.indexes();
    const indexDurationMs = Date.now() - indexStartTime;

    const contentHashIndex = indexes.find(/** @param {any} idx */(idx) => idx.key && idx.key.contentHash !== undefined);
    const hasContentHashIndex = !!contentHashIndex;

    // Get collection stats
    const statsStartTime = Date.now();
    const stats = await resultsCol.stats();
    const statsDurationMs = Date.now() - statsStartTime;

    // Count total records
    const countStartTime = Date.now();
    const totalRecords = await resultsCol.countDocuments();
    const countDurationMs = Date.now() - countStartTime;

    // Count records with contentHash
    const hashCountStartTime = Date.now();
    const recordsWithHash = await resultsCol.countDocuments({ contentHash: { $exists: true, $ne: null } });
    const hashCountDurationMs = Date.now() - hashCountStartTime;

    // Sample query performance (find one by contentHash)
    let sampleQueryDurationMs = null;
    let sampleQueryUsedIndex = false;

    if (recordsWithHash > 0) {
      // Get a sample contentHash
      const sampleRecord = await resultsCol.findOne({ contentHash: { $exists: true } });

      if (sampleRecord && sampleRecord.contentHash) {
        const queryStartTime = Date.now();
        const explainResult = await resultsCol.find({ contentHash: sampleRecord.contentHash }).explain('executionStats');
        sampleQueryDurationMs = Date.now() - queryStartTime;

        // Check if index was used (IXSCAN vs COLLSCAN)
        const winningPlan = explainResult.queryPlanner?.winningPlan || explainResult.executionStats?.executionStages;
        sampleQueryUsedIndex = JSON.stringify(winningPlan).includes('IXSCAN');
      }
    }

    // Count records by validation score ranges
    const scoreRangesStartTime = Date.now();
    const scoreRanges = await resultsCol.aggregate([
      {
        $bucket: {
          groupBy: '$validationScore',
          boundaries: [0, 50, 80, 90, 100, 101],
          default: 'null',
          output: { count: { $sum: 1 } }
        }
      }
    ]).toArray();
    const scoreRangesDurationMs = Date.now() - scoreRangesStartTime;

    // Count records by extraction attempts
    const attemptsStartTime = Date.now();
    const attemptCounts = await resultsCol.aggregate([
      {
        $group: {
          _id: { $ifNull: ['$extractionAttempts', 1] },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();
    const attemptsDurationMs = Date.now() - attemptsStartTime;

    const durationMs = timer.end({ hasIndex: hasContentHashIndex });

    log.info('Duplicate diagnostics complete', {
      hasContentHashIndex,
      totalRecords,
      recordsWithHash,
      sampleQueryUsedIndex,
      durationMs,
      event: 'DIAGNOSTICS_COMPLETE'
    });

    log.exit(200);

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexes: {
          hasContentHashIndex,
          contentHashIndexDetails: contentHashIndex || null,
          totalIndexes: indexes.length,
          allIndexes: indexes.map(/** @param {any} idx */(idx) => ({
            name: idx.name,
            key: idx.key,
            unique: idx.unique,
            sparse: idx.sparse
          })),
          checkDurationMs: indexDurationMs
        },
        collection: {
          totalRecords,
          recordsWithHash,
          percentWithHash: totalRecords > 0 ? ((recordsWithHash / totalRecords) * 100).toFixed(2) : 0,
          sizeBytes: stats.size,
          avgObjSizeBytes: stats.avgObjSize,
          countDurationMs,
          hashCountDurationMs
        },
        performance: {
          sampleQueryDurationMs,
          sampleQueryUsedIndex,
          expectedQueryType: hasContentHashIndex ? 'IXSCAN (index scan)' : 'COLLSCAN (collection scan)',
          recommendation: hasContentHashIndex
            ? (sampleQueryUsedIndex ? 'Index is present and being used correctly' : 'Index exists but may not be used - check query patterns')
            : 'CRITICAL: contentHash index is missing - duplicate detection will be very slow'
        },
        qualityDistribution: {
          byValidationScore: scoreRanges.map(/** @param {any} r */(r) => ({
            range: r._id === 0 ? '0-49%' :
              r._id === 50 ? '50-79%' :
                r._id === 80 ? '80-89%' :
                  r._id === 90 ? '90-99%' :
                    r._id === 100 ? '100%' :
                      'null',
            count: r.count
          })),
          byExtractionAttempts: attemptCounts.map(/** @param {any} r */(r) => ({
            attempts: r._id,
            count: r.count
          })),
          scoreRangesDurationMs,
          attemptsDurationMs
        },
        recommendations: [
          !hasContentHashIndex && 'Create contentHash index: db.analysis_results.createIndex({ contentHash: 1 }, { unique: true, sparse: true, background: true })',
          sampleQueryDurationMs && sampleQueryDurationMs > 100 && 'Query performance is slow - check if index is being used',
          recordsWithHash < totalRecords && `${totalRecords - recordsWithHash} records are missing contentHash - run migration to add hashes`,
        ].filter(Boolean),
        timing: {
          totalDurationMs: durationMs,
          breakdown: {
            indexCheck: indexDurationMs,
            collectionStats: statsDurationMs,
            totalCount: countDurationMs,
            hashCount: hashCountDurationMs,
            sampleQuery: sampleQueryDurationMs,
            scoreRanges: scoreRangesDurationMs,
            attemptCounts: attemptsDurationMs
          }
        }
      })
    };

  } catch (error) {
    timer.end({ error: true });
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.error('Duplicate diagnostics failed', {
      error: message,
      stack,
      event: 'DIAGNOSTICS_ERROR'
    });

    log.exit(500);

    return errorResponse(
      500,
      'diagnostics_failed',
      'Duplicate diagnostics failed',
      { message },
      headers
    );
  }
};
