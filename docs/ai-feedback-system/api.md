# AI Feedback System API Documentation

## Overview

The AI Feedback System provides intelligent validation and statistical analysis for BMS (Battery Management System) data. This system includes:

- **Validation Feedback**: Converts validation errors into AI-actionable guidance
- **Quality Scoring**: Quantifies data extraction accuracy (0-100 scale)
- **Statistical Analysis**: Deep insights from battery performance data
- **Trend Detection**: Linear regression for predictive analytics

## Table of Contents

1. [Validation Feedback API](#validation-feedback-api)
2. [Statistical Analysis API](#statistical-analysis-api)
3. [System Analytics Endpoint](#system-analytics-endpoint)
4. [Error Handling](#error-handling)
5. [Integration Examples](#integration-examples)

---

## Validation Feedback API

### Module Location
`netlify/functions/utils/validation-feedback.cjs`

### Function: `generateValidationFeedback(validationResult, attemptNumber)`

Converts validation failures into structured feedback for AI retry attempts.

**Parameters:**
```javascript
{
  validationResult: {
    isValid: boolean,
    warnings: Array<string>,  // All validation issues
    flags: Array<string>      // Critical failures only
  },
  attemptNumber: number       // Current retry attempt (1-based)
}
```

**Returns:**
- `string` - Formatted feedback with critical errors, warnings, and retry instructions
- `null` - If validation passed

**Example:**
```javascript
const feedback = generateValidationFeedback({
  isValid: false,
  warnings: ['Invalid SOC: 150%', 'Voltage mismatch: 60V vs 52.28V'],
  flags: ['Invalid SOC: 150%', 'Voltage mismatch: 60V vs 52.28V']
}, 2);

// Output:
// RETRY ATTEMPT 2: The previous extraction failed with 2 critical error(s)...
// CRITICAL ERRORS TO FIX:
// 1. Invalid SOC: 150% - Re-examine the SOC field...
// INSTRUCTIONS FOR THIS RETRY:
// - Verify unit conversions (mV to V, kW to W)...
```

---

### Function: `calculateQualityScore(validationResult)`

Quantifies data extraction quality on a 0-100 scale.

**Scoring Algorithm:**
- Base score: 100
- Deduct 20 points per critical error
- Deduct 5 points per warning
- Minimum score: 0

**Example:**
```javascript
const score = calculateQualityScore({
  warnings: ['Critical 1', 'Warning 1', 'Warning 2'],
  flags: ['Critical 1']
});
// Returns: 70 (100 - 20 - 5 - 5)
```

---

## Statistical Analysis API

### Module Location
`netlify/functions/utils/comprehensive-analytics.cjs`

### Function: `generateComprehensiveAnalytics(systemId, analysisData, log)`

Main entry point for complete battery system analysis.

**Parameters:**
- `systemId` (string): Battery system identifier
- `analysisData` (Object): Current BMS data
- `log` (Object): Logger instance

**Returns:** `Promise<Object>`

**Response Structure:**
```javascript
{
  metadata: {
    systemId, generatedAt, analysisVersion
  },
  currentState: {
    voltage, current, power, soc, mode,
    runtimeHours, temperature, cellVoltageDiff
  },
  loadProfile: {
    hourly: [{hour, avgWatts}],
    nighttime: {avgWatts, avgKwh},
    daytime: {avgWatts, avgKwh}
  },
  energyBalance: {
    avgDailyGenKwh, avgDailyConsKwh,
    solarSufficiency, batteryAutonomy
  },
  solarPerformance: {
    avgDailyChargeKwh, expectedDailySolarKwh,
    performanceRatio
  },
  batteryHealth: {
    healthScore, healthStatus, recommendation,
    imbalance: {status, currentMv},
    temperature: {status, avgC},
    capacity: {degradationPercent},
    cycleLife: {current, remaining}
  },
  trends: {
    soc: {trend, changePerDay, rSquared, confidence},
    voltage: {...},
    temperature: {...}
  },
  anomalies: {
    voltageSpikes, currentAnomalies, temperatureExtremes
  },
  recommendationContext: {
    priorities, optimizations, maintenance, strengths
  }
}
```

---

### Function: `linearRegression(dataPoints)`

Performs least-squares linear regression for trend analysis.

**Parameters:**
```javascript
dataPoints: Array<{x: number, y: number}>
```

**Returns:**
```javascript
{
  slope: number,           // Rate of change
  intercept: number,       // Y-intercept
  rSquared: number,        // Goodness of fit (0-1)
  predict: (x) => number  // Prediction function
}
```

**Confidence Interpretation:**
- R² > 0.7: High confidence
- R² 0.4-0.7: Medium confidence
- R² < 0.4: Low confidence

**Example:**
```javascript
const trend = linearRegression([
  {x: 0, y: 100}, {x: 1, y: 95}, {x: 2, y: 90}
]);
// trend.slope = -5 (losing 5% per day)
// trend.rSquared = 1.0 (perfect fit)
// trend.predict(7) = 65 (predicted value day 7)
```

---

## System Analytics Endpoint

### `GET /.netlify/functions/system-analytics`

Returns aggregated hourly statistics for a battery system.

**Query Parameters:**
- `systemId` (required): System identifier

**Response:**
```json
{
  "hourlyAverages": [
    {
      "hour": 12,
      "avgCurrent": {"charge": 25.5, "discharge": -15.2},
      "avgPower": {"charge": 1275, "discharge": -760},
      "avgSOC": 75.5,
      "avgTemperature": 28.3
    }
  ],
  "performanceBaseline": {
    "sunnyDayChargingAmpsByHour": [...]
  },
  "alertAnalysis": {
    "totalAlerts": 42,
    "alertCounts": [{"type": "Low Battery", "count": 12}]
  }
}
```

**cURL Example:**
```bash
curl "https://your-site.netlify.app/.netlify/functions/system-analytics?systemId=sys-123"
```

---

## Error Handling

### Standard Error Format

All functions return errors in this format:

```javascript
{
  statusCode: number,
  error: string,
  message: string,
  details?: Object,
  code?: string
}
```

### Common Error Codes

| Code | Status | Description | Solution |
|------|--------|-------------|----------|
| `MISSING_SYSTEM_ID` | 400 | Required parameter missing | Add systemId to request |
| `INSUFFICIENT_DATA` | 200 | Not enough historical data | Returns partial results with flag |
| `VALIDATION_FAILED` | 200 | Data validation errors | Check validation feedback |
| `MONGODB_ERROR` | 500 | Database connection issue | Verify MONGODB_URI env var |
| `TIMEOUT` | 504 | Operation exceeded limit | Reduce time range |

---

## Integration Examples

### Example 1: Complete Analysis Pipeline

```javascript
const { performAnalysis } = require('./analysis-pipeline.cjs');
const { generateComprehensiveAnalytics } = require('./comprehensive-analytics.cjs');

async function analyzeBMS(imageData, systemId) {
  // Extract data with validation
  const result = await performAnalysis(imageData, systemId, log);
  
  if (!result.isValid) {
    console.error('Validation failed:', result.qualityScore);
    // Retry or manual review
  }
  
  // Generate analytics
  const analytics = await generateComprehensiveAnalytics(
    systemId, result.data, log
  );
  
  return {
    healthScore: analytics.batteryHealth.healthScore,
    recommendations: analytics.recommendationContext.priorities
  };
}
```

### Example 2: Quality Monitoring

```javascript
const { calculateQualityScore } = require('./validation-feedback.cjs');

function monitorQuality(validationResults) {
  const scores = validationResults.map(calculateQualityScore);
  const avgScore = scores.reduce((a,b) => a+b) / scores.length;
  
  if (avgScore < 80) {
    console.warn(`Data quality declining: ${avgScore}/100`);
    // Alert administrator
  }
  
  return { avgScore, trend: scores.slice(-10) };
}
```

---

## Performance Guidelines

**Data Requirements:**
- Trend analysis: 7+ days
- Energy balance: 48+ hours
- Load profiling: 24+ hours

**Typical Response Times:**
- Validation feedback: < 10ms
- Quality score: < 5ms
- Comprehensive analytics: 500-2000ms
- System analytics: 200-800ms

**Optimization:**
- Cache analytics for 5-15 minutes
- Use incremental updates
- Implement time-based pagination
- Ensure MongoDB indexes on `systemId` + `timestamp`

---

## API Version

Current: **2.0-comprehensive**

See [CHANGELOG.md](../../CHANGELOG.md) for version history.
