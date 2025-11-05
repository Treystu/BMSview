/**
 * Tests for mandatory field extraction
 * Ensures all mandatory fields are properly extracted and have default values
 */

const { 
    mapExtractedToAnalysisData, 
    getResponseSchema 
} = require('../netlify/functions/utils/analysis-helpers.cjs');

describe('Extraction - Mandatory Fields', () => {
    // Mock logger that matches the actual logger interface
    const mockLog = (level, message, context) => {
        // No-op for tests
    };
    mockLog.debug = jest.fn();
    mockLog.info = jest.fn();
    mockLog.warn = jest.fn();
    mockLog.error = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('mapExtractedToAnalysisData', () => {
        it('should apply defaults for all mandatory fields when missing', () => {
            const extracted = {}; // Empty extraction
            const result = mapExtractedToAnalysisData(extracted, mockLog);

            // All mandatory fields should have default values
            expect(result.dlNumber).toBe('UNKNOWN');
            expect(result.stateOfCharge).toBe(0);
            expect(result.overallVoltage).toBe(0);
            expect(result.current).toBe(0);
            expect(result.remainingCapacity).toBe(0);
            expect(result.chargeMosOn).toBe(false);
            expect(result.dischargeMosOn).toBe(false);
            expect(result.balanceOn).toBe(false);
            expect(result.highestCellVoltage).toBe(0);
            expect(result.lowestCellVoltage).toBe(0);
            expect(result.averageCellVoltage).toBe(0);
            expect(result.cellVoltageDifference).toBe(0);
            expect(result.cycleCount).toBe(0);
            expect(result.power).toBe(0);
        });

        it('should preserve non-zero mandatory field values', () => {
            const extracted = {
                dlNumber: 'DL-12345',
                stateOfCharge: 85,
                overallVoltage: 52.4,
                current: -5.2,
                remainingCapacity: 100,
                chargeMosOn: true,
                dischargeMosOn: true,
                balanceOn: false,
                highestCellVoltage: 3.35,
                lowestCellVoltage: 3.30,
                averageCellVoltage: 3.32,
                cellVoltageDifference: 0.05,
                cycleCount: 123,
                power: -271.48
            };

            const result = mapExtractedToAnalysisData(extracted, mockLog);

            expect(result.dlNumber).toBe('DL-12345');
            expect(result.stateOfCharge).toBe(85);
            expect(result.overallVoltage).toBe(52.4);
            expect(result.current).toBe(-5.2);
            expect(result.remainingCapacity).toBe(100);
            expect(result.chargeMosOn).toBe(true);
            expect(result.dischargeMosOn).toBe(true);
            expect(result.balanceOn).toBe(false);
            expect(result.highestCellVoltage).toBe(3.35);
            expect(result.lowestCellVoltage).toBe(3.30);
            expect(result.averageCellVoltage).toBe(3.32);
            expect(result.cellVoltageDifference).toBe(0.05);
            expect(result.cycleCount).toBe(123);
            expect(result.power).toBe(-271.48);
        });

        it('should calculate power if missing but current and voltage present', () => {
            const extracted = {
                overallVoltage: 52.4,
                current: -5.0,
                power: 0
            };

            const result = mapExtractedToAnalysisData(extracted, mockLog);

            expect(result.power).toBe(-262); // 52.4 * -5.0
        });

        it('should auto-correct positive power when current is negative', () => {
            const extracted = {
                current: -5.0,
                power: 250 // Wrong sign!
            };

            const result = mapExtractedToAnalysisData(extracted, mockLog);

            expect(result.power).toBe(-250); // Corrected
        });

        it('should calculate cell voltage stats from cellVoltages array', () => {
            const extracted = {
                cellVoltages: [3.30, 3.32, 3.35, 3.31, 3.33, 3.34, 3.32, 3.33, 3.31, 3.34, 3.35, 3.30, 3.32, 3.33, 3.31, 3.34],
                highestCellVoltage: 0,
                lowestCellVoltage: 0,
                averageCellVoltage: 0,
                cellVoltageDifference: 0
            };

            const result = mapExtractedToAnalysisData(extracted, mockLog);

            expect(result.highestCellVoltage).toBe(3.35);
            expect(result.lowestCellVoltage).toBe(3.30);
            expect(result.averageCellVoltage).toBeCloseTo(3.323, 2);
            expect(result.cellVoltageDifference).toBeCloseTo(0.05, 2);
        });

        it('should convert mV to V for cellVoltageDifference', () => {
            const extracted = {
                cellVoltageDifference: 50 // mV, should be converted to V
            };

            const result = mapExtractedToAnalysisData(extracted, mockLog);

            expect(result.cellVoltageDifference).toBe(0.05); // Converted to V
        });

        it('should handle null values by applying defaults', () => {
            const extracted = {
                dlNumber: null,
                stateOfCharge: null,
                current: null,
                power: null
            };

            const result = mapExtractedToAnalysisData(extracted, mockLog);

            expect(result.dlNumber).toBe('UNKNOWN');
            expect(result.stateOfCharge).toBe(0);
            expect(result.current).toBe(0);
            expect(result.power).toBe(0);
        });

        it('should handle undefined values by applying defaults', () => {
            const extracted = {
                dlNumber: undefined,
                stateOfCharge: undefined,
                cycleCount: undefined
            };

            const result = mapExtractedToAnalysisData(extracted, mockLog);

            expect(result.dlNumber).toBe('UNKNOWN');
            expect(result.stateOfCharge).toBe(0);
            expect(result.cycleCount).toBe(0);
        });
    });

    describe('getResponseSchema', () => {
        it('should include all mandatory fields in schema', () => {
            const schema = getResponseSchema();
            
            const mandatoryFields = [
                'dlNumber', 'stateOfCharge', 'overallVoltage', 'current',
                'remainingCapacity', 'chargeMosOn', 'dischargeMosOn', 'balanceOn',
                'highestCellVoltage', 'lowestCellVoltage', 'averageCellVoltage',
                'cellVoltageDifference', 'cycleCount', 'power'
            ];

            mandatoryFields.forEach(field => {
                expect(schema.properties[field]).toBeDefined();
            });
        });

        it('should mark mandatory fields as required', () => {
            const schema = getResponseSchema();
            
            const mandatoryFields = [
                'dlNumber', 'stateOfCharge', 'overallVoltage', 'current',
                'remainingCapacity', 'chargeMosOn', 'dischargeMosOn', 'balanceOn',
                'highestCellVoltage', 'lowestCellVoltage', 'averageCellVoltage',
                'cellVoltageDifference', 'cycleCount', 'power'
            ];

            expect(schema.required).toBeDefined();
            mandatoryFields.forEach(field => {
                expect(schema.required).toContain(field);
            });
        });

        it('should set nullable=false for mandatory fields', () => {
            const schema = getResponseSchema();
            
            expect(schema.properties.dlNumber.nullable).toBe(false);
            expect(schema.properties.stateOfCharge.nullable).toBe(false);
            expect(schema.properties.overallVoltage.nullable).toBe(false);
            expect(schema.properties.current.nullable).toBe(false);
            expect(schema.properties.power.nullable).toBe(false);
        });

        it('should allow nullable for optional fields', () => {
            const schema = getResponseSchema();
            
            expect(schema.properties.timestampFromImage.nullable).toBe(true);
            expect(schema.properties.fullCapacity.nullable).toBe(true);
            expect(schema.properties.mosTemperature.nullable).toBe(true);
        });
    });
});
