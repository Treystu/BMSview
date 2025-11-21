/**
 * Unit tests for data integrity validation
 * Tests the validateAnalysisData function in data-validation.cjs
 */

const { validateAnalysisData } = require('../netlify/functions/utils/data-validation.cjs');

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

describe('Data Integrity Validation', () => {
    let mockLog;

    beforeEach(() => {
        mockLog = createMockLogger();
    });

    describe('Valid Data', () => {
        test('should pass validation for physically consistent data', () => {
            const data = {
                stateOfCharge: 75.5,
                overallVoltage: 52.3,
                current: -5.2,
                remainingCapacity: 180.5,
                fullCapacity: 240.0,
                power: -271.96,
                temperature: 25.3,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264, 3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264],
                highestCellVoltage: 3.271,
                lowestCellVoltage: 3.264,
                averageCellVoltage: 3.267,
                cellVoltageDifference: 0.007,
                dischargeMosOn: true,
                chargeMosOn: false
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(true);
            expect(result.warnings).toHaveLength(0);
            expect(result.flags).toHaveLength(0);
        });
    });

    describe('State of Charge Range Check', () => {
        test('should flag SOC above 100%', () => {
            const data = {
                stateOfCharge: 150,
                overallVoltage: 52.3,
                current: 0,
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.flags.length).toBeGreaterThan(0);
            expect(result.warnings.some(w => w.includes('Invalid SOC'))).toBe(true);
        });

        test('should flag negative SOC', () => {
            const data = {
                stateOfCharge: -10,
                overallVoltage: 52.3,
                current: 0,
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Invalid SOC'))).toBe(true);
        });
    });

    describe('Cell Voltage Range Check', () => {
        test('should flag cell voltage below 2.0V', () => {
            const data = {
                stateOfCharge: 10,
                overallVoltage: 50.0,
                current: 0,
                cellVoltages: [3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 1.5]
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Cell 16 voltage') && w.includes('out of range'))).toBe(true);
        });

        test('should flag cell voltage above 4.5V', () => {
            const data = {
                stateOfCharge: 100,
                overallVoltage: 60.0,
                current: 0,
                cellVoltages: [3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 3.6, 5.0]
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Cell 16 voltage') && w.includes('out of range'))).toBe(true);
        });
    });

    describe('Physics Check - Voltage Sum', () => {
        test('should flag significant voltage mismatch (> 1V)', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 60.0, // Should be ~52.3V
                current: 0,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264, 3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264] // Sum = 52.28V
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Voltage mismatch'))).toBe(true);
        });

        test('should allow small voltage tolerance (< 0.5V)', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.5, // Sum = 52.28V, diff = 0.22V < 0.5V
                current: 0,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264, 3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264]
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(true);
            expect(result.warnings.some(w => w.includes('Voltage mismatch'))).toBe(false);
        });
    });

    describe('Temperature Range Check', () => {
        test('should flag suspicious temperature at 0°C', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: 0,
                temperature: 0,
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Suspicious battery temperature'))).toBe(true);
        });

        test('should flag temperature above 100°C', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: 0,
                temperature: 120,
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Suspicious battery temperature'))).toBe(true);
        });

        test('should flag suspicious temperatures in array', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: 0,
                temperatures: [25.3, -5.0, 26.1],
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Suspicious temperature sensor'))).toBe(true);
        });
    });

    describe('Logical Consistency - MOS and Current', () => {
        test('should warn when discharging but discharge MOS is off', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -10.5, // Discharging
                dischargeMosOn: false,
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            // This is a warning, not critical
            expect(result.warnings.some(w => w.includes('discharge MOS is OFF'))).toBe(true);
        });

        test('should warn when charging but charge MOS is off', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: 10.5, // Charging
                chargeMosOn: false,
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            // This is a warning, not critical
            expect(result.warnings.some(w => w.includes('charge MOS is OFF'))).toBe(true);
        });
    });

    describe('Power and Current Consistency', () => {
        test('should flag significant power inconsistency', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -10.0,
                power: -200.0, // Should be ~-523W
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Power inconsistency'))).toBe(true);
        });

        test('should allow power tolerance within 10%', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: -10.0,
                power: -515.0, // Expected -523, diff ~8W < 10% of 523W
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            // Should not flag power inconsistency
            expect(result.warnings.some(w => w.includes('Power inconsistency'))).toBe(false);
        });
    });

    describe('Capacity Consistency Check', () => {
        test('should flag remaining capacity exceeding full capacity', () => {
            const data = {
                stateOfCharge: 100,
                overallVoltage: 52.3,
                current: 0,
                remainingCapacity: 250.0,
                fullCapacity: 200.0,
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('Remaining capacity') && w.includes('exceeds full capacity'))).toBe(true);
        });
    });

    describe('SOC and Capacity Consistency', () => {
        test('should flag large SOC calculation mismatch', () => {
            const data = {
                stateOfCharge: 75.0,
                overallVoltage: 52.3,
                current: 0,
                remainingCapacity: 100.0,
                fullCapacity: 200.0, // Calculated SOC would be 50%
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.isValid).toBe(false);
            expect(result.warnings.some(w => w.includes('SOC inconsistency'))).toBe(true);
        });

        test('should allow small SOC calculation differences', () => {
            const data = {
                stateOfCharge: 75.0,
                overallVoltage: 52.3,
                current: 0,
                remainingCapacity: 148.0,
                fullCapacity: 200.0, // Calculated SOC = 74%, diff = 1%
                cellVoltages: []
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.warnings.some(w => w.includes('SOC inconsistency'))).toBe(false);
        });
    });

    describe('Cell Voltage Statistics Consistency', () => {
        test('should flag mismatch in highest cell voltage', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: 0,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264],
                highestCellVoltage: 3.290, // Actual is 3.271, diff = 0.019V
                lowestCellVoltage: 3.264,
                averageCellVoltage: 3.267,
                cellVoltageDifference: 0.007
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.warnings.some(w => w.includes('Highest cell voltage mismatch'))).toBe(true);
        });

        test('should flag mismatch in cell voltage difference', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: 0,
                cellVoltages: [3.265, 3.270, 3.268, 3.267, 3.269, 3.266, 3.271, 3.264],
                highestCellVoltage: 3.271,
                lowestCellVoltage: 3.264,
                averageCellVoltage: 3.267,
                cellVoltageDifference: 0.050 // Should be 0.007
            };

            const result = validateAnalysisData(data, mockLog);

            expect(result.warnings.some(w => w.includes('Cell voltage difference mismatch'))).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        test('should handle null/undefined values gracefully', () => {
            const data = {
                stateOfCharge: null,
                overallVoltage: undefined,
                current: null,
                cellVoltages: null
            };

            const result = validateAnalysisData(data);

            // Should not crash
            expect(result).toBeDefined();
            expect(result.isValid).toBeDefined();
            expect(result.warnings).toBeDefined();
            expect(result.flags).toBeDefined();
        });

        test('should handle empty cellVoltages array', () => {
            const data = {
                stateOfCharge: 75,
                overallVoltage: 52.3,
                current: 0,
                cellVoltages: []
            };

            const result = validateAnalysisData(data);

            expect(result).toBeDefined();
            expect(result.isValid).toBe(true);
        });
    });
});
