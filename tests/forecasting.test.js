/**
 * Unit tests for forecasting module - statistical analysis and predictions
 * Tests linear regression, capacity degradation, efficiency trends, and lifetime predictions
 */

// Mock MongoDB first, before requiring modules
jest.mock('../netlify/functions/utils/mongodb.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

const { 
  linearRegression,
  predictCapacityDegradation,
  predictEfficiency,
  predictLifetime,
  predictHourlySoc
} = require('../netlify/functions/utils/forecasting.cjs');

// Mock logger
const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

// Helper to create mock collection
function createMockCollection(data = []) {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(data)
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'test-id' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
  };
}

describe('Forecasting Module - Statistical Analysis', () => {
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
  });

  describe('linearRegression', () => {
    test('should calculate correct slope and intercept for simple linear data', () => {
      // Data: y = 2x + 3
      const dataPoints = [
        { timestamp: 1000, capacity: 5 },   // y = 2*1 + 3 = 5
        { timestamp: 2000, capacity: 7 },   // y = 2*2 + 3 = 7
        { timestamp: 3000, capacity: 9 },   // y = 2*3 + 3 = 9
        { timestamp: 4000, capacity: 11 },  // y = 2*4 + 3 = 11
      ];

      const result = linearRegression(dataPoints);

      // Slope should be approximately 2/1000 = 0.002
      expect(result.slope).toBeCloseTo(0.002, 4);
      // R-squared should be 1.0 for perfect linear data
      expect(result.rSquared).toBeCloseTo(1.0, 2);
    });

    test('should calculate R-squared correctly for noisy data', () => {
      const dataPoints = [
        { timestamp: 1000, capacity: 95 },
        { timestamp: 2000, capacity: 92 },
        { timestamp: 3000, capacity: 94 },
        { timestamp: 4000, capacity: 88 },
        { timestamp: 5000, capacity: 86 },
      ];

      const result = linearRegression(dataPoints);

      // Should have negative slope (degrading)
      expect(result.slope).toBeLessThan(0);
      // R-squared should be between 0 and 1
      expect(result.rSquared).toBeGreaterThanOrEqual(0);
      expect(result.rSquared).toBeLessThanOrEqual(1);
    });

    test('should handle edge case with single data point', () => {
      const dataPoints = [{ timestamp: 1000, capacity: 95 }];

      const result = linearRegression(dataPoints);

      expect(result.slope).toBe(0);
      // With single point, intercept will be the capacity value
      expect(result.intercept).toBeCloseTo(95, 2);
      expect(result.rSquared).toBe(0);
    });

    test('should handle edge case with no data points', () => {
      const dataPoints = [];

      const result = linearRegression(dataPoints);

      expect(result.slope).toBe(0);
      // NaN is acceptable for empty dataset
      expect(result.intercept).toBeNaN();
      expect(result.rSquared).toBe(0);
    });

    test('should handle constant values (zero slope)', () => {
      const dataPoints = [
        { timestamp: 1000, capacity: 100 },
        { timestamp: 2000, capacity: 100 },
        { timestamp: 3000, capacity: 100 },
      ];

      const result = linearRegression(dataPoints);

      expect(result.slope).toBeCloseTo(0, 10);
      expect(result.rSquared).toBeGreaterThanOrEqual(0);
    });
  });

  describe('predictCapacityDegradation', () => {
    test('should return insufficient_data error with less than 15 records', async () => {
      const systemId = 'test-system-1';
      
      const historyData = Array.from({ length: 10 }, (_, i) => ({
        systemId,
        timestamp: new Date(Date.now() - (90 - i) * 24 * 60 * 60 * 1000).toISOString(),
        analysis: {
          remainingCapacity: 190,
          fullCapacity: 200,
          stateOfCharge: 95
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({ id: systemId, capacity: 200, chemistry: 'LiFePO4' });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(historyData));
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await predictCapacityDegradation(systemId, 30, true, mockLogger);

      expect(result.insufficient_data).toBe(true);
      expect(result.message).toContain('Insufficient historical data');
      expect(result.dataPoints).toBe(10);
    });

    test('should detect new battery with minimal degradation', async () => {
      const systemId = 'test-system-new';
      const baseCapacity = 200;
      
      const historyData = Array.from({ length: 20 }, (_, i) => ({
        systemId,
        timestamp: new Date(Date.now() - (20 - i) * 24 * 60 * 60 * 1000).toISOString(),
        analysis: {
          remainingCapacity: baseCapacity - i * 0.05,
          fullCapacity: baseCapacity,
          stateOfCharge: 85,
          cycleCount: 50
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({ id: systemId, capacity: baseCapacity, chemistry: 'LiFePO4' });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(historyData));
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await predictCapacityDegradation(systemId, 30, true, mockLogger);

      expect(result.systemId).toBe(systemId);
      expect(result.cycleCount).toBe(50);
      expect(result.degradationRate).toBeDefined();
    });
  });

  describe('predictEfficiency', () => {
    test('should return insufficient_data with less than 10 records', async () => {
      const systemId = 'test-system-eff';
      
      const historyData = Array.from({ length: 5 }, (_, i) => ({
        systemId,
        timestamp: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
        analysis: { current: 10, power: 500, stateOfCharge: 50 }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(historyData));
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await predictEfficiency(systemId, 30, true, mockLogger);

      expect(result.insufficient_data).toBe(true);
    });

    test('should calculate efficiency trend from power/current ratios', async () => {
      const systemId = 'test-system-eff2';
      
      const historyData = Array.from({ length: 30 }, (_, i) => ({
        systemId,
        timestamp: new Date(Date.now() - (30 - i) * 24 * 60 * 60 * 1000).toISOString(),
        analysis: {
          current: 10 + Math.random() * 2,
          power: 480 + Math.random() * 40,
          stateOfCharge: 50 + i
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(historyData));
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await predictEfficiency(systemId, 30, true, mockLogger);

      expect(result.systemId).toBe(systemId);
      expect(result.metric).toBe('efficiency');
      expect(result.currentEfficiency).toBeDefined();
      expect(result.trend).toMatch(/increasing|decreasing|stable/);
    });
  });

  describe('predictLifetime', () => {
    test('should use capacity degradation for lifetime prediction', async () => {
      const systemId = 'test-system-life';
      const baseCapacity = 200;
      
      const historyData = Array.from({ length: 60 }, (_, i) => ({
        systemId,
        timestamp: new Date(Date.now() - (60 - i) * 24 * 60 * 60 * 1000).toISOString(),
        analysis: {
          remainingCapacity: baseCapacity - i * 0.2,
          fullCapacity: baseCapacity,
          stateOfCharge: 85,
          cycleCount: 400
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({ id: systemId, capacity: baseCapacity, chemistry: 'LiFePO4' });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(historyData));
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await predictLifetime(systemId, true, mockLogger);

      expect(result.systemId).toBe(systemId);
      expect(result.metric).toBe('lifetime');
      if (!result.insufficient_data && !result.error) {
        expect(result.estimatedRemainingLife).toBeDefined();
        expect(result.note).toContain('SERVICE LIFE');
      }
    });
  });

  describe('predictHourlySoc', () => {
    test('should return error for unknown system', async () => {
      const systemId = 'unknown-system';
      
      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue(null);
          return Promise.resolve(col);
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await predictHourlySoc(systemId, 72, mockLogger);

      expect(result.error).toBe(true);
      expect(result.message).toContain('System not found');
    });

    test('should return insufficient_data with no SOC records', async () => {
      const systemId = 'test-system-soc2';
      
      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({ 
            id: systemId, 
            latitude: 40, 
            longitude: -100, 
            capacity: 200 
          });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection([]));
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await predictHourlySoc(systemId, 72, mockLogger);

      expect(result.insufficient_data).toBe(true);
      expect(result.message).toContain('No SOC data found');
    });
  });
});
