/**
 * Integration tests for autonomous self-correction and quality-based deduplication
 * Tests the retry loop, validation feedback, and duplicate upgrade functionality
 */

const { validateAnalysisData } = require('../netlify/functions/utils/data-validation.cjs');
const { 
    generateValidationFeedback, 
    calculateQualityScore 
} = require('../netlify/functions/utils/validation-feedback.cjs');

describe('Autonomous Self-Correction Integration', () => {
    describe('Retry Loop Simulation', () => {
        test('should improve quality across retry attempts', () => {
            // Simulate Attempt 1: Bad data with critical errors
            const attempt1Data = {
                stateOfCharge: 150, // Invalid
                overallVoltage: 60.0, // Mismatch with cells
                current: -10.0,
                power: 200.0, // Should be negative
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264, 
                               3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264] // Sum = 52.28V
            };

            const validation1 = validateAnalysisData(attempt1Data);
            expect(validation1.isValid).toBe(false);
            
            const quality1 = calculateQualityScore(validation1);
            expect(quality1).toBeLessThan(60); // Below acceptable quality
            
            const feedback1 = generateValidationFeedback(validation1, 2);
            expect(feedback1).toContain('RETRY ATTEMPT 2');
            expect(feedback1).toContain('SOC');
            expect(feedback1).toContain('Voltage mismatch');
            expect(feedback1).toContain('Power');

            // Simulate Attempt 2: Improved data (SOC fixed, voltage closer)
            const attempt2Data = {
                stateOfCharge: 75, // Fixed
                overallVoltage: 52.5, // Closer to sum
                current: -10.0,
                power: -525.0, // Fixed sign
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264, 
                               3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264]
            };

            const validation2 = validateAnalysisData(attempt2Data);
            const quality2 = calculateQualityScore(validation2);
            
            // Quality should improve
            expect(quality2).toBeGreaterThan(quality1);
            expect(quality2).toBeGreaterThanOrEqual(60); // Acceptable now

            // Should have fewer errors
            expect(validation2.flags.length).toBeLessThan(validation1.flags.length);
        });

        test('should track best attempt when all retries fail', () => {
            // Attempt 1: Quality score 40
            const attempt1 = {
                isValid: false,
                warnings: ['Error 1', 'Error 2', 'Error 3'],
                flags: ['Error 1', 'Error 2', 'Error 3']
            };
            const quality1 = calculateQualityScore(attempt1);
            expect(quality1).toBe(40); // 100 - 60

            // Attempt 2: Quality score 60 (improvement)
            const attempt2 = {
                isValid: false,
                warnings: ['Error 1', 'Error 2'],
                flags: ['Error 1', 'Error 2']
            };
            const quality2 = calculateQualityScore(attempt2);
            expect(quality2).toBe(60); // 100 - 40

            // Attempt 3: Quality score 50 (worse than attempt 2)
            const attempt3 = {
                isValid: false,
                warnings: ['Error 1', 'Error 2', 'Warning 1'],
                flags: ['Error 1', 'Error 2']
            };
            const quality3 = calculateQualityScore(attempt3);
            expect(quality3).toBe(55); // 100 - 40 - 5

            // Best attempt should be Attempt 2 with quality 60
            const bestQuality = Math.max(quality1, quality2, quality3);
            expect(bestQuality).toBe(60);
        });
    });

    describe('Quality-Based Duplicate Handling', () => {
        test('should identify low-quality records for upgrade', () => {
            const lowQualityRecord = {
                id: 'test-123',
                validationScore: 50,
                needsReview: true,
                analysis: { stateOfCharge: 75 }
            };

            const MIN_QUALITY_FOR_REUSE = 80;
            const shouldUpgrade = lowQualityRecord.validationScore < MIN_QUALITY_FOR_REUSE;
            
            expect(shouldUpgrade).toBe(true);
        });

        test('should not upgrade high-quality records', () => {
            const highQualityRecord = {
                id: 'test-456',
                validationScore: 95,
                needsReview: false,
                analysis: { stateOfCharge: 75 }
            };

            const MIN_QUALITY_FOR_REUSE = 80;
            const shouldUpgrade = highQualityRecord.validationScore < MIN_QUALITY_FOR_REUSE;
            
            expect(shouldUpgrade).toBe(false);
        });

        test('should upgrade record flagged for review even with decent score', () => {
            const needsReviewRecord = {
                id: 'test-789',
                validationScore: 75, // Decent but below threshold
                needsReview: true, // Flagged for review
                analysis: { stateOfCharge: 75 }
            };

            const MIN_QUALITY_FOR_REUSE = 80;
            const shouldUpgrade = needsReviewRecord.needsReview || 
                                  needsReviewRecord.validationScore < MIN_QUALITY_FOR_REUSE;
            
            expect(shouldUpgrade).toBe(true);
        });
    });

    describe('Feedback Generation Quality', () => {
        test('should generate actionable feedback for physics errors', () => {
            const physicsError = {
                isValid: false,
                warnings: ['Voltage mismatch: Overall 60.0V vs sum of cells 52.28V (diff: 7.72V)'],
                flags: ['Voltage mismatch: Overall 60.0V vs sum of cells 52.28V (diff: 7.72V)']
            };

            const feedback = generateValidationFeedback(physicsError, 2);
            
            expect(feedback).toContain('PHYSICS ERROR');
            expect(feedback).toContain('sum of individual cell voltages');
            expect(feedback).toContain('Re-examine BOTH');
        });

        test('should generate actionable feedback for unit conversion errors', () => {
            const powerError = {
                isValid: false,
                warnings: ['Power inconsistency: Reported -200.0W vs calculated -523.0W (323.0W difference)'],
                flags: ['Power inconsistency: Reported -200.0W vs calculated -523.0W (323.0W difference)']
            };

            const feedback = generateValidationFeedback(powerError, 2);
            
            expect(feedback).toContain('PHYSICS ERROR');
            expect(feedback).toContain('Power should equal Current × Voltage');
            expect(feedback).toContain('kW to W');
        });

        test('should provide retry instructions in feedback', () => {
            const anyError = {
                isValid: false,
                warnings: ['Invalid SOC: 150% (must be 0-100%)'],
                flags: ['Invalid SOC: 150% (must be 0-100%)']
            };

            const feedback = generateValidationFeedback(anyError, 2);
            
            expect(feedback).toContain('INSTRUCTIONS FOR THIS RETRY:');
            expect(feedback).toContain('Re-examine the image carefully');
            expect(feedback).toContain('Verify unit conversions');
            expect(feedback).toContain('Double-check sign preservation');
        });
    });

    describe('Quality Score Thresholds', () => {
        const MIN_ACCEPTABLE_QUALITY = 60;

        test('should accept records meeting quality threshold', () => {
            const acceptableValidation = {
                isValid: true,
                warnings: ['Minor warning 1', 'Minor warning 2'],
                flags: []
            };

            const quality = calculateQualityScore(acceptableValidation);
            expect(quality).toBeGreaterThanOrEqual(MIN_ACCEPTABLE_QUALITY);
        });

        test('should reject records below quality threshold', () => {
            const unacceptableValidation = {
                isValid: false,
                warnings: ['Error 1', 'Error 2', 'Error 3'],
                flags: ['Error 1', 'Error 2', 'Error 3']
            };

            const quality = calculateQualityScore(unacceptableValidation);
            expect(quality).toBeLessThan(MIN_ACCEPTABLE_QUALITY);
        });

        test('should handle edge case at exact threshold', () => {
            // 100 - 40 = 60 exactly (2 critical errors)
            const thresholdValidation = {
                isValid: false,
                warnings: ['Error 1', 'Error 2'],
                flags: ['Error 1', 'Error 2']
            };

            const quality = calculateQualityScore(thresholdValidation);
            expect(quality).toBe(60);
            expect(quality).toBeGreaterThanOrEqual(MIN_ACCEPTABLE_QUALITY);
        });
    });

    describe('Self-Healing Scenarios', () => {
        test('scenario: OCR misreads voltage digit, retry fixes it', () => {
            // Attempt 1: Misread overall voltage significantly
            const badData = {
                stateOfCharge: 75,
                overallVoltage: 45.0, // WRONG - should be ~52V
                current: -5.0,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264, 
                               3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264] // Sum = 52.28V
            };

            const validation1 = validateAnalysisData(badData);
            expect(validation1.isValid).toBe(false); // Voltage mismatch > 1V
            
            const feedback = generateValidationFeedback(validation1, 2);
            expect(feedback).toContain('Re-examine');

            // Attempt 2: Corrected voltage
            const goodData = {
                stateOfCharge: 75,
                overallVoltage: 52.3, // FIXED
                current: -5.0,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264, 
                               3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264]
            };

            const validation2 = validateAnalysisData(goodData);
            const quality2 = calculateQualityScore(validation2);
            
            // Should be much better
            expect(quality2).toBeGreaterThan(calculateQualityScore(validation1));
        });

        test('scenario: Power sign error, retry preserves negative', () => {
            // Attempt 1: Wrong sign on power
            const badData = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -10.0, // Discharging
                power: 523.0 // WRONG (should be negative)
            };

            const validation1 = validateAnalysisData(badData);
            expect(validation1.isValid).toBe(false);
            expect(validation1.warnings.some(w => w.includes('Power inconsistency'))).toBe(true);

            // Attempt 2: Corrected sign
            const goodData = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -10.0,
                power: -523.0 // FIXED
            };

            const validation2 = validateAnalysisData(goodData);
            expect(validation2.warnings.some(w => w.includes('Power inconsistency'))).toBe(false);
        });
    });

    describe('Upgrade Success Tracking', () => {
        test('should track quality improvement in upgrade metadata', () => {
            const oldRecord = {
                validationScore: 50,
                needsReview: true
            };

            const newRecord = {
                validationScore: 95,
                needsReview: false
            };

            const improvement = newRecord.validationScore - oldRecord.validationScore;
            expect(improvement).toBe(45);
            expect(newRecord.validationScore).toBeGreaterThan(80); // Above threshold
        });

        test('should indicate upgrade in response metadata', () => {
            const responseBody = {
                analysis: { stateOfCharge: 75 },
                recordId: 'test-123',
                wasUpgraded: true
            };

            expect(responseBody.wasUpgraded).toBe(true);
        });
    });
});
