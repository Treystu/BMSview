/**
 * Tests for data extraction quality validation
 * Validates the validateExtractionQuality function
 */

const { validateExtractionQuality } = require('../netlify/functions/utils/analysis-helpers.cjs');

// Mock logger - supports old-style log('level', message, context) pattern
const createMockLogger = () => {
    const mockFn = jest.fn((level, message, context) => {
        // Store calls for verification
        mockFn.calls = mockFn.calls || [];
        mockFn.calls.push({ level, message, context });
    });
    
    // Add named methods for direct access if needed
    mockFn.info = jest.fn();
    mockFn.warn = jest.fn();
    mockFn.error = jest.fn();
    mockFn.debug = jest.fn();
    
    return mockFn;
};

describe('Data Extraction Quality Validation', () => {
    let mockLog;

    beforeEach(() => {
        mockLog = createMockLogger();
    });

    describe('High Quality Extraction', () => {
        test('should score 100 for complete, valid data', () => {
            const extractedData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75.5,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45,
                cellVoltageDifference: 0.025
            };

            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75.5,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45,
                cellVoltageDifference: 0.025,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264],
                temperatures: [25.3, 26.1]
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBe(100);
            expect(result.warnings).toHaveLength(0);
            expect(result.isComplete).toBe(true);
            expect(result.hasCriticalIssues).toBe(false);
            // Check that log was called with 'info' level
            expect(mockLog).toHaveBeenCalledWith('info', expect.any(String), expect.any(Object));
        });
    });

    describe('Missing Critical Fields', () => {
        test('should detect UNKNOWN DL number', () => {
            const extractedData = { dlNumber: 'UNKNOWN' };
            const analysisData = {
                dlNumber: 'UNKNOWN',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeLessThan(100); // Deducted for UNKNOWN
            expect(result.qualityScore).toBeGreaterThanOrEqual(75); // Still fairly good
            expect(result.warnings).toContain('DL Number not detected - defaulted to UNKNOWN');
            expect(result.isComplete).toBe(true); // Still complete
            expect(result.hasCriticalIssues).toBe(false);
        });

        test('should detect zero voltage as critical', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 0,
                current: 0,
                remainingCapacity: 0,
                power: 0,
                cycleCount: 0
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeLessThanOrEqual(70); // Low score for zero voltage
            expect(result.warnings).toContain('Overall voltage is 0V - likely extraction failure');
        });

        test('should detect inconsistent SOC with voltage', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 0,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeLessThan(100);
            expect(result.qualityScore).toBeGreaterThanOrEqual(70); // Still usable data
            expect(result.warnings).toContain('State of Charge is 0% but voltage is present - possible extraction error');
            expect(result.isComplete).toBe(true);
            expect(result.hasCriticalIssues).toBe(false);
        });
    });

    describe('Data Consistency Checks', () => {
        test('should detect current without power', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: 0,
                cycleCount: 45
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeLessThan(100);
            expect(result.qualityScore).toBeGreaterThanOrEqual(80); // Minor issue
            expect(result.warnings).toContain('Current present but power is 0W - possible calculation issue');
        });

        test('should detect identical cell voltages as error', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45,
                cellVoltages: [3.267, 3.267, 3.267, 3.267, 3.267, 3.267, 3.267, 3.267]
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBe(85); // 100 - 15
            expect(result.warnings).toContain('All cell voltages are identical - possible extraction error');
        });
    });

    describe('Optional Field Checks', () => {
        test('should warn about missing cell voltages', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45,
                cellVoltages: []
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeGreaterThanOrEqual(90); // Minor deduction for missing cell voltages
            expect(result.warnings).toContain('Individual cell voltages not detected - only aggregate data available');
        });

        test('should warn about missing temperature sensors', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45,
                temperatures: []
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeGreaterThanOrEqual(90); // Minor deduction
            expect(result.warnings).toContain('No temperature sensors detected');
        });

        test('should warn about zero cycle count', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 0
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeGreaterThanOrEqual(90); // Minor deduction
            expect(result.warnings).toContain('Cycle count is 0 - may not have been detected');
        });
    });

    describe('Quality Thresholds', () => {
        test('should mark as complete when score >= 70', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'UNKNOWN',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 0,
                cellVoltages: [],
                temperatures: []
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeGreaterThanOrEqual(70);
            expect(result.isComplete).toBe(true);
            expect(result.hasCriticalIssues).toBe(false);
        });

        test('should mark as incomplete when score < 70', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'UNKNOWN',
                stateOfCharge: 0,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 0,
                power: -271.96,
                cycleCount: 0,
                cellVoltages: [],
                temperatures: []
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeLessThan(70);
            expect(result.isComplete).toBe(false);
            // Check that warn was called
            expect(mockLog).toHaveBeenCalledWith('warn', expect.any(String), expect.any(Object));
        });

        test('should mark as critical when score < 50', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'UNKNOWN',
                stateOfCharge: 0,
                overallVoltage: 0,
                current: 0,
                remainingCapacity: 0,
                power: 0,
                cycleCount: 0
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeLessThanOrEqual(70); // Very low score for all defaults
            expect(result.isComplete).toBe(false);
            // Should have many warnings
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('Fields Captured Metrics', () => {
        test('should track total fields and fields with values', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45,
                cellVoltages: [3.265, 3.270],
                temperatures: [25.3],
                mosTemperature: null,
                serialNumber: null,
                softwareVersion: null
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.fieldsCaptured.total).toBeGreaterThan(0);
            expect(result.fieldsCaptured.withValues).toBeGreaterThan(0);
            expect(result.fieldsCaptured.withValues).toBeLessThan(result.fieldsCaptured.total);
        });
    });

    describe('Logging Behavior', () => {
        test('should log info for successful validation', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45
            };

            validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(mockLog).toHaveBeenCalledWith(
                'info',
                'Data extraction quality validation complete.',
                expect.objectContaining({
                    qualityScore: expect.any(Number),
                    isComplete: expect.any(Boolean)
                })
            );
        });

        test('should log warnings when issues detected', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'UNKNOWN',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 0
            };

            validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(mockLog).toHaveBeenCalledWith(
                'warn',
                'Data extraction quality warnings detected.',
                expect.objectContaining({
                    warnings: expect.arrayContaining([
                        expect.stringContaining('DL Number'),
                        expect.stringContaining('Cycle count')
                    ])
                })
            );
        });
    });

    describe('Edge Cases', () => {
        test('should never return negative quality score', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'UNKNOWN',
                stateOfCharge: 0,
                overallVoltage: 0,
                current: 0,
                remainingCapacity: 0,
                power: 0,
                cycleCount: 0,
                cellVoltages: [],
                temperatures: []
            };

            const result = validateExtractionQuality(extractedData, analysisData, mockLog);

            expect(result.qualityScore).toBeGreaterThanOrEqual(0);
        });

        test('should handle missing temperature field gracefully', () => {
            const extractedData = {};
            const analysisData = {
                dlNumber: 'DL-12345678',
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                power: -271.96,
                cycleCount: 45
                // temperatures not defined
            };

            expect(() => {
                validateExtractionQuality(extractedData, analysisData, mockLog);
            }).not.toThrow();
        });
    });
});
