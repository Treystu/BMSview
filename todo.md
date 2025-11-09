# Pending Task Tracker (Synced with `.github/ToDo.md`)

_Last synced: 2025-11-09_

## Phase 0: Critical Hotfixes (Immediate)

- [ ] MongoDB Query Spike
	- [ ] Capture fresh Atlas metrics and archive screenshots/logs
	- [x] Add temporary query counters + timing logs in `sync-metadata.cjs`, `sync-incremental.cjs`, `sync-push.cjs`
	- [ ] Verify client services consult `localCache` before network
	- [ ] Compare request volume with IndexedDB enabled vs disabled in `netlify dev`
	- [ ] Inspect incremental sync filters for missing `updatedAt` normalization
	- [ ] Document remediation plan with expected metrics
- [ ] Weather Function GET/HEAD Body Error
	- [ ] Reproduce via `analysis-pipeline` in `netlify dev`
	- [x] Patch `callWeatherFunction` to POST with JSON payload
	- [x] Harden weather Netlify function to log/reject non-POST calls
	- [ ] Update Admin Diagnostics weather test coverage
	- [ ] Add regression test post-fix (Phase 4 dependency)
- [ ] Generate Insights Timeout Regression
	- [ ] Capture latest `generate-insights-with-tools.cjs` timing logs
	- [ ] Confirm background handoff at 55s threshold
	- [x] Instrument Gemini/tool calls for slow-path insight requests
	- [ ] Re-run happy path locally and record duration
	- [ ] Document mitigation options (prompt slimming, background default, etc.)
- [ ] Admin Diagnostics Fatal Error
	- [ ] Pull failing `admin-diagnostics.cjs` logs with test IDs
	- [ ] Identify dependent endpoint failures and seed dev data if needed
	- [ ] Wrap diagnostics runner so single failure does not crash suite
	- [ ] Verify UI handles partial failures with actionable messaging
	- [ ] Update diagnostics documentation with troubleshooting steps

## Phase 1: Foundation + Backend

### Step 1-2: IndexedDB Cache Layer Setup
- [ ] Unit test all CRUD operations (admin diagnostics execution)

### Step 3-4: Backend Sync Endpoints
- [ ] Test endpoints manually via `netlify dev`

### Step 5: MongoDB Schema Migration
- [ ] Test migration on staging environment first

### Step 6-7: Unit Tests for Cache Layer
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
- [ ] Ensure all tests runnable via admin diagnostics

## Phase 2: Sync Manager (Steps 8-14)

### Step 8-9: Intelligent Sync Manager Core
- [ ] Create `src/services/syncManager.ts`
	- [ ] Implement `SyncManager` class
	- [ ] Implement `intelligentSync(collection)` decision flow
	- [ ] Implement `reconcileData(collection)` merge logic
	- [ ] Add error handling/recovery
	- [ ] Export singleton instance `syncManager`

### Step 10-11: Periodic Sync with Smart Timer Reset
- [ ] Extend `SyncManager` with periodic scheduling (`startPeriodicSync`, `scheduleNextSync`, `resetPeriodicTimer`, `performPeriodicSync`, `forceSyncNow`)
- [ ] Track sync status fields (`isSyncing`, `lastSyncTime`, `error`)
- [ ] Create `src/hooks/useSyncStatus.ts`
	- [ ] Subscribe to sync status changes
	- [ ] Return `{ isSyncing, lastSyncTime, syncError, cacheStats }`
	- [ ] Auto-update consuming components
- [ ] Document timer reset logic in code comments

### Step 12-13: Dual-Write Strategy for Critical Actions
- [ ] Update `services/clientService.ts`
	- [ ] `analyzeBmsScreenshot()` dual-write + timer reset + performance timing
	- [ ] `registerBmsSystem()` optimistic local + timer reset + rollback on error
	- [ ] `linkAnalysisToSystem()` optimistic update + timer reset
	- [ ] `updateSystemMetadata()` local-only pending update
	- [ ] Admin filters/chart settings remain cache-only
- [ ] Create critical vs non-critical action matrix documentation
- [ ] Manually test each action type

### Step 14: Sync Integration Tests
- [ ] Create `tests/syncManager.integration.test.js`
	- [ ] Fresh cache intelligent sync
	- [ ] Local newer vs server
	- [ ] Server newer vs local
	- [ ] Conflict reconciliation
	- [ ] Periodic sync triggers + timer resets
	- [ ] Dual-write critical actions
	- [ ] Offline scenarios
	- [ ] Concurrent sync attempts
	- [ ] Forced sync button
- [ ] Ensure integration tests accessible via admin diagnostics

## Phase 3: Frontend Integration (Steps 15-21)

### Step 15-16: AppState Hydration from Cache
- [ ] Update `state/appState.tsx` for new sync fields and hydration effect
- [ ] Update initial state for hydration support
- [ ] Stop periodic sync timer on unmount

### Step 17-18: Cache-First Service Layer
- [ ] Update `services/clientService.ts` for cache-first reads and dual-write saves
- [ ] Add `FetchStrategy` enum (`CACHE_FIRST`, `CACHE_AND_SYNC`, `FORCE_FRESH`)
- [ ] Test manual sync button with cache-first behavior

### Step 19-20: Optimistic Updates + Sync UI
- [ ] Create `src/components/SyncStatusIndicator.tsx`
- [ ] Update `AdminDashboard.tsx` with sync section, cache stats, force sync, diagnostics link
- [ ] Add sync status to `App.tsx`
- [ ] Implement optimistic UI handling (pending counts, disabled states, etc.)

### Step 21: End-to-End Frontend Testing
- [ ] Create `tests/frontend-sync.e2e.test.js`
	- [ ] Cache hydration on load
	- [ ] Dual-write on analysis upload
	- [ ] Periodic sync cycle
	- [ ] Timer reset after actions
	- [ ] Manual sync button flow
	- [ ] Offline to online transition
	- [ ] Concurrent actions handling
	- [ ] Error recovery path

## Phase 4: Diagnostics + Production Testing (Steps 22-28)

### Step 22-24: Production Diagnostic Tests
- [ ] Implement seven diagnostics in `admin-diagnostics.cjs` (Cache Integrity, MongoDB Sync Status, Sync Conflict Detection, Timestamp Consistency, Data Integrity Checksum, Full Sync Cycle, Cache Statistics)
- [ ] Register tests in `availableTests`
- [ ] Expose tests in Admin panel
- [ ] Add detailed logging per test step
- [ ] Harden error handling to prevent suite crash

### Step 25-26: Diagnostic UI in Admin Panel
- [ ] Build `src/components/DiagnosticsPanel.tsx` with selection, progress, results, history, JSON export
- [ ] Update `AdminDashboard.tsx` tab/section for diagnostics display
- [ ] Add visual status indicators (✅ / ⚠️ / ❌ / spinner)

### Step 27: Production End-to-End Testing
- [ ] Complete manual `netlify dev` validation checklist
- [ ] Repeat tests in production/staging environment
- [ ] Document issues and compile test case report

### Step 28: Performance Tuning + Documentation
- [ ] Gather performance measurements (load, dual-write, periodic sync, IndexedDB, Mongo calls)
- [ ] Optimize identified bottlenecks
- [ ] Document improvements + architecture/troubleshooting guidance
- [ ] Create `ARCHITECTURE.md`
- [ ] Document MongoDB indexes

## Cross-Cutting Concerns
- [ ] Enforce ISO UTC timestamps everywhere
- [ ] Strengthen error handling patterns
- [ ] Maintain structured logging
- [ ] Ensure tests run via admin diagnostics with proper cleanup and timeouts
- [ ] Continue to skip legacy compatibility requirements (already acknowledged)

## Deployment Checklist (Pre-Production)
- [ ] Execute migration + index verification
- [ ] Run diagnostics locally and on staging
- [ ] Validate UTC timestamps on sampled records
- [ ] Test offline/online transitions
- [ ] Monitor Netlify + MongoDB metrics post-deploy
- [ ] Document issues and rollback plan
