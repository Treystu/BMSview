/**
 * Unit tests for validation feedback generator
 * Tests the generateValidationFeedback and calculateQualityScore functions
 */

const { 
    generateValidationFeedback, 
    generateSpecificFeedback,
    calculateQualityScore 
} = require('../netlify/functions/utils/validation-feedback.cjs');

describe('Validation Feedback Generator', () => {
    describe('generateValidationFeedback', () => {
        test('should return null for valid data', () => {
            const validResult = {
                isValid: true,
                warnings: [],
                flags: []
            };

            const feedback = generateValidationFeedback(validResult, 1);
            expect(feedback).toBeNull();
        });

        test('should generate feedback for critical errors', () => {
            const invalidResult = {
                isValid: false,
                warnings: [
                    'Invalid SOC: 150% (must be 0-100%)',
                    'Voltage mismatch: Overall 60.0V vs sum of cells 52.28V (diff: 7.72V)'
                ],
                flags: [
                    'Invalid SOC: 150% (must be 0-100%)',
                    'Voltage mismatch: Overall 60.0V vs sum of cells 52.28V (diff: 7.72V)'
                ]
            };

            const feedback = generateValidationFeedback(invalidResult, 1);
            
            expect(feedback).toContain('RETRY ATTEMPT 1');
            expect(feedback).toContain('2 critical error(s)');
            expect(feedback).toContain('CRITICAL ERRORS TO FIX:');
            expect(feedback).toContain('SOC');
            expect(feedback).toContain('Voltage mismatch');
        });

        test('should include attempt number in feedback', () => {
            const invalidResult = {
                isValid: false,
                warnings: ['Invalid SOC: 150% (must be 0-100%)'],
                flags: ['Invalid SOC: 150% (must be 0-100%)']
            };

            const feedback1 = generateValidationFeedback(invalidResult, 1);
            expect(feedback1).toContain('RETRY ATTEMPT 1');

            const feedback2 = generateValidationFeedback(invalidResult, 2);
            expect(feedback2).toContain('RETRY ATTEMPT 2');

            const feedback3 = generateValidationFeedback(invalidResult, 3);
            expect(feedback3).toContain('RETRY ATTEMPT 3');
        });

        test('should separate critical errors from warnings', () => {
            const result = {
                isValid: false,
                warnings: [
                    'Invalid SOC: 150% (must be 0-100%)',
                    'Discharge current detected (-5.2A) but discharge MOS is OFF - possible data inconsistency'
                ],
                flags: [
                    'Invalid SOC: 150% (must be 0-100%)'
                ]
            };

            const feedback = generateValidationFeedback(result, 1);
            
            expect(feedback).toContain('1 critical error(s)');
            expect(feedback).toContain('1 warning(s)');
            expect(feedback).toContain('CRITICAL ERRORS TO FIX:');
            expect(feedback).toContain('WARNINGS (review carefully):');
        });

        test('should include retry instructions', () => {
            const invalidResult = {
                isValid: false,
                warnings: ['Invalid SOC: 150% (must be 0-100%)'],
                flags: ['Invalid SOC: 150% (must be 0-100%)']
            };

            const feedback = generateValidationFeedback(invalidResult, 1);
            
            expect(feedback).toContain('INSTRUCTIONS FOR THIS RETRY:');
            expect(feedback).toContain('Re-examine the image carefully');
            expect(feedback).toContain('Verify unit conversions');
            expect(feedback).toContain('Double-check sign preservation');
        });
    });

    describe('generateSpecificFeedback', () => {
        test('should provide specific feedback for SOC range errors', () => {
            const issue = 'Invalid SOC: 150% (must be 0-100%)';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('SOC must be a percentage between 0 and 100');
            expect(feedback).toContain('misread a digit');
        });

        test('should provide specific feedback for cell voltage range errors', () => {
            const issue = 'Cell 16 voltage 5.0V out of range (2.0-4.5V)';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('Cell 16');
            expect(feedback).toContain('5.0V is physically impossible');
            expect(feedback).toContain('Typical range is 2.0-4.5V');
        });

        test('should provide physics-based feedback for voltage mismatch', () => {
            const issue = 'Voltage mismatch: Overall 60.0V vs sum of cells 52.28V (diff: 7.72V)';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('PHYSICS ERROR');
            expect(feedback).toContain('sum of individual cell voltages');
            expect(feedback).toContain('Re-examine BOTH');
        });

        test('should provide specific feedback for temperature errors', () => {
            const issue = 'Suspicious battery temperature: 120°C (expected 0-100°C)';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('outside normal battery operating range');
            expect(feedback).toContain('0-100°C');
        });

        test('should provide specific feedback for power inconsistency', () => {
            const issue = 'Power inconsistency: Reported -200.0W vs calculated -523.0W (323.0W difference)';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('PHYSICS ERROR');
            expect(feedback).toContain('Power should equal Current × Voltage');
            expect(feedback).toContain('-200.0W');
            expect(feedback).toContain('-523.0W');
        });

        test('should provide specific feedback for capacity logic errors', () => {
            const issue = 'Remaining capacity (250.0Ah) exceeds full capacity (200.0Ah)';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('LOGICAL ERROR');
            expect(feedback).toContain('Remaining capacity cannot be greater than full capacity');
            expect(feedback).toContain('swapped them');
        });

        test('should provide specific feedback for SOC calculation errors', () => {
            const issue = 'SOC inconsistency: Reported 75.0% vs calculated 50.0% (25.0% difference)';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('SOC = (Remaining Cap / Full Cap) × 100');
            expect(feedback).toContain('75.0%');
            expect(feedback).toContain('50.0%');
        });

        test('should provide feedback for cell statistics mismatch', () => {
            const issue = 'Highest cell voltage mismatch: Reported 3.290V vs actual 3.271V';
            const feedback = generateSpecificFeedback(issue);
            
            expect(feedback).toContain('statistical value');
            expect(feedback).toContain('calculate these statistics');
            expect(feedback).toContain('highest = max(cellVoltages)');
        });
    });

    describe('calculateQualityScore', () => {
        test('should return 100 for perfect validation', () => {
            const perfect = {
                isValid: true,
                warnings: [],
                flags: []
            };

            const score = calculateQualityScore(perfect);
            expect(score).toBe(100);
        });

        test('should return 0 for null validation result', () => {
            const score = calculateQualityScore(null);
            expect(score).toBe(0);
        });

        test('should deduct 20 points per critical error', () => {
            const oneCritical = {
                isValid: false,
                warnings: ['Critical error 1'],
                flags: ['Critical error 1']
            };

            const score1 = calculateQualityScore(oneCritical);
            expect(score1).toBe(80); // 100 - 20

            const twoCritical = {
                isValid: false,
                warnings: ['Critical error 1', 'Critical error 2'],
                flags: ['Critical error 1', 'Critical error 2']
            };

            const score2 = calculateQualityScore(twoCritical);
            expect(score2).toBe(60); // 100 - 40
        });

        test('should deduct 5 points per warning', () => {
            const oneWarning = {
                isValid: true,
                warnings: ['Warning 1'],
                flags: []
            };

            const score1 = calculateQualityScore(oneWarning);
            expect(score1).toBe(95); // 100 - 5

            const twoWarnings = {
                isValid: true,
                warnings: ['Warning 1', 'Warning 2'],
                flags: []
            };

            const score2 = calculateQualityScore(twoWarnings);
            expect(score2).toBe(90); // 100 - 10
        });

        test('should combine critical errors and warnings correctly', () => {
            const mixed = {
                isValid: false,
                warnings: ['Critical error 1', 'Warning 1', 'Warning 2'],
                flags: ['Critical error 1']
            };

            const score = calculateQualityScore(mixed);
            expect(score).toBe(70); // 100 - 20 (critical) - 10 (2 warnings)
        });

        test('should floor at 0', () => {
            const tooManyErrors = {
                isValid: false,
                warnings: Array(20).fill('Critical error'),
                flags: Array(20).fill('Critical error')
            };

            const score = calculateQualityScore(tooManyErrors);
            expect(score).toBe(0); // Would be -300, floored at 0
        });

        test('should handle valid with warnings', () => {
            const validWithWarnings = {
                isValid: true,
                warnings: ['Minor warning 1', 'Minor warning 2', 'Minor warning 3'],
                flags: []
            };

            const score = calculateQualityScore(validWithWarnings);
            expect(score).toBe(85); // 100 - 15 (3 warnings)
        });
    });
});
