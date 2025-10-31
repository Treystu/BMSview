# Quick Fix Guide - Gemini API 404 Error

## What Was Wrong?
The model name `gemini-1.5-flash-latest` doesn't exist in the Gemini API, causing 404 errors.

## What Was Fixed?
Changed to the correct model name: `gemini-1.5-flash`

## Files Changed
- `netlify/functions/utils/analysis-pipeline.js` - Fixed model name and improved error handling

## How to Verify the Fix

### Option 1: Run the Test Script
```bash
cd BMSview
export GEMINI_API_KEY=your_api_key
node test-gemini-fix.js
```

### Option 2: Check Netlify Logs
After deployment, upload a BMS screenshot and check the logs. You should see:
- ✅ "Sending request to Gemini API via custom client"
- ✅ "Received response from Gemini API via custom client"
- ✅ No more 404 errors

### Option 3: Test in Production
1. Go to your BMSview app
2. Upload a BMS screenshot
3. The analysis should complete successfully

## Environment Variables to Check
Make sure these are set in Netlify:
- `GEMINI_API_KEY` - Your Google Gemini API key (required)
- `GEMINI_MODEL` - Optional, defaults to `gemini-1.5-flash`

## Next Steps
1. ✅ PR Created: https://github.com/Treystu/BMSview/pull/21
2. ⏳ Review and merge the PR
3. ⏳ Netlify will auto-deploy
4. ⏳ Test with a real BMS screenshot

## If Issues Persist
Check the error logs for:
- "GEMINI_API_KEY not configured" → Set the environment variable
- "Model not found" → Check the model name
- "Rate limit exceeded" → Wait or upgrade API quota
- "Circuit breaker is OPEN" → Wait 60 seconds for it to reset

## Support
If you need help, check:
- Full summary: `GEMINI_FIX_SUMMARY.md`
- Test script: `test-gemini-fix.js`
- PR discussion: https://github.com/Treystu/BMSview/pull/21