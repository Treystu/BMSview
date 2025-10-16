# Comprehensive Logging Guide

## Overview
All Netlify functions use a centralized logging system with configurable log levels and structured JSON output.

## Log Levels

### Available Levels (in order of verbosity)
1. **ERROR** - Critical errors that prevent operation
2. **WARN** - Warning conditions that should be investigated
3. **INFO** - Important operational information (default)
4. **DEBUG** - Detailed debugging information
5. **TRACE** - Very detailed trace information

### Setting Log Level
Configure via environment variable in Netlify:
```bash
LOG_LEVEL=INFO  # Recommended for production
LOG_LEVEL=DEBUG # For troubleshooting
```

## Current Logging Status by Service

### ✅ Fully Logged Services

#### 1. Process Analysis (`process-analysis.js`)
**Log Level:** INFO (comprehensive)
**Key Operations Logged:**
- Job invocation and setup
- Data extraction from images
- System matching
- Weather data fetching
- Record saving
- Completion status

**Sample Log Output:**
```json
{
  "timestamp": "2025-10-16T09:04:03.664Z",
  "level": "INFO",
  "functionName": "process-analysis",
  "awsRequestId": "1047470f-80dd-448a-a634-9ffa67a6523b",
  "elapsedMs": 3,
  "message": "Background process-analysis function invoked.",
  "stage": "invocation"
}
```

#### 2. Weather Service (`weather.js`)
**Log Level:** INFO (enhanced in this fix)
**Key Operations Logged:**
- Function invocation
- API key validation
- Historical vs current weather determination
- OpenWeather API calls
- UVI data fetching
- Success/failure status

**Sample Log Output:**
```json
{
  "timestamp": "2025-10-16T09:04:09.061Z",
  "level": "INFO",
  "functionName": "weather",
  "message": "Weather function invoked.",
  "clientIp": "192.168.1.1",
  "httpMethod": "POST",
  "path": "/.netlify/functions/weather"
}
```

#### 3. Systems Service (`systems.js`)
**Log Level:** INFO (enhanced in this fix)
**Key Operations Logged:**
- Function invocation
- GET/POST/PUT operations
- System creation
- System updates
- System merging
- MongoDB operations

**Sample Log Output:**
```json
{
  "timestamp": "2025-10-16T09:04:05.512Z",
  "level": "INFO",
  "functionName": "systems",
  "message": "Systems function invoked.",
  "clientIp": "192.168.1.1",
  "httpMethod": "GET",
  "path": "/.netlify/functions/systems"
}
```

#### 4. System Analytics (`system-analytics.js`)
**Log Level:** INFO (enhanced in this fix)
**Key Operations Logged:**
- Function invocation
- Analytics processing start
- History record fetching
- Hourly averages calculation
- Performance baseline calculation
- Alert analysis
- Completion status

**Sample Log Output:**
```json
{
  "timestamp": "2025-10-16T09:06:01.812Z",
  "level": "INFO",
  "functionName": "system-analytics",
  "message": "System analytics function invoked.",
  "httpMethod": "GET",
  "systemId": "6ac431c7-fb5d-4714-8b2f-c16e2e9bc8dd"
}
```

#### 5. Security Service (`security.js`)
**Log Level:** INFO
**Key Operations Logged:**
- Security check invocation
- IP blocking checks
- Rate limit checks
- Verified IP bypass
- Rate limit exceeded warnings
- Security check completion

**Sample Log Output:**
```json
{
  "timestamp": "2025-10-16T09:04:09.061Z",
  "level": "INFO",
  "functionName": "security",
  "message": "Executing security check.",
  "clientIp": "192.168.1.1"
}
```

#### 6. Get Job Status (`get-job-status.js`)
**Log Level:** INFO (enhanced in this fix)
**Key Operations Logged:**
- Function invocation
- Job ID parsing
- MongoDB queries
- Job status retrieval
- Not found warnings

**Sample Log Output:**
```json
{
  "timestamp": "2025-10-16T09:04:09.792Z",
  "level": "INFO",
  "functionName": "get-job-status",
  "message": "Get job status function invoked.",
  "clientIp": "192.168.1.1",
  "httpMethod": "GET",
  "requestedJobIds": ["job-id-1", "job-id-2"],
  "count": 2
}
```

## Log Structure

### Standard Log Entry Format
```json
{
  "timestamp": "ISO-8601 timestamp",
  "level": "ERROR|WARN|INFO|DEBUG|TRACE",
  "functionName": "name-of-function",
  "awsRequestId": "AWS request ID",
  "elapsedMs": 123,
  "message": "Human-readable message",
  "clientIp": "Client IP address",
  "httpMethod": "GET|POST|PUT|DELETE",
  "stage": "invocation|processing|completion|error",
  "...additional context..."
}
```

### Common Context Fields
- `clientIp` - Client IP address from headers
- `httpMethod` - HTTP method used
- `path` - Request path
- `stage` - Current processing stage
- `jobId` - Job identifier (for async operations)
- `systemId` - System identifier
- `recordId` - Analysis record identifier
- `error` - Error message (for ERROR level)
- `stack` - Stack trace (for ERROR level)

## Viewing Logs

### CloudWatch Logs
1. Go to AWS CloudWatch Console
2. Navigate to Log Groups
3. Find log group: `/aws/lambda/[function-name]`
4. View log streams (sorted by time)

### Netlify Logs
1. Go to Netlify Dashboard
2. Select your site
3. Click "Functions" tab
4. Click on specific function
5. View real-time logs

### Log Filtering Examples

#### Find all errors:
```
{ $.level = "ERROR" }
```

#### Find specific job:
```
{ $.jobId = "a16a8d49-55d3-4cb3-bfa6-138e55672dfd" }
```

#### Find slow operations:
```
{ $.elapsedMs > 5000 }
```

#### Find rate limit warnings:
```
{ $.message = "*Rate limit*" }
```

## Debugging Guide

### Issue: Function not logging
**Check:**
1. LOG_LEVEL environment variable
2. Function is actually being invoked
3. CloudWatch log group exists
4. IAM permissions for logging

**Solution:**
```bash
# Set LOG_LEVEL to DEBUG temporarily
LOG_LEVEL=DEBUG
```

### Issue: Too many logs
**Check:**
1. Current LOG_LEVEL setting
2. Unnecessary DEBUG/TRACE logs

**Solution:**
```bash
# Reduce to INFO or WARN
LOG_LEVEL=INFO
```

### Issue: Missing context in logs
**Check:**
1. Log level is appropriate
2. Context is being passed to logger

**Solution:**
```javascript
// Always pass context
log('info', 'Operation started', { 
  jobId, 
  systemId, 
  additionalContext 
});
```

## Best Practices

### 1. Use Appropriate Log Levels
```javascript
// ERROR - Only for critical failures
log('error', 'Failed to save to database', { error: err.message });

// WARN - For concerning but non-critical issues
log('warn', 'Rate limit approaching threshold', { current: 95, limit: 100 });

// INFO - For important operational events
log('info', 'Job completed successfully', { jobId, recordId });

// DEBUG - For detailed debugging
log('debug', 'Parsing request body', { body: parsedBody });

// TRACE - For very detailed traces
log('trace', 'Raw API response', { response: rawResponse });
```

### 2. Include Relevant Context
```javascript
// Good - includes context
log('info', 'Processing job', { 
  jobId, 
  fileName, 
  retryCount,
  stage: 'extraction' 
});

// Bad - no context
log('info', 'Processing job');
```

### 3. Use Consistent Stages
```javascript
const stages = {
  INVOCATION: 'invocation',
  SETUP: 'setup',
  PROCESSING: 'processing',
  COMPLETION: 'completion',
  ERROR: 'error'
};

log('info', 'Starting process', { stage: stages.SETUP });
```

### 4. Log Performance Metrics
```javascript
const startTime = Date.now();
// ... operation ...
const duration = Date.now() - startTime;

log('info', 'Operation completed', { 
  operation: 'data-extraction',
  durationMs: duration 
});
```

### 5. Sanitize Sensitive Data
```javascript
// Use the sanitize utility
const { sanitize } = require('./utils/logger');

log('debug', 'Request received', sanitize({
  headers: request.headers,  // Will redact authorization, etc.
  body: request.body
}));
```

## Performance Considerations

### Log Volume
- INFO level: ~10-20 logs per request
- DEBUG level: ~50-100 logs per request
- TRACE level: ~200+ logs per request

### CloudWatch Costs
- Ingestion: $0.50 per GB
- Storage: $0.03 per GB/month
- Typical function: 1-5 KB per invocation

**Recommendation:** Use INFO in production, DEBUG only when troubleshooting.

## Monitoring and Alerts

### Recommended CloudWatch Alarms

#### 1. High Error Rate
```
Metric: Count of ERROR level logs
Threshold: > 10 in 5 minutes
Action: Send SNS notification
```

#### 2. Function Duration
```
Metric: elapsedMs > 10000
Threshold: > 5 occurrences in 5 minutes
Action: Send SNS notification
```

#### 3. Rate Limit Warnings
```
Metric: Count of "Rate limit exceeded"
Threshold: > 50 in 5 minutes
Action: Send SNS notification
```

## Troubleshooting Common Issues

### 1. Jobs Stuck in "Queued"
**Check logs for:**
- `"Job status updated successfully"` with `"newStatus":"completed"`
- `"Job completed successfully"` with recordId

**If present:** Frontend polling issue, not backend
**If absent:** Backend processing issue

### 2. Weather Data Not Fetching
**Check logs for:**
- `"Weather function invoked"`
- `"Fetching weather data for matched system"`
- `"Successfully fetched historical weather data"`

**Common issues:**
- Missing WEATHER_API_KEY
- Invalid coordinates
- API rate limits

### 3. System Matching Failures
**Check logs for:**
- `"System matching result: None"`
- `"dlNumber"` value in logs

**Common issues:**
- DL number not extracted correctly
- System not registered with matching DL number
- Case sensitivity in DL number matching

## Summary

### Current Status: ✅ All Services Fully Logged

All services now log at INFO level by default, providing:
- Function invocation visibility
- Operation progress tracking
- Error detection and debugging
- Performance monitoring
- Security event tracking

### Log Level Recommendations

**Production:** `LOG_LEVEL=INFO`
- Balanced visibility and cost
- Captures all important events
- Minimal noise

**Staging:** `LOG_LEVEL=DEBUG`
- Detailed operation tracking
- Helps catch issues before production
- More verbose but acceptable cost

**Development:** `LOG_LEVEL=DEBUG` or `TRACE`
- Maximum visibility
- Detailed debugging information
- Higher log volume acceptable

---

**Last Updated:** 2025-10-16  
**Status:** ✅ All services logging comprehensively  
**Default Level:** INFO