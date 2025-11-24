# Insights Timeout Fix - Implementation Summary

## Problem Statement

The standard "Generate Insights" button in BMSview was timing out after 60 seconds with an unhelpful error message:
```
⚠️ Error Generating Insights
Request timed out. The AI took too long to process your query. Try:
• Asking a simpler question
• Requesting a smaller time range
• Breaking complex queries into multiple questions
```

This error appeared even for standard queries (like 1 month context window), making the core feature unreliable.

## Root Cause

1. **Backend had checkpoint/resume system** - The backend (`generate-insights-with-tools.cjs`) already implemented a checkpoint system that saves state on timeout and returns a 408 response with a `jobId` for resumption.

2. **Frontend wasn't using it** - The frontend (`streamInsights()` in `clientService.ts`) was simply throwing an error when receiving a 408 response, instead of automatically retrying with the `resumeJobId`.

3. **Result** - Users saw timeout errors even though the system could continue processing from where it left off.

## Solution Implemented

### Frontend Changes (`services/clientService.ts`)

Complete rewrite of the `streamInsights()` function with:

1. **Automatic Retry Loop**
   - Wrapped fetch logic in `attemptInsightsGeneration()` recursive function
   - Tracks `attemptCount` and `resumeJobId` across attempts
   - Maximum 5 attempts (5 minutes total processing time)

2. **408 Response Handling**
   ```typescript
   if (response.status === 408) {
     const errorData = await response.json();
     if (errorData.details?.canResume && errorData.details?.jobId) {
       if (attemptCount < MAX_RESUME_ATTEMPTS) {
         resumeJobId = errorData.details.jobId;
         return await attemptInsightsGeneration(); // Recursive retry
       }
     }
   }
   ```

3. **User Feedback During Retries**
   - Shows progress message: `⏳ **Continuing analysis (attempt 2/5)...**`
   - Keeps user informed that processing is continuing, not stuck

4. **Request Body Enhancement**
   - Always sends `mode: 'sync'` explicitly
   - Includes `resumeJobId` on retry attempts
   - Preserves all original payload parameters

5. **Error Handling**
   - Max retries exceeded: Shows helpful message with context window suggestion
   - `canResume: false`: Don't retry, just show error
   - Network errors: Show original error

### Backend Support (Already Existed)

The backend already had the necessary infrastructure:

1. **Checkpoint Manager** (`netlify/functions/utils/checkpoint-manager.cjs`)
   - `getOrCreateResumableJob()` - Creates or retrieves job
   - `validateCheckpoint()` - Validates saved checkpoint
   - `planResume()` - Configures resume parameters

2. **Insights Jobs** (`netlify/functions/utils/insights-jobs.cjs`)
   - `createInsightsJob()` - Creates job in MongoDB
   - `getInsightsJob()` - Retrieves existing job
   - `saveCheckpoint()` - Saves conversation state

3. **ReAct Loop** (`netlify/functions/utils/react-loop.cjs`)
   - Supports `checkpointState` parameter for resumption
   - Saves checkpoint before timeout via callback
   - Resumes from saved conversation history

## How It Works (Flow)

### First Attempt (No Timeout)
```
User clicks "Generate Insights"
  → streamInsights() called
  → POST to /generate-insights-with-tools with mode=sync
  → Backend processes request
  → Returns 200 with insights in < 60s
  → Display insights to user
  ✅ Success on first attempt
```

### Timeout and Resume (Automatic Retry)
```
User clicks "Generate Insights" (complex query)
  → streamInsights() called (attempt 1)
  → POST to /generate-insights-with-tools with mode=sync
  → Backend processes for 60s
  → Backend saves checkpoint and returns 408 with jobId
  
  → Frontend detects 408 with canResume=true
  → Shows: "⏳ Continuing analysis (attempt 2/5)..."
  → Automatically retries with resumeJobId
  
  → Backend receives resumeJobId
  → Loads checkpoint from MongoDB
  → Resumes from saved conversation state
  → Continues processing for another 60s
  
  → Either completes or times out again
  → Repeats up to 5 times (5 minutes total)
  ✅ Success with 2-5 attempts
```

### Max Retries Exceeded
```
User asks very complex query (e.g., 1 year context)
  → Retries 5 times (5 minutes total)
  → Still not complete
  → Shows error:
     "Analysis is taking longer than expected (5 minutes).
      Consider:
      • Reducing the time range (currently: 365 days)
      • Asking a more specific question
      • Breaking your query into multiple smaller questions"
  ❌ Helpful error with actionable suggestions
```

## Testing

### New Test Suite (`tests/insights-retry-resume.test.js`)

Six comprehensive tests covering:

1. **Successful first attempt** - No retry needed
2. **Automatic retry on 408** - Verifies retry logic works
3. **Max retries exceeded** - Tests failure case
4. **canResume=false** - No retry when resume not possible
5. **Checkpoint state save** - Backend checkpoint structure
6. **Resume from checkpoint** - Backend resume configuration

All tests pass ✅

### Build Status

```bash
npm run build  # ✅ Builds successfully
npm test -- insights-retry-resume.test.js  # ✅ 6/6 tests pass
```

## Configuration

### Frontend Constants
```typescript
const MAX_RESUME_ATTEMPTS = 5; // Maximum 5 attempts (5 minutes total)
```

### Backend Constants
```javascript
const SYNC_MODE_TIMEOUT_MS = 60000; // 60s timeout per attempt
const MAX_RETRY_ATTEMPTS = 3; // Checkpoint manager limit (not enforced in current flow)
```

## Monitoring and Debugging

### Frontend Logs (Browser Console)
```javascript
// Initial request
"Streaming insights from server" { systemId, hasCustomPrompt, contextWindowDays, ... }

// On timeout and retry
"Received 408 timeout response" { hasJobId: true, canResume: true, attemptCount: 1 }
"Automatic retry scheduled" { attemptCount: 1, maxAttempts: 5, jobId: "..." }

// On success after retry
"Insights response received" { hasInsights: true, wasResumed: true, attemptCount: 2 }
```

### Backend Logs (Netlify Functions)
```javascript
// Initial request
"Insights request received" { mode: "sync", hasCustomPrompt: false, ... }

// On timeout
"Sync mode failed" { error: "TIMEOUT", jobId: "...", durationMs: 60000 }

// On resume
"Attempting to resume existing job" { resumeJobId: "..." }
"Found resumable job" { status: "processing", hasCheckpoint: true, checkpointTurnCount: 5 }
"Resuming sync ReAct loop" { jobId: "..." }

// On final success
"Sync insights completed successfully" { turns: 8, toolCalls: 12, wasResumed: true }
```

## User Experience Improvements

### Before (Broken)
```
1. User clicks "Generate Insights"
2. Waits 60 seconds
3. Sees error: "Request timed out..."
4. Has to manually retry or give up
5. ❌ Poor user experience
```

### After (Fixed)
```
1. User clicks "Generate Insights"
2. Waits 60 seconds
3. Sees: "⏳ Continuing analysis (attempt 2/5)..."
4. Analysis continues automatically
5. Gets results after 90-120 seconds total
6. ✅ Seamless user experience
```

## Edge Cases Handled

1. **Network errors** - Show original error, don't retry
2. **canResume=false** - Don't retry if backend can't resume
3. **Max retries exceeded** - Show helpful error with suggestions
4. **Job already completed** - Return cached results immediately
5. **Invalid checkpoint** - Backend starts fresh if checkpoint corrupt

## Migration Notes

### No Breaking Changes
- Existing code continues to work
- Backward compatible with both sync and background modes
- Only affects timeout behavior (makes it better)

### Configuration Changes
- None required
- All constants have sensible defaults
- No environment variables needed

## Future Enhancements

Potential improvements for later:

1. **Configurable max retries** - Allow user to set retry limit
2. **Progress bar** - Show visual progress during retries
3. **Estimated time remaining** - Calculate based on attempt count
4. **Background mode fallback** - Switch to background mode after N retries
5. **Checkpoint compression** - Reduce checkpoint size for faster saves

## Performance Impact

### Positive
- **Faster user feedback** - Results appear instead of errors
- **No wasted work** - Continues from checkpoint, doesn't restart
- **Efficient retries** - Only retries on timeout, not other errors

### Negative
- **None identified** - Same backend cost, better UX

## Deployment Checklist

- [x] Code implemented
- [x] Tests written and passing
- [x] Build succeeds
- [x] Documentation updated
- [ ] Manual testing in development
- [ ] Deploy to staging
- [ ] Monitor logs for retry patterns
- [ ] Deploy to production
- [ ] Monitor production metrics

## Success Metrics

To measure success of this fix:

1. **Timeout error rate** - Should decrease significantly
2. **Insights completion rate** - Should increase
3. **Average retry count** - Track how often retries are needed
4. **User satisfaction** - Fewer complaints about timeouts

## Related Files

- `services/clientService.ts` - Main implementation
- `netlify/functions/generate-insights-with-tools.cjs` - Backend endpoint
- `netlify/functions/utils/checkpoint-manager.cjs` - Checkpoint logic
- `netlify/functions/utils/insights-jobs.cjs` - Job management
- `netlify/functions/utils/react-loop.cjs` - ReAct loop with resume support
- `tests/insights-retry-resume.test.js` - Test suite

## Authors

- Implementation: GitHub Copilot
- Review: Pending
- Testing: Automated + Manual pending
