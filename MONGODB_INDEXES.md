# MongoDB Index Strategy for BMSview

**Purpose**: Optimize query performance for sync operations and reduce rate limiting

## Index Creation

### Execute in MongoDB Shell

```javascript
// Connect to database
use bmsview;

// Analysis Results Indexes
db.analysis_results.createIndex({ timestamp: 1 }, { background: true });
db.analysis_results.createIndex({ updatedAt: 1 }, { background: true });
db.analysis_results.createIndex({ systemId: 1 }, { background: true });
db.analysis_results.createIndex({ dlNumber: 1 }, { background: true });
db.analysis_results.createIndex({ contentHash: 1 }, { unique: false, background: true });

// Compound indexes (most important for sync)
db.analysis_results.createIndex(
  { systemId: 1, timestamp: -1 },
  { background: true, name: "idx_system_timestamp" }
);
db.analysis_results.createIndex(
  { updatedAt: 1, _id: 1 },
  { background: true, name: "idx_sync_incremental" }
);

// Systems Indexes
db.systems.createIndex({ name: 1 }, { background: true });
db.systems.createIndex({ updatedAt: 1 }, { background: true });
db.systems.createIndex(
  { updatedAt: 1, _id: 1 },
  { background: true, name: "idx_sync_incremental" }
);

// History Indexes (if using separate collection)
db.history.createIndex({ timestamp: 1 }, { background: true });
db.history.createIndex({ updatedAt: 1 }, { background: true });
db.history.createIndex({ systemId: 1 }, { background: true });

// Progress Events (for background jobs)
db.progress_events.createIndex(
  { jobId: 1, timestamp: 1 },
  { background: true }
);
db.progress_events.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 86400, background: true }  // TTL: 24 hours
);

// Idempotent Requests (deduplication)
db.idempotent_requests.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 3600, background: true }  // TTL: 1 hour
);
```

### Index by Purpose

#### 1. Sync Operations (Critical)

```javascript
// sync-metadata endpoint: Get collection metadata
db.analysis_results.createIndex({ updatedAt: 1, _id: 1 });
db.systems.createIndex({ updatedAt: 1, _id: 1 });

// Rationale: Fast record count and MAX(updatedAt) for metadata
```

#### 2. Sync Incremental (Critical)

```javascript
// sync-incremental endpoint: Get records since timestamp
db.analysis_results.createIndex({ updatedAt: 1 });
db.systems.createIndex({ updatedAt: 1 });

// Rationale: Range query on updatedAt >= since_timestamp
```

#### 3. System Lookups (Important)

```javascript
// Get analysis for specific system
db.analysis_results.createIndex({ systemId: 1, timestamp: -1 });

// Rationale: Filter by system + sort by time
```

#### 4. DL Number Searches (Important)

```javascript
// Find records by DL number (BMS device identifier)
db.analysis_results.createIndex({ dlNumber: 1 });

// Rationale: Quick lookup by hardware identifier
```

#### 5. Deduplication (Nice-to-have)

```javascript
// Check if screenshot already analyzed (content hash match)
db.analysis_results.createIndex({ contentHash: 1 });

// Rationale: Prevent duplicate analysis processing
```

## Index Performance Impact

### Before Indexes

```
Operation: Fetch incremental updates since timestamp
Time: ~3-5 seconds (full collection scan)
Query: db.analysis_results.find({ updatedAt: { $gte: ISODate(...) } })
```

### After Indexes

```
Operation: Same query with index on updatedAt
Time: ~50-100ms (index range scan)
Query Plan: IXSCAN on idx_sync_incremental
```

### Expected Improvements

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| sync-metadata | 2-3s | 50ms | 40-60x faster |
| sync-incremental | 3-5s | 100ms | 30-50x faster |
| System analysis list | 1-2s | 80ms | 15-25x faster |
| DL number search | 1-2s | 60ms | 20-30x faster |

## Monitoring Indexes

### Check Index Usage

```javascript
// List all indexes on analysis_results
db.analysis_results.getIndexes();

// Check index sizes
db.analysis_results.aggregate([
  { $indexStats: {} }
]);
```

### Atlas Monitoring

1. Go to **Metrics** → **Queries**
2. Look for queries with high execution time
3. Check if COLLSCAN appears (bad) vs IXSCAN (good)
4. Create indexes for frequent COLLSCAN operations

### Slow Query Log

```javascript
// Enable profiling
db.setProfilingLevel(1, { slowms: 100 });  // Log queries > 100ms

// View slow queries
db.system.profile.find().limit(5).sort({ ts: -1 }).pretty();
```

## Maintenance

### Drop Unused Indexes

```javascript
// Remove if causing write slowdown
db.analysis_results.dropIndex("indexName");

// Example: Drop contentHash if not used
db.analysis_results.dropIndex("idx_content_hash");
```

### Rebuild Indexes

```javascript
// Rebuild all indexes (takes time)
db.analysis_results.reIndex();

// Or in background (safer)
db.analysis_results.reIndex({ background: true });
```

## Production Checklist

- [ ] Execute index creation scripts in staging first
- [ ] Monitor for index size growth
- [ ] Enable slow query profiling (slowms: 100)
- [ ] Verify IXSCAN in query plans (not COLLSCAN)
- [ ] Set up alerts for query slowness
- [ ] Document TTL indexes (progress_events, idempotent_requests)
- [ ] Test failover with indexes in place
- [ ] Archive old indexes before cleanup

## Expected Index Sizes

Assuming 100K records per collection:

```
analysis_results indexes:
  - timestamp: ~8 MB
  - updatedAt: ~8 MB
  - systemId: ~6 MB
  - dlNumber: ~8 MB
  - contentHash: ~8 MB
  - Compound indexes: ~12 MB
  Total: ~50 MB

systems indexes:
  - name: ~2 MB
  - updatedAt: ~1 MB
  - Compound indexes: ~2 MB
  Total: ~5 MB

Grand Total: ~55 MB (manageable)
```

## Troubleshooting

### Index Not Used (COLLSCAN appears)

**Problem**: Query still doing full collection scan despite index

**Solutions**:
1. Ensure index exists: `db.collection.getIndexes()`
2. Check index cardinality (selectivity)
3. Drop and rebuild: `db.collection.dropIndex("..."); db.collection.createIndex(...)`
4. Use explain(): `db.collection.find(...).explain("executionStats")`

### Index Slowing Writes

**Problem**: Insert/update operations slow with many indexes

**Solutions**:
1. Consider background index creation: `{ background: true }`
2. Remove redundant indexes
3. Use `sparse: true` for optional fields
4. Monitor write performance in Atlas

### Index Size Growing

**Problem**: Index consumes excessive disk space

**Solutions**:
1. Check for duplicate indexes
2. Remove unused indexes
3. Archive old records
4. Consider data compression (MongoDB 4.2+)

## References

- MongoDB Index Documentation: https://docs.mongodb.com/manual/indexes/
- Atlas Performance Advisor: https://docs.atlas.mongodb.com/performance-advisor/
- Compound Indexes: https://docs.mongodb.com/manual/core/index-compound/
- TTL Indexes: https://docs.mongodb.com/manual/core/index-ttl/
