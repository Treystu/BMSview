# Critical Issues Identified in BMSView

## Issue #1: Response Body Read Twice (CRITICAL)
**Location:** `services/geminiService.ts` lines 79-81
**Problem:** 
```typescript
try { 
    errorBody = await response.json(); 
} catch { 
    errorBody = await response.text(); 
}
```
Once a response body stream is consumed, it cannot be read again. This causes the error:
`Failed to execute 'text' on 'Response': body stream already read`

**Fix:** Read the response as text first, then try to parse as JSON:
```typescript
try {
    const errorText = await response.text();
    try {
        errorBody = JSON.parse(errorText);
    } catch {
        errorBody = errorText;
    }
} catch {
    errorBody = 'Failed to read error response';
}
```

## Issue #2: Silent Failure in Job Invocation
**Location:** `netlify/functions/analyze.js` - `invokeProcessor` function
**Problem:** The fire-and-forget fetch silently catches all errors:
```javascript
fetch(invokeUrl, {...}).catch(error => {
    log('error', 'Failed to invoke background processor.', { jobId, errorMessage: error.message });
});
```
This means jobs are created but never processed if the invocation fails.

**Fix:** Make the invocation more robust with proper error handling and logging.

## Issue #3: Enhanced Function Duplicates
**Files to Remove:**
- `netlify/functions/analyze-enhanced.js`
- `netlify/functions/get-job-status-enhanced.js`
- `netlify/functions/get-job-status-optimized.js`
- `netlify/functions/job-shepherd-enhanced.js`
- `netlify/functions/process-analysis-enhanced.js`

**Action:** Delete these files and ensure main functions have all necessary improvements.

## Issue #4: Missing Logs for process-analysis
**Problem:** No logs appearing for process-analysis function execution
**Possible Causes:**
1. Function not being invoked at all (due to Issue #2)
2. Background function configuration issue
3. Logging not properly configured

**Fix:** Improve invocation reliability and add comprehensive logging.

## Issue #5: Jobs Stuck in "Queued" Status
**Root Cause:** Combination of Issues #2 and #4
- Jobs are created successfully
- process-analysis invocation fails silently
- job-shepherd doesn't pick up queued jobs (only processes 2 at a time)
- Jobs remain in "Queued" forever

**Fix:** 
1. Fix the invocation mechanism
2. Improve job-shepherd to handle failed invocations
3. Add retry logic for stuck jobs

## Issue #6: Missing Features
**Historical Chart Averaging:**
- Need on/off toggle
- Need time bucket selector
- Need to match zoom scale

**Date Detection:**
- Need date selector popup when unclear
- Need manual date modification in admin
- Need better filename parsing

## Issue #7: Admin Upload Failures
**Problem:** Excessive failures in admin upload flow
**Investigation Needed:** Check if admin uses different code path than main app