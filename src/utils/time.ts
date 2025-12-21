/**
 * Unified Time Utility
 * 
 * Single source of truth for time handling across the application.
 * ALL timestamps must be ISO 8601 UTC.
 */

// ISO 8601 UTC Regex: YYYY-MM-DDTHH:mm:ss.sssZ
export const UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Epoch check constant
export const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/**
 * Get current time in strict ISO 8601 UTC format.
 * usage: replace new Date().toISOString() with nowUtc()
 */
export function nowUtc(): string {
    return new Date().toISOString();
}

/**
 * Validate that a timestamp is strictly ISO 8601 UTC.
 * Throws error if invalid.
 */
export function assertUtc(timestamp: string, context: string = 'Value'): string {
    if (!timestamp) {
        throw new Error(`${context} must be provided (received ${timestamp})`);
    }
    if (!UTC_TIMESTAMP_REGEX.test(timestamp)) {
        // Fallback check for 000Z vs Z if needed, but we enforce .sssZ for consistency where possible.
        // However, often strict equality to regex is better. 
        // If we want to allow 'Z' without milliseconds, we can adjust regex. 
        // For now, standardizing on what Date().toISOString() returns.
        throw new Error(`${context} must be ISO 8601 UTC (expected YYYY-MM-DDTHH:mm:ss.sssZ, got ${timestamp})`);
    }
    return timestamp;
}

/**
 * Check if a timestamp is valid UTC without throwing.
 */
export function isValidUtc(timestamp: string): boolean {
    return UTC_TIMESTAMP_REGEX.test(timestamp);
}
