# BMSview AI Coding Agent Instructions

## Project Overview
BMSview is a **Battery Management System (BMS) screenshot analysis tool** built with React + TypeScript (frontend) and Netlify Functions (serverless backend). It uses Google Gemini AI to extract battery metrics from images, integrates solar charging estimates, and tracks battery performance over time.

## Architecture & Data Flow

### Frontend: React + Vite
- **Entry points**: `index.html` (main app) and `admin.html` (admin dashboard)
- **State management**: Context API with reducers in `state/appState.tsx` and `state/adminState.tsx`
- **Path aliases**: Use `components/*`, `services/*`, `state/*`, `hooks/*`, `utils/*` (configured in `vite.config.ts` and `tsconfig.json`)
- **Build**: `npm run build` outputs to `dist/`

### Backend: Netlify Functions (Node.js CommonJS)
- **Location**: `netlify/functions/*.cjs`
- **Key functions**:
  - `analyze.cjs` - BMS image analysis (supports sync mode with `?sync=true`)
  - `generate-insights-with-tools.cjs` - AI-powered insights using Gemini 2.5 Flash
  - `solar-estimate.ts` - Solar energy estimation proxy (TypeScript, bundled separately)
  - `history.cjs` - Analysis history with pagination
  - `systems.cjs` - BMS system registration and management
- **Utilities**: `netlify/functions/utils/*.cjs` (logger, MongoDB, retry logic, validation, analysis pipeline)

### Data Flow
1. User uploads BMS screenshot → `UploadSection.tsx`
2. Frontend calls `/.netlify/functions/analyze?sync=true` via `geminiService.ts`
3. Backend (`analyze.cjs`) uses `analysis-pipeline.cjs` to:
   - Call Gemini API via `geminiClient.cjs` for data extraction
   - Detect duplicates using SHA-256 content hashing
   - Fetch weather data for location/timestamp
   - Save to MongoDB `analysis-results` collection
4. Results displayed in `AnalysisResult.tsx` with linking to registered BMS systems

## Critical Development Patterns

### 1. Module System Separation
- **Frontend (.ts/.tsx)**: ES modules (`import/export`)
- **Backend (.cjs)**: CommonJS (`require()/module.exports`)
- **Never mix**: Don't use `require()` in frontend or `import` in `.cjs` files
- **Exception**: `solar-estimate.ts` is TypeScript (bundled for Netlify)

### 2. MongoDB Collections & Schema
**Collections** (database name: `bmsview` or from `MONGODB_DB_NAME`):
- `analysis-results` - Analysis records with deduplication hashes
- `systems` - Registered BMS systems with associated DL numbers
- `history` - Legacy analysis history (paginated responses)
- `idempotent-requests` - Request/response caching for idempotency
- `progress-events` - Legacy job progress tracking (mostly unused after sync mode migration)

**Connection pattern**: Use `getCollection('collectionName')` from `utils/mongodb.cjs` (handles pooling, retries, health checks)

### 3. Logging Strategy
**Structured JSON logging** everywhere:
```javascript
const log = createLogger('function-name', context);
log.info('Message', { key: value });  // Use log levels: info, warn, error, debug
```
- Frontend: `console.log(JSON.stringify({ level, timestamp, message, context }))`
- Backend: `createLogger` from `utils/logger.cjs`

### 4. Error Handling & Retries
- **Retry wrapper**: `createRetryWrapper(log)` from `utils/retry.cjs` for transient failures
- **Circuit breaker**: `circuitBreaker()` prevents cascading failures
- **Timeouts**: `withTimeout()` wraps promises with configurable timeouts
- **Error responses**: Use `errorResponse(statusCode, code, message, details, headers)` from `utils/errors.cjs`

### 5. Analysis Pipeline (Synchronous Mode)
**Old architecture** (deprecated): Job-based async processing with `job-shepherd.cjs`
**Current architecture**: Synchronous analysis via `?sync=true` query parameter
- No job polling (`useJobPolling` hook is commented out in `App.tsx`)
- Direct response from `analyze.cjs` with full `AnalysisRecord`
- Duplicate detection via content hashing (SHA-256 of image base64)

## Environment Variables

### Required
- `GEMINI_API_KEY` - Google Gemini API key (for AI analysis)
- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB_NAME` or `MONGODB_DB` - Database name (default: `bmsview`)

### Optional
- `GEMINI_MODEL` - Gemini model name (default: `gemini-2.5-flash`)
- `LOG_LEVEL` - `INFO` (production) or `DEBUG` (development)
- `URL` - Netlify deployment URL (auto-set in production)

## Common Commands

```bash
# Development
npm run dev              # Start Vite dev server (port 5173)
netlify dev              # Start Netlify dev server with functions (port 8888)

# Testing
npm test                 # Run Jest tests
npm run test:coverage    # Generate coverage report

# Build
npm run build            # Production build (outputs to dist/)
npm run preview          # Preview production build locally

# Linting
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
```

## Key Type Definitions (`types.ts`)

```typescript
AnalysisData          // Extracted BMS metrics (voltage, current, SOC, cell voltages, etc.)
BmsSystem             // Registered system (chemistry, capacity, location, associated DLs)
AnalysisRecord        // Saved analysis with timestamp, systemId, weather data
DisplayableAnalysisResult // UI state for analysis results (includes loading/error states)
WeatherData           // Cached weather info (temp, clouds, UVI)
```

## Solar Integration

- **Components**: `SolarIntegrationDashboard.tsx`, `SolarEstimatePanel.tsx`, `SolarEfficiencyChart.tsx`
- **Service**: `solarService.ts` (calls `/.netlify/functions/solar-estimate`)
- **Backend**: `solar-estimate.ts` (TypeScript proxy to Solar Charge Estimator API)
- **Correlation logic**: `utils/solarCorrelation.ts` compares expected solar vs actual battery charging

## Testing Conventions

- **Mocks**: `tests/mocks/mongodb.mock.js` provides in-memory MongoDB for tests
- **Timeouts**: Use short timeouts (100ms) in tests, not production values
- **No global assertions**: Avoid `afterEach(() => expect(console.error).not.toHaveBeenCalled())` - breaks error tests

## State Management Pattern

**Reducer-based context** (see `state/appState.tsx`):
```typescript
const { state, dispatch } = useAppState();
dispatch({ type: 'SYNC_ANALYSIS_COMPLETE', payload: { fileName, record, isDuplicate } });
```

**Key actions**:
- `PREPARE_ANALYSIS` - Initialize analysis UI state
- `SYNC_ANALYSIS_COMPLETE` - Handle successful analysis
- `SET_ERROR` - Handle errors
- `FETCH_DATA_SUCCESS` - Load systems/history

## Anti-Patterns to Avoid

1. **Don't create job-based analysis flows** - Use synchronous `?sync=true` mode
2. **Don't use `require()` in frontend** - ES modules only
3. **Don't manually create MongoDB clients** - Use `getCollection()` helper
4. **Don't skip logging** - All critical operations must log with context
5. **Don't ignore duplicate detection** - Check `_isDuplicate` flag in `AnalysisData`
6. **Don't hardcode model names** - Use `process.env.GEMINI_MODEL` with fallback to `gemini-2.5-flash`

## Recent Migration Notes

- **Gemini 2.5 Flash**: Upgraded from older models (see `GEMINI_2.5_MIGRATION_COMPLETE.md`)
- **Sync analysis**: Migrated from job-based async to synchronous processing
- **Path aliases**: Fixed import resolution issues (Oct 2025) - use configured aliases consistently
- **MongoDB pooling**: Optimized connection pooling (reduced pool size 10→5 to prevent overload)

## When in Doubt

1. Check existing patterns in `CODEBASE_PATTERNS_AND_BEST_PRACTICES.md`
2. Look at similar functions/components for reference
3. Use structured logging to debug issues
4. Test with `npm test` before committing
5. Verify build succeeds with `npm run build`
