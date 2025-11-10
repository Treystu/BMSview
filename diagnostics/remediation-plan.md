# MongoDB Query Spike Remediation Plan

_Last updated: 2025-11-09_

## Problem Summary

Recent MongoDB Atlas telemetry showed the `history` Netlify function generating 73,877 invocations in a 25-hour window, triggering connection spikes and risking rate limiting. Root causes include cache misses during IndexedDB-disabled sessions, legacy clients skipping the cache-first layer, and incremental sync endpoints requiring normalization. The objective is to reduce Atlas query volume by >90% while preserving data integrity.

## Target Metrics

- **History function invocations:** < 5,000 per 24 hours (≥93% reduction)
- **MongoDB concurrent connections:** < 20 sustained during peak usage
- **IndexedDB hit rate:** > 80% of history/system reads served locally
- **Sync success:** 0 critical errors in `sync-metadata`, `sync-incremental`, `sync-push`
- **Latency:** `history` p95 < 150 ms after cache-first rollout

## Remediation Steps

1. **Client Cache Enforcement**
   - Ship cache-first logic in `services/clientService.ts` (complete).
   - Audit UI entry points to ensure all history/system reads request `CACHE_FIRST` by default.
   - Add console diagnostics (dev mode) to flag network fetches when cache data is available.

2. **IndexedDB Toggle Comparison**
   - Run `netlify dev` sessions with IndexedDB enabled/disabled.
   - Capture request counts using Netlify CLI logs and Dexie instrumentation.
   - Document deltas and verify cached flow meets target metrics.

3. **Incremental Sync Guardrails**
   - Ensure `sync-incremental.cjs` normalizes timestamps (complete) and rejects requests lacking `since` parameter.
   - Add temporary query counters/timing logs to sync endpoints (complete) and review after cache rollout.

4. **Diagnostics & Alerting**
   - Publish Atlas snapshot (`diagnostics/atlas-metrics.md`) for baseline comparison (complete).
   - Extend admin diagnostics to surface cache hit rate and pending sync counts.
   - Add alert threshold documentation: warn if `history` invocations exceed 5k/day or cache hit rate drops below 70%.

5. **Follow-Up Verification**
   - After cache deployment, capture new Atlas metrics and append to diagnostics logbook.
   - Compare before/after numbers against target metrics.
   - If targets unmet, escalate to Phase 1 intelligent sync implementation.

## Required Evidence

- Atlas metrics screenshot before and after remediation.
- Netlify function invocation logs with IndexedDB on/off comparisons.
- Admin diagnostics output demonstrating cache statistics and pending sync counts.
- Summary of issues encountered and mitigation outcomes.

## Ownership & Timeline

- **Owner:** Diagnostics task force (Copilot agent + maintainers)
- **Status:** In progress (cache-first and timestamp normalization complete)
- **Next Checkpoint:** IndexedDB comparison run scheduled post cache rollout (ETA Nov 11, 2025)

## Risks & Mitigations

- **Legacy clients bypass cache:** Enforce version gating; fallback to network flagged in logs.
- **IndexedDB failures:** Provide offline alerts and fallback to throttled network fetch with exponential backoff.
- **Netlify function limits:** Monitor invocation duration; consider rate limiting or background jobs if spikes persist.
- **Metrics drift:** Automate diagnostics to run nightly and export to logbook.
