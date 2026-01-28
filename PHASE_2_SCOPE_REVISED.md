# Phase 2 Scope - Revised Based on Oracle Verification

**Date:** 2026-01-20
**Status:** READY TO EXECUTE
**Oracle Verification:** 96% accuracy, production-ready

---

## Executive Summary

Phase 2 scope has been refined based on Oracle verification findings:

**Key Changes:**
1. ✅ **Phase 2A** (Fix Data Source) → **REMOVED** - get-hourly-soc-predictions works correctly
2. ✅ **Sync Integration** → **REDUCED** - SyncManager already exists, only needs enhancements
3. ✅ **New Priority** → **Fix sync-push.cjs duplication** (code quality issue)

**Revised Total Scope:** 1200-1650 LOC (down from 1700-2450)

---

## Oracle Verification Corrections

### 1. get-hourly-soc-predictions Tool - NOT A BLOCKER ✅

**Previous Assessment:** "Blocker - returning invalid data"

**Oracle Finding:** Tool is fully implemented with:
- Mock data for test-system
- Real data fetching from history collection
- Hourly interpolation algorithm
- Sunrise/sunset calculations

**Action:** Test with `test-system` to verify, then move on

**LOC Impact:** -200 (removed from Phase 2A)

---

### 2. Sync Functions - ALREADY INTEGRATED ✅

**Previous Assessment:** "NOT called from frontend (no UI integration)"

**Oracle Finding:** Full integration exists:
- `SyncManager` class in `src/services/syncManager.ts`
- Calls to sync-metadata, sync-push, sync-incremental
- `useSyncStatus.ts` hook
- `SyncStatusIndicator.tsx` component
- App.tsx initializes sync with 90-second periodic interval

**Action:** Review existing implementation, add enhancements only if needed

**LOC Impact:** -250 (reduced from 300-400 to 50-100)

---

### 3. sync-push.cjs Duplicate Code - NEW ISSUE ❌

**Oracle Finding:** Handler defined twice (lines 77-228 and 230-377)

**Impact:** Code maintainability, potential bugs

**Action:** Remove duplicate code before other Phase 2 work

**LOC Impact:** +50 (new task)

---

## Revised Phase 2 Tasks

### Phase 2A: Verify SOC Predictions Tool (50 LOC)

**Original:** Debug and fix tool
**Revised:** Verify functionality, test edge cases

**Tasks:**
1. Test with `test-system` systemId
2. Test with real system data
3. Verify output format matches expectations
4. Document any actual issues found

**Estimated LOC:** 50 (testing/verification only)

---

### Phase 2B: Solar Integration into analyze.cjs (250-300 LOC)

**Goal:** Automatically fetch solar data during BMS analysis

**Implementation:**
1. Add solar estimate fetch to `analyze.cjs` after BMS extraction
   - Use system location (lat/lon or zip)
   - Fetch for analysis timestamp date
   - Use system's solar config (panelWatts from maxSolarAmps × nominalVoltage)

2. Calculate solar correlation
   - Compare expected solar generation to actual battery charge
   - Formula: `expectedSolar - actualCharge = daytimeLoad`
   - Calculate efficiency: `actualCharge / expectedSolar × 100`

3. Save to analysis record
   - Add `solarData` field to analysis-results schema
   - Include: expectedWh, actualWh, efficiency, isDaytime

4. Include in basic insights
   - Add solar efficiency score to AnalysisResult
   - Display in UI: "Solar efficiency: 85% (typical for cloudy day)"

**Files to Modify:**
- `netlify/functions/analyze.cjs` (150 LOC)
- `netlify/functions/utils/solar-correlation.cjs` (NEW, 100 LOC)
- `src/types/index.ts` (schema update, 20 LOC)

**Estimated LOC:** 250-300

---

### Phase 2C: Weather Integration into Efficiency Scoring (150-200 LOC)

**Goal:** Use weather data in battery efficiency calculations

**Implementation:**
1. Temperature impact on capacity
   - Formula: `adjustedCapacity = nominalCapacity × (1 - tempFactor)`
   - tempFactor: 0% at 25°C, +2% per 5°C above, -2% per 5°C below
   - Example: At 0°C, expect 10% capacity reduction

2. Cloud cover impact on solar
   - Formula: `adjustedSolar = expectedSolar × (1 - cloudFactor)`
   - cloudFactor: 0% at 0% clouds, 50% at 50% clouds, 80% at 100% clouds
   - Use in solar correlation calculation

3. Add to basic analysis insights
   - "Battery temperature: 5°C - expect 8% capacity reduction"
   - "Heavy cloud cover - solar charging may be reduced by 60%"

**Files to Modify:**
- `netlify/functions/utils/weather-analysis.cjs` (NEW, 100 LOC)
- `netlify/functions/analyze.cjs` (use weather data, 50 LOC)
- `src/components/AnalysisResult.tsx` (display weather warnings, 30 LOC)

**Estimated LOC:** 150-200

---

### Phase 2D: Auto-Trending Analytics (200-250 LOC)

**Goal:** Proactively invoke trending tools for insights

**Implementation:**
1. Pre-load analytics into Full Context Mode
   - Automatically call `getSystemAnalytics` when Full Context requested
   - Include 90-day usage summary in initial context
   - Add baseline metrics for comparison

2. Auto-detect degradation queries
   - Query patterns: "battery health", "degradation", "lifetime", "capacity loss"
   - Automatically call `predict_battery_trends` with metric='capacity'
   - Include trend summary in response

3. Comparative analytics
   - "This month vs last month" calculations
   - Weekly usage comparisons
   - Seasonal pattern detection

**Files to Modify:**
- `netlify/functions/utils/insights-guru.cjs` (add auto-trending logic, 100 LOC)
- `netlify/functions/utils/full-context-builder.cjs` (pre-load analytics, 80 LOC)
- `netlify/functions/utils/query-classifier.cjs` (NEW, detect trending queries, 50 LOC)

**Estimated LOC:** 200-250

---

### Phase 2E: Async Smart Routing (150-200 LOC)

**Goal:** Auto-route complex queries to async mode

**Implementation:**
1. Query complexity estimator
   - Factors: Date range, data volume, custom prompt length, tool calls needed
   - Score: 0-100 (0=simple, 100=complex)
   - Threshold: >75 = async recommended

2. Auto-route logic
   - If complexity >75 AND mode not explicitly set: use async
   - Show user prompt: "This query is complex. Using background mode..."
   - Return jobId and statusUrl

3. UI improvements
   - Better progress indicators during async processing
   - Show estimated completion time (based on historical averages)
   - Add cancel button for running jobs

**Files to Modify:**
- `netlify/functions/utils/query-complexity.cjs` (NEW, 80 LOC)
- `netlify/functions/generate-insights-with-tools.cjs` (add routing logic, 50 LOC)
- `src/components/InsightsProgressDisplay.tsx` (better progress UI, 40 LOC)

**Estimated LOC:** 150-200

---

### Phase 2F: Fix sync-push.cjs Duplication (50 LOC)

**Goal:** Remove duplicate handler code

**Implementation:**
1. Identify correct handler version
   - Compare lines 77-228 vs 230-377
   - Choose version with latest bug fixes

2. Remove duplicate
   - Delete duplicate lines
   - Verify no functionality lost

3. Test sync functionality
   - Ensure sync-push still works
   - Test error handling

**Files to Modify:**
- `netlify/functions/sync-push.cjs` (-150 lines, net -100)

**Estimated LOC:** 50 (cleanup + testing)

---

### Phase 2G: Sync Enhancements (50-100 LOC)

**Goal:** Minor improvements to existing sync

**Implementation:**
1. Review SyncManager implementation
   - Verify periodic sync works correctly
   - Check error handling

2. Add UI enhancements (if needed)
   - "Last synced X minutes ago" display
   - Manual "Sync Now" button (if missing)
   - Sync status in settings

**Files to Modify:**
- `src/services/syncManager.ts` (review, minor fixes, 30 LOC)
- `src/components/SyncStatusIndicator.tsx` (enhancements, 40 LOC)

**Estimated LOC:** 50-100

---

## Phase 3: Testing & Verification (300-500 LOC)

**Goal:** Comprehensive end-to-end testing

**Tasks:**
1. Unit tests for new utilities
   - solar-correlation.cjs
   - weather-analysis.cjs
   - query-complexity.cjs
   - query-classifier.cjs

2. Integration tests
   - Solar integration in analyze.cjs
   - Weather warnings in analysis results
   - Auto-trending in insights
   - Async routing logic

3. End-to-end tests
   - Full analysis pipeline with solar+weather
   - Insights generation with auto-trending
   - Async mode with progress tracking
   - Sync functionality

4. Performance testing
   - Ensure no significant slowdown in analyze.cjs
   - Verify async routing doesn't cause unnecessary delays
   - Test sync with large datasets

5. Documentation updates
   - Update CLAUDE.md with new features
   - Document solar/weather integration
   - Update insights guide

**Estimated LOC:** 300-500

---

## Revised Total Scope

| Phase | Scope | Original | Revised | Change |
|-------|-------|----------|---------|--------|
| **2A** | Verify SOC Tool | 200-300 | 50 | -225 |
| **2B** | Solar Integration | N/A | 250-300 | +275 |
| **2C** | Weather Integration | N/A | 150-200 | +175 |
| **2D** | Auto-Trending | N/A | 200-250 | +225 |
| **2E** | Async Routing | 300-400 | 150-200 | -200 |
| **2F** | Fix Duplication | N/A | 50 | +50 |
| **2G** | Sync Enhancements | 300-400 | 50-100 | -275 |
| **Phase 3** | Testing | 300-500 | 300-500 | 0 |
| **TOTAL** | | 1700-2450 | 1200-1650 | -550 |

**Net Change:** -550 LOC (scope reduced by ~25%)

---

## Implementation Order

### Priority 1: Fix Code Quality Issues
1. **Phase 2F** - Fix sync-push duplication (~50 LOC)

### Priority 2: Core Integrations
2. **Phase 2B** - Solar integration (~250-300 LOC)
3. **Phase 2C** - Weather integration (~150-200 LOC)

### Priority 3: Intelligence Enhancements
4. **Phase 2D** - Auto-trending (~200-250 LOC)
5. **Phase 2E** - Async routing (~150-200 LOC)

### Priority 4: Verification
6. **Phase 2A** - Verify SOC tool (~50 LOC)
7. **Phase 2G** - Sync enhancements (~50-100 LOC)
8. **Phase 3** - Comprehensive testing (~300-500 LOC)

**Total Estimated LOC:** 1200-1650 LOC (implementation time varies by AI model)

---

## Success Criteria

### Phase 2B: Solar Integration ✅
- [ ] analyze.cjs fetches solar data automatically
- [ ] Solar correlation calculated and saved
- [ ] Solar efficiency displayed in UI
- [ ] No significant performance impact (<500ms added)

### Phase 2C: Weather Integration ✅
- [ ] Temperature warnings in basic analysis
- [ ] Cloud cover affects solar efficiency calculation
- [ ] Weather impact clearly explained to user

### Phase 2D: Auto-Trending ✅
- [ ] Full Context Mode includes analytics summary
- [ ] Degradation queries auto-invoke predict_battery_trends
- [ ] Comparative analytics ("this month vs last month") work

### Phase 2E: Async Routing ✅
- [ ] Query complexity estimator works
- [ ] Complex queries auto-route to async
- [ ] User sees clear progress indicators
- [ ] Estimated completion time displayed

### Phase 2F: Code Quality ✅
- [ ] sync-push duplication removed
- [ ] Sync still works correctly
- [ ] No functionality lost

### Phase 3: Testing ✅
- [ ] All unit tests pass
- [ ] Integration tests cover new features
- [ ] End-to-end tests verify complete flow
- [ ] Performance benchmarks acceptable
- [ ] Documentation updated

---

## Next Steps

1. **User Approval** - Confirm revised scope
2. **Begin Phase 2F** - Fix sync-push (quick win)
3. **Proceed sequentially** - Follow implementation order
4. **Continuous testing** - Test each phase before moving on

---

**Status:** ✅ READY TO EXECUTE - Revised scope based on Oracle verification
