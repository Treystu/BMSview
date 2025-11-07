# Background Insights Processing - Usage Examples

This document provides practical examples of using the background insights processing feature.

## Example 1: Basic Background Insights Generation

### Frontend Component

```typescript
import React, { useState } from 'react';
import { generateInsightsBackground } from 'services/clientService';
import { useInsightsPolling } from 'hooks/useInsightsPolling';
import { InsightsProgressDisplay } from 'components/InsightsProgressDisplay';

export function BatteryInsights({ analysisData, systemId }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [initialSummary, setInitialSummary] = useState<any>(null);
  const [finalInsights, setFinalInsights] = useState<any>(null);

  const { status, isPolling, error, startPolling } = useInsightsPolling(jobId, {
    onComplete: (jobId, insights) => {
      console.log('Insights generation complete!');
      setFinalInsights(insights);
    },
    onProgress: (jobId, progress) => {
      console.log(`Progress: ${progress.length} events`);
    },
    onError: (jobId, error) => {
      console.error('Insights generation failed:', error);
    }
  });

  const handleGenerateInsights = async () => {
    try {
      // Start background processing
      const result = await generateInsightsBackground({
        analysisData,
        systemId,
        useEnhancedMode: true
      });

      setJobId(result.jobId);
      setInitialSummary(result.initialSummary);
      
      // Start polling for updates
      startPolling();
    } catch (err) {
      console.error('Failed to start insights generation:', err);
    }
  };

  return (
    <div>
      <button onClick={handleGenerateInsights}>
        Generate AI Insights
      </button>

      {/* Display progress */}
      {jobId && (
        <InsightsProgressDisplay 
          status={status} 
          isPolling={isPolling} 
          error={error} 
        />
      )}

      {/* Display final insights */}
      {finalInsights && (
        <div className="final-insights">
          <h3>Analysis Complete</h3>
          <pre>{finalInsights.formattedText || finalInsights.rawText}</pre>
        </div>
      )}
    </div>
  );
}
```

## Example 2: Custom Prompt with Background Processing

```typescript
import { generateInsightsBackground } from 'services/clientService';
import { useInsightsPolling } from 'hooks/useInsightsPolling';

export function CustomAnalysis({ analysisData, systemId }) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const { status, startPolling } = useInsightsPolling(jobId, {
    onComplete: (jobId, insights) => {
      alert(`Analysis complete: ${insights.rawText.substring(0, 100)}...`);
    }
  });

  const handleAskQuestion = async () => {
    const result = await generateInsightsBackground({
      analysisData,
      systemId,
      customPrompt,  // User's custom question
      useEnhancedMode: true
    });

    setJobId(result.jobId);
    startPolling();
  };

  return (
    <div>
      <input
        type="text"
        value={customPrompt}
        onChange={(e) => setCustomPrompt(e.target.value)}
        placeholder="Ask a question about your battery..."
      />
      <button onClick={handleAskQuestion}>Ask AI</button>
      
      {status && (
        <div>Status: {status.status}</div>
      )}
    </div>
  );
}
```

## Example 3: Sync Mode (Legacy/Quick Analysis)

For quick analyses that complete in under 60 seconds, you can still use synchronous mode:

```typescript
import { streamInsights } from 'services/clientService';

export function QuickInsights({ analysisData }) {
  const [insights, setInsights] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerateSync = async () => {
    setLoading(true);
    
    await streamInsights(
      {
        analysisData,
        useEnhancedMode: true
      },
      (chunk) => {
        // Receive insights as they're generated
        setInsights(chunk);
      },
      () => {
        // Complete
        setLoading(false);
      },
      (error) => {
        // Error
        console.error(error);
        setLoading(false);
      }
    );
  };

  return (
    <div>
      <button onClick={handleGenerateSync} disabled={loading}>
        {loading ? 'Generating...' : 'Quick Analysis'}
      </button>
      {insights && <pre>{insights}</pre>}
    </div>
  );
}
```

## Example 4: Backend API Usage

### Direct API Call (Background Mode - Default)

```javascript
// POST /.netlify/functions/generate-insights-with-tools
const response = await fetch('/.netlify/functions/generate-insights-with-tools', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    analysisData: {
      overallVoltage: 24.5,
      current: 5.2,
      stateOfCharge: 85,
      temperature: 25,
      cellVoltages: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5]
    },
    systemId: 'sys-123',
    customPrompt: 'Analyze battery health trends over the past week'
  })
});

const result = await response.json();
// {
//   success: true,
//   jobId: "insights_1699380000000_abc123",
//   status: "processing",
//   initialSummary: { current: {...}, historical: {...} }
// }

// Poll for status
const statusResponse = await fetch('/.netlify/functions/generate-insights-status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jobId: result.jobId })
});

const statusResult = await statusResponse.json();
// {
//   jobId: "insights_1699380000000_abc123",
//   status: "processing",
//   progress: [
//     { timestamp: "...", type: "tool_call", data: {...} },
//     { timestamp: "...", type: "tool_response", data: {...} }
//   ],
//   partialInsights: "Battery shows consistent charging pattern..."
// }
```

### Direct API Call (Sync Mode)

```javascript
// POST /.netlify/functions/generate-insights-with-tools?sync=true
const response = await fetch('/.netlify/functions/generate-insights-with-tools?sync=true', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    analysisData: { /* ... */ },
    systemId: 'sys-123'
  })
});

const result = await response.json();
// {
//   success: true,
//   insights: {
//     rawText: "...",
//     formattedText: "...",
//     healthStatus: "Generated"
//   },
//   toolCalls: [...],
//   analysisMode: "sync"
// }
```

## Example 5: Monitoring Progress Events

```typescript
const { status } = useInsightsPolling(jobId, {
  onProgress: (jobId, progress) => {
    // Log different types of events
    progress.forEach(event => {
      switch (event.type) {
        case 'tool_call':
          console.log(`AI requested: ${event.data.tool}`);
          console.log(`Parameters:`, event.data.parameters);
          break;
        case 'tool_response':
          console.log(`Data received: ${event.data.dataSize} bytes`);
          break;
        case 'ai_response':
          console.log('AI generated partial response');
          break;
        case 'iteration':
          console.log(`Iteration ${event.data.iteration} (${event.data.elapsedSeconds}s)`);
          break;
      }
    });
  }
});
```

## Example 6: Error Handling

```typescript
const { status, error } = useInsightsPolling(jobId, {
  onError: (jobId, errorMessage) => {
    // Handle different error scenarios
    if (errorMessage.includes('timeout')) {
      alert('Analysis took too long. Try a simpler question or smaller time range.');
    } else if (errorMessage.includes('unavailable')) {
      alert('AI service temporarily unavailable. Please try again in a few minutes.');
    } else {
      alert(`Analysis failed: ${errorMessage}`);
    }
  }
});

// Display error in UI
{error && (
  <div className="error-alert">
    <strong>Error:</strong> {error}
  </div>
)}
```

## Example 7: Multiple Concurrent Jobs

```typescript
export function MultiAnalysis() {
  const [jobs, setJobs] = useState<Map<string, any>>(new Map());

  const startAnalysis = async (analysisData: any, label: string) => {
    const result = await generateInsightsBackground({
      analysisData,
      useEnhancedMode: true
    });

    setJobs(prev => new Map(prev).set(result.jobId, { label, status: 'processing' }));
    
    // Each job gets its own polling instance
    return result.jobId;
  };

  return (
    <div>
      {Array.from(jobs.entries()).map(([jobId, job]) => (
        <JobMonitor key={jobId} jobId={jobId} label={job.label} />
      ))}
    </div>
  );
}

function JobMonitor({ jobId, label }: { jobId: string; label: string }) {
  const { status } = useInsightsPolling(jobId);
  
  return (
    <div>
      <h4>{label}</h4>
      <p>Status: {status?.status || 'Unknown'}</p>
      {status?.progress && (
        <p>Progress: {status.progressCount} events</p>
      )}
    </div>
  );
}
```

## Best Practices

### 1. Always Handle Loading States

```typescript
{isPolling && <LoadingSpinner message="AI is analyzing your battery data..." />}
```

### 2. Provide Immediate Feedback

```typescript
{initialSummary && (
  <div className="immediate-summary">
    <h4>Initial Analysis</h4>
    <p>Current SOC: {initialSummary.current.soc}%</p>
    <p>Voltage: {initialSummary.current.voltage}V</p>
  </div>
)}
```

### 3. Clean Up on Unmount

```typescript
useEffect(() => {
  return () => {
    stopPolling();  // Stop polling when component unmounts
  };
}, [stopPolling]);
```

### 4. Set Reasonable Timeouts

```typescript
const { status } = useInsightsPolling(jobId, {
  maxRetries: 200,      // ~15 minutes max
  initialInterval: 2000, // Start with 2s polling
  maxInterval: 10000     // Max 10s between polls
});
```

### 5. Cache Results

```typescript
const [insightsCache, setInsightsCache] = useState<Map<string, any>>(new Map());

const handleComplete = (jobId: string, insights: any) => {
  setInsightsCache(prev => new Map(prev).set(jobId, {
    insights,
    timestamp: Date.now()
  }));
};
```

## Troubleshooting

### Job Not Updating

Check that polling is active:
```typescript
console.log('Is polling:', isPolling);
console.log('Current interval:', currentInterval);
console.log('Retry count:', retryCount);
```

### Background Function Not Invoked

Verify environment:
```javascript
console.log('URL:', process.env.URL);
// Should be set in production, may be undefined in local dev
```

### Progress Events Not Appearing

Check MongoDB connection and job status:
```javascript
const status = await getInsightsJobStatus(jobId);
console.log('Job status:', status.status);
console.log('Progress count:', status.progressCount);
```

## Performance Tips

1. **Use Background Mode for Complex Analyses**: Queries requiring historical data, multiple tool calls, or trend analysis
2. **Use Sync Mode for Simple Queries**: Single data point analysis or quick status checks
3. **Implement Debouncing**: Avoid creating multiple jobs for the same analysis
4. **Show Progress Indicators**: Keep users engaged during long-running analyses
5. **Cache Initial Summaries**: Display immediately while background processing continues
