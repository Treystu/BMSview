# BMSview Data Collections - Canonical Reference

**Last Updated**: December 4, 2025  
**Status**: Active - This is the authoritative source for collection usage patterns

## Overview

BMSview uses MongoDB for persistent storage. This document provides the **single source of truth** for all collection usage patterns, schemas, and access conventions.

## Critical Architectural Decision: Dual-Write Pattern

As of December 2025, BMSview implements a **dual-write pattern** for analysis data to ensure backward compatibility during migration.

### Why Dual-Write?

**Historical Context:**
- Originally, analysis data went into `history` collection only
- Tools and insights systems were built to query `history`
- Later, `analysis-results` was added for deduplication and quality tracking
- This created a **collection mismatch** where:
  - New data went into `analysis-results` 
  - Tools still queried `history`
  - Result: Tools saw NO DATA (app-wide regression)

**Solution:**
- Implement dual-write in `analyze.cjs` to write to BOTH collections
- Ensures immediate data availability for all consumers
- Maintains backward compatibility with existing code
- Enables gradual migration to single source of truth

## Collections

### 1. `analysis-results` (Primary Source of Truth)

**Purpose**: Stores BMS screenshot analysis results with deduplication and quality tracking.

**Written By**:
- `netlify/functions/analyze.cjs` (line 713 - insertOne, line 655 - updateOne)

**Read By**:
- `netlify/functions/utils/full-context-builder.cjs` (line 132)
- `netlify/functions/utils/insights-summary.cjs` (line 81)

**Schema**:
```javascript
{
  _id: ObjectId,
  id: String,                        // UUID v4 (unique record ID)
  fileName: String,                  // Original screenshot filename
  timestamp: String,                 // ISO 8601 UTC (e.g., "2025-12-04T05:46:41.988Z")
  analysis: {                        // Extracted BMS data
    overallVoltage: Number,          // Battery pack voltage (V)
    current: Number,                 // Charge/discharge current (A, positive=charging)
    power: Number,                   // Power (W)
    stateOfCharge: Number,           // SOC (%)
    remainingCapacity: Number,       // Remaining capacity (Ah)
    temperature: Number,             // Battery temperature (°C)
    mosTemperature: Number,          // MOSFET temperature (°C)
    cellVoltages: [Number],          // Individual cell voltages (V)
    cellVoltageDifference: Number,   // Max-min cell voltage (V)
    alerts: [String],                // Active alerts/warnings
    systemId: String,                // Linked BMS system ID (optional)
    dlNumber: String                 // Device license number (optional)
  },
  contentHash: String,               // SHA-256 hash for deduplication
  createdAt: Date,                   // Creation timestamp
  updatedAt: Date,                   // Last update timestamp (for upgrades)
  userId: String,                    // User ID (for multi-tenancy, optional)
  needsReview: Boolean,              // Quality flag
  validationWarnings: [String],      // Data quality warnings
  validationScore: Number,           // Quality score (0-100)
  extractionAttempts: Number,        // Number of extraction attempts
  _forceReanalysis: Boolean,         // Manual reanalysis flag
  _wasUpgraded: Boolean,             // Quality upgrade flag
  _previousQuality: Number,          // Previous validation score
  _newQuality: Number                // New validation score after upgrade
}
```

**Indexes**:
```javascript
db['analysis-results'].createIndex({ contentHash: 1 }, { unique: true });
db['analysis-results'].createIndex({ timestamp: -1 });
db['analysis-results'].createIndex({ 'analysis.systemId': 1, timestamp: -1 });
```

**Migration Path**: 
- This will eventually become the ONLY source for analysis data
- All readers should migrate from `history` to `analysis-results`

---

### 2. `history` (Backward Compatibility Duplicate)

**Purpose**: Duplicate storage of analysis data for backward compatibility with legacy tools.

**Written By**:
- `netlify/functions/analyze.cjs` (line 727 - dual-write, line 694 - dual-write update)
- `netlify/functions/history.cjs` (line 813 - legacy POST endpoint)

**Read By**:
- `netlify/functions/utils/insights-guru.cjs` (lines 122, 1620, 1661, 2480)
- `netlify/functions/utils/gemini-tools.cjs` - `request_bms_data` tool (line 802)

**Schema**:
```javascript
{
  _id: ObjectId,
  id: String,                        // UUID v4 (matches analysis-results.id)
  timestamp: String,                 // ISO 8601 UTC
  systemId: String,                  // BMS system ID (null until linked)
  systemName: String,                // BMS system name (null until linked)
  analysis: Object,                  // Full analysis object (same as analysis-results)
  weather: Object,                   // Weather data snapshot (optional)
  dlNumber: String,                  // Device license number (optional)
  fileName: String,                  // Original filename
  analysisKey: String                // Content hash for deduplication
}
```

**Indexes**:
```javascript
db.history.createIndex({ systemId: 1, timestamp: -1 });
db.history.createIndex({ timestamp: -1 });
db.history.createIndex({ id: 1 }, { unique: true });
```

**Deprecation Notice**:
- This collection exists ONLY for backward compatibility
- New code should read from `analysis-results` instead
- Will be deprecated once all tools migrate to `analysis-results`

---

### 3. `systems` (BMS System Registry)

**Purpose**: Stores registered BMS system configurations.

**Written By**:
- `netlify/functions/systems.cjs`
- `netlify/functions/history.cjs` (line 838 - associatedDLs update)

**Read By**:
- All insights and analysis functions that need system metadata

**Schema**:
```javascript
{
  _id: ObjectId,
  id: String,                        // UUID v4 (unique system ID)
  name: String,                      // User-defined system name
  chemistry: String,                 // Battery chemistry (e.g., "LiFePO4")
  voltage: Number,                   // Nominal voltage (V)
  capacity: Number,                  // Total capacity (Ah)
  latitude: Number,                  // Location latitude
  longitude: Number,                 // Location longitude
  timezone: String,                  // IANA timezone (e.g., "America/New_York")
  associatedDLs: [String],           // Device license numbers
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
```javascript
db.systems.createIndex({ id: 1 }, { unique: true });
db.systems.createIndex({ associatedDLs: 1 });
```

---

### 4. `insights-jobs` (AI Insights Job Queue)

**Purpose**: Manages background AI insights generation jobs with checkpoint/resume support.

**Written By**:
- `netlify/functions/utils/insights-jobs.cjs`

**Read By**:
- `netlify/functions/generate-insights-with-tools.cjs`
- `netlify/functions/generate-insights-status.cjs`

**Schema**:
```javascript
{
  _id: ObjectId,
  id: String,                        // UUID v4 (job ID)
  mode: String,                      // 'insights' | 'diagnostics' | 'feedback'
  status: String,                    // 'pending' | 'running' | 'completed' | 'failed'
  analysisData: Object,              // Input analysis data
  systemId: String,                  // BMS system ID
  customPrompt: String,              // Custom user query (optional)
  contextWindowDays: Number,         // Historical data window (default: 30)
  maxIterations: Number,             // Max ReAct loop turns
  modelOverride: String,             // Gemini model override (optional)
  fullContextMode: Boolean,          // Enable full context pre-loading
  checkpointState: Object,           // Resume state for timeouts
  finalInsights: String,             // Completed insights text
  error: String,                     // Error message if failed
  createdAt: Date,
  updatedAt: Date,
  completedAt: Date
}
```

---

### 5. `ai_feedback` (AI-Generated App Improvement Suggestions)

**Purpose**: Stores AI-generated feedback and improvement suggestions (Full Context Mode feature).

**Written By**:
- `netlify/functions/utils/gemini-tools.cjs` - `submitAppFeedback` tool

**Read By**:
- `netlify/functions/get-ai-feedback.cjs`
- Admin dashboard components

**Schema**:
```javascript
{
  _id: ObjectId,
  id: String,                        // UUID v4
  timestamp: Date,
  systemId: String,                  // Related system ID (optional)
  feedbackType: String,              // 'feature_request' | 'api_suggestion' | 'data_format' | 'bug_report' | 'optimization'
  category: String,                  // 'weather_api' | 'data_structure' | 'ui_ux' | 'performance' | 'integration' | 'analytics'
  priority: String,                  // 'low' | 'medium' | 'high' | 'critical'
  status: String,                    // 'pending' | 'reviewed' | 'accepted' | 'rejected' | 'implemented'
  guruSource: String,                // 'diagnostics-guru' | 'battery-guru' | 'full-context-guru' | 'manual'
  geminiModel: String,               // AI model used
  contextHash: String,               // Deduplication hash
  suggestion: {
    title: String,
    description: String,
    rationale: String,
    implementation: String,
    expectedBenefit: String,
    estimatedEffort: String,         // 'hours' | 'days' | 'weeks'
    codeSnippets: [String],
    affectedComponents: [String]
  },
  githubIssue: {
    number: Number,
    url: String,
    status: String
  },
  adminNotes: String,
  updatedAt: Date
}
```

**Indexes**:
```javascript
db.ai_feedback.createIndex({ priority: 1, status: 1 });
db.ai_feedback.createIndex({ systemId: 1, timestamp: -1 });
db.ai_feedback.createIndex({ contextHash: 1 });
db.ai_feedback.createIndex({ guruSource: 1, status: 1 });
```

---

### 6. `idempotent-requests` (Request Deduplication)

**Purpose**: Stores request/response pairs for safe retries and idempotency.

**Written By**:
- `netlify/functions/analyze.cjs` (line 741)

**Read By**:
- `netlify/functions/analyze.cjs` (line 490)

**Schema**:
```javascript
{
  _id: ObjectId,
  key: String,                       // Idempotency key (unique)
  response: Object,                  // Cached response
  reasonCode: String,                // 'new_analysis' | 'force_reanalysis' | 'dedupe_hit' | 'quality_upgrade'
  createdAt: Date
}
```

---

### 7. Other Collections

**`progress-events`**: Legacy job progress tracking (deprecated, not used in sync mode)

**`hourly-weather`**: Cached hourly weather data

**`hourly-irradiance`**: Cached solar irradiance data

**`stories`**: Story mode analysis records (if enabled)

---

## Migration Guide: From `history` to `analysis-results`

If you're updating code that currently reads from `history`:

### Before (Outdated Pattern):
```javascript
const historyCollection = await getCollection('history');
const records = await historyCollection.find({ systemId }).toArray();
```

### After (Recommended Pattern):
```javascript
const analysisCollection = await getCollection('analysis-results');
const records = await analysisCollection.find({ 'analysis.systemId': systemId }).toArray();
```

**Note**: Field paths change! In `history`, systemId is top-level. In `analysis-results`, it's nested under `analysis.systemId`.

---

## Common Queries

### Get All Analysis for a System
```javascript
// Preferred (analysis-results)
const results = await getCollection('analysis-results');
const records = await results.find({
  'analysis.systemId': systemId,
  timestamp: { $gte: startDate, $lte: endDate }
}).sort({ timestamp: 1 }).toArray();

// Legacy (history) - Still works due to dual-write
const history = await getCollection('history');
const records = await history.find({
  systemId: systemId,
  timestamp: { $gte: startDate, $lte: endDate }
}).sort({ timestamp: 1 }).toArray();
```

### Check for Duplicate Analysis
```javascript
const results = await getCollection('analysis-results');
const existing = await results.findOne({ contentHash: sha256Hash });
```

### Get Recent Snapshots
```javascript
const results = await getCollection('analysis-results');
const recent = await results.find({ 'analysis.systemId': systemId })
  .sort({ timestamp: -1 })
  .limit(24)
  .toArray();
```

---

## Best Practices

1. **Always use `getCollection()` helper** - Never create MongoDB client manually
2. **Use ISO 8601 UTC timestamps** - `new Date().toISOString()`
3. **Dual-write is automatic** - `analyze.cjs` handles it
4. **Migrate readers gradually** - Move from `history` to `analysis-results` over time
5. **Use proper field paths** - Remember `analysis.systemId` in `analysis-results` vs `systemId` in `history`
6. **Index your queries** - Check existing indexes before adding new ones

---

## FAQ

**Q: Why do we have two collections for the same data?**  
A: Historical reasons. We're migrating from `history` to `analysis-results`. Dual-write ensures compatibility during transition.

**Q: Which collection should I use for new code?**  
A: Always use `analysis-results` for new code. It's the primary source of truth.

**Q: Will `history` be deleted?**  
A: Not immediately. It will be deprecated once all tools migrate to `analysis-results`, then eventually removed.

**Q: What if dual-write fails?**  
A: It's best-effort and non-blocking. Analysis won't fail if dual-write fails, but some tools may not see the data immediately.

**Q: How do I know if data exists in both collections?**  
A: Check the dual-write logs in `analyze.cjs` or query both collections by `id` field (they share the same UUIDs).

---

## Related Documentation

- `ARCHITECTURE.md` - System architecture overview
- `MONGODB_INDEXES.md` - Database index specifications
- `FULL_CONTEXT_MODE.md` - Full Context Mode implementation
- `GENERATE_INSIGHTS_ARCHITECTURE.md` - Insights system design
