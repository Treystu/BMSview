# ReAct Loop Integration into generate-insights-with-tools.cjs

This document shows how to integrate the new ReAct loop into the existing insights generation endpoint.

## Current State

The file `generate-insights-with-tools.cjs` currently uses:
- `runGuruConversation()` from `insights-guru-runner.cjs`
- `getAIModelWithTools()` from `insights-processor.cjs`

These are legacy implementations.

## Migration Path

### Option 1: Minimal Change (Recommended for Phase 1)

Add ReAct loop as alternative path:

```javascript
const { executeReActLoop } = require('./utils/react-loop.cjs');

// In handler, SYNC MODE section:
if (isSyncMode) {
  log.info('Using synchronous mode');

  // Try new ReAct loop first
  if (process.env.USE_REACT_LOOP === 'true') {
    const result = await executeReActLoop({
      analysisData,
      systemId,
      customPrompt,
      log,
      mode: 'sync'
    });

    if (result.success) {
      return respond(200, {
        success: true,
        insights: { rawText: result.finalAnswer },
        toolCalls: [],
        analysisMode: 'sync',
        usedFunctionCalling: true,
        iterations: result.turns,
        durationMs: result.durationMs,
        timestamp: new Date().toISOString()
      });
    } else {
      log.warn('ReAct loop failed, falling back to legacy', { error: result.error });
    }
  }

  // Fallback to existing implementation
  const model = await getAIModelWithTools(log);
  // ... existing code ...
}
```

**Advantages:**
- No breaking changes
- Can A/B test both implementations
- Gradual migration path
- Easy rollback if issues

**Activation:**
```bash
export USE_REACT_LOOP=true
```

### Option 2: Full Migration (Phase 2)

Replace entire sync mode with ReAct loop:

```javascript
async function handler(event = {}, context = {}) {
  // ... existing setup code ...

  if (isSyncMode) {
    const result = await executeReActLoop({
      analysisData,
      systemId,
      customPrompt,
      log,
      mode: 'sync'
    });

    if (!result.success) {
      return respond(500, {
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }

    return respond(200, {
      success: true,
      insights: { rawText: result.finalAnswer },
      analysisMode: 'sync',
      iterations: result.turns,
      toolCalls: result.toolCalls || [],
      durationMs: result.durationMs,
      timestamp: new Date().toISOString()
    });
  }

  // Background mode remains unchanged
  // ... existing background code ...
}
```

**Advantages:**
- Cleaner codebase
- Single implementation path
- Better maintainability

**Timing:**
- Wait for Phase 1 validation
- Monitor metrics and user feedback
- Then implement full migration

## Response Format Mapping

### Old Format (Legacy)
```javascript
{
  success: true,
  insights: {
    rawText: "Analysis...",
    formattedText: "Formatted analysis...",
    healthStatus: "Good",
    performance: { trend: "Stable" }
  },
  usedFunctionCalling: false
}
```

### New Format (ReAct Loop)
```javascript
{
  success: true,
  insights: {
    rawText: result.finalAnswer  // Markdown from Gemini
  },
  iterations: result.turns,
  toolCalls: result.toolCalls || [],
  usedFunctionCalling: true,
  durationMs: result.durationMs
}
```

### Mapping Logic
```javascript
function mapReActToLegacyFormat(reactResult) {
  if (!reactResult.success) {
    return { success: false, error: reactResult.error };
  }

  return {
    success: true,
    insights: {
      rawText: reactResult.finalAnswer,
      // Try to extract sections if needed
      formattedText: reactResult.finalAnswer,
      healthStatus: 'Analyzed',
      performance: { trend: 'See full response' }
    },
    toolCalls: reactResult.toolCalls || [],
    iterations: reactResult.turns,
    usedFunctionCalling: true,
    durationMs: reactResult.durationMs
  };
}
```

## Monitoring During Migration

### Key Metrics to Track

```javascript
const reactLoopMetrics = {
  enabled: process.env.USE_REACT_LOOP === 'true',
  successRate: 0,
  avgTurns: 0,
  avgToolCalls: 0,
  avgDuration: 0,
  timeoutCount: 0,
  errorCount: 0
};
```

### Prometheus Integration

```javascript
// Track which implementation was used
const implementationCounter = new prometheus.Counter({
  name: 'insights_implementation_total',
  help: 'Which insights implementation was used',
  labelNames: ['implementation', 'mode', 'status']
});

// In handler:
const implementation = process.env.USE_REACT_LOOP === 'true' ? 'react-loop' : 'legacy';
implementationCounter.inc({
  implementation,
  mode: isSyncMode ? 'sync' : 'background',
  status: result.success ? 'success' : 'error'
});
```

## Feature Flags

Add to environment configuration:

```javascript
const FEATURE_FLAGS = {
  USE_REACT_LOOP: process.env.USE_REACT_LOOP === 'true',
  REACT_LOOP_SYNC_ONLY: process.env.REACT_LOOP_SYNC_ONLY === 'true',
  REACT_LOOP_SAMPLE_RATE: parseFloat(process.env.REACT_LOOP_SAMPLE_RATE || '1.0'),
  REACT_LOOP_MAX_TURNS: parseInt(process.env.REACT_LOOP_MAX_TURNS || '5'),
  REACT_LOOP_TIMEOUT_MS: parseInt(process.env.REACT_LOOP_TIMEOUT_MS || '55000')
};
```

### Gradual Rollout

```javascript
// 10% of requests use ReAct loop
if (FEATURE_FLAGS.USE_REACT_LOOP && Math.random() < FEATURE_FLAGS.REACT_LOOP_SAMPLE_RATE) {
  return await useReActLoop(params);
} else {
  return await useLegacyImplementation(params);
}
```

## Testing Integration

### Local Development

```bash
# Test ReAct loop only
USE_REACT_LOOP=true npm run dev

# Test legacy implementation
npm run dev

# Test with reduced timeout for faster iteration
REACT_LOOP_TIMEOUT_MS=10000 USE_REACT_LOOP=true npm run dev
```

### Manual Test Cases

1. **Simple Question (No Tools)**
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/generate-insights-with-tools \
     -d '{"analysisData": {...}, "systemId": "test", "customPrompt": "What is my current SOC?"}'
   ```
   - Expected: 1 turn, 0 tool calls

2. **Complex Question (Tools)**
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/generate-insights-with-tools \
     -d '{"analysisData": {...}, "systemId": "test", "customPrompt": "Is my battery degrading? Check the last 90 days."}'
   ```
   - Expected: 2-3 turns, 1-2 tool calls

3. **Error Handling**
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/generate-insights-with-tools \
     -d '{"analysisData": {...}, "systemId": "invalid-sys"}'
   ```
   - Expected: Graceful error with explanation

## Rollback Plan

If ReAct loop has issues:

```bash
# Disable ReAct loop
unset USE_REACT_LOOP

# Or set to false
export USE_REACT_LOOP=false

# Redeploy
npm run build && netlify deploy --prod
```

All requests will use legacy implementation automatically.

## Performance Tuning

### If timeouts occur:

```bash
# Reduce max turns
export REACT_LOOP_MAX_TURNS=3

# Reduce context budget (tools get less time to run)
export REACT_LOOP_CONTEXT_BUDGET_MS=15000

# Reduce total budget
export REACT_LOOP_TIMEOUT_MS=45000
```

### If tools are slow:

Check tool execution logs:
```bash
# Monitor logs for tool execution time
tail -f logs/netlify-functions.log | grep "Tool execution"
```

Common slowdowns:
- Large data aggregations (hourly for 90+ days)
- Raw sampling exceeding 500 points
- MongoDB connection issues

Solutions:
- Increase daily_avg granularity for long ranges
- Add MongoDB indexes
- Implement tool result caching

## Deployment Checklist

- [ ] `tool-executor.cjs` created and tested
- [ ] `react-loop.cjs` created and tested  
- [ ] `geminiClient.cjs` updated with tools support
- [ ] Feature flag enabled: `USE_REACT_LOOP=true`
- [ ] Local testing passed all manual test cases
- [ ] Metrics collection configured
- [ ] Logs show proper tool calls and results
- [ ] Staging deployment validated
- [ ] Rollback plan documented
- [ ] Team notified of changes
- [ ] Production deployment with monitoring

## Support & Debugging

### Common Issues

**"No tools are being called"**
- Check if tool definitions are valid JSON
- Verify Gemini is enabled and responding
- Check logs for Gemini API errors

**"Timeout after 2-3 turns"**
- Tools are slow - check tool execution logs
- Reduce MAX_TURNS to get faster response
- Check MongoDB performance

**"Final answer is incomplete"**
- Question might need more data (try background mode)
- Check if max turns was hit (should be in logs)
- Tool may have failed silently (check function responses)

### Getting Logs

```bash
# Watch live logs
netlify logs --function=generate-insights-with-tools --tail

# Search for errors
netlify logs --function=generate-insights-with-tools | grep -i error

# Get specific request logs
netlify logs --function=generate-insights-with-tools | grep "requestId"
```

## Next Steps

1. **Phase 1:** Integrate ReAct loop as alternative (Option 1)
2. **Phase 2:** Monitor metrics for 1-2 weeks
3. **Phase 3:** Implement full migration (Option 2)
4. **Phase 4:** Complete remaining tool implementations
5. **Phase 5:** Performance optimization and tuning
