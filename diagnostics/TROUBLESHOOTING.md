# Admin Diagnostics Troubleshooting Guide

## Overview

The Admin Diagnostics suite tests critical BMSview functionality including database connectivity, analysis pipelines, external services (weather, Gemini), and system health. This guide helps diagnose and fix failures.

## Test Categories & Common Issues

### Database Connection Test

**What it does:** Tests MongoDB connectivity and basic read/write operations.

**Common Failures:**
- ❌ `Connection timeout` → MongoDB URI is unreachable or network blocked
  - **Fix:** Verify `MONGODB_URI` environment variable; check IP allowlist on MongoDB Atlas
- ❌ `Authentication failed` → Invalid credentials
  - **Fix:** Re-generate MongoDB connection string in Atlas dashboard
- ❌ `Insufficient permissions` → User lacks write/delete permissions
  - **Fix:** Update user role in MongoDB Atlas to have at least `readWrite` on `bmsview` database

### Synchronous Analysis Test

**What it does:** Tests the real-time image analysis pipeline (Gemini API integration).

**Common Failures:**
- ❌ `GEMINI_API_KEY not set` → Missing API key
  - **Fix:** Add `GEMINI_API_KEY` to environment variables; restart Netlify functions
- ❌ `API quota exceeded` → Too many requests in short period
  - **Fix:** Wait 60 seconds; check quota at https://console.cloud.google.com/
- ❌ `Model not available` → Gemini 2.5 Flash not accessible
  - **Fix:** Verify model name in `.env` matches current available model; update if needed
- ❌ `Invalid image format` → Base64 encoding issue
  - **Fix:** Ensure image is valid PNG/JPEG; check base64 encoding not corrupted

### Asynchronous Analysis Test

**What it does:** Tests background job processing (legacy async flow).

**Common Failures:**
- ❌ `Process-analysis function not responding` → Function timeout or crash
  - **Fix:** Check Netlify logs for `process-analysis.cjs` errors; verify MongoDB connectivity
- ❌ `Job polling timed out` → Job never completed within 10 attempts
  - **Fix:** Check jobs collection in MongoDB for stuck records; may need manual cleanup

### Weather Service Test

**What it does:** Tests external weather API integration with POST payload validation.

**Common Failures:**
- ❌ `405 Method Not Allowed` → GET request used instead of POST
  - **Fix:** Weather function only accepts POST; verify `callWeatherFunction` in `analysis-pipeline` sends POST
- ❌ `400 Bad Request` → Missing required fields (lat, lon)
  - **Fix:** Ensure BMS system has valid latitude/longitude; check `updateSystemMetadata`
- ❌ `502 Bad Gateway` → External weather service unreachable
  - **Fix:** Check network connectivity; external service may be down; check logs

---

## Partial Failure Handling

**Important:** Individual test failures do **NOT** crash the diagnostics suite. Other tests continue running.

If you see:
- ✔️ Some tests pass, ❌ others fail → **This is expected behavior**
- Review each failed test independently
- Fix upstream dependencies first (e.g., DB before analysis tests)
- Retry diagnostics after fixes

---

## Recommended Fix Order

1. **Database Connection** → Fix MongoDB first (all tests depend on this)
2. **Weather Service** → Fix external APIs next
3. **Sync/Async Analysis** → Fix Gemini and pipeline last

---

## Debugging Failed Tests

### Step 1: Check Test Details
Click **"Details"** button on any failed test to expand full error output and stack trace.

### Step 2: Review Netlify Logs
```bash
netlify logs --function admin-diagnostics
```

### Step 3: Check Environment Variables
Verify all required env vars are set:
- `GEMINI_API_KEY` (Google Gemini)
- `MONGODB_URI` (MongoDB Atlas)
- `MONGODB_DB_NAME` (database name, default: `bmsview`)
- `URL` or `DEPLOY_URL` (for function invocations)

### Step 4: Manual API Testing
Test individual endpoints directly:
```bash
# Test weather service
curl -X POST http://localhost:8888/.netlify/functions/weather \
  -H "Content-Type: application/json" \
  -d '{"lat": 38.8, "lon": -104.8, "timestamp": "2025-11-09T15:00:00Z"}'

# Test analysis function
curl -X POST http://localhost:8888/.netlify/functions/analyze \
  -H "Content-Type: application/json" \
  -d '{"image": "...", "sync": true}'
```

---

## Performance Expectations

| Test | Expected Duration | Max Timeout |
| --- | --- | --- |
| Database Connection | < 500ms | 5s |
| Sync Analysis | 2-5s (Gemini) | 15s |
| Async Analysis | 5-10s (with polling) | 30s |
| Weather Service | < 1s | 5s |

If tests exceed max timeout, check network latency and service availability.

---

## Reporting Issues

When opening an issue for a failed diagnostic test:

1. **Run diagnostics** and note which tests fail
2. **Expand error details** and copy the full error message
3. **Check Netlify logs** for any backend context
4. **Verify environment**: Are you on localhost, staging, or production?
5. **Include the test summary** (pass/fail counts)

Example issue:
```
Sync Analysis test failing with "GEMINI_API_KEY not set"
- Environment: netlify dev (localhost)
- Error details: [expand Details button]
- Netlify logs show: [paste relevant logs]
- Environment vars checked: ✓ GEMINI_API_KEY present
```

---

## Self-Healing Diagnostics

The diagnostics suite includes:
- ✅ **Error recovery:** One failed test doesn't crash others
- ✅ **Partial results:** You get feedback even if some tests fail
- ✅ **Actionable messages:** Errors suggest fixes (e.g., "Check GEMINI_API_KEY")
- ✅ **Timeout handling:** All tests have built-in timeouts

---

## Next Steps

- Run diagnostics regularly (especially after deployments)
- Review failures in order of dependency
- Check this guide for your specific error message
- If stuck, capture test details and check Netlify function logs
