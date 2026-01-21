# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Project**: BMSview - Battery Management System screenshot analysis tool with AI insights and solar integration
**Tech Stack**: React 18 + TypeScript (frontend), Netlify Functions (backend), MongoDB, Google Gemini AI
**Node Version**: 20+

### Essential Commands

```bash
# Development
netlify dev              # ⭐ USE THIS - Runs frontend + backend with functions (port 8888)
npm run dev             # Frontend only (port 5173, no Netlify functions)

# Testing & Quality
npm test                # Run Jest tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix

# Build
npm run build          # Production build (outputs to dist/)
npm run preview        # Preview production build locally

# Data
npm run seed:monitoring  # Seed monitoring data for development
```

### Critical Knowledge

- **Dual entry points**: `index.html` (main app) and `admin.html` (admin dashboard with OAuth)
- **Module systems**: Frontend uses ES modules, backend `.cjs` files use CommonJS (NEVER mix)
- **Path aliases**: Frontend has `@`, `components`, `services`, `state`, `hooks`, `utils` aliases (see `vite.config.ts` and `tsconfig.json`)
- **Solar integration**: Comprehensive estimation + battery charging correlation (see `docs/features/solar/SOLAR_INTEGRATION_GUIDE.md`)
- **Insights generation**: Gemini with ReAct loop and function calling for complex analysis (see `docs/features/insights/REACT_LOOP_README.md`)

---

## Architecture Overview

### Directory Structure

```
BMSview/
├── index.html, admin.html        # Dual entry points
├── types.ts                       # Central TypeScript definitions
├── src/
│   ├── components/                # React components (use path aliases!)
│   │   ├── UploadSection.tsx      # BMS image upload
│   │   ├── AnalysisResult.tsx     # Analysis display
│   │   ├── AdminDashboard.tsx     # Admin interface
│   │   ├── SolarIntegrationDashboard.tsx
│   │   ├── DiagnosticsPanel.tsx
│   │   └── admin/                 # Admin-specific components
│   ├── services/                  # API clients
│   │   ├── geminiService.ts       # Gemini API integration
│   │   ├── solarService.ts        # Solar estimation
│   │   └── weatherService.ts      # Weather data
│   ├── state/                     # Context + reducers
│   │   ├── appState.tsx           # Main app state
│   │   └── adminState.tsx         # Admin state
│   ├── hooks/                     # Custom React hooks
│   ├── utils/                     # Frontend utilities (solarCorrelation.ts, etc.)
│   ├── App.tsx                    # Main app component
│   ├── admin.tsx                  # Admin app component
│   └── index.tsx                  # React mount point
├── netlify/functions/             # Serverless backend (CommonJS .cjs)
│   ├── analyze.cjs                # ⭐ Main BMS analysis endpoint
│   ├── generate-insights-with-tools.cjs  # AI insights with function calling
│   ├── generate-insights-background.mjs  # Async Workload for long-running insights
│   ├── solar-estimate.ts          # Solar proxy (TypeScript exception, bundled)
│   ├── history.cjs                # Analysis history endpoint
│   ├── systems.cjs                # BMS system management
│   ├── admin-diagnostics.cjs      # Admin diagnostics endpoint
│   ├── sync-incremental.cjs       # Local-first sync endpoint
│   └── utils/
│       ├── mongodb.cjs            # ⭐ DB connection + pooling
│       ├── logger.cjs             # ⭐ Structured JSON logging
│       ├── geminiClient.cjs       # Gemini API wrapper + circuit breaker
│       ├── gemini-tools.cjs       # Function definitions for Gemini
│       ├── analysis-pipeline.cjs  # Analysis orchestration + deduplication
│       ├── retry.cjs              # Retry + circuit breaker logic
│       └── validation.cjs         # Input validation utilities
├── tests/                         # Jest tests
├── docs/                          # Comprehensive documentation
│   ├── features/                  # Feature guides
│   ├── admin-diagnostics/         # Admin panel docs
│   ├── architecture/              # Architecture docs
│   └── archive/                   # Historical documentation
└── vite.config.ts, tsconfig.json  # Build configuration with path aliases
```

### Data Flow (Analysis Pipeline)

1. **Upload**: User uploads BMS screenshot via `UploadSection.tsx`
2. **Frontend calls**: `geminiService.ts` → `/.netlify/functions/analyze?sync=true`
3. **Backend processing** (`analyze.cjs`):
   - Calls `analysis-pipeline.cjs` for orchestration
   - Uses `geminiClient.cjs` to extract BMS metrics via Gemini
   - Detects duplicates via SHA-256 content hashing
   - Fetches weather data for location/timestamp
   - Saves to MongoDB `analysis-results` collection
4. **Display**: Results shown in `AnalysisResult.tsx` with system linking

### Data Flow (AI Insights)

1. **User initiates**: Clicks "Get Insights" or similar action
2. **Frontend calls**: `/.netlify/functions/generate-insights-with-tools`
3. **Backend processing** (`generate-insights-with-tools.cjs`):
   - Decides sync (short queries) vs background mode (long queries)
   - **Sync mode** (<55s): Direct response
   - **Background mode** (>60s): Netlify Async Workload (`generate-insights-background.mjs`)
4. **Function calling**: Gemini uses `gemini-tools.cjs` definitions to request:
   - Specific BMS data (time ranges, metrics)
   - Weather information
   - Solar efficiency data
   - Analytics summaries
5. **Response**: Multi-turn conversation until Gemini outputs final insights

---

## Critical Development Patterns

### 1. Module System (STRICT ENFORCEMENT)

**Frontend (.ts/.tsx)**: ES modules ONLY
```typescript
import { type AnalysisRecord } from 'types/analysis';
import { AppState } from 'state/appState';
export const MyComponent = () => { ... };
```

**Backend (.cjs)**: CommonJS ONLY
```javascript
const { getCollection } = require('./utils/mongodb.cjs');
module.exports = { handler: async (event, context) => { ... } };
```

**Exception**: `solar-estimate.ts` is TypeScript (bundled separately for Netlify)

### 2. Path Aliases (Frontend Only)

Always use configured aliases instead of relative paths:
```typescript
✅ import { Header } from 'components/Header';
✅ import { useAppState } from 'hooks/useAppState';
❌ import { Header } from '../components/Header';
```

Aliases defined in `vite.config.ts` and `tsconfig.json`:
- `@/*` → `./src/*`
- `components/*` → `./src/components/*`
- `services/*` → `./src/services/*`
- `state/*` → `./src/state/*`
- `hooks/*` → `./src/hooks/*`
- `utils/*` → `./src/utils/*`
- `@types/*` → `./src/types/*`

### 3. Logging (Structured JSON)

**Frontend**:
```typescript
console.log(JSON.stringify({
  level: 'info',
  timestamp: new Date().toISOString(),
  message: 'Description',
  context: { key: value }
}));
```

**Backend**:
```javascript
const { createLogger } = require('./utils/logger.cjs');
const log = createLogger('function-name', context);
log.info('Message', { key: value });  // info, warn, error, debug
```

### 4. MongoDB Connection Pattern

Always use the connection helper:
```javascript
const { getCollection } = require('./utils/mongodb.cjs');
const collection = await getCollection('analysis-results');
const docs = await collection.find({ ... }).toArray();
```

**Collections** (database: `bmsview` or from `MONGODB_DB_NAME`):
- `analysis-results` - BMS analysis records with SHA-256 dedup hashes
- `systems` - Registered BMS systems with DL numbers
- `history` - Legacy analysis history
- `idempotent-requests` - Request/response cache
- `insights-jobs` - Background job tracking
- `progress-events` - Legacy job progress (mostly unused)

**Pool configuration**: Reduced to 5 connections (from 10) to prevent overload. Health checks every 60s.

### 5. Error Handling & Retries

**Retry wrapper**:
```javascript
const { createRetryWrapper } = require('./utils/retry.cjs');
const retryFetch = createRetryWrapper(log);
const response = await retryFetch(async () => fetchData());
```

**Circuit breaker** (Gemini client):
- `CLOSED` (normal): Requests pass through
- `OPEN` (failing): After 5 failures, rejects for 60s
- `HALF_OPEN` (testing): After timeout, allows 3 test requests

**Error response helper**:
```javascript
const { errorResponse } = require('./utils/errors.cjs');
return errorResponse(statusCode, code, message, details, headers);
```

### 6. Analysis Pipeline (Synchronous Mode)

Current architecture uses synchronous analysis via `?sync=true`:
- No job polling (legacy functions `job-shepherd.cjs`, `process-analysis.cjs` are deprecated)
- Direct response from `analyze.cjs` with full `AnalysisRecord`
- Duplicate detection via SHA-256 hashing
- ⚠️ **DO NOT CREATE JOB-BASED FLOWS** - Use sync mode

### 7. AI Insights with Function Calling (Gemini 2.5 Flash)

**Battery Guru** features:
- Supports sync (queries <55s) and background modes (>60s)
- Multi-turn conversation with function calling
- Max 10 tool call iterations, 25s per iteration, 58s total
- Functions defined in `gemini-tools.cjs`

**Alert event grouping**: Consecutive alerts at same threshold = one event with duration tracking
- Example: 30 screenshots showing "Low battery: 18.6%" from 2am-6am = ONE 4-hour event, not 30

**Solar variance interpretation**: Delta between expected and actual charge often represents daytime load, not solar underperformance
- Expected solar - Actual recovered = daytime consumption
- Only flag solar issues when variance >15% AND weather was favorable

**Data context**: 90-day rollups (max 90 daily records with hourly averages) preloaded for analysis

**Terminology precision**:
- "Battery autonomy" / "runtime" = days until discharge at current load
- "Service life" / "lifetime" = months/years until replacement
- NEVER confuse these concepts

### 8. GitHub Integration Tools (in Gemini prompts)

Three new codebase access tools available:

- **`searchGitHubIssues`**: Search existing GitHub issues before creating (duplicate prevention)
- **`getCodebaseFile`**: Fetch file contents to verify implementation
- **`listDirectory`**: Discover files in directories

Security: Path allowlist, no `.env`/`.git`/`node_modules` access, 15KB file limit

---

## Key Type Definitions

All types centralized in `src/types.ts`:

- **`AnalysisData`** - Extracted BMS metrics (voltage, current, SOC, cell voltages, temperature, alerts)
- **`BmsSystem`** - Registered system (chemistry, capacity, location, associated DL numbers)
- **`AnalysisRecord`** - Saved analysis (timestamp, systemId, dedup hash, weather data)
- **`DisplayableAnalysisResult`** - UI state (loading/error states, display formatting)
- **`WeatherData`** - Location-based weather (temperature, clouds, UVI, irradiance)
- **`SolarData`** - Solar estimation results (expected charge, efficiency metrics)

---

## Testing

**Configuration** (`jest.config.cjs`):
- Root: `tests/`
- Timeout: 30s
- Environment: jsdom
- Transform: babel-jest with ES module + CommonJS support

**Mock pattern** (`tests/mocks/mongodb.mock.js`): In-memory MongoDB for tests

**Run tests**:
```bash
npm test                # Full suite
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report (40% threshold)
```

**Guidelines**:
- Create test files in `tests/` with `.test.js` extension
- Mock external APIs (Gemini, weather) to avoid real calls
- Use short timeouts (100ms) in tests, not production values
- Test both success and error cases

---

## State Management

**Pattern**: React Context + reducers in `src/state/`

**Main state** (`appState.tsx`):
```typescript
const { state, dispatch } = useAppState();
dispatch({
  type: 'SYNC_ANALYSIS_COMPLETE',
  payload: { fileName, record, isDuplicate }
});
```

**Key actions**:
- `PREPARE_ANALYSIS` - Initialize analysis UI state
- `SYNC_ANALYSIS_COMPLETE` - Handle successful analysis
- `SET_ERROR` - Handle errors
- `FETCH_DATA_SUCCESS` - Load systems/history
- `UPDATE_SYSTEMS` - Update registered systems

**Admin state** (`adminState.tsx`): Manages admin-specific UI and data

---

## Important Implementation Notes

### Anti-Patterns to AVOID

1. ❌ Job-based analysis flows - Always use `?sync=true`
2. ❌ `require()` in frontend code - ES modules only
3. ❌ Manual MongoDB clients - Always use `getCollection()` helper
4. ❌ Skip logging - Log all critical operations
5. ❌ Ignore duplicate detection - Check `_isDuplicate` flag
6. ❌ Hardcode model names - Use `process.env.GEMINI_MODEL` with fallback
7. ❌ Count alerts per screenshot - Group into time-based events
8. ❌ Misinterpret solar variance - Delta often equals daytime load
9. ❌ Include redundant insights - Don't repeat metrics already shown in UI
10. ❌ Confuse battery autonomy with service life - Two distinct concepts
11. ❌ Static error messages - Always include actual error details and context
12. ❌ Retry spam in UI - Keep retries silent, use calm progress indicators
13. ❌ Add auth checks in admin functions - Security is page-level OAuth only

### Solar Integration Features

- **Components**: `SolarIntegrationDashboard.tsx`, `SolarEstimatePanel.tsx`, `SolarEfficiencyChart.tsx`
- **Service**: `solarService.ts` (calls `/.netlify/functions/solar-estimate`)
- **Backend**: `solar-estimate.ts` (TypeScript proxy to Solar Charge Estimator API)
- **Correlation**: `utils/solarCorrelation.ts` compares expected vs actual charging
- **Full guide**: `docs/features/solar/SOLAR_INTEGRATION_GUIDE.md`

### Insights Generation Architecture

- **Main function**: `generate-insights-with-tools.cjs`
- **Background handler**: `generate-insights-background.mjs` (Netlify Async Workload)
- **Tools definition**: `netlify/functions/utils/gemini-tools.cjs`
- **Full guide**: `docs/features/insights/REACT_LOOP_README.md`

### Admin Dashboard & OAuth

- **Entry point**: `admin.html`
- **Component**: `AdminDashboard.tsx`
- **State**: `adminState.tsx`
- **Page-level security**: OAuth required to load `admin.html` (NO per-function auth checks needed)
- **Diagnostics**: `admin-diagnostics.cjs` endpoint with comprehensive health checks
- **Guide**: `docs/admin-diagnostics/ADMIN_DIAGNOSTICS_GUIDE.md`

### Local-First Sync

- **Fresh fields**: `updatedAt` (ISO 8601) and `_syncStatus` on all collections
- **Endpoint**: `sync-incremental.cjs` for incremental fetches
- **Migration**: Run backup first, then trigger migration function
- **Guide**: `docs/architecture/SYNC_INTEGRATION_GUIDE.md`

---

## Environment Variables

### Required
- `GEMINI_API_KEY` - Google Gemini API key
- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB_NAME` or `MONGODB_DB` - Database name (default: `bmsview`)

### Optional
- `GEMINI_MODEL` - Model name (default: `gemini-2.5-flash`)
- `LOG_LEVEL` - `INFO` (production) or `DEBUG` (development)
- `URL` - Netlify deployment URL (auto-set)

### Cost Management
- `AI_MONTHLY_TOKEN_BUDGET` - Token limit (default: 5M)
- `AI_MONTHLY_COST_BUDGET` - USD limit (default: $10)
- `AI_BUDGET_ALERT_THRESHOLD` - Alert threshold (default: 0.8)

---

## 🚨 CRITICAL: Estimation Policy

**ALL effort estimates MUST use LOC (Lines of Code) ONLY. NEVER estimate in time.**

### Estimation Rules (MANDATORY)

1. ✅ **ALWAYS estimate in LOC** (Lines of Code)
2. ❌ **NEVER estimate in hours, days, or weeks**
3. ✅ Estimates represent SCOPE of code changes needed
4. ❌ Duration varies by model capabilities - DO NOT predict time
5. ✅ Use LOC ranges for uncertainty (e.g., "200-300 LOC")
6. ❌ DO NOT convert LOC to time under any circumstances

### Example Estimates (CORRECT)

```
✅ "This feature requires approximately 350-450 LOC"
✅ "Backend changes: ~200 LOC, Frontend: ~150 LOC"
✅ "Small task, estimated 50-75 LOC"

❌ "This will take 2-3 hours"
❌ "About 1 day of work"
❌ "350 LOC, approximately 4 hours"
```

### Why LOC-Only?

- Time estimates vary wildly by AI model, developer skill, and familiarity
- LOC provides objective scope measurement
- Avoids misleading time predictions
- Focuses on WHAT needs to be done, not HOW LONG

**This policy applies to ALL planning documents, status reports, and communications.**

---

## Common Development Workflows

### Adding a React Component

1. Create file in `src/components/` with PascalCase name
2. Use functional component + TypeScript
3. Import types from `types.ts`
4. Use path aliases for imports
5. Style with Tailwind CSS
6. Add test in `tests/` if logic-heavy

### Adding a Netlify Function

1. Create `.cjs` file in `netlify/functions/`
2. Use CommonJS (`require`/`module.exports`)
3. Import logger: `const { createLogger } = require('./utils/logger.cjs');`
4. Structure: `exports.handler = async (event, context) => { ... }`
5. Return HTTP response: `{ statusCode, body: JSON.stringify(data) }`
6. Add error handling with structured logging

### Debugging Production Issues

1. Check Netlify function logs for errors
2. Verify environment variables in Netlify dashboard
3. Test locally with `netlify dev` (mimics production)
4. Review MongoDB queries in collections
5. Check Gemini API usage/rate limits
6. Validate frontend state with React DevTools
7. Review structured JSON logs for context

### Updating Dependencies

1. Check security: `npm audit`
2. Update `package.json` version
3. Run `npm install`
4. Test: `npm test`, `npm run build`
5. Check package changelog for breaking changes
6. Update code if API changed
7. Document breaking changes in PR

---

## Documentation Reference

### Core Documentation
- **README.md** - Project overview and quick start
- **docs/DEVELOPMENT.md** - Development guide
- **docs/admin-diagnostics/ADMIN_DIAGNOSTICS_GUIDE.md** - Admin panel

### Feature Guides
- **docs/features/insights/REACT_LOOP_README.md** - AI insights with function calling
- **docs/features/solar/SOLAR_INTEGRATION_GUIDE.md** - Solar correlation
- **docs/architecture/SYNC_INTEGRATION_GUIDE.md** - Local-first sync

### Technical References
- **docs/SYSTEM_DIAGNOSTICS.md** - Diagnostics endpoint
- **docs/release-notes/CHANGELOG.md** - Version history
- **docs/archive/** - Historical documentation

---

## Build & Deployment

**Build must succeed locally**:
```bash
npm run build
```

Netlify auto-deploys on push to GitHub. Environment variables configured in Netlify dashboard.

**Pre-push checklist**:
- [ ] Build passes (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] No `.cjs` files with ESM syntax
- [ ] All path aliases used correctly
