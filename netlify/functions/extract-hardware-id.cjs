/**
 * extract-hardware-id.cjs
 *
 * Extracts the Hardware System ID (formerly known as DL Number) from a string of text.
 * The Hardware ID is a critical identifier linking the BMS data to a specific physical system.
 *
 * Expected Formats:
 * - "DL-XXXXXXXX"
 * - "DL Number XXXXXXXX"
 * - "D/L XXXXXXXX"
 * - Variations of the above.
 */

// Constants for Hardware ID validation
const MIN_ID_DIGITS = 6;
const MAX_ID_DIGITS = 14;

// Pattern for the ID part itself (alphanumeric, widely permissive initially to capture various formats)
const digitPattern = "[A-Z0-9\\-]+";

// Regexes to locate the ID labeled as "DL", "Driver License", etc.
const hardwareIdRegexes = [
    // Standard DL-prefixed variants
    // Matches "DL", "DL No", "DL Number", "DL#" followed by ID
    new RegExp(`\\bDL(?:[\\s:.-]+(?:No\\.?|Number)|[#\\s:-])+[\\s:-]*([A-Z]{0,4}${digitPattern})`, 'gi'),
    new RegExp(`\\bD\\/L\\b[\\s:-]*([A-Z]{0,4}${digitPattern})`, 'gi'),
    new RegExp(`\\bdrivers?\\s+licen[cs]e\\b[\\s:-]*([A-Z]{0,4}${digitPattern})`, 'gi'),
    // "System ID" explicit label
    new RegExp(`\\bSystem\\s*ID\\b[\\s:-]*([A-Z0-9\\-]+)`, 'gi'),
    // "ID" label if followed clearly by a pattern (use caution with this one in future)
    // Short code format (e.g. AB-123456)
    new RegExp(`\\b[A-Z]{2,3}-(${digitPattern})\\b`, 'gi')
];

/**
 * Normalizes a raw Hardware System ID string.
 * Removes spaces, special chars, and uppercases.
 * @param {string} raw - The raw extracted string.
 * @returns {string|null} - Normalized ID or null if invalid.
 */
function normalizeHardwareId(raw) {
    if (!raw) return null;
    // Strip everything non-alphanumeric (allowing hyphens) to be safe and consistent.
    // We only remove characters that are definitely not part of an ID.
    const normalized = raw.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase();

    // Remove leading/trailing hyphens
    const clean = normalized.replace(/^-+|-+$/g, '');

    if (clean.length < MIN_ID_DIGITS || clean.length > MAX_ID_DIGITS) {
        return null;
    }
    return clean;
}

/**
 * Extracts possible Hardware System IDs from a text block.
 * @param {string} text - The text to search.
 * @param {console | { info: (msg: string) => void, debug?: (msg: string) => void } | ((msg: string) => void)} [log] - Logger object or function.
 * @returns {string[]} - Array of unique, normalized IDs found.
 */
function extractHardwareSystemId(text, log = console.log) {
    if (!text) return [];

    const candidates = new Set();
    // Default logger wrapper if a full logger object is passed
    /** @param {string} msg */
    const logInfo = (msg) => (typeof log === 'function' ? log(msg) : (log.info ? log.info(msg) : console.log(msg)));
    /** @param {string} msg */
    const logDebug = (msg) => (typeof log === 'object' && log.debug ? log.debug(msg) : null);

    for (const regex of hardwareIdRegexes) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const rawId = match[1];
            const normalized = normalizeHardwareId(rawId);
            if (normalized) {
                candidates.add(normalized);
                logInfo(`Found Hardware ID candidate: ${normalized} (raw: ${rawId})`);
            } else {
                logDebug(`Discarded invalid ID candidate: ${rawId}`);
            }
        }
    }

    return Array.from(candidates);
}

module.exports = {
    extractHardwareSystemId,
    normalizeHardwareId,
    MIN_ID_DIGITS, // constants exported for backward compat if needed
    MAX_ID_DIGITS
};
