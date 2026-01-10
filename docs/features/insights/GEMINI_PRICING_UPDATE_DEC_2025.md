# Gemini Model Pricing Update - December 2025

## Summary
This update ensures BMSview uses accurate, official pricing for all Gemini model families (3.x, 2.x, 1.x) with context-aware pricing tiers, as specified in the official Google Gemini API documentation.

## What Changed

### 1. Pricing Corrections
- **Gemini 2.5 Flash**: Corrected from $0.075/$0.30 to **$0.10/$0.40** per million tokens (input/output)
- All pricing now matches official Google documentation as of December 2025

### 2. New Models Added

#### Gemini 3.0 Family
- **gemini-3-pro-preview**: $2.00/$12.00 (≤200K), $4.00/$18.00 (>200K)

#### Gemini 2.5 Family
- **gemini-2.5-pro**: $1.25/$10.00 (≤200K), $2.50/$15.00 (>200K)
- **gemini-2.5-flash**: $0.10/$0.40 (corrected)

#### Gemini 2.0 Family
- **gemini-2.0-pro**: $0.50/$5.00 (≤200K), $1.00/$7.50 (>200K)
- **gemini-2.0-flash**: $0.10/$0.40
- **gemini-2.0-flash-exp**: $0.10/$0.40
- **gemini-2.0-flash-thinking-exp-1219**: $0.10/$0.40

#### Gemini 1.5 Family (with context tiers)
- **gemini-1.5-pro**: $1.25/$5.00 (≤128K), $2.50/$10.00 (>128K)
- **gemini-1.5-flash**: $0.075/$0.30 (≤128K), $0.15/$0.60 (>128K)
- **gemini-1.5-flash-8b**: $0.0375/$0.15 (≤128K), $0.075/$0.30 (>128K)

### 3. Context-Aware Pricing
The system now supports automatic pricing tier selection based on context window size:
- **Gemini 1.5 models**: Standard rate ≤128K tokens, higher rate >128K
- **Gemini 2.x/3.x models**: Standard rate ≤200K tokens, higher rate >200K

### 4. UI Improvements
- Model selector expanded to include all new models
- Direct link to official Google pricing documentation
- Updated cost estimates reflect corrected pricing

## Implementation Details

### Backend Changes
**File**: `netlify/functions/utils/metrics-collector.cjs`

```javascript
// Enhanced getModelPricing() function
function getModelPricing(model, contextTokens = 0) {
  // Returns appropriate pricing tier based on context size
  // Includes: inputTokens, outputTokens, isLongContext, contextThreshold
}

// Enhanced calculateGeminiCost() function
function calculateGeminiCost(model, inputTokens, outputTokens, contextTokens) {
  // Now accepts contextTokens parameter for accurate cost calculation
}
```

### Frontend Changes
**Files**: 
- `components/AnalysisResult.tsx` - Expanded model selector
- `components/CostEstimateBadge.tsx` - Updated default pricing

### Test Coverage
**File**: `tests/metrics-collector.test.js`
- Added tests for Gemini 3.0 Pro Preview
- Added tests for Gemini 2.0 Pro
- Added tests for context-aware pricing across all model families
- Updated existing tests for corrected 2.5 Flash pricing
- All 27 pricing tests passing ✅

## API Reference

### getModelPricing(model, contextTokens)
Returns pricing information for a specific model.

**Parameters:**
- `model` (string): Model name (e.g., 'gemini-2.5-flash')
- `contextTokens` (number, optional): Context size in tokens for tier selection

**Returns:**
```javascript
{
  inputTokens: number,      // Cost per token (input)
  outputTokens: number,     // Cost per token (output)
  description: string,      // Model description
  contextThreshold: number, // Threshold for long-context pricing (if applicable)
  isLongContext: boolean    // Whether long-context pricing was applied
}
```

### calculateGeminiCost(model, inputTokens, outputTokens, contextTokens)
Calculates total cost for a Gemini API operation.

**Parameters:**
- `model` (string): Model name
- `inputTokens` (number): Number of input tokens
- `outputTokens` (number): Number of output tokens
- `contextTokens` (number, optional): Total context size for tier selection

**Returns:** Cost in USD (number)

## Model Selection Guide

### For Image Analysis (BMS Screenshots)
- **Recommended**: `gemini-2.5-flash` - Fast, accurate, cost-effective ($0.10/$0.40)
- **Alternative**: `gemini-1.5-flash` - Slightly cheaper for small contexts ($0.075/$0.30)

### For AI Insights Generation
- **Standard queries**: `gemini-2.5-flash` - Fast, reliable
- **Complex queries**: `gemini-2.5-pro` - Better reasoning ($1.25/$10.00)
- **Advanced reasoning**: `gemini-3-pro-preview` - Most capable ($2.00/$12.00)

### For Long-Context Analysis (>128K tokens)
- **Budget**: `gemini-1.5-flash` - $0.15/$0.60 (>128K)
- **Balanced**: `gemini-1.5-pro` - $2.50/$10.00 (>128K)
- **Advanced**: `gemini-2.5-pro` - $2.50/$15.00 (>200K)

## Cost Examples

### Image Analysis (1 BMS screenshot)
- **Input**: ~2,260 tokens (image + prompt)
- **Output**: ~500 tokens
- **Cost with 2.5 Flash**: ~$0.0004 (0.04 cents)

### AI Insights (30-day context)
- **Input**: ~75,000 tokens (data + prompts)
- **Output**: ~2,000 tokens
- **Cost with 2.5 Flash**: ~$0.0083 (0.83 cents)
- **Cost with 2.5 Pro**: ~$0.1138 (11.38 cents)

### AI Insights (90-day context, >200K tokens)
- **Input**: ~220,000 tokens (long context pricing)
- **Output**: ~3,000 tokens
- **Cost with 2.5 Pro**: ~$0.595 (59.5 cents) - long context rate

## Official Pricing Source
All pricing data is sourced from:
**https://ai.google.dev/gemini-api/docs/pricing**

Last verified: December 2025

## Migration Notes

### Breaking Changes
None. The system maintains backward compatibility with existing function signatures.

### Deprecated
None. All previously supported models remain available.

### Recommendations
1. Review any hardcoded pricing assumptions in custom code
2. Consider using `gemini-2.5-flash` as default for most operations
3. Enable context-aware pricing by passing `contextTokens` parameter where applicable

## Future Enhancements

### Planned
- [ ] Dynamic pricing refresh from Google API
- [ ] Cost prediction UI for complex queries
- [ ] Per-user cost tracking and budget alerts
- [ ] Model recommendation engine based on query complexity

### Under Consideration
- [ ] Automatic model fallback on rate limits
- [ ] Cost optimization suggestions
- [ ] Historical cost trending visualization

## Testing

### Run Pricing Tests
```bash
npm test -- tests/metrics-collector.test.js
```

### Verify Build
```bash
npm run build
```

### Manual Verification
1. Start dev server: `netlify dev`
2. Navigate to insights section
3. Select different models from dropdown
4. Verify pricing link opens Google documentation

## Support

### Questions or Issues
- Check official Google docs: https://ai.google.dev/gemini-api/docs/pricing
- Review code comments in `netlify/functions/utils/metrics-collector.cjs`
- Run tests to verify pricing accuracy

### Pricing Discrepancies
If you notice pricing discrepancies:
1. Verify against official Google documentation
2. Check model name matches exactly (including version suffixes)
3. Confirm context size is calculated correctly
4. Review test suite for expected values

---

**Last Updated**: December 2025
**Verified Against**: Google Gemini API Pricing (https://ai.google.dev/gemini-api/docs/pricing)
**Status**: ✅ Production Ready
