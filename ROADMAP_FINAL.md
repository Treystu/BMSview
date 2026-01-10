# Development Roadmap - Jan 2026

Based on the Audit Report, this roadmap prioritizes fixing broken features and addressing technical debt before final polish.

## Phase 1: Critical Fixes (The "Real" Completion)
**Goal**: Ensure all claimed features actually work for the user.

### 1.1 Wire Up Optimized Upload Endpoint
*   **Task**: Update `src/services/uploadService.ts` (or create it) to use `/.netlify/functions/upload`.
*   **Task**: Refactor `UploadSection.tsx` to use this service instead of the legacy pass-through.
*   **Verification**: Upload a file and verify it hits the `upload` function logs, not just `analyze`.

### 1.2 Fix Real-Time Updates (SSE Alternative)
*   **Problem**: Netlify Functions timeout after 10s, killing SSE connections.
*   **Solution**: Switch to **Short Polling** or **Netlify Edge Functions** (if available/enabled).
*   **Decision**: Given the constraints, implement a robust **Adaptive Polling** mechanism for the admin panel as the "official" solution, replacing the broken SSE code.
    *   Remove `sse-updates.cjs` (or deprecate it).
    *   Enhance `useInsightsPolling` to be smarter/adaptive.

---

## Phase 2: Type Safety & Code Quality
**Goal**: Eliminate `any` types and enforce strict TypeScript.

### 2.1 Type Definitions
*   **Task**: Create proper interfaces for `AnalysisResult`, `System`, `HistoryRecord` in `src/types/`.
*   **Task**: Replace `any` in `clientService.ts` with typed interfaces.
*   **Task**: Replace `any` in `HistoricalChart.tsx` with typed interfaces.

### 2.2 ESLint Enforcement
*   **Task**: Keep `no-explicit-any` enabled.
*   **Task**: Fix all 228 warnings.
*   **Task**: Add `no-unused-vars` cleanup.

---

## Phase 3: Testing & Validation
**Goal**: Re-establish trust in the test suite.

### 3.1 Integration Tests
*   **Task**: Write an integration test for the Upload flow (frontend -> backend).
*   **Task**: Write a test for the polling mechanism.

### 3.2 Frontend Tests
*   **Task**: Fix the `jsdom` environment issues in frontend tests.
*   **Task**: Ensure `UploadSection` tests verify the correct API endpoint is called.

---

## Phase 4: Polish & Deployment
**Goal**: Final cleanup and release.

*   **Task**: Remove dead code (legacy upload logic, broken SSE).
*   **Task**: Final documentation cleanup (archive old tracking files).
*   **Task**: Generate final "Production Ready" build artifact.
