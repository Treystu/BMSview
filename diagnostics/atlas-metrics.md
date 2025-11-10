# MongoDB Atlas Metrics Snapshot (2025-11-09)

Captured via Atlas dashboard after cache-first history fixes were implemented.

## Overview

- **Observation window:** Nov 8, 01:00 PM → Nov 9, 01:59 PM
- **Primary concern:** `history` function dominated query volume (73,877 calls)
- **Expected impact:** Recent cache-first and incremental-sync patches should cut repeated history reads dramatically.

## Function Distribution (Netlify Telemetry)

| Function | Invocations | Errors | Avg Duration | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| history | 73,877 | 4 (0.01%) | 78.7 ms | 71.3 ms | 115.5 ms | 197.5 ms |
| systems | 21 | 3 (14.29%) | 837.3 ms | 806.8 ms | 1,434.4 ms | 1,434.4 ms |
| get-ip | 9 | 0 | 161 ms | 201 ms | 202.4 ms | 202.4 ms |
| system-analytics | 9 | 0 | 1,572.2 ms | 1,518.3 ms | 2,012.3 ms | 2,012.3 ms |
| ip-admin | 8 | 2 (25%) | 1,531 ms | 1,211.5 ms | 1,267 ms | 1,267 ms |
| analyze | 6 | 0 | 3,042.5 ms | 3,036.5 ms | 4,440 ms | 4,440 ms |
| weather | 4 | 0 | 391.8 ms | 326.8 ms | 345.8 ms | 345.8 ms |
| process-analysis | 2 | 0 | 3,980 ms | 3,007 ms | 3,007 ms | 3,007 ms |
| solar-estimate | 2 | 0 | 2,587 ms | 1,930 ms | 1,930 ms | 1,930 ms |
| generate-insights-with-tools | 1 | 0 | 23,653 ms | 11,826.5 ms | 11,826.5 ms | 11,826.5 ms |

> Screenshot capture pending; reserve `diagnostics/assets/netlify-history-distribution-2025-11-09.png` for upload.

## Observations

1. The `history` endpoint accounts for ~99% of invocations—aligns with pre-fix MongoDB spikes.
2. Insights timeout instrumentation confirms long-tail latency (single invocation ~24 s) but no errors.
3. `systems` exhibits higher error rate (14%)—investigate after cache rollout.

## Follow-Up Tasks

- Attach this snapshot to the diagnostics logbook and repeat after cache-first deployment to confirm improvement.
- Compare Atlas connection graphs before/after to quantify reductions.
- Update remediation plan with target metrics (e.g., <5k history calls/day, <5% error rate on systems).
