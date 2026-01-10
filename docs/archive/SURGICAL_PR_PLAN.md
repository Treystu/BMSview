# Surgical PR Plan: Solar-Aware Load Analysis Integration

## Objective
Integrate the verified `solar-aware-load-analysis.cjs` module into the production pipeline (`analyze.cjs` and `generate-insights-with-tools.cjs`) to provide accurate load vs. solar variance metrics.

## Scope
- **Files to Modify**:
  - `netlify/functions/utils/comprehensive-analytics.cjs` (Already integrated, needs final review)
  - `netlify/functions/utils/solar-aware-load-analysis.cjs` (Fixes applied, needs commit)
  - `netlify/functions/utils/solar-irradiance.cjs` (Fixes applied, needs commit)
  - `netlify/functions/utils/gemini-tools.cjs` (Documentation updates)
- **Risk Level**: Low (Logic is additive or isolated in utility modules).
- **Regression Testing**: `test-solar-aware.cjs` passes.

## Step-by-Step Implementation Plan

### 1. Commit Fixes to Utility Modules
- **Action**: Commit the `latitude: 0` fix and UTC timezone fix in `solar-aware-load-analysis.cjs`.
- **Action**: Commit the UTC timezone fix in `solar-irradiance.cjs`.
- **Verification**: `node test-solar-aware.cjs` (Already passed).

### 2. Finalize Integration in `comprehensive-analytics.cjs`
- **Current State**: The module imports and calls `analyzeSolarAwareLoads`.
- **Action**: Ensure the output `solarAwareStats` is correctly mapped to the final return object.
- **Verification**: Review file content.

### 3. Update Gemini Tools Definition
- **Action**: Update `gemini-tools.cjs` to explicitly describe the new `solarAwareStats` fields so the AI knows how to use them.
- **Context**: The AI needs to know that `trueLoad` is the inferred load and `solarEfficiency` is the performance ratio.

### 4. Cleanup
- **Action**: Remove `test-solar-aware.cjs` before merging (or move to `tests/`).
- **Action**: Remove temporary logs if any.

## Rollback Plan
If issues arise:
1. Revert `comprehensive-analytics.cjs` to exclude `analyzeSolarAwareLoads`.
2. The utility modules can remain as they are unused by legacy code.

## Success Metrics
- **Accuracy**: Load inference within 5% of actual (verified in test).
- **Stability**: No crashes on edge cases (Lat 0, Night, Generator).
- **Performance**: <100ms added latency (negligible).
