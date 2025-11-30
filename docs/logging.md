# BMSview Logging Guide

## Overview

BMSview uses a centralized, structured logging system across all Netlify functions. The logger provides:

- **Structured JSON output** for easy filtering and searching in Netlify logs
- **Configurable log levels** (DEBUG, INFO, WARN, ERROR, CRITICAL)
- **Automatic request correlation** via `requestId`
- **Job tracking** for background/async operations via `jobId`
- **Security audit logging** for compliance and monitoring
- **Performance timing** utilities

## Quick Start

```javascript
const { createLogger, createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');

exports.handler = async (event, context) => {
  // Create logger with automatic correlation ID from headers
  const log = createLoggerFromEvent('my-function', event, context);
  
  // Log function entry
  log.entry({ method: event.httpMethod, path: event.path });
  
  try {
    // Log debug details (only when LOG_LEVEL=DEBUG or unset)
    log.debug('Processing request', { bodyLength: event.body?.length });
    
    // Your logic here...
    
    // Log successful completion
    log.exit(200, { recordsProcessed: 10 });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
    
  } catch (error) {
    log.error('Function failed', { 
      error: error.message, 
      stack: error.stack 
    });
    log.exit(500);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
```

## Log Levels

| Level | When to Use | Visibility |
|-------|-------------|------------|
| DEBUG | Detailed debugging info, step-by-step execution | Only when LOG_LEVEL=DEBUG or unset |
| INFO | Important operational events (entry, exit, milestones) | Always visible |
| WARN | Warning conditions that should be investigated | Always visible |
| ERROR | Errors that prevented operation completion | Always visible |
| CRITICAL | System-critical failures requiring immediate attention | Always visible |

### Setting Log Level

Configure via environment variable in Netlify:

```bash
# Production (suppress debug logs for cleaner output)
LOG_LEVEL=INFO

# Development/Debugging (maximum verbosity)
LOG_LEVEL=DEBUG

# Unset = defaults to DEBUG for maximum verbosity while debugging
```

**Current Default**: When `LOG_LEVEL` is not set, DEBUG logging is **enabled** to provide maximum visibility during the debugging phase.

## Logger API

### createLogger(functionName, context)

Basic logger creation:

```javascript
const { createLogger } = require('./utils/logger.cjs');
const log = createLogger('my-function', context);
```

### createLoggerFromEvent(functionName, event, context, options) ⭐ Recommended

Creates a logger with automatic correlation ID extraction from headers:

```javascript
const { createLoggerFromEvent } = require('./utils/logger.cjs');
const log = createLoggerFromEvent('my-function', event, context, { jobId: 'job-123' });
```

This automatically:
- Extracts `requestId` from headers (`x-request-id`, `x-correlation-id`, etc.)
- Generates a UUID if no correlation header is found
- Includes `clientIp`, `httpMethod`, and `path` in context
- Optionally includes `jobId` for background operations

### Log Methods

```javascript
log.debug(message, data)   // Detailed debugging info
log.info(message, data)    // Important operational info
log.warn(message, data)    // Warning conditions
log.error(message, data)   // Error conditions
log.critical(message, data) // Critical failures

log.entry(data)            // Log function entry
log.exit(statusCode, data) // Log function exit with status

log.dbOperation(operation, collection, data) // Database operations
log.apiCall(service, endpoint, data)         // External API calls
log.metric(name, value, unit)                // Performance metrics
```

### Security Audit Methods

```javascript
log.audit(eventType, data)      // General audit event
log.rateLimit(action, data)     // Rate limit events
log.sanitization(field, reason, data) // Input sanitization
log.consent(granted, data)      // Consent tracking
log.dataAccess(operation, data) // Data access logging
```

### createTimer(log, operationName)

Performance timing utility:

```javascript
const { createTimer } = require('./utils/logger.cjs');

const timer = createTimer(log, 'database-query');
// ... perform operation
const durationMs = timer.end({ recordCount: 100 });
```

## Log Output Format

All logs are structured JSON for easy filtering:

```json
{
  "timestamp": "2025-11-30T02:00:00.000Z",
  "level": "INFO",
  "function": "analyze",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "elapsed": "150ms",
  "message": "Analysis completed",
  "jobId": "job-123",
  "recordId": "rec-456"
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp |
| `level` | Log level (DEBUG/INFO/WARN/ERROR/CRITICAL) |
| `function` | Name of the Netlify function |
| `requestId` | Correlation ID for tracing requests across logs |
| `elapsed` | Time since logger creation |
| `message` | Human-readable message |
| `jobId` | (Optional) Job ID for background operations |
| `context` | (Optional) Additional context data |

## Request Correlation

The logger automatically extracts correlation IDs from these headers (in priority order):

1. `x-request-id`
2. `x-correlation-id`
3. `x-trace-id`
4. `request-id`
5. `correlation-id`

If no correlation header is found, a UUID is automatically generated.

**Best Practice**: Include the `requestId` in error responses so users can reference it when reporting issues:

```javascript
return {
  statusCode: 500,
  body: JSON.stringify({
    error: 'Processing failed',
    requestId: log.requestId  // For support reference
  })
};
```

## Logging Patterns for Netlify Functions

### Standard Function Template

```javascript
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLoggerFromEvent('function-name', event, context);
  log.entry({ 
    method: event.httpMethod, 
    path: event.path,
    query: event.queryStringParameters 
  });
  
  const timer = createTimer(log, 'function-execution');
  
  try {
    // Validate request
    if (event.httpMethod !== 'POST') {
      log.warn('Method not allowed', { method: event.httpMethod });
      log.exit(405);
      return errorResponse(405, 'method_not_allowed', 'Use POST', null, headers);
    }
    
    // Main logic
    log.debug('Processing started', { step: 'validation' });
    // ... your code ...
    
    log.debug('External API call', { service: 'gemini' });
    const apiTimer = createTimer(log, 'gemini-api');
    // ... API call ...
    apiTimer.end({ tokens: 1000 });
    
    // Success
    const durationMs = timer.end({ recordsProcessed: 5 });
    log.exit(200, { durationMs });
    return { 
      statusCode: 200, 
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }) 
    };
    
  } catch (error) {
    timer.end({ error: true });
    log.error('Function failed', {
      error: error.message,
      stack: error.stack,
      errorType: error.constructor?.name
    });
    log.exit(500);
    return errorResponse(500, 'internal_error', error.message, null, headers);
  }
};
```

### Background Job Template

```javascript
const { createLoggerFromEvent } = require('./utils/logger.cjs');

exports.handler = async (event, context) => {
  const body = JSON.parse(event.body || '{}');
  const { jobId } = body;
  
  // Include jobId in logger for correlation
  const log = createLoggerFromEvent('background-job', event, context, { jobId });
  
  log.entry({ jobId, action: body.action });
  
  try {
    log.info('Job started', { jobId, status: 'processing' });
    
    // ... process job ...
    
    log.info('Job completed', { jobId, status: 'completed' });
    log.exit(200, { jobId });
    return { statusCode: 200, body: JSON.stringify({ success: true, jobId }) };
    
  } catch (error) {
    log.error('Job failed', { jobId, error: error.message, stack: error.stack });
    log.exit(500, { jobId, error: true });
    return { statusCode: 500, body: JSON.stringify({ error: error.message, jobId }) };
  }
};
```

## Sensitive Data Guidelines

**Never log:**
- API keys, tokens, passwords
- Full request/response bodies with PII
- Credit card numbers, SSNs
- Raw screenshot/image data

**Do log:**
- Sizes and lengths instead of full content
- Hashes for identification without exposure
- Field names without values for validation failures
- Sanitized/truncated previews

```javascript
// ❌ Bad
log.debug('Request received', { body: event.body }); // May contain sensitive data

// ✅ Good
log.debug('Request received', { 
  bodyLength: event.body?.length,
  hasAuth: !!event.headers?.authorization 
});
```

## Viewing Logs in Netlify

1. Go to Netlify Dashboard
2. Select your site
3. Click "Functions" tab
4. Click on a specific function
5. View real-time logs

### Filtering Tips

Search by requestId:
```
requestId:"a1b2c3d4-e5f6"
```

Find errors:
```
level:"ERROR"
```

Find slow operations:
```
elapsed:">5000ms"
```

Find specific function:
```
function:"analyze"
```

## Migration from Old Logging

If your function uses the old `log(level, message, data)` pattern, it still works:

```javascript
// Old pattern (still supported)
log('info', 'Message', { data: 'value' });

// New pattern (preferred)
log.info('Message', { data: 'value' });
```

---

**Last Updated**: 2025-11-30
**Default Log Level**: DEBUG (for active debugging)
