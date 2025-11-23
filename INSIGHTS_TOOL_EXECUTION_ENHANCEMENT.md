# Generate Insights Enhancement - Tool Execution & Format Validation

## Problem Statement

The AI Battery Guru (Gemini-powered insights generation) had two critical issues:

1. **Recommending instead of executing tools**: Gemini would tell users to "use the calculate_energy_budget tool with scenario='worst_case'" instead of actually calling the tool and presenting results. This is problematic because **users have no access to these tools** - only Gemini can execute them through the ReAct loop.

2. **Format errors breaking the UI**: When users requested specific formats (CSV, JSON, tables), Gemini sometimes returned malformed responses that would break the display, requiring manual retry.

## Solution Overview

### 1. Enhanced Tool Execution Directives

Modified `netlify/functions/utils/insights-guru.cjs` to add multiple layers of explicit instructions that prevent Gemini from recommending tool usage:

#### Changes Made:

**Top-level absolute rule** (lines 240-244):
```javascript
prompt += "⚠️ ABSOLUTE RULE: You are the ONLY entity with access to the analysis tools. END USERS CANNOT execute tools like calculate_energy_budget, predict_battery_trends, etc.\n";
prompt += "When analysis requires tool data, you MUST CALL THE TOOL YOURSELF and present the results. NEVER tell users to 'use the X tool' or 'run Y calculation' - they literally cannot do this.\n";
```

**Custom mission approach** (lines 451-453):
```javascript
approach += `3. ⚠️ CRITICAL: NEVER recommend users run tools - they cannot access them. YOU must execute all tools.\n`;
```

**Data gathering instructions** (lines 293-299):
```javascript
prompt += "DATA GATHERING INSTRUCTIONS:\n";
prompt += "⚠️ YOU ARE THE ONLY ONE WHO CAN USE TOOLS - users cannot execute calculate_energy_budget, predict_battery_trends, etc.\n";
prompt += "If your analysis requires tool data (energy budgets, predictions, patterns), you MUST:\n";
prompt += "   1. CALL the tool immediately using function calling\n";
prompt += "   2. Wait for the result\n";
prompt += "   3. PRESENT the findings in your response\n";
prompt += "NEVER say 'use the X tool' or 'run Y with parameters' - users literally cannot do this. YOU must execute all tools.\n";
```

**Actionability requirements** (lines 318-320):
```javascript
prompt += "• ACTIONABILITY: Each recommendation must be a PHYSICAL ACTION users can take (add capacity, reduce load, check connections, run generator).\n";
prompt += "  ⚠️ NEVER recommend tool usage (e.g., 'use calculate_energy_budget tool') - users cannot execute tools, only YOU can. If analysis needs tool data, CALL IT NOW.\n";
```

**Default mission enhancement** (line 433):
```javascript
7. **Execute Analysis Tools**: If analysis requires energy budgets, predictions, or pattern analysis, CALL the appropriate tools NOW and present results.
```

**Recommendation format clarification** (line 432):
```javascript
* ⚠️ ACTIONABLE BY USERS - physical actions (add capacity, reduce load, check connections) NOT tool executions
* NEVER recommend 'use tool X' or 'run calculation Y' - users cannot execute tools, only YOU can
```

### 2. Automatic Format Validation & Correction

Created new module `netlify/functions/utils/response-validator.cjs` with comprehensive format validation:

#### Features:

**Format Detection**:
- Automatically detects CSV, JSON, Table, or Markdown requests from user prompts
- Uses regex patterns to identify format keywords

**Validators**:
- **CSV**: Checks for header row, consistent column counts (allows ±1 tolerance for quoted commas)
- **Markdown Table**: Validates pipe structure, separator rows, column alignment
- **JSON**: Parses to ensure valid JSON syntax, supports code blocks
- **Markdown**: Lenient check for headers, bullets, bold text, and structure

**Auto-Correction Prompts**:
- Builds detailed correction prompts with format examples
- Includes the malformed response snippet for context
- Provides specific requirements for each format type
- Example correction prompt structure:
  ```
  Your previous response had a formatting issue...
  **FORMAT ERROR:** [specific error]
  **YOUR PREVIOUS RESPONSE:** [snippet]
  **REQUIRED FORMAT:** [detailed specs with examples]
  **INSTRUCTIONS:** Rewrite using EXACT format specified
  ```

**Integration with ReAct Loop** (`netlify/functions/utils/react-loop.cjs`):
- After receiving final answer, validates format against user's request
- If invalid and turns remain, automatically adds correction request to conversation
- Continues ReAct loop to get properly formatted response
- Falls back to displaying malformed response if no retries left (better than nothing)
- All transitions logged for debugging

#### Code Example:

```javascript
// Validate response format
const validation = validateResponseFormat(finalAnswer, customPrompt || '');

if (!validation.valid && turnCount < MAX_TURNS - 1) {
    // Auto-retry with correction
    const correctionPrompt = buildCorrectionPrompt(
        finalAnswer, 
        validation.error, 
        validation.formatType,
        customPrompt || ''
    );
    
    conversationHistory.push({
        role: 'user',
        parts: [{ text: correctionPrompt }]
    });
    
    finalAnswer = null; // Continue loop
    continue;
}
```

### 3. Enhanced Format Instructions in Prompts

Updated `insights-guru.cjs` to include explicit format requirements:

**CSV Format** (lines 268-273):
```javascript
prompt += "• CSV REQUESTS: If user asks for CSV, use proper CSV format:\n";
prompt += "  - First line MUST be header row with column names\n";
prompt += "  - Subsequent lines are data rows\n";
prompt += "  - Use commas to separate values\n";
prompt += "  - Quote values containing commas or newlines\n";
prompt += "  - Example: 'Date,SOC,Voltage\\n2025-11-23,85.2,52.4\\n2025-11-22,82.1,52.2'\n";
```

**Table Format** (lines 274-279):
```javascript
prompt += "• TABLE REQUESTS: If user asks for a table, use markdown table format:\n";
prompt += "  - Header row with column names\n";
prompt += "  - Separator row with dashes (---)\n";
prompt += "  - Data rows aligned with pipes\n";
prompt += "  - Example: '| Date | SOC | Voltage |\\n|------|-----|---------|\\n| 2025-11-23 | 85.2% | 52.4V |'\n";
```

**JSON Format** (line 280):
```javascript
prompt += "• JSON REQUESTS: If user asks for JSON, provide valid JSON enclosed in ```json code blocks\n";
```

**Custom Mission Detection** (buildCustomMission function):
- Detects CSV/Table/JSON requests using regex patterns
- Adds format-specific instructions to mission statement
- Includes test requirements: "Test the format: Can it be copy-pasted into Excel/spreadsheet software?"

## Testing

Created comprehensive test suite in `tests/response-validator.test.js`:

- 20 test cases covering all format validators
- CSV validation tests (valid, inconsistent columns, no data)
- Markdown table tests (valid, missing separator, mismatched columns)
- JSON tests (valid with/without code blocks, invalid syntax)
- Markdown tests (headers, bullets, empty responses)
- Correction prompt builder tests
- Format detection tests

**Test Results**: All 20 tests passing ✓

## Impact

### Before:
```
User: "Analyze my energy budget"
Gemini: "Implementation: Use the calculate_energy_budget tool with 
scenario='worst_case' and scenario='average' for a timeframe='30d', 
including weather data."
User: 😕 "How do I do that?"
```

```
User: "Give me CSV of SOC data"
Gemini: [Returns malformed CSV]
UI: ❌ ERROR - Cannot display results
User: 😤 [Has to retry manually]
```

### After:
```
User: "Analyze my energy budget"
Gemini: [Automatically calls calculate_energy_budget]
Gemini: "## Energy Budget Analysis

**Current Scenario:** Daily generation 8.2kWh, consumption 9.1kWh
**Deficit:** 900Wh/day (effective deficit after ±10% tolerance)
**Generator Recommendation:** Run at 60A for 29 minutes per day

**Worst Case Scenario:** 
- Minimum solar: 5.1kWh/day
- Maximum consumption: 11.3kWh/day
- Required backup: 6.2kWh/day"
User: ✅ [Gets actionable results immediately]
```

```
User: "Give me CSV of SOC data"
Gemini: [Returns malformed CSV]
[Auto-validation detects error]
[Auto-correction request sent]
Gemini: [Returns properly formatted CSV]
UI: ✅ Displays perfect CSV
User: 😊 [Never sees the error]
```

## Files Modified

1. `netlify/functions/utils/insights-guru.cjs` - Enhanced prompts with tool execution directives
2. `netlify/functions/utils/react-loop.cjs` - Integrated format validation and auto-retry
3. `netlify/functions/utils/response-validator.cjs` - **NEW** - Format validation module
4. `tests/response-validator.test.js` - **NEW** - Comprehensive test suite

## Configuration

No configuration changes required. The system automatically:
- Detects when tools should be called based on analysis needs
- Detects requested formats from user prompts
- Validates and corrects format issues
- Falls back gracefully if correction fails

## Deployment

✅ Build passes: `npm run build` successful
✅ Tests pass: All 20 validation tests passing
✅ No breaking changes to existing functionality
✅ Backward compatible with all existing endpoints

## Future Enhancements

Potential improvements for future iterations:

1. **Streaming format validation**: Validate chunks as they arrive
2. **Format preference memory**: Remember user's preferred formats
3. **More format types**: Support for Excel, Parquet, etc.
4. **Advanced CSV**: Handle quoted newlines, escape sequences
5. **Tool execution metrics**: Track which tools are most used
6. **User feedback loop**: Learn from format correction frequency

## Monitoring

Key metrics to watch post-deployment:

1. **Tool call frequency**: Should increase (Gemini calling tools vs recommending them)
2. **Format correction rate**: How often auto-correction triggers
3. **User retry rate**: Should decrease (fewer manual retries needed)
4. **Error rates**: Should decrease (malformed responses caught and fixed)
5. **Average turns per conversation**: May increase slightly due to format retries

## Documentation Updates

Users should be informed:
- Battery Guru now automatically performs all calculations
- No manual tool execution required
- Multiple format types supported (CSV, JSON, Tables, Markdown)
- Format errors automatically corrected
- Seamless experience with no manual intervention needed

---

**Implementation Date**: 2025-11-23
**Author**: GitHub Copilot
**Reviewer**: [Pending]
**Status**: ✅ Ready for Review
