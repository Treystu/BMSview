---
# Fill in the fields below to create a basic custom agent for your repository.
# The Copilot CLI can be used for local testing: https://gh.io/customagents/cli
# To make this agent available, merge this file into the default repository branch.
# For format details, see: https://gh.io/customagents/config

name: "BMSView Agent"
description: "Expert Agent for BMSView Repo"
---

# My Agent


# BMSview AI Coding Agent Instructions
v2 – Full Context Mode / Insights / Admin / Monitoring–Aware

---

## 🚀 Quick Start Reference

**What is BMSview?**  
BMSview is a Battery Management System (BMS) screenshot analysis platform that:

- Extracts structured BMS data from screenshots using Google Gemini.
- Correlates with weather and solar data for deeper insights.
- Provides rich historical analysis, diagnostics, and “Battery Guru” insights.
- Includes a Full Context Mode AI feedback system that analyzes the *app itself* (architecture, behavior, and logs) to propose improvements.
- Exposes an OAuth-protected admin dashboard for diagnostics, monitoring, system management, and AI-driven app feedback.

### Core Commands

```bash
# Frontend only (fast UI dev)
npm run dev           # Vite dev server on port 5173

# Full stack (frontend + Netlify Functions)
netlify dev           # Local Netlify dev with functions on port 8888

# Testing
npm test              # Jest-based test suite
npm run test:coverage # Coverage report

# Production build
npm run build         # Builds frontend (and validates TS) to dist/
npm run preview       # Preview production build locally
```

### Critical Files to Know

**Top-level:**

- `README.md` – High-level overview and usage.
- `ARCHITECTURE.md` – End-to-end architecture, flows, and major components.
- `CODEBASE.md` – Codebase structure and quick mental model.
- `TESTING.md` & `TESTING_INFRASTRUCTURE_SUMMARY.md` – Testing strategies and infra.
- `DEPLOYMENT_CHECKLIST.md`, `DEPLOYMENT_READY.md` – Deployment details and preflight checks.
- `STATE_MANAGEMENT_GUIDE.md` – React state patterns used in this repo.
- `SOLAR_INTEGRATION_GUIDE.md`, `HOURLY_CLOUD_SOLAR_INTEGRATION.md` – Solar/weather integration behavior.
- `MONITORING_README.md`, `MONITORING_OBSERVABILITY.md`, `MONITORING_INTEGRATION_EXAMPLES.md`, `MONITORING_IMPLEMENTATION_SUMMARY.md` – Observability and monitoring patterns.
- `SYSTEM_DIAGNOSTICS.md`, `ADMIN_DIAGNOSTICS_*.md` – Admin diagnostics design and behavior.
- `FULL_CONTEXT_MODE.md`, `FULL_CONTEXT_MODE_IMPLEMENTATION_COMPLETE.md` – Full Context Mode and AI feedback system.
- `AI_FEEDBACK_DOCUMENTATION_COMPLETE.md`, `AI_FEEDBACK_SYSTEM_ISSUES.md`, `docs/AI_FEEDBACK_QUICK_REFERENCE.md` – AI feedback system behavior, constraints, and issues.
- `GENERATE_INSIGHTS_ARCHITECTURE.md`, `GENERATE_INSIGHTS_IMPLEMENTATION_SUMMARY.md`, `GENERATE_INSIGHTS_OPTIMIZATION_SUMMARY.md`, `INSIGHTS_*` docs – Insights system architecture and iterative refinements.
- `ERROR_HANDLING_RESILIENCE.md`, `ERROR_HANDLING_IMPLEMENTATION_SUMMARY.md` – Error handling and resilience patterns.
- `TIMEOUT_FIX_COMPREHENSIVE.md`, `INSIGHTS_TIMEOUT_FIX.md`, `ZERO_TIMEOUT_VERIFICATION.md` – Timeout strategies for Netlify + Gemini.

**Config & Tooling:**

- `package.json`, `package-lock.json` – Scripts, dependencies.
- `vite.config.ts` – Vite config and **TS path aliases**.
- `tsconfig.json` – TypeScript setup + path mappings.
- `jest.config.cjs`, `babel.config.cjs` – Test configuration and transforms.
- `netlify.toml` – Netlify function routing, environment, build configuration.
- `.env.example`, `.env.test` – Environment variable examples.
- `tailwind.config.js`, `index.css` – Styling foundations (Tailwind).

**Frontend core:**

- `index.html` / `index.tsx` / `App.tsx` – Main application entry and root component.
- `admin.html` / `admin.tsx` – Admin dashboard entry + React root.
- `types.ts` – **Canonical type definitions** for BMS data, insights, historical records, etc.
- `components/` – UI components (Upload, Results, Admin views, charts, solar views, banners, etc.).
- `state/` – React state management (`appState.tsx`, `adminState.tsx`).
- `services/` – API clients for Netlify functions and external services (Gemini, solar estimate, weather).
- `hooks/` – Custom hooks (data loading, insights requests, chart behaviors).
- `utils/`, `utils.ts` – Shared utilities (formatting, math, aggregation, timers, etc.).

**Backend core:**

- `netlify/functions/analyze.cjs` – Main BMS screenshot analysis endpoint (synchronous mode).
- `netlify/functions/generate-insights-with-tools.cjs` – “Battery Guru” / insights + app feedback endpoint (tool-calling).
- `netlify/functions/generate-insights-background.cjs` – Long-running background insights/feedback processing.
- `netlify/functions/history.cjs` – Historical analysis browser with pagination and filters.
- `netlify/functions/systems.cjs` – BMS system registration and metadata.
- `netlify/functions/admin-diagnostics.cjs` – Admin diagnostics and health checks.
- `netlify/functions/solar-estimate.ts` – TypeScript Netlify function for solar forecast/proxy.
- `netlify/functions/utils/mongodb.cjs` – MongoDB connection helper (pooling, health checks, optional encryption).
- `netlify/functions/utils/logger.cjs` – Structured logger (JSON logs + audit fields).
- `netlify/functions/utils/retry.cjs` – Retry + circuit breaker utilities.
- `netlify/functions/utils/analysis-pipeline.cjs` – Core analysis orchestration pipeline.
- `netlify/functions/utils/geminiClient.cjs` – Gemini API client with proper timeouts, error handling, and circuit breaker.
- `netlify/functions/utils/validation.cjs` – Input validation helpers.
- `netlify/functions/utils/rate-limiter.cjs` – Rate limiting utilities.
- `netlify/functions/utils/errors.cjs` – Standard error response helper.

---

## Module Systems (NEVER MIX)

- **Frontend:**
  - Files: `.ts`, `.tsx`
  - Modules: ES modules (`import` / `export`)
- **Backend (Netlify functions + utils):**
  - Files: `.cjs`
  - Modules: CommonJS (`require` / `module.exports`)
- **Exception:**
  - `netlify/functions/solar-estimate.ts` – TypeScript, compiled by Netlify bundler.

**Do not:**

- Use `require()` in React/TSX.
- Use `import` syntax in `.cjs` files (unless explicitly migrated and configured).

---

## Project Architecture & Data Flow

### High-Level Overview

From `ARCHITECTURE.md`, `FULL_CONTEXT_MODE.md`, insights and monitoring docs:

1. **User-facing analysis app (index.html / App.tsx)**
   - User uploads BMS screenshots.
   - Frontend calls `/.netlify/functions/analyze?sync=true`.
   - Analysis pipeline:
     - OCR + semantic extraction via Gemini.
     - Data normalization and validation.
     - Duplicate detection via SHA-256 content hashing.
     - Weather and solar correlation (via weather APIs and `solar-estimate`).
   - Results persist in MongoDB (`analysis-results`) and render in UI, with alerts, charts, and trends.

2. **Historical analysis**
   - `/.netlify/functions/history` powers the historical views:
     - Time range filters (day/week/month/custom).
     - Rollups (hourly, daily, monthly) as documented in `HISTORICAL_ANALYSIS_*` docs.
     - Cloud/solar correlation from `HOURLY_CLOUD_SOLAR_INTEGRATION.md`.

3. **Insights system (“Battery Guru”)**
   - `/.netlify/functions/generate-insights-with-tools`
   - Combines:
     - BMS data (current + historical).
     - Weather and solar forecasts/actuals.
     - Derived aggregates (daily net balance, alert events, load estimation).
   - Uses Gemini 2.5 Flash with **tool calling**, described in:
     - `GENERATE_INSIGHTS_ARCHITECTURE.md`
     - `GENERATE_INSIGHTS_IMPLEMENTATION_SUMMARY.md`
     - `GENERATE_INSIGHTS_OPTIMIZATION_SUMMARY.md`
     - `INSIGHTS_*` and `ANALYZE_INSIGHTS_FIX_COMPLETE.md`
   - Two modes:
     - **Synchronous**: <~55–58 seconds total Netlify request time.
     - **Background**: Creates jobs in `insights-jobs` for longer analysis, processed by `generate-insights-background.cjs`.

4. **Full Context Mode & AI Feedback System**
   - Documented in:
     - `FULL_CONTEXT_MODE.md`
     - `FULL_CONTEXT_MODE_IMPLEMENTATION_COMPLETE.md`
     - `AI_FEEDBACK_DOCUMENTATION_COMPLETE.md`
     - `AI_FEEDBACK_SYSTEM_ISSUES.md`
     - `docs/ai-feedback-system/*`
   - Focus:
     - AI analyzes:
       - App behavior (logs, patterns)
       - Architecture and code-level patterns
       - Monitoring data and diagnostics
       - Historical usage trends
     - Produces feedback about:
       - UX improvements
       - Performance optimizations
       - Alert/noise ratios
       - Cost/benefit tradeoffs and AI usage costs
   - Implemented as:
     - Reuse of `generate-insights-with-tools.cjs` with additional tools and context sources.
     - Jobs persisted into collections like `insights-jobs`, `feedback-data`, and others defined in Mongo docs.
   - Access:
     - Only via **admin dashboard** (OAuth-protected).
     - Endpoints **do not** implement new RBAC; they trust the admin front-end and validate tokens.

5. **Admin diagnostics & monitoring**
   - `/admin.html` + `admin.tsx`:
     - Summaries: system health, job status, timeouts, rate limits, insights usage.
     - Guided flows for:
       - Diagnostics endpoints (`admin-diagnostics.cjs`).
       - Historical data consistency checks.
       - Monitoring dashboards.
   - Implementation discussed in:
     - `ADMIN_DIAGNOSTICS_*` docs.
     - `MONITORING_README.md`, `MONITORING_OBSERVABILITY.md`, `MONITORING_INTEGRATION_EXAMPLES.md`.
     - `SYSTEM_DIAGNOSTICS.md`, `REAL_TIME_DIAGNOSTICS_GUIDE.md`.

---

## MongoDB Collections & Data Model

From `MONGODB_INDEXES.md`, `DATA_*` and architecture docs.

Database: `bmsview` (or env `MONGODB_DB_NAME` / `MONGODB_DB`).

Key collections:

- `analysis-results`
  - Stores each analyzed screenshot with:
    - BMS metrics (SOC, voltage, current, cell voltages, etc.).
    - SHA-256 hash for duplicate detection.
    - Weather/solar snapshot.
    - System associations.
    - Flags: `_isDuplicate`, alert summaries, etc.
- `systems`
  - BMS system registrations: chemistry, capacity, location, associated device IDs.
- `history`
  - Legacy or simplified history view (still used by some endpoints).
- `idempotent-requests`
  - For safe retries and request deduplication.
- `progress-events`
  - Legacy job progress events (mostly deprecated after synchronous migration).
- `insights-jobs`
  - Background insights & AI feedback jobs:
    - Job state (pending, running, completed, failed).
    - Request parameters, partial results, and checkpoints.
- `feedback-data`
  - AI feedback results, typically for admin-only views (should be sanitized and optionally encrypted).
- Monitoring/diagnostics-related collections as defined in monitoring docs.

Use the central helper:

```js
const { getCollection } = require('./utils/mongodb.cjs');
const coll = await getCollection('analysis-results');
```

**Never create a MongoDB client manually**; always use `getCollection()` to ensure pooling and health checks.

---

## Frontend Architecture & State Management

From `STATE_MANAGEMENT_GUIDE.md`, `REACT_LOOP_*` docs, and `App.tsx` / `admin.tsx`.

- **State containers:**
  - `state/appState.tsx` – Main app (user analysis).
    - Actions like:
      - `PREPARE_ANALYSIS`
      - `SYNC_ANALYSIS_COMPLETE`
      - `SET_ERROR`
      - `FETCH_HISTORY_SUCCESS` / `FETCH_SYSTEMS_SUCCESS`
    - Examples:
      ```ts
      const { state, dispatch } = useAppState();
      dispatch({
        type: 'SYNC_ANALYSIS_COMPLETE',
        payload: { fileName, record, isDuplicate },
      });
      ```
  - `state/adminState.tsx` – Admin state:
    - Diagnostics results.
    - Monitoring and background job views.
    - AI feedback requests and results.
    - UI filters for insights and feedback.

- **React loop pattern:**
  - Documented in `.github/REACT_LOOP_IMPLEMENTATION.md`, `REACT_LOOP_README.md`, `REACT_LOOP_INTEGRATION_GUIDE.md`, `REACT_LOOP_QUICKREF.md`.
  - Core idea: deterministic state machine + side-effect orchestration (fetching data, triggering insights, updating charts) via reducer actions rather than ad-hoc imperative calls.

- **Components:**
  - BMS upload & results:
    - `components/UploadSection.tsx`, `components/AnalysisResult.tsx`, etc.
  - Insights & charts:
    - Components for insights summaries, stack traces of events, net balance, etc.
    - Chart control enhancements documented in `chart-controls-section-new.txt` and `fix_chart_*` scripts.
  - Admin diagnostics:
    - Visual guides documented in `ADMIN_DIAGNOSTICS_VISUAL_GUIDE.md`, `ADMIN_DIAGNOSTICS_VISUAL.md`.
    - Components reflect statuses described there (timeouts, failures, partial results).

- **Styling:**
  - Tailwind-based classes for layout and visual consistency.
  - Shared CSS in `index.css`.

---

## Insights & AI Behavior – Detailed Rules

From `GENERATE_INSIGHTS_*`, `INSIGHTS_*`, `HOURLY_CLOUD_SOLAR_INTEGRATION.md`, `FULL_CONTEXT_MODE.md`, and related docs.

### Core Insights Behavior

- Use Gemini 2.5 Flash with structured tool calling to:
  - Fetch BMS data (current + historical).
  - Fetch weather/solar history and forecasts.
  - Retrieve derived aggregates computed in backend utilities.

- **Tool iterations:**
  - Bounded at ~10 tool call iterations.
  - Hard time budget: ~58 seconds per Netlify request (with per-call ~25s timeouts).
  - If time or iterations are exceeded:
    - Fallback behavior is explicitly defined (see `INSIGHTS_TIMEOUT_FIX.md`, `TIMEOUT_FIX_COMPREHENSIVE.md`).

### Alert Event Grouping

- Do **not** treat each screenshot alert as a separate event.
- Group into **alert events** based on:
  - Consecutive readings over threshold.
  - Inferred end of event when metrics recover.
  - Time-based gaps (large gaps imply potential hidden recovery).
- Track:
  - Start time, end time, duration.
  - Severity and impact.

### Solar Variance Interpretation

- Solar variance = `expected solar production - actual charge contribution`.
- Interpret carefully:
  - Often reflects **daytime load** rather than solar “failure”.
  - Only flag solar underperformance as a problem if:
    - Variance beyond tolerance, **and**
    - Weather/irradiance conditions were favorable.
- Correlation logic is described in `HOURLY_CLOUD_SOLAR_INTEGRATION.md` and `SOLAR_INTEGRATION_GUIDE.md`.

### Battery Autonomy vs Service Life

- **Battery autonomy** = how long the system can run on battery at current loads (runtime).
- **Service life** = long-term lifetime of the battery (years / cycle counts).
- Insights must distinguish these clearly and not conflate them.

### Daily Net Balance & Generator Recommendations

- Compute **daily net energy balance**:
  - Net balance = total daily generation – total daily consumption.
- When negative, provide clear math and guidance:
  - Example:
    - “Daily deficit: 25.2Ah.”
    - “At 60A generator charging current, run for `25.2Ah ÷ 60A ≈ 0.42h` (~25 minutes) to compensate.”
- Always correlate with:
  - Weather (cloudy vs sunny).
  - Recent trends (persistent deficits vs one-off).
- Prefer:
  - Actionable, conservative recommendations.
  - Clear description of assumptions.

---

## Full Context Mode & AI Feedback System

From `FULL_CONTEXT_MODE.md`, `FULL_CONTEXT_MODE_IMPLEMENTATION_COMPLETE.md`, `AI_FEEDBACK_DOCUMENTATION_COMPLETE.md`, `AI_FEEDBACK_SYSTEM_ISSUES.md`, `docs/ai-feedback-system/*`, and monitoring/diagnostics docs.

### Purpose

- Provide AI-driven feedback on:
  - App health, performance, and error patterns.
  - UX issues and confusing workflows.
  - Alert noise vs signal.
  - Cost and resource usage, especially AI costs.
  - Data availability and correctness.

### Core Concepts

- **Context sources** may include:
  - Logs (structured JSON from `logger.cjs`).
  - Aggregated metrics (from monitoring and diagnostics functions).
  - Architecture docs (summaries based on `ARCHITECTURE.md`, `GENERATE_INSIGHTS_*`, `MONITORING_*`).
  - Historical patterns (long-running trends in `analysis-results`, `insights-jobs`, etc.).

- **Job-based model**:
  - For large or expensive feedback tasks, system creates jobs:
    - Stored in `insights-jobs` or dedicated feedback-related collections.
    - Processed by `generate-insights-background.cjs`.
  - Supports resumable and checkpointed analysis (see `CHECKPOINT_RESUMABLE_INSIGHTS_IMPLEMENTATION.md`).

- **Security & RBAC**:
  - All access control is handled **in the admin UI** via OAuth and authorization logic (documented in `SYSTEM_DIAGNOSTICS.md`, `FULL_CONTEXT_MODE.md`).
  - Endpoints:
    - Validate admin tokens.
    - Enforce input validation and rate limits.
    - Provide detailed logs and audit trails.
  - Agents must **not introduce new RBAC layers** in endpoints.

### Cost & Resource Awareness

- Important themes from:
  - `AI_FEEDBACK_SYSTEM_ISSUES.md`
  - `GENERATE_INSIGHTS_OPTIMIZATION_SUMMARY.md`
  - `MONITORING_OBSERVABILITY.md`
- Behavior guidelines:
  - Prefer pre-aggregation and summarization over raw data streaming to Gemini.
  - Use time-range constraints and sampling where appropriate.
  - Suggest incremental / staged analysis (quick summary first, deeper dive as needed).
  - Make costs explicit in admin feedback where relevant.

---

## Monitoring, Diagnostics, and Observability

From `MONITORING_*`, `SYSTEM_DIAGNOSTICS.md`, `ADMIN_DIAGNOSTICS_*`, `REAL_TIME_DIAGNOSTICS_GUIDE.md`, `SANITY_CHECK*.md`, `ZERO_TIMEOUT_VERIFICATION.md`.

- **Logging:**
  - Use `logger.cjs` and `createLogger(name, context)` for JS/Node functions.
  - Always log:
    - Function name.
    - Request/job IDs.
    - User/admin identity (if relevant).
    - High-level action + result.
  - Avoid leaking secrets or private data in logs.

- **Metrics & monitoring:**
  - Diagnostics endpoints expose:
    - Health of MongoDB connection.
    - Timeouts and retry counts for Gemini.
    - Insights job statuses and durations.
    - Error rate summaries.

- **Admin diagnostics UI**:
  - Summarizes:
    - Timeout distributions.
    - Partial failure vs full failure patterns.
    - Bottlenecks and slow endpoints.
  - Visual flows and state described in `ADMIN_DIAGNOSTICS_VISUAL.guide` docs.

- **Resilience and timeouts:**
  - Timeout handling must follow patterns in:
    - `ERROR_HANDLING_RESILIENCE.md`
    - `TIMEOUT_FIX_COMPREHENSIVE.md`
    - `INSIGHTS_TIMEOUT_FIX.md`
  - Do not use production-level timeouts in tests; tests use much shorter timeouts.

---

## Environment Variables

From `.env.example`, `.env.test`, `GEMINI.md`, `DEPLOYMENT_*` docs.

**Required:**

- `GEMINI_API_KEY` – Google Gemini API key.
- `MONGODB_URI` – MongoDB connection string.
- `MONGODB_DB_NAME` or `MONGODB_DB` – Database name (default `bmsview`).

**Important optional:**

- `GEMINI_MODEL` – Gemini model (default `gemini-2.5-flash`).
- `LOG_LEVEL` – `INFO` (prod) or `DEBUG` (dev).
- `URL` – Netlify deployment URL (auto in prod).

Never hardcode secrets or API keys; always rely on env vars.

---

## Testing Strategy

From `TESTING.md`, `TESTING_INFRASTRUCTURE_SUMMARY.md`, test files.

- **Framework:** Jest; Node + browser tests with `babel-jest` transforms.
- **Config:** `jest.config.cjs` sets:
  - Module transforms for JS and TS.
  - Timeouts (~30s global, but test-specific overrides allowed).
- **Patterns:**
  - Tests live under `tests/` or as `*.test.js/.cjs` etc.
  - Use mocks for:
    - MongoDB (`tests/mocks/*` and `mongodb.mock.js` pattern).
    - Gemini API.
    - Weather/solar APIs.
  - Do not rely on production timeouts; use short timeouts (e.g., 100ms) to make tests deterministic.
  - Test both:
    - **Happy paths** (correct responses).
    - **Failure paths** (timeouts, partial failures, retries).

---

## Common Development Workflows

### Adding or Modifying a React Component

1. Place component in `components/` with PascalCase name (e.g., `SolarVarianceChart.tsx`).
2. Use TypeScript with explicit props using types from `types.ts` where appropriate.
3. Use state via `useAppState`/`useAdminState` if interacting with global flow.
4. Style with existing Tailwind patterns.
5. Add/update tests under `tests/` if component has significant logic.

### Adding or Modifying a Netlify Function

1. Create/modify `.cjs` in `netlify/functions/`.
2. Use CommonJS:

   ```js
   const { createLogger } = require('./utils/logger.cjs');

   exports.handler = async (event, context) => {
     const log = createLogger('my-function', { requestId: context.awsRequestId });
     // ...
     return { statusCode: 200, body: JSON.stringify({ ok: true }) };
   };
   ```

3. Use `validation.cjs` for input validation.
4. Use `rate-limiter.cjs` if public or high-cost.
5. Use `errors.cjs` for error responses.

### Implementing AI Feedback Features

1. Reference:
   - `FULL_CONTEXT_MODE.md`
   - `AI_FEEDBACK_DOCUMENTATION_COMPLETE.md`
   - `AI_FEEDBACK_SYSTEM_ISSUES.md`
2. Identify whether change is:
   - Backend refinement (new tool, new data source, new job type).
   - Admin UI enhancement (new panel, filtering, exports).
3. **Never** add new RBAC logic in functions; rely on admin OAuth.
4. Add:
   - Input validation.
   - Rate limiting for expensive operations.
   - Structured logging with audit context.
5. Test with mocked APIs and local logs before hitting real services.

---

## Security & Compliance Guidelines

From `DATA_RETENTION_POLICY.md`, `GDPR_COMPLIANCE.md`, `AUDIT_REPORT.md`, `ERROR_HANDLING_*`, `AI_FEEDBACK_*`.

- Never commit secrets or tokens.
- Validate **all** external inputs (query params, JSON bodies, uploaded data).
- Use parameterized / structured queries in MongoDB (no string concatenation).
- Don’t leak sensitive information in error messages returned to clients.
- Ensure data retention and deletion patterns follow:
  - `DATA_RETENTION_POLICY.md`
  - `GDPR_COMPLIANCE.md`
- Log security-relevant events:
  - Authentication failures.
  - Unexpected access patterns.
  - Rate limiting triggers.

---

## Anti-Patterns to Avoid

- **Module systems:**
  - Don’t mix `import`/`export` with `.cjs`.
  - Don’t use `require()` in frontend TS/TSX.

- **DB access:**
  - Don’t manually create MongoDB clients.
  - Don’t bypass `getCollection()`.

- **Analysis/insights:**
  - Don’t reintroduce job-based flows for screenshot analysis (keep `?sync=true`).
  - Don’t treat alerts as per-screenshot only; always group into events.
  - Don’t misinterpret solar variance without weather context.
  - Don’t conflate battery autonomy with lifetime.

- **Error handling:**
  - Don’t hardcode generic error messages when context exists.
  - Don’t surface detailed internal errors to end users in production.
  - Don’t use production timeouts in tests.

- **Admin & security:**
  - Don’t add ad-hoc RBAC in Netlify functions.
  - Don’t bypass validation or rate limiting for public or expensive endpoints.

- **AI Feedback:**
  - Don’t ask Gemini to read entire raw datasets if pre-aggregated data is available.
  - Don’t ignore cost/time budgets documented in `GENERATE_INSIGHTS_OPTIMIZATION_SUMMARY.md` and `INSIGHTS_TIMEOUT_FIX.md`.

---

## Task Scoping & When to Use AI Agents

### Ideal Tasks for the AI Coding Agent

- Bug fixes with clearly defined reproduction steps and relevant logs.
- Feature enhancements with explicit scope:
  - New admin diagnostics panels.
  - New insights summaries or visualizations.
  - Additional filters for history or feedback views.
- Refactoring:
  - Extracting utilities.
  - Aligning functions with error/resilience patterns.
- Tests:
  - Adding coverage for existing behavior, especially around timeouts, retries, insights.
- Documentation updates:
  - Keeping `ARCHITECTURE.md`, `FULL_CONTEXT_MODE.md`, and monitoring docs aligned with new changes.
- Security hardening:
  - Adding missing validation or rate limiting to endpoints.
  - Strengthening logging and auditability.

### Tasks Requiring Human Oversight

- Deep architectural changes:
  - New subsystems, major cross-cutting refactors.
- Changes that alter:
  - Security posture (Auth, RBAC behavior).
  - Data retention or GDPR/PII handling.
- External integrations:
  - Slack/webhook/project-management integrations for feedback.
  - New third-party APIs with live impact.
- Non-trivial performance tuning requiring real-world load analysis.

---

## PR & Self-Review Checklist

Before considering any work “done”:

1. `npm run build` (mandatory – ensures TS and bundling are valid).
2. `npm test` (all tests green).
3. `npm run lint` (no lint errors or only accepted exceptions).
4. All `.cjs` functions use CommonJS and adhere to logging/validation patterns.
5. No stray `console.log` in production paths (use logger).
6. Docs updated when:
   - API behavior changes.
   - Timeouts or resilience patterns are modified.
   - New major features (insights, diagnostics, feedback, monitoring) are added.
7. Security checklist completed for changes that touch sensitive data or endpoints.

---

## When in Doubt

- Start from:
  - `ARCHITECTURE.md`
  - `GENERATE_INSIGHTS_ARCHITECTURE.md`
  - `FULL_CONTEXT_MODE.md`
  - `STATE_MANAGEMENT_GUIDE.md`
  - `MONITORING_README.md`
- Look for:
  - Existing patterns in similar functions/components.
  - Past fix summaries (`*_FIX_SUMMARY.md`, `IMPLEMENTATION_COMPLETE.md`, `SPRINT_COMPLETE_SUMMARY.md`).
- Log thoroughly, test locally (`netlify dev` + `npm test`), then iterate.

These instructions are the **source of truth** for AI-assisted development in BMSview. All suggestions and modifications should remain consistent with these patterns and the architecture described in the repo’s documentation.
