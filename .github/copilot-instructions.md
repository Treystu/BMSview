# BMSview AI Coding Agent Instructions

## 🚀 Quick Start Reference

**What is BMSview?** Battery Management System screenshot analysis tool using Google Gemini AI.

**Essential Commands:**
```bash
netlify dev        # Local dev with functions (port 8888) - USE THIS for full-stack dev
npm run dev        # Frontend only (port 5173)
npm test           # Run tests
npm run build      # Production build
```

**Critical Files to Know:**
- `types.ts` - All TypeScript type definitions
- `netlify/functions/analyze.cjs` - Main BMS analysis endpoint
- `state/appState.tsx` - Frontend state management
- `netlify/functions/utils/mongodb.cjs` - Database connection helper
- `netlify/functions/utils/logger.cjs` - Structured logging

**Module Systems (NEVER MIX!):**
- Frontend (`.ts/.tsx`): ES modules (`import/export`)
- Backend (`.cjs`): CommonJS (`require()/module.exports`)
- Exception: `solar-estimate.ts` (TypeScript, bundled for Netlify)

**Dual Entry Points:**
- `index.html` → Main BMS analysis app
- `admin.html` → Admin dashboard (system management, diagnostics)

**Path Aliases (Frontend Only):**
Both `vite.config.ts` and `tsconfig.json` define aliases - use them consistently:
```typescript
import { AppState } from 'state/appState';  // ✅ Correct
import { AppState } from '../state/appState';  // ❌ Avoid relative imports for aliased paths
```

---

## Project Overview
BMSview is a **Battery Management System (BMS) screenshot analysis tool** built with React + TypeScript (frontend) and Netlify Functions (serverless backend). It uses Google Gemini AI to extract battery metrics from images, integrates solar charging estimates, and tracks battery performance over time.

## Architecture & Data Flow

### File Organization

```
BMSview/
├── index.html, admin.html     # Entry points (main app + admin dashboard)
├── types.ts                   # Central type definitions
├── components/                # React components (use path alias: 'components/*')
│   ├── UploadSection.tsx      # BMS image upload
│   ├── AnalysisResult.tsx     # Analysis display
│   ├── AdminDashboard.tsx     # Admin interface
│   └── Solar*.tsx             # Solar integration components
├── services/                  # API clients (path alias: 'services/*')
│   ├── geminiService.ts       # Gemini API integration
│   ├── solarService.ts        # Solar estimation
│   └── weatherService.ts      # Weather data
├── state/                     # Context + reducers (path alias: 'state/*')
│   ├── appState.tsx           # Main app state
│   └── adminState.tsx         # Admin state
├── hooks/                     # Custom hooks (path alias: 'hooks/*')
├── utils/                     # Frontend utilities (path alias: 'utils/*')
└── netlify/functions/         # Serverless backend (CommonJS .cjs files)
    ├── analyze.cjs            # ⭐ Main BMS analysis endpoint
    ├── generate-insights-with-tools.cjs  # AI insights
    ├── solar-estimate.ts      # Solar proxy (TypeScript exception)
    ├── history.cjs            # Analysis history
    ├── systems.cjs            # System management
    └── utils/                 # Backend utilities
        ├── mongodb.cjs        # ⭐ Database connection
        ├── logger.cjs         # ⭐ Structured logging
        ├── analysis-pipeline.cjs  # Analysis orchestration
        ├── geminiClient.cjs   # Gemini API client
        └── retry.cjs          # Retry/circuit breaker logic
```

### Frontend: React + Vite
- **Entry points**: `index.html` (main app) and `admin.html` (admin dashboard)
- **State management**: Context API with reducers in `state/appState.tsx` and `state/adminState.tsx`
- **Path aliases**: Use `components/*`, `services/*`, `state/*`, `hooks/*`, `utils/*` (configured in `vite.config.ts` and `tsconfig.json`)
- **Build**: `npm run build` outputs to `dist/`

### Backend: Netlify Functions (Node.js CommonJS)
- **Location**: `netlify/functions/*.cjs`
- **Key functions**:
  - `analyze.cjs` - BMS image analysis (supports sync mode with `?sync=true`)
  - `generate-insights-with-tools.cjs` - AI "Battery Guru" with function calling (supports sync and background modes)
  - `generate-insights-background.cjs` - Long-running insights jobs (>60s)
  - `solar-estimate.ts` - Solar energy estimation proxy (TypeScript, bundled separately)
  - `history.cjs` - Analysis history with pagination
  - `systems.cjs` - BMS system registration and management
  - `admin-diagnostics.cjs` - System diagnostics and health checks
- **Utilities**: `netlify/functions/utils/*.cjs` (logger, MongoDB, retry logic, validation, analysis pipeline, insights jobs)

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
- `analysis-results` - Analysis records with deduplication hashes (SHA-256)
- `systems` - Registered BMS systems with associated DL numbers
- `history` - Legacy analysis history (paginated responses)
- `idempotent-requests` - Request/response caching for idempotency
- `progress-events` - Legacy job progress tracking (mostly unused after sync mode migration)
- `insights-jobs` - Background insights generation jobs (for queries >60s)

**Connection pattern**: Use `getCollection('collectionName')` from `utils/mongodb.cjs` (handles pooling, retries, health checks)

**Connection pooling**: Pool size reduced to 5 (from 10) to prevent MongoDB connection overload. Reuses connections aggressively with 60s health check intervals.

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

**Circuit Breaker Pattern:**
The circuit breaker protects against cascading failures when external services (like Gemini API) are unavailable.

States:
- `CLOSED` (normal): Requests pass through normally
- `OPEN` (failing): After 5 failures, rejects requests immediately for 60s
- `HALF_OPEN` (testing): After timeout, allows 3 test requests to verify recovery

Configuration (in `geminiClient.cjs`):
- `failureThreshold`: 5 failures before opening circuit
- `resetTimeout`: 60 seconds before transitioning to HALF_OPEN
- `halfOpenRequests`: 3 successful requests needed to close circuit

The insights generation (`react-loop.cjs`) handles circuit breaker errors by:
- Detecting `circuit_open` errors
- Waiting 10s for the circuit to transition
- Continuing retries silently (no user-visible retry spam)

### 5. Analysis Pipeline (Synchronous Mode)
**Old architecture** (deprecated): Job-based async processing with `job-shepherd.cjs` ⚠️ **DO NOT USE**
**Current architecture**: Synchronous analysis via `?sync=true` query parameter
- No job polling (`useJobPolling` hook is commented out in `App.tsx`)
- Direct response from `analyze.cjs` with full `AnalysisRecord`
- Duplicate detection via content hashing (SHA-256 of image base64)
- Functions `job-shepherd.cjs`, `get-job-status.cjs`, `process-analysis.cjs` are **legacy/deprecated**

### 6. AI Insights with Function Calling
**Battery Guru** (`generate-insights-with-tools.cjs`) uses Gemini 2.5 Flash with structured function calling:
- Supports both sync (queries <55s) and background modes (>60s)
- Multi-turn conversation: Gemini can request specific BMS data, weather, solar, and analytics
- Implements tool definitions following Gemini's recommended pattern
- Background jobs use `insights-jobs.cjs` for state management and status polling
- Max 10 tool call iterations with 25s timeout per iteration, 58s total

**Critical Insights Behavior (Nov 2025 Updates):**
- **Alert Event Grouping**: Consecutive alerts at same threshold are grouped into single events with duration tracking, not counted per screenshot
- **Solar Variance Interpretation**: Delta between expected and actual charge represents daytime load consumption, NOT solar underperformance
  - Example: 220Ah expected, 58Ah recovered = 162Ah consumed by loads during day (8.3kWh @ 51.2V)
- **Redundant Sections Removed**: OPERATIONAL STATUS section eliminated from insights (already shown elsewhere)
- **90-Day Hourly/Daily Rollups**: Preloaded context now includes up to 90 daily records with hourly aggregations for comprehensive trend analysis
- **Terminology Precision**:
  - "Battery autonomy" / "days of autonomy" = RUNTIME until discharge at current load (from Energy Budget)
  - "Service life" / "lifetime" = YEARS/MONTHS until replacement due to degradation (from Predictive Outlook)
  - NEVER confuse these two distinct concepts
- **Daily Net Balance**: Detailed calculations show generator runtime recommendations (max charging amps ÷ Ah deficit)
- **Smart Recommendations**: Solar issues only flagged when variance exceeds tolerance AND weather conditions were favorable (correlate with cloud %, irradiance)

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
- **Test files**: Create in `tests/` with `.test.js` or `.simple.test.js` extension
- **Jest config**: `jest.config.cjs` with 30s timeout, Babel transform for ES modules/CommonJS
- **Timeouts**: Use short timeouts (100ms) in tests, not production values
- **No global assertions**: Avoid `afterEach(() => expect(console.error).not.toHaveBeenCalled())` - breaks error tests
- **Coverage**: Run `npm run test:coverage` to generate HTML coverage report

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
7. **Don't count alerts per screenshot** - Group consecutive alerts into time-based events with threshold recovery detection
8. **Don't misinterpret solar variance** - Remember: expected minus actual often equals daytime load, not solar deficiency
9. **Don't include redundant data in insights** - Current operational metrics are already displayed in the UI
10. **Don't confuse battery autonomy with service life** - One is runtime, the other is replacement timeline
11. **NEVER use static/hardcoded error messages** - All error messages must be dynamic and include:
    - Actual error details from the API (error code, status, message)
    - Current query context (time range, metrics requested)
    - Specific, actionable suggestions based on the actual failure mode
12. **Don't show retry spam to users** - Keep retries silent in the UI, log to console only
    - Use calm progress indicators instead of "attempt X/N" messages
    - Aggressive retries should happen in the background, invisible to users

## Error Handling Best Practices

When implementing error handling, follow these guidelines:

```typescript
// ❌ BAD - Static error message
throw new Error("This is a very complex query. Consider reducing the time range.");

// ✅ GOOD - Dynamic, contextual error message
throw new Error(
  `Analysis could not complete after ${attemptCount} attempts.\n\n` +
  `${errorReason}\n\n` +
  `Suggestions:\n${suggestions.map(s => `• ${s}`).join('\n')}`
);
```

**Error context should include:**
- HTTP status codes (404, 429, 503, etc.)
- Error codes from APIs (rate_limited, not_found, etc.)
- Actual query parameters (time range, system ID)
- Suggested actions based on the specific error type

## Recent Migration Notes

- **Gemini 2.5 Flash**: Upgraded from older models (see `GEMINI_2.5_MIGRATION_COMPLETE.md`)
- **Sync analysis**: Moved from job-based async to synchronous processing with `?sync=true`
- **Path aliases**: Fixed import resolution issues (Oct 2025) - use configured aliases consistently
- **MongoDB pooling**: Optimized connection pooling (reduced pool size 10→5 to prevent overload)
- **Function calling**: Enhanced insights generation with true function calling (multi-turn conversation)
- **Insights Logic Refinements (Nov 2025)**:
  - Alert event grouping with time-based consolidation and threshold recovery detection
  - Solar variance now correctly distinguishes generation from daytime load consumption
  - Removed redundant operational status from insights output
  - Added 90-day hourly/daily data rollups for comprehensive trend analysis
  - Enhanced admin panel with trending statistics and daily net balance tracking
  - Improved formatting and presentation of degradation/cycle count information

## Task Scoping and Suitability

### Ideal Tasks for AI Coding Agent
- **Bug fixes**: Well-defined issues with clear reproduction steps
- **Feature additions**: Specific, scoped enhancements with clear requirements
- **Refactoring**: Targeted code improvements (e.g., extract function, rename variable)
- **Test coverage**: Adding unit tests for existing functionality
- **Documentation updates**: README, API docs, inline comments
- **Dependency updates**: Package upgrades with compatibility checks
- **Code style fixes**: ESLint/Prettier violations

### Tasks Requiring Human Oversight
- **Architecture changes**: Major structural refactoring or design decisions
- **Security-critical code**: Authentication, authorization, data encryption
- **Performance optimization**: Requires profiling and benchmarking
- **Breaking changes**: API modifications affecting consumers
- **Complex business logic**: Domain-specific rules requiring expertise

### How to Write Good Issues for AI Coding Agent
1. **Clear title**: Describe the problem or goal concisely
2. **Context**: Explain why the change is needed
3. **Acceptance criteria**: Define what "done" looks like
4. **Scope guidance**: Specify which files or areas to modify
5. **Examples**: Provide sample inputs/outputs if applicable
6. **References**: Link to related issues, docs, or discussions

Example:
```
Title: Fix duplicate analysis detection for identical images

Context: Users uploading the same BMS screenshot twice aren't seeing duplicate warnings

Acceptance Criteria: SHA-256 hash comparison should flag identical images

Files to Modify:
- netlify/functions/utils/analysis-pipeline.cjs
- services/geminiService.ts

Testing:
Upload same screenshot twice, expect isDuplicate flag on second upload
```

## Security Guidelines

### Critical Security Practices
1. **Never commit secrets**: Use environment variables for API keys, credentials
2. **Validate all inputs**: Sanitize user inputs before processing (especially file uploads)
3. **Use parameterized queries**: Prevent MongoDB injection attacks
4. **Set security headers**: CORS, CSP, X-Frame-Options in Netlify functions
5. **Audit dependencies**: Check for known vulnerabilities before adding packages
6. **Implement rate limiting**: Protect API endpoints from abuse
7. **Log security events**: Track authentication failures, suspicious patterns

### Secure Coding Patterns in This Project
- **API keys**: All stored in environment variables (`GEMINI_API_KEY`, `MONGODB_URI`)
- **MongoDB connection**: Uses `getCollection()` helper with connection pooling
- **File uploads**: Base64 validation in `analyze.cjs` before processing
- **Error messages**: Don't expose sensitive details in production responses
- **Dependencies**: Run `npm audit` before adding new packages

### Security Checklist for Changes
- [ ] No hardcoded credentials or API keys
- [ ] Input validation for all user-supplied data
- [ ] Error handling doesn't leak sensitive information
- [ ] Dependencies checked for known vulnerabilities
- [ ] Authentication/authorization logic reviewed
- [ ] Security-related changes documented

## Review and Iteration Process

### Pull Request Guidelines
1. **Small, focused changes**: One issue per PR when possible
2. **Clear description**: Explain what changed and why
3. **Link to issue**: Reference the originating issue number
4. **Test evidence**: Show test results, screenshots for UI changes
5. **Breaking changes**: Clearly document any API changes

### Responding to Review Feedback
- Address feedback by mentioning `@copilot` in PR comments
- Provide context if disagreeing with a suggestion
- Ask clarifying questions if requirements are unclear
- Request re-review after making significant changes

### Self-Review Checklist
Before marking a PR ready for review or completing a sprint:
- [ ] **Code builds without errors (`npm run build`)** - **MANDATORY - Netlify deployment will fail without this**
- [ ] All tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] All .cjs files have valid syntax (no ESM imports/exports)
- [ ] No console.log statements left in production code
- [ ] Documentation updated if public APIs changed
- [ ] No temporary/debug files committed
- [ ] Git history is clean (no merge commits if rebase was needed)

**⚠️ CRITICAL BUILD REQUIREMENT**: Always run `npm run build` before completing any task. Netlify bundler will fail if there are syntax errors, module system conflicts, or other build issues. The build must succeed locally before pushing changes.

## Common Development Workflows

### Adding a New React Component
1. Create file in `components/` with PascalCase name (e.g., `NewFeature.tsx`)
2. Use functional component with TypeScript
3. Import types from `types.ts` or create in component if specific
4. Add to appropriate parent component import
5. Style with Tailwind CSS classes (existing pattern)
6. Add unit test in `tests/` if component has logic

### Adding a New Netlify Function
1. Create `.cjs` file in `netlify/functions/`
2. Use CommonJS (`require`/`module.exports`)
3. Import logger: `const { createLogger } = require('./utils/logger.cjs');`
4. Structure: exports.handler = async (event, context) => { ... }
5. Return proper HTTP response: `{ statusCode, body: JSON.stringify(data) }`
6. Add error handling with structured logging
7. Test manually via `netlify dev` or unit test in `tests/`

### Updating Dependencies
1. Check for security advisories: `npm audit`
2. Update package.json version
3. Run `npm install`
4. Test thoroughly (`npm test`, `npm run build`)
5. Check for breaking changes in package changelog
6. Update code if API changed
7. Document breaking changes in PR description

### Debugging Production Issues
1. Check Netlify function logs for errors
2. Verify environment variables are set correctly
3. Test locally with `netlify dev` (mimics production)
4. Review MongoDB queries in `analysis-results` collection
5. Check Gemini API usage/rate limits
6. Validate frontend state with React DevTools
7. Review structured JSON logs for error context

### Adding Tests
1. Create test file in `tests/` with `.test.js` extension
2. Import function to test and mocks from `tests/mocks/`
3. Use Jest matchers: `expect(result).toBe(expected)`
4. Mock MongoDB with `mongodb.mock.js` helper
5. Mock external APIs (Gemini, weather) to avoid real calls
6. Test both success and error cases
7. Run with `npm test` or `npm run test:watch`

## When in Doubt

1. Check existing patterns in `CODEBASE_PATTERNS_AND_BEST_PRACTICES.md`
2. Look at similar functions/components for reference
3. Use structured logging to debug issues
4. Test with `npm test` before committing
5. Verify build succeeds with `npm run build`
6. Review this instructions file for project-specific guidance
7. Ask for clarification if requirements are ambiguous

## AI Insights Generation Best Practices

### Alert Event Grouping Logic
When processing battery alerts for insights:
- **Group consecutive alerts**: Multiple screenshots showing same alert = one event until threshold recovery
- **Track event duration**: Estimate using time-of-day context (e.g., low battery at night likely clears when sun comes up)
- **Threshold recovery inference**: If alert threshold is 20%, next reading >20% means event ended
- **Time gaps matter**: Hours between screenshots may hide alert recovery - use solar/time context to infer
- **Example**: 30 screenshots with "Low battery: 18.6%" from 2am-6am = ONE 4-hour event, not 30 events

### Solar Variance Interpretation
The key insight: **Solar variance often represents daytime load, not solar underperformance**
- **Expected solar**: Based on irradiance model and max charging amps
- **Actual charge recovered**: Net charge added to battery (after loads)
- **The delta**: Expected - Actual = daytime load consumption
- **Example calculation**:
  - Expected: 220Ah @ 51.2V = 11.3kWh
  - Recovered: 58Ah @ 51.2V = 3.0kWh  
  - Delta: 162Ah = 8.3kWh consumed by loads during charging hours
- **Only flag solar issues when**: Variance exceeds tolerance (±15%) AND weather was favorable (low cloud %, high irradiance)

### Data Context for Gemini
Structure preloaded context for comprehensive analysis:
- **90-day rollups**: Maximum 90 daily records, each with up to 24 hourly averages
- **Efficient aggregation**: Daily averages for quick patterns, hourly breakdowns for detailed analysis
- **Include all metrics**: SOC, voltage, current, power, temperature, alerts per time bucket
- **Metadata matters**: Data quality indicators (sample count, coverage %) help Gemini assess reliability
- **ReAct loop ready**: Gemini can request additional specific data via `request_bms_data` tool

### Insights Output Format Rules
Keep insights actionable and avoid redundancy:
- **Remove OPERATIONAL STATUS**: Current voltage/SOC/current already shown in UI - don't repeat in insights
- **Lead with KEY FINDINGS**: 2-4 critical bullets with bold labels, cite sources inline
- **Be precise with terminology**:
  - Battery autonomy / runtime = days until discharge at current load
  - Service life / lifetime = months/years until replacement threshold
- **Format professionally**: Clean markdown, no broken formatting in cycle count or degradation sections
- **Cite data sources inline**: "Solar deficit 15Ah (weather data + BMS logs)" not separate attribution sections

### Daily Net Balance & Generator Recommendations
Provide actionable generator runtime guidance:
- **Calculate net balance**: Total daily generation minus total daily consumption
- **Show the math**: If -25.2Ah deficit, show calculation: 25.2Ah ÷ max generator amps = hours needed
- **Context aware**: Correlate with weather - deficit on cloudy day may not indicate problem
- **Track trends**: Show in both insights and admin panel for long-term planning
- **Example output**: "Daily deficit: 25.2Ah. At 60A generator charging, run for 25min to compensate."
