/**
 * Unit tests for data merge utilities
 * Tests the mergeBmsAndCloudData and downsampleMergedData functions
 */

const { mergeBmsAndCloudData, downsampleMergedData, linearInterpolate } = require('../netlify/functions/utils/data-merge.cjs');

// Mock MongoDB getCollection
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn()
}));

const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

// Mock logger
const createMockLogger = () => {
  const mockLog = jest.fn();
  mockLog.info = jest.fn();
  mockLog.debug = jest.fn();
  mockLog.warn = jest.fn();
  mockLog.error = jest.fn();
  return mockLog;
};

describe('Data Merge Utilities', () => {
  let mockLog;
  let mockHistoryCollection;
  let mockHourlyWeatherCollection;

  beforeEach(() => {
    mockLog = createMockLogger();
    
    // Create mock collections
    mockHistoryCollection = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn()
    };

    mockHourlyWeatherCollection = {
      find: jest.fn().mockReturnThis(),
      toArray: jest.fn()
    };

    // Setup getCollection to return appropriate mocks
    getCollection.mockImplementation((collectionName) => {
      if (collectionName === 'history') {
        return Promise.resolve(mockHistoryCollection);
      } else if (collectionName === 'hourly-weather') {
        return Promise.resolve(mockHourlyWeatherCollection);
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('linearInterpolate', () => {
    test('should correctly interpolate between two values', () => {
      const result = linearInterpolate(0, 100, 0, 1000, 500);
      expect(result).toBe(50);
    });

    test('should handle edge case when t === t0', () => {
      const result = linearInterpolate(10, 20, 100, 200, 100);
      expect(result).toBe(10);
    });

    test('should handle edge case when t === t1', () => {
      const result = linearInterpolate(10, 20, 100, 200, 200);
      expect(result).toBe(20);
    });

    test('should handle same timestamp (t0 === t1)', () => {
      const result = linearInterpolate(10, 20, 100, 100, 100);
      expect(result).toBe(10);
    });
  });

  describe('mergeBmsAndCloudData', () => {
    test('should merge BMS and cloud data correctly', async () => {
      const systemId = 'test-system-1';
      const startDate = '2024-01-01T00:00:00.000Z';
      const endDate = '2024-01-01T12:00:00.000Z';

      // Mock BMS data (2 records)
      const bmsRecords = [
        {
          id: 'bms-1',
          timestamp: '2024-01-01T06:00:00.000Z',
          fileName: 'test1.jpg',
          systemId: systemId,
          analysis: {
            stateOfCharge: 75,
            overallVoltage: 52.3,
            current: -5.0,
            power: -261.5,
            temperature: 25
          },
          weather: {
            clouds: 50,
            uvi: 3,
            temp: 20
          }
        },
        {
          id: 'bms-2',
          timestamp: '2024-01-01T10:00:00.000Z',
          fileName: 'test2.jpg',
          systemId: systemId,
          analysis: {
            stateOfCharge: 65,
            overallVoltage: 51.8,
            current: -3.0,
            power: -155.4,
            temperature: 26
          },
          weather: {
            clouds: 30,
            uvi: 5,
            temp: 22
          }
        }
      ];

      // Mock cloud hourly data (3 points at 6am, 8am, 10am)
      const cloudDocs = [
        {
          systemId: systemId,
          date: '2024-01-01',
          hourlyData: [
            {
              timestamp: '2024-01-01T06:00:00.000Z',
              clouds: 50,
              temp: 20,
              uvi: 3
            },
            {
              timestamp: '2024-01-01T08:00:00.000Z',
              clouds: 40,
              temp: 21,
              uvi: 4
            },
            {
              timestamp: '2024-01-01T10:00:00.000Z',
              clouds: 30,
              temp: 22,
              uvi: 5
            }
          ]
        }
      ];

      mockHistoryCollection.toArray.mockResolvedValue(bmsRecords);
      mockHourlyWeatherCollection.toArray.mockResolvedValue(cloudDocs);

      const result = await mergeBmsAndCloudData(systemId, startDate, endDate, mockLog);

      // Should have 3 points total: 2 BMS (6am, 10am) + 1 estimated (8am)
      expect(result.length).toBe(3);

      // Verify BMS points are present
      const bmsPoints = result.filter(p => p.source === 'bms');
      expect(bmsPoints.length).toBe(2);
      expect(bmsPoints[0].timestamp).toBe('2024-01-01T06:00:00.000Z');
      expect(bmsPoints[0].data.stateOfCharge).toBe(75);

      // Verify estimated point at 8am
      const estimatedPoints = result.filter(p => p.source === 'estimated');
      expect(estimatedPoints.length).toBe(1);
      expect(estimatedPoints[0].timestamp).toBe('2024-01-01T08:00:00.000Z');
      
      // Check interpolation - SOC should be between 75 and 65
      expect(estimatedPoints[0].data.stateOfCharge).toBeGreaterThan(64);
      expect(estimatedPoints[0].data.stateOfCharge).toBeLessThan(76);
      expect(estimatedPoints[0].data.stateOfCharge).toBeCloseTo(70, 0); // Should be ~70
    });

    test('should prioritize BMS data over cloud data at same timestamp', async () => {
      const systemId = 'test-system-1';
      const startDate = '2024-01-01T00:00:00.000Z';
      const endDate = '2024-01-01T12:00:00.000Z';

      // BMS record at 6am
      const bmsRecords = [
        {
          id: 'bms-1',
          timestamp: '2024-01-01T06:00:00.000Z',
          fileName: 'test1.jpg',
          systemId: systemId,
          analysis: {
            stateOfCharge: 75,
            overallVoltage: 52.3
          },
          weather: {
            clouds: 50 // BMS has cloud data from its analysis
          }
        }
      ];

      // Cloud also has data at 6am with different cloud value
      const cloudDocs = [
        {
          systemId: systemId,
          date: '2024-01-01',
          hourlyData: [
            {
              timestamp: '2024-01-01T06:00:00.000Z',
              clouds: 60, // Cloud hourly data provides updated weather
              temp: 20,
              uvi: 3
            }
          ]
        }
      ];

      mockHistoryCollection.toArray.mockResolvedValue(bmsRecords);
      mockHourlyWeatherCollection.toArray.mockResolvedValue(cloudDocs);

      const result = await mergeBmsAndCloudData(systemId, startDate, endDate, mockLog);

      expect(result.length).toBe(1);
      expect(result[0].source).toBe('bms');
      
      // BMS point remains, but cloud weather data is merged in (cloud data preferred for weather metrics)
      expect(result[0].data.clouds).toBe(60); // Cloud weather data merged in
      expect(result[0].data.stateOfCharge).toBe(75); // BMS data preserved
    });

    test('should handle case with only BMS data', async () => {
      const systemId = 'test-system-1';
      const startDate = '2024-01-01T00:00:00.000Z';
      const endDate = '2024-01-01T12:00:00.000Z';

      const bmsRecords = [
        {
          id: 'bms-1',
          timestamp: '2024-01-01T06:00:00.000Z',
          fileName: 'test1.jpg',
          systemId: systemId,
          analysis: {
            stateOfCharge: 75
          },
          weather: {
            clouds: 50
          }
        }
      ];

      mockHistoryCollection.toArray.mockResolvedValue(bmsRecords);
      mockHourlyWeatherCollection.toArray.mockResolvedValue([]); // No cloud data

      const result = await mergeBmsAndCloudData(systemId, startDate, endDate, mockLog);

      expect(result.length).toBe(1);
      expect(result[0].source).toBe('bms');
    });

    test('should handle case with only cloud data', async () => {
      const systemId = 'test-system-1';
      const startDate = '2024-01-01T00:00:00.000Z';
      const endDate = '2024-01-01T12:00:00.000Z';

      mockHistoryCollection.toArray.mockResolvedValue([]); // No BMS data

      const cloudDocs = [
        {
          systemId: systemId,
          date: '2024-01-01',
          hourlyData: [
            {
              timestamp: '2024-01-01T08:00:00.000Z',
              clouds: 40,
              temp: 21,
              uvi: 4
            }
          ]
        }
      ];

      mockHourlyWeatherCollection.toArray.mockResolvedValue(cloudDocs);

      const result = await mergeBmsAndCloudData(systemId, startDate, endDate, mockLog);

      expect(result.length).toBe(1);
      expect(result[0].source).toBe('cloud');
      expect(result[0].data.clouds).toBe(40);
    });
  });

  describe('downsampleMergedData', () => {
    test('should not downsample when under threshold', () => {
      const points = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(2024, 0, 1, i).toISOString(),
        source: 'bms',
        data: { stateOfCharge: 75 + i * 0.1 }
      }));

      const result = downsampleMergedData(points, 2000, mockLog);

      expect(result.length).toBe(100);
      expect(result).toBe(points); // Same array reference
    });

    test('should downsample with min/max/avg when over threshold', () => {
      const points = Array.from({ length: 4000 }, (_, i) => ({
        timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
        source: 'bms',
        data: {
          stateOfCharge: 50 + (i % 10), // Values from 50 to 59
          overallVoltage: 51.0 + (i % 5) * 0.1
        }
      }));

      const result = downsampleMergedData(points, 2000, mockLog);

      expect(result.length).toBeLessThanOrEqual(2000);
      expect(result.length).toBeGreaterThan(0);

      // Check that aggregated data includes min/max/avg
      const firstBucket = result[0];
      expect(firstBucket).toHaveProperty('data');
      expect(firstBucket.data).toHaveProperty('stateOfCharge_min');
      expect(firstBucket.data).toHaveProperty('stateOfCharge_max');
      expect(firstBucket.data).toHaveProperty('stateOfCharge_avg');
      
      // Verify min/max make sense
      expect(firstBucket.data.stateOfCharge_min).toBeLessThanOrEqual(firstBucket.data.stateOfCharge_max);
    });

    test('should preserve dataPoints count in buckets', () => {
      const points = Array.from({ length: 3000 }, (_, i) => ({
        timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
        source: 'bms',
        data: { stateOfCharge: 75 }
      }));

      const result = downsampleMergedData(points, 1000, mockLog);

      expect(result.length).toBeLessThanOrEqual(1000);
      
      // Sum of dataPoints should equal original count
      const totalDataPoints = result.reduce((sum, bucket) => sum + (bucket.dataPoints || 0), 0);
      expect(totalDataPoints).toBe(3000);
    });
  });
});
