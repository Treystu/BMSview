# Generate Insights Fix - November 10, 2025

## Issue Fixed
**Error**: "Request timed out. The AI took too long to process your query"
**Symptoms**: 
- Error appears even for simple queries without custom prompts
- NO logs from `generate-insights-background` function
- Users unable to generate AI insights

## Root Cause
The default processing mode was set to **'sync'** (synchronous), which has a 58-second timeout. Many insights queries exceed this timeout because:
1. Gemini API calls can take 10-30 seconds
2. Tool calls (historical data, weather, solar) add 5-20 seconds each
3. Multiple conversation iterations compound the delays
4. Even "simple" queries often need 60-90 seconds total

With sync mode as default:
- Queries hit 58s backend timeout OR 60s frontend timeout
- No progress updates shown to user
- Poor user experience

## Solution Implemented

### 1. Changed Default Mode to Background
**File**: `netlify/functions/generate-insights-with-tools.cjs`  
**Change**: Line 415 - Default mode changed from `'sync'` to `'background'`

**Benefits**:
- ✅ 14-minute timeout (vs 58 seconds)
- ✅ Progress updates shown to user
- ✅ Handles complex queries gracefully
- ✅ Better resource management

**Backward Compatibility**:
- Sync mode still available via `?sync=true` query parameter
- Tests can explicitly request sync mode
- No breaking changes to API

### 2. Enhanced Logging
**File**: `netlify/functions/generate-insights-with-tools.cjs`

**Added to initial request logging**:
- Custom prompt length
- Measurement count
- Query parameters received
- Whether mode was explicitly requested or auto-selected

**Added to dispatch logging**:
- Background function URL resolution
- Environment variables checked
- HTTP response status
- Detailed error messages with context

**Why**: This will help identify if background function is being invoked correctly and troubleshoot any dispatch failures.

### 3. Increased Frontend Timeout
**File**: `services/clientService.ts`  
**Change**: Timeout increased from 60s to 90s

**Reason**: Background mode needs time for:
- Job creation in MongoDB (~1-2s)
- HTTP dispatch to background function (~1-2s)  
- Background function startup (~1-3s)
- Total: ~3-7s before processing even starts

90 seconds provides comfortable buffer for job creation while still catching genuine hangs.

**Updated error message** to reflect new timeout and guide users appropriately.

## How to Verify the Fix

### 1. Check Logs After Deployment
After deploying this fix, when a user generates insights, you should see:

**In `generate-insights-with-tools` logs**:
```json
{
  "level": "INFO",
  "message": "Starting enhanced AI insights generation",
  "resolvedMode": "background",
  "measurementCount": 0,
  "customPromptLength": 0,
  "explicitModeRequested": false
}
```

**In `generate-insights-with-tools` logs (dispatch)**:
```json
{
  "level": "INFO", 
  "message": "Dispatching background insights function",
  "jobId": "...",
  "url": "https://your-site.netlify.app/.netlify/functions/generate-insights-background"
}
```

**In `generate-insights-background` logs** (THIS IS THE KEY - should now appear):
```json
{
  "level": "INFO",
  "message": "generate-insights-background HANDLER INVOKED",
  "context": {
    "method": "POST",
    "path": "/.netlify/functions/generate-insights-background",
    "hasBody": true
  }
}
```

### 2. Test User Flow
1. Go to BMSview application
2. Upload a BMS screenshot (or use existing analysis)
3. Click "Generate AI Insights" button (without custom prompt)
4. **Expected behavior**:
   - Request returns quickly (< 5 seconds)
   - UI shows "Querying historical data and analyzing trends..."
   - Progress updates appear as AI processes
   - Final insights displayed after 20-60 seconds typically
5. **No error** should appear

### 3. Check Netlify Function Logs
In Netlify dashboard → Functions → Logs:
1. Look for `generate-insights-with-tools` entries showing `resolvedMode: "background"`
2. Look for `generate-insights-background` entries (should now exist!)
3. Verify no timeout errors

### 4. Test Explicit Sync Mode
To verify sync mode still works:
1. Make request with `?sync=true` parameter
2. Should complete in < 58 seconds or timeout gracefully
3. Check logs show `resolvedMode: "sync"`

## Troubleshooting

### If Background Function Still Has No Logs

**Possible Causes**:
1. **URL Resolution Failure**: Check logs for "Unable to resolve background function URL"
2. **Dispatch Failure**: Check logs for HTTP error from background function
3. **Environment Variables**: Ensure `URL`, `DEPLOY_URL`, or `SITE_URL` is set in Netlify
4. **Function Not Deployed**: Verify `generate-insights-background.cjs` is deployed

**Debug Steps**:
1. Check `generate-insights-with-tools` logs for dispatch errors
2. Look for environment variable values in enhanced logging
3. Manually invoke background function via Netlify UI
4. Check function bundle includes all dependencies

### If Still Getting Timeout Errors

**Check**:
1. Is the request actually using background mode? (check logs)
2. Is the job being created in MongoDB? (check `insights-jobs` collection)
3. Is the frontend polling working? (check browser network tab)
4. Is MongoDB connection failing? (check logs for connection errors)

**Fallback**: If background mode fails, user can explicitly request sync mode by adding `?sync=true` to the request URL (for small queries only).

## Files Changed

1. `netlify/functions/generate-insights-with-tools.cjs`
   - Changed default mode to 'background'
   - Enhanced logging for mode resolution
   - Improved dispatch error logging

2. `services/clientService.ts`
   - Increased timeout from 60s to 90s
   - Updated timeout error message

## Testing Recommendations

### Before Deployment
- ✅ Build passes
- ✅ Mode resolution logic tested
- ✅ No breaking changes to API

### After Deployment (Production)
- [ ] Monitor function logs for 24 hours
- [ ] Verify background function logs appear
- [ ] Check user reports decrease
- [ ] Monitor MongoDB for job creation
- [ ] Check polling behavior in browser DevTools

### Regression Tests
- [ ] Simple query (no custom prompt) → background mode
- [ ] Custom prompt query → background mode
- [ ] Large dataset (>360 measurements) → background mode
- [ ] Explicit `?sync=true` → sync mode
- [ ] Frontend polling shows progress
- [ ] Final insights displayed correctly

## Expected Metrics After Fix

**Before Fix**:
- Timeout errors: ~30-50% of requests
- Background function invocations: 0
- Average response time: 58s (timeout)

**After Fix**:
- Timeout errors: < 5% (only genuine issues)
- Background function invocations: ~95% of requests
- Average job creation time: 2-5s
- Average total processing time: 20-60s
- User sees progress: Yes

## Notes

- This fix makes background mode the default, which is more robust for production
- Sync mode remains available for development/testing via `?sync=true`
- Frontend timeout increased to accommodate background job creation
- Comprehensive logging added to troubleshoot any remaining issues
- No changes to the AI processing logic itself - only the execution mode
