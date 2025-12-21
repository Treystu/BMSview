/**
 * Unified Time Utility (CommonJS)
 * 
 * Single source of truth for time handling across the application backend.
 * ALL timestamps must be ISO 8601 UTC.
 */

// ISO 8601 UTC Regex: YYYY-MM-DDTHH:mm:ss.sssZ
const UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Epoch check constant
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/**
 * Get current time in strict ISO 8601 UTC format.
 * usage: replace new Date().toISOString() with nowUtc()
 */
function nowUtc() {
    return new Date().toISOString();
}

/**
 * Validate that a timestamp is strictly ISO 8601 UTC.
 * Throws error if invalid.
 * @param {string} timestamp 
 * @param {string} context 
 */
function assertUtc(timestamp, context = 'Value') {
    if (!timestamp) {
        throw new Error(`${context} must be provided (received ${timestamp})`);
    }
    if (!UTC_TIMESTAMP_REGEX.test(timestamp)) {
        throw new Error(`${context} must be ISO 8601 UTC (expected YYYY-MM-DDTHH:mm:ss.sssZ, got ${timestamp})`);
    }
    return timestamp;
}

/**
 * Check if a timestamp is valid UTC without throwing.
 * @param {string} timestamp
 */
function isValidUtc(timestamp) {
    return UTC_TIMESTAMP_REGEX.test(timestamp);
}

module.exports = {
    UTC_TIMESTAMP_REGEX,
    EPOCH_ISO,
    nowUtc,
    assertUtc,
    isValidUtc
};
