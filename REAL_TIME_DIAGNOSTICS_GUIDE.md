# Real-Time Admin Diagnostics - Implementation Guide

## Overview

The Admin Diagnostics system has been enhanced to support **real-time individual test updates**. Tests now run in parallel with each test displaying results immediately upon completion, rather than waiting for the slowest test to finish.

## Key Improvements

### ⚡ Real-Time Updates
- **Before**: All tests run together, UI shows results only after all tests complete (up to 40+ seconds)
- **After**: Each test updates the UI immediately when it completes (fast tests show results in ~1-3 seconds)

### 🚀 Parallel Execution
- Tests run concurrently using `Promise.all` for maximum efficiency
- Fast tests (Database, Logging, Content Hashing) complete in 1-3 seconds
- Slow tests (Analyze, Gemini API, Async Analysis) run in background without blocking
- Total execution time = slowest test duration, not sum of all tests

### 🎯 Granular API
- Backend supports `scope` query parameter for individual test execution
- Comma-separated scopes allow running multiple specific tests
- Full backward compatibility with existing POST body `selectedTests`

## Architecture

### Backend: admin-diagnostics.cjs

```javascript
// Query parameter scope support
const queryScope = event.queryStringParameters?.scope;
if (queryScope) {
  // Scope can be single: ?scope=database
  // Or multiple: ?scope=database,gemini,analyze
  const scopeTests = queryScope.split(',').map(t => t.trim()).filter(t => diagnosticTests[t]);
  selectedTests = scopeTests;
}
```

**Supported Scopes:**
- Infrastructure: `database`, `gemini`
- Core Analysis: `analyze`, `insightsWithTools`, `asyncAnalysis`
- Data Management: `history`, `systems`, `dataExport`, `idempotency`
- External Services: `weather`, `backfillWeather`, `backfillHourlyCloud`, `solarEstimate`, `systemAnalytics`, `predictiveMaintenance`
- System Utilities: `contentHashing`, `errorHandling`, `logging`, `retryMechanism`, `timeout`

### Frontend: clientService.ts

```typescript
// New function for running individual tests
export const runSingleDiagnosticTest = async (testScope: string): Promise<DiagnosticTestResult> => {
  const response = await fetch(
    `/.netlify/functions/admin-diagnostics?scope=${encodeURIComponent(testScope)}`,
    { method: 'GET', signal: controller.signal }
  );
  
  const data = await response.json();
  return data.results[0]; // Extract single result
};
```

### Frontend: AdminDashboard.tsx

```typescript
const handleRunDiagnostics = async () => {
  // Run ALL tests in parallel
  const testPromises = selectedTests.map(async (testId) => {
    try {
      const result = await runSingleDiagnosticTest(testId);
      
      // Immediately update UI with this specific test result
      dispatch({ 
        type: 'UPDATE_SINGLE_DIAGNOSTIC_RESULT', 
        payload: { testId, result }
      });
      
      return result;
    } catch (error) {
      // Handle errors gracefully, don't block other tests
      const errorResult = { name: testId, status: 'error', error: error.message };
      dispatch({ type: 'UPDATE_SINGLE_DIAGNOSTIC_RESULT', payload: { testId, result: errorResult } });
      return errorResult;
    }
  });
  
  // Wait for all tests to complete
  await Promise.all(testPromises);
};
```

### State Management: adminState.tsx

```typescript
case 'UPDATE_SINGLE_DIAGNOSTIC_RESULT':
  // Real-time update: replace specific test result as it completes
  const updatedResults = state.diagnosticResults.results.map(r => 
    r.name === action.payload.result.name ? action.payload.result : r
  );
  
  // Recalculate summary in real-time
  const newSummary = {
    total: updatedResults.length,
    success: updatedResults.filter(r => r.status === 'success').length,
    errors: updatedResults.filter(r => r.status === 'error').length
  };
  
  return {
    ...state,
    diagnosticResults: {
      ...state.diagnosticResults,
      results: updatedResults,
      summary: newSummary
    }
  };
```

## API Examples

### Run Single Test
```bash
GET /.netlify/functions/admin-diagnostics?scope=database
```

Response:
```json
{
  "status": "success",
  "results": [{
    "name": "Database Connection",
    "status": "success",
    "duration": 150,
    "details": { "connected": true }
  }],
  "summary": { "total": 1, "success": 1, "errors": 0 }
}
```

### Run Multiple Tests
```bash
GET /.netlify/functions/admin-diagnostics?scope=database,gemini,analyze
```

Response:
```json
{
  "status": "success",
  "results": [
    { "name": "Database Connection", "status": "success", "duration": 150 },
    { "name": "Gemini API", "status": "success", "duration": 2000 },
    { "name": "Analyze Endpoint", "status": "success", "duration": 8500 }
  ],
  "summary": { "total": 3, "success": 3, "errors": 0 }
}
```

### Run All Tests (Default)
```bash
POST /.netlify/functions/admin-diagnostics
```

Or with selected tests in body:
```bash
POST /.netlify/functions/admin-diagnostics
Content-Type: application/json

{
  "selectedTests": ["database", "gemini", "analyze"]
}
```

## UI Behavior

### Execution Flow
1. **User clicks "Run Diagnostics"**
   - Modal opens immediately
   - All selected tests show as "running" status

2. **Tests Execute in Parallel**
   - Fast tests (Database, Logging): Complete in 1-3 seconds
   - Medium tests (History, Systems): Complete in 3-10 seconds
   - Slow tests (Analyze, Gemini): Complete in 10-40 seconds

3. **Real-Time Updates**
   - Each test updates its row immediately when complete
   - Summary statistics update in real-time
   - Progress bar shows percentage completion

4. **Final State**
   - Overall status calculated (success/partial/error)
   - Duration shows total elapsed time
   - All test results visible with expand/collapse details

### Visual Indicators

```
┌─────────────────────────────────────────┐
│ System Diagnostics                    × │
├─────────────────────────────────────────┤
│                                         │
│ 🔵 Tests Running in Parallel... (3/5)  │
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░ 60%              │
│                                         │
│ Test Results:                           │
│ ✓ Database Connection      150ms       │
│ ✓ Gemini API              2000ms       │
│ ⏳ Analyze Endpoint      running...    │
│ ⏳ Async Analysis        running...    │
│ ✓ History Endpoint         800ms       │
│                                         │
└─────────────────────────────────────────┘
```

## Performance Comparison

### Before (Monolithic Execution)
```
Total Time: 42 seconds (sum of slowest tests)
User Experience: Blank screen for 42 seconds, then all results

Timeline:
0s  ─────────────────────────────────────── 42s
    [=========== Waiting ===========] [Results]
```

### After (Parallel Real-Time Execution)
```
Total Time: 40 seconds (duration of slowest test only)
User Experience: Results stream in as tests complete

Timeline:
0s  ───┬───┬────────┬──────────────────────── 40s
       │   │        │
       │   │        └─ Analyze (40s)
       │   └─ Gemini (8s)
       └─ Database (2s)

User sees Database result at 2s, not 42s!
```

## Testing

### Unit Tests (admin-diagnostics-scope.test.js)

20 comprehensive tests covering:
- ✅ Query parameter scope support
- ✅ Backward compatibility
- ✅ Individual test execution
- ✅ Parallel execution timing
- ✅ Error handling
- ✅ Response format validation
- ✅ Real-time update logic

Run tests:
```bash
npm test -- admin-diagnostics-scope.test.js
```

### Manual Testing

1. **Fast Test Only**
   ```
   Select: Database Connection
   Expected: Result in ~2 seconds
   ```

2. **Mixed Speed Tests**
   ```
   Select: Database, Gemini, Analyze
   Expected: Database result at 2s, Gemini at 8s, Analyze at 40s
   ```

3. **All Tests**
   ```
   Select: All 20 tests
   Expected: Fast tests complete first, slow tests stream in
   Total time: ~40s (not 100+ seconds)
   ```

## Backward Compatibility

All existing diagnostic workflows continue to work:

### Old API (Still Supported)
```javascript
// POST with selectedTests array
runDiagnostics(['database', 'gemini', 'analyze']);
```

### New API (Recommended)
```javascript
// Individual test execution
runSingleDiagnosticTest('database');
runSingleDiagnosticTest('gemini');
runSingleDiagnosticTest('analyze');
```

## Error Handling

Each test handles errors independently:

```javascript
// Test 1 fails, Test 2 succeeds, Test 3 succeeds
Results:
✗ Database Connection: "Connection timeout"
✓ Gemini API: Success
✓ History Endpoint: Success

Summary: 2 passed, 1 failed
Status: partial
```

## Future Enhancements

Potential improvements:
- [ ] Server-Sent Events (SSE) for true streaming
- [ ] WebSocket connection for bidirectional updates
- [ ] Test prioritization (run critical tests first)
- [ ] Retry failed tests individually
- [ ] Save diagnostic history for trending
- [ ] Export diagnostic reports

## Migration Guide

No code changes needed for existing users! The new system is fully backward compatible.

To opt-in to the new real-time behavior:
1. Update to latest version
2. Run diagnostics as normal
3. Enjoy real-time updates automatically

## Troubleshooting

### Issue: Tests still run sequentially
**Solution**: Ensure you're on the latest version and the `scope` parameter is being used

### Issue: Some tests show "running" forever
**Solution**: Check for timeout issues or network problems. Individual test timeout is 120 seconds.

### Issue: UI doesn't update in real-time
**Solution**: Verify the `UPDATE_SINGLE_DIAGNOSTIC_RESULT` action is dispatched correctly

## Support

For issues or questions:
1. Check test output: `npm test -- admin-diagnostics-scope.test.js`
2. Review Netlify function logs for backend errors
3. Check browser console for frontend errors
4. File an issue with reproduction steps
