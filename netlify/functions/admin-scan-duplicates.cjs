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
 * 
 * AUTHENTICATION: This endpoint follows the BMSview admin access control pattern.
 * Admin access is controlled at the page level (admin.html) via OAuth.
 * See ADMIN_ACCESS_CONTROL.md for details. No function-level auth checks are performed.
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
    
    // Use MongoDB aggregation for memory-efficient duplicate detection
    // This groups records by contentHash and only returns groups with 2+ records
    log.info('Starting duplicate scan using aggregation pipeline');
    
    const duplicateSets = [];
    const pipeline = [
      // Group by contentHash, collecting all records in each group
      {
        $group: {
          _id: '$contentHash',
          records: { 
            $push: {
              id: { $toString: '$_id' },
              timestamp: '$timestamp',
              systemId: { $ifNull: ['$systemId', 'Unknown'] },
              dlNumber: { $ifNull: ['$analysis.dlNumber', { $ifNull: ['$dlNumber', null] }] },
              fileName: '$fileName',
              validationScore: { $ifNull: ['$validationScore', 0] }
            }
          },
          count: { $sum: 1 }
        }
      },
      // Only keep groups with 2 or more records (actual duplicates)
      { $match: { count: { $gte: 2 } } },
      // Sort by contentHash for consistency
      { $sort: { _id: 1 } }
    ];
    
    const cursor = resultsCol.aggregate(pipeline);
    let totalRecords = 0;
    
    for await (const group of cursor) {
      if (!group._id) continue; // Skip groups without contentHash
      
      // Sort records within each group by timestamp (earliest first)
      const sortedRecords = group.records.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      // Add contentHash to each record for display
      const formattedSet = sortedRecords.map(record => ({
        ...record,
        systemName: record.systemId,
        contentHash: group._id.substring(0, 16) + '...'
      }));
      
      duplicateSets.push(formattedSet);
      totalRecords += group.count;
    }
    
    const totalDuplicateRecords = duplicateSets.reduce((sum, set) => sum + (set.length - 1), 0);
    
    const durationMs = timer.end({ 
      duplicateSets: duplicateSets.length,
      totalDuplicates: totalDuplicateRecords
    });
    
    log.info('Duplicate scan complete', {
      totalRecords,
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
          totalRecords,
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
