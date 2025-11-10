# Comprehensive Logging Strategy for Netlify Functions

## Overview

This document outlines the cohesive debug-level logging strategy implemented across all Netlify Functions in the BMS View application. All functions now use structured JSON logging that integrates seamlessly with Netlify's logging infrastructure.

## Logging Architecture

### Core Logger (`netlify/functions/utils/logger.js`)

The centralized logger provides:
- **Structured JSON logs**: All logs are JSON-formatted for easy parsing and filtering
- **Request correlation**: Automatic inclusion of `requestId` from AWS Lambda context
- **Performance tracking**: Built-in timing capabilities via `createTimer`
- **Debug-level control**: Environment variable `LOG_LEVEL` controls verbosity

### Logger Features

1. **Log Levels**:
   - `DEBUG`: Detailed diagnostic information (enabled when `LOG_LEVEL=DEBUG` or unset)
   - `INFO`: General informational messages
   - `WARN`: Warning messages for potentially problematic situations
   - `ERROR`: Error messages for failures
   - `CRITICAL`: Critical errors requiring immediate attention

2. **Structured Context**:
   - `timestamp`: ISO 8601 timestamp
   - `level`: Log severity level
   - `function`: Function name
   - `requestId`: AWS request ID for correlation
   - `elapsed`: Time elapsed since function start
   - `message`: Human-readable log message
   - `data`: Additional context object

## Implementation Standards

### Function Handler Pattern

Every function handler follows this pattern:

```javascript
exports.handler = async (event, context) => {
  const log = createLogger('function-name', context);
  const timer = createTimer(log, 'operation-name');
  log.entry({ method: event.httpMethod, path: event.path });
  
  try {
    // Function logic with debug logging
    
    log.exit(200, { additionalContext });
    return response;
  } catch (error) {
    log.error('Error message', { error: error.message, stack: error.stack });
    log.exit(500, { error: error.message });
    return errorResponse;
  }
};
```

### Entry/Exit Logging

- **Entry**: Logged at function start with request context (method, path, query params)
- **Exit**: Logged at function end with status code and execution metrics
- **Error Exit**: Always logged in catch blocks before returning error responses

### Debug-Level Instrumentation

All key operations include debug logging:
- Request parsing and validation
- Database operations (queries, inserts, updates)
- External API calls (Gemini, Weather API)
- File processing steps
- Retry attempts and circuit breaker state changes
- Performance timing for critical paths

## Utility Module Logging

### MongoDB (`utils/mongodb.js`)
- Connection lifecycle events (connect, disconnect, health checks)
- Collection access operations
- Error conditions with stack traces

### Validation (`utils/validation.js`)
- JSON parsing attempts and results
- Request body size validation
- Image payload validation steps
- Missing field detection

### Retry Logic (`utils/retry.js`)
- Retry attempt logging with backoff information
- Circuit breaker state changes (open, close, half-open)
- Timeout operations
- Retry exhaustion events

## Functions Instrumented

### Fully Instrumented Functions

1. **analyze.js** ✅
   - Entry/exit logging
   - Validation logging
   - Pipeline execution timing
   - Circuit breaker and retry logging
   - Idempotency and deduplication logging

2. **contact.js** ✅
   - Request parsing
   - Email sending operations
   - Environment variable validation

3. **upload.js** ✅
   - File parsing (CSV, JSON, XML, text)
   - Validation steps
   - Database operations
   - Measurement storage

4. **weather.js** ✅
   - API call logging
   - Response handling
   - Retry attempts

5. **systems.js** ✅
   - CRUD operations
   - Merge operations
   - Pagination

6. **history.js** ✅
   - Batch operations
   - Auto-association tasks
   - Weather backfill operations

7. **process-analysis.js** ✅
   - Job processing
   - Pipeline execution
   - Error handling

8. **get-job-status.js** ✅
   - Job lookup operations
   - Status aggregation

9. **data.js** ✅
   - Collection clearing operations
   - Admin operations

10. **security.js** ✅
    - Security checks
    - IP validation

11. **job-shepherd.js** ✅
    - Queue processing
    - Job invocation
    - Circuit breaker management

12. **extract-dl.js** ✅
    - DL number extraction
    - Pattern matching

13. **get-ip.js** ✅
    - IP detection

14. **generate-insights.js** ✅
    - Gemini API calls
    - Insight parsing
    - Timeout handling

15. **predictive-maintenance.js** ✅
    - System data retrieval
    - Predictive analysis
    - AI insight generation

## Environment Configuration

### Enabling Debug Logging

Set the `LOG_LEVEL` environment variable in Netlify:

```bash
# Enable debug logging (default)
LOG_LEVEL=DEBUG

# Suppress debug logs, show INFO and above
LOG_LEVEL=INFO

# Only show warnings and errors
LOG_LEVEL=WARN
```

### Netlify Dashboard

1. Go to Site settings → Environment variables
2. Add `LOG_LEVEL` with value `DEBUG`
3. Redeploy functions for changes to take effect

## Log Analysis

### Structured Log Format

All logs follow this JSON structure:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "DEBUG",
  "function": "analyze",
  "requestId": "abc123-def456",
  "elapsed": "125ms",
  "message": "Starting synchronous analysis via pipeline",
  "fileName": "bms-reading.jpg",
  "mimeType": "image/jpeg"
}
```

### Filtering in Netlify Logs

- By function: `function:analyze`
- By level: `level:ERROR`
- By request: `requestId:abc123-def456`
- By message: `message:"processing failed"`

### Performance Analysis

All functions log execution time:
- Entry/exit logs include elapsed time
- Timer objects track operation durations
- Slow operations are easily identifiable

## Best Practices

### 1. Always Include Context
```javascript
// Good
log.debug('Processing file', { fileName, fileSize, uploadId });

// Bad
log.debug('Processing file');
```

### 2. Use Appropriate Log Levels
- `DEBUG`: Detailed diagnostic info
- `INFO`: Important business events
- `WARN`: Recoverable issues
- `ERROR`: Failures requiring attention

### 3. Never Log Sensitive Data
- Never log passwords, API keys, or tokens
- Sanitize PII from logs
- Use length indicators for large payloads

### 4. Include Stack Traces for Errors
```javascript
log.error('Operation failed', { 
  error: error.message, 
  stack: error.stack 
});
```

### 5. Log Performance Metrics
```javascript
const timer = createTimer(log, 'database-query');
const result = await query();
timer.end({ recordCount: result.length });
```

## Migration Summary

### What Was Changed

1. **Replaced all `console.*` calls** with structured logger
2. **Added entry/exit logging** to all function handlers
3. **Instrumented utility modules** with debug logging
4. **Added performance timing** to critical paths
5. **Enhanced error logging** with stack traces and context
6. **Updated logger** to support DEBUG mode via environment variable

### Files Modified

- `netlify/functions/utils/logger.js` - Enhanced DEBUG mode
- `netlify/functions/utils/mongodb.js` - Structured logging
- `netlify/functions/utils/validation.js` - Debug logging
- `netlify/functions/utils/retry.js` - Retry and circuit breaker logging
- All 19 function handlers - Full instrumentation

### Backward Compatibility

- Logger supports both old-style `log('info', 'message', data)` and new `log.info('message', data)` APIs
- All existing code continues to work
- New features are opt-in via optional logger parameters

## Next Steps

1. **Monitor Logs**: Review Netlify function logs to identify any gaps
2. **Set Alerts**: Configure Netlify to alert on ERROR and CRITICAL logs
3. **Performance Baselines**: Establish performance baselines from timing logs
4. **Debug Issues**: Use request IDs to trace requests through the system

## Example Debug Session

To debug an issue:

1. **Find the request ID** from the error log
2. **Filter logs** by `requestId:xyz-123`
3. **Trace execution** through entry → operations → exit
4. **Identify bottlenecks** using elapsed time metrics
5. **Check related operations** using function name and context

All logs are now searchable, filterable, and correlated for comprehensive debugging! 🎉

