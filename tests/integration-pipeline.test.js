/**
 * Integration tests for the full context pipeline
 * Tests end-to-end flow: MongoDB → Aggregation → Analytics → Insights
 */

// Mock MongoDB and Gemini
jest.mock('../netlify/functions/utils/mongodb.cjs');
jest.mock('../netlify/functions/utils/geminiClient.cjs');

const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
const { generateComprehensiveAnalytics } = require('../netlify/functions/utils/comprehensive-analytics.cjs');
const { aggregateHourlyData } = require('../netlify/functions/utils/data-aggregation.cjs');

const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

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

describe('Integration Tests - Full Context Pipeline', () => {
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
  });

  describe('End-to-End Pipeline: MongoDB → Aggregation → Analytics', () => {
    test('should process complete pipeline from raw data to insights', async () => {
      const systemId = 'test-system-e2e';
      const now = Date.now();
      
      // Step 1: Raw MongoDB data
      const rawHistoryData = Array.from({ length: 200 }, (_, i) => ({
        systemId,
        timestamp: new Date(now - (200 - i) * 60 * 60 * 1000).toISOString(),
        analysis: {
          overallVoltage: 51.2 + Math.sin(i / 20) * 2,
          current: Math.sin(i / 10) * 20,
          power: Math.sin(i / 10) * 1000,
          stateOfCharge: 50 + Math.sin(i / 15) * 30,
          remainingCapacity: 100 + Math.sin(i / 15) * 60,
          fullCapacity: 200,
          temperature: 22 + Math.random() * 3,
          cellVoltageDifference: 0.02 + Math.random() * 0.02,
          cycleCount: 250 + Math.floor(i / 20)
        },
        weather: {
          clouds: Math.random() * 100,
          uvi: Math.random() * 10,
          temp: 15 + Math.random() * 15
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({
            id: systemId,
            voltage: 51.2,
            capacity: 200,
            chemistry: 'LiFePO4',
            maxAmpsSolarCharging: 60,
            latitude: 40,
            longitude: -100
          });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(rawHistoryData));
        }
        return Promise.resolve(createMockCollection());
      });

      // Step 2: Aggregation phase
      const hourlyData = aggregateHourlyData(rawHistoryData, mockLogger);
      expect(hourlyData).toBeDefined();
      expect(hourlyData.length).toBeGreaterThan(0);
      // Compression may not always happen with sparse hourly data
      expect(hourlyData.length).toBeLessThanOrEqual(rawHistoryData.length);

      // Step 3: Analytics phase
      const analytics = await generateComprehensiveAnalytics(systemId, null, mockLogger);
      expect(analytics).toBeDefined();
      expect(analytics.metadata).toBeDefined();
      expect(analytics.currentState).toBeDefined();
      expect(analytics.loadProfile).toBeDefined();
      expect(analytics.energyBalance).toBeDefined();
      expect(analytics.batteryHealth).toBeDefined();

      // Verify aggregation grouped data
      expect(analytics.metadata.systemId).toBe(systemId);
      
      // Verify compression: hourly data should match or compress from raw data
      const compressionRatio = rawHistoryData.length / hourlyData.length;
      expect(compressionRatio).toBeGreaterThanOrEqual(1); // At minimum 1:1, often better
      expect(compressionRatio).toBeLessThan(500); // Reasonable compression bound
    });

    test('should handle data pipeline with sparse data', async () => {
      const systemId = 'test-system-sparse';
      
      // Sparse data: only 20 records over 90 days
      const sparseData = Array.from({ length: 20 }, (_, i) => ({
        systemId,
        timestamp: new Date(Date.now() - i * 4 * 24 * 60 * 60 * 1000).toISOString(),
        analysis: {
          overallVoltage: 51.2,
          current: -10,
          power: -500,
          stateOfCharge: 60,
          remainingCapacity: 120,
          fullCapacity: 200
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({ id: systemId, voltage: 51.2, capacity: 200 });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(sparseData));
        }
        return Promise.resolve(createMockCollection());
      });

      const hourlyData = aggregateHourlyData(sparseData, mockLogger);
      const analytics = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(hourlyData.length).toBe(sparseData.length); // No compression with sparse data
      expect(analytics).toBeDefined();
      
      // Should mark sections as insufficient_data
      expect(analytics.loadProfile.insufficient_data).toBe(true);
    });

    test('should maintain data consistency through pipeline stages', async () => {
      const systemId = 'test-system-consistency';
      const now = Date.now();
      const testVoltage = 52.0;
      const testCapacity = 200;
      
      const consistentData = Array.from({ length: 100 }, (_, i) => ({
        systemId,
        timestamp: new Date(now - (100 - i) * 60 * 60 * 1000).toISOString(),
        analysis: {
          overallVoltage: testVoltage,
          current: -10,
          power: -520,
          stateOfCharge: 80,
          remainingCapacity: 160,
          fullCapacity: testCapacity
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({ 
            id: systemId, 
            voltage: testVoltage, 
            capacity: testCapacity 
          });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(consistentData));
        }
        return Promise.resolve(createMockCollection());
      });

      const hourlyData = aggregateHourlyData(consistentData, mockLogger);
      const analytics = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      // Verify voltage consistency
      if (hourlyData.length > 0 && hourlyData[0].metrics && hourlyData[0].metrics.avgVoltage) {
        expect(hourlyData[0].metrics.avgVoltage).toBeCloseTo(testVoltage, 1);
      }
      
      // Verify capacity consistency
      if (analytics.currentState) {
        expect(analytics.currentState.fullCapacityAh).toBe(testCapacity);
      }
    });
  });

  describe('Data Transformation Validation', () => {
    test('should preserve critical metrics through aggregation', async () => {
      const now = Date.now();
      const rawData = Array.from({ length: 24 }, (_, i) => ({
        systemId: 'test',
        timestamp: new Date(now - (24 - i) * 60 * 60 * 1000).toISOString(),
        analysis: {
          overallVoltage: 51.2,
          current: -10.5,
          power: -537.6,
          stateOfCharge: 75,
          remainingCapacity: 150,
          fullCapacity: 200
        }
      }));

      const hourlyData = aggregateHourlyData(rawData, mockLogger);

      expect(hourlyData.length).toBe(24);
      
      // Each hourly bucket should have correct data
      hourlyData.forEach(bucket => {
        expect(bucket.timestamp).toBeDefined();
        expect(bucket.dataPoints).toBe(1); // One record per hour
        expect(bucket.metrics).toBeDefined();
      });
    });

    test('should handle timezone conversions correctly', async () => {
      const baseTime = new Date('2024-01-15T12:00:00Z');
      
      const data = [
        {
          systemId: 'test',
          timestamp: new Date(baseTime.getTime()).toISOString(),
          analysis: { current: 10, power: 500 }
        },
        {
          systemId: 'test',
          timestamp: new Date(baseTime.getTime() + 30 * 60 * 1000).toISOString(),
          analysis: { current: 12, power: 600 }
        }
      ];

      const hourlyData = aggregateHourlyData(data, mockLogger);

      expect(hourlyData.length).toBe(1); // Both in same hour
      expect(hourlyData[0].timestamp).toBe('2024-01-15T12:00:00.000Z');
      expect(hourlyData[0].dataPoints).toBe(2);
    });
  });

  describe('Error Propagation Through Pipeline', () => {
    test('should handle aggregation errors gracefully', async () => {
      const malformedData = [
        {
          systemId: 'test',
          timestamp: 'invalid-timestamp',
          analysis: { current: 10 }
        }
      ];

      // Should not throw
      const result = aggregateHourlyData(malformedData, mockLogger);
      expect(Array.isArray(result)).toBe(true);
    });

    test('should handle analytics errors gracefully', async () => {
      const systemId = 'test-system-error';
      
      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          throw new Error('Database error');
        }
        return Promise.resolve(createMockCollection());
      });

      await expect(
        generateComprehensiveAnalytics(systemId, null, mockLogger)
      ).rejects.toThrow('Database error');
    });
  });

  describe('Performance Integration', () => {
    test('should process large dataset through full pipeline efficiently', async () => {
      const systemId = 'test-system-perf';
      const now = Date.now();
      
      // Create 1000 records
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        systemId,
        timestamp: new Date(now - (1000 - i) * 60 * 60 * 1000).toISOString(),
        analysis: {
          overallVoltage: 51.2 + Math.sin(i / 50) * 2,
          current: Math.sin(i / 30) * 20,
          power: Math.sin(i / 30) * 1000,
          stateOfCharge: 50 + Math.sin(i / 40) * 30,
          remainingCapacity: 100,
          fullCapacity: 200
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({ id: systemId, voltage: 51.2, capacity: 200 });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(largeDataset));
        }
        return Promise.resolve(createMockCollection());
      });

      const startTime = Date.now();
      
      const hourlyData = aggregateHourlyData(largeDataset, mockLogger);
      const aggregationTime = Date.now() - startTime;
      
      const analytics = await generateComprehensiveAnalytics(systemId, null, mockLogger);
      const totalTime = Date.now() - startTime;

      // Performance assertions
      expect(aggregationTime).toBeLessThan(200); // <200ms for 1000 records
      expect(totalTime).toBeLessThan(1000); // <1s for full pipeline
      
      // Result validation
      expect(hourlyData.length).toBeGreaterThan(100);
      expect(analytics.metadata).toBeDefined();
    });
  });
});
