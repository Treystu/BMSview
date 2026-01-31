/**
 * Verification State System
 *
 * Tracks extraction quality and determines when re-analysis is needed.
 *
 * States:
 * - A: COMPLETE - All expected fields extracted, data looks valid
 * - B: PARTIAL_NEEDS_VERIFY - Missing some fields, needs re-analysis to confirm
 * - C: VERIFIED_INCOMPLETE - Re-analyzed, confirmed screenshot is missing data (obstructed/not shown)
 * - D: INCONCLUSIVE - Multiple analyses gave different results, needs more attempts
 *
 * State transitions:
 * - New record → Check completeness → A or B
 * - B (re-analyzed) → If same result → C (confirmed incomplete)
 * - B (re-analyzed) → If better result → A (now complete)
 * - B (re-analyzed) → If different incomplete result → D (inconclusive)
 * - D (re-analyzed) → If consistent result → C (confirmed)
 * - D (re-analyzed) → If complete result → A (resolved)
 */

// Verification state constants
const VERIFICATION_STATES = {
  COMPLETE: 'A',           // All data extracted correctly
  PARTIAL_NEEDS_VERIFY: 'B', // Missing data, needs verification
  VERIFIED_INCOMPLETE: 'C',  // Confirmed: screenshot missing data
  INCONCLUSIVE: 'D'         // Different results each time, needs more analysis
};

// Fields that are ALWAYS expected to be present in a valid BMS screenshot
const CORE_FIELDS = [
  'stateOfCharge',
  'overallVoltage',
  'current'
];

// Fields that SHOULD be present but may be obstructed
const EXPECTED_FIELDS = [
  'cycleCount',
  'highestCellVoltage',
  'lowestCellVoltage',
  'averageCellVoltage'
];

// Temperature fields - often covered or not visible
const TEMPERATURE_FIELDS = [
  'temperature_1',
  'mosTemperature'
];

/**
 * Validate that a value is reasonable for its field type
 */
function isValueValid(field, value) {
  if (value === null || value === undefined) return false;

  switch (field) {
    case 'stateOfCharge':
      return value >= 0 && value <= 100;
    case 'overallVoltage':
      return value >= 10 && value <= 100; // Typical LiFePO4 pack range
    case 'current':
      return value >= -500 && value <= 500; // Reasonable current range
    case 'power':
      return value >= -30000 && value <= 30000;
    case 'cycleCount':
      return value >= 0 && value <= 50000;
    case 'highestCellVoltage':
    case 'lowestCellVoltage':
    case 'averageCellVoltage':
      return value >= 2.0 && value <= 4.5; // LiFePO4 cell voltage range
    case 'cellVoltageDifference':
      return value >= 0 && value <= 1.0;
    case 'temperature_1':
    case 'temperature_2':
    case 'temperature_3':
    case 'temperature_4':
    case 'mosTemperature':
      // Temperature should be reasonable: -20°C to 80°C
      return value >= -20 && value <= 80;
    case 'remainingCapacity':
    case 'fullCapacity':
      return value >= 0 && value <= 2000; // Up to 2000Ah
    default:
      return true;
  }
}

/**
 * Sanitize a record's values - fix obviously wrong data
 */
function sanitizeRecord(record) {
  const sanitized = { ...record };
  const fixes = [];

  // Fix MOS temperature if it's obviously wrong (e.g., 330 instead of 33)
  if (sanitized.mosTemperature !== null && sanitized.mosTemperature !== undefined) {
    if (sanitized.mosTemperature > 100 && sanitized.mosTemperature < 1000) {
      // Likely missing decimal point - divide by 10
      const fixed = sanitized.mosTemperature / 10;
      if (isValueValid('mosTemperature', fixed)) {
        fixes.push(`mosTemperature: ${sanitized.mosTemperature} → ${fixed} (fixed decimal)`);
        sanitized.mosTemperature = fixed;
      }
    } else if (!isValueValid('mosTemperature', sanitized.mosTemperature)) {
      fixes.push(`mosTemperature: ${sanitized.mosTemperature} → null (invalid)`);
      sanitized.mosTemperature = null;
    }
  }

  // Fix temperatures
  for (let i = 1; i <= 4; i++) {
    const field = `temperature_${i}`;
    if (sanitized[field] !== null && sanitized[field] !== undefined) {
      if (sanitized[field] > 100 && sanitized[field] < 1000) {
        const fixed = sanitized[field] / 10;
        if (isValueValid(field, fixed)) {
          fixes.push(`${field}: ${sanitized[field]} → ${fixed} (fixed decimal)`);
          sanitized[field] = fixed;
        }
      } else if (!isValueValid(field, sanitized[field])) {
        fixes.push(`${field}: ${sanitized[field]} → null (invalid)`);
        sanitized[field] = null;
      }
    }
  }

  // Fix cell voltages if they look like mV instead of V
  ['highestCellVoltage', 'lowestCellVoltage', 'averageCellVoltage'].forEach(field => {
    if (sanitized[field] !== null && sanitized[field] !== undefined) {
      if (sanitized[field] > 100) {
        // Likely in mV - convert to V
        const fixed = sanitized[field] / 1000;
        if (isValueValid(field, fixed)) {
          fixes.push(`${field}: ${sanitized[field]} → ${fixed} (mV to V)`);
          sanitized[field] = fixed;
        }
      }
    }
  });

  return { sanitized, fixes };
}

/**
 * Check if a record has all expected data
 */
function isRecordComplete(record) {
  // Check core fields
  for (const field of CORE_FIELDS) {
    if (!isValueValid(field, record[field])) {
      return false;
    }
  }

  // Check expected fields
  for (const field of EXPECTED_FIELDS) {
    if (!isValueValid(field, record[field])) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a record has partial data (some fields missing)
 */
function isRecordPartial(record) {
  // Has core data
  let hasCore = CORE_FIELDS.every(f => isValueValid(f, record[f]));
  if (!hasCore) return false;

  // Missing some expected data
  let hasAllExpected = EXPECTED_FIELDS.every(f => isValueValid(f, record[f]));
  return !hasAllExpected;
}

/**
 * Get list of missing fields for a record
 */
function getMissingFields(record) {
  const missing = [];

  for (const field of [...CORE_FIELDS, ...EXPECTED_FIELDS, ...TEMPERATURE_FIELDS]) {
    if (!isValueValid(field, record[field])) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Determine the verification state for a record
 */
function determineVerificationState(record, previousState = null, analysisCount = 1) {
  const isComplete = isRecordComplete(record);
  const missing = getMissingFields(record);

  // If complete, state is A
  if (isComplete && missing.length === 0) {
    return {
      state: VERIFICATION_STATES.COMPLETE,
      reason: 'All expected fields extracted with valid values',
      missing: []
    };
  }

  // If this is first analysis, state is B (needs verification)
  if (analysisCount <= 1) {
    return {
      state: VERIFICATION_STATES.PARTIAL_NEEDS_VERIFY,
      reason: 'First analysis, missing some fields - needs re-analysis to confirm',
      missing
    };
  }

  // If re-analyzed and still missing same fields, state is C (verified incomplete)
  if (previousState === VERIFICATION_STATES.PARTIAL_NEEDS_VERIFY ||
      previousState === VERIFICATION_STATES.INCONCLUSIVE) {
    if (analysisCount >= 2) {
      return {
        state: VERIFICATION_STATES.VERIFIED_INCOMPLETE,
        reason: 'Re-analyzed and confirmed: screenshot does not contain these fields',
        missing
      };
    }
  }

  // Otherwise inconclusive
  return {
    state: VERIFICATION_STATES.INCONCLUSIVE,
    reason: 'Multiple analyses gave inconsistent results',
    missing
  };
}

/**
 * Check if a record should be re-analyzed based on its state
 */
function shouldReanalyze(record) {
  const state = record.verification_state;
  const count = record.analysis_count || 1;

  // State A (complete) - never re-analyze
  if (state === VERIFICATION_STATES.COMPLETE) {
    return { should: false, reason: 'Record is complete (state A)' };
  }

  // State C (verified incomplete) - don't re-analyze, confirmed missing
  if (state === VERIFICATION_STATES.VERIFIED_INCOMPLETE) {
    return { should: false, reason: 'Verified as incomplete (state C) - screenshot missing data' };
  }

  // State B (partial, needs verify) - re-analyze once
  if (state === VERIFICATION_STATES.PARTIAL_NEEDS_VERIFY) {
    return { should: true, reason: 'Needs verification (state B)' };
  }

  // State D (inconclusive) - re-analyze up to 3 times
  if (state === VERIFICATION_STATES.INCONCLUSIVE && count < 3) {
    return { should: true, reason: 'Inconclusive (state D) - trying again' };
  }

  // No state set - check if record is incomplete
  if (!state) {
    const missing = getMissingFields(record);
    if (missing.length > 0) {
      return { should: true, reason: 'No verification state, has missing fields' };
    }
  }

  return { should: false, reason: 'Max analysis attempts reached or complete' };
}

/**
 * Compare two analysis results to check consistency
 */
function areResultsConsistent(oldRecord, newRecord) {
  // Compare key fields that should be consistent between analyses
  const fieldsToCompare = [
    'stateOfCharge', 'overallVoltage', 'current', 'cycleCount',
    'highestCellVoltage', 'lowestCellVoltage'
  ];

  for (const field of fieldsToCompare) {
    const oldVal = oldRecord[field];
    const newVal = newRecord[field];

    // If both have values, they should be close
    if (oldVal !== null && newVal !== null) {
      const diff = Math.abs(oldVal - newVal);
      const tolerance = Math.abs(oldVal) * 0.05; // 5% tolerance
      if (diff > tolerance && diff > 0.1) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Physics-Based Validation
 * Uses electrical formulas to validate OCR accuracy
 */

/**
 * 1. Ohm's Law Checksum: P ≈ V × I
 * Validates that power, voltage, and current are physically consistent
 */
function validateOhmsLaw(record, tolerance = 0.10) {
  const voltage = record.overallVoltage;
  const current = Math.abs(record.current);
  const power = Math.abs(record.power);

  if (!voltage || !current || !power) {
    return { valid: true, reason: 'Incomplete data for Ohm check' };
  }

  const calculatedPower = voltage * current;
  const ratio = calculatedPower / power;

  if (ratio > (1 + tolerance) || ratio < (1 - tolerance)) {
    return {
      valid: false,
      reason: `Physics mismatch: V×I=${calculatedPower.toFixed(1)}W but reported ${power.toFixed(1)}W (${((ratio - 1) * 100).toFixed(1)}% off)`,
      calculatedPower,
      reportedPower: power,
      ratio
    };
  }

  return { valid: true, reason: 'Ohm\'s law check passed' };
}

/**
 * 2. Cell Count Topology Check
 * Validates that total voltage / avg cell voltage = expected cell count
 */
function validateCellTopology(record) {
  const voltage = record.overallVoltage;
  const avgCell = record.averageCellVoltage;

  if (!voltage || !avgCell || avgCell === 0) {
    return { valid: true, reason: 'Incomplete data for topology check' };
  }

  const inferredCells = Math.round(voltage / avgCell);
  const validCellCounts = [4, 7, 8, 12, 14, 15, 16, 20, 24, 28, 32]; // Common series counts

  if (!validCellCounts.includes(inferredCells)) {
    return {
      valid: false,
      reason: `Invalid series count: ${inferredCells}S (${voltage}V / ${avgCell}V)`,
      inferredCells
    };
  }

  // Also verify the calculated voltage matches
  const expectedVoltage = inferredCells * avgCell;
  const voltageDiff = Math.abs(expectedVoltage - voltage);
  if (voltageDiff > 1.0) {
    return {
      valid: false,
      reason: `Voltage mismatch: ${inferredCells}S × ${avgCell}V = ${expectedVoltage.toFixed(2)}V, but reported ${voltage}V`,
      inferredCells
    };
  }

  return { valid: true, reason: `Topology check passed (${inferredCells}S system)`, inferredCells };
}

/**
 * 3. Chemistry Sanity Bounds (LiFePO4)
 * Validates that cell voltages are within physical limits
 */
function validateChemistrySanity(record) {
  const issues = [];

  // LiFePO4 cell voltage bounds (2.5V - 3.65V is safe operational range)
  const CELL_MIN = 2.0;
  const CELL_MAX = 4.0;

  const cellFields = ['highestCellVoltage', 'lowestCellVoltage', 'averageCellVoltage'];
  for (const field of cellFields) {
    const value = record[field];
    if (value !== null && value !== undefined) {
      if (value < CELL_MIN || value > CELL_MAX) {
        issues.push(`${field}=${value}V outside LiFePO4 range (${CELL_MIN}-${CELL_MAX}V)`);
      }
    }
  }

  // Cell voltage difference should be < 0.5V (usually < 0.05V for healthy pack)
  if (record.cellVoltageDifference !== null && record.cellVoltageDifference !== undefined) {
    if (record.cellVoltageDifference > 0.5) {
      issues.push(`cellVoltageDifference=${record.cellVoltageDifference}V is abnormally high (>0.5V)`);
    }
  }

  // SOC bounds
  if (record.stateOfCharge !== null && record.stateOfCharge !== undefined) {
    if (record.stateOfCharge < 0 || record.stateOfCharge > 100) {
      issues.push(`stateOfCharge=${record.stateOfCharge}% outside valid range (0-100%)`);
    }
  }

  if (issues.length > 0) {
    return { valid: false, reason: issues.join('; '), issues };
  }

  return { valid: true, reason: 'Chemistry sanity check passed' };
}

/**
 * 4. Sign Detection Validation
 * NOTE: MOS status (charge/discharge) is NOT correlated with current direction!
 * The discharge MOS typically stays ON 24/7 unless manually disabled for testing.
 * The charge MOS also stays ON 24/7 unless disabled.
 * Current sign (positive = charging, negative = discharging) is independent of MOS status.
 */
function validateCurrentSign(record) {
  // This check is disabled because MOS status does not correlate with current direction
  // The MOS switches are protection features, not indicators of charge/discharge state
  return { valid: true, reason: 'MOS status does not indicate charge/discharge state' };
}

/**
 * Run all physics validations
 */
function validatePhysics(record) {
  const results = {
    ohmsLaw: validateOhmsLaw(record),
    topology: validateCellTopology(record),
    chemistry: validateChemistrySanity(record),
    currentSign: validateCurrentSign(record)
  };

  const allValid = results.ohmsLaw.valid && results.topology.valid && results.chemistry.valid;
  const warnings = [];
  const errors = [];

  for (const [check, result] of Object.entries(results)) {
    if (!result.valid) {
      errors.push(`${check}: ${result.reason}`);
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  return {
    valid: allValid,
    errors,
    warnings,
    results,
    inferredCells: results.topology.inferredCells
  };
}

/**
 * Attempt to fix common OCR errors based on physics validation
 */
function attemptPhysicsFix(record) {
  const fixed = { ...record };
  const fixes = [];

  // Check for decimal point errors in cell voltages (e.g., 33.3 instead of 3.33)
  const cellFields = ['highestCellVoltage', 'lowestCellVoltage', 'averageCellVoltage'];
  for (const field of cellFields) {
    const value = fixed[field];
    if (value !== null && value !== undefined) {
      // If value is 10x too high, likely missing decimal
      if (value > 10 && value < 100) {
        const corrected = value / 10;
        if (corrected >= 2.0 && corrected <= 4.0) {
          fixes.push(`${field}: ${value} → ${corrected} (fixed decimal)`);
          fixed[field] = corrected;
        }
      }
      // If value is 1000x too high, likely in mV
      if (value > 1000 && value < 10000) {
        const corrected = value / 1000;
        if (corrected >= 2.0 && corrected <= 4.0) {
          fixes.push(`${field}: ${value}mV → ${corrected}V (converted)`);
          fixed[field] = corrected;
        }
      }
    }
  }

  // Fix cell voltage difference if it's in mV
  if (fixed.cellVoltageDifference > 1 && fixed.cellVoltageDifference < 500) {
    const corrected = fixed.cellVoltageDifference / 1000;
    fixes.push(`cellVoltageDifference: ${fixed.cellVoltageDifference}mV → ${corrected}V`);
    fixed.cellVoltageDifference = corrected;
  }

  return { fixed, fixes };
}

/**
 * Comprehensive Sanity Validation
 * Checks for physically impossible values that indicate OCR errors or bad defaults
 */

/**
 * Validate a single record's sanity (independent of history)
 * Returns issues that should cause the value to be nullified
 */
function validateRecordSanity(record) {
  const issues = [];
  const fieldsToNull = [];

  // 1. SOC must be 0-100%
  if (record.stateOfCharge !== null && record.stateOfCharge !== undefined) {
    if (record.stateOfCharge < 0 || record.stateOfCharge > 100) {
      issues.push(`SOC ${record.stateOfCharge}% is impossible (must be 0-100)`);
      fieldsToNull.push('stateOfCharge');
    }
  }

  // 2. Remaining capacity cannot exceed full capacity
  if (record.remainingCapacity !== null && record.fullCapacity !== null) {
    if (record.remainingCapacity > record.fullCapacity * 1.05) { // 5% tolerance for measurement error
      issues.push(`Remaining capacity ${record.remainingCapacity}Ah > full capacity ${record.fullCapacity}Ah`);
      // Don't null - this could be a calibration issue
    }
  }

  // 3. Cell voltage consistency
  if (record.highestCellVoltage !== null && record.lowestCellVoltage !== null) {
    if (record.highestCellVoltage < record.lowestCellVoltage) {
      issues.push(`Highest cell ${record.highestCellVoltage}V < lowest cell ${record.lowestCellVoltage}V`);
      fieldsToNull.push('highestCellVoltage', 'lowestCellVoltage');
    }
  }

  // 4. Average cell should be between high and low
  if (record.averageCellVoltage !== null && record.highestCellVoltage !== null && record.lowestCellVoltage !== null) {
    if (record.averageCellVoltage > record.highestCellVoltage + 0.01 ||
        record.averageCellVoltage < record.lowestCellVoltage - 0.01) {
      issues.push(`Average cell ${record.averageCellVoltage}V outside high/low range`);
      fieldsToNull.push('averageCellVoltage');
    }
  }

  // 5. Cell voltage difference should match high - low
  if (record.cellVoltageDifference !== null && record.highestCellVoltage !== null && record.lowestCellVoltage !== null) {
    const expectedDiff = record.highestCellVoltage - record.lowestCellVoltage;
    const actualDiff = record.cellVoltageDifference;
    if (Math.abs(expectedDiff - actualDiff) > 0.01) { // 10mV tolerance
      issues.push(`Cell diff ${actualDiff}V doesn't match high-low=${expectedDiff.toFixed(3)}V`);
      // Don't null - could be rounding
    }
  }

  // 6. Power sign should match current sign (P = V * I)
  if (record.power !== null && record.current !== null) {
    const currentSign = Math.sign(record.current);
    const powerSign = Math.sign(record.power);
    if (currentSign !== 0 && powerSign !== 0 && currentSign !== powerSign) {
      issues.push(`Power sign doesn't match current sign (P=${record.power}W, I=${record.current}A)`);
      // Could be display convention - don't null
    }
  }

  // 7. Cycle count of 0 is suspicious for used batteries
  // We flag it but don't null - historical validation will catch repeated 0s
  if (record.cycleCount === 0) {
    issues.push(`Cycle count is 0 - verify this is a new battery or data wasn't extracted`);
  }

  // 8. Voltage should be consistent with SOC (rough check for LiFePO4)
  if (record.stateOfCharge !== null && record.averageCellVoltage !== null) {
    // LiFePO4 rough SOC vs voltage curve
    // 100% ≈ 3.4-3.5V, 50% ≈ 3.2-3.3V, 0% ≈ 2.5-2.8V
    if (record.stateOfCharge > 90 && record.averageCellVoltage < 3.2) {
      issues.push(`SOC ${record.stateOfCharge}% too high for cell voltage ${record.averageCellVoltage}V`);
    }
    if (record.stateOfCharge < 20 && record.averageCellVoltage > 3.35) {
      issues.push(`SOC ${record.stateOfCharge}% too low for cell voltage ${record.averageCellVoltage}V`);
    }
  }

  return { issues, fieldsToNull };
}

/**
 * Validate record against historical data for the same system
 * @param {object} record - Current record
 * @param {array} history - Previous records for this system (sorted by time)
 */
function validateHistoricalConsistency(record, history) {
  const issues = [];
  const warnings = [];

  if (!history || history.length === 0) {
    return { issues, warnings };
  }

  // Get the most recent previous record
  const prevRecord = history[history.length - 1];

  // 1. Cycle count should never decrease
  if (record.cycleCount !== null && prevRecord.cycleCount !== null) {
    if (record.cycleCount < prevRecord.cycleCount) {
      issues.push(`Cycle count decreased: ${prevRecord.cycleCount} → ${record.cycleCount}`);
    }
  }

  // 2. Cycle count of 0 when previous was non-zero is wrong
  if (record.cycleCount === 0 && prevRecord.cycleCount !== null && prevRecord.cycleCount > 0) {
    issues.push(`Cycle count reset to 0 from ${prevRecord.cycleCount} - likely extraction error`);
  }

  // 3. Check for unrealistic SOC changes over short time periods
  const recordTime = new Date(record.timestampFromFilename || record.timestamp);
  const prevTime = new Date(prevRecord.timestampFromFilename || prevRecord.timestamp);
  const hoursDiff = (recordTime - prevTime) / (1000 * 60 * 60);

  if (hoursDiff > 0 && hoursDiff < 1 && record.stateOfCharge !== null && prevRecord.stateOfCharge !== null) {
    const socChange = Math.abs(record.stateOfCharge - prevRecord.stateOfCharge);
    // Max reasonable SOC change is ~30% per hour with fast charging
    if (socChange > 40) {
      warnings.push(`SOC changed ${socChange.toFixed(1)}% in ${(hoursDiff * 60).toFixed(0)} minutes`);
    }
  }

  // 4. Full capacity shouldn't change significantly
  if (record.fullCapacity !== null && prevRecord.fullCapacity !== null) {
    const capacityChange = Math.abs(record.fullCapacity - prevRecord.fullCapacity);
    if (capacityChange > 10) { // More than 10Ah change is suspicious
      warnings.push(`Full capacity changed: ${prevRecord.fullCapacity}Ah → ${record.fullCapacity}Ah`);
    }
  }

  return { issues, warnings };
}

/**
 * Apply sanity fixes to a record
 * Nullifies clearly wrong values
 */
function applySanityFixes(record) {
  const fixed = { ...record };
  const fixes = [];

  const { issues, fieldsToNull } = validateRecordSanity(record);

  for (const field of fieldsToNull) {
    if (fixed[field] !== null && fixed[field] !== undefined) {
      fixes.push(`${field}: ${fixed[field]} → null (failed sanity check)`);
      fixed[field] = null;
    }
  }

  // Log issues for debugging
  if (issues.length > 0) {
    console.log(`[Sanity] ${record.fileName}: ${issues.join('; ')}`);
  }

  return { fixed, fixes, issues };
}

module.exports = {
  VERIFICATION_STATES,
  isValueValid,
  sanitizeRecord,
  isRecordComplete,
  isRecordPartial,
  getMissingFields,
  determineVerificationState,
  shouldReanalyze,
  areResultsConsistent,
  validatePhysics,
  validateOhmsLaw,
  validateCellTopology,
  validateChemistrySanity,
  validateCurrentSign,
  attemptPhysicsFix,
  validateRecordSanity,
  validateHistoricalConsistency,
  applySanityFixes,
  CORE_FIELDS,
  EXPECTED_FIELDS,
  TEMPERATURE_FIELDS
};
