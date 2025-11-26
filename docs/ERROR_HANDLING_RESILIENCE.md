# Error Handling & Resilience Guide

## Overview

This guide documents the comprehensive error handling and resilience mechanisms implemented for the AI feedback system in BMSview. The system is designed to gracefully handle failures, prevent cascade effects, and provide actionable error messages.

## Table of Contents

1. [Token Limit Handling](#token-limit-handling)
2. [Circuit Breakers](#circuit-breakers)
3. [Tool Error Categorization](#tool-error-categorization)
4. [Retry Logic](#retry-logic)
5. [Graceful Degradation](#graceful-degradation)
6. [Monitoring & Diagnostics](#monitoring--diagnostics)

---

## Token Limit Handling

### Overview

The token limit handler prevents AI operations from exceeding model token limits through progressive context reduction.

### Components

- **Module**: `netlify/functions/utils/token-limit-handler.cjs`
- **Integration**: `netlify/functions/utils/insights-guru.cjs`

### Features

#### 1. Token Estimation

```javascript
const { estimateTokenCount, estimateDataTokens } = require('./utils/token-limit-handler.cjs');

// Estimate tokens for text
const tokens = estimateTokenCount('Your text here');

// Estimate tokens for structured data
const dataTokens = estimateDataTokens({ your: 'data' });
```

#### 2. Progressive Reduction Strategies

When approaching token limits (80% by default), the system applies strategies in order:

1. **Reduce Granularity**: Switch from hourly to daily aggregation (~50% reduction)
2. **Reduce Time Window**: Cut time range by 50% (~50% reduction)
3. **Limit Metrics**: Request specific metrics instead of "all" (~30% reduction)
4. **Sample Data**: Apply 50% data sampling (~40% reduction)

#### 3. Automatic Context Reduction

```javascript
const { applyContextReduction } = require('./utils/token-limit-handler.cjs');

const result = applyContextReduction(config, currentTokens, model, log);

if (result.success) {
  console.log('Reduced configuration:', result.config);
  console.log('Reductions applied:', result.reductionsApplied);
}
```

### Configuration

Token limits per model (configurable in `token-limit-handler.cjs`):
- `gemini-2.5-flash`: 1,048,576 tokens (1M)
- `gemini-1.5-pro`: 2,097,152 tokens (2M)
- Safety margin: 80% (triggers reduction at 80% of limit)

### Error Handling

When token limit is exceeded:

```javascript
const { handleTokenLimitExceeded } = require('./utils/token-limit-handler.cjs');

const fallback = await handleTokenLimitExceeded(originalConfig, error, log);
// Returns aggressive fallback with 14-day window, daily aggregation, 50% sampling
```

---

## Circuit Breakers

### Overview

Circuit breakers prevent cascade failures by temporarily blocking requests to failing services, allowing them time to recover.

### Types of Circuit Breakers

#### 1. Global Circuit Breakers (Legacy)

**Module**: `netlify/functions/utils/retry.cjs`

Used for general API operations with simple failure tracking.

```javascript
const { circuitBreaker } = require('./utils/retry.cjs');

await circuitBreaker('api-key', async () => {
  // Your operation
}, { failureThreshold: 5, openMs: 30000 });
```

#### 2. Per-Tool Circuit Breakers (Recommended)

**Module**: `netlify/functions/utils/tool-circuit-breakers.cjs`

Fine-grained circuit breakers for individual services.

**Supported Tools**:
- `gemini_api` - Gemini AI API
- `weather_api` - Weather data service
- `solar_api` - Solar estimation service
- `mongodb` - Database operations
- `statistical_tools` - Forecasting and pattern analysis

**Usage**:

```javascript
const { executeWithCircuitBreaker } = require('./utils/tool-circuit-breakers.cjs');

const result = await executeWithCircuitBreaker('weather_api', async () => {
  return await fetchWeatherData();
}, log);
```

### Circuit Breaker States

1. **CLOSED** (Normal): Requests pass through normally
2. **OPEN** (Failing): After threshold failures, rejects requests immediately
3. **HALF_OPEN** (Testing): After timeout, allows test requests to verify recovery

### Configuration

Each tool has specific thresholds (configurable in `tool-circuit-breakers.cjs`):

```javascript
weather_api: {
  failureThreshold: 3,      // Open after 3 failures
  resetTimeout: 30000,      // 30 seconds before testing recovery
  halfOpenRequests: 2       // 2 successes needed to fully recover
}
```

### Monitoring

**Status Endpoint**: `/.netlify/functions/circuit-breaker-status`

Returns:
```json
{
  "timestamp": "2025-11-26T...",
  "global": {
    "breakers": [...],
    "summary": { "total": 2, "open": 0, "closed": 2 }
  },
  "tools": {
    "breakers": [
      {
        "toolName": "weather_api",
        "state": "CLOSED",
        "failures": 0,
        "totalRequests": 150,
        "failureRate": "2.67%"
      }
    ],
    "summary": { "total": 5, "open": 0, "closed": 5 }
  },
  "overall": {
    "anyOpen": false,
    "totalBreakers": 7
  }
}
```

### Manual Reset

**Reset Endpoint**: `/.netlify/functions/circuit-breaker-reset`

**Reset specific tool**:
```bash
POST /.netlify/functions/circuit-breaker-reset
{ "toolName": "weather_api" }
```

**Reset all tool breakers**:
```bash
POST /.netlify/functions/circuit-breaker-reset
{ "resetAllTools": true }
```

---

## Tool Error Categorization

### Overview

Enhanced error categorization helps distinguish retriable errors from permanent failures and provides actionable feedback.

### Error Categories

**Module**: `netlify/functions/utils/gemini-tools.cjs`

#### Network Errors (Retriable)
- Timeouts, connection refused, fetch failures
- Suggested action: Retry with exponential backoff

#### Rate Limiting (Retriable)
- HTTP 429, rate limit headers
- Suggested action: Wait before retry, reduce request frequency

#### Database Errors (Retriable)
- Connection issues, pool exhaustion
- Suggested action: Retry operation, check connection pool

#### Invalid Parameters (Not Retriable)
- Missing required fields, type errors
- Suggested action: Fix parameters before retry

#### Data Not Found (Graceful)
- Empty results, no matching records
- Suggested action: Continue with available data

#### Token Limit (Retriable with Reduction)
- Context exceeds model limits
- Suggested action: Reduce context size, use smaller time windows

#### Circuit Breaker Open (Retriable with Delay)
- Service temporarily unavailable
- Suggested action: Wait for circuit reset

### Error Response Format

```javascript
{
  error: true,
  message: "Failed to execute weather_api: Network timeout",
  errorCategory: "network",
  isRetriable: true,
  suggestedAction: "Retry with exponential backoff. System can continue with partial data.",
  graceful_degradation: true,
  partialResults: {}
}
```

---

## Retry Logic

### Overview

Retry mechanisms with exponential backoff ensure transient failures don't cause permanent errors.

### Retry Utilities

**Module**: `netlify/functions/utils/retry.cjs`

#### Basic Retry with Backoff

```javascript
const { retryAsync } = require('./utils/retry.cjs');

const result = await retryAsync(async () => {
  // Your operation
}, {
  retries: 3,
  baseDelayMs: 200,
  jitterMs: 150,
  shouldRetry: (e) => isNetworkError(e),
  log: logger
});
```

**Configuration**:
- Base delay: 200ms
- Exponential multiplier: 2x per attempt
- Jitter: Random 0-150ms added
- Max delay: Configurable, typically capped at 10-30s

#### GitHub API Retry (Enhanced)

**Module**: `scripts/create-issues-api.cjs`

```javascript
// Automatically categorizes errors and applies appropriate retry strategy
const issue = await createIssue(issueData);
// Uses exponential backoff with jitter, max 5 retries
// Saves failed issues to failed-issues.json for recovery
```

**Features**:
- Error categorization (rate limit, auth, network, validation)
- Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
- Jitter: Random 0-500ms to prevent thundering herd
- Failed issue recovery: JSON file for manual retry

---

## Graceful Degradation

### Overview

The system continues operating when individual components fail, returning partial results with degradation notices.

### Implementation

#### Tool Execution

When a tool fails, execution continues with available data:

```javascript
// Tool returns error with graceful_degradation flag
{
  error: true,
  message: "Weather API unavailable",
  graceful_degradation: true,
  partialResults: {}
}

// AI receives error but continues analysis with remaining data
// User sees notice: "⚠️ Weather data unavailable. Analysis based on battery metrics only."
```

#### Context Reduction

When full context exceeds limits:

1. System automatically reduces granularity/time window
2. User receives notification:
   ```
   ⚠️ Token Limit Handling:
   Your query required too much context for the AI model.
   The following optimizations were applied automatically:
     1. Switched to daily data aggregation
     2. Limited time window to 14 days
   
   Results are still accurate but may have less granular details.
   ```

#### Statistical Tools

If forecasting/pattern analysis fails:
- Analysis continues with current data only
- Predictions section shows: "Unable to generate predictions (service temporarily unavailable)"
- Recommendations still provided based on available metrics

---

## Monitoring & Diagnostics

### Health Check Endpoints

#### Circuit Breaker Status
```bash
GET /.netlify/functions/circuit-breaker-status
```

Use for:
- Debugging service unavailability
- Monitoring system health
- Identifying problematic dependencies

#### Circuit Breaker Reset
```bash
POST /.netlify/functions/circuit-breaker-reset
{
  "toolName": "weather_api",  // Reset specific tool
  "resetAllTools": true       // Reset all tool breakers
}
```

Use for:
- Emergency recovery
- Forcing retry after manual service fix
- Testing after deployment

### Frontend Integration

**Module**: `services/circuitBreakerService.ts`

```typescript
import { 
  getCircuitBreakerStatus,
  hasOpenCircuitBreakers,
  getOpenBreakerCounts,
  resetToolCircuitBreaker 
} from 'services/circuitBreakerService';

// Check if any services are down
const anyDown = await hasOpenCircuitBreakers();

// Get detailed counts
const counts = await getOpenBreakerCounts();
// { global: 0, tools: 2, total: 2 }

// Reset specific service
await resetToolCircuitBreaker('weather_api');
```

### Logging

All error handling operations are logged with structured context:

```javascript
log.error('Tool execution failed', {
  toolName: 'weather_api',
  error: error.message,
  category: 'network',
  isRetriable: true,
  duration: '1234ms',
  parameters: {...}
});
```

**Log levels**:
- `error`: Failures requiring attention
- `warn`: Degraded performance, retries, circuit openings
- `info`: Successful recoveries, state transitions
- `debug`: Detailed operation traces

---

## Best Practices

### For Developers

1. **Always use circuit breakers** for external API calls:
   ```javascript
   await executeWithCircuitBreaker('tool_name', operation, log);
   ```

2. **Categorize errors properly** in new tools:
   ```javascript
   catch (error) {
     const category = categorizeError(error);
     return { error: true, category, isRetriable, suggestedAction };
   }
   ```

3. **Check token limits** before expensive operations:
   ```javascript
   const status = checkTokenLimit(estimatedTokens, model);
   if (status.isApproachingLimit) {
     // Apply reduction strategy
   }
   ```

4. **Log with context** for debugging:
   ```javascript
   log.error('Operation failed', { 
     context: {...},
     errorCategory: category,
     isRetriable: retriable
   });
   ```

### For Operations

1. **Monitor circuit breaker status** during high load
2. **Set up alerts** for high failure rates (>10%)
3. **Review failed issue recovery files** regularly
4. **Test circuit breaker recovery** after service deployments
5. **Analyze token usage patterns** to optimize default windows

### For End Users

When errors occur:
1. Check error message for specific issue
2. Follow suggested actions (e.g., reduce time window)
3. For persistent issues, contact support with:
   - Error message
   - Operation attempted
   - Timestamp
   - Screenshot if UI-related

---

## Testing

Comprehensive test suites ensure reliability:

### Token Limit Handler
- `tests/token-limit-handler.test.js` (22 tests)
- Covers estimation, reduction strategies, fallback handling

### Circuit Breakers
- `tests/tool-circuit-breakers.test.js` (16 tests)
- Covers state transitions, recovery, registry management

### Running Tests
```bash
npm test -- token-limit-handler.test.js
npm test -- tool-circuit-breakers.test.js
```

---

## Troubleshooting

### Common Issues

#### "Circuit breaker is OPEN"
**Cause**: Service has failed multiple times  
**Solution**: 
1. Check service health
2. Wait for automatic reset (30-60s)
3. Manual reset via endpoint if urgent

#### "Token limit exceeded"
**Cause**: Query context too large  
**Solution**:
1. Reduce time window (90d → 30d → 14d)
2. Switch to daily aggregation
3. Request specific metrics instead of "all"

#### "Failed to create issue" (GitHub)
**Cause**: Rate limiting or network issue  
**Solution**:
1. Check `failed-issues.json` for details
2. Verify GitHub token validity
3. Retry after rate limit reset

#### High Tool Failure Rate
**Cause**: External service degradation  
**Solution**:
1. Check circuit breaker status
2. Review error logs for patterns
3. Consider service-specific timeout adjustments

---

## Future Enhancements

Potential improvements (not yet implemented):

1. **Request Deduplication**: Idempotency keys for AI feedback submission
2. **Advanced Sampling**: Intelligent data sampling based on query type
3. **Adaptive Timeouts**: Dynamic timeout adjustment based on query complexity
4. **Cost Tracking**: Token usage billing estimates
5. **A/B Testing**: Gradual rollout of error handling strategies
6. **User Preferences**: Allow users to opt for speed vs. detail tradeoffs

---

## References

- [Token Limit Handler Implementation](../netlify/functions/utils/token-limit-handler.cjs)
- [Tool Circuit Breakers Implementation](../netlify/functions/utils/tool-circuit-breakers.cjs)
- [Error Categorization](../netlify/functions/utils/gemini-tools.cjs#L364-L450)
- [Retry Utilities](../netlify/functions/utils/retry.cjs)
- [Frontend Service](../services/circuitBreakerService.ts)
