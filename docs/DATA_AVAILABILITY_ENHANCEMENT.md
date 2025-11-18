# Data Availability Enhancement for Insights Guru

## Overview
This document describes the enhancement made to ensure Gemini (the Insights Guru) has full awareness of and access to ALL available historical BMS data, not just recent snapshots.

## Problem
Previously, the Insights Guru would report limited data availability when responding to queries like "analyze the past 14 days" - even when more historical data existed in the database. This was because the data availability check only looked at:
- Recent snapshots (limited to 24 records)
- Daily rollup (hardcoded to 90 days)

## Solution
We now query the database directly to find the actual min/max timestamps of all available data for a system, and communicate this comprehensively to Gemini.

## Implementation Details

### New Function: `getActualDataRange()`
Location: `netlify/functions/utils/insights-guru.cjs`

```javascript
async function getActualDataRange(systemId, log) {
  // Queries MongoDB for:
  // 1. Earliest timestamp (oldest record)
  // 2. Latest timestamp (newest record)
  // 3. Total record count
  
  // Returns: { minDate, maxDate, totalRecords } or null
}
```

### Updated Function: `buildDataAvailabilitySummary()`
Now includes:
- **Actual database query** for full date range
- **Fallback logic** to context data if query fails
- **Emphatic messaging** about full data access
- **Explicit warnings** against claiming data unavailable

## Key Prompt Enhancements

### 1. Opening Statement
```
🔑 CRITICAL: You have FULL ACCESS to ALL historical data for this system.
DO NOT limit yourself or claim 'data unavailable' - if it's within the 
queryable range, USE THE TOOLS to retrieve it!
```

### 2. Data Range Display
```
📅 FULL DATA RANGE AVAILABLE: 2025-05-01 to 2025-11-17 (200 days)
   ✅ Total Records: 543 BMS snapshots queryable
   ✅ ALL historical data accessible via request_bms_data tool
   ✅ Weather data available for entire range via getWeatherData tool
   ✅ You have COMPLETE access to all 200 days of data - use it!
```

### 3. Custom Query Mode Instructions
For queries involving historical data:
```
🎯 CUSTOM QUERY MODE - FULL DATA ACCESS ENABLED:
You are answering a specific user question with COMPLETE access to all 
historical data.

MANDATORY TOOL USAGE for questions involving:
   • ANY date comparisons (yesterday vs today, last week vs this week, etc.)
   • ANY time period analysis ('past 14 days', 'last month', etc.)
   • ANY historical trends or patterns over time
   
⚠️ CRITICAL INSTRUCTIONS:
   1. The systemId is in the DATA AVAILABILITY section - use it EXACTLY
   2. Check the full queryable date range - you have access to ALL of it
   3. ALWAYS call request_bms_data for any historical data requests
   4. NEVER claim 'data not available' without trying the tool first
   5. You have ALL the tools needed - use them confidently!
```

### 4. Explicit Warnings
```
⛔ NEVER RESPOND WITH 'DATA UNAVAILABLE' OR 'LIMITED TO X DAYS' IF:
   • The requested date is within your queryable range shown above
   • You haven't tried calling request_bms_data yet
   • You're being asked to compare dates or time periods
   • User asks about 'past 14 days', 'last week', 'last month', etc.

✅ YOU HAVE FULL ACCESS TO ALL HISTORICAL DATA - ALWAYS CALL THE TOOLS!
✅ The data exists and is queryable - use request_bms_data to retrieve it!
✅ Don't make assumptions about data availability - query and verify!
```

## Testing
Comprehensive test suite created: `tests/insights-data-availability.test.js`

Tests verify:
- ✅ Actual database date range querying
- ✅ Handling of systems with no data
- ✅ Correct day span calculations
- ✅ Full data access messaging in prompts
- ✅ Explicit warnings present
- ✅ SystemId and date range clarity

All tests passing (7/7).

## Impact

### Before
```
"Data Range Limitation: The request for correlating cloud data and current 
for the 'past 14 days' could only be partially addressed due to the available 
BMS data range of 2025-11-13 to 2025-11-17 (4 days)."
```

### After
```
Gemini receives accurate information:
- Full queryable range: 2025-05-01 to 2025-11-17 (200 days)
- Total records: 543 BMS snapshots
- Explicit instruction to use request_bms_data for historical queries
- Clear warnings not to claim data unavailable without trying
```

## Benefits

1. **Accurate Analysis**: Gemini can now analyze the full historical range
2. **Better Insights**: Comprehensive trend analysis over months, not just days
3. **Confident Queries**: Gemini knows exactly what data exists and how to access it
4. **No False Limitations**: Eliminates incorrect "data unavailable" responses
5. **User Trust**: Users get the deep analysis they expect from ALL their data

## Related Files
- `netlify/functions/utils/insights-guru.cjs` - Core implementation
- `netlify/functions/utils/gemini-tools.cjs` - Tool definitions (request_bms_data)
- `tests/insights-data-availability.test.js` - Test suite
- `netlify/functions/utils/react-loop.cjs` - ReAct loop for tool calling

## Future Enhancements
- Consider caching the date range for performance
- Add metrics on how often full range is used vs recent data
- Monitor token usage to ensure prompts remain within limits
