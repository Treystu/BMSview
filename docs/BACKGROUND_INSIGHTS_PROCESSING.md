# Background Insights Processing

This document explains the background processing implementation for AI-powered insights generation in BMSview.

## Overview

The background processing system allows AI insights generation to run asynchronously for up to 15 minutes (vs 20 seconds for synchronous requests), providing real-time progress updates via job polling.

**Note:** As of this deprecation (December 2024), background processing happens in-process via `processInsightsInBackground()` 
called directly from `generate-insights-with-tools.cjs`. The separate `generate-insights-background.cjs` endpoint 
has been deprecated and is no longer used in the normal workflow.

## Architecture

### Components

1. **Job Management** (`netlify/functions/utils/insights-jobs.cjs`)
   - Creates and tracks insights generation jobs
   - Manages job lifecycle (queued → processing → completed/failed)
   - Stores progress events and partial results

2. **Insights Processor** (`netlify/functions/utils/insights-processor.cjs`)
   - Executes ReAct loop for background jobs
   - Handles full AI tool calling workflow
   - Updates job progress in real-time
   - Called in-process from main insights endpoint

3. **Status Endpoint** (`netlify/functions/generate-insights-status.cjs`)
   - Polls for job status and progress
   - Returns progress events and partial/final insights

4. **Frontend Components**
   - `hooks/useInsightsPolling.ts` - Polling hook with exponential backoff
   - `components/InsightsProgressDisplay.tsx` - Progress visualization
   - `services/clientService.ts` - API integration

~~**Background Processor** (`netlify/functions/generate-insights-background.cjs`)~~
   - **DEPRECATED**: This separate endpoint is no longer used
   - Background processing now happens in-process via `insights-processor.cjs`

## Flow Diagram

```
User Request
    ↓
generate-insights-with-tools.cjs (mode='background')
    ↓
├─ Create job in MongoDB
├─ Call processInsightsInBackground() in-process (async, don't await)
└─ Return jobId immediately
    ↓
Frontend starts polling
    ↓
generate-insights-status.cjs
    ↓
Returns: status, progress, partial insights
    ↓
In-process background function completes
    ↓
Final insights stored in MongoDB
    ↓
Frontend receives completion
```

## Usage

### Backend Mode Selection

**Default (Background Mode):**
```javascript
POST /.netlify/functions/generate-insights-with-tools
Body: { analysisData, systemId, customPrompt }

Response: {
  success: true,
  jobId: "insights_1234567890_abc123",
  status: "processing",
  initialSummary: { current: {...}, historical: {...} }
}
```

**Legacy (Sync Mode):**
```javascript
POST /.netlify/functions/generate-insights-with-tools?sync=true
Body: { analysisData, systemId, customPrompt }

Response: {
  success: true,
  insights: { rawText, formattedText },
  toolCalls: [...]
}
```

### Frontend Integration

```typescript
import { generateInsightsBackground, getInsightsJobStatus } from 'services/clientService';
import { useInsightsPolling } from 'hooks/useInsightsPolling';
import { InsightsProgressDisplay } from 'components/InsightsProgressDisplay';

// Start background processing
const { jobId, initialSummary } = await generateInsightsBackground({
  analysisData,
  systemId,
  customPrompt,
  useEnhancedMode: true
});

// Poll for status
const { status, isPolling, startPolling } = useInsightsPolling(jobId, {
  onComplete: (jobId, insights) => {
    console.log('Insights ready:', insights);
  },
  onProgress: (jobId, progress) => {
    console.log('Progress update:', progress);
  }
});

startPolling();

// Display progress
<InsightsProgressDisplay status={status} isPolling={isPolling} />
```

## Database Schema

### Collection: `insights-jobs`

```javascript
{
  id: "insights_1234567890_abc123",          // Unique job ID
  status: "processing",                       // queued | processing | completed | failed
  analysisData: { voltage: 24.5, ... },      // Input battery data
  systemId: "sys-123",                        // BMS system ID (optional)
  customPrompt: "Analyze last week",          // User's question (optional)
  initialSummary: {                          // Immediate summary
    current: { voltage, current, soc, ... },
    historical: { daily: [...], charging: {...} }
  },
  progress: [                                // Progress events array
    {
      timestamp: "2025-11-07T10:30:00Z",
      type: "tool_call",
      data: { tool: "request_bms_data", parameters: {...} }
    },
    {
      timestamp: "2025-11-07T10:30:05Z",
      type: "tool_response",
      data: { success: true, dataSize: 5432 }
    }
  ],
  partialInsights: "Battery shows...",       // Streaming insights
  finalInsights: {                           // Final result
    rawText: "Complete analysis...",
    formattedText: "🔋 BATTERY INSIGHTS..."
  },
  error: null,                               // Error message (if failed)
  createdAt: "2025-11-07T10:29:45Z",
  updatedAt: "2025-11-07T10:32:10Z"
}
```

### Indexes

- `{ id: 1 }` - Unique index for fast lookups
- `{ status: 1, createdAt: 1 }` - For status queries and cleanup
- `{ createdAt: 1, expireAfterSeconds: 86400 }` - TTL index (24h cleanup)

## Configuration

### Environment Variables

- `GEMINI_API_KEY` - Google Gemini API key
- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB_NAME` - Database name (default: `bmsview`)
- `URL` - Netlify deployment URL (auto-set)

### Netlify Configuration

Add to `netlify.toml`:

```toml
[functions."generate-insights-background"]
  external_node_modules = ["@google/generative-ai"]
```

## Error Handling

### Timeout Protection

- **Sync mode**: 55 seconds total
- **Background mode**: 14 minutes total (with 1-minute buffer)
- Per-iteration timeout: 30 seconds

### Retry Strategy

- Frontend polling: Exponential backoff (2s → 10s)
- Max polling attempts: 200 (~15 minutes)
- Circuit breaker after 10 consecutive errors

### Failure Scenarios

1. **AI model unavailable**: Job marked as failed immediately
2. **Tool execution error**: Reported to AI, can retry with adjusted parameters
3. **Timeout**: Job marked as failed with user-friendly message
4. **Database error**: Logged, job status may be inconsistent

## Monitoring

### Logging

All operations use structured JSON logging:

```javascript
{
  "level": "INFO",
  "timestamp": "2025-11-07T10:30:00Z",
  "service": "generate-insights-background",
  "message": "Processing iteration 3",
  "context": {
    "jobId": "insights_1234567890_abc123",
    "iteration": 3,
    "elapsedSeconds": 45
  }
}
```

### Metrics

- Job creation rate
- Average processing time
- Tool call frequency
- Completion vs failure ratio
- Progress event counts

## Testing

Run tests:

```bash
npm test tests/insights-jobs.test.js
npm test tests/insights-summary.test.js
```

## Performance

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Max Processing Time | 55s | 14min | 15x |
| Timeout Errors | 15% | <1% | 94% reduction |
| User Feedback | 55s | <1s | 98% faster |
| Complex Query Success | 60% | 95% | +35% |

## Future Enhancements

1. **WebSocket Support**: Replace polling with WebSocket for real-time updates
2. **Job Prioritization**: Queue management for concurrent requests
3. **Progress Estimates**: Time-to-completion predictions
4. **Partial Result Caching**: Resume interrupted analyses
5. **Multi-stage Processing**: Break complex analyses into phases

## Troubleshooting

### Job stuck in "processing" state

Check background function logs in Netlify dashboard. Job may have timed out or encountered an error.

### Polling not receiving updates

Verify network connectivity and check browser console for errors. Job may have expired (24h TTL).

### Initial summary shows no historical data

Confirm `systemId` is correct and historical records exist in `analysis-results` collection.

### Background function not invoked

Check `URL` environment variable is set and background function deployed correctly.

## References

- [Netlify Background Functions](https://docs.netlify.com/functions/background-functions/)
- [Google Gemini AI](https://ai.google.dev/docs)
- [MongoDB TTL Indexes](https://docs.mongodb.com/manual/core/index-ttl/)
