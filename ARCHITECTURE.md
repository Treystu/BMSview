# BMSview Architecture Guide

**Version**: 2.0 (Local-First Sync)  
**Last Updated**: November 9, 2025

## Overview

BMSview is a Battery Management System screenshot analysis tool built with **local-first sync architecture**. The system prioritizes offline capability and reduces server load by 90% through intelligent caching and periodic synchronization.

### Key Design Principles

1. **Local-First**: Data lives in IndexedDB first, server is authoritative for conflicts
2. **Intelligent Sync**: Metadata comparison drives push/pull decisions, not every operation
3. **Periodic Sync**: Background 90-second sync timer with manual reset on critical actions
4. **Dual-Write**: Critical user actions write locally + server immediately
5. **UTC Everywhere**: All timestamps are ISO 8601 UTC format (`new Date().toISOString()`)

## System Architecture

### Frontend Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React App (App.tsx)                   │
│  • Mount: startPeriodicSync()                            │
│  • Unmount: stopPeriodicSync()                           │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼────────────┐  ┌─────▼──────────────┐
│  AppState Context  │  │  SyncManager       │
│ (Reducer + Fields) │  │ • Periodic timer   │
│                    │  │ • Sync decisions   │
│ Fields:            │  │ • Push/pull logic  │
│ • isSyncing        │  │ • Status tracking  │
│ • lastSyncTime     │  │                    │
│ • syncError        │  │ Methods:           │
│ • cacheStats       │  │ • startPeriodicSync│
└───────────────────┘  │ • forceSyncNow     │
                       │ • getSyncStatus    │
                       └────────┬───────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼──────────┐   ┌────────▼────────┐   ┌─────────▼────────┐
│ ClientService    │   │ LocalCache      │   │ SyncStatusUI     │
│ (API Wrapper)    │   │ (Dexie/IndexDB) │   │ Components       │
│                  │   │                 │   │                  │
│ • Cache-first    │   │ Collections:    │   │ • Indicator      │
│ • Dual-write     │   │ • systems       │   │ • DiagnosticsUI  │
│ • Timer reset    │   │ • history       │   │ • Metrics panel  │
│ • FetchStrategy  │   │ • analytics     │   │                  │
│ • Metrics        │   │                 │   │                  │
│                  │   │ Schema:         │   │                  │
│ Endpoints:       │   │ • id (PK)       │   │                  │
│ • systems        │   │ • data object   │   │                  │
│ • history        │   │ • updatedAt (UTC) │  │                  │
│ • analysis       │   │ • _syncStatus   │   │                  │
└───────┬──────────┘   │ • timestamp     │   └──────────────────┘
        │              └────────────────┘
        │
        └─ localStorage (disable cache override)
```

### Backend Architecture

```
┌──────────────────────────────────────────────────────┐
│         Netlify Functions (serverless)               │
└──────────────┬───────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    │         Sync API    │
    │                     │
    ├─ sync-metadata.cjs  │
    │  GET ?collection=X  │
    │  Returns: recordCount, lastModified, checksum
    │
    ├─ sync-incremental.cjs
    │  GET ?collection=X&since=ISO_TIMESTAMP
    │  Returns: items, deletedIds (new/updated since)
    │
    └─ sync-push.cjs
       POST { collection, items }
       Returns: success, synced count, conflicts
```

### Data Flow Diagram

```
User Action
    │
    ├─ CRITICAL (analysis, register, link)
    │   │
    │   ├─ Server call (dual-write)
    │   ├─ Local cache write (best-effort)
    │   └─ Reset sync timer
    │
    ├─ READ (fetch systems, history)
    │   │
    │   ├─ Try local cache (CACHE_FIRST)
    │   ├─ If miss, fetch from server
    │   └─ Populate local cache
    │
    └─ SYNC (periodic, every 90s)
        │
        ├─ Get local metadata
        ├─ Fetch server metadata (sync-metadata)
        ├─ Intelligent decision:
        │   ├─ Local empty → Pull
        │   ├─ Local newer → Push
        │   ├─ Server newer → Pull
        │   └─ Equal → Skip
        ├─ Push pending (sync-push)
        ├─ Pull incremental (sync-incremental)
        └─ Mark as synced
```

## Component Details

### 1. SyncManager (`src/services/syncManager.ts`)

**Responsibility**: Orchestrate intelligent sync with periodic scheduling

**Key Methods**:

```typescript
startPeriodicSync()           // Start 90s interval timer
resetPeriodicTimer()          // Reset timer (called on critical actions)
forceSyncNow()                // Immediate sync
stopPeriodicSync()            // Stop timer (on unmount)
getSyncStatus()               // Return: { isSyncing, lastSyncTime, syncError, nextSyncIn }
destroy()                     // Cleanup (call on unmount)

intelligentSync(localMeta, serverMeta): SyncDecision
  // Compare metadata, return { action, reason, ...timestamps }
  // Actions: 'pull' | 'push' | 'skip' | 'reconcile'

reconcileData(local[], server[], deletedIds[])
  // Merge with conflict resolution (server timestamp wins)
```

**Internal Flow**:

```
performPeriodicSync():
  1. Load local cache module
  2. Get pending items (systems, history)
  3. Batch push via sync-push endpoint
  4. Mark pushed items as synced
  5. Pull incremental for both collections
  6. Update local cache with server data
  7. Set lastSyncTime
```

### 2. LocalCache (`src/services/localCache.ts`)

**Responsibility**: IndexedDB persistence with sync tracking

**Collections**:
- `systems`: Registered BMS systems
- `history`: Analysis records
- `analytics`: Computed metrics (future)
- `weather`: Cached weather data (future)

**Schema per Collection**:
```typescript
{
  id: string;                    // Primary key
  data: object;                  // Actual data
  updatedAt: string;             // ISO 8601 UTC (server timestamp)
  _syncStatus: 'pending' | 'synced';
  timestamp?: string;            // Creation time
  checksum?: string;             // Content hash for dedup
}
```

**Key Methods**:

```typescript
// CRUD
await systemsCache.put(system, 'pending' | 'synced')
await systemsCache.get(id)
await systemsCache.delete(id)
await systemsCache.bulkPut(items, status)

// Sync tracking
await systemsCache.markAsSynced(id, serverTimestamp?)
await getPendingItems()  // Returns { systems[], history[], analytics[] }

// Metadata
await getMetadata('systems')  // Returns { lastModified, recordCount, checksum }

// Staleness
await getStalenessInfo()  // Check if cache is stale
```

**Validation**: UTC timestamp regex enforced on writes
```javascript
const UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
```

### 3. ClientService (`services/clientService.ts`)

**Responsibility**: API wrapper with cache-first strategy

**Cache Strategy**:
```typescript
enum FetchStrategy {
  CACHE_FIRST = 'cache-first',      // Try cache, fall back to network (default)
  CACHE_AND_SYNC = 'cache-and-sync', // Use cache, sync in background
  FORCE_FRESH = 'force-fresh'        // Always fetch from server
}
```

**Dual-Write Pattern**:
```typescript
async dualWriteWithTimerReset<T>(
  operation: 'create' | 'update' | 'link',
  serverFn: () => Promise<T>,
  localCacheFn?: () => Promise<void>
): Promise<T> {
  1. Call server function
  2. Write to local cache (fire-and-forget)
  3. Reset sync timer
  4. Return result
}
```

**Usage**:
```typescript
// Critical actions use dual-write
registerBmsSystem()              // Dual-write
saveAnalysisResult()             // Dual-write
linkAnalysisToSystem()           // Dual-write

// Read operations use cache-first
getRegisteredSystems(page, limit, { strategy: FetchStrategy.CACHE_FIRST })
getAnalysisHistory(page, limit)
```

### 4. AppState (`state/appState.tsx`)

**New Sync Fields**:
```typescript
isSyncing: boolean              // Currently syncing?
lastSyncTime: Record<string, number>  // Per-collection timestamps
syncError: string | null        // Last sync error message
cacheStats: {
  systemsCount: number
  historyCount: number
  totalSize: number
  lastUpdated: string           // ISO timestamp
}
```

**New Actions**:
```typescript
UPDATE_SYNC_STATUS { isSyncing, syncError }
SET_CACHE_STATS { stats }
```

**Hydration** (App.tsx):
```typescript
useEffect(() => {
  fetchAppData();
  syncManager.startPeriodicSync();  // Start background sync
  
  return () => {
    syncManager.stopPeriodicSync();  // Cleanup on unmount
  };
}, [fetchAppData]);
```

## Sync Algorithm

### Intelligent Sync Decision Logic

```
Given: local metadata, server metadata

DECISION TREE:
├─ Local empty (count = 0)
│   └─ PULL (fetch all from server)
├─ Server empty (count = 0)
│   └─ PUSH (send all to server)
├─ Both have data
│   ├─ Compare timestamps (ISO 8601 UTC)
│   ├─ Local newer
│   │   └─ PUSH
│   ├─ Server newer
│   │   └─ PULL
│   ├─ Equal timestamps
│   │   ├─ Local more records
│   │   │   └─ PUSH
│   │   ├─ Server more records
│   │   │   └─ PULL
│   │   └─ Same records
│   │       └─ SKIP
│   └─ No metadata
│       └─ RECONCILE (merge with conflict resolution)
```

### Conflict Resolution

When server and local have the same ID:
- Compare `updatedAt` timestamps
- **Server wins** if `serverTime >= localTime`
- **Local wins** if `localTime > serverTime`
- Record conflict for diagnostics if difference > 1 second

## MongoDB Schema

### Recommended Indexes

```javascript
// analysis-results collection
db.analysis_results.createIndex({ timestamp: 1 })  // Range queries
db.analysis_results.createIndex({ updatedAt: 1 })  // Sync filtering
db.analysis_results.createIndex({ systemId: 1 })   // System lookups
db.analysis_results.createIndex({ dlNumber: 1 })   // DL number searches
db.analysis_results.createIndex({ contentHash: 1 }) // Deduplication

// systems collection
db.systems.createIndex({ name: 1 })
db.systems.createIndex({ updatedAt: 1 })

// Compound indexes for common queries
db.analysis_results.createIndex({ systemId: 1, timestamp: -1 })
db.analysis_results.createIndex({ updatedAt: 1, _id: 1 })
```

### Collection: `analysis-results`

```json
{
  "_id": ObjectId,
  "analysis": {
    "dlNumber": "string",
    "overallVoltage": "number",
    "current": "number",
    "stateOfCharge": "number",
    "cellVoltages": "number[]",
    "temperature": "number"
  },
  "weather": {
    "temp": "number",
    "clouds": "number",
    "uvi": "number"
  },
  "systemId": "string (optional)",
  "dlNumber": "string (optional)",
  "fileName": "string",
  "timestamp": "ISODate (creation)",
  "updatedAt": "ISODate (last server update - UTC)",
  "contentHash": "string (SHA-256 for dedup)",
  "_isDuplicate": "boolean"
}
```

### Collection: `systems`

```json
{
  "_id": ObjectId,
  "name": "string",
  "chemistry": "LiFePO4 | Li-ion | lead-acid",
  "voltage": "number",
  "capacity": "number",
  "associatedDLs": "string[]",
  "location": "string",
  "createdAt": "ISODate",
  "updatedAt": "ISODate (last server update - UTC)"
}
```

## Performance Characteristics

### Cache Hit Rates (Expected)

| Operation | Cache Mode | Hit Rate | Server Calls |
|-----------|-----------|----------|--------------|
| Load systems list | cache-first | 95% | ~5% |
| Load history | cache-first | 90% | ~10% |
| Periodic sync | metadata only | 99% | 3 calls/90s |
| Register system | dual-write | 0% | 1 call |
| Analyze screenshot | network | 0% | 1 call |

### Bandwidth Reduction

**Before** (all requests to server):
- Systems list: 10 KB × 100 requests/day = 1 MB
- History list: 50 KB × 50 requests/day = 2.5 MB
- Total: ~3.5 MB/day

**After** (with local-first + sync):
- Sync metadata: 1 KB × 16 calls/day = 16 KB
- Sync incremental: 5 KB × 16 calls/day = 80 KB
- System analysis: 10 KB × 20 requests/day = 200 KB
- Total: ~296 KB/day (92% reduction)

### MongoDB Rate Limit Impact

**Before**: 300 queries/min → Rate limit after ~6 minutes  
**After**: ~30 queries/min → Sustainable indefinitely (90% reduction)

## Deployment Checklist

Before production deployment:

- [ ] **Database**: Create indexes (see MongoDB Schema)
- [ ] **Environment**: Set GEMINI_API_KEY, MONGODB_URI, MONGODB_DB_NAME
- [ ] **Migration**: Run schema migration if upgrading from old version
- [ ] **Validation**: Run admin diagnostics in production environment
- [ ] **Sampling**: Verify 10 random records have UTC timestamps
- [ ] **Monitoring**: Set up alerts for sync failures
- [ ] **Rollback**: Have MongoDB backup + client code rollback plan
- [ ] **Testing**: Test offline/online transitions in production-like environment

## Monitoring & Troubleshooting

### Key Metrics to Monitor

1. **Sync Health**: `/_netlify/functions/admin-diagnostics` (sync-health tests)
2. **Cache Hit Rate**: Browser console → `window.__BMSVIEW_GET_STATS?.()`
3. **MongoDB Queries**: Atlas → Metrics → Operations/sec
4. **Error Rate**: Sentry or similar (if configured)

### Common Issues

**Issue**: "Periodic sync not running"
- **Check**: `syncManager.getSyncStatus()` in console
- **Fix**: Call `syncManager.resetPeriodicTimer()` to restart

**Issue**: "Cache not updating"
- **Check**: `__BMSVIEW_GET_STATS?.()` → cache.mode
- **Fix**: `__BMSVIEW_SET_CACHE_DISABLED?.(false)` to re-enable

**Issue**: "Sync metadata fails"
- **Check**: Server logs for `sync-metadata` errors
- **Ensure**: MongoDB indexes created (see MongoDB Schema)

**Issue**: "Timestamps mismatched"
- **Check**: `SELECT updatedAt FROM analysis_results LIMIT 10`
- **Ensure**: All timestamps end with 'Z' (UTC)

## Future Enhancements

1. **Incremental Sync Improvements**:
   - Implement vector clock version control
   - Support tombstones for deleted records
   - Add CRDTs for true offline collaboration

2. **Advanced Caching**:
   - Implement TTL expiration per collection
   - Add blob compression for large records
   - Support partial record sync

3. **Analytics**:
   - Track sync performance metrics
   - Build user offline/online graphs
   - Create cache efficiency dashboards

4. **Security**:
   - End-to-end encryption for sensitive data
   - Implement differential sync for privacy
   - Add audit trail for all synced changes

## References

- **SyncManager**: `src/services/syncManager.ts`
- **LocalCache**: `src/services/localCache.ts`
- **ClientService**: `services/clientService.ts`
- **AppState**: `state/appState.tsx`
- **Sync Endpoints**: `netlify/functions/sync-*.cjs`
- **Diagnostics**: `netlify/functions/admin-diagnostics.cjs`
- **Tests**: `tests/syncManager.integration.test.js`, `tests/frontend-sync.e2e.test.js`
- **Timestamp Audit**: `TIMESTAMP_AUDIT_REPORT.md`
