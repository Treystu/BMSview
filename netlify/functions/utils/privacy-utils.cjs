/**
 * Privacy Utilities for AI Feedback System
 * 
 * Handles data anonymization and PII stripping before sending data to AI services.
 */

const crypto = require('crypto');

/**
 * Anonymize a system profile to remove PII before AI processing
 * 
 * @param {Object} profile - The system profile to anonymize
 * @returns {Object} Anonymized profile
 */
function anonymizeSystemProfile(profile) {
    if (!profile) return null;
    
    // Create a deep copy to avoid mutating the original
    const safeProfile = JSON.parse(JSON.stringify(profile));
    
    // 1. Anonymize System ID (Hash it)
    // We need a consistent hash for the same system within a session, 
    // but it shouldn't be reversible to the original ID easily by the AI
    if (safeProfile.id) {
        safeProfile.id = crypto.createHash('sha256').update(safeProfile.id).digest('hex').substring(0, 12);
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
    const piiFields = ['userId', 'owner', 'email', 'phone', 'address', 'wifiSsid'];
    piiFields.forEach(field => {
        if (safeProfile[field]) {
            delete safeProfile[field];
        }
    });
    
    return safeProfile;
}

/**
 * Anonymize user feedback before storage/processing
 * 
 * @param {Object} feedback - User feedback object
 * @returns {Object} Anonymized feedback
 */
function anonymizeFeedback(feedback) {
    if (!feedback) return null;
    
    // Create a deep copy to avoid mutating the original
    const safeFeedback = JSON.parse(JSON.stringify(feedback));
    
    // Remove user identifiers
    if (safeFeedback.userId) delete safeFeedback.userId;
    if (safeFeedback.userEmail) delete safeFeedback.userEmail;
    
    return safeFeedback;
}

module.exports = {
    anonymizeSystemProfile,
    anonymizeFeedback
};