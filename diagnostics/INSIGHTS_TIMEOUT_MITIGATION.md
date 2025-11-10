# Generate Insights Timeout Mitigation Guide

**Created**: 2025-11-09  
**Status**: Active mitigation strategies for timeout scenarios

## Overview

The `generate-insights-with-tools.cjs` function implements AI-powered analysis using Gemini 2.5 Flash with function calling. Due to Netlify's 60-second timeout limit for serverless functions, we've implemented multiple strategies to handle long-running queries.

## Current Configuration

```javascript
const MAX_TOOL_ITERATIONS = 10;       // Maximum function call rounds
const ITERATION_TIMEOUT_MS = 25000;   // 25s per iteration (increased from 20s)
const TOTAL_TIMEOUT_MS = 58000;       // 58s total (2s buffer for Netlify's 60s limit)
const MAX_CONVERSATION_TOKENS = 60000; // Token limit for conversation history
```

## Execution Modes

### 1. Synchronous Mode (Default for Simple Queries)
- **Trigger**: `?sync=true` or `?mode=sync`
- **Behavior**: Returns insights immediately (up to 55s)
- **Use case**: Simple queries requiring <3 tool iterations
- **Timeout handling**: Returns partial results if timeout approaches

### 2. Background Mode (Default for Complex Queries)
- **Trigger**: Default behavior, or `?mode=background`
- **Behavior**: Creates job, triggers background function, returns jobId
- **Use case**: Complex queries requiring multiple tool iterations or long processing
- **Timeout handling**: No timeout limit (function can run as long as needed)
- **Status polling**: Frontend polls `/insights-job-status?jobId={id}` for completion

## Mitigation Strategies

### Strategy 1: Automatic Background Handoff (Current Default)
**Implementation**: Already active  
**Effectiveness**: ✅ High

The system automatically uses background mode for queries likely to exceed 55s:
- Complex prompts (>500 characters)
- Queries requesting historical data
- Multi-system analysis requests

**Configuration** (in `generate-insights-with-tools.cjs`):
```javascript
function resolveRunMode(queryParams, body, analysisData, customPrompt) {
  // Explicit mode from query param
  if (queryParams.mode === 'sync' || queryParams.sync === 'true') {
    return 'sync';
  }
  if (queryParams.mode === 'background') {
    return 'background';
  }

  // Auto-detect based on prompt complexity
  const promptLength = (customPrompt || '').length;
  if (promptLength > 500) {
    return 'background'; // Complex prompts likely need more time
  }

  return 'background'; // Default to background for safety
}
```

### Strategy 2: Prompt Optimization (Manual)
**Implementation**: User guidance  
**Effectiveness**: ✅ Medium-High

**Guidelines for users**:
1. **Be specific**: "Show cell voltage trends for last 24 hours" vs "Analyze everything"
2. **Limit scope**: Request specific time ranges instead of "all historical data"
3. **Break complex queries**: Ask multiple simpler questions instead of one complex query
4. **Use filters**: Specify systemId to avoid multi-system lookups

**Examples**:
```
❌ BAD: "Analyze all battery data and weather patterns over the last month and compare with solar generation"
✅ GOOD: "Show battery SOC trends for last 7 days for system ABC123"
```

### Strategy 3: Reduce Max Tool Iterations (Configuration)
**Implementation**: Adjust constants in `generate-insights-with-tools.cjs`  
**Effectiveness**: ⚠️ Medium (reduces quality)

**Current**: `MAX_TOOL_ITERATIONS = 10`  
**Option**: Reduce to `6-8` for faster completion

**Trade-off**: Gemini may not gather all needed data before responding

**When to use**: If seeing frequent timeouts in sync mode despite background handoff

### Strategy 4: Increase Timeout Buffers (Configuration)
**Implementation**: Adjust timeouts in `generate-insights-with-tools.cjs`  
**Effectiveness**: ⚠️ Low (limited by Netlify's 60s hard limit)

**Current settings**:
```javascript
const ITERATION_TIMEOUT_MS = 25000;   // 25s per iteration
const TOTAL_TIMEOUT_MS = 58000;       // 58s total
```

**Recommendation**: Current values are optimal. Do NOT increase `TOTAL_TIMEOUT_MS` beyond 58s.

### Strategy 5: Prompt Slimming (Automated)
**Implementation**: ✅ Already active in `insights-guru-runner.cjs`  
**Effectiveness**: ✅ High

The system automatically trims conversation history to stay within token limits:

```javascript
// From insights-guru-runner.cjs
function trimConversationHistory(parts, maxTokens, log) {
  let estimatedTokens = parts.reduce((sum, part) => {
    const text = part.text || JSON.stringify(part);
    return sum + (text.length * TOKENS_PER_CHAR);
  }, 0);

  if (estimatedTokens <= maxTokens) {
    return parts;
  }

  // Keep system prompt (first part) and recent conversation
  const systemPrompt = parts[0];
  let recentParts = parts.slice(-5); // Keep last 5 exchanges
  
  // ... trimming logic
}
```

**Monitoring**: Check logs for `Trimmed conversation history` messages

### Strategy 6: Force Background Mode (Frontend)
**Implementation**: Client-side configuration  
**Effectiveness**: ✅ High

**For admin users**: Add toggle in Admin Dashboard to force all insights to background mode

**Implementation** (in `services/clientService.ts`):
```typescript
export async function generateInsights(
  analysisData: AnalysisData,
  systemId?: string,
  customPrompt?: string,
  forceBackground: boolean = false // New parameter
): Promise<InsightsResponse> {
  const mode = forceBackground ? 'background' : undefined;
  
  const response = await fetch(`/.netlify/functions/generate-insights-with-tools${mode ? '?mode=background' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisData, systemId, customPrompt })
  });
  
  // ... handle response
}
```

## Monitoring & Diagnostics

### Key Metrics to Track

1. **Execution Time Distribution**
   - Track via structured logs: `{ operation: 'generate-insights', duration_ms: ... }`
   - Alert if >90% of requests use background mode (may indicate prompt issues)

2. **Tool Iteration Counts**
   - Log: `Guru conversation completed in {iteration} iterations`
   - Ideal: 2-4 iterations for most queries
   - Alert: >8 iterations suggests inefficient prompts

3. **Timeout Frequency**
   - Log: `Timeout error in sync mode`
   - Track ratio of timeouts to total sync requests
   - Target: <5% timeout rate

4. **Background Job Completion Time**
   - Track: `insights-jobs` collection field `completedAt - createdAt`
   - Median should be <2 minutes
   - Alert if >5 minutes for simple queries

### Diagnostic Commands

```bash
# Check recent timeout logs (local dev)
netlify dev # Start dev server
# Upload analysis and trigger insights
# Check terminal logs for "Timeout" or "timed out"

# Check MongoDB for background job stats
db.getCollection('insights-jobs').aggregate([
  { $match: { status: 'completed' } },
  { $project: {
      duration: { $subtract: ['$completedAt', '$createdAt'] }
  }},
  { $group: {
      _id: null,
      avgDuration: { $avg: '$duration' },
      maxDuration: { $max: '$duration' }
  }}
])
```

### Admin Diagnostics Integration

The Admin Diagnostics panel includes an "Insights Performance" test that validates:
- ✅ Background job creation succeeds
- ✅ Job status polling works
- ✅ Completed jobs return valid insights
- ⚠️ Execution time is within acceptable range (<120s for background)

**Access**: Admin Dashboard → Diagnostics → Run "Insights Performance" test

## Recommended Actions by Scenario

### Scenario 1: Frequent Sync Mode Timeouts
**Symptoms**: Users seeing "Request timed out" errors  
**Action**:
1. Switch default mode to `background` (already implemented)
2. Add UI hint: "Complex queries may take 1-2 minutes. We'll notify you when ready."
3. Monitor logs for prompt patterns causing timeouts

### Scenario 2: Background Jobs Taking >5 Minutes
**Symptoms**: Long job completion times in diagnostics  
**Action**:
1. Check Gemini API latency (external service)
2. Review tool call logs for excessive iterations
3. Consider adding prompt templates for common queries

### Scenario 3: Users Prefer Instant Results
**Symptoms**: Feedback requesting faster insights  
**Action**:
1. Provide "Quick Insights" option (sync mode with simplified prompt)
2. Full insights via background mode
3. Show progress indicator during background processing

### Scenario 4: Token Limit Warnings in Logs
**Symptoms**: `Trimmed conversation history` appears frequently  
**Action**:
1. Already handled automatically (Strategy 5)
2. If quality degrades, reduce `MAX_TOOL_ITERATIONS` from 10 to 8
3. Add prompt guidance to be more concise

## Performance Optimization Checklist

- [x] Background mode as default for complex queries
- [x] Automatic conversation history trimming
- [x] Timeout buffers configured (58s total, 25s per iteration)
- [x] Job status polling UI for background mode
- [ ] Add "Quick Insights" sync mode option in UI (optional enhancement)
- [ ] Add prompt templates for common queries (optional enhancement)
- [ ] Implement retry with exponential backoff for transient Gemini API errors (optional)
- [ ] Add caching for repeated identical queries (optional)

## Related Documentation

- **Function Calling Implementation**: `netlify/functions/generate-insights-with-tools.cjs`
- **Background Job Management**: `netlify/functions/utils/insights-jobs.cjs`
- **Conversation Runner**: `netlify/functions/utils/insights-guru-runner.cjs`
- **Admin Diagnostics**: `ADMIN_DIAGNOSTICS_GUIDE.md`
- **Architecture Overview**: `ARCHITECTURE.md`

## Conclusion

The current implementation provides robust timeout mitigation through:
1. ✅ Automatic background handoff (default for safety)
2. ✅ Prompt slimming and conversation trimming
3. ✅ Configurable timeout buffers
4. ✅ Job-based async processing for long queries

**No immediate action required** unless monitoring reveals timeout patterns.

**Next steps** (optional enhancements):
- Add "Quick Insights" vs "Deep Analysis" UI toggle
- Implement prompt templates for common use cases
- Add query caching for repeated identical requests
