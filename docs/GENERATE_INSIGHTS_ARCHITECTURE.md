# Generate Insights - Function Calling Architecture

## Overview

The Generate Insights feature has been completely redesigned to implement **true function calling** with Gemini 2.5 Flash. This enables the AI to actively request additional data as needed, resulting in more comprehensive and data-driven analysis.

## Architecture

### Previous Design (Pre-11/06/2025)
- Pre-fetched all data upfront (30-100 records)
- Sent everything in a single large prompt
- No ability for AI to request additional data
- Frequent timeouts with large datasets
- Limited to 30 data points for analysis

### New Design (11/06/2025+)
- **Initial Load**: 30 days of hourly averaged data (720 hours)
- **On-Demand**: AI can request specific time ranges, metrics, or granularities
- **Iterative**: Multi-turn conversation with up to 10 tool call iterations
- **Efficient**: Data aggregation reduces token usage by 50-90%
- **Robust**: Timeout protection at iteration and total levels

## Context Enrichment (November 2025)
- **Guru Preload Pipeline**: `insights-guru.cjs` now gathers system analytics, energy budgets, forecasts, weather snapshots, and the latest 24 history records before Gemini is prompted
- **Snapshot Delta Insights**: Recent history aggregation computes SOC drift, net amp-hour movement, charging/discharging ratios, and alert counts for immediate situational awareness
- **Shared Context Summary**: Both synchronous and background flows return a structured `contextSummary`, enabling the UI to display a “Guru Context Primer” alongside streaming insights
- **Status Endpoint Upgrade**: `generate-insights-status.cjs` surfaces `contextSummary`, so operators polling background jobs receive the same contextual brief without waiting for final output
- **Background Dispatch Hardening**: Full qualified Netlify URLs are accepted in `INSIGHTS_BACKGROUND_URL`, preventing duplicate `generate-insights-background` suffixes in custom deployments

## Data Flow

```
1. User submits query
   ↓
2. Load 30 days of hourly averaged data
   ↓
3. Send to Gemini with tool definitions
   ↓
4. Gemini responds with:
   • tool_call (JSON) → Execute tool → Loop back to #3
   • final_answer (JSON) → Return to user
   ↓
5. Display results
```

## Tool Definitions

### Primary Tool: `request_bms_data`

The main data access tool that Gemini uses to request BMS data.

**Parameters:**
- `systemId` (string, required): Battery system identifier
- `metric` (string, required): Which metrics to retrieve
  - Options: `all`, `voltage`, `current`, `power`, `soc`, `capacity`, `temperature`, `cell_voltage_difference`
- `time_range_start` (string, required): ISO 8601 timestamp (e.g., `"2025-10-01T00:00:00Z"`)
- `time_range_end` (string, required): ISO 8601 timestamp
- `granularity` (string, optional): Data resolution
  - `hourly_avg` (default, recommended)
  - `daily_avg`
  - `raw` (use sparingly)

**Example Request from Gemini:**
```json
{
  "tool_call": "request_bms_data",
  "parameters": {
    "systemId": "abc-123",
    "metric": "all",
    "time_range_start": "2025-10-01T00:00:00Z",
    "time_range_end": "2025-11-01T00:00:00Z",
    "granularity": "hourly_avg"
  }
}
```

**Example Response:**
```json
{
  "systemId": "abc-123",
  "metric": "all",
  "time_range": {
    "start": "2025-10-01T00:00:00Z",
    "end": "2025-11-01T00:00:00Z"
  },
  "granularity": "hourly_avg",
  "dataPoints": 720,
  "data": [
    {
      "timestamp": "2025-10-01T00:00:00Z",
      "dataPoints": 5,
      "avgVoltage": 52.3,
      "avgCurrent": 12.5,
      "avgPower": 653,
      "avgSoC": 65.2,
      "avgCapacity": 260.8,
      "avgTemperature": 25.3,
      "avgMosTemperature": 30.1,
      "avgCellVoltageDiff": 0.0045,
      "avgChargingCurrent": 15.2,
      "avgDischargingCurrent": 8.3,
      "chargingCount": 3,
      "dischargingCount": 2
    }
    // ... 719 more hours
  ]
}
```

### Supporting Tools

- **`getWeatherData`**: Weather conditions for correlation analysis
- **`getSolarEstimate`**: Solar generation estimates
- **`getSystemAnalytics`**: Performance baselines and patterns
- **`getSystemHistory`** (deprecated): Use `request_bms_data` instead

## Data Aggregation

### Hourly Averaging

The system aggregates raw BMS records into hourly buckets to reduce token usage while preserving trends.

**Metrics Computed:**
- **Unidirectional**: Average (voltage, SOC, capacity, temperature)
- **Bidirectional**: Separate averages for charging and discharging (current, power)
- **Metadata**: Data points per hour, charging/discharging counts

**Benefits:**
- 50-90% reduction in data size
- Preserves hourly patterns (e.g., solar charging at noon)
- Maintains trend analysis capability
- Reduces Gemini API token usage

### Example Transformation

**Input: 10 raw records in 1 hour**
```json
[
  {"timestamp": "2025-11-01T10:05:00Z", "current": 12.3, "voltage": 52.1},
  {"timestamp": "2025-11-01T10:11:00Z", "current": 13.1, "voltage": 52.2},
  {"timestamp": "2025-11-01T10:17:00Z", "current": 11.8, "voltage": 52.0},
  // ... 7 more
]
```

**Output: 1 hourly aggregate**
```json
{
  "timestamp": "2025-11-01T10:00:00Z",
  "dataPoints": 10,
  "avgCurrent": 12.4,
  "avgVoltage": 52.1,
  "avgChargingCurrent": 12.4,
  "chargingCount": 10
}
```

## Timeout Protection

### Multi-Level Timeouts

1. **Per-Iteration**: 20 seconds for each Gemini API call
2. **Total**: 55 seconds for entire function execution (under Netlify's 60s limit)
3. **Frontend**: 60 seconds for user-facing request

### Timeout Behavior

- **Iteration Timeout**: Aborts current Gemini call, returns error to user
- **Total Timeout**: Stops function calling loop, returns best-effort results
- **Frontend Timeout**: Aborts fetch request, shows user-friendly message

### Error Messages

The system provides actionable feedback when timeouts occur:

```
Request timed out. The AI took too long to process your query.

Suggestions:
• Try a simpler question
• Request a smaller time range (e.g., "past 7 days" instead of "past 30 days")
• Break complex queries into multiple questions
```

## System Prompt

### Instructions for Gemini

```
You are a BMS data analyst. Your goal is to answer the user's question based on the data provided.

IMPORTANT INSTRUCTIONS FOR DATA REQUESTS:

1. If you can answer with the data provided, respond with:
   {
     "final_answer": "Your detailed analysis here..."
   }

2. If the data is insufficient, request more data with:
   {
     "tool_call": "tool_name",
     "parameters": {
       "param1": "value1",
       "param2": "value2"
     }
   }
```

### Example Conversation

**Turn 1 (User → Gemini):**
```
System: [Instructions + 30 days hourly data + current snapshot]
User Question: "How much energy did I generate from solar in the past 7 days?"
```

**Turn 2 (Gemini → System):**
```json
{
  "tool_call": "request_bms_data",
  "parameters": {
    "systemId": "abc-123",
    "metric": "power",
    "time_range_start": "2025-10-30T00:00:00Z",
    "time_range_end": "2025-11-06T00:00:00Z",
    "granularity": "hourly_avg"
  }
}
```

**Turn 3 (System → Gemini):**
```
Tool response from request_bms_data:
{
  "dataPoints": 168,
  "data": [/* 168 hours of power data */]
}
```

**Turn 4 (Gemini → User):**
```json
{
  "final_answer": "Based on 7 days of hourly data, your system generated approximately 
  45.2 kWh from solar charging. Analysis shows peak generation at 11 AM - 1 PM daily, 
  with an average of 6.5 kWh per day. This represents an 8% increase over your 30-day average."
}
```

## Performance Metrics

### Typical Performance

- **Initial Load**: 1-2 seconds (30 days hourly data from MongoDB)
- **Gemini Iteration**: 3-8 seconds per tool call
- **Total**: 10-40 seconds for complex queries
- **Token Usage**: ~10K-30K tokens (vs 50K-100K+ in old design)

### Edge Cases

- **Max Iterations (10)**: ~50-55 seconds (near timeout limit)
- **No Historical Data**: 3-5 seconds (snapshot analysis only)
- **Large Time Ranges**: Use daily_avg granularity to stay under token limits

## Configuration

### Environment Variables

```bash
# Gemini API Configuration
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash  # Default model

# Timeout Configuration (optional)
GEMINI_TIMEOUT_MS=20000  # Per-iteration timeout
```

### Constants in Code

```javascript
// netlify/functions/generate-insights-with-tools.cjs
const MAX_TOOL_ITERATIONS = 10;           // Maximum function calling rounds
const DEFAULT_DAYS_LOOKBACK = 30;         // Default initial data range
const ITERATION_TIMEOUT_MS = 20000;       // 20s per iteration
const TOTAL_TIMEOUT_MS = 55000;           // 55s total
```

## Migration Notes

### Breaking Changes

- None (backward compatible)
- Old `generate-insights` endpoint still works
- Frontend automatically uses enhanced mode (`useEnhancedMode: true`)

### Recommended Actions

1. Monitor Netlify function logs for timeout patterns
2. Adjust `DEFAULT_DAYS_LOOKBACK` if 30 days is too much for typical queries
3. Consider implementing result caching for repeated queries
4. Add user education about optimal query phrasing

## Troubleshooting

### Common Issues

**Issue**: 504 Gateway Timeout
- **Cause**: Query too complex or time range too large
- **Solution**: User should simplify query or reduce time range
- **Code Check**: Verify `TOTAL_TIMEOUT_MS < 60000`

**Issue**: Empty insights
- **Cause**: Gemini responded with plain text instead of JSON
- **Solution**: System falls back to treating response as final_answer
- **Code**: See `executeWithFunctionCalling` line ~330

**Issue**: Too many iterations
- **Cause**: Gemini making unnecessary tool calls
- **Solution**: Improve system prompt to discourage redundant requests
- **Code**: Check `MAX_TOOL_ITERATIONS` setting

**Issue**: High token usage
- **Cause**: Raw data or daily_avg for large ranges
- **Solution**: Use hourly_avg (default) for time ranges > 7 days
- **Code**: Check `granularity` parameter in requests

## Testing

Run the test suite:

```bash
cd /home/runner/work/BMSview/BMSview
node netlify/functions/test-generate-insights.cjs
```

### Test Coverage

- ✅ Data aggregation (hourly averaging)
- ✅ Tool definitions (structure validation)
- ✅ JSON parsing (tool_call and final_answer)
- ⏭️ Prompt building (requires DB access)
- ⏭️ End-to-end function calling (requires Gemini API)

## Future Enhancements

### Potential Improvements

1. **Caching**: Cache aggregated data for recent time ranges
2. **Streaming**: Stream insights as they're generated (SSE)
3. **Model Selection**: Allow user to choose Gemini model (Flash vs Pro)
4. **Custom Granularity**: 15-minute, 6-hour, or weekly aggregations
5. **Parallel Tool Calls**: Execute multiple independent tool calls simultaneously
6. **Smart Defaults**: Infer optimal time range from user question

### Monitoring Recommendations

- Track average iterations per query
- Monitor timeout rate (should be < 5%)
- Measure token usage per query type
- Track most common tool calls
- Analyze query patterns for optimization opportunities

## References

- [Gemini Function Calling Documentation](https://ai.google.dev/docs/function_calling)
- [MongoDB Aggregation Pipeline](https://www.mongodb.com/docs/manual/core/aggregation-pipeline/)
- [Netlify Functions Limits](https://docs.netlify.com/functions/overview/#default-deployment-options)
- [ISO 8601 Timestamp Format](https://en.wikipedia.org/wiki/ISO_8601)
