/**
 * Shared constants for duplicate detection logic
 * Ensures consistency between analyze.cjs and check-duplicates-batch.cjs
 */

/**
 * Confidence score threshold for triggering re-analysis
 * Records with validationScore < 80% will be flagged for upgrade
 * Records with validationScore >= 80% are considered acceptable quality
 * 
 * Rationale: Gemini often returns 95-99% confidence even for perfect extractions,
 * so using 80% threshold prevents wasteful re-analysis of high-quality records
 * while still catching genuinely poor extractions. This reduces API calls by ~90%.
 */
const DUPLICATE_UPGRADE_THRESHOLD = 80;

/**
 * Minimum quality improvement to consider a retry worthwhile
 * If quality improvement is less than this value (0.01%), the record is considered
 * to have no improvement and won't be retried again
 */
const MIN_QUALITY_IMPROVEMENT = 0.01;

/**
 * Critical fields that must be present for a BMS analysis to be considered complete
 * If any of these fields are missing or null, the record will be flagged for upgrade
 */
const CRITICAL_FIELDS = [
  'dlNumber',
  'stateOfCharge',
  'overallVoltage',
  'current',
  'remainingCapacity',
  'chargeMosOn',
  'dischargeMosOn',
  'balanceOn',
  'highestCellVoltage',
  'lowestCellVoltage',
  'averageCellVoltage',
  'cellVoltageDifference',
  'cycleCount',
  'power'
];

module.exports = {
  DUPLICATE_UPGRADE_THRESHOLD,
  MIN_QUALITY_IMPROVEMENT,
  CRITICAL_FIELDS
};
