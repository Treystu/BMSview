# Analyze and Insights Endpoints - Comprehensive Fix Summary

## Overview

This document describes the comprehensive fixes applied to the `analyze.cjs` and `generate-insights-with-tools.cjs` endpoints to ensure 100% robust error handling and proper async functionality.

## Analyze Endpoint (`analyze.cjs`)

### New Environment Validation

**Before:** The endpoint would fail with generic errors when environment variables were missing.

**After:** The endpoint validates required environment variables at startup and returns clear, actionable errors:

```javascript
// Validates GEMINI_API_KEY and MONGODB_URI are set
const envValidation = validateEnvironment(log);
if (!envValidation.ok) {
  return errorResponse(503, 'service_unavailable', envValidation.error, envValidation.details, headers);
}
```

**Response for missing environment:**
```json
{
  "error": {
    "code": "service_unavailable",
    "message": "Missing required environment variables: GEMINI_API_KEY, MONGODB_URI",
    "details": {
      "missing": ["GEMINI_API_KEY", "MONGODB_URI"],
      "warnings": [],
      "hasGeminiKey": false,
      "hasMongoUri": false
    }
  }
}
```

### Graceful Degradation

The endpoint now distinguishes between **critical** and **non-critical** operations:

**Critical** (will fail the request):
- Image payload validation
- Analysis pipeline execution
- Gemini API calls

**Non-critical** (will log warnings but continue):
- Idempotency check
- Duplicate detection
- Result storage for deduplication

**Example:**
```javascript
// Non-critical: Idempotency check
try {
  const idemResponse = await checkIdempotency(idemKey, log);
  if (idemResponse) return idemResponse;
} catch (idemError) {
  // Log but continue - idempotency is not critical
  log.warn('Idempotency check failed, continuing with analysis', { error: idemError.message });
}
```

### Better Error Status Codes

**Before:** All errors returned 500 Internal Server Error

**After:** Errors return appropriate HTTP status codes:

| Error Type | Status Code | Error Code |
|-----------|-------------|------------|
| Invalid request | 400 | `invalid_request` |
| Invalid image | 400 | `invalid_image` |
| Timeout | 408 | `analysis_timeout` |
| Rate limit/quota | 429 | `quota_exceeded` |
| Missing environment | 503 | `service_unavailable` |
| Database unavailable | 503 | `database_unavailable` |
| AI service error | 500 | `ai_service_error` |
| Circuit breaker open | 503 | `service_degraded` |
| General failure | 500 | `analysis_failed` |

### Enhanced Error Information

All errors now include:
- `error.code` - Machine-readable error code
- `error.message` - Human-readable message
- `error.details.type` - Error class name (Error, MongoError, etc.)
- `error.details.recoverable` - Whether the error is recoverable (status < 500)

**Example error response:**
```json
{
  "error": {
    "code": "database_unavailable",
    "message": "Failed to get collection history after 2 attempts: connect ECONNREFUSED",
    "details": {
      "type": "MongoServerSelectionError",
      "recoverable": false
    }
  }
}
```

### Comprehensive Logging

All operations now include detailed structured logging:
- Request entry/exit with timing
- Warnings for non-critical failures
- Errors with stack traces and context
- Success metrics (idempotent hits, dedupe hits, etc.)

## Insights Endpoint (`generate-insights-with-tools.cjs`)

### Sync Mode Improvements

**Better Validation:**
```javascript
if (!result || !result.success) {
  const errorMsg = result?.error || 'ReAct loop failed without error details';
  throw new Error(errorMsg);
}
```

**Detailed Success Logging:**
```javascript
log.info('Sync insights completed successfully', {
  durationMs,
  turns: result.turns || 0,
  toolCalls: result.toolCalls || 0,
  hasAnswer: !!result.finalAnswer
});
```

**Graceful Timeout Handling:**
- If sync mode times out (55s), falls back to background mode
- If sync mode fails for other reasons, returns error without fallback

### Background Mode Improvements

**Job Creation Validation:**
```javascript
job = await createInsightsJob(...);
if (!job || !job.id) {
  throw new Error('Job creation returned no job ID');
}
```

**Background Error Tracking:**
```javascript
processInsightsInBackground(...).catch(err => {
  log.error('Background processing error (logged, not thrown)', {
    jobId: job.id,
    error: err.message,
    stack: err.stack
  });
  // Update job status to failed
  updateJobStatus(job.id, 'failed', err.message, log).catch(() => {});
});
```

### Error Status Codes

Similar to analyze endpoint, insights now returns appropriate status codes:

| Error Type | Status Code | Error Code |
|-----------|-------------|------------|
| Invalid parameters | 400 | N/A |
| Timeout | 408 | `insights_timeout` |
| Quota exceeded | 429 | `quota_exceeded` |
| Database unavailable | 503 | `database_unavailable` |
| AI service error | 500 | `ai_service_error` |
| General failure | 500 | `insights_generation_failed` |

### Enhanced Error Responses

```json
{
  "success": false,
  "error": "insights_timeout",
  "message": "TIMEOUT: ReAct loop exceeded 55000ms",
  "details": {
    "type": "Error",
    "recoverable": true
  }
}
```

## Testing

### Analyze Endpoint Tests

✅ **Environment Validation**
- Missing GEMINI_API_KEY → Returns 503 with clear error
- Missing MONGODB_URI → Returns 503 with clear error

✅ **Database Connectivity**
- MongoDB unavailable → Returns 503 (database_unavailable)
- Continues to retry with exponential backoff
- Logs detailed error context

✅ **Request Validation**
- Missing image data → Returns 400 (invalid_image)
- Invalid JSON → Returns 400 (invalid_request)

### Insights Endpoint Tests

✅ **Sync Mode**
- Successful completion with ReAct loop
- Timeout handling with fallback to background
- Error handling with appropriate status codes

✅ **Background Mode**
- Job creation validation
- Background processing error tracking
- Job status updates on failure

## Migration Notes

### Breaking Changes
**None** - All changes are backward compatible

### Recommended Client Changes

Clients should update error handling to check the new error structure:

```typescript
// Old (still works)
if (response.error) {
  console.error(response.error);
}

// New (recommended)
if (response.error) {
  const { code, message, details } = response.error;
  
  if (details.recoverable) {
    // Retry the request
  } else {
    // Show error to user
  }
}
```

### Environment Variables

Ensure these are set in production:
- `GEMINI_API_KEY` - **Required** - Gemini API key
- `MONGODB_URI` - **Required** - MongoDB connection string
- `MONGODB_DB_NAME` or `MONGODB_DB` - **Recommended** - Database name (defaults to "bmsview")

## Performance Impact

### Analyze Endpoint
- **No impact** on happy path (all optimizations are in error paths)
- **Faster failure** for missing environment (fails immediately vs. after DB attempt)
- **Better resilience** for transient errors (graceful degradation)

### Insights Endpoint
- **Faster timeout detection** in sync mode (55s hard limit)
- **Better background job reliability** (status tracking)
- **No performance degradation** in normal operation

## Monitoring & Observability

### Key Metrics to Monitor

**Analyze Endpoint:**
- `statusCode: 503` - Infrastructure issues (DB, API key)
- `statusCode: 408` - Analysis timeouts
- `statusCode: 429` - Rate limiting/quota
- `error.code: database_unavailable` - DB connection issues
- `error.code: ai_service_error` - Gemini API issues

**Insights Endpoint:**
- `mode: sync` success rate
- `mode: background` job completion rate
- Timeout fallbacks from sync to background
- Background job failure rate

### Log Queries

**Find environment configuration errors:**
```
level:ERROR message:"Environment validation failed"
```

**Find database connectivity issues:**
```
level:ERROR error.code:database_unavailable
```

**Find Gemini API issues:**
```
level:ERROR error.code:ai_service_error
```

**Find timeout issues:**
```
level:ERROR error.code:analysis_timeout OR error.code:insights_timeout
```

## Future Improvements

1. **Circuit breaker tuning** - Adjust thresholds based on production metrics
2. **Retry strategies** - Implement per-error-type retry strategies
3. **Caching** - Cache successful analyses for identical images
4. **Health checks** - Add dedicated health check endpoints
5. **Metrics** - Export Prometheus metrics for monitoring
6. **Alerting** - Set up alerts for high error rates

## Files Changed

- `netlify/functions/analyze.cjs` - Comprehensive error handling, environment validation, graceful degradation
- `netlify/functions/generate-insights-with-tools.cjs` - Better error handling, job validation, status tracking

## References

- Error codes defined in `netlify/functions/utils/errors.cjs`
- Logging utilities in `netlify/functions/utils/logger.cjs`
- Retry logic in `netlify/functions/utils/retry.cjs`
- MongoDB utilities in `netlify/functions/utils/mongodb.cjs`
