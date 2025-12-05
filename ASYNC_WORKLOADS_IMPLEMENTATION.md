# Netlify Async Workloads Implementation - Complete Guide

## Overview

This document describes the complete implementation of Netlify Async Workloads for insights generation in BMSview. This replaces the previous in-process background execution with a durable, resilient, event-driven async system.

## What Are Netlify Async Workloads?

Netlify Async Workloads provide **durable, event-driven serverless processing** with features that go far beyond simple background functions:

### Key Features
- ✅ **Unlimited execution time** (no timeout limits)
- ✅ **Automatic retries** with custom backoff schedules
- ✅ **Multi-step workflows** with independent step retry
- ✅ **State persistence** across failures and retries
- ✅ **Event-driven architecture** (not HTTP-based)
- ✅ **Sleep/delay capabilities** for rate limiting
- ✅ **Event chaining** (trigger follow-up events)
- ✅ **Priority support** for urgent workloads
- ✅ **Error control** (retry vs don't retry)
- ✅ **Built-in monitoring** and observability

## Architecture

### Components

1. **Async Workload Function** (`netlify/functions/generate-insights-background.mjs`)
   - Event handler for 'generate-insights' events
   - Multi-step workflow implementation
   - Error handling with retry control
   - State persistence
   - Event chaining for completions

2. **Client Library** (`netlify/functions/utils/insights-async-client.cjs`)
   - Triggers workload events
   - Priority support
   - Delayed execution
   - Helper methods for common patterns

3. **Configuration** (`netlify.toml`)
   - Workload settings
   - Retry policies
   - Event filters
   - Backoff schedules

### How It Works

```
┌─────────────────┐
│  Create Job in  │
│    MongoDB      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Send 'generate- │
│ insights' Event │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Netlify Async Workload System          │
│  - Queues event                          │
│  - Retries on failure                    │
│  - Persists state                        │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Workload Handler Executes               │
│  Step 1: Initialize                      │
│  Step 2: Fetch job data (if needed)     │
│  Step 3: Validate data                   │
│  Step 4: Process insights (unlimited time)│
│  Step 5: Store results                   │
│  Step 6: Send completion event           │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Job Complete   │
│  in MongoDB     │
└─────────────────┘
```

## Usage

### Triggering a Workload

```javascript
const { triggerInsightsWorkload } = require('./utils/insights-async-client.cjs');

// Basic usage
const { eventId, jobId } = await triggerInsightsWorkload({
  jobId: 'job-123',
  analysisData: { /* BMS data */ },
  systemId: 'sys-456',
  customPrompt: 'Analyze battery performance',
  contextWindowDays: 90,
  maxIterations: 10,
  fullContextMode: true
});

console.log(`Workload triggered: eventId=${eventId}, jobId=${jobId}`);
```

### High-Priority Workload

```javascript
const { triggerUrgentInsightsWorkload } = require('./utils/insights-async-client.cjs');

// Urgent processing (priority 10)
const result = await triggerUrgentInsightsWorkload({
  jobId: 'urgent-job-789',
  analysisData: { /* BMS data */ },
  systemId: 'sys-critical'
});
```

### Scheduled/Delayed Workload

```javascript
const { scheduleInsightsWorkload } = require('./utils/insights-async-client.cjs');

// Schedule for 1 hour from now
const oneHourFromNow = new Date(Date.now() + 3600000);

const result = await scheduleInsightsWorkload({
  jobId: 'scheduled-job-999',
  analysisData: { /* BMS data */ },
  systemId: 'sys-scheduled'
}, oneHourFromNow);
```

## Multi-Step Workflow

The workload handler uses `step.run()` to create independently retryable steps:

### Step 1: Initialize
- Updates job status to 'processing'
- Saves initial checkpoint
- Sets up workload state

### Step 2: Fetch Job Data
- Retrieves full job data from MongoDB if needed
- Validates job exists
- Throws `ErrorDoNotRetry` if job not found

### Step 3: Validate Data
- Checks required fields (analysisData, systemId)
- Throws `ErrorDoNotRetry` if validation fails
- Saves validation checkpoint

### Step 4: Process Insights
- Calls `processInsightsInBackground()` with unlimited timeout
- Implements smart error handling:
  - **Transient errors** (timeout, connection): Retry after 30s
  - **Rate limit errors**: Retry after 5 minutes
  - **Business logic errors**: Don't retry
- Saves processing checkpoint

### Step 5: Store Results
- Completes job in MongoDB
- Saves final checkpoint
- Marks workload as complete

### Step 6: Send Completion Event
- Triggers 'insights-completed' event
- Enables event chaining
- Non-critical (doesn't fail workload)

## Error Handling

### Error Types

1. **ErrorDoNotRetry** - Terminal errors that should not be retried
```javascript
throw new ErrorDoNotRetry('Job not found in database');
```

2. **ErrorRetryAfterDelay** - Errors that need specific retry delays
```javascript
throw new ErrorRetryAfterDelay({
  message: 'Rate limit hit',
  retryDelay: 300000, // 5 minutes
  error: originalError
});
```

3. **Standard Errors** - Wrapped with default retry logic
```javascript
// Automatically retried with backoff schedule
throw new Error('Unexpected processing error');
```

### Retry Schedule

Configured in `asyncWorkloadConfig.backoffSchedule`:

- **Attempt 1**: 5 seconds
- **Attempt 2**: 10 seconds
- **Attempt 3**: 30 seconds
- **Attempt 4+**: 60 seconds

Maximum retries: 15 attempts before dead-lettering

## Event Configuration

### Workload Config (`asyncWorkloadConfig`)

```javascript
export const asyncWorkloadConfig = {
  name: 'generate-insights-background',
  events: ['generate-insights'],
  maxRetries: 15,
  
  // Only process events with valid data
  eventFilter: (event) => {
    const { eventData } = event;
    return eventData && (
      eventData.jobId || 
      (eventData.analysisData && eventData.systemId)
    );
  },
  
  // Custom exponential backoff
  backoffSchedule: (attempt) => {
    if (attempt === 1) return 5000;
    if (attempt === 2) return 10000;
    if (attempt === 3) return 30000;
    return 60000;
  }
};
```

## Monitoring

### Event ID Tracking

Every workload execution has a unique `eventId` that can be used for monitoring:

```javascript
const { eventId } = await triggerInsightsWorkload({...});
console.log(`Track workload at: /.netlify/functions/async-workloads/events/${eventId}`);
```

### Logs

All workload execution is logged with structured logging:

```javascript
log.info('Async workload invoked', {
  eventName,
  eventId,
  attempt,
  hasEventData: !!eventData
});
```

### Failed Events

Failed events are automatically dead-lettered after max retries. They can be:
- Viewed in Netlify dashboard
- Retried manually
- Deleted
- Analyzed for patterns

## Comparison: Old vs New

### Old Approach (In-Process)
```javascript
// In generate-insights-with-tools.cjs
processInsightsInBackground(jobId, data, ...).catch(err => {
  // Error logged but no retry
  updateJobStatus(jobId, 'failed', err.message);
});
```

**Limitations:**
- No automatic retries
- No state persistence
- Single-step (all-or-nothing)
- Limited timeout handling
- No event chaining
- No priority support

### New Approach (Async Workloads)
```javascript
// Trigger workload
const { eventId } = await triggerInsightsWorkload({
  jobId,
  analysisData,
  systemId
});
```

**Advantages:**
- ✅ Automatic retries with smart backoff
- ✅ State persisted across attempts
- ✅ Multi-step with independent retry
- ✅ Unlimited execution time
- ✅ Event chaining for workflows
- ✅ Priority and scheduling support
- ✅ Built-in monitoring

## Configuration

### Enable Async Workloads

In `netlify.toml`:

```toml
[functions."generate-insights-background"]
  node_bundler = "esbuild"
  async_workloads = true
```

### Environment Variables

Required environment variables:
- `MONGODB_URI` – Mongo connection string for persisting jobs/checkpoints
- `MONGODB_DB_NAME` (optional) – overrides the default database name
- `DATA_ENCRYPTION_KEY` (optional) – enables field-level encryption of stored insights

The async workloads system also uses Netlify’s built-in authentication, site-specific API endpoints, and automatic configuration.
- Netlify's built-in authentication
- Site-specific API endpoints
- Automatic configuration

## Testing

### Local Testing

Async workloads can be tested locally using Netlify CLI:

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Run dev server with async workloads
netlify dev

# Send test event
curl -X POST http://localhost:8888/.netlify/functions/async-workloads/send \
  -H "Content-Type: application/json" \
  -d '{
    "eventName": "generate-insights",
    "eventData": {
      "jobId": "test-job-123",
      "systemId": "test-system",
      "analysisData": {...}
    }
  }'
```

### Integration Testing

```javascript
const { triggerInsightsWorkload } = require('./utils/insights-async-client.cjs');

describe('Insights Async Workload', () => {
  it('should trigger workload successfully', async () => {
    const result = await triggerInsightsWorkload({
      jobId: 'test-job',
      analysisData: mockData,
      systemId: 'test-sys'
    });
    
    expect(result.eventId).toBeDefined();
    expect(result.jobId).toBe('test-job');
  });
});
```

## Best Practices

1. **Always include jobId**: Required for tracking and state persistence

2. **Use priority wisely**: 
   - Normal: 5 (default)
   - Important: 7-8
   - Urgent: 10

3. **Implement proper error types**:
   - Use `ErrorDoNotRetry` for permanent failures
   - Use `ErrorRetryAfterDelay` for rate limits
   - Let standard errors use default retry

4. **Keep steps focused**: Each `step.run()` should be a single, retryable unit

5. **Save checkpoints**: Update state at key milestones

6. **Use event chaining**: Trigger follow-up events for complex workflows

7. **Monitor event IDs**: Track workload execution for debugging

## Troubleshooting

### Workload Not Triggering

Check:
1. Async workloads enabled in Netlify dashboard
2. `@netlify/async-workloads` package installed
3. `async_workloads = true` in netlify.toml
4. Event name matches configuration

### Retries Not Working

Check:
1. Error type (ErrorDoNotRetry prevents retries)
2. Max retries not exceeded (15 by default)
3. Backoff schedule configuration

### Steps Not Persisting

Check:
1. Using `step.run()` for all retryable operations
2. Checkpoint saving in each step
3. MongoDB connection stable

## Resources

- [Netlify Async Workloads Docs](https://docs.netlify.com/build/async-workloads/)
- [Multi-Step Workloads Guide](https://docs.netlify.com/build/async-workloads/multi-step-workloads/)
- [Async Workloads Lifecycle](https://docs.netlify.com/build/async-workloads/lifecycle/)
- [@netlify/async-workloads NPM](https://www.npmjs.com/package/@netlify/async-workloads)

## Migration from Old System

### Step 1: No Package Installation Required
The trigger endpoint uses Netlify's HTTP API instead of the @netlify/async-workloads package to avoid bundle size issues (250 MB limit). The package is only used in the .mjs workload handler where it's provided by Netlify runtime.

### Step 2: Update Configuration
Update `netlify.toml` to enable async workloads

### Step 3: Replace Background Calls
Replace direct `processInsightsInBackground()` calls with workload triggers:

```javascript
// Old
processInsightsInBackground(jobId, data, ...).catch(...);

// New
await triggerInsightsWorkload({ jobId, analysisData: data, systemId, ... });
```

### Step 4: Deploy
Deploy to Netlify and verify workloads execute correctly

## Summary

The Netlify Async Workloads implementation provides a production-ready, resilient system for long-running insights generation with:

- **Durability**: State persisted across failures
- **Resilience**: Automatic retries with smart backoff
- **Flexibility**: Multi-step workflows, event chaining, priority support
- **Observability**: Built-in monitoring and logging
- **Scalability**: No timeout limits, handles complex analysis

This represents a significant improvement over the previous in-process background execution model.
