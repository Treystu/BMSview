# Initialization Sequence Implementation - Summary

## Overview
Implemented a comprehensive initialization sequence for Gemini insights generation to solve the "insufficient data" problem by forcing Gemini to retrieve historical data before analysis.

## Problem Solved
Gemini was frequently claiming "insufficient historical data (only 4 records)" despite having full database access. The root cause was that Gemini wasn't actually calling the data retrieval tools - it was just analyzing whatever minimal data was preloaded in the initial prompt.

## Solution Components

### 1. Mandatory Initialization Sequence
**File:** `netlify/functions/utils/react-loop.cjs`

- **Before Analysis:** Gemini MUST successfully call `request_bms_data` and retrieve actual historical data
- **Retry Logic:** Up to 100 retry attempts (effectively infinite within Netlify timeout)
- **Budget Allocation:** Uses maximum 50% of total time budget for initialization
- **Verification:** Checks that `dataPoints > 0` before proceeding to main analysis

**Flow:**
```
1. User requests insights
2. Initialization prompt sent to Gemini
3. Gemini calls request_bms_data (with retry if it doesn't)
4. Tool returns data (verified dataPoints > 0)
5. Initialization marked complete
6. Main ReAct loop begins with confirmed data access
```

### 2. Context Window Control (UI)
**File:** `components/AnalysisResult.tsx`

Added a visual slider allowing users to control how much historical data Gemini retrieves:

**Slider Options:**
- 1 Hour
- 3 Hours
- 12 Hours
- 1 Day
- 3 Days
- 1 Week (7 days)
- 2 Weeks (14 days)
- **1 Month (30 days)** ← DEFAULT
- 2 Months (60 days)
- 3 Months (90 days)
- 6 Months (180 days)
- 1 Year (365 days)

**UI Location:** 
Appears in the "Battery Guru Insights" section, above the "Generate AI Insights" button.

**Visual Design:**
```
📊 Data Analysis Window: 1 Month
Select how far back the AI should retrieve historical data for analysis.
Larger windows provide more context but may take longer to process.

[1 Hour] ━━━━●━━━━━━━━━━━━━━━━━━━ [1 Year]
Recent                    Comprehensive
```

### 3. Adaptive Iteration Limits
**Files:** `netlify/functions/utils/react-loop.cjs`, `components/AnalysisResult.tsx`

**Old:** 5 iterations for all queries (defined as `MAX_TURNS`)

**New:**
- **Standard insights:** 10 iterations (doubled)
- **Custom queries:** 20 iterations (4x original)

**Automatic Detection:**
- Presence of `customPrompt` triggers 20-iteration mode
- Standard insights use 10 iterations

### 4. Keyword-Based Error Recovery
**File:** `netlify/functions/utils/react-loop.cjs`

When Gemini fails to call tools or claims data unavailability, the system:

1. **Analyzes Response Text** for keywords indicating specific struggles
2. **Detects Concepts:** 
   - Data access issues
   - Specific tool problems (weather, solar, analytics, etc.)
   - Format errors (dates, systemId)
   - General access issues

3. **Provides Targeted Guidance** based on detected issues:
   - Shows comprehensive data catalog
   - Provides working examples with actual systemId and dates
   - Lists common mistakes to avoid
   - Offers step-by-step recovery instructions

**Keyword Categories:**
```javascript
{
  'request_bms_data': ['insufficient data', 'not enough data', 'limited data', ...],
  'getWeatherData': ['weather', 'temperature', 'clouds', ...],
  'getSolarEstimate': ['solar', 'solar production', 'panel', ...],
  'date_format': ['invalid date', 'date format', 'iso 8601', ...],
  'systemid_missing': ['system id', 'systemid', 'no system', ...],
  // ... and more
}
```

### 5. Enhanced Data Catalog
**File:** `netlify/functions/utils/insights-guru.cjs`

Two complementary functions provide comprehensive data source information:

#### `buildDataAvailabilitySummary()`
Full catalog included in initial prompt (already existed, enhanced):
- Complete queryable date range
- Available metrics list
- All available tools
- Pre-loaded data indicators
- Complete data source breakdown (BMS, Weather, Calculated, etc.)
- 3 working examples with actual parameters
- Common mistakes section

#### `buildQuickReferenceCatalog()` (NEW)
Condensed version for error recovery:
- System ID reminder
- Queryable range summary
- Primary tool parameters
- Working example with actual dates
- Critical rules checklist

### 6. Comprehensive Logging
**Files:** `netlify/functions/utils/react-loop.cjs`, `netlify/functions/generate-insights-with-tools.cjs`

**What Gets Logged:**
- Every Gemini response (truncated to 2000 chars)
- All tool calls attempted by Gemini
- Tool execution results (success or failure)
- Keyword detection results
- Initialization sequence progress
- Retry attempts and reasons

**Log Levels:**
- `INFO`: Successful operations, initialization progress
- `WARN`: Retries, empty responses, missing tool calls
- `ERROR`: Failures, timeouts, API errors

**Example Log Entry:**
```json
{
  "level": "INFO",
  "message": "Detected struggling concepts via keyword analysis",
  "attempt": 2,
  "concepts": ["request_bms_data", "general_data_access"],
  "responseExcerpt": "I apologize, but I only have access to 4 data records..."
}
```

## Technical Details

### Type Definitions
**File:** `types.ts`

```typescript
export type ContextWindowUnit = 'hours' | 'days' | 'months' | 'years';

export interface ContextWindowConfig {
  value: number;
  unit: ContextWindowUnit;
  label: string;
}

export interface InsightsRequestConfig {
  contextWindow?: ContextWindowConfig;
  maxIterations?: number;
  isCustomQuery?: boolean;
}
```

### API Payload
**File:** `services/clientService.ts`

Enhanced `streamInsights` payload:
```typescript
{
  analysisData: AnalysisData;
  systemId?: string;
  customPrompt?: string;
  useEnhancedMode?: boolean;
  contextWindowDays?: number;  // NEW
  maxIterations?: number;       // NEW
}
```

### Backend Processing
**File:** `netlify/functions/generate-insights-with-tools.cjs`

Parameters passed through to ReAct loop:
```javascript
executeReActLoop({
  analysisData,
  systemId,
  customPrompt,
  log,
  mode: 'sync',
  contextWindowDays,  // NEW
  maxIterations       // NEW
})
```

## Testing Checklist

- [ ] Build succeeds (`npm run build`) ✅
- [ ] Context window slider renders correctly
- [ ] Slider value changes update state
- [ ] contextWindowDays parameter passed to API
- [ ] Initialization sequence triggers for systemId requests
- [ ] Gemini successfully calls request_bms_data during init
- [ ] Retry logic works when Gemini doesn't call tools
- [ ] Keyword detection identifies common issues
- [ ] Recovery guidance displays correctly
- [ ] Data catalog shows accurate date ranges
- [ ] Iteration limits adjust based on query type (10 vs 20)
- [ ] Logs capture Gemini behavior comprehensively

## Benefits

1. **Guaranteed Data Access:** Gemini can't proceed without successfully retrieving data
2. **User Control:** Context window slider gives users power over analysis depth
3. **Intelligent Recovery:** Keyword detection provides targeted help when Gemini struggles
4. **Better Debugging:** Comprehensive logging shows exactly what Gemini is doing
5. **Flexible Iteration:** More iterations for complex queries, standard for simple ones
6. **Clear Documentation:** Data catalog shows Gemini exactly what's available

## Known Limitations

1. **Initialization Budget:** Uses 50% of total time budget - may reduce time for main analysis
2. **UI Testing Needed:** Context window slider requires manual testing with actual data
3. **Keyword Accuracy:** Keyword detection may have false positives/negatives
4. **No Force Override:** Can't skip initialization even if user wants to

## Future Improvements

- [ ] Add "Skip Initialization" option for repeated queries (cache previous data retrieval)
- [ ] Persist context window preference per user
- [ ] Add progress indicator during initialization
- [ ] Track initialization success rate metrics
- [ ] Adjust iteration budgets based on historical usage patterns
- [ ] Add "learning" from past failures to improve keyword detection
