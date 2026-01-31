/**
 * TimeAuthority - The Strict Timestamp Enforcer
 *
 * ZERO-TOLERANCE TIMESTAMP POLICY:
 * - We NEVER guess the time
 * - We NEVER use file metadata (often just unzip time)
 * - We NEVER let AI hallucinate the time
 * - We ONLY trust timestamps embedded in filenames
 *
 * The "Filename or Bust" Protocol:
 * 1. Regex Match: Strictly match Screenshot_YYYYMMDD-HHMMSS.png
 * 2. Success: Extract and return ISO-like string (no Z, no timezone)
 * 3. Failure: Throw error - do not process the file
 *
 * Local Time Sovereignty:
 * - Treat extracted time as "Wall Clock Time" (Local)
 * - Do NOT convert to UTC
 * - Do NOT add a 'Z' suffix
 * - If filename says 13:00:00, database and UI show 13:00:00
 */

// The ONE TRUE PATTERN - no exceptions, no fallbacks
const STRICT_FILENAME_PATTERN = /Screenshot_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/;

/**
 * Extract timestamp from filename using strict regex
 * @param {string} filename - The filename to parse (e.g., "Screenshot_20260126-130950.png")
 * @returns {string} ISO-like timestamp string WITHOUT timezone (e.g., "2026-01-26T13:09:50")
 * @throws {Error} If filename doesn't match the strict pattern
 */
function extractStrictTimestamp(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid Filename Format: Filename is empty or not a string');
  }

  const match = filename.match(STRICT_FILENAME_PATTERN);

  if (!match) {
    throw new Error(`Invalid Filename Format: Timestamp missing. Expected pattern: Screenshot_YYYYMMDD-HHMMSS.png, got: "${filename}"`);
  }

  const [, year, month, day, hour, minute, second] = match;

  // Basic validation of extracted values
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const h = parseInt(hour, 10);
  const min = parseInt(minute, 10);
  const s = parseInt(second, 10);

  // Sanity checks
  if (y < 2000 || y > 2100) {
    throw new Error(`Invalid Filename Format: Year out of range (${year})`);
  }
  if (m < 1 || m > 12) {
    throw new Error(`Invalid Filename Format: Month out of range (${month})`);
  }
  if (d < 1 || d > 31) {
    throw new Error(`Invalid Filename Format: Day out of range (${day})`);
  }
  if (h < 0 || h > 23) {
    throw new Error(`Invalid Filename Format: Hour out of range (${hour})`);
  }
  if (min < 0 || min > 59) {
    throw new Error(`Invalid Filename Format: Minute out of range (${minute})`);
  }
  if (s < 0 || s > 59) {
    throw new Error(`Invalid Filename Format: Second out of range (${second})`);
  }

  // Return clean ISO-like string WITHOUT 'Z' suffix (Local Time Sovereignty)
  // Format: YYYY-MM-DDTHH:MM:SS
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Check if a filename matches the strict pattern (without throwing)
 * @param {string} filename - The filename to check
 * @returns {boolean} True if filename matches the strict pattern
 */
function isValidFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return false;
  }
  return STRICT_FILENAME_PATTERN.test(filename);
}

/**
 * Validate an existing timestamp string format
 * Ensures it follows our Local Time format (no Z suffix)
 * @param {string} timestamp - Timestamp string to validate
 * @returns {boolean} True if format is correct
 */
function isValidTimestampFormat(timestamp) {
  if (!timestamp || typeof timestamp !== 'string') {
    return false;
  }

  // Must match YYYY-MM-DDTHH:MM:SS (no Z, no timezone offset)
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  return pattern.test(timestamp);
}

/**
 * Attempt to re-extract timestamp from filename for existing records
 * Used during data validation to silently fix missing timestamps
 * @param {string} filename - The filename to parse
 * @returns {string|null} Timestamp string or null if extraction fails
 */
function tryExtractTimestamp(filename) {
  try {
    return extractStrictTimestamp(filename);
  } catch (e) {
    return null;
  }
}

/**
 * Strip timezone suffix from existing timestamp if present
 * Converts "2026-01-26T13:09:50.000Z" to "2026-01-26T13:09:50"
 * @param {string} timestamp - Timestamp that may have timezone info
 * @returns {string} Clean local timestamp
 */
function stripTimezoneInfo(timestamp) {
  if (!timestamp || typeof timestamp !== 'string') {
    return timestamp;
  }

  // Remove milliseconds and Z suffix
  // "2026-01-26T13:09:50.000Z" -> "2026-01-26T13:09:50"
  // "2026-01-26T13:09:50Z" -> "2026-01-26T13:09:50"
  // "2026-01-26T13:09:50+00:00" -> "2026-01-26T13:09:50"
  return timestamp
    .replace(/\.\d{3}/, '')  // Remove milliseconds
    .replace(/Z$/, '')        // Remove Z suffix
    .replace(/[+-]\d{2}:\d{2}$/, ''); // Remove timezone offset
}

module.exports = {
  extractStrictTimestamp,
  isValidFilename,
  isValidTimestampFormat,
  tryExtractTimestamp,
  stripTimezoneInfo,
  STRICT_FILENAME_PATTERN
};
