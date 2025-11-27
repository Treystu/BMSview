/**
 * Privacy Utilities for AI Feedback System
 * 
 * Handles data anonymization and PII stripping before sending data to AI services.
 * 
 * @note Deep cloning uses JSON.parse(JSON.stringify()) which has limitations:
 *       - Functions are not supported (omitted)
 *       - Date objects are converted to strings
 *       - undefined values are omitted
 *       - Circular references will throw an error
 *       - Special objects (RegExp, Map, Set) are not properly cloned
 *       Only plain JSON-serializable objects are supported.
 */

const crypto = require('crypto');

/**
 * Anonymize a system profile to remove PII before AI processing
 * 
 * @param {Object} profile - The system profile to anonymize
 * @returns {Object|null} Anonymized profile, or null if input is invalid or cloning fails
 */
function anonymizeSystemProfile(profile) {
    if (!profile) return null;
    
    // Create a deep copy to avoid mutating the original
    // Note: This approach only works with JSON-serializable objects
    let safeProfile;
    try {
        safeProfile = JSON.parse(JSON.stringify(profile));
    } catch (err) {
        console.error('[privacy-utils] Failed to deep clone profile object:', err);
        return null;
    }
    
    // 1. Anonymize System ID (Hash it)
    // We need a consistent hash for the same system within a session, 
    // but it shouldn't be reversible to the original ID easily by the AI.
    // Using first 16 hex chars (64 bits) for better collision resistance.
    // Birthday paradox: ~50% collision chance after ~5.1 billion unique IDs.
    if (safeProfile.id) {
        safeProfile.id = crypto.createHash('sha256').update(safeProfile.id).digest('hex').substring(0, 16);
    }
    
    // 2. Remove Name/PII
    if (safeProfile.name) {
        safeProfile.name = `System-${safeProfile.id ? safeProfile.id.substring(0, 6) : 'Unknown'}`;
    }
    
    // 3. Blur Location
    // Round to 2 decimal places (~1.1km accuracy) - sufficient for weather, preserves privacy
    if (safeProfile.location) {
        if (typeof safeProfile.location.latitude === 'number') {
            safeProfile.location.latitude = Math.round(safeProfile.location.latitude * 100) / 100;
        }
        if (typeof safeProfile.location.longitude === 'number') {
            safeProfile.location.longitude = Math.round(safeProfile.location.longitude * 100) / 100;
        }
    }
    
    // 4. Remove other potential PII fields
    // Use 'in' operator to check for field existence rather than truthiness,
    // ensuring complete removal of PII fields regardless of their values (null, "", 0, false)
    const piiFields = ['userId', 'owner', 'email', 'phone', 'address', 'wifiSsid'];
    piiFields.forEach(field => {
        if (field in safeProfile) {
            delete safeProfile[field];
        }
    });
    
    return safeProfile;
}

/**
 * Anonymize user feedback before storage/processing
 * 
 * @param {Object} feedback - User feedback object
 * @returns {Object|null} Anonymized feedback, or null if input is invalid or cloning fails
 * @note Only plain JSON-serializable objects are supported. Non-serializable fields will be lost.
 */
function anonymizeFeedback(feedback) {
    if (!feedback) return null;
    
    // Create a deep copy to avoid mutating the original
    let safeFeedback;
    try {
        safeFeedback = JSON.parse(JSON.stringify(feedback));
    } catch (err) {
        // Log the error and return null to avoid processing invalid feedback
        console.error('[privacy-utils] Failed to deep clone feedback object:', err);
        return null;
    }
    
    // Remove user identifiers
    // Use 'in' operator to check for field existence rather than truthiness,
    // ensuring complete removal of PII fields regardless of their values
    if ('userId' in safeFeedback) delete safeFeedback.userId;
    if ('userEmail' in safeFeedback) delete safeFeedback.userEmail;
    
    return safeFeedback;
}

module.exports = {
    anonymizeSystemProfile,
    anonymizeFeedback
};