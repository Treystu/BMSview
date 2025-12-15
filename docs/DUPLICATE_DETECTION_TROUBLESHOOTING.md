# Duplicate Detection Troubleshooting Guide

## Overview
This guide helps diagnose and resolve issues with duplicate file detection in the upload flow.

## Common Issues

### 1. Slow Duplicate Checks

**Symptoms:**
- Upload screen shows "Checking for duplicates..." for extended periods
- Large batches (100+ files) take minutes to check
- Browser becomes unresponsive during duplicate checks

**Diagnosis:**
Check browser console logs for timing metrics:
```javascript
// Look for these log entries with high durationMs values
{
  "level": "INFO",
  "event": "FILE_CHECK_COMPLETE",
  "durationMs": 5000  // Should be < 1000ms per file
}

{
  "level": "INFO",
  "event": "COMPLETE",
  "avgPerFileMs": "2500.00"  // Should be < 500ms average
}
```

**Solutions:**

1. **Verify MongoDB Index** (Backend Issue)
   ```bash
   # Check if contentHash index exists
   mongo
   > use bmsview
   > db.analysis_results.getIndexes()
   
   # Should see:
   # { "name": "idx_analysis_content_hash", "key": { "contentHash": 1 } }
   ```
   
   If missing, run:
   ```bash
   node scripts/create-indexes.js
   ```

2. **Check Network Latency** (Frontend Issue)
   - Look for `fetchDurationMs` > 2000ms in logs
   - May indicate slow backend or network issues
   - Try from different network/location

3. **Reduce Batch Size** (Configuration)
   - Default: 50 files per batch
   - For slow connections, reduce to 25:
   ```javascript
   // In utils/batchProcessor.ts
   MAX_BATCH_SIZE: 25  // Reduce from 50
   ```

### 2. False Negatives (Duplicates Not Detected)

**Symptoms:**
- Same screenshot analyzed multiple times
- No "duplicate" badge shown for identical files
- Database growing with duplicate contentHash values

**Diagnosis:**

1. **Check contentHash Generation:**
   ```javascript
   // In browser console after upload
   // Look for:
   {
     "event": "FILE_CHECK_COMPLETE",
     "isDuplicate": false,  // Should be true for duplicates
     "recordId": undefined  // Should have value if duplicate exists
   }
   ```

2. **Verify Backend Duplicate Logic:**
   ```bash
   # Check backend logs in Netlify Functions
   # Look for "Dedupe: existing analysis found"
   ```

**Solutions:**

1. **Verify Index is Unique:**
   ```javascript
   // In MongoDB, check:
   db.analysis_results.getIndexes()
   // Should see: { unique: true } for contentHash
   ```

2. **Check for Hash Collisions:**
   ```bash
   # Find duplicate hashes
   db.analysis_results.aggregate([
     { $group: { _id: "$contentHash", count: { $sum: 1 } } },
     { $match: { count: { $gt: 1 } } }
   ])
   ```

3. **Force Reanalysis:**
   - Use `forceReanalysis` option in upload
   - This bypasses duplicate detection

### 3. Logging Gaps

**Symptoms:**
- Can't diagnose slow duplicate checks
- Missing context in error messages
- No visibility into batch processing

**Diagnosis:**

Check log event markers in browser console:
```javascript
// Should see these events in order:
"START"              // Batch check started
"BATCH_START"        // Individual batch started (if >50 files)
"FILE_CHECK_COMPLETE" // Per file
"BATCH_COMPLETE"     // Batch finished
"COMPLETE"           // All checks done
```

**Solutions:**

1. **Enable Debug Logging:**
   ```javascript
   // In browser console:
   localStorage.setItem('bmsview:logLevel', 'debug');
   ```
   This enables per-file debug logs.

2. **Check Backend Logs:**
   - Netlify Function logs show backend timing
   - Look for `queryDurationMs`, `processingDurationMs`

### 4. Backend Overload

**Symptoms:**
- 503 Service Unavailable errors
- Timeouts during duplicate checks
- Multiple batches failing

**Diagnosis:**

1. **Check Concurrent Requests:**
   ```javascript
   // In logs, look for:
   {
     "event": "BATCH_GROUP_START",
     "batchesInGroup": 3  // Should not exceed MAX_CONCURRENT_BATCHES
   }
   ```

2. **Check MongoDB Connection Pool:**
   ```bash
   # In backend logs, look for:
   "MongoDB connection pool exhausted"
   "Too many connections"
   ```

**Solutions:**

1. **Reduce Concurrency:**
   ```javascript
   // In utils/batchProcessor.ts
   MAX_CONCURRENT_BATCHES: 2  // Reduce from 3
   ```

2. **Increase Batch Delays:**
   ```javascript
   // In utils/batchProcessor.ts
   BATCH_DELAY_MS: 1000  // Increase from 500
   ```

3. **Optimize MongoDB Pool:**
   ```javascript
   // In netlify/functions/utils/mongodb.cjs
   // Connection pool is already optimized to 5
   // Verify this hasn't been changed
   ```

## Performance Benchmarks

### Expected Performance

| Metric | Small Batch (<50 files) | Large Batch (100+ files) |
|--------|------------------------|--------------------------|
| **Per-file check** | < 500ms | < 1000ms |
| **Total time** | < 10s | < 60s |
| **Backend query** | < 50ms | < 200ms |
| **Network latency** | < 100ms | < 200ms |

### Actual Performance Monitoring

Monitor these metrics in logs:

1. **Frontend Timing:**
```javascript
{
  "event": "COMPLETE",
  "totalDurationMs": 8500,      // Total time
  "avgPerFileMs": "425.00"      // Per-file average
}
```

2. **Backend Timing:**
```javascript
{
  "event": "QUERY_COMPLETE",
  "queryDurationMs": 45,         // DB query time
  "avgPerHash": "2.25ms"         // Per hash
}
```

## Best Practices

### For Users

1. **Upload in Batches:**
   - Optimal: 25-50 files per upload
   - Maximum: 100 files (auto-chunked)

2. **Wait for Duplicate Check:**
   - Don't close browser during "Checking for duplicates..."
   - Progress indicator shows when safe to navigate

3. **Network Connection:**
   - Use stable network for large uploads
   - Avoid mobile networks for 100+ file batches

### For Developers

1. **Index Maintenance:**
   ```bash
   # Periodically rebuild indexes
   mongo
   > use bmsview
   > db.analysis_results.reIndex()
   ```

2. **Monitor Query Plans:**
   ```javascript
   // In MongoDB, explain queries:
   db.analysis_results.find({ contentHash: { $in: hashes } })
     .explain("executionStats")
   
   // Should use IXSCAN not COLLSCAN
   ```

3. **Log Aggregation:**
   - Use structured logging for easy filtering
   - Event markers enable specific log queries:
   ```bash
   # Filter by event type
   grep "event.*FILE_CHECK_COMPLETE" logs.txt
   ```

4. **Testing:**
   ```bash
   # Test with various batch sizes
   npm test -- --testPathPattern="duplicate"
   npm test -- --testPathPattern="check-hashes"
   ```

## Configuration Reference

### Frontend Configuration

Located in `utils/batchProcessor.ts`:

```javascript
export const BATCH_CONFIG = {
    // Maximum files per batch request
    MAX_BATCH_SIZE: 50,
    
    // Delay between batch groups (ms)
    BATCH_DELAY_MS: 500,
    
    // Maximum concurrent batches
    MAX_CONCURRENT_BATCHES: 3,
    
    // Timeout for single batch (ms)
    BATCH_TIMEOUT_MS: 30000
};
```

**When to adjust:**
- Slow network: Reduce `MAX_BATCH_SIZE` to 25
- Backend overload: Reduce `MAX_CONCURRENT_BATCHES` to 2
- Timeout issues: Increase `BATCH_TIMEOUT_MS` to 45000

### Backend Configuration

Located in `netlify/functions/utils/mongodb.cjs`:

```javascript
// Connection pool size (already optimized)
const POOL_SIZE = 5;

// Health check interval
const HEALTH_CHECK_INTERVAL = 60000; // 60s
```

**When to adjust:**
- High concurrent load: May need to increase pool (carefully)
- Connection timeouts: Reduce health check interval

## Emergency Fixes

### Quick Disable Batch Processing

If batch processing causes issues, use the configuration flag:

```javascript
// In utils/batchProcessor.ts
export const BATCH_CONFIG = {
    MAX_BATCH_SIZE: 50,
    BATCH_DELAY_MS: 500,
    MAX_CONCURRENT_BATCHES: 3,
    BATCH_TIMEOUT_MS: 30000,
    DISABLE_BATCHING: true  // Add this to temporarily disable
};

// Then in duplicateChecker.ts, check this flag:
if (files.length > BATCH_CONFIG.MAX_BATCH_SIZE && !BATCH_CONFIG.DISABLE_BATCHING) {
```

### Force All Files Through

If duplicate check fails completely:

```javascript
// In App.tsx handleAnalyze function
// Add forceReanalysis option:
const options = { forceReanalysis: true };
```

### Skip Duplicate Check Entirely

Emergency bypass (not recommended):

```javascript
// In utils/duplicateChecker.ts
// Replace checkFilesForDuplicates implementation:
export async function checkFilesForDuplicates(files, log) {
    // Treat all as new files
    return {
        trueDuplicates: [],
        needsUpgrade: [],
        newFiles: files.map(f => ({ file: f, isDuplicate: false, needsUpgrade: false }))
    };
}
```

## Monitoring and Alerts

### Key Metrics to Track

1. **Duplicate Check Success Rate:**
   ```javascript
   // Calculate from logs:
   successRate = (FILE_CHECK_COMPLETE events) / (total files)
   // Should be > 95%
   ```

2. **Average Check Time:**
   ```javascript
   // From COMPLETE events:
   avgPerFileMs < 500ms  // Good
   avgPerFileMs > 1000ms // Needs investigation
   ```

3. **Backend Query Performance:**
   ```javascript
   // From QUERY_COMPLETE events:
   queryDurationMs < 100ms  // Good
   queryDurationMs > 500ms  // Index may be missing
   ```

### Alert Thresholds

Set up alerts for:
- Average check time > 1000ms
- Error rate > 5%
- Backend query time > 500ms
- Batch timeout rate > 10%

## Support

If issues persist after following this guide:

1. Collect detailed logs (browser + backend)
2. Note specific error messages and timing
3. Include system info (browser, network type)
4. Report via GitHub issue with "duplicate-detection" label
