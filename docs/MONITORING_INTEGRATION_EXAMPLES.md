# Monitoring Dashboard Integration Example

This example shows how to integrate the MonitoringDashboard component into the admin interface.

## Step 1: Add to AdminDashboard Component

```tsx
// In components/AdminDashboard.tsx

import { MonitoringDashboard } from './MonitoringDashboard';

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="admin-dashboard">
      {/* Navigation Tabs */}
      <div className="tabs">
        <button onClick={() => setActiveTab('overview')}>Overview</button>
        <button onClick={() => setActiveTab('systems')}>Systems</button>
        <button onClick={() => setActiveTab('diagnostics')}>Diagnostics</button>
        <button onClick={() => setActiveTab('monitoring')}>Monitoring</button>
      </div>

      {/* Tab Content */}
      {activeTab === 'monitoring' && (
        <div className="tab-content">
          <MonitoringDashboard />
        </div>
      )}
      
      {/* Other tabs... */}
    </div>
  );
};
```

## Step 2: Use Standalone

```tsx
// In a dedicated monitoring page (e.g., admin-monitoring.tsx)

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MonitoringDashboard } from './components/MonitoringDashboard';

const MonitoringPage: React.FC = () => {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">AI System Monitoring</h1>
      <MonitoringDashboard />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MonitoringPage />
  </React.StrictMode>
);
```

## Step 3: Programmatic Access

```typescript
// Example: Automated budget alerts

async function checkBudgetThresholds() {
  const response = await fetch('/.netlify/functions/monitoring?type=cost&period=daily');
  const costMetrics = await response.json();
  
  const DAILY_BUDGET = 10.00; // $10 per day
  const percentUsed = (costMetrics.totalCost / DAILY_BUDGET) * 100;
  
  if (percentUsed >= 90) {
    await sendAlert({
      severity: 'critical',
      message: `Budget at ${percentUsed.toFixed(1)}% - $${costMetrics.totalCost.toFixed(2)} of $${DAILY_BUDGET}`,
      details: costMetrics.operationBreakdown
    });
  } else if (percentUsed >= 75) {
    await sendAlert({
      severity: 'warning',
      message: `Budget at ${percentUsed.toFixed(1)}% - $${costMetrics.totalCost.toFixed(2)} of $${DAILY_BUDGET}`
    });
  }
}

// Run every hour
setInterval(checkBudgetThresholds, 60 * 60 * 1000);
```

## Step 4: Custom Metrics

```typescript
// Example: Track custom application metrics

import { recordMetric } from './netlify/functions/utils/metrics-collector.cjs';

// Track user engagement
await recordMetric({
  metricType: 'performance',
  metricName: 'user_engagement',
  value: 95.5,
  unit: 'percent',
  metadata: {
    activeUsers: 150,
    avgSessionDuration: 1200 // seconds
  }
});

// Track data quality
await recordMetric({
  metricType: 'accuracy',
  metricName: 'extraction_accuracy',
  value: 98.2,
  unit: 'percent',
  systemId: 'bms-123',
  metadata: {
    totalExtractions: 100,
    successfulExtractions: 98
  }
});
```

## Step 5: Alert Integration

```typescript
// Example: Create alerts from custom logic

import { createAlert } from './netlify/functions/utils/metrics-collector.cjs';

async function checkSystemHealth() {
  const response = await fetch('/.netlify/functions/monitoring?type=realtime');
  const metrics = await response.json();
  
  // Alert on high error rate
  if (metrics.errorRate > 0.1) {
    await createAlert({
      severity: 'high',
      type: 'error_rate',
      message: `Error rate at ${(metrics.errorRate * 100).toFixed(1)}% - investigate immediately`,
      metadata: {
        currentRate: metrics.errorRate,
        threshold: 0.1,
        opsPerMinute: metrics.currentOperationsPerMinute
      }
    });
  }
  
  // Alert on circuit breaker open
  if (metrics.circuitBreakerStatus === 'OPEN') {
    await createAlert({
      severity: 'critical',
      type: 'circuit_breaker',
      message: 'Circuit breaker opened - external service may be down',
      metadata: {
        status: metrics.circuitBreakerStatus
      }
    });
  }
}
```

## Step 6: Feedback Tracking Workflow

```typescript
// Example: Track AI feedback from generation to implementation

import { trackFeedbackImplementation } from './netlify/functions/utils/metrics-collector.cjs';

// When AI generates a suggestion
async function generateAIFeedback(context) {
  const suggestion = await generateInsights(context);
  
  // Track the suggestion
  const trackingId = await trackFeedbackImplementation({
    feedbackId: suggestion.id,
    status: 'pending',
    suggestedAt: new Date().toISOString()
  });
  
  return { ...suggestion, trackingId };
}

// When user implements the suggestion
async function implementSuggestion(trackingId, implementationDetails) {
  const { getCollection } = require('./netlify/functions/utils/mongodb.cjs');
  const collection = await getCollection('feedback_tracking');
  
  await collection.updateOne(
    { id: trackingId },
    {
      $set: {
        status: 'implemented',
        implementedAt: new Date().toISOString(),
        implementationType: implementationDetails.type,
        implementationNotes: implementationDetails.notes,
        effectiveness: implementationDetails.effectiveness
      }
    }
  );
}

// When user rejects the suggestion
async function rejectSuggestion(trackingId, reason) {
  const { getCollection } = require('./netlify/functions/utils/mongodb.cjs');
  const collection = await getCollection('feedback_tracking');
  
  await collection.updateOne(
    { id: trackingId },
    {
      $set: {
        status: 'rejected',
        implementationNotes: reason
      }
    }
  );
}
```

## API Usage Examples

### Get Weekly Cost Report

```bash
curl "https://your-domain.netlify.app/.netlify/functions/monitoring?type=cost&period=weekly"
```

### Get Recent Unresolved Alerts

```bash
curl "https://your-domain.netlify.app/.netlify/functions/monitoring?type=alerts&resolved=false&limit=20"
```

### Get 48-Hour Performance Trends

```bash
curl "https://your-domain.netlify.app/.netlify/functions/monitoring?type=trends&hours=48"
```

### Get Complete Dashboard Data

```bash
curl "https://your-domain.netlify.app/.netlify/functions/monitoring?type=dashboard&period=daily"
```

## Environment Variables

No additional environment variables are required. The monitoring system uses existing configuration:

- `MONGODB_URI` - For storing metrics
- `GEMINI_MODEL` - For accurate cost tracking
- `LOG_LEVEL` - Controls logging verbosity

## Testing

Run the monitoring tests:

```bash
npm test -- metrics-collector.test.js
```

## Next Steps

1. **Add to Admin UI**: Integrate MonitoringDashboard into AdminDashboard component
2. **Set Up Alerts**: Configure notification thresholds
3. **Create Dashboards**: Build custom views for specific metrics
4. **Export Data**: Add functionality to export metrics for external analysis
5. **Automate Reports**: Schedule weekly/monthly cost and performance reports

## Dashboard Preview

The monitoring dashboard displays:

### Realtime Metrics (Top Row)
```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Ops/Min: 5  │ Latency:    │ Error Rate: │ Circuit     │
│             │ 2500ms      │ 2.0%        │ Breaker:    │
│             │             │             │ CLOSED      │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

### Cost Analysis
```
Total Cost: $0.1234    Total Tokens: 150,000    Avg Cost/Op: $0.0016

Analysis:    $0.05    (50 ops)
Insights:    $0.07    (20 ops)
Feedback:    $0.0034  (5 ops)
```

### Recent Alerts
```
🔴 HIGH - Cost Spike - 2025-11-26 10:30 AM
   Cost spike detected: $0.0245 vs avg $0.0082

🟡 MEDIUM - Latency - 2025-11-26 09:15 AM
   Latency spike detected: 5500ms vs avg 2500ms
```

### Performance Trends (24h)
```
     █
   █ █     █
 █ █ █ █   █ █
███████████████
00 03 06 09 12 15 18 21
```

### Feedback Stats
```
Total Suggestions: 45
Implementation Rate: 67%
Avg Effectiveness: 82/100
```
