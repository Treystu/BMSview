/**
 * Data Validation and Repair Module
 * Extended to include silent timestamp auto-fix using TimeAuthority
 */

const baseValidator = require('../../lib/data-validator');
const { tryExtractTimestamp, stripTimezoneInfo, isValidTimestampFormat } = require('./TimeAuthority');

/**
 * Attempt to fix timestamp for a record
 * This is called silently during validation - no errors thrown
 * @param {object} record - The record to fix
 * @returns {object} { fixed: boolean, record: object, change?: string }
 */
function fixTimestamp(record) {
  // If timestampFromFilename is already valid, nothing to do
  if (record.timestampFromFilename && isValidTimestampFormat(record.timestampFromFilename)) {
    return { fixed: false, record };
  }

  // If timestampFromFilename exists but has timezone info, strip it
  if (record.timestampFromFilename) {
    const stripped = stripTimezoneInfo(record.timestampFromFilename);
    if (stripped !== record.timestampFromFilename && isValidTimestampFormat(stripped)) {
      return {
        fixed: true,
        record: { ...record, timestampFromFilename: stripped },
        change: `timestampFromFilename: stripped timezone -> "${stripped}"`
      };
    }
  }

  // If timestampFromFilename is missing but we have a valid fileName, try to extract
  if ((!record.timestampFromFilename || record.timestampFromFilename === '') && record.fileName) {
    const extracted = tryExtractTimestamp(record.fileName);
    if (extracted) {
      return {
        fixed: true,
        record: { ...record, timestampFromFilename: extracted },
        change: `timestampFromFilename: extracted from filename -> "${extracted}"`
      };
    }
  }

  return { fixed: false, record };
}

/**
 * Check if a record needs re-analysis (missing core BMS data)
 * @param {object} record - The record to check
 * @returns {boolean} True if record needs re-analysis
 */
function needsReanalysis(record) {
  // Core fields that should always be present after successful Gemini extraction
  const coreFields = ['stateOfCharge', 'overallVoltage', 'current'];

  for (const field of coreFields) {
    const value = record[field];
    // If null, undefined, or 0 for all three - likely failed extraction
    if (value === null || value === undefined) {
      return true;
    }
  }

  // If all three core fields are 0, that's suspicious
  if (record.stateOfCharge === 0 && record.overallVoltage === 0 && record.current === 0) {
    return true;
  }

  return false;
}

/**
 * Extended validation that includes timestamp auto-fix
 * @param {Array} records - Array of records to process
 * @param {function} onProgress - Progress callback
 * @returns {object} { records: Array, stats: object }
 */
function validateAndRepairAllWithTimestamps(records, onProgress = null) {
  // First run the base validation
  const baseResult = baseValidator.validateAndRepairAll(records, onProgress);

  // Then apply timestamp fixes
  const processedRecords = [];
  let timestampFixes = 0;
  let needsReanalysisCount = 0;
  const timestampChanges = [];

  for (let i = 0; i < baseResult.records.length; i++) {
    let record = baseResult.records[i];

    // Try to fix timestamp
    const timestampResult = fixTimestamp(record);
    if (timestampResult.fixed) {
      record = timestampResult.record;
      timestampFixes++;
      timestampChanges.push({
        id: record.id,
        change: timestampResult.change
      });
    }

    // Check if needs re-analysis
    if (needsReanalysis(record)) {
      record._needsReanalysis = true;
      needsReanalysisCount++;
    }

    processedRecords.push(record);

    if (onProgress && i % 100 === 0) {
      onProgress('timestamp-fix', i, records.length, `Fixing timestamps ${i}/${records.length}`);
    }
  }

  return {
    records: processedRecords,
    stats: {
      ...baseResult.stats,
      timestampFixes,
      needsReanalysis: needsReanalysisCount,
      timestampChanges
    }
  };
}

// Re-export base validator functions plus our extensions
module.exports = {
  ...baseValidator,
  fixTimestamp,
  needsReanalysis,
  validateAndRepairAllWithTimestamps
};
