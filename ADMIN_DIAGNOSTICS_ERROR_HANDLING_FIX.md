# Admin Diagnostics Function - Error Handling Fix

## Summary

Fixed the admin-diagnostics.cjs Netlify function to ensure that ALL tests return structured error results instead of throwing exceptions that break the entire diagnostic run.

## Problem Statement

The admin-diagnostics function had 18 diagnostic tests, but when certain tests (specifically `analyze` and `asyncAnalysis`) encountered errors, they would throw exceptions that broke the entire diagnostic function. This made it impossible to run a complete diagnostic suite and see which tests passed vs. failed.

### Specific Issues

1. **Analyze Endpoint Test**: Used fake test data (JSON stringified as a Base64 image) which caused unpredictable failures in the Gemini API or analysis pipeline
2. **Async Analysis Test**: Job creation and polling could timeout or fail, causing uncaught exceptions
3. **Insights with Tools Test**: Similar job creation issues
4. **General**: While try-catch blocks existed, certain error paths still threw exceptions

## Solution

Implemented **multi-layer error handling** across all diagnostic tests:

### Layer 1: Individual Operation Protection
Each test now wraps individual operations (stages, steps) in their own try-catch blocks:

```javascript
// Example from analyze test
try {
  logger.info('Stage 2/4: Extracting data from image...');
  analysisResult = await executeWithTimeout(async () => {
    return await performAnalysisPipeline(...);
  }, { testName: 'Analysis Pipeline', timeout: 25000, retries: 0 });
  
  testResults.stages.push({
    stage: 'extraction',
    status: 'success',
    // ... success details
  });
} catch (extractionError) {
  const errorDetails = formatError(extractionError, { testId, stage: 'extraction' });
  testResults.stages.push({
    stage: 'extraction',
    status: 'error',
    error: errorDetails.message,
    errorDetails,
    note: 'This test uses fake data and may fail at Gemini API - this is expected'
  });
  // Return early with partial results instead of throwing
  return earlyErrorResult;
}
```

### Layer 2: Test-Level Protection
Each test function has a comprehensive try-catch wrapper that ensures it ALWAYS returns a result object:

```javascript
async (testId) => {
  const testResults = {
    name: 'Test Name',
    status: 'running',
    // ... other fields
  };
  
  try {
    // Test logic here
    return testResults;
  } catch (error) {
    // Final safety net - catch ANY uncaught errors
    const errorDetails = formatError(error, { testId });
    return {
      name: 'Test Name',
      status: 'error',
      error: errorDetails.message,
      details: { errorDetails }
    };
  }
}
```

### Layer 3: Handler-Level Protection
The main handler wraps each test invocation with:
- Individual test timeout (2 minutes max)
- Result validation
- Ultimate safety net try-catch

```javascript
for (const testName of selectedTests) {
  try {
    // Wrap with timeout
    const result = await Promise.race([
      diagnosticTests[testName](testId),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Test exceeded timeout`)), 120000)
      )
    ]);
    
    // Validate result has required fields
    if (!result?.name) result.name = testName;
    if (!result?.status) result.status = 'unknown';
    
    results.push(result);
  } catch (testError) {
    // Convert exception to error result
    const errorResult = {
      name: testName,
      status: 'error',
      error: testError.message,
      details: { errorDetails: formatError(testError) }
    };
    results.push(errorResult);
  }
}
```

## Key Changes

### 1. Analyze Test
- Added granular try-catch for each stage (initialization, extraction, validation, storage)
- Reduced retries from 2 to 0 (fail fast for diagnostics)
- Returns early with partial results on extraction failure
- Includes helpful notes about why failures are expected with fake test data

### 2. Async Analysis Test
- Added try-catch around job creation
- Added try-catch around individual status polling calls
- Reduced timeout from 60s to 30s for faster diagnostics
- Always attempts cleanup even on failure
- Tracks job lifecycle events for debugging

### 3. Insights with Tools Test
- Added try-catch around job creation
- Added try-catch around job retrieval
- Added try-catch around cleanup
- Handles partial success (e.g., job created but ReAct loop failed)

### 4. Main Handler
- Added per-test timeout protection (2 min max)
- Added result validation to ensure all results have required fields
- Enhanced error logging with duration tracking
- Always returns HTTP 200 with structured results (never throws to Netlify)

## Testing

Verified the fixes work correctly by:

1. **Test with missing MongoDB**: Tests fail gracefully with structured error results
2. **Test with missing Gemini API key**: Tests fail gracefully with structured error results
3. **Test with fake data**: Extraction fails as expected but doesn't break the function
4. **Timeout test**: Jobs that timeout are properly caught and reported

### Example Test Output

```json
{
  "status": "error",
  "testId": "diag_test_1763620173777_8d859704",
  "summary": {
    "total": 2,
    "success": 0,
    "partial": 0,
    "warnings": 0,
    "errors": 2
  },
  "results": [
    {
      "name": "Analyze Endpoint",
      "status": "error",
      "duration": 22028,
      "stages": [
        {
          "stage": "initialization",
          "status": "success"
        },
        {
          "stage": "extraction",
          "status": "error",
          "error": "Failed to get collection history after 2 attempts: connect ECONNREFUSED",
          "errorDetails": { ... }
        }
      ]
    },
    {
      "name": "Asynchronous Insights (Background)",
      "status": "error",
      "duration": 10004,
      "error": "TIMEOUT: Create Insights Job exceeded 10000ms limit",
      "jobLifecycle": [
        {
          "event": "creation_failed",
          "error": "...",
          "time": 10004
        }
      ]
    }
  ]
}
```

## Benefits

1. ✅ **No more broken diagnostics**: All 18 tests can run to completion even if some fail
2. ✅ **Better visibility**: See exactly which tests pass, which fail, and why
3. ✅ **Graceful degradation**: Tests that fail partway through report partial results
4. ✅ **Comprehensive error reporting**: Full error details including stack traces, context, and metadata
5. ✅ **No hanging**: All operations have timeouts and fail fast
6. ✅ **Proper cleanup**: Resources are cleaned up even when tests fail
7. ✅ **Helpful debugging**: Detailed logging shows exactly where and why tests fail

## Future Improvements

While the error handling is now robust, the tests could be improved by:

1. **Mock Gemini responses**: Instead of calling the real API with fake data, mock successful responses
2. **Mock MongoDB**: Use an in-memory MongoDB for testing
3. **Smaller unit tests**: Break complex tests into smaller, more focused tests
4. **Parallel execution**: Run independent tests in parallel for faster diagnostics
5. **Test fixtures**: Use real BMS screenshot samples for more realistic testing

## Files Changed

- `netlify/functions/admin-diagnostics.cjs` - Comprehensive error handling improvements

## Related Documentation

- See `/home/runner/work/BMSview/BMSview/ADMIN_DIAGNOSTICS_*.md` for previous diagnostic function updates
- See `/home/runner/work/BMSview/BMSview/netlify/functions/utils/logger.cjs` for structured logging implementation
- See `/home/runner/work/BMSview/BMSview/netlify/functions/utils/errors.cjs` for error formatting utilities
