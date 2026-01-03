# OODA App Completion Loop

You are an autonomous agent completing this application. Execute the OODA loop systematically until the app is fully functional and cohesive.

---

## APP CONTEXT (Pre-loaded - Do Not Re-read Documentation)

### What This App Does
**BMSview** - Battery Management System screenshot analysis tool using Google Gemini AI.
- Analyze BMS screenshots to extract battery metrics (voltage, current, SOC, temperature, cell voltages)
- Track historical battery performance over time
- AI-powered diagnostics and recommendations ("Battery Guru")
- Solar energy integration and battery-charging correlation
- Anomaly detection and predictive maintenance

### Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite 7.1, Tailwind CSS |
| State | React Context API with Reducer pattern |
| Local Cache | Dexie.js (IndexedDB) for local-first sync |
| Backend | Netlify Functions (Node.js 20, serverless) |
| Database | MongoDB 6.20 |
| AI | Google Gemini API (2.5 Flash, 1.5 Pro) |
| External APIs | Solar Charge Estimator, OpenWeather |

### Critical Architecture Rules

**Module Systems - NEVER MIX:**
- Frontend (.ts/.tsx): ES modules (`import`/`export`)
- Backend (.cjs): CommonJS (`require()`/`module.exports`)
- Exception: `netlify/functions/solar-estimate.ts` (TypeScript, bundled)

**Local-First Sync Pattern:**
- Data lives in IndexedDB first, server is authoritative for conflicts
- 90-second periodic sync timer with manual reset on critical actions
- Dual-write: Critical user actions write locally + server immediately
- UTC timestamps everywhere: `new Date().toISOString()` ending in 'Z'

**Path Aliases (Frontend only):**
- `components/*`, `services/*`, `state/*`, `hooks/*`, `utils/*`

### Build & Test Commands
```bash
npm install                    # Install dependencies
npm run build                  # Build for production
npm run dev                    # Start dev server (localhost:5173)
npm run lint                   # ESLint on src/, netlify/functions/, tests/
npm test                       # Jest tests (uses REAL services - needs env vars)
npx tsc --noEmit              # TypeScript check
```

### Key Files
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main app entry, starts periodic sync |
| `src/admin.tsx` | Admin dashboard entry |
| `src/services/syncManager.ts` | Sync orchestration |
| `src/services/localCache.ts` | IndexedDB persistence |
| `src/services/clientService.ts` | API wrapper with cache-first |
| `src/state/appState.tsx` | Global state reducer |
| `netlify/functions/analyze.cjs` | Main analysis endpoint |
| `netlify/functions/generate-insights-with-tools.cjs` | Battery Guru AI |
| `netlify/functions/sync-*.cjs` | Sync endpoints |
| `netlify/functions/utils/logger.cjs` | Structured logging |
| `netlify/functions/utils/mongodb.cjs` | DB connection helper |

---

## KNOWN ISSUES (Pre-loaded from Issues_by_Severity.md)

### CRITICAL (7 issues - Fix First)
1. **Undefined logger in analyze.cjs** - `log` referenced out of scope in `storeAnalysisResults`; persistence silently fails
2. **Wrong import path in generate-insights-with-tools.cjs** - uses `../../utils/logger.cjs` instead of `./utils/logger.cjs`
3. **`@ts-nocheck` on generate-insights-with-tools.cjs** - suppresses type safety in complex tool orchestration
4. **solar-estimate.ts excluded from TypeScript** - tsconfig excludes `netlify`, proxy can regress silently
5. **Open CORS `*` without auth/rate limiting** - enables abuse on analyze & insights endpoints
6. **Legacy async/job functions still deployed** - `job-shepherd.cjs`, `get-job-status.cjs` conflict with sync pipeline
7. **Force reanalysis bypass lacks audit logging** - no traceability for override events

### HIGH (10 issues)
1. Excessive `any` usage (HistoricalChart.tsx, AdminDashboard.tsx, clientService.ts)
2. Weather backfill minimal throttling - risk of API rate limits
3. Systems POST lacks schema validation
4. Broad unfiltered MongoDB queries (`history all fetch`)
5. Duplicate AI dependencies (`@google/genai` & `@google/generative-ai`)
6. Inconsistent logging (createLogger vs ad-hoc JSON)
7. Merge operation ignores conflicting chemistry/voltage
8. Force reanalysis stores duplicates without metadata
9. Idempotency responses lack reason codes
10. Backfill-weather logs each record at `info` level

### MEDIUM (7 issues)
1. Dead legacy helper functions in analyze.cjs
2. Duplicate flags mismatch (`_isDuplicate` vs `dedupeHit`)
3. Index assurance only in insights flow
4. Backfill-weather bulkWrite lacks retry segmentation
5. No tests for solar-estimate.ts
6. Verbose per-record logging in history backfill
7. Non-standard response envelopes

### LOW (7 issues)
1. README branding mismatch ("BMS Validator" vs "BMSview")
2. Mixed alias styles (`@components` vs `components`)
3. Leftover backup files (`.backup`, `.new` files)
4. Missing JSDoc in solarCorrelation.ts
5. Inconsistent error message formats
6. Logging duration field names vary (`elapsed` vs `duration`)
7. Hardcoded recommendation strings

---

## OUTSTANDING TODOS (Pre-loaded from .github/ToDo.md)

### Phase 0: Critical Hotfixes
- [ ] Run staged `netlify dev` to reproduce MongoDB query spike
- [ ] Weather function GET/HEAD body error - reproduce and test
- [ ] Generate insights timeout - pull logs and capture timing
- [ ] Admin diagnostics - retrieve failing request logs

### Phase 1: Foundation (Mostly Complete)
- [ ] Unit test localCache CRUD operations
- [ ] Test sync endpoints manually via `netlify dev`
- [ ] Test migration on staging environment

### Phase 2: Sync Manager
- [ ] Create `src/services/syncManager.ts` improvements
- [ ] Extend periodic sync with smart timer reset
- [ ] Update `services/clientService.ts` for dual-write
- [ ] Create `tests/syncManager.integration.test.js`

### Phase 3: Frontend Integration
- [ ] Update `state/appState.tsx` with sync fields
- [ ] Cache-first service layer updates
- [ ] Optimistic updates + Sync UI
- [ ] Create `tests/frontend-sync.e2e.test.js`

### Phase 4: Diagnostics
- [ ] 7 new production diagnostic tests
- [ ] Diagnostic UI in Admin Panel
- [ ] Production end-to-end testing
- [ ] Performance tuning + documentation

---

## ANTI-PATTERNS (Do Not Introduce)

1. **Don't create job-based flows** - use synchronous mode
2. **Don't use `require()` in frontend** - ES modules only
3. **Don't skip structured logging** - use `createLogger()`
4. **Don't hardcode model names** - use `process.env.GEMINI_MODEL`
5. **Don't mix module systems** - .ts = ES, .cjs = CommonJS
6. **Don't use `Date.now()` for comparisons** - use ISO 8601 UTC
7. **Don't skip error handling** - wrap all async operations

---

## PHASE 1: OBSERVE

First action: Read `.claude/ooda-state.md` to check progress. If missing, run baseline checks.

### 1.1 Build & Test Baseline

```bash
mkdir -p .claude

# Build check
npm run build 2>&1 | tee .claude/build-output.log
echo "Build errors: $(grep -c 'error' .claude/build-output.log 2>/dev/null || echo 0)"

# TypeScript check
npx tsc --noEmit 2>&1 | tee .claude/tsc-output.log
echo "TS errors: $(grep -c 'error' .claude/tsc-output.log 2>/dev/null || echo 0)"

# Lint check
npm run lint 2>&1 | tee .claude/lint-output.log
echo "Lint errors: $(grep -c 'error' .claude/lint-output.log 2>/dev/null || echo 0)"

# Test check (may fail without env vars - that's ok)
npm test 2>&1 | tee .claude/test-output.log || true
echo "Test failures: $(grep -c 'FAIL' .claude/test-output.log 2>/dev/null || echo 0)"
```

Update `.claude/ooda-state.md` with results.

---

## PHASE 2: ORIENT

### 2.1 Issue Prioritization

| Priority | Category | Action |
|----------|----------|--------|
| P0 | Build Blockers | Fix immediately - app won't compile |
| P1 | Critical Issues | Fix next - from KNOWN ISSUES above |
| P2 | High Issues | Fix after P1 |
| P3 | Test Failures | Make tests pass |
| P4 | Medium/Low Issues | Quality improvements |
| P5 | Outstanding TODOs | Complete remaining work |

### 2.2 Root Cause Analysis

For each issue:
1. Locate the file and line
2. Understand why it's broken
3. Determine minimal fix
4. Check for related issues that share a fix

---

## PHASE 3: DECIDE

### 3.1 Fix Order

1. **P0**: Build errors → App must compile
2. **P1**: Critical 7 issues from KNOWN ISSUES
3. **P2**: High 10 issues
4. **P3**: Test failures
5. **P4**: Medium/Low issues
6. **P5**: Outstanding TODOs

### 3.2 Verification Plan

After each fix:
```bash
npm run build && npm run lint && echo "Quick check passed"
```

After each priority tier:
```bash
npm run build 2>&1 | tee .claude/build-output.log
npm run lint 2>&1 | tee .claude/lint-output.log
npm test 2>&1 | tee .claude/test-output.log || true
```

---

## PHASE 4: ACT

### 4.1 Execution Protocol

For EACH fix:
1. **State the issue** - What is broken, file:line
2. **State the fix** - What you're changing and why
3. **Make the change** - Edit minimum necessary code
4. **Verify** - Run quick check
5. **Update state file** - Mark issue as fixed

### 4.2 Verification Gates

After each priority tier:
```bash
# Full verification
npm run build 2>&1 | tee .claude/build-output.log
npm run lint 2>&1 | tee .claude/lint-output.log
npm test 2>&1 | tee .claude/test-output.log || true

# Progress check
echo "=== PROGRESS ==="
echo "Build errors: $(grep -c 'error' .claude/build-output.log 2>/dev/null || echo 0)"
echo "Lint errors: $(grep -c 'error' .claude/lint-output.log 2>/dev/null || echo 0)"
echo "Test failures: $(grep -c 'FAIL' .claude/test-output.log 2>/dev/null || echo 0)"
```

Gates (must pass to proceed):
- [ ] Build: 0 errors
- [ ] Lint: 0 errors
- [ ] Tests: 0 failures (or known env-dependent skips)

### 4.3 Checkpoint Commits

After completing each priority tier:

```bash
git add -A
git commit -m "fix(P0): resolve build blockers

- [list specific fixes]

OODA Loop Iteration X - P0 Complete"
```

Commit messages by tier:
- P0: `fix(P0): resolve build blockers`
- P1: `fix(P1): resolve critical issues`
- P2: `fix(P2): resolve high priority issues`
- P3: `fix(P3): resolve test failures`
- P4: `chore(P4): resolve medium/low issues`
- P5: `feat(P5): complete outstanding TODOs`

### 4.4 Cohesion Audit

After all fixes:
- [ ] All imports resolve (no broken paths)
- [ ] Module systems correct (.ts = ES, .cjs = CommonJS)
- [ ] All types consistent across boundaries
- [ ] All API contracts match frontend/backend
- [ ] Timestamps are UTC everywhere
- [ ] Logging uses structured format

---

## ITERATION RULES

### Continue if ANY:
- Build has errors
- Lint has errors
- Tests failing (not env-dependent)
- Known Critical/High issues unfixed
- App crashes at runtime

### Complete when ALL:
- Build succeeds (0 errors)
- Lint passes (0 errors)
- Tests pass (or only env-dependent skips)
- All Critical issues fixed
- All High issues fixed
- App runs without crashes

---

## COMPLETION SIGNAL

When ALL completion criteria are met, output:

```
<promise>APP COMPLETE</promise>
```

---

## STATE FILE

Create `.claude/` directory for persistent state:
```bash
mkdir -p .claude
echo "*.log" >> .claude/.gitignore
```

Maintain progress in `.claude/ooda-state.md` with:
- Current iteration number
- Current phase (OBSERVE/ORIENT/DECIDE/ACT)
- Issues discovered (with status: open/fixed/verified)
- Last action taken
- Next action planned

**First action each iteration**: Read `.claude/ooda-state.md` to resume where you left off.

---

## SELF-REFERENCE PROTOCOL

Since you see your previous work in files and git:
1. **Check state file first** - Don't repeat completed work
2. **Check git log** - See what you already committed
3. **Verify previous fixes still work** - Regressions can occur
4. **Update state file after each action** - Future iterations need context

---

## CONSTRAINTS

- **Minimal changes**: Fix issues, don't refactor unnecessarily
- **Preserve intent**: Don't change behavior, only fix broken behavior
- **Follow patterns**: Use existing code patterns, not new ones
- **No new features**: Complete what exists, don't add what doesn't
- **Verify everything**: Never assume a fix works - always run checks

---

Begin by reading `.claude/ooda-state.md` (or creating it if this is iteration 1).
