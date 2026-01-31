/**
 * Data Validation and Repair Module
 * Validates and repairs BMS records with intelligent column detection
 *
 * INCLUDES: Zero-Tolerance Timestamp Policy enforcement
 * - Extracts timestamps from filenames using TimeAuthority
 * - Sets default fullCapacity (660Ah) when missing
 */

const path = require('path');

// Import TimeAuthority for strict timestamp extraction
let TimeAuthority;
try {
  TimeAuthority = require('../src/services/TimeAuthority');
} catch (e) {
  // Fallback if TimeAuthority not available
  TimeAuthority = {
    tryExtractTimestamp: (filename) => {
      const match = filename?.match(/Screenshot_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
      if (!match) return null;
      const [, year, month, day, hour, minute, second] = match;
      return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    },
    stripTimezoneInfo: (ts) => ts?.replace(/\.\d{3}/, '').replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '')
  };
}

// Default full capacity for the battery system (660Ah)
const DEFAULT_FULL_CAPACITY = 660;

// Validation rules for BMS data
const VALIDATION_RULES = {
  // Voltage should be 40-60V for 48V system (allowing some variance)
  overallVoltage: { min: 35, max: 75, type: 'number' },

  // State of charge: 0-100%
  stateOfCharge: { min: 0, max: 100, type: 'number' },

  // Current can be negative (discharge) or positive (charge), typically -200 to +200A
  current: { min: -500, max: 500, type: 'number' },

  // Power in watts, can be negative or positive
  power: { min: -50000, max: 50000, type: 'number' },

  // Capacity in Ah
  remainingCapacity: { min: 0, max: 2000, type: 'number' },
  fullCapacity: { min: 0, max: 2000, type: 'number' },

  // Cycle count
  cycleCount: { min: 0, max: 50000, type: 'number' },

  // Cell voltages (individual cells, 3.0-3.6V typical for LiFePO4)
  highestCellVoltage: { min: 2.5, max: 4.0, type: 'number' },
  lowestCellVoltage: { min: 2.5, max: 4.0, type: 'number' },
  averageCellVoltage: { min: 2.5, max: 4.0, type: 'number' },
  cellVoltageDifference: { min: 0, max: 0.5, type: 'number' },

  // Temperatures in Celsius
  temperature_1: { min: -20, max: 80, type: 'number' },
  temperature_2: { min: -20, max: 80, type: 'number' },
  temperature_3: { min: -20, max: 80, type: 'number' },
  temperature_4: { min: -20, max: 80, type: 'number' },
  mosTemperature: { min: -20, max: 100, type: 'number' },

  // Weather data
  weather_temp: { min: -50, max: 60, type: 'number' },
  weather_clouds: { min: 0, max: 100, type: 'number' },
  weather_uvi: { min: 0, max: 15, type: 'number' },

  // Solar data (W/m²)
  solar_ghi: { min: 0, max: 1500, type: 'number' },
  solar_dni: { min: 0, max: 1500, type: 'number' },
  solar_dhi: { min: 0, max: 800, type: 'number' },
  solar_direct: { min: 0, max: 1500, type: 'number' },

  // Cost
  cost_usd: { min: 0, max: 1, type: 'number' },

  // String fields with patterns
  hardwareSystemId: { type: 'string', pattern: /^[A-Z0-9-]+$/, notPattern: /\.(png|jpg|jpeg)$/i },
  fileName: { type: 'string', pattern: /\.(png|jpg|jpeg|webp)$/i },
  model_used: { type: 'string', pattern: /^gemini-/i, notPattern: /clouds|clear|rain/i },
  weather_condition: { type: 'string', pattern: /^(Clouds|Clear|Rain|Snow|Mist|Fog|Drizzle|Thunderstorm|Haze|Smoke|Dust|Sand|Ash|Squall|Tornado)?$/i },
  status: { type: 'string', pattern: /^(Normal|Warning|Critical|Unknown)?$/i },

  // Boolean fields
  chargeMosOn: { type: 'boolean' },
  dischargeMosOn: { type: 'boolean' },
  balanceOn: { type: 'boolean' },

  // UUID/hash fields
  id: { type: 'string', pattern: /^[a-f0-9-]{36}$/ },
  contentHash: { type: 'string', pattern: /^[a-f0-9]{64}$/ },

  // Timestamp fields
  timestamp: { type: 'timestamp' },
  timestampFromFilename: { type: 'timestamp', allowNull: true },
  timestampFromImage: { type: 'string', allowNull: true }
};

/**
 * Validate a single field value
 * @param {string} fieldName - Name of the field
 * @param {any} value - Value to validate
 * @returns {object} { valid: boolean, error?: string }
 */
function validateField(fieldName, value) {
  const rule = VALIDATION_RULES[fieldName];
  if (!rule) {
    return { valid: true }; // No rule = allow anything
  }

  // Allow null/empty for optional fields
  if (value === null || value === undefined || value === '') {
    if (rule.allowNull || rule.type === 'timestamp') {
      return { valid: true };
    }
    // For numbers, null is ok (will be displayed as '-')
    if (rule.type === 'number') {
      return { valid: true };
    }
  }

  // Type validation
  if (rule.type === 'number') {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return { valid: false, error: `${fieldName} must be a number, got: ${value}` };
    }
    if (rule.min !== undefined && num < rule.min) {
      return { valid: false, error: `${fieldName} below minimum (${rule.min}): ${num}` };
    }
    if (rule.max !== undefined && num > rule.max) {
      return { valid: false, error: `${fieldName} above maximum (${rule.max}): ${num}` };
    }
  }

  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      return { valid: false, error: `${fieldName} must be boolean, got: ${value}` };
    }
  }

  if (rule.type === 'string') {
    const str = String(value || '');
    if (rule.pattern && !rule.pattern.test(str) && str !== '') {
      return { valid: false, error: `${fieldName} doesn't match pattern: ${str}` };
    }
    if (rule.notPattern && rule.notPattern.test(str)) {
      return { valid: false, error: `${fieldName} matches forbidden pattern: ${str}` };
    }
  }

  if (rule.type === 'timestamp') {
    if (value && isNaN(new Date(value).getTime())) {
      return { valid: false, error: `${fieldName} is not a valid timestamp: ${value}` };
    }
  }

  return { valid: true };
}

/**
 * Validate an entire record
 * @param {object} record - The record to validate
 * @returns {object} { valid: boolean, errors: string[], invalidFields: string[] }
 */
function validateRecord(record) {
  const errors = [];
  const invalidFields = [];

  for (const [field, value] of Object.entries(record)) {
    const result = validateField(field, value);
    if (!result.valid) {
      errors.push(result.error);
      invalidFields.push(field);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    invalidFields
  };
}

/**
 * Detect if a record has column shift corruption
 * @param {object} record - The record to check
 * @returns {object} { corrupted: boolean, pattern: string }
 */
function detectCorruption(record) {
  // Pattern 1: hardwareSystemId contains filename
  if (record.hardwareSystemId && /\.(png|jpg|jpeg)$/i.test(record.hardwareSystemId)) {
    return { corrupted: true, pattern: 'filename_in_systemid' };
  }

  // Pattern 2: model_used contains weather condition
  if (record.model_used && /^(Clouds|Clear|Rain|Snow|Fog)/i.test(record.model_used)) {
    return { corrupted: true, pattern: 'weather_in_model' };
  }

  // Pattern 3: stateOfCharge is NaN or extreme
  if (record.stateOfCharge === 'NaN' || record.stateOfCharge === NaN) {
    return { corrupted: true, pattern: 'nan_soc' };
  }

  // Pattern 4: voltage looks like a percentage (0-100 range when should be 40-60)
  const voltage = parseFloat(record.overallVoltage);
  if (!isNaN(voltage) && voltage >= 0 && voltage <= 100) {
    // Could be SOC in voltage field
    const soc = parseFloat(record.stateOfCharge);
    if (isNaN(soc) || soc < 0 || soc > 100) {
      return { corrupted: true, pattern: 'soc_voltage_swap' };
    }
  }

  return { corrupted: false, pattern: null };
}

/**
 * Attempt to repair a corrupted record
 * Handles column shift corruption where data was inserted without proper alignment
 * ALSO: Extracts timestamps from filenames and sets default fullCapacity
 * @param {object} record - The corrupted record
 * @returns {object} { repaired: boolean, record: object, changes: string[] }
 */
function repairRecord(record) {
  const changes = [];
  const repaired = { ...record };
  let needsRepair = false;

  // === TIMESTAMP FIX (Zero-Tolerance Timestamp Policy) ===
  // ALWAYS verify/extract timestamp from filename - trust the filename, not existing data
  if (repaired.fileName) {
    const extracted = TimeAuthority.tryExtractTimestamp(repaired.fileName);
    if (extracted) {
      // Strip timezone info from existing value for comparison
      const existingClean = repaired.timestampFromFilename
        ? TimeAuthority.stripTimezoneInfo(repaired.timestampFromFilename)
        : null;

      // If no existing timestamp, or it doesn't match what we extract, fix it
      if (!existingClean || existingClean !== extracted) {
        const oldValue = repaired.timestampFromFilename || 'empty';
        repaired.timestampFromFilename = extracted;
        changes.push(`timestampFromFilename: "${oldValue}" -> "${extracted}" (from filename)`);
        needsRepair = true;
      }
    }
  }
  // Handle case where we can't extract but existing has timezone info
  else if (repaired.timestampFromFilename && (repaired.timestampFromFilename.endsWith('Z') || repaired.timestampFromFilename.includes('+'))) {
    const stripped = TimeAuthority.stripTimezoneInfo(repaired.timestampFromFilename);
    if (stripped !== repaired.timestampFromFilename) {
      repaired.timestampFromFilename = stripped;
      changes.push(`timestampFromFilename: stripped timezone -> "${stripped}"`);
      needsRepair = true;
    }
  }

  // === FULL CAPACITY FIX ===
  // If fullCapacity is 0, null, or missing, set to default (660Ah)
  const fullCap = parseFloat(repaired.fullCapacity);
  if (isNaN(fullCap) || fullCap === 0 || fullCap === null) {
    repaired.fullCapacity = DEFAULT_FULL_CAPACITY;
    changes.push(`fullCapacity: ${record.fullCapacity || 'null'} -> ${DEFAULT_FULL_CAPACITY}Ah (default)`);
    needsRepair = true;
  }

  // === CORRUPTION DETECTION ===
  const corruption = detectCorruption(record);
  if (!corruption.corrupted && !needsRepair) {
    return { repaired: false, record, changes: [] };
  }

  // Detect column shift pattern:
  // When timestampFromFilename exists, but hardwareSystemId is null/empty,
  // and voltage looks like SOC (0-100 range instead of 40-70 range),
  // then data is shifted by one position
  const voltage = parseFloat(record.overallVoltage);
  const soc = parseFloat(record.stateOfCharge);
  const current = parseFloat(record.current);
  const power = parseFloat(record.power);

  // Pattern: SOC is empty/null, voltage is in 0-100 range (actually SOC), current is in 40-70 range (actually voltage)
  const hasShiftedColumns = (
    (soc === null || isNaN(soc) || soc === 0) &&
    voltage >= 0 && voltage <= 100 &&
    current >= 30 && current <= 80
  );

  if (hasShiftedColumns) {
    // Data is shifted - the columns are offset by one position
    // overallVoltage contains SOC
    // current contains voltage
    // power contains current
    // remainingCapacity contains power

    changes.push(`Column shift detected - realigning data`);

    // Shift values back to correct positions
    repaired.stateOfCharge = voltage;  // voltage field has SOC
    repaired.overallVoltage = current;  // current field has voltage
    repaired.current = power;           // power field has current
    repaired.power = parseFloat(record.remainingCapacity); // remainingCapacity has power
    repaired.remainingCapacity = parseFloat(record.fullCapacity); // fullCapacity has remainingCapacity

    changes.push(`stateOfCharge: null -> ${repaired.stateOfCharge}`);
    changes.push(`overallVoltage: ${voltage} -> ${repaired.overallVoltage}`);
    changes.push(`current: ${current} -> ${repaired.current}`);
    changes.push(`power: ${power} -> ${repaired.power}`);
  }

  switch (corruption.pattern) {
    case 'filename_in_systemid':
      // The filename ended up in hardwareSystemId
      changes.push(`hardwareSystemId: "${record.hardwareSystemId}" -> null (was filename)`);
      repaired.hardwareSystemId = null;
      break;

    case 'weather_in_model':
      // Weather condition ended up in model_used
      changes.push(`model_used: "${record.model_used}" -> null (was weather)`);
      if (!repaired.weather_condition) {
        repaired.weather_condition = record.model_used;
        changes.push(`weather_condition: set to "${record.model_used}"`);
      }
      repaired.model_used = null;
      break;

    case 'nan_soc':
      // SOC is NaN - might be part of column shift, already handled above
      if (!hasShiftedColumns) {
        changes.push(`stateOfCharge: NaN -> null`);
        repaired.stateOfCharge = null;
      }
      break;
  }

  // Additional cleanup: fix any NaN values
  for (const [key, value] of Object.entries(repaired)) {
    if (value === 'NaN' || (typeof value === 'number' && isNaN(value))) {
      repaired[key] = null;
      changes.push(`${key}: NaN -> null`);
      needsRepair = true;
    }
  }

  return { repaired: needsRepair || changes.length > 0, record: repaired, changes };
}

/**
 * Validate and repair all records
 * @param {Array} records - Array of records to process
 * @param {function} onProgress - Progress callback (current, total, message)
 * @returns {object} { records: Array, stats: object }
 */
function validateAndRepairAll(records, onProgress = null) {
  const stats = {
    total: records.length,
    valid: 0,
    repaired: 0,
    invalid: 0,
    changes: []
  };

  const processed = [];

  for (let i = 0; i < records.length; i++) {
    let record = records[i];

    // First try to repair if corrupted
    const repairResult = repairRecord(record);
    if (repairResult.repaired) {
      record = repairResult.record;
      stats.repaired++;
      stats.changes.push({ id: record.id, changes: repairResult.changes });
    }

    // Then validate
    const validation = validateRecord(record);
    if (validation.valid) {
      stats.valid++;
    } else {
      stats.invalid++;
    }

    processed.push(record);

    if (onProgress && i % 50 === 0) {
      onProgress(i + 1, records.length, `Validating record ${i + 1}/${records.length}`);
    }
  }

  return { records: processed, stats };
}

module.exports = {
  VALIDATION_RULES,
  validateField,
  validateRecord,
  detectCorruption,
  repairRecord,
  validateAndRepairAll
};
