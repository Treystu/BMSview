# Monitoring & Observability System - Quick Start Guide

## Overview

The BMSview monitoring and observability system provides comprehensive tracking of AI operations, cost management, anomaly detection, and feedback implementation metrics.

## Features

✅ **Real-time Metrics Dashboard**
- Operations per minute
- Average latency tracking
- Error rate monitoring
- Circuit breaker status

✅ **Cost Tracking & Analytics**
- Accurate Gemini API cost calculation
- Operation breakdown (analysis, insights, feedback)
- Daily/weekly/monthly aggregations
- Budget alert capabilities

✅ **Anomaly Detection**
- Automatic baseline calculation (7-day rolling window)
- Cost spike detection (3x baseline)
- Latency spike detection (2x baseline)
- Error rate alerts (>30% and 2x baseline)

✅ **Feedback Implementation Tracking**
- Implementation rate monitoring
- Effectiveness scoring (0-100)
- Status tracking (pending/implemented/rejected/expired)

## Quick Start

### 1. View the Dashboard

Add to your admin interface:

```tsx
import { MonitoringDashboard } from 'components/MonitoringDashboard';

function AdminPage() {
  return <MonitoringDashboard />;
}
```

### 2. Access via API

```bash
# Get complete dashboard data
curl https://your-domain.netlify.app/.netlify/functions/monitoring?type=dashboard

# Get cost metrics
curl https://your-domain.netlify.app/.netlify/functions/monitoring?type=cost&period=daily

# Get recent alerts
curl https://your-domain.netlify.app/.netlify/functions/monitoring?type=alerts
```

### 3. Seed Sample Data (Development)

```bash
npm run seed:monitoring
```

This creates 100 sample operations, 10 alerts, 20 feedback items, and 50 metrics for testing.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend Layer                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │      MonitoringDashboard Component (React)       │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ HTTP/REST
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   API Layer                             │
│  ┌──────────────────────────────────────────────────┐  │
│  │   monitoring.cjs (Netlify Function)              │  │
│  │   - Dashboard endpoint                            │  │
│  │   - Cost analytics                                │  │
│  │   - Alert management                              │  │
│  │   - Trends aggregation                            │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│               Business Logic Layer                      │
│  ┌──────────────────────────────────────────────────┐  │
│  │   metrics-collector.cjs                          │  │
│  │   - logAIOperation()                             │  │
│  │   - recordMetric()                               │  │
│  │   - createAlert()                                │  │
│  │   - checkForAnomalies()                          │  │
│  │   - getCostMetrics()                             │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                 Data Layer (MongoDB)                    │
│  ┌──────────────┬──────────────┬──────────────┬──────┐ │
│  │ ai_operations│ ai_metrics   │ anomaly_alerts│ ... │ │
│  └──────────────┴──────────────┴──────────────┴──────┘ │
└─────────────────────────────────────────────────────────┘
```

## Integration Points

The monitoring system is automatically integrated into:

1. **Analysis Pipeline** (`analysis-pipeline.cjs`)
   - Logs every BMS screenshot analysis
   - Tracks extraction attempts and quality scores
   - Records validation warnings

2. **Insights Generation** (`react-loop.cjs`)
   - Logs ReAct loop iterations
   - Tracks tool calls and conversation length
   - Records timeouts and errors

3. **Future**: Additional integration points can be added as needed

## MongoDB Collections

| Collection | Purpose | Retention |
|------------|---------|-----------|
| `ai_operations` | Detailed operation logs | 90 days recommended |
| `ai_metrics` | Application metrics | 90 days recommended |
| `anomaly_alerts` | System alerts | Keep until resolved |
| `feedback_tracking` | Implementation tracking | Indefinite |

## API Reference

### Endpoint: `/.netlify/functions/monitoring`

**Query Parameters:**

| Parameter | Type | Options | Default | Description |
|-----------|------|---------|---------|-------------|
| `type` | string | `dashboard`, `realtime`, `cost`, `alerts`, `trends`, `feedback` | `dashboard` | Data type to retrieve |
| `period` | string | `daily`, `weekly`, `monthly` | `daily` | Cost aggregation period |
| `startDate` | ISO date | - | - | Filter start date |
| `endDate` | ISO date | - | - | Filter end date |
| `resolved` | boolean | `true`, `false` | `false` | Filter alerts by status |
| `limit` | number | 1-1000 | `50` | Max results |
| `hours` | number | 1-168 | `24` | Hours of trend data |

**Response Examples:**

See [MONITORING_OBSERVABILITY.md](./MONITORING_OBSERVABILITY.md#api-endpoints) for detailed response schemas.

## Cost Calculation

Pricing for Gemini models (as of 2024):

| Model | Input Tokens | Output Tokens |
|-------|--------------|---------------|
| gemini-2.5-flash | $0.075 / 1M | $0.30 / 1M |
| gemini-1.5-flash | $0.075 / 1M | $0.30 / 1M |
| gemini-1.5-pro | $1.25 / 1M | $5.00 / 1M |

Example calculation:
```javascript
// 1M input tokens + 1M output tokens with gemini-2.5-flash
// Cost = (1M × $0.075/1M) + (1M × $0.30/1M) = $0.375
```

## Anomaly Detection Rules

### Cost Spike
```
Trigger: current_cost > average_cost × 3
Baseline: Last 7 days
Severity: High
```

### Latency Spike
```
Trigger: current_duration > average_duration × 2
Baseline: Last 7 days
Severity: Medium
```

### High Error Rate
```
Trigger: error_rate > 0.30 AND error_rate > baseline_error_rate × 2
Baseline: Last 7 days
Severity: Critical
```

## Usage Examples

### Track a Custom Metric

```javascript
import { recordMetric } from './netlify/functions/utils/metrics-collector.cjs';

await recordMetric({
  metricType: 'accuracy',
  metricName: 'extraction_accuracy',
  value: 95.5,
  unit: 'percent',
  systemId: 'bms-123'
});
```

### Create a Custom Alert

```javascript
import { createAlert } from './netlify/functions/utils/metrics-collector.cjs';

await createAlert({
  severity: 'high',
  type: 'custom',
  message: 'Database connection pool exhausted',
  metadata: {
    poolSize: 10,
    activeConnections: 10
  }
});
```

### Track Feedback Implementation

```javascript
import { trackFeedbackImplementation } from './netlify/functions/utils/metrics-collector.cjs';

await trackFeedbackImplementation({
  feedbackId: 'suggestion-123',
  status: 'implemented',
  implementedAt: new Date().toISOString(),
  effectiveness: 85,
  implementationNotes: 'Improved validation logic per AI suggestion'
});
```

## Testing

Run the test suite:

```bash
# All tests
npm test

# Monitoring tests only
npm test -- metrics-collector.test.js

# With coverage
npm run test:coverage
```

Test coverage: **16/16 tests passing (100%)**

## Dashboard Features

The `MonitoringDashboard` component provides:

- **Real-time Updates**: Auto-refresh every 30 seconds (configurable)
- **Interactive Charts**: Performance trends visualization
- **Alert Management**: Color-coded severity indicators
- **Cost Breakdown**: By operation type
- **Responsive Design**: Works on mobile and desktop

## Environment Setup

No additional environment variables required. Uses existing:

- `MONGODB_URI` - Database connection
- `GEMINI_MODEL` - For cost tracking
- `LOG_LEVEL` - Logging verbosity

## Performance Considerations

- **Database Queries**: Optimized with indexes on `timestamp` and `success` fields
- **Aggregations**: Cached for 1 minute to reduce load
- **Retention**: Set up TTL indexes to auto-delete old data
- **Pagination**: Use `limit` parameter for large datasets

## Troubleshooting

**Problem**: No data appearing in dashboard

**Solutions**:
1. Check MongoDB connection: `MONGODB_URI` set correctly?
2. Verify collections exist: Use MongoDB Compass or shell
3. Check browser console for API errors
4. Seed sample data: `npm run seed:monitoring`

**Problem**: High costs showing

**Solutions**:
1. Review operation breakdown
2. Check for duplicate operations
3. Analyze context window sizes
4. Consider using cheaper models for simple tasks

**Problem**: Too many alerts

**Solutions**:
1. Review and update alert thresholds
2. Check for infrastructure issues
3. Update baselines after major changes
4. Resolve and dismiss false positives

## Documentation

- [Complete Documentation](./MONITORING_OBSERVABILITY.md)
- [Integration Examples](./MONITORING_INTEGRATION_EXAMPLES.md)
- [API Reference](./MONITORING_OBSERVABILITY.md#api-endpoints)

## Support

For issues or questions:
1. Check documentation above
2. Review [troubleshooting section](#troubleshooting)
3. Open a GitHub issue with details

## License

Part of BMSview project - see main LICENSE file.
