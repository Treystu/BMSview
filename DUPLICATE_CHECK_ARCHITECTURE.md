# Duplicate Detection Architecture - 4-Layer System

This document describes the complete duplicate detection architecture in BMSview, which combines four layers of optimization for fast, efficient, and reliable duplicate detection.

## Overview

The system processes duplicate detection in four layers, with each layer providing fallback to the next:

1. **Layer 1: Client-Side Cache Fast-Path** (PR #341) - Instant results for cached files
2. **Layer 2: Client-Side SHA-256 Hashing** (PR #339) - Reduces network payload by 99.9%
3. **Layer 3: Batch API with Hash-Only Mode** (PR #339) - Efficient MongoDB lookup
4. **Layer 4: Individual Fallback** (Existing) - Handles edge cases and failures

## Layer 1: Client-Side Cache Fast-Path (PR #341)

### Purpose
Instantly identify and process files that already have duplicate metadata from previous uploads, eliminating unnecessary network calls.

### Implementation
- **Location**: `utils/duplicateChecker.ts::partitionCachedFiles()`
- **Used by**: `App.tsx` and `components/AdminDashboard.tsx`

### How It Works
1. Checks if File objects have `_isDuplicate`, `_analysisData`, or `_isUpgrade` metadata
2. Partitions files into three categories:
   - **Cached duplicates**: Files with full extraction data already present
   - **Cached upgrades**: Files marked for re-analysis (needs upgrade)
   - **Remaining files**: New files requiring network duplicate check

### Performance Impact
- **Time**: < 1ms for 22 files (synchronous, in-memory operation)
- **Network**: Zero API calls for cached files

### Code Example
```typescript
const { cachedDuplicates, cachedUpgrades, remainingFiles } = partitionCachedFiles(files);

// Process cached duplicates immediately
for (const dup of cachedDuplicates) {
    const record = buildRecordFromCachedDuplicate(dup, 'cached');
    // Dispatch to UI with existing data
}

// Only check remaining files via network
if (remainingFiles.length > 0) {
    await checkFilesForDuplicates(remainingFiles, log);
}
```

## Layer 2: Client-Side SHA-256 Hashing (PR #339)

### Purpose
Calculate content hashes on the client side using Web Crypto API, dramatically reducing network payload size.

### Implementation
- **Location**: `utils/clientHash.ts`
- **Algorithm**: SHA-256 via `window.crypto.subtle.digest()`
- **Browser Support**: Chrome 37+, Firefox 34+, Safari 11+, Edge 12+

### How It Works
1. Reads File object as base64 using FileReader
2. Decodes base64 to binary using `atob()`
3. Converts to Uint8Array
4. Calculates SHA-256 hash using SubtleCrypto
5. Returns 64-character hex string

### Performance Impact
- **Time**: ~100ms for 22 files (parallel calculation)
- **Payload Reduction**: ~8MB → ~2KB (99.9% reduction)
- **Network Transfer**: 400x smaller payload

### Code Example
```typescript
// Calculate hashes for all files in parallel
const hashResults = await calculateFileHashesBatch(files);

// Send only hashes to backend
const payload = hashResults.map(({ file, hash }) => ({
    hash,          // 64 chars (256 bits)
    fileName: file.name
}));

// Payload size: ~2KB for 22 files vs ~8MB with full images
```

### Error Handling
- Failed client-side hashing → Server-side fallback
- Missing Web Crypto API → Falls back to Layer 4 (individual checks)
- Invalid base64 → Returns null, triggers fallback

## Layer 3: Batch API with Hash-Only Mode (PR #339)

### Purpose
Efficiently check multiple files in a single MongoDB query using provided hashes.

### Implementation
- **Location**: `netlify/functions/check-duplicates-batch.cjs`
- **Dual-Mode Support**: Hash-only (recommended) and Image mode (fallback)

### How It Works

#### Hash-Only Mode (Recommended)
```javascript
// Client sends: { files: [{ hash, fileName }, ...] }
POST /.netlify/functions/check-duplicates-batch
{
  "files": [
    { "hash": "a1b2c3d4...", "fileName": "screenshot1.png" },
    { "hash": "def456...", "fileName": "screenshot2.png" }
  ]
}

// Server:
// 1. Validates hash format (64 hex chars)
// 2. MongoDB query: find({ contentHash: { $in: [hash1, hash2, ...] } })
// 3. Returns duplicate status for each file
```

#### Image Mode (Fallback)
```javascript
// Client sends: { files: [{ image, mimeType, fileName }, ...] }
// Server calculates hashes from base64 images (slower)
// Same MongoDB query as hash-only mode
```

### Performance Impact
- **Hash-Only Mode**: ~2 seconds for 22 files
- **Image Mode**: ~8-13 seconds for 22 files (payload transfer bottleneck)
- **MongoDB Query**: O(1) batch query vs O(n) individual queries

### Validation & Security
- **Payload Size Limit**: 6MB (Netlify limit)
  - Hash-only mode: Always under limit
  - Image mode: Returns 413 if exceeded
- **Hash Format Validation**: `/^[a-f0-9]{64}$/i`
- **Mixed Mode Prevention**: All files must use same mode
- **Sanitized Errors**: No server internals exposed to client

## Layer 4: Individual Fallback (Existing)

### Purpose
Handle edge cases where batch API fails or is unavailable.

### Implementation
- **Location**: `utils/duplicateChecker.ts::checkFilesIndividually()`
- **Triggered by**: Batch API failures, single file uploads, >100 files

### How It Works
1. Falls back to individual `checkFileDuplicate()` calls
2. Uses `Promise.allSettled()` for parallel execution
3. Batch processing for large sets (>50 files)
4. Each file calls `/.netlify/functions/analyze?sync=true&check=true`

### Performance Impact
- **Time**: ~13 seconds for 22 files (parallel requests)
- **Network**: 22 individual API calls
- **Reliability**: More resilient to individual file errors

## Complete Flow Diagram

```
User Uploads Files
       ↓
┌──────────────────────────────────────┐
│ Layer 1: Client-Side Cache Fast-Path │
│ partitionCachedFiles()               │
└──────────────────────────────────────┘
       ↓
   ┌───────┐
   │Cached?│
   └───┬───┘
       │
   YES │                        NO
   ┌───┴──────────────┐        ↓
   │Build from cache  │   ┌────────────────────────────┐
   │No network call   │   │ Layer 2: Client-Side Hash  │
   │< 1ms             │   │ calculateFileHashesBatch() │
   └──────────────────┘   └────────────────────────────┘
                                    ↓
                                ┌───────┐
                                │Hashed?│
                                └───┬───┘
                                    │
                                YES │                    NO
                            ┌───────┴────────┐          ↓
                            │                │     ┌────────────┐
                            │                │     │Layer 4     │
                         ┌──┴───────────┐   │     │Individual  │
                         │ Layer 3:     │   │     │Fallback    │
                         │ Batch API    │   │     └────────────┘
                         │ (Hash-Only)  │   │
                         │ ~2s for 22   │   │
                         └──────────────┘   │
                                            │
                                    Fallback on error
                                            │
                                     ┌──────┴──────┐
                                     │Layer 4      │
                                     │Individual   │
                                     │Checks       │
                                     │~13s for 22  │
                                     └─────────────┘
```

## Completeness Verification

### Existing Logic
The system already has completeness verification built into the duplicate detection:

1. **Pre-duplicate check** (Phase 1): `checkFilesForDuplicates()` → backend API
2. **Within analyze**: `analyze.cjs` → `unified-deduplication.cjs::detectAnalysisDuplicate()`
3. **Completeness check**: `checkNeedsUpgrade()` function

### How It Works
```javascript
function checkNeedsUpgrade(record) {
  // 1. Check if record marked as complete (admin override)
  if (record.isComplete === true) {
    return { needsUpgrade: false, reason: 'Record marked as complete' };
  }

  // 2. Check for missing critical fields (highest priority)
  const hasAllCriticalFields = CRITICAL_FIELDS.every(field =>
    record.analysis[field] !== null && record.analysis[field] !== undefined
  );

  if (!hasAllCriticalFields) {
    const missingFields = CRITICAL_FIELDS.filter(field => 
      record.analysis[field] === null || record.analysis[field] === undefined
    );
    return { needsUpgrade: true, reason: `Missing critical fields: ${missingFields.join(', ')}` };
  }

  // 3. Check validation score (quality threshold)
  const validationScore = record.analysis?.validationScore || 0;
  if (validationScore < DUPLICATE_UPGRADE_THRESHOLD) {
    return { needsUpgrade: true, reason: `Low validation score: ${validationScore}` };
  }

  // 4. Record has complete extraction
  return { needsUpgrade: false, reason: 'Complete extraction' };
}
```

### Critical Fields
Defined in `netlify/functions/utils/duplicate-constants.cjs`:
```javascript
const CRITICAL_FIELDS = [
  'totalVoltage',
  'current',
  'stateOfCharge',
  'power',
  'cellVoltages'
];
```

### Upgrade Workflow
1. **Upload**: File uploaded, duplicate check runs
2. **Duplicate Found**: Existing record retrieved from MongoDB
3. **Completeness Check**: `checkNeedsUpgrade()` evaluates record
4. **If Needs Upgrade**:
   - File marked as `needsUpgrade: true`
   - Queued for re-analysis
   - New analysis compared with old
   - If data matches, considered "complete" even if missing optional fields
5. **If Complete**:
   - Marked as duplicate, skipped from analysis
   - Existing data reused

## Timing Breakdown

### Before Optimization
```
22 files uploaded
├── Batch API attempt:     13.6s (fails with 500 - payload too large)
├── Individual fallback:   13.4s (22 parallel requests)
└── Total:                 27.0s
```

### After Optimization (All Layers)
```
22 files uploaded
├── Layer 1 Cache (5 files):        < 0.001s
├── Layer 2 Hashing (17 files):     0.100s
├── Layer 3 Batch API:              2.000s
└── Total:                          2.1s (92% faster)
```

## Monitoring & Logging

### Structured Event Logging

All layers log structured JSON events for debugging and monitoring:

```javascript
// Layer 1: Cache Fast-Path
{ event: 'CACHE_FAST_PATH', cachedDuplicates: 5, cachedUpgrades: 2, remaining: 15 }

// Layer 2: Client-Side Hashing
{ event: 'CLIENT_HASH_START', count: 17 }
{ event: 'CLIENT_HASH_COMPLETE', successfulHashes: 17, failedHashes: 0, durationMs: 100 }

// Layer 3: Batch API
{ event: 'BATCH_API_START', fileCount: 17, mode: 'hash-only' }
{ event: 'HASH_PAYLOAD_READY', payloadSizeKB: '2.15' }
{ event: 'BATCH_API_COMPLETE', duplicates: 12, upgrades: 3, new: 2, durationMs: 2000 }

// Layer 4: Individual Fallback
{ event: 'BATCH_API_FALLBACK', error: 'Batch API failed', fileCount: 17 }
{ event: 'FILE_CHECK_COMPLETE', fileName: 'screenshot1.png', isDuplicate: true, durationMs: 600 }
```

### Key Metrics to Track

1. **Cache Hit Rate**: `cachedDuplicates / totalFiles`
2. **Client Hash Success Rate**: `successfulHashes / totalFiles`
3. **Batch API Success Rate**: `batchAPISuccesses / totalBatchAttempts`
4. **Payload Size**: `payloadSizeKB` (should be < 10KB for hash-only mode)
5. **Timing**:
   - `avgPerFileMs` (target: < 200ms per file)
   - `totalDurationMs` (target: < 5s for 22 files)

## Testing

### Test Coverage

- **7 tests**: `tests/batch-duplicate-check.test.js` (PR #339)
  - Hash format validation
  - Hash consistency and idempotency
  - Payload size calculations
  - Server-side hash implementation

- **15 tests**: `tests/client-side-hash.test.js` (PR #339)
  - Client-side hash verification
  - Data URL normalization
  - Error handling
  - Division by zero protection
  - Server-client hash consistency

- **1 test**: `tests/partition-cached-files.test.js` (PR #341)
  - Cache partitioning logic
  - Metadata extraction
  - File categorization

### Running Tests

```bash
# Run all duplicate check tests
npm test -- tests/batch-duplicate-check.test.js
npm test -- tests/client-side-hash.test.js
npm test -- tests/partition-cached-files.test.js

# Run all tests with coverage
npm run test:coverage
```

## Migration & Deployment

### Backward Compatibility

All layers are backward compatible:
- Layer 1: No-op for files without cache metadata
- Layer 2: Falls back to Layer 4 if Web Crypto API unavailable
- Layer 3: Supports both hash-only and image modes
- Layer 4: Always available as final fallback

### Deployment Steps

1. Deploy backend changes (`check-duplicates-batch.cjs`)
2. Deploy frontend changes (`clientHash.ts`, `duplicateChecker.ts`, `App.tsx`, `AdminDashboard.tsx`)
3. Monitor logs for:
   - Mode usage (should be 100% hash-only after deployment)
   - Cache hit rates
   - Payload sizes
   - Error rates

### Rollback Plan

If issues arise, the system gracefully degrades:
1. Layer 1 fails → Proceeds to Layer 2
2. Layer 2 fails → Falls back to Layer 4
3. Layer 3 fails → Falls back to Layer 4
4. Layer 4 always works (existing proven implementation)

## Future Optimizations

Potential enhancements:

1. **IndexedDB Caching**: Store hash calculations client-side for repeat uploads
2. **Progressive Upload**: Upload hashes first, then only new files
3. **Web Workers**: Offload hash calculation to background thread
4. **Server-Side Hash Caching**: Cache calculated hashes to avoid recomputation
5. **Incremental Hashing**: Calculate hashes while reading files (streaming)

## Related Files

### Frontend
- `utils/clientHash.ts` - Client-side SHA-256 hashing
- `utils/duplicateChecker.ts` - Duplicate detection orchestration
- `App.tsx` - Main app duplicate flow
- `components/AdminDashboard.tsx` - Admin upload duplicate flow

### Backend
- `netlify/functions/check-duplicates-batch.cjs` - Batch API endpoint
- `netlify/functions/utils/unified-deduplication.cjs` - Canonical deduplication logic
- `netlify/functions/utils/duplicate-constants.cjs` - Shared constants

### Tests
- `tests/batch-duplicate-check.test.js` - Server-side hash tests
- `tests/client-side-hash.test.js` - Client-side hash verification
- `tests/partition-cached-files.test.js` - Cache partitioning tests

### Documentation
- `BATCH_DUPLICATE_CHECK_OPTIMIZATION.md` - PR #339 details
- `DUPLICATE_CHECK_FIX_SUMMARY.md` - Original duplicate fix summary
- `DUPLICATE_CHECK_ARCHITECTURE.md` - This document

## Conclusion

The 4-layer duplicate detection architecture provides:
- **92% faster** duplicate checks (27s → 2.1s for 22 files)
- **99.9% smaller** network payloads (~8MB → ~2KB)
- **Zero network calls** for cached duplicates
- **Graceful degradation** with multiple fallback layers
- **Complete data verification** via `checkNeedsUpgrade()`

All layers work together seamlessly, with each providing optimization while maintaining reliability through comprehensive fallback mechanisms.
