# Legacy Job-Based Analysis Functions

This directory contains archived functions from the legacy asynchronous job-based analysis system.

## Archived Functions

- **job-shepherd.cjs** - Legacy job orchestration and management
- **get-job-status.cjs** - Job status polling endpoint
- **process-analysis.cjs** - Asynchronous analysis processor

## Why These Were Archived

BMSview migrated from an asynchronous job-based analysis system to a synchronous analysis system in October 2025. The new system:

1. Uses `?sync=true` query parameter on the `/analyze` endpoint
2. Returns results immediately instead of creating jobs
3. Eliminates the need for job polling and status checking
4. Provides better UX with instant feedback

## Migration Notes

- The `useJobPolling` hook in `src/hooks/useJobPolling.ts` is now commented out
- Frontend no longer polls for job status
- Analysis pipeline uses `performAnalysisPipeline` directly in synchronous mode
- Duplicate detection is handled via content hashing at the analyze endpoint

## Historical Context

These functions were part of the initial architecture but became redundant after:
- Implementation of synchronous analysis pipeline
- Addition of proper duplicate detection via SHA-256 content hashing
- Removal of job-based state management

## If You Need to Restore

If for any reason these functions are needed again:
1. Copy them back to `netlify/functions/`
2. Uncomment the `useJobPolling` hook usage in `App.tsx`
3. Update frontend to use legacy analysis flow

**Note:** This is not recommended as the synchronous system is more reliable and provides better UX.

---
_Archived: November 2025_
_Migration Reference: Major Fix Update PR_
