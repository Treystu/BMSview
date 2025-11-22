# Autonomous Self-Correction & Quality-Based Deduplication

## Overview

BMSview now features autonomous self-correction capabilities that enable the system to detect and fix OCR/extraction errors without human intervention. When the AI makes mistakes extracting BMS data, the system automatically catches them, explains the error to the AI, and retries the extraction with targeted feedback.

## Key Features

### 1. Validation-Driven Retry Loop

The analysis pipeline now includes a retry loop (up to 3 attempts) that validates extracted data and provides feedback for improvement:

```javascript
// Pseudo-code flow
let attempts = 0;
let bestQuality = 0;

while (attempts < 3) {
  // Extract data from image (with feedback from previous attempt if any)
  const data = await extractBmsData(image, previousFeedback);
  
  // Validate physics and data integrity
  const validation = validateAnalysisData(data);
  const quality = calculateQualityScore(validation); // 0-100
  
  // Success conditions
  if (validation.isValid && quality === 100) break; // Perfect!
  if (quality >= 60) break; // Good enough
  
  // Track best attempt
  if (quality > bestQuality) {
    bestQuality = quality;
    bestAttempt = data;
  }
  
  // Generate feedback for next attempt
  previousFeedback = generateValidationFeedback(validation, attempts + 1);
  attempts++;
}

// Use best attempt if all retries failed
return bestAttempt;
```

### 2. Physics-Based Validation

The system validates extracted data against physical laws and logical consistency:

**Physics Checks:**
- Overall voltage = sum of cell voltages (±0.5V tolerance)
- Power = Current × Voltage (±10% tolerance)
- Remaining capacity ≤ Full capacity

**Range Checks:**
- State of Charge: 0-100%
- Cell voltages: 2.0-4.5V
- Battery temperature: 0-100°C

**Logic Checks:**
- If discharging (current < 0), power should be negative
- If current flowing, corresponding MOS should be ON
- SOC should match capacity ratio: (Remaining / Full) × 100

### 3. Actionable AI Feedback

When validation fails, the system generates specific, actionable feedback that explains the error in terms the AI can understand:

**Example feedback for voltage mismatch:**
```
RETRY ATTEMPT 2: The previous extraction failed validation with 1 critical error(s).

CRITICAL ERRORS TO FIX:
1. Voltage mismatch: Overall 60.0V vs sum of cells 52.28V (diff: 7.72V) - 
   PHYSICS ERROR: The sum of individual cell voltages (52.28V) should equal 
   the overall voltage. You reported 60.0V overall. Re-examine BOTH the 
   overall voltage field AND the individual cell voltages. One or more of 
   these values is incorrect.

INSTRUCTIONS FOR THIS RETRY:
- Re-examine the image carefully, focusing on the fields mentioned above
- Verify unit conversions (mV to V, kW to W)
- Double-check sign preservation (negative for discharge)
- Ensure calculations match the physics (voltage sum, power = current × voltage)
```

### 4. Quality Scoring System

Each extraction attempt receives a quality score (0-100):

- **100 points**: Perfect validation (no errors or warnings)
- **-20 points**: Per critical error (physics violations, invalid ranges)
- **-5 points**: Per warning (minor inconsistencies)
- **Minimum floor**: 0 points

**Thresholds:**
- **≥80**: High quality - can be reused for duplicates
- **≥60**: Acceptable quality - record saved without review flag
- **<60**: Low quality - record flagged for review, but best attempt used

### 5. Smart Duplicate Handling

When a duplicate image is uploaded, the system checks the quality of the existing record:

```javascript
// Check existing record quality
if (existingRecord.validationScore < 80 || existingRecord.needsReview) {
  // Low quality - re-analyze to upgrade
  const improvedRecord = await reAnalyzeWithRetry(image);
  
  // Update existing record with better data
  await updateRecord(existingRecord.id, improvedRecord);
  
  return {
    ...improvedRecord,
    wasUpgraded: true,
    previousQuality: existingRecord.validationScore,
    newQuality: improvedRecord.validationScore
  };
}

// High quality - return as-is
return existingRecord;
```

## Real-World Examples

### Example 1: OCR Misreads Voltage Digit

**Attempt 1 (Failed):**
```json
{
  "overallVoltage": 13.4,  // WRONG - misread 18.4 as 13.4
  "cellVoltages": [3.25, 3.27, 3.26, 3.28, 3.24, 3.29]  // Sum = 19.59V
}
```
**Validation Error:** "Voltage mismatch: Overall 13.4V vs sum of cells 19.59V (diff: 6.19V)"

**Feedback Generated:**
"PHYSICS ERROR: The sum of individual cell voltages (19.59V) should equal the overall voltage. You reported 13.4V overall. Re-examine BOTH the overall voltage field AND the individual cell voltages."

**Attempt 2 (Success):**
```json
{
  "overallVoltage": 19.6,  // FIXED
  "cellVoltages": [3.25, 3.27, 3.26, 3.28, 3.24, 3.29]
}
```
**Result:** Quality improved from 20 → 100 points

### Example 2: Power Sign Error

**Attempt 1 (Failed):**
```json
{
  "current": -10.5,  // Discharging
  "power": 548.65    // WRONG - should be negative
}
```
**Validation Error:** "Power inconsistency: Reported 548.65W vs calculated -548.65W"

**Feedback Generated:**
"PHYSICS ERROR: Power should equal Current × Voltage. You reported 548.65W but calculation gives -548.65W. Verify the current sign (negative if discharging)."

**Attempt 2 (Success):**
```json
{
  "current": -10.5,
  "power": -548.65  // FIXED
}
```

### Example 3: Unit Conversion Error

**Attempt 1 (Failed):**
```json
{
  "cellVoltageDifference": 45  // WRONG - in mV, should be 0.045V
}
```
**Validation Error:** "Cell voltage difference seems incorrect"

**Feedback Generated:**
"Extract 'voltage difference'. If the unit is 'mV', divide by 1000 to convert to 'V'. The schema requires Volts."

**Attempt 2 (Success):**
```json
{
  "cellVoltageDifference": 0.045  // FIXED - converted to V
}
```

## Configuration

Environment variables (optional):
```bash
# Retry behavior (defaults shown)
MAX_EXTRACTION_ATTEMPTS=3        # Max retries with feedback
MIN_ACCEPTABLE_QUALITY=60        # Threshold to save without review
MIN_QUALITY_FOR_REUSE=80         # Threshold to reuse duplicates
```

## Database Schema Updates

New fields added to `analysis-results` collection:

```javascript
{
  // ... existing fields ...
  
  // Validation metadata
  needsReview: boolean,          // True if validation failed
  validationWarnings: string[],  // List of validation warnings
  validationScore: number,       // Quality score 0-100
  extractionAttempts: number,    // Number of attempts needed
  
  // Upgrade tracking
  _wasUpgraded: boolean,         // True if upgraded from low-quality
  _previousQuality: number,      // Quality before upgrade
  _newQuality: number           // Quality after upgrade
}
```

## Monitoring & Observability

**Log Events to Watch:**

1. **Self-Healing Success:**
```json
{
  "level": "info",
  "message": "Extraction succeeded with acceptable quality",
  "qualityScore": 85,
  "finalAttemptNumber": 2,
  "improvement": true
}
```

2. **Duplicate Upgrade:**
```json
{
  "level": "warn",
  "message": "Existing record has quality issues. Will re-analyze to improve.",
  "previousQuality": 45,
  "reason": "voltage_mismatch"
}
```

3. **Best Attempt Fallback:**
```json
{
  "level": "warn",
  "message": "All 3 extraction attempts completed. Using best attempt.",
  "bestAttemptNumber": 2,
  "bestQualityScore": 65
}
```

## Testing

Run the comprehensive test suite:

```bash
# All validation-related tests
npm test -- tests/data-validation.test.js
npm test -- tests/validation-feedback.test.js
npm test -- tests/autonomous-self-correction.test.js

# Summary:
# - 21 tests for data validation rules
# - 20 tests for feedback generation
# - 15 tests for integration scenarios
# Total: 56 tests, all passing
```

## Performance Impact

- **Typical case (1 attempt):** No overhead - validation already existed
- **Retry case (2-3 attempts):** +10-30s per retry (Gemini API call time)
- **Duplicate upgrade:** Same as retry (only when quality < 80)

**Optimization:**
- Retries are rare (~5-10% of cases based on existing validation stats)
- Duplicate checks remain fast (hash lookup)
- Quality scoring is negligible (<1ms)

## Future Enhancements

Potential improvements for future iterations:

1. **Consensus Mode** (mentioned in original spec but not implemented)
   - Run 3 parallel extractions
   - Use majority vote for conflicting values
   - Useful for extremely noisy/damaged screenshots

2. **Learning from Patterns**
   - Track common errors by BMS model
   - Adjust prompts based on historical failures
   - Pre-emptive warnings for known problematic fields

3. **Confidence Scores**
   - AI provides confidence level per field
   - Lower confidence triggers automatic retry
   - UI shows confidence indicators

4. **User Feedback Loop**
   - Manual corrections feed back to system
   - Improve feedback templates over time
   - Build error pattern database

## Related Files

**Core Implementation:**
- `netlify/functions/utils/validation-feedback.cjs` - Feedback generator
- `netlify/functions/utils/analysis-pipeline.cjs` - Retry loop
- `netlify/functions/utils/data-validation.cjs` - Physics validation
- `netlify/functions/analyze.cjs` - Duplicate upgrade logic

**Tests:**
- `tests/validation-feedback.test.js` - Feedback generator tests
- `tests/autonomous-self-correction.test.js` - Integration tests
- `tests/data-validation.test.js` - Validation rules tests

**Documentation:**
- `CODEBASE_PATTERNS_AND_BEST_PRACTICES.md` - Updated with anti-patterns
- This file - Feature documentation
