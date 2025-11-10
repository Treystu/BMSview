# ReAct Loop Implementation - Complete Guide

## Overview

The ReAct (Reasoning + Acting) loop is now fully implemented in BMSview. This enables Gemini to:

1. **Reason:** Analyze the current situation and determine what data is needed
2. **Act:** Call tools to fetch that data
3. **Loop:** Incorporate results and repeat until reaching a final answer

This replaces static, pre-computed context with dynamic, intelligent data requests.

## Architecture

### Component Overview

```
request
  ↓
collectAutoInsightsContext() → Preload cheap analytics (~22s budget)
  ↓
buildGuruPrompt() → Create rich prompt with tool definitions
  ↓
executeReActLoop()
  ├─ Initialize conversation history
  ├─ Loop (max 5 turns):
  │  ├─ Call Gemini with history + tools
  │  ├─ Detect functionCall in response
  │  ├─ If tool call: executeToolCall() → add result to history → continue
  │  └─ If final answer: extract text → return
  └─ Return final answer + metadata
```

### Files Created/Modified

| File | Purpose | Type |
|------|---------|------|
| `netlify/functions/utils/tool-executor.cjs` | Execute tool calls (MongoDB aggregations, data transforms) | New |
| `netlify/functions/utils/react-loop.cjs` | Main ReAct loop orchestration | New |
| `netlify/functions/utils/geminiClient.cjs` | Updated to support conversation history + tools | Modified |
| `tests/react-loop.test.js` | Integration tests for ReAct loop | New |

### Key Design Decisions

1. **Max 5 Turns:** Prevents infinite loops while allowing 2-3 meaningful data requests
2. **55s Total Budget:** Sync mode completes within Netlify's 60s limit with 5s buffer
3. **Tool Definitions:** Defined in `gemini-tools.cjs`, executed by `tool-executor.cjs`
4. **Conversation History:** Maintained in memory during loop, added to Gemini requests
5. **Error Resilience:** Tool failures don't stop loop, results added as error responses

## Usage

### Basic Example: Use in generate-insights-with-tools.cjs

```javascript
const { executeReActLoop } = require('./utils/react-loop.cjs');

// In your handler:
const result = await executeReActLoop({
  analysisData: { voltage: 48.5, current: 5, soc: 85 },
  systemId: 'sys-123',
  customPrompt: 'Is my battery degrading?',
  log: logger,
  mode: 'sync' // or 'background'
});

// result.success === true
// result.finalAnswer contains markdown analysis
// result.turns shows how many iterations were needed
// result.toolCalls shows how many tools were executed
```

### Tool Calls from Gemini

When Gemini needs data, it responds with a `functionCall`:

```json
{
  "role": "model",
  "parts": [
    {
      "functionCall": {
        "name": "request_bms_data",
        "args": {
          "systemId": "sys-123",
          "metric": "voltage",
          "time_range_start": "2025-11-01T00:00:00Z",
          "time_range_end": "2025-11-02T00:00:00Z",
          "granularity": "hourly_avg"
        }
      }
    }
  ]
}
```

The loop:
1. Detects the `functionCall`
2. Calls `executeToolCall('request_bms_data', args, log)`
3. Gets back data
4. Adds to conversation history as `functionResponse`
5. Continues loop with updated context

### Available Tools

#### 1. `request_bms_data` - Primary Data Access ✅ IMPLEMENTED

Request specific BMS metrics with time filtering and aggregation.

**Parameters:**
- `systemId` (string, required) - Battery system ID
- `metric` (string, required) - One of: `voltage`, `current`, `power`, `soc`, `capacity`, `temperature`, `cell_voltage_difference`, `all`
- `time_range_start` (string, required) - ISO 8601 format, e.g. "2025-11-01T00:00:00Z"
- `time_range_end` (string, required) - ISO 8601 format
- `granularity` (string, optional) - One of: `raw` (limit 500), `hourly_avg` (default), `daily_avg`

**Example Response:**
```json
{
  "systemId": "sys-123",
  "metric": "voltage",
  "time_range": {"start": "2025-11-01T00:00:00Z", "end": "2025-11-02T00:00:00Z"},
  "granularity": "hourly_avg",
  "dataPoints": 24,
  "data": [
    {"timestamp": "2025-11-01T00:00:00Z", "avgVoltage": 48.5, "minVoltage": 48.2, "maxVoltage": 48.8},
    ...
  ]
}
```

#### 2. `getSystemHistory` - Legacy Data Retrieval ✅ IMPLEMENTED

Get historical records for a system with optional date filtering.

**Parameters:**
- `systemId` (string, required)
- `limit` (number, optional, default: 100, max: 500)
- `startDate` (string, optional) - ISO format YYYY-MM-DD
- `endDate` (string, optional) - ISO format YYYY-MM-DD

#### 3. `getWeatherData` - Environmental Context 🔄 STUB

Get weather data for location and timestamp.

**Parameters:**
- `latitude` (number, required)
- `longitude` (number, required)
- `timestamp` (string, optional) - ISO format
- `type` (string, optional) - One of: `current`, `historical`, `hourly`

**Status:** Currently returns stub. Needs integration with weather service.

#### 4. `getSolarEstimate` - Solar Forecasting 🔄 STUB

Get solar energy generation estimates.

**Parameters:**
- `location` (string, required) - US zip code or "lat,lon"
- `panelWatts` (number, required) - Solar panel capacity in watts
- `startDate` (string, required) - YYYY-MM-DD
- `endDate` (string, required) - YYYY-MM-DD

**Status:** Currently returns stub. Needs integration with solar service.

#### 5-8. Other Tools 🔄 STUBS

The following tools have definitions but need implementation:
- `getSystemAnalytics` - System performance analysis
- `predict_battery_trends` - Predictive modeling
- `analyze_usage_patterns` - Pattern recognition
- `calculate_energy_budget` - Energy budgeting

## Implementation Details

### Tool Executor (`tool-executor.cjs`)

Dispatcher routes tool names to implementations:

```javascript
async function executeToolCall(toolName, parameters, log) {
  switch (toolName) {
    case 'request_bms_data':
      return await requestBmsData(parameters, log);
    case 'getSystemHistory':
      return await getSystemHistory(parameters, log);
    // ... etc
  }
}
```

**Key Features:**
- MongoDB aggregation for hourly/daily buckets
- Intelligent sampling for large datasets
- Metric extraction and filtering
- Error handling with detailed logging
- Placeholder implementations for pending tools

### Gemini Client Updates

The `geminiClient.cjs` now supports:

```javascript
const response = await geminiClient.callAPI(null, {
  history: conversationHistory,        // Multi-turn support
  tools: toolDefinitions,              // Tool definitions
  toolMode: 'AUTO',                    // When to call tools
  model: 'gemini-2.5-flash',           // Model selection
  maxOutputTokens: 4096
}, log);
```

**Request Structure:**
```javascript
{
  contents: [
    { role: 'user', parts: [...] },
    { role: 'model', parts: [...] },
    { role: 'function', parts: [...] },
    // ... conversation history
  ],
  tools: [{
    function_declarations: [
      { name: 'request_bms_data', description: '...', parameters: {...} },
      // ... other tools
    ]
  }],
  tool_config: {
    function_calling_config: { mode: 'AUTO' }
  },
  generationConfig: { ... }
}
```

### ReAct Loop (`react-loop.cjs`)

Main orchestration logic:

```javascript
async function executeReActLoop(params) {
  // 1. Collect context (pre-computed analytics)
  const context = await collectAutoInsightsContext(...)
  
  // 2. Build initial prompt with tools
  const { prompt, contextSummary } = await buildGuruPrompt({...})
  
  // 3. Initialize conversation
  const conversationHistory = [{ role: 'user', parts: [{text: prompt}] }]
  
  // 4. Main loop
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Call Gemini
    const response = await geminiClient.callAPI(null, {
      history: conversationHistory,
      tools: toolDefinitions
    })
    
    // Add response to history
    conversationHistory.push(response.content)
    
    // Check for tool calls
    const toolCalls = response.content.parts.filter(p => p.functionCall)
    
    if (toolCalls.length === 0) {
      // Extract final answer
      finalAnswer = extract_text(response)
      break
    }
    
    // Execute tools
    for (const toolCall of toolCalls) {
      const result = await executeToolCall(...)
      conversationHistory.push({
        role: 'function',
        parts: [{ functionResponse: { name, response: { result } } }]
      })
    }
  }
  
  return { finalAnswer, turns, toolCalls: ... }
}
```

## Performance Characteristics

### Timing

| Operation | Budget | Notes |
|-----------|--------|-------|
| Context preload | 22s | Runs in parallel; includes analytics, predictions, patterns |
| Gemini API call | ~2-5s | Per iteration; includes tool call detection |
| Tool execution | ~1-3s | Per tool; varies by data size and DB performance |
| Sync mode total | 55s | Includes 5s safety margin before 60s Netlify timeout |
| Max turns | 5 | Each turn includes Gemini call + potential tool exec |

### Data Sizes

- **Hourly data:** ~200 points = ~8 days
- **Daily data:** ~365 points = 1 year
- **Raw sampling:** Max 500 points to prevent context overflow
- **Conversation limit:** ~60,000 tokens (soft limit, pruning occurs)

## Testing

### Unit Tests

Run the integration tests:

```bash
npm test -- react-loop.test.js
```

**Test Coverage:**
- Single-turn completion (no tools)
- Multi-turn with tool calls
- Error handling
- Timeout management
- Max turns constraint
- Context collection
- Invalid Gemini responses

### Manual Testing

Test via curl:

```bash
curl -X POST http://localhost:8888/.netlify/functions/generate-insights-with-tools \
  -H "Content-Type: application/json" \
  -d '{
    "analysisData": {
      "overallVoltage": 48.5,
      "current": 5,
      "stateOfCharge": 85
    },
    "systemId": "my-battery",
    "customPrompt": "Is my battery degrading? Check the last 60 days of voltage"
  }'
```

Expected flow:
1. Returns `200` with `insights` object
2. `iterations` shows 2-3 loops (tool call + analysis + final)
3. `toolCalls` array shows what data was requested
4. `finalAnswer` contains detailed markdown analysis

## Debugging

### Logs to Check

All tool calls are logged with:
- `toolName` - Which tool was called
- `paramKeys` - What parameters were requested
- `resultSize` - Size of result in bytes
- `duration` - How long execution took
- `error` - Any errors during execution

Example:
```json
{
  "level": "info",
  "timestamp": "2025-11-09T12:34:56.789Z",
  "context": "react-loop",
  "message": "Executing tool call",
  "toolName": "request_bms_data",
  "paramKeys": ["systemId", "metric", "time_range_start", "time_range_end"]
}
```

### Common Issues

**Issue:** Loop times out after 2-3 turns

**Solution:** Tools are taking too long. Check:
- MongoDB query performance
- Network latency
- Check `duration` log for tool execution time

**Issue:** Gemini doesn't call tools

**Solution:** Either:
- Question is simple enough to answer from initial context
- Model is choosing not to call tools (valid behavior)
- Tool definitions not properly formatted

Check `toolDefinitions` in request sent to Gemini.

**Issue:** Tool returns empty data

**Solution:** Query may not match any records. Check:
- `systemId` is correct
- Time range is valid and has data
- Metric name is spelled correctly

## Next Steps

### Complete Tool Implementations

1. **getWeatherData** - Integrate with external weather API
2. **getSolarEstimate** - Connect to solar estimation service
3. **getSystemAnalytics** - Implement analytics calculations
4. **predictBatteryTrends** - Add forecasting models
5. **analyzeUsagePatterns** - Pattern detection logic
6. **calculateEnergyBudget** - Energy balance calculations

### Performance Optimization

1. Cache common queries (weather, solar, system profile)
2. Parallelize independent tool calls
3. Implement smarter sampling for raw data
4. Add query result compression

### Monitoring

Set up metrics for:
- Turns per request distribution
- Tool success/failure rates
- Response time percentiles (p50, p95, p99)
- Tool execution time by tool name
- Timeout rate in sync mode

Example Prometheus metrics:

```javascript
const turnsHistogram = new prometheus.Histogram({
  name: 'insights_react_loop_turns',
  help: 'Number of turns in ReAct loop',
  buckets: [1, 2, 3, 4, 5, 6]
});

const toolCallsCounter = new prometheus.Counter({
  name: 'insights_tool_calls_total',
  help: 'Total tool calls executed',
  labelNames: ['tool', 'status'] // status: success|failure
});
```

## References

- **Gemini Function Calling:** https://ai.google.dev/gemini-api/docs/function-calling
- **ReAct Pattern:** https://arxiv.org/abs/2210.03629
- **Tool Definitions Format:** See `gemini-tools.cjs`
- **BMSview Documentation:** See project README and guides

## Summary

✅ **Implemented:**
- Core ReAct loop orchestration
- Tool executor with aggregation logic
- Gemini client function calling support
- Conversation history management
- Error handling and timeouts

🔄 **In Progress:**
- Stub implementations for remaining tools
- Integration tests

📋 **TODO:**
- Complete tool implementations
- Performance tuning
- Monitoring setup
- Documentation updates
