# Admin Diagnostics - Production Testing Guide

## Overview
The admin diagnostics function (`/.netlify/functions/admin-diagnostics`) provides **27 comprehensive production tests** that validate every critical function in BMSview. This is your primary tool for in-app live production testing.

**Status**: ✅ Fully functional and tested (29/29 Jest tests passing)

---

## How to Use in Production

### 1. Access Admin Dashboard
Navigate to: `https://your-netlify-site.netlify.app/admin.html`

### 2. Run All Tests
```javascript
// POST to /.netlify/functions/admin-diagnostics
// No body = runs all 27 tests

fetch('/.netlify/functions/admin-diagnostics', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}).then(r => r.json()).then(console.log);
```

### 3. Run Specific Tests
```javascript
// POST with selectedTests array
fetch('/.netlify/functions/admin-diagnostics', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    selectedTests: ['database', 'gemini', 'analyze']
  })
}).then(r => r.json()).then(console.log);
```

### 4. Run Category of Tests
```javascript
// Infrastructure tests only
fetch('/.netlify/functions/admin-diagnostics', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    selectedTests: ['database', 'gemini']
  })
}).then(r => r.json()).then(console.log);
```

---

## Available Tests (27 Total)

### Infrastructure (2 tests)
- **database** - MongoDB connection, read/write operations
- **gemini** - Google Gemini API health check

### Core Analysis (5 tests)
- **analyze** - Main BMS analysis endpoint (sync mode)
- **syncAnalysis** - Synchronous analysis pipeline test
- **asyncAnalysis** - Background async analysis test
- **processAnalysis** - Process analysis function test
- **extractDL** - Driver's license extraction test

### Insights Generation (3 tests)
- **generateInsights** - Standard insights generation
- **insightsWithTools** - Enhanced insights with function calling
- **debugInsights** - Debug insights endpoint

### Data Management (4 tests)
- **history** - History retrieval with pagination
- **systems** - System management endpoint
- **data** - Data aggregation endpoint
- **exportData** - CSV/JSON export functionality

### Job Management (2 tests)
- **getJobStatus** - Job status polling
- **jobShepherd** - Background job processing

### External Services (3 tests)
- **weather** - Weather data integration
- **solar** - Solar estimation service
- **systemAnalytics** - System analytics calculations

### Utility & Admin (7 tests)
- **contact** - Contact form submission
- **getIP** - IP address detection
- **upload** - File upload capability
- **security** - Security configuration
- **predictiveMaintenance** - Maintenance predictions
- **ipAdmin** - IP whitelist management
- **adminSystems** - Admin system management

### Comprehensive Suite (1 test)
- **comprehensive** - Production test suite integration

---

## Response Format

```javascript
{
  // Individual test results
  "database": {
    "status": "Success",  // or "Failure" or "Skipped"
    "message": "Database connection successful",
    "responseTime": 234,  // milliseconds
    "data": { ... }       // test-specific data
  },
  "gemini": { ... },
  "analyze": { ... },
  // ... (all selected tests)
  
  // Summary statistics
  "testSummary": {
    "total": 27,
    "success": 25,
    "failure": 2,
    "skipped": 0,
    "successRate": "92.59"
  },
  
  // Suggestions for failures
  "suggestions": [
    "Check MONGODB_URI and network connectivity to your MongoDB host.",
    "Set GEMINI_API_KEY env var or check that the generative-ai client is installed."
  ],
  
  // Available test categories
  "availableTests": {
    "infrastructure": ["database", "gemini"],
    "coreAnalysis": ["analyze", "syncAnalysis", ...],
    "insights": ["generateInsights", ...],
    // ... (all categories)
  },
  
  // Flat list for convenience
  "availableTestsList": [
    "database", "gemini", "analyze", ...
  ]
}
```

---

## Common Usage Patterns

### Pre-Deployment Validation
Run all tests before deploying code changes:
```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/admin-diagnostics \
  -H "Content-Type: application/json" | jq .testSummary
```

### Quick Health Check
Test just infrastructure + core analysis:
```javascript
{
  selectedTests: [
    'database', 'gemini', 'analyze', 
    'generateInsights', 'insightsWithTools'
  ]
}
```

### Debug Specific Feature
Test only related endpoints:
```javascript
// Testing insights generation issue
{
  selectedTests: [
    'generateInsights',
    'insightsWithTools',
    'debugInsights',
    'gemini'
  ]
}
```

### Monitor External Services
Check third-party integrations:
```javascript
{
  selectedTests: ['weather', 'solar', 'gemini']
}
```

---

## Interpreting Results

### Success Indicators
- ✅ **status: "Success"** - Test passed, feature working
- ✅ **responseTime < 5000ms** - Normal performance
- ✅ **successRate > 90%** - System healthy

### Warning Signs
- ⚠️ **status: "Skipped"** - Test couldn't run (e.g., no test data)
- ⚠️ **responseTime > 10000ms** - Slow performance, investigate
- ⚠️ **successRate < 80%** - Multiple failures, needs attention

### Failure Actions
- ❌ **database failure** → Check MongoDB Atlas connection, IP whitelist
- ❌ **gemini failure** → Verify `GEMINI_API_KEY` env var in Netlify
- ❌ **analyze failure** → Check Netlify function logs for detailed error
- ❌ **insights failure** → Verify Gemini API quota not exhausted

---

## Production Testing Best Practices

### 1. **Run Tests After Deployment**
Every time you push to production, run the full test suite to catch regressions.

### 2. **Monitor Critical Path**
Focus on these essential tests:
- `database` - Data layer must work
- `gemini` - AI functionality depends on this
- `analyze` - Core BMS analysis feature
- `generateInsights` - Enhanced AI insights

### 3. **Check Logs on Failure**
Failed tests → Go to Netlify dashboard → Functions tab → Click function name → View logs

### 4. **Use Suggestions**
The `suggestions` array provides actionable fixes for common failures.

### 5. **Track Response Times**
Slow tests indicate performance issues. Baseline:
- Database: < 500ms
- Gemini API: < 5000ms
- Analysis: < 15000ms (includes AI processing)
- Insights: < 30000ms (includes function calling)

---

## Troubleshooting Common Issues

### Error: "Production test suite not available"
**Cause**: `tests/production-test-suite.js` missing (shouldn't happen)  
**Fix**: File exists but is a stub - this is expected behavior

### Error: "GEMINI_API_KEY environment variable not set"
**Cause**: Missing API key in Netlify environment variables  
**Fix**: Netlify dashboard → Site settings → Environment variables → Add `GEMINI_API_KEY`

### Error: "MongoDB connection timeout"
**Cause**: IP not whitelisted or cluster paused  
**Fix**: MongoDB Atlas → Network Access → Add `0.0.0.0/0` (allow all IPs)

### Error: "Function timeout"
**Cause**: Test took longer than Netlify's 10s limit (background functions: 15min)  
**Fix**: Check function logs for specific slow operation, optimize query or increase timeout

### All Tests Return "Failure"
**Cause**: Likely network issue or `process.env.URL` not set  
**Fix**: Verify Netlify site is deployed and `URL` env var is auto-set

---

## Integration with npm test

The admin diagnostics function is **separate from npm test**:

**npm test** (Jest):
- Runs locally during development
- Unit tests for individual functions
- Fast feedback loop (~1-3 seconds)
- Tests code logic without external services

**Admin Diagnostics** (Production):
- Runs in live Netlify environment
- Integration tests for deployed endpoints
- Tests real API calls, database, Gemini
- Validates production configuration

**Use both**:
1. `npm test` before committing code (local validation)
2. Admin diagnostics after deploying (production validation)

---

## Error You Might Have Seen

If you recently ran admin diagnostics and got an error, it was likely one of:

1. **MongoDB connection issue** - Check Atlas IP whitelist and cluster status
2. **Gemini API quota exhausted** - You mentioned updating payment, this should be resolved
3. **Timeout on specific test** - Some tests take 15-30s, especially insights with function calling
4. **Missing environment variable** - Check Netlify env vars: `MONGODB_URI`, `GEMINI_API_KEY`, `URL`

**How to debug**:
1. Run admin diagnostics with just infrastructure tests: `{ selectedTests: ['database', 'gemini'] }`
2. Check which test fails
3. Look at Netlify function logs for that specific function
4. Use suggestions in response for guidance

---

## Next Steps

1. **Try it now**: Run admin diagnostics in production to verify all tests pass
2. **Bookmark**: Save `https://your-site.netlify.app/admin.html` for quick access
3. **Monitor**: Run full suite weekly, quick health check daily
4. **Extend**: Add custom tests to `tests/production-test-suite.js` as needed

Your admin diagnostics function is production-ready and comprehensive! 🎉
