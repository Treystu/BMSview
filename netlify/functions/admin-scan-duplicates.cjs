/**
 * Admin Duplicate Scanner Endpoint
 * 
 * Scans all analysis records for duplicates using the SAME logic as main app
 * (contentHash-based, not client-side voltage/current keys).
 * 
 * Returns duplicate sets grouped by contentHash, sorted by timestamp.
 * Earliest record in each set is kept, others marked for deletion.
 * 
 * This ensures admin duplicate scanner uses UNIFIED backend logic.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { errorResponse } = require('./utils/errors.cjs');

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
  
  const log = createLoggerFromEvent('admin-scan-duplicates', event, context);
  const timer = createTimer(log, 'admin-scan-duplicates');
  
  log.entry({ method: event.httpMethod, path: event.path });
  
  try {
    const resultsCol = await getCollection('analysis-results');
    
    // Find all records, group by contentHash
    log.info('Fetching all analysis records for duplicate scan');
    const allRecords = await resultsCol.find({}).toArray();
    
    log.info('Records fetched, grouping by contentHash', { totalRecords: allRecords.length });
    
    // Group by contentHash
    const recordsByHash = new Map();
    for (const record of allRecords) {
      if (!record.contentHash) {
        log.warn('Record without contentHash found, skipping', { 
          recordId: record._id,
          fileName: record.fileName 
        });
        continue;
      }
      
      if (!recordsByHash.has(record.contentHash)) {
        recordsByHash.set(record.contentHash, []);
      }
      recordsByHash.get(record.contentHash).push(record);
    }
    
    // Filter to only groups with duplicates (2+ records)
    const duplicateSets = [];
    for (const [contentHash, records] of recordsByHash.entries()) {
      if (records.length < 2) continue;
      
      // Sort by timestamp (earliest first)
      const sortedRecords = records.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      // Format for frontend
      const formattedSet = sortedRecords.map(record => ({
        id: record._id.toString(),
        timestamp: record.timestamp,
        systemName: record.systemId || 'Unknown',
        dlNumber: record.analysis?.dlNumber || record.dlNumber || null,
        fileName: record.fileName,
        validationScore: record.validationScore,
        contentHash: contentHash.substring(0, 16) + '...'
      }));
      
      duplicateSets.push(formattedSet);
    }
    
    const totalDuplicateRecords = duplicateSets.reduce((sum, set) => sum + (set.length - 1), 0);
    
    const durationMs = timer.end({ 
      duplicateSets: duplicateSets.length,
      totalDuplicates: totalDuplicateRecords
    });
    
    log.info('Duplicate scan complete', {
      totalRecords: allRecords.length,
      duplicateSets: duplicateSets.length,
      totalDuplicates: totalDuplicateRecords,
      durationMs,
      event: 'SCAN_COMPLETE'
    });
    
    log.exit(200);
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duplicateSets,
        summary: {
          totalRecords: allRecords.length,
          duplicateSets: duplicateSets.length,
          totalDuplicates: totalDuplicateRecords,
          durationMs
        }
      })
    };
    
  } catch (error) {
    timer.end({ error: true });
    log.error('Admin duplicate scan failed', {
      error: error.message,
      stack: error.stack,
      event: 'SCAN_ERROR'
    });
    
    log.exit(500);
    
    return errorResponse(
      500,
      'scan_failed',
      'Failed to scan for duplicates',
      { message: error.message },
      headers
    );
  }
};
