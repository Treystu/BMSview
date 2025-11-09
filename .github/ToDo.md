---

## 🎯 LOCAL-FIRST STATE MANAGEMENT: COMPREHENSIVE TO-DO LIST

> **MVP Context:** Zero production users. Focus on production diagnostics over migration. Rapid prototyping phase.
>
> **Goal:** Reduce MongoDB rate limiting by 90% through intelligent local-first sync with UTC timestamps.

---

### Phase 1: FOUNDATION + BACKEND (Steps 1-7)

#### Step 1-2: IndexedDB Cache Layer Setup
- [x] Install Dexie.js (`npm install dexie`)
- [x] Create `src/services/localCache.ts`
  - [x] Initialize Dexie database with schema version management
  - [x] Define stores: `systems`, `history`, `analytics`, `weather`, `metadata`
  - [x] Add `updatedAt` (ISO 8601 UTC) and `_syncStatus` fields to all stores
  - [x] Implement CRUD operations for each collection
  - [x] Add expiry/staleness detection logic based on timestamps
  - [x] Implement `getMetadata()` method returning: `{ lastModified: ISO8601, recordCount, checksum }`
  - [x] Implement `getPendingItems()` to find records with `_syncStatus: 'pending'`
  - [x] Implement `markAsSynced()` to update status after server sync
  - [x] Add error handling and logging for all operations
  - [ ] Unit test all CRUD operations (will run in admin diagnostics)

#### Step 3-4: Backend Sync Endpoints
- [x] Create `netlify/functions/sync-metadata.cjs`
  - [x] GET endpoint: `/.netlify/functions/sync-metadata?collection=systems`
  - [x] Returns: `{ collection, lastModified, recordCount, checksum, serverTime }`
  - [x] Add logging for diagnostics
- [x] Create `netlify/functions/sync-incremental.cjs`
  - [x] GET endpoint: `/.netlify/functions/sync-incremental?collection=systems&since=<ISO8601>`
  - [x] Returns only records with `updatedAt >= since` timestamp
  - [x] Returns deleted record IDs from `deleted-records` collection
  - [x] Add `Content-Type` and proper error handling
- [x] Create `netlify/functions/sync-push.cjs`
  - [x] POST endpoint: `/.netlify/functions/sync-push`
  - [x] Accepts: `{ collection: string, items: any[] }`
  - [x] Uses bulkWrite for efficient batch updates
  - [x] Sets `updatedAt` to server time (server timestamp wins)
  - [x] Sets `_syncStatus: 'synced'` after successful write
  - [x] Returns: `{ success, inserted, updated, serverTime }`
- [x] Add error handling and validation to all sync endpoints
- [ ] Test endpoints manually via `netlify dev`

#### Step 5: MongoDB Schema Migration
- [x] Create `netlify/functions/migrate-add-sync-fields.cjs`
  - [x] Add `updatedAt` field to all existing records (use server time if missing)
  - [x] Add `_syncStatus: 'synced'` to all existing records
  - [x] Create index on `updatedAt` for all collections (`systems`, `history`, `analysis-results`)
  - [x] Create index on `_syncStatus` for fast pending queries
  - [x] Create `sync-metadata` collection with initial state
  - [x] Create `deleted-records` collection with index on `collection` + `deletedAt`
  - [x] Add logging and progress reporting
- [x] Document migration steps in README
- [x] Create backup procedure before running migration
- [ ] Test migration on staging environment first

#### Step 6-7: Unit Tests for Cache Layer
- [ ] Create `tests/localCache.test.js`
  - [ ] Test Dexie initialization
  - [ ] Test CRUD operations (create, read, update, delete)
  - [ ] Test metadata retrieval
  - [ ] Test pending items filtering
  - [ ] Test marking records as synced
  - [ ] Test bulk operations
  - [ ] Test staleness detection
- [ ] Create `tests/sync-endpoints.test.js`
  - [ ] Mock MongoDB responses
  - [ ] Test metadata endpoint response format
  - [ ] Test incremental sync with various timestamp ranges
  - [ ] Test batch push with conflict scenarios
  - [ ] Test error handling
- [ ] All tests runnable via admin diagnostics

---

### Phase 2: SYNC MANAGER (Steps 8-14)

#### Step 8-9: Intelligent Sync Manager Core
- [ ] Create `src/services/syncManager.ts`
  - [ ] Implement `SyncManager` class
  - [ ] Add `intelligentSync(collection)` method:
    - [ ] Fetch local metadata (via `localCache.getMetadata()`)
    - [ ] Fetch server metadata (via new sync-metadata endpoint)
    - [ ] Compare timestamps (UTC, no timezone issues)
    - [ ] If local empty: pull from server
    - [ ] If local newer: push to server
    - [ ] If server newer: pull from server
    - [ ] If timestamps equal: compare record counts
    - [ ] If counts differ: call `reconcileData()` for full merge
    - [ ] Log decision and actions
  - [ ] Implement `reconcileData(collection)` method:
    - [ ] Create maps of server and local data by ID
    - [ ] Find items to add (server only)
    - [ ] Find items to update (server newer based on `updatedAt`)
    - [ ] Find items to delete (local only)
    - [ ] Apply changes via `localCache.bulkOperation()`
    - [ ] Log reconciliation results
  - [ ] Add error handling and recovery logic
  - [ ] Export singleton instance `syncManager`

#### Step 10-11: Periodic Sync with Smart Timer Reset
- [ ] Extend `SyncManager` class:
  - [ ] Add `startPeriodicSync()` method - kick off initial schedule
  - [ ] Add `private scheduleNextSync()` - set 90-second timeout
  - [ ] Add `resetPeriodicTimer()` - clear and reschedule (called after user actions)
  - [ ] Add `private performPeriodicSync()` method:
    - [ ] Check if sync already in progress (guard against concurrent syncs)
    - [ ] Find all pending items via `localCache.getPendingItems()`
    - [ ] Batch push pending systems to server (via sync-push endpoint)
    - [ ] Batch push pending history to server
    - [ ] Mark as synced via `localCache.markAsSynced()`
    - [ ] Pull incremental updates from server (via sync-incremental endpoint)
    - [ ] Update `lastSyncTime` in cache
    - [ ] Log sync results and duration
    - [ ] Reschedule next sync even if error occurs
  - [ ] Add `forceSyncNow()` method for manual sync button
  - [ ] Add sync status tracking: `isSyncing`, `lastSyncTime`, `error`
- [ ] Create `src/hooks/useSyncStatus.ts`
  - [ ] Hook to subscribe to sync status changes
  - [ ] Return: `{ isSyncing, lastSyncTime, syncError, cacheStats }`
  - [ ] Auto-update component on status change
- [ ] Document timer reset logic clearly in comments

#### Step 12-13: Dual-Write Strategy for Critical Actions
- [ ] Update `services/clientService.ts`:
  - [ ] **Critical Action: `analyzeBmsScreenshot()`**
    - [ ] Call backend analysis endpoint (writes to MongoDB immediately)
    - [ ] On success, immediately add to local cache with `_syncStatus: 'synced'`
    - [ ] Call `syncManager.resetPeriodicTimer()` to reset 90s timer
    - [ ] Return combined result
    - [ ] Add performance timing
  - [ ] **Critical Action: `registerBmsSystem()`**
    - [ ] Optimistic local add with temp ID and `_syncStatus: 'pending'`
    - [ ] Call backend registration endpoint
    - [ ] On success, replace temp ID with real ID, set `_syncStatus: 'synced'`
    - [ ] Call `syncManager.resetPeriodicTimer()`
    - [ ] On error, rollback local change
  - [ ] **Critical Action: `linkAnalysisToSystem()`**
    - [ ] Optimistic local update of history record
    - [ ] Call backend link endpoint
    - [ ] Mark as `_syncStatus: 'synced'` on success
    - [ ] Call `syncManager.resetPeriodicTimer()`
  - [ ] **Non-Critical Action: `updateSystemMetadata()`**
    - [ ] Optimistic local update only, `_syncStatus: 'pending'`
    - [ ] DO NOT reset timer - let periodic sync handle it
  - [ ] **Non-Critical Action: Admin filters/chart settings**
    - [ ] Update cache only, never write to server
    - [ ] DO NOT reset timer
- [ ] Create matrix documentation showing which actions are critical vs. non-critical
- [ ] Test each action type manually

#### Step 14: Sync Integration Tests
- [ ] Create `tests/syncManager.integration.test.js`
  - [ ] Test intelligent sync with fresh cache
  - [ ] Test intelligent sync with local data newer than server
  - [ ] Test intelligent sync with server data newer than local
  - [ ] Test data reconciliation with conflicts
  - [ ] Test periodic sync triggers and timer resets
  - [ ] Test dual-write critical actions
  - [ ] Test offline scenarios (network errors)
  - [ ] Test concurrent sync attempts
  - [ ] Test forced sync button
- [ ] All tests accessible via admin diagnostics

---

### Phase 3: FRONTEND INTEGRATION (Steps 15-21)

#### Step 15-16: AppState Hydration from Cache
- [ ] Update `state/appState.tsx`:
  - [ ] Add new state fields:
    - [ ] `isSyncing: boolean`
    - [ ] `lastSyncTime: Record<string, number>` (e.g., `{ systems: 1699..., history: 1699... }`)
    - [ ] `syncError: string | null`
    - [ ] `cacheStats: { systemsCount, historyCount, cacheSizeBytes }`
  - [ ] Create `useEffect` for initial hydration:
    - [ ] On app load, hydrate from IndexedDB (instant load)
    - [ ] Call `syncManager.intelligentSync()` for each collection
    - [ ] Update state with fetched data + sync metadata
    - [ ] Start periodic sync timer
  - [ ] Add action types for sync status updates:
    - [ ] `UPDATE_SYNC_STATUS`
    - [ ] `SET_CACHE_STATS`
    - [ ] `SYNC_ERROR`
  - [ ] Update reducer to handle new actions
- [ ] Update initial state to support hydration
- [ ] Add cleanup on unmount (stop periodic sync timer)

#### Step 17-18: Cache-First Service Layer
- [ ] Update `services/clientService.ts`:
  - [ ] Modify `getRegisteredSystems()`:
    - [ ] Check local cache first via `localCache.getSystems()`
    - [ ] If `forceRefresh=false` and cache exists: return cached data
    - [ ] Otherwise: fetch from server and update cache
  - [ ] Modify `getAnalysisHistory()`:
    - [ ] Check local cache first
    - [ ] Return if cache valid and not forcing refresh
    - [ ] Otherwise: fetch and cache
  - [ ] Modify `saveAnalysisResult()`:
    - [ ] Immediate local cache update (optimistic)
    - [ ] Call backend to save to MongoDB
    - [ ] Mark as synced in cache on success
    - [ ] Reset sync timer
  - [ ] Update all write operations to follow dual-write pattern
  - [ ] Add force-refresh parameter to all read operations
  - [ ] Add performance logging for all operations
- [ ] Create `FetchStrategy` enum: `CACHE_FIRST | CACHE_AND_SYNC | FORCE_FRESH`
- [ ] Test cache-first behavior with manual sync button

#### Step 19-20: Optimistic Updates + Sync UI
- [ ] Create `src/components/SyncStatusIndicator.tsx`
  - [ ] Display: "Last synced: X seconds ago"
  - [ ] Show spinner during sync
  - [ ] Show error icon if sync failed
  - [ ] Show pending items count if any
  - [ ] Color coding: green (synced), yellow (syncing), red (error)
- [ ] Update `AdminDashboard.tsx`:
  - [ ] Add sync status section
  - [ ] Add cache statistics display
  - [ ] Add "Force Sync Now" button
  - [ ] Show pending items awaiting sync
  - [ ] Link to diagnostics panel
- [ ] Add sync status to main `App.tsx` header
- [ ] Implement optimistic UI updates:
  - [ ] Show local change immediately
  - [ ] Hide error until sync fails
  - [ ] Disable related actions during critical sync

#### Step 21: End-to-End Frontend Testing
- [ ] Create `tests/frontend-sync.e2e.test.js`
  - [ ] Test app load with cache hydration
  - [ ] Test dual-write on analysis upload
  - [ ] Test periodic sync cycle
  - [ ] Test timer reset after user action
  - [ ] Test manual sync button
  - [ ] Test offline → online transition
  - [ ] Test concurrent user actions
  - [ ] Test error recovery

---

### Phase 4: DIAGNOSTICS + PRODUCTION TESTING (Steps 22-28)

#### Step 22-24: Production Diagnostic Tests
- [ ] Update `netlify/functions/admin-diagnostics.cjs` with 7 new tests:
  
  **Test 1: Cache Integrity Check**
  - [ ] Verify all MongoDB records have required fields
  - [ ] Check `updatedAt` format is ISO 8601 UTC
  - [ ] Check `_syncStatus` is valid enum value
  - [ ] Flag any invalid records
  - [ ] Return: count, validation results, warnings

  **Test 2: MongoDB Sync Status**
  - [ ] Fetch `sync-metadata` collection
  - [ ] Check `lastSyncTime` vs. current time
  - [ ] Report pending items count
  - [ ] Status: Success if synced <2 min ago, Warning if >2 min

  **Test 3: Sync Conflict Detection**
  - [ ] Query all records with `_syncStatus: 'conflict'`
  - [ ] List conflicting record IDs
  - [ ] Check `updatedAt` timestamps for all conflicts
  - [ ] Return: conflict count, details

  **Test 4: Timestamp Consistency Check**
  - [ ] Sample 100 records from each collection
  - [ ] Verify all timestamps end with 'Z' (UTC)
  - [ ] Verify all timestamps are parseable
  - [ ] Check no timezone offset in timestamps
  - [ ] Return: consistency report per collection

  **Test 5: Data Integrity Checksum**
  - [ ] Generate SHA-256 hash of all record IDs + updatedAt
  - [ ] Store checksum in cache
  - [ ] Compare cache vs. server checksums
  - [ ] Report any mismatches
  - [ ] Return: checksum, match status, discrepancies

  **Test 6: Full Sync Cycle Test**
  - [ ] Create test system record in MongoDB
  - [ ] Fetch it back to verify write
  - [ ] Modify it and update
  - [ ] Verify update
  - [ ] Delete test record
  - [ ] Confirm deletion
  - [ ] Return: success/failure for each step

  **Test 7: Cache Statistics**
  - [ ] Count total records in each collection
  - [ ] Count pending items (`_syncStatus: 'pending'`)
  - [ ] Count synced items (`_syncStatus: 'synced'`)
  - [ ] Estimate cache size (sample × total)
  - [ ] Return: counts, sizes, percentages
  
- [ ] Add all tests to `availableTests` object in main handler
- [ ] Make tests selectable in Admin panel
- [ ] Add logging for each test step
- [ ] Error handling doesn't break other tests

#### Step 25-26: Diagnostic UI in Admin Panel
- [ ] Create `src/components/DiagnosticsPanel.tsx`
  - [ ] List all 7 available tests with descriptions
  - [ ] Checkboxes to select tests to run
  - [ ] "Run Selected Tests" button
  - [ ] Progress indicator during test execution
  - [ ] Results display:
    - [ ] Test name, status (✅ Success / ⚠️ Warning / ❌ Failure)
    - [ ] Duration for each test
    - [ ] Detailed results in collapsible sections
    - [ ] Raw JSON export button
  - [ ] "Run All Tests" convenience button
  - [ ] Test history (last N runs with timestamps)
  - [ ] Export results to JSON file
- [ ] Update `AdminDashboard.tsx`:
  - [ ] Add tab/section for Diagnostics
  - [ ] Display when user clicks "Run Diagnostics"
  - [ ] Show test results in real-time as they complete
- [ ] Add visual indicators:
  - [ ] Green checkmark for passing tests
  - [ ] Yellow warning icon for warnings
  - [ ] Red X for failures
  - [ ] Spinner during execution

#### Step 27: Production End-to-End Testing
- [ ] Manual test in `netlify dev`:
  - [ ] Load app, verify cache hydration
  - [ ] Upload BMS image, verify dual-write
  - [ ] Check MongoDB for record
  - [ ] Check IndexedDB for record
  - [ ] Wait 90 seconds, verify periodic sync runs
  - [ ] Create pending item, click manual sync
  - [ ] Verify timer reset after sync
  - [ ] Run all diagnostics, verify passing
  - [ ] Simulate offline, make change, verify pending status
  - [ ] Go online, verify background sync
- [ ] Test in production (if available):
  - [ ] Same manual tests on live environment
  - [ ] Check Netlify function logs for errors
  - [ ] Monitor MongoDB for rate limits
  - [ ] Verify timestamps are UTC everywhere
- [ ] Document any issues found
- [ ] Create test case document

#### Step 28: Performance Tuning + Documentation
- [ ] Performance measurements:
  - [ ] Measure app load time (with and without cache)
  - [ ] Measure analysis upload time (dual-write)
  - [ ] Measure periodic sync time
  - [ ] Measure IndexedDB operations
  - [ ] Compare MongoDB call counts before/after
- [ ] Optimize any bottlenecks found
- [ ] Document performance improvements
- [ ] Create README section on:
  - [ ] Local-first sync architecture
  - [ ] How to run diagnostics
  - [ ] Troubleshooting sync issues
  - [ ] UTC timestamp requirements
- [ ] Create ARCHITECTURE.md with full sync flow diagrams
- [ ] Add troubleshooting guide for common issues
- [ ] Document MongoDB indexes created

---

## 📋 CROSS-CUTTING CONCERNS

### Timestamps (ALL CODE)
- [ ] **Use ISO 8601 UTC everywhere**: `new Date().toISOString()`
- [ ] Never use `Date.now()` for comparisons (milliseconds, inconsistent)
- [ ] Never use browser timezone (changes with user location)
- [ ] Backend sets server timestamp for all fields (`updatedAt`)
- [ ] Frontend respects server timestamp, never overwrites
- [ ] Add validation: timestamp must end with 'Z'
- [ ] Regex: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`

### Error Handling (ALL FUNCTIONS)
- [ ] Wrap sync operations in try-catch
- [ ] Log all errors with context
- [ ] Don't throw on sync failure - let periodic retry
- [ ] User-facing errors use simple messages
- [ ] Server errors logged with full stack trace
- [ ] Network errors trigger offline mode
- [ ] MongoDB errors trigger circuit breaker

### Logging (ALL FILES)
- [ ] Critical actions: `log.info()`
- [ ] Decisions: `log.debug()`
- [ ] Issues: `log.warn()` or `log.error()`
- [ ] Include timing information for performance
- [ ] Include collection/record counts where relevant
- [ ] Structured JSON format: `{ level, timestamp, service, message, context }`

### Testing (ALL FEATURES)
- [ ] Accessible via admin diagnostics (production testing)
- [ ] No npm test requirements for MVP
- [ ] Mock data included in tests
- [ ] Tests are idempotent (can run repeatedly)
- [ ] Cleanup after each test (delete test records)
- [ ] Timeout handling for long operations

### Backward Compatibility (NOT REQUIRED)
- [ ] ✅ **Skip user migration** - MVP phase, no users
- [ ] ✅ **Skip legacy code support** - Fresh start
- [ ] ✅ **Break old schema** - Add `updatedAt` + `_syncStatus` to all
- [ ] ✅ **Run migration once** - One-time setup, documented

---

## ✅ ACCEPTANCE CRITERIA: DONE WHEN...

### Performance
- [ ] MongoDB calls reduced by **90%** (measure via logs)
- [ ] App load time under **1 second** (cache hydration)
- [ ] Analysis upload + dual-write under **5 seconds**
- [ ] Periodic sync completes in under **10 seconds**

### Reliability
- [ ] All 7 diagnostic tests pass in production
- [ ] Timestamp format consistent (UTC, no timezone)
- [ ] No data loss during sync (reconciliation works)
- [ ] No rate limiting errors in 24-hour test

### User Experience
- [ ] Sync status visible in UI
- [ ] Manual sync button accessible in Admin
- [ ] Offline operation (read-only) working
- [ ] Error messages clear and actionable

### Code Quality
- [ ] All functions use structured logging
- [ ] No hardcoded timestamps or timezones
- [ ] Error handling in all async operations
- [ ] Comments explain sync logic clearly
- [ ] No console.log in production code

---

## 🚀 DEPLOYMENT CHECKLIST

Before pushing to production:
- [ ] Run migration script on MongoDB
- [ ] Verify all MongoDB indexes created
- [ ] Test all 7 diagnostics locally
- [ ] Test all 7 diagnostics on staging
- [ ] Confirm timestamps are UTC (check 10 random records)
- [ ] Test offline → online transition
- [ ] Monitor Netlify logs for 1 hour post-deploy
- [ ] Monitor MongoDB connection count
- [ ] Verify no rate limit errors
- [ ] Document any issues found
- [ ] Create rollback plan if needed

---

## 📞 TROUBLESHOOTING

### Sync Not Starting
1. Check `syncManager.startPeriodicSync()` called in App.tsx
2. Verify browser console for errors
3. Run "Cache Integrity" diagnostic
4. Check Netlify function logs

### Timestamps Mismatched
1. Verify all timestamps end with 'Z'
2. Check server time via `/sync-metadata` endpoint
3. Verify browser clock is correct
4. Run "Timestamp Consistency" diagnostic

### Pending Items Not Syncing
1. Check `_syncStatus` field value (should be 'pending')
2. Verify periodic sync timer is running
3. Click "Force Sync Now" button to trigger immediately
4. Check Netlify logs for sync-push errors
5. Run "MongoDB Sync Status" diagnostic

### Rate Limiting Still Happening
1. Run "Cache Statistics" diagnostic
2. Verify cache-first reads working
3. Check that non-critical actions use cache only
4. Review `clientService.ts` for any missed APIs
5. Monitor MongoDB connection count

---