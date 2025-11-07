/**
 * Tests for insights-summary utility
 */

const {
  generateInitialSummary,
  extractCurrentSnapshot,
  calculateDailyStats,
  calculateChargingStats
} = require('../netlify/functions/utils/insights-summary.cjs');

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn()
}));

const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

// Mock logger
const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('Insights Summary Utility', () => {
  describe('extractCurrentSnapshot', () => {
    it('should extract current battery snapshot', () => {
      const analysisData = {
        overallVoltage: 24.5,
        current: 5.2,
        power: 127.4,
        stateOfCharge: 85,
        remainingCapacity: 170,
        fullCapacity: 200,
        temperature: 25,
        cellVoltages: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
        cellVoltageDifference: 0.02
      };

      const snapshot = extractCurrentSnapshot(analysisData);

      expect(snapshot).toEqual({
        voltage: 24.5,
        current: 5.2,
        power: 127.4,
        soc: 85,
        capacity: 170,
        fullCapacity: 200,
        temperature: 25,
        cellCount: 7,
        cellVoltageDiff: 0.02,
        isCharging: true,
        isDischarging: false
      });
    });

    it('should identify discharging state', () => {
      const analysisData = {
        overallVoltage: 24.0,
        current: -3.5,
        stateOfCharge: 60,
        cellVoltages: []
      };

      const snapshot = extractCurrentSnapshot(analysisData);

      expect(snapshot.isCharging).toBe(false);
      expect(snapshot.isDischarging).toBe(true);
    });

    it('should handle null values', () => {
      const analysisData = {
        overallVoltage: null,
        current: null,
        cellVoltages: null
      };

      const snapshot = extractCurrentSnapshot(analysisData);

      expect(snapshot.voltage).toBeNull();
      expect(snapshot.current).toBeNull();
      expect(snapshot.cellCount).toBe(0);
    });
  });

  describe('calculateDailyStats', () => {
    it('should calculate daily statistics from records', () => {
      const records = [
        {
          timestamp: '2025-11-06T10:00:00Z',
          analysis: {
            overallVoltage: 24.5,
            current: 5.0,
            stateOfCharge: 80,
            power: 122.5
          }
        },
        {
          timestamp: '2025-11-06T14:00:00Z',
          analysis: {
            overallVoltage: 24.8,
            current: 3.0,
            stateOfCharge: 85,
            power: 74.4
          }
        },
        {
          timestamp: '2025-11-07T10:00:00Z',
          analysis: {
            overallVoltage: 24.2,
            current: -2.0,
            stateOfCharge: 75,
            power: -48.4
          }
        }
      ];

      const stats = calculateDailyStats(records);

      expect(stats).toHaveLength(2); // 2 different days
      expect(stats[0].date).toBe('2025-11-06');
      expect(stats[0].dataPoints).toBe(2);
      expect(stats[0].avgVoltage).toBeCloseTo(24.65, 1);
      expect(stats[0].avgCurrent).toBeCloseTo(4.0, 1);
      expect(stats[1].date).toBe('2025-11-07');
      expect(stats[1].dataPoints).toBe(1);
    });

    it('should handle empty records', () => {
      const stats = calculateDailyStats([]);
      expect(stats).toEqual([]);
    });
  });

  describe('calculateChargingStats', () => {
    it('should calculate charging/discharging statistics', () => {
      const records = [
        { analysis: { current: 5.0, power: 120 } },  // Charging
        { analysis: { current: 4.5, power: 110 } },  // Charging
        { analysis: { current: -3.0, power: -72 } }, // Discharging
        { analysis: { current: -2.5, power: -60 } }, // Discharging
        { analysis: { current: 0.1, power: 2 } }     // Idle
      ];

      const stats = calculateChargingStats(records);

      expect(stats.chargingDataPoints).toBe(2);
      expect(stats.dischargingDataPoints).toBe(2);
      expect(stats.idleDataPoints).toBe(1);
      expect(stats.avgChargingCurrent).toBeCloseTo(4.75, 1);
      expect(stats.avgDischargingCurrent).toBeCloseTo(2.75, 1);
      expect(stats.totalRecords).toBe(5);
    });

    it('should handle records with null current', () => {
      const records = [
        { analysis: { current: null } },
        { analysis: { current: 5.0, power: 120 } }
      ];

      const stats = calculateChargingStats(records);

      expect(stats.chargingDataPoints).toBe(1);
      expect(stats.totalRecords).toBe(2);
    });
  });

  describe('generateInitialSummary', () => {
    let mockCollection;

    beforeEach(() => {
      jest.clearAllMocks();
      
      mockCollection = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        toArray: jest.fn()
      };
      
      getCollection.mockResolvedValue(mockCollection);
    });

    it('should generate summary with current snapshot only', async () => {
      const analysisData = {
        overallVoltage: 24.5,
        current: 5.0,
        stateOfCharge: 80
      };

      const summary = await generateInitialSummary(analysisData, null, mockLog);

      expect(summary.current).toBeDefined();
      expect(summary.current.voltage).toBe(24.5);
      expect(summary.historical).toBeNull();
      expect(summary.generated).toBeDefined();
    });

    it('should generate summary with historical data', async () => {
      const analysisData = {
        overallVoltage: 24.5,
        current: 5.0,
        stateOfCharge: 80
      };

      mockCollection.toArray.mockResolvedValue([
        {
          timestamp: '2025-11-06T10:00:00Z',
          analysis: { overallVoltage: 24.5, current: 5.0, stateOfCharge: 80 }
        },
        {
          timestamp: '2025-11-07T10:00:00Z',
          analysis: { overallVoltage: 24.2, current: -2.0, stateOfCharge: 75 }
        }
      ]);

      const summary = await generateInitialSummary(analysisData, 'sys-123', mockLog);

      expect(summary.current).toBeDefined();
      expect(summary.historical).toBeDefined();
      expect(summary.historical.recordCount).toBe(2);
      expect(summary.historical.daily).toHaveLength(2);
      expect(summary.historical.charging).toBeDefined();
    });

    it('should handle errors in historical data retrieval', async () => {
      const analysisData = {
        overallVoltage: 24.5,
        current: 5.0,
        stateOfCharge: 80
      };

      mockCollection.toArray.mockRejectedValue(new Error('DB error'));

      const summary = await generateInitialSummary(analysisData, 'sys-123', mockLog);

      expect(summary.current).toBeDefined();
      expect(summary.historical).toBeNull();
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });
});
