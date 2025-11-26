# AI Feedback System Monitoring & Observability

## Overview

This document describes the comprehensive monitoring and observability infrastructure implemented for the AI feedback system in BMSview. The system provides real-time metrics, cost tracking, anomaly detection, and feedback implementation tracking.

## Architecture

### Components

1. **Metrics Collector** (`netlify/functions/utils/metrics-collector.cjs`)
   - Core utility for collecting and storing metrics
   - Handles AI operation logging, cost calculation, and anomaly detection
   - Stores data in MongoDB collections

2. **Monitoring Endpoint** (`netlify/functions/monitoring.cjs`)
   - RESTful API for retrieving monitoring data
   - Supports multiple query types (realtime, cost, alerts, trends, feedback, dashboard)
   - Provides aggregated data for dashboards

3. **Monitoring Dashboard** (`components/MonitoringDashboard.tsx`)
   - React component for visualizing monitoring data
   - Auto-refresh capability with configurable intervals
   - Real-time performance metrics and alerts

4. **Integrated Metrics** (in `analysis-pipeline.cjs` and `react-loop.cjs`)
   - Automatic metrics collection during AI operations
   - Tracks operation duration, token usage, and success/failure
   - Anomaly detection on every operation

## MongoDB Collections

### `ai_operations`
Stores detailed logs of all AI operations.

**Schema:**
```javascript
{
  id: string,              // Unique operation ID
  timestamp: string,       // ISO timestamp
  operation: string,       // 'analysis' | 'insights' | 'feedback_generation'
  systemId: string,        // BMS system ID
  duration: number,        // Operation duration in ms
  tokensUsed: number,      // Total tokens consumed
  inputTokens: number,     // Input tokens
  outputTokens: number,    // Output tokens
  cost: number,            // Cost in USD
  success: boolean,        // Operation success status
  error: string,           // Error message (if failed)
  model: string,           // Gemini model used
  contextWindowDays: number, // Context window size
  metadata: object         // Additional operation metadata
}
```

### `ai_metrics`
Stores application-level metrics.

**Schema:**
```javascript
{
  id: string,
  timestamp: string,
  systemId: string,
  metricType: string,      // 'accuracy' | 'implementation_rate' | 'performance' | 'cost' | 'anomaly'
  metricName: string,
  value: number,
  unit: string,
  metadata: object
}
```

### `anomaly_alerts`
Stores alerts for anomalous behavior.

**Schema:**
```javascript
{
  id: string,
  timestamp: string,
  severity: string,        // 'low' | 'medium' | 'high' | 'critical'
  type: string,           // 'cost_spike' | 'error_rate' | 'latency' | 'accuracy_drop' | 'circuit_breaker'
  message: string,
  metadata: object,
  resolved: boolean,
  resolvedAt: string
}
```

### `feedback_tracking`
Tracks AI feedback implementation status.

**Schema:**
```javascript
{
  id: string,
  feedbackId: string,
  suggestedAt: string,
  implementedAt: string,
  status: string,          // 'pending' | 'implemented' | 'rejected' | 'expired'
  implementationType: string,
  implementationNotes: string,
  effectiveness: number    // 0-100 score
}
```

## API Endpoints

### GET `/.netlify/functions/monitoring`

Base monitoring endpoint with multiple query modes.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | `dashboard` | Query type: `realtime`, `cost`, `alerts`, `trends`, `feedback`, `dashboard` |
| `period` | string | `daily` | Cost period: `daily`, `weekly`, `monthly` |
| `startDate` | ISO date | - | Filter start date |
| `endDate` | ISO date | - | Filter end date |
| `resolved` | boolean | `false` | Filter alerts by resolution status |
| `limit` | number | `50` | Maximum results to return |
| `hours` | number | `24` | Hours of trend data to retrieve |

#### Response Types

**Realtime Metrics:**
```json
{
  "currentOperationsPerMinute": 5,
  "averageLatency": 2500,
  "errorRate": 0.02,
  "circuitBreakerStatus": "CLOSED"
}
```

**Cost Metrics:**
```json
{
  "period": "daily",
  "startDate": "2025-11-25T00:00:00Z",
  "endDate": "2025-11-26T00:00:00Z",
  "totalCost": 0.1234,
  "totalTokens": 150000,
  "operationBreakdown": {
    "analysis": { "count": 50, "cost": 0.05, "tokens": 75000 },
    "insights": { "count": 20, "cost": 0.07, "tokens": 70000 },
    "feedbackGeneration": { "count": 5, "cost": 0.0034, "tokens": 5000 }
  },
  "averageCostPerOperation": 0.00164
}
```

**Dashboard (Combined):**
```json
{
  "realtimeMetrics": { ... },
  "costMetrics": { ... },
  "recentAlerts": [ ... ],
  "performanceTrends": [ ... ],
  "feedbackStats": { ... }
}
```

## Usage Examples

### Using the Monitoring Endpoint

```javascript
// Get dashboard data
const response = await fetch('/.netlify/functions/monitoring?type=dashboard');
const data = await response.json();

// Get cost metrics for the last week
const costResponse = await fetch(
  '/.netlify/functions/monitoring?type=cost&period=weekly'
);
const costData = await costResponse.json();

// Get unresolved alerts
const alertsResponse = await fetch(
  '/.netlify/functions/monitoring?type=alerts&resolved=false&limit=10'
);
const alerts = await alertsResponse.json();

// Get performance trends for the last 48 hours
const trendsResponse = await fetch(
  '/.netlify/functions/monitoring?type=trends&hours=48'
);
const trends = await trendsResponse.json();
```

### Using the Metrics Collector

```javascript
const {
  logAIOperation,
  createAlert,
  trackFeedbackImplementation
} = require('./utils/metrics-collector.cjs');

// Log an AI operation
const operationId = await logAIOperation({
  operation: 'analysis',
  systemId: 'bms-123',
  duration: 5000,
  tokensUsed: 1500,
  inputTokens: 1000,
  outputTokens: 500,
  success: true,
  model: 'gemini-2.5-flash',
  metadata: {
    fileName: 'screenshot.png',
    extractionAttempts: 1
  }
});

// Create an anomaly alert
const alertId = await createAlert({
  severity: 'high',
  type: 'cost_spike',
  message: 'Daily cost exceeded $10 threshold',
  metadata: { threshold: 10, actual: 15.50 }
});

// Track feedback implementation
const trackingId = await trackFeedbackImplementation({
  feedbackId: 'feedback-456',
  status: 'implemented',
  implementedAt: new Date().toISOString(),
  effectiveness: 85,
  implementationNotes: 'Improved data validation logic'
});
```

### Using the Monitoring Dashboard Component

```tsx
import { MonitoringDashboard } from 'components/MonitoringDashboard';

function AdminPage() {
  return (
    <div>
      <h1>Admin Dashboard</h1>
      <MonitoringDashboard className="mt-6" />
    </div>
  );
}
```

## Anomaly Detection

The system automatically detects anomalies based on historical baselines:

### Cost Spike Detection
- **Threshold:** 3x average cost
- **Baseline:** Last 7 days
- **Severity:** High

### Latency Spike Detection
- **Threshold:** 2x average duration
- **Baseline:** Last 7 days
- **Severity:** Medium

### Error Rate Detection
- **Threshold:** >30% error rate AND 2x baseline
- **Baseline:** Last 7 days
- **Severity:** Critical

### How It Works

```javascript
// Automatically triggered after each operation
await checkForAnomalies({
  duration: operationDuration,
  cost: operationCost
});
```

The `checkForAnomalies` function:
1. Fetches historical operations from the last 7 days
2. Calculates baseline metrics (avg cost, avg duration, error rate)
3. Compares current operation against baselines
4. Creates alerts if thresholds are exceeded

## Cost Tracking

### Pricing Configuration

Current Gemini API pricing (as of 2024):

| Model | Input Tokens | Output Tokens |
|-------|-------------|---------------|
| gemini-2.5-flash | $0.075 / 1M | $0.30 / 1M |
| gemini-1.5-flash | $0.075 / 1M | $0.30 / 1M |
| gemini-1.5-pro | $1.25 / 1M | $5.00 / 1M |

### Cost Calculation

```javascript
const { calculateGeminiCost } = require('./utils/metrics-collector.cjs');

const cost = calculateGeminiCost(
  'gemini-2.5-flash',
  1000000,  // 1M input tokens
  1000000   // 1M output tokens
);
// Returns: 0.375 USD
```

### Budget Alerts

To set up budget alerts:

1. Monitor the `costMetrics` endpoint regularly
2. Set up thresholds in your monitoring dashboard
3. Configure notifications when thresholds are exceeded

Example:

```javascript
const { costMetrics } = await fetch('/.netlify/functions/monitoring?type=cost&period=daily')
  .then(r => r.json());

if (costMetrics.totalCost > DAILY_BUDGET_THRESHOLD) {
  // Send notification
  await sendBudgetAlert({
    current: costMetrics.totalCost,
    threshold: DAILY_BUDGET_THRESHOLD,
    percentUsed: (costMetrics.totalCost / DAILY_BUDGET_THRESHOLD) * 100
  });
}
```

## Performance Metrics

### Real-time Metrics

Updated every minute:
- **Operations Per Minute:** Current request rate
- **Average Latency:** Mean operation duration (last 5 minutes)
- **Error Rate:** Percentage of failed operations (last minute)
- **Circuit Breaker Status:** Current state of the circuit breaker

### Performance Trends

Hourly aggregations showing:
- Average operation duration
- Success count
- Error count

Useful for identifying patterns and performance degradation over time.

## Best Practices

### 1. Regular Monitoring
- Check the dashboard at least daily
- Set up auto-refresh for critical metrics
- Review alerts weekly

### 2. Cost Management
- Monitor daily costs
- Set budget thresholds at 50%, 75%, and 90%
- Review operation breakdown monthly

### 3. Anomaly Response
- Investigate all critical alerts within 1 hour
- Document patterns in recurring alerts
- Update baselines after major changes

### 4. Feedback Tracking
- Review implementation rates monthly
- Track effectiveness scores
- Use insights to improve AI suggestions

### 5. Performance Optimization
- Use performance trends to identify bottlenecks
- Optimize slow operations (>10s avg duration)
- Monitor error rates after deployments

## Integration with Existing Systems

### Circuit Breaker Integration

The circuit breaker status is tracked but not yet fully integrated. To add:

```javascript
// In geminiClient.cjs
const circuitBreaker = new CircuitBreaker({ ... });

// After circuit breaker state changes
if (circuitBreaker.getState() === 'OPEN') {
  await createAlert({
    severity: 'critical',
    type: 'circuit_breaker',
    message: 'Circuit breaker opened due to repeated failures'
  });
}
```

### Insights Generation Integration

Already integrated in `react-loop.cjs`:
- Logs successful insights generation
- Tracks token usage and duration
- Records errors with context

### Analysis Pipeline Integration

Already integrated in `analysis-pipeline.cjs`:
- Logs each analysis operation
- Tracks extraction attempts and quality scores
- Records validation warnings

## Troubleshooting

### No Data Appearing

1. Check MongoDB connection
2. Verify environment variables are set
3. Check browser console for errors
4. Verify API endpoint is accessible

### High Costs

1. Review operation breakdown
2. Check for duplicate operations
3. Analyze context window sizes
4. Consider using smaller models for simple tasks

### Frequent Alerts

1. Review alert thresholds
2. Check for infrastructure issues
3. Analyze error patterns
4. Update baselines if system has changed

## Future Enhancements

- [ ] Integration with external alerting systems (Slack, PagerDuty)
- [ ] Predictive cost forecasting
- [ ] ML-based anomaly detection
- [ ] Custom alert rules and thresholds
- [ ] Export functionality for metrics data
- [ ] Automated cost optimization recommendations
- [ ] Real-time circuit breaker status updates
- [ ] Performance comparison between models
- [ ] User-specific cost tracking
- [ ] A/B testing framework for AI suggestions

## References

- [MongoDB Collections Schema](../types.ts)
- [Metrics Collector Implementation](../netlify/functions/utils/metrics-collector.cjs)
- [Monitoring Endpoint](../netlify/functions/monitoring.cjs)
- [Dashboard Component](../components/MonitoringDashboard.tsx)
- [Gemini API Pricing](https://ai.google.dev/pricing)
