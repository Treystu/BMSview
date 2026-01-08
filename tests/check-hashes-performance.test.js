/**
 * Tests for optimized check-hashes endpoint performance and logging
 */

const checkHashesHandler = require('../netlify/functions/check-hashes.cjs').handler;

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn()
}));

// Mock logger
jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLoggerFromEvent: jest.fn(() => ({
    entry: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    exit: jest.fn()
  })),
  createTimer: jest.fn(() => ({
    end: jest.fn(() => 100) // Mock 100ms duration
  }))
}));

// Mock CORS headers
jest.mock('../netlify/functions/utils/cors.cjs', () => ({
  getCorsHeaders: jest.fn(() => ({ 'Access-Control-Allow-Origin': '*' }))
}));

// Mock error response
jest.mock('../netlify/functions/utils/errors.cjs', () => ({
  errorResponse: jest.fn((statusCode, code, message, details, headers) => ({
    statusCode,
    headers,
    body: JSON.stringify({ error: code, message, details })
  }))
}));

const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
const { createLoggerFromEvent } = require('../netlify/functions/utils/logger.cjs');

describe('check-hashes endpoint performance optimizations', () => {
  let mockCollection;
  let mockLog;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLog = {
      entry: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      exit: jest.fn()
    };
    
    createLoggerFromEvent.mockReturnValue(mockLog);
    
    mockCollection = {
      find: jest.fn(() => ({
        toArray: jest.fn()
      }))
    };
    
    getCollection.mockResolvedValue(mockCollection);
  });

  describe('Optimized projection', () => {
    it('should use specific field projection instead of fetching all analysis data', async () => {
      const hashes = ['hash1', 'hash2'];
      
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([])
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ hashes }),
        headers: {}
      };

      await checkHashesHandler(event, {});

      // Verify find was called with optimized projection
      const findCall = mockCollection.find.mock.calls[0];
      expect(findCall[1]).toHaveProperty('projection');
      
      // Should project specific fields, not entire analysis object
      const projection = findCall[1].projection;
      // FIX: 'history' collection uses 'analysisKey' not 'contentHash'
      expect(projection).toHaveProperty('analysisKey', 1);
      expect(projection).toHaveProperty('_id', 1);
      
      // Should project critical analysis fields individually (note: MongoDB uses quoted keys for nested paths)
      expect(projection['analysis.dlNumber']).toBe(1);
      expect(projection['analysis.stateOfCharge']).toBe(1);
      expect(projection['analysis.overallVoltage']).toBe(1);
    });
  });

  describe('Performance logging', () => {
    it('should log timing metrics for query and processing', async () => {
      const hashes = ['hash1', 'hash2', 'hash3'];
      
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: 'id1',
            analysisKey: 'hash1',
            analysis: {
              dlNumber: 'DL001',
              stateOfCharge: 85,
              overallVoltage: 51.2,
              current: 10,
              remainingCapacity: 200,
              chargeMosOn: true,
              dischargeMosOn: true,
              balanceOn: false,
              highestCellVoltage: 3.4,
              lowestCellVoltage: 3.35,
              averageCellVoltage: 3.375,
              cellVoltageDifference: 0.05,
              cycleCount: 50,
              power: 512
            }
          }
        ])
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ hashes }),
        headers: {}
      };

      await checkHashesHandler(event, {});

      // Verify performance logging
      const logCalls = mockLog.info.mock.calls;
      
      // Should log query start
      expect(logCalls.some(call => 
        call[0].includes('query') && call[1]?.event === 'QUERY_START'
      )).toBe(true);
      
      // Should log query completion with timing
      const queryCompleteLog = logCalls.find(call => 
        call[1]?.event === 'QUERY_COMPLETE'
      );
      expect(queryCompleteLog).toBeDefined();
      expect(queryCompleteLog[1]).toHaveProperty('queryDurationMs');
      expect(queryCompleteLog[1]).toHaveProperty('avgPerHash');
      
      // Should log final completion with all timing metrics
      const completeLog = logCalls.find(call => 
        call[1]?.event === 'COMPLETE'
      );
      expect(completeLog).toBeDefined();
      expect(completeLog[1]).toHaveProperty('queryDurationMs');
      expect(completeLog[1]).toHaveProperty('processingDurationMs');
      expect(completeLog[1]).toHaveProperty('totalDurationMs');
      expect(completeLog[1]).toHaveProperty('avgPerHash');
    });

    it('should log per-file results at debug level', async () => {
      const hashes = ['hash1', 'hash2'];
      
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: 'id1',
            analysisKey: 'hash1',
            analysis: {
              dlNumber: 'DL001',
              stateOfCharge: 85,
              // ... all critical fields present
              overallVoltage: 51.2,
              current: 10,
              remainingCapacity: 200,
              chargeMosOn: true,
              dischargeMosOn: true,
              balanceOn: false,
              highestCellVoltage: 3.4,
              lowestCellVoltage: 3.35,
              averageCellVoltage: 3.375,
              cellVoltageDifference: 0.05,
              cycleCount: 50,
              power: 512
            }
          },
          {
            _id: 'id2',
            analysisKey: 'hash2',
            analysis: {
              dlNumber: 'DL002',
              // Missing some critical fields
              stateOfCharge: 90
            }
          }
        ])
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ hashes }),
        headers: {}
      };

      await checkHashesHandler(event, {});

      // Should log duplicate detection at debug level
      expect(mockLog.debug).toHaveBeenCalled();
      
      // Should log at least one duplicate
      const duplicateLog = mockLog.debug.mock.calls.find(call => 
        call[0].includes('Duplicate detected')
      );
      expect(duplicateLog).toBeDefined();
      
      // Should log at least one upgrade needed
      const upgradeLog = mockLog.debug.mock.calls.find(call => 
        call[0].includes('Upgrade needed')
      );
      expect(upgradeLog).toBeDefined();
      expect(upgradeLog[1]).toHaveProperty('missingFields');
    });
  });

  describe('Critical field checking optimization', () => {
    it('should efficiently check critical fields using direct property access', async () => {
      const hashes = ['hash1'];
      
      const recordWithAllFields = {
        _id: 'id1',
        analysisKey: 'hash1',
        analysis: {
          dlNumber: 'DL001',
          stateOfCharge: 85,
          overallVoltage: 51.2,
          current: 10,
          remainingCapacity: 200,
          chargeMosOn: true,
          dischargeMosOn: true,
          balanceOn: false,
          highestCellVoltage: 3.4,
          lowestCellVoltage: 3.35,
          averageCellVoltage: 3.375,
          cellVoltageDifference: 0.05,
          cycleCount: 50,
          power: 512
        }
      };
      
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([recordWithAllFields])
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ hashes }),
        headers: {}
      };

      const result = await checkHashesHandler(event, {});
      const body = JSON.parse(result.body);

      // Should detect as complete duplicate
      expect(body.duplicates).toHaveLength(1);
      expect(body.duplicates[0].hash).toBe('hash1');
      expect(body.upgrades).toHaveLength(0);
    });

    it('should correctly identify missing fields for upgrades', async () => {
      const hashes = ['hash1'];
      
      const recordMissingFields = {
        _id: 'id1',
        analysisKey: 'hash1',
        analysis: {
          dlNumber: 'DL001',
          stateOfCharge: 85,
          overallVoltage: 51.2
          // Missing most critical fields
        }
      };
      
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([recordMissingFields])
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ hashes }),
        headers: {}
      };

      const result = await checkHashesHandler(event, {});
      const body = JSON.parse(result.body);

      // Should detect as needing upgrade
      expect(body.duplicates).toHaveLength(0);
      expect(body.upgrades).toHaveLength(1);
      expect(body.upgrades[0]).toBe('hash1');
    });
  });

  describe('Batch processing', () => {
    it('should handle large batches efficiently', async () => {
      // Create 100 hashes
      const hashes = Array.from({ length: 100 }, (_, i) => `hash${i}`);
      
      // Create 50 records with all fields and 25 needing upgrade
      const records = Array.from({ length: 75 }, (_, i) => ({
        _id: `id${i}`,
        analysisKey: `hash${i}`,
        analysis: i < 50 ? {
          dlNumber: `DL${i}`,
          stateOfCharge: 85,
          overallVoltage: 51.2,
          current: 10,
          remainingCapacity: 200,
          chargeMosOn: true,
          dischargeMosOn: true,
          balanceOn: false,
          highestCellVoltage: 3.4,
          lowestCellVoltage: 3.35,
          averageCellVoltage: 3.375,
          cellVoltageDifference: 0.05,
          cycleCount: 50,
          power: 512
        } : {
          dlNumber: `DL${i}`,
          stateOfCharge: 85
          // Missing critical fields
        }
      }));
      
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(records)
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ hashes }),
        headers: {}
      };

      const result = await checkHashesHandler(event, {});
      const body = JSON.parse(result.body);

      // Should correctly categorize all
      expect(body.duplicates).toHaveLength(50); // 50 complete
      expect(body.upgrades).toHaveLength(25); // 25 need upgrade
      // Remaining 25 are new files (not in response)
      
      // Should log performance metrics
      const completeLog = mockLog.info.mock.calls.find(call => 
        call[1]?.event === 'COMPLETE'
      );
      expect(completeLog).toBeDefined();
      expect(completeLog[1].hashesChecked).toBe(100);
      expect(completeLog[1].duplicatesFound).toBe(50);
      expect(completeLog[1].upgradesNeeded).toBe(25);
      expect(completeLog[1].newFiles).toBe(25);
    });
  });

  describe('Error handling', () => {
    it('should log errors with timing context', async () => {
      const hashes = ['hash1'];
      
      mockCollection.find.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ hashes }),
        headers: {}
      };

      const result = await checkHashesHandler(event, {});

      expect(result.statusCode).toBe(500);
      expect(mockLog.error).toHaveBeenCalledWith(
        'Error checking hashes',
        expect.objectContaining({
          error: expect.stringContaining('Database connection failed')
        })
      );
    });
  });
});
