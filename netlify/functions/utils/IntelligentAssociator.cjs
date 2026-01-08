const { normalizeHardwareId } = require('./analysis-helpers.cjs');

/**
 * IntelligentAssociator
 * Implements Tiered Data Reconciliation for BMS records.
 */
class IntelligentAssociator {
    /**
     * @param {Array<Object>} systems - Array of system objects.
     * @param {Map<string, Object>} historyCache - Map of systemId -> latest history record (for SOC checks).
     */
    constructor(systems, historyCache) {
        this.systems = systems || [];
        this.historyCache = historyCache || new Map();
    }

    /**
     * Finds the best matching system for a given record.
     * @param {Object} record - The BMS record to match.
     * @returns {Object} Match result { systemId, confidence, reason, isNewCandidate }
     */
    findMatch(record) {
        // Normalize Record ID
        // Try hardwareSystemId first, then dlNumber, then analysis fields
        const rawId = record.hardwareSystemId || record.dlNumber || record.analysis?.hardwareSystemId || record.analysis?.dlNumber;
        const recordId = normalizeHardwareId(rawId);

        if (!recordId || recordId === 'UNKNOWN') {
            return { 
                systemId: null, 
                confidence: 'none', 
                reason: 'No valid ID found in record', 
                isNewCandidate: false 
            };
        }

        let candidateSystem = null;
        let matchType = 'none';

        // --- Tier 1: Strict Match ---
        // Exact match on unified ID against system's associated IDs
        for (const system of this.systems) {
            const associatedIds = this.getAssociatedIds(system);
            if (associatedIds.includes(recordId)) {
                candidateSystem = system;
                matchType = 'strict';
                break;
            }
        }

        // --- Tier 2: Fuzzy Match ---
        // Levenshtein distance <= 2
        if (!candidateSystem) {
            for (const system of this.systems) {
                const associatedIds = this.getAssociatedIds(system);
                for (const id of associatedIds) {
                    if (this.levenshtein(recordId, id) <= 2) {
                        candidateSystem = system;
                        matchType = 'fuzzy';
                        break;
                    }
                }
                if (candidateSystem) break;
            }
        }

        // --- Tier 3: Semantic Validation (The "Intelligent" Filter) ---
        if (candidateSystem) {
            const validation = this.validate(record, candidateSystem);
            
            if (validation.pass) {
                return {
                    systemId: candidateSystem.id,
                    confidence: matchType === 'strict' ? 'high' : 'medium',
                    reason: `Matched via ${matchType}. ${validation.reason}`,
                    isNewCandidate: false
                };
            } else {
                // REJECT MATCH (Safety Valve)
                // Fall through to New Candidate Logic
                // We log the rejection reason but treat it as if no match was found for the purpose of candidate generation
                // Optionally, we could return a specific "rejected" status, but the requirement implies checking if it's a new candidate.
                console.log(`Match rejected for ${recordId} against ${candidateSystem.name}: ${validation.reason}`);
            }
        }

        // --- New Candidate Logic ---
        // If no match found (or match rejected), and ID looks valid
        if (this.isValidIdFormat(recordId)) {
            return {
                systemId: null,
                confidence: 'none',
                reason: 'No match found (or match rejected), but valid ID format',
                isNewCandidate: true
            };
        }

        return { 
            systemId: null, 
            confidence: 'none', 
            reason: 'No match found and invalid ID format', 
            isNewCandidate: false 
        };
    }

    /**
     * Helpers
     */

    getAssociatedIds(system) {
        // Collect all IDs associated with the system and normalize them
        const ids = new Set([
            system.id, // Include the system UUID itself? Maybe not for hardware ID matching, but good for completeness if users use it.
            ...(system.associatedHardwareIds || []),
            ...(system.associatedDLs || [])
        ]);
        return Array.from(ids).map(id => normalizeHardwareId(id)).filter(id => id !== 'UNKNOWN');
    }

    validate(record, system) {
        const results = [];

        // 1. Voltage Sanity
        // Record voltage must be within +/- 30% of System's avg voltage (if known)
        if (system.voltage && record.overallVoltage) {
            const diff = Math.abs(record.overallVoltage - system.voltage);
            const threshold = system.voltage * 0.30;
            if (diff > threshold) {
                return { pass: false, reason: `Voltage mismatch: Record ${record.overallVoltage}V vs System ${system.voltage}V (+/- 30%)` };
            }
            results.push('Voltage OK');
        }

        // 2. SOC Continuity
        // If system has a record within 1 hour, SOC delta shouldn't exceed theoretical max
        const lastRecord = this.historyCache.get(system.id);
        if (lastRecord && record.timestamp && lastRecord.timestamp) {
            const currentTs = new Date(record.timestamp).getTime();
            const lastTs = new Date(lastRecord.timestamp).getTime();
            const timeDiffMs = Math.abs(currentTs - lastTs);
            const timeDiffMins = timeDiffMs / (1000 * 60);

            // Only check if within 1 hour (60 mins) and not duplicate timestamp
            if (timeDiffMins > 0 && timeDiffMins <= 60) {
                const socDiff = Math.abs((record.stateOfCharge || 0) - (lastRecord.stateOfCharge || 0));
                
                // Theoretical max rate: >50% jump in 10 mins is impossible => 5% per minute
                const maxSocChange = timeDiffMins * 5; 
                
                if (socDiff > maxSocChange) {
                     return { pass: false, reason: `SOC Discontinuity: ${socDiff.toFixed(1)}% change in ${timeDiffMins.toFixed(1)} mins` };
                }
                results.push('SOC Continuity OK');
            }
        }

        return { pass: true, reason: results.join(', ') || 'Validation Passed' };
    }

    isValidIdFormat(id) {
        // Regex check for standard format (e.g., DL-12345)
        // 2-4 uppercase letters, dash, 5-20 digits
        return /^[A-Z]{2,4}-\d{5,20}$/.test(id);
    }

    levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        // increment along the first column of each row
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        // increment each column in the first row
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        // Fill in the rest of the matrix
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        Math.min(
                            matrix[i][j - 1] + 1, // insertion
                            matrix[i - 1][j] + 1 // deletion
                        )
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }
}

module.exports = IntelligentAssociator;
