# Migration Guide: Deprecated generate-insights-background.cjs

## Summary

The `generate-insights-background.cjs` endpoint has been deprecated and will be removed in a future release.

## Background

Previously, the BMSview architecture included a separate HTTP endpoint (`generate-insights-background.cjs`) intended for long-running background insights processing. However, analysis of the actual workflow revealed that:

1. The async trigger (`generate-insights-async-trigger.cjs`) now enqueues background jobs via Netlify Async Workloads
2. Work is processed inside the workload handler (`generate-insights-background.mjs`), so nothing runs in-process in `generate-insights-with-tools.cjs`
3. `generate-insights-background.cjs` is deprecated in favor of the async workload handler
3. The `generate-insights-background.cjs` endpoint handled background processing for long-running jobs.
   This has been replaced with Netlify Async Workloads for better resilience and unlimited execution time.

## What Changed

### Deprecated
- `netlify/functions/generate-insights-background.cjs` - Standalone background endpoint
- Netlify function configuration in `netlify.toml` for the deprecated endpoint

### No Change Required
- Background mode still works via `generate-insights-with-tools.cjs` with `mode='background'`
- Job polling via `generate-insights-status.cjs` unchanged
- Frontend code unchanged (never called the deprecated endpoint)
- All existing background jobs continue to work

## Migration Path

### If you were using the deprecated endpoint directly:

**Old approach (deprecated):**
```javascript
// Create job first
const { jobId } = await fetch('/.netlify/functions/generate-insights-with-tools', {
  method: 'POST',
  body: JSON.stringify({ mode: 'background', analysisData, systemId })
});

// Then invoke background endpoint (THIS NO LONGER WORKS)
await fetch('/.netlify/functions/generate-insights-background', {
  method: 'POST', 
  body: JSON.stringify({ jobId })
});
```

**New approach (use main endpoint):**
```javascript
// Just use background mode - processing happens automatically
const { jobId } = await fetch('/.netlify/functions/generate-insights-with-tools', {
  method: 'POST',
  body: JSON.stringify({ 
    mode: 'background',  // This triggers in-process async processing
    analysisData, 
    systemId,
    consentGranted: true
  })
});

// Poll for status as before
const status = await fetch(`/.netlify/functions/generate-insights-status?jobId=${jobId}`);
```

### If you were using the normal workflow:

**No changes required!** The background mode in `generate-insights-with-tools.cjs` already handles everything.

## Architecture Changes

### Before
```
generate-insights-with-tools.cjs (background mode)
  ↓
  Creates job
  ↓
  Returns jobId
  ↓
  (Separately) generate-insights-background.cjs invoked with jobId
  ↓
  Processes job
```

### After  
```
generate-insights-with-tools.cjs (background mode)
  ↓
  Creates job
  ↓
  Calls processInsightsInBackground() in-process (async, don't await)
  ↓
  Returns jobId immediately
  ↓
  Processing continues in background
```

## Timeline

- **Now**: Endpoint marked as deprecated with warnings
- **Next release**: Endpoint may be removed entirely
- **Migration window**: Use this release to update any direct calls to the deprecated endpoint

## Related Documentation

- `docs/BACKGROUND_INSIGHTS_PROCESSING.md` - Updated architecture overview
- `INSIGHTS_DEPLOYMENT_GUIDE.md` - Deployment patterns
- `docs/GENERATE_INSIGHTS_ARCHITECTURE.md` - Complete insights architecture

## Questions?

If you have questions about this migration or encounter issues, please:
1. Check the updated documentation listed above
2. Review the code in `generate-insights-with-tools.cjs` lines 500-579 (background mode)
3. Open an issue on GitHub with details
