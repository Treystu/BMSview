/**
 * Shared constants for duplicate detection logic
 * Ensures consistency between analyze.cjs and check-duplicates-batch.cjs
 */

/**
 * Confidence score threshold for triggering re-analysis
 * Records with validationScore < this threshold will be flagged for upgrade
 * Records with validationScore >= this threshold are considered acceptable quality
 *
 * COST OPTIMIZATION: Lowered from 80% to 60% to reduce unnecessary re-analysis.
 * Most BMS screenshots with core data (SOC, voltage, current) should NOT be re-analyzed
 * just because they're missing optional fields like cycleCount or MOS status.
 *
 * A 60% threshold catches truly failed extractions (garbage data, wrong image type)
 * while avoiding wasteful retries on acceptable extractions.
 */
const DUPLICATE_UPGRADE_THRESHOLD = 60;

/**
 * Minimum quality improvement to consider a retry worthwhile
 * If quality improvement is less than this value (0.01%), the record is considered
 * to have no improvement and won't be retried again
 */
const MIN_QUALITY_IMPROVEMENT = 0.01;

/**
 * Critical fields that must be present for a BMS analysis to be considered complete
 * If any of these fields are missing or null, the record will be flagged for upgrade
 *
 * IMPORTANT: Keep this list minimal to avoid unnecessary re-analysis!
 * Only include fields that should ALWAYS be visible on any BMS screenshot.
 * Optional fields (cycleCount, power, MOS status, cell details) are NOT critical
 * because many BMS devices don't display them or they're on different screens.
 *
 * Previous list of 14 fields was causing 90%+ of records to be re-analyzed,
 * wasting API costs on data that simply isn't in the screenshot.
 */
const CRITICAL_FIELDS = [
  'stateOfCharge',    // Almost always visible on any BMS display
  'overallVoltage',   // Almost always visible on any BMS display
  'current'           // Almost always visible (or at least charging state)
  // NOTE: dlNumber, cell voltages, MOS status, cycleCount, power are OPTIONAL
  // They may not be visible in the screenshot and shouldn't trigger re-analysis
];

module.exports = {
  DUPLICATE_UPGRADE_THRESHOLD,
  MIN_QUALITY_IMPROVEMENT,
  CRITICAL_FIELDS
};
