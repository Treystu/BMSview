const { normalizeHardwareId } = require('./analysis-helpers.cjs');

/**
 * Intelligent Data Reconciler
 * Matches analysis records to systems using a tiered approach:
 * 1. Strict Match (Unified ID)
 * 2. Fuzzy Match (Levenshtein Distance)
 * 3. Semantic Validation (Voltage & SOC sanity checks)
 */
class IntelligentAssociator {
    /**
     * @param {Array} systems - List of known systems
     * @param {Object} systemStats - Map of systemId -> { avgVoltage, lastSoc, lastTimestamp } (optional context)
     */
    constructor(systems, systemStats = {}) {
        this.systems = systems;
        this.systemStats = systemStats;
        this.hardwareIdMap = new Map();

        // Build efficient lookup map
        this.systems.forEach(s => {
            const allIds = new Set([
                s.id,
                ...(s.associatedDLs || []),
                ...(s.associatedHardwareIds || [])
            ]);

            allIds.forEach(rawId => {
                const normId = normalizeHardwareId(rawId);
                if (normId && normId !== 'UNKNOWN') {
                    if (!this.hardwareIdMap.has(normId)) {
                        this.hardwareIdMap.set(normId, []);
                    }
                    // Prevent duplicates
                    if (!this.hardwareIdMap.get(normId).some(existing => existing.id === s.id)) {
                        this.hardwareIdMap.get(normId).push(s);
                    }
                }
            });
        });
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
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
                            matrix[i - 1][j] + 1  // deletion
                        )
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Validate match using semantic data (Voltage, SOC)
     */
    validateMatch(system, record) {
        const stats = this.systemStats[system.id];
        if (!stats) return { valid: true }; // No stats to validate against, assume valid

        const reasons = [];
        let isValid = true;

        // Voltage Check (if available)
        if (record.analysis && record.analysis.overallVoltage > 0 && stats.avgVoltage > 0) {
            const voltageDiff = Math.abs(record.analysis.overallVoltage - stats.avgVoltage);
            const percentDiff = (voltageDiff / stats.avgVoltage) * 100;
            
            // Allow 30% variance (48V vs 24V check)
            if (percentDiff > 30) {
                isValid = false;
                reasons.push(`Voltage mismatch: Record ${record.analysis.overallVoltage}V vs System Avg ${stats.avgVoltage.toFixed(1)}V (${percentDiff.toFixed(0)}% diff)`);
            }
        }

        // SOC Continuity Check (if timestamps align)
        if (record.analysis && record.analysis.stateOfCharge != null && stats.lastSoc != null && stats.lastTimestamp) {
            const recordTime = new Date(record.timestamp || record.createdAt).getTime();
            const lastTime = new Date(stats.lastTimestamp).getTime();
            const timeDiffHours = (recordTime - lastTime) / (1000 * 60 * 60);

            // Only check if record is chronologically close (within 1 hour)
            if (timeDiffHours > 0 && timeDiffHours < 1) {
                const socDiff = Math.abs(record.analysis.stateOfCharge - stats.lastSoc);
                // Impossible jump: >50% change in <1 hour without massive current
                if (socDiff > 50) {
                     // Strict check: Is this physically possible? 
                     // Simple heuristic: If SOC jump is huge but time is short, flag it.
                     // (Refining to 40% to be safe, high C-rate batteries exist but 50% in 1hr is 0.5C, actually possible... 
                     // Let's make it > 80% jump in < 10 mins)
                     if (timeDiffHours < 0.16 && socDiff > 50) { // < 10 mins
                         isValid = false;
                         reasons.push(`SOC jump impossible: ${socDiff}% change in ${(timeDiffHours*60).toFixed(1)} mins`);
                     }
                }
            }
        }

        return { valid: isValid, reason: reasons.join('; ') };
    }

    /**
     * Find the best system match for a record
     */
    findMatch(record) {
        const candidates = new Set([
            normalizeHardwareId(record.hardwareSystemId),
            normalizeHardwareId(record.dlNumber),
            normalizeHardwareId(record.analysis?.hardwareSystemId),
            normalizeHardwareId(record.analysis?.dlNumber)
        ].filter(id => id && id !== 'UNKNOWN'));

        if (candidates.size === 0) {
            return { systemId: null, status: 'no_id', reason: 'No valid ID found in record' };
        }

        // Tier 1: Strict Match
        for (const candidateId of candidates) {
            const systems = this.hardwareIdMap.get(candidateId);
            if (systems && systems.length === 1) {
                const system = systems[0];
                const validation = this.validateMatch(system, record);
                
                if (validation.valid) {
                    return { 
                        systemId: system.id, 
                        systemName: system.name, 
                        status: 'matched_strict', 
                        matchedId: candidateId 
                    };
                } else {
                    return { 
                        systemId: null, 
                        status: 'rejected_semantic', 
                        reason: `Strict match found but failed validation: ${validation.reason}`,
                        isNewCandidate: true // Might be a new system with same ID (unlikely but possible reuse)
                    };
                }
            } else if (systems && systems.length > 1) {
                return { systemId: null, status: 'ambiguous', reason: 'Multiple systems map to this ID' };
            }
        }

        // Tier 1.5: Stripped Match (Ignore Dashes)
        // Solves "JHBC-890" vs "JHB-C890" mismatch caused by normalization heuristics
        for (const candidateId of candidates) {
            const strippedCandidate = candidateId.replace(/-/g, '');
            for (const [knownId, systems] of this.hardwareIdMap.entries()) {
                if (systems.length !== 1) continue;
                
                const strippedKnown = knownId.replace(/-/g, '');
                if (strippedCandidate === strippedKnown) {
                    const system = systems[0];
                    const validation = this.validateMatch(system, record);
                    
                    if (validation.valid) {
                        return { 
                            systemId: system.id, 
                            systemName: system.name, 
                            status: 'matched_stripped', 
                            matchedId: knownId, // Use the SYSTEM'S normalized ID
                            reason: `Stripped match (Dash position mismatch)`
                        };
                    }
                }
            }
        }

        // Tier 2: Fuzzy Match
        // Only run if no strict match
        let bestFuzzy = null;
        let minDistance = Infinity;

        // Iterate over all known normalized IDs
        for (const [knownId, systems] of this.hardwareIdMap.entries()) {
            if (systems.length !== 1) continue; // Skip ambiguous map entries

            for (const candidateId of candidates) {
                // Skip if lengths are vastly different (optimization)
                if (Math.abs(knownId.length - candidateId.length) > 2) continue;

                const dist = this.levenshtein(candidateId, knownId);
                
                // Allow dist 1 for short IDs (<8), dist 2 for long IDs
                const threshold = knownId.length > 8 ? 2 : 1;

                if (dist <= threshold && dist < minDistance) {
                    minDistance = dist;
                    bestFuzzy = { system: systems[0], matchedId: knownId, originalId: candidateId };
                }
            }
        }

        if (bestFuzzy) {
             const validation = this.validateMatch(bestFuzzy.system, record);
             if (validation.valid) {
                 return { 
                     systemId: bestFuzzy.system.id, 
                     systemName: bestFuzzy.system.name, 
                     status: 'matched_fuzzy', 
                     matchedId: bestFuzzy.matchedId,
                     fuzzyOriginal: bestFuzzy.originalId,
                     reason: `Fuzzy match (dist ${minDistance})`
                 };
             } else {
                 return {
                     systemId: null,
                     status: 'rejected_semantic',
                     reason: `Fuzzy match found but failed validation: ${validation.reason}`,
                     isNewCandidate: true
                 };
             }
        }

        // Tier 3: New Candidate (Initial Check)
        // If we have valid IDs but no match, it's a new candidate... unless Physics says otherwise.
        
        // Tier 4: Physics Inference (The "Smart" Match)
        // User Logic: "If average discharge is 2% per hour... SOC variance tolerance ~4%"
        // We iterate ALL systems to see if this record fits into their timeline.
        
        let bestPhysicsMatch = null;
        let minPhysicsError = Infinity;

        // Only try physics inference if we have valid data
        if (record.analysis && record.analysis.stateOfCharge != null && record.timestamp) {
            const recordTime = new Date(record.timestamp).getTime();
            const recordSoc = record.analysis.stateOfCharge;

            for (const system of this.systems) {
                const stats = this.systemStats[system.id];
                if (!stats || !stats.lastTimestamp || stats.lastSoc == null) continue;

                const sysTime = new Date(stats.lastTimestamp).getTime();
                const timeDiffHours = (recordTime - sysTime) / (1000 * 60 * 60);
                
                // Only infer if within 4 hours (to be safe)
                if (Math.abs(timeDiffHours) > 4) continue;

                // Expected SOC change: 2% per hour (Discharge) or Charging?
                // We don't know if charging. But we know SOC shouldn't jump 50% in 5 mins.
                // User Rule: 5% margin of error + time variance.
                // Base tolerance: 5%
                // Time factor: 2% per hour
                const tolerance = 5 + (Math.abs(timeDiffHours) * 2);
                
                const socDiff = Math.abs(recordSoc - stats.lastSoc);
                
                // Simple Physics Fit: Is the SOC difference within the tolerance window?
                if (socDiff <= tolerance) {
                    // Check Voltage too if available (Secondary check)
                    if (record.analysis.overallVoltage && stats.avgVoltage) {
                        const voltDiffPct = (Math.abs(record.analysis.overallVoltage - stats.avgVoltage) / stats.avgVoltage) * 100;
                        if (voltDiffPct > 20) continue; // Voltage mismatch (24v vs 48v) rejects it
                    }

                    // We found a fit. Is it the BEST fit?
                    // Error metric: How far is it from "No Change" or "Standard Discharge"?
                    // Let's just use raw SOC deviation as error metric.
                    if (socDiff < minPhysicsError) {
                        minPhysicsError = socDiff;
                        bestPhysicsMatch = system;
                    }
                }
            }
        }

        if (bestPhysicsMatch) {
             return { 
                 systemId: bestPhysicsMatch.id, 
                 systemName: bestPhysicsMatch.name, 
                 status: 'matched_physics', 
                 matchedId: 'INFERRED',
                 reason: `Physics Inference: SOC diff ${minPhysicsError.toFixed(1)}% within tolerance`
             };
        }

        // Tier 5: Truly New Candidate
        return { 
            systemId: null, 
            status: 'new_candidate', 
            reason: 'No matching system found (ID or Physics)',
            isNewCandidate: true,
            candidateIds: Array.from(candidates)
        };
    }
}

module.exports = { IntelligentAssociator };
