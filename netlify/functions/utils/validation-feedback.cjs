/**
 * Validation Feedback Generator
 * 
 * Converts validation results into AI-readable feedback for retry attempts.
 * This helps the AI understand specific errors and focus on problematic fields.
 * 
 * @module validation-feedback
 */

"use strict";

/**
 * Generate detailed feedback for the AI based on validation results
 * 
 * @param {Object} validationResult - Result from validateAnalysisData
 * @param {number} attemptNumber - Current attempt number (1-based)
 * @returns {string|null} Feedback message for AI, or null if validation passed
 */
function generateValidationFeedback(validationResult, attemptNumber = 1) {
    if (!validationResult || validationResult.isValid) {
        return null;
    }

    const { warnings, flags } = validationResult;
    if (!warnings || warnings.length === 0) {
        return null;
    }

    const criticalIssues = flags || [];
    const allIssues = warnings;

    // Build structured feedback message
    const feedbackParts = [];
    
    feedbackParts.push(`RETRY ATTEMPT ${attemptNumber}: The previous extraction failed validation with ${criticalIssues.length} critical error(s) and ${allIssues.length - criticalIssues.length} warning(s).`);
    feedbackParts.push('');
    feedbackParts.push('CRITICAL ERRORS TO FIX:');
    
    if (criticalIssues.length > 0) {
        criticalIssues.forEach((issue, index) => {
            const feedback = generateSpecificFeedback(issue);
            feedbackParts.push(`${index + 1}. ${feedback}`);
        });
    } else {
        feedbackParts.push('(No critical errors, but warnings detected)');
    }
    
    if (allIssues.length > criticalIssues.length) {
        feedbackParts.push('');
        feedbackParts.push('WARNINGS (review carefully):');
        const warningsOnly = allIssues.filter(w => !criticalIssues.includes(w));
        warningsOnly.forEach((warning, index) => {
            const feedback = generateSpecificFeedback(warning);
            feedbackParts.push(`${index + 1}. ${feedback}`);
        });
    }
    
    feedbackParts.push('');
    feedbackParts.push('INSTRUCTIONS FOR THIS RETRY:');
    feedbackParts.push('- Re-examine the image carefully, focusing on the fields mentioned above');
    feedbackParts.push('- Verify unit conversions (mV to V, kW to W)');
    feedbackParts.push('- Double-check sign preservation (negative for discharge)');
    feedbackParts.push('- Ensure calculations match the physics (voltage sum, power = current × voltage)');
    feedbackParts.push('- If a value is unclear, use the MANDATORY field defaults from the original instructions');

    return feedbackParts.join('\n');
}

/**
 * Generate specific, actionable feedback for a single validation issue
 * 
 * @param {string} issue - Validation warning/flag message
 * @returns {string} AI-actionable feedback
 */
function generateSpecificFeedback(issue) {
    // SOC issues
    if (issue.includes('Invalid SOC')) {
        if (issue.includes('must be 0-100%')) {
            return `${issue} - Re-examine the SOC field in the image. SOC must be a percentage between 0 and 100. Check if you misread a digit or forgot a decimal point.`;
        }
    }
    
    // Cell voltage range issues
    if (issue.includes('voltage') && issue.includes('out of range')) {
        const cellMatch = issue.match(/Cell (\d+)/);
        const voltageMatch = issue.match(/(\d+\.?\d*)V/);
        if (cellMatch && voltageMatch) {
            return `${issue} - Cell ${cellMatch[1]} voltage ${voltageMatch[1]}V is physically impossible. Re-examine cell ${cellMatch[1]} in the image. Typical range is 2.0-4.5V. You may have misread a digit.`;
        }
    }
    
    // Voltage mismatch (physics error)
    if (issue.includes('Voltage mismatch')) {
        const overallMatch = issue.match(/Overall ([0-9.]+)V/);
        const sumMatch = issue.match(/sum of cells ([0-9.]+)V/);
        if (overallMatch && sumMatch) {
            return `${issue} - PHYSICS ERROR: The sum of individual cell voltages (${sumMatch[1]}V) should equal the overall voltage. You reported ${overallMatch[1]}V overall. Re-examine BOTH the overall voltage field AND the individual cell voltages. One or more of these values is incorrect.`;
        }
    }
    
    // Temperature issues
    if (issue.includes('Suspicious') && issue.includes('temperature')) {
        return `${issue} - This temperature value is outside normal battery operating range (0-100°C). Re-examine the temperature field. You may have misread the value or extracted the wrong unit.`;
    }
    
    // MOS and current consistency
    if (issue.includes('MOS') && (issue.includes('discharge current') || issue.includes('charge current'))) {
        return `${issue} - LOGICAL INCONSISTENCY: If current is flowing, the corresponding MOS should typically be ON. Re-examine both the current value AND the MOS status indicators (green=ON, grey=OFF).`;
    }
    
    // Power inconsistency
    if (issue.includes('Power inconsistency')) {
        const reportedMatch = issue.match(/Reported ([0-9.-]+)W/);
        const calculatedMatch = issue.match(/calculated ([0-9.-]+)W/);
        if (reportedMatch && calculatedMatch) {
            return `${issue} - PHYSICS ERROR: Power should equal Current × Voltage. You reported ${reportedMatch[1]}W but calculation gives ${calculatedMatch[1]}W. Re-examine the power field, verify the current sign (negative if discharging), and check for unit conversion (kW to W).`;
        }
    }
    
    // Capacity issues
    if (issue.includes('Remaining capacity') && issue.includes('exceeds full capacity')) {
        return `${issue} - LOGICAL ERROR: Remaining capacity cannot be greater than full capacity. Re-examine both the 'Remaining Cap' and 'Full Cap' fields. You may have swapped them or misread a value.`;
    }
    
    // SOC and capacity consistency
    if (issue.includes('SOC inconsistency')) {
        const reportedMatch = issue.match(/Reported ([0-9.]+)%/);
        const calculatedMatch = issue.match(/calculated ([0-9.]+)%/);
        if (reportedMatch && calculatedMatch) {
            return `${issue} - The SOC you extracted (${reportedMatch[1]}%) doesn't match what the capacity values indicate (${calculatedMatch[1]}%). Re-examine the SOC field, Remaining Cap, and Full Cap. Verify: SOC = (Remaining Cap / Full Cap) × 100.`;
        }
    }
    
    // Cell voltage statistics
    if (issue.includes('mismatch')) {
        return `${issue} - The statistical value you reported doesn't match the actual cell voltages array. If you extracted cell voltages, you MUST calculate these statistics from them: highest = max(cellVoltages), lowest = min(cellVoltages), average = sum/count, difference = highest - lowest.`;
    }
    
    // Default fallback
    return `${issue} - Re-examine the relevant field in the image and extract the correct value.`;
}

/**
 * Calculate a quality score based on validation results
 * 
 * @param {Object} validationResult - Result from validateAnalysisData
 * @returns {number} Quality score 0-100 (100 = perfect, 0 = critical failures)
 */
function calculateQualityScore(validationResult) {
    if (!validationResult) {
        return 0;
    }
    
    // Perfect score if valid with no warnings
    if (validationResult.isValid && (!validationResult.warnings || validationResult.warnings.length === 0)) {
        return 100;
    }
    
    // Calculate score based on issues
    const criticalCount = (validationResult.flags || []).length;
    const warningCount = (validationResult.warnings || []).length - criticalCount;
    
    // Start with perfect score
    let score = 100;
    
    // Deduct heavily for critical issues (each critical = -20 points)
    score -= criticalCount * 20;
    
    // Deduct moderately for warnings (each warning = -5 points)
    score -= warningCount * 5;
    
    // Floor at 0
    return Math.max(0, score);
}

module.exports = {
    generateValidationFeedback,
    generateSpecificFeedback,
    calculateQualityScore
};
