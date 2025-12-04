/**
 * Test duplicate detection accuracy
 * Verifies that duplicates with good data are NOT re-analyzed
 */

const { describe, it, expect, jest, beforeEach } = require('@jest/globals');

// Mock dependencies
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

const mockCollection = {
  findOne: jest.fn(),
  find: jest.fn(),
  indexes: jest.fn(),
  countDocuments: jest.fn()
};

const mockGetCollection = jest.fn().mockResolvedValue(mockCollection);

jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: (...args) => mockGetCollection(...args)
}));

jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLogger: () => mockLogger
}));

describe('Duplicate Detection Accuracy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkExistingAnalysis logic', () => {
    it('should return existing record with all critical fields and score >= 80%', async () => {
      const mockExisting = {
        _id: 'test-id-123',
        contentHash: 'abc123hash',
        fileName: 'test.png',
        timestamp: '2024-01-01T00:00:00Z',
        validationScore: 95,
        extractionAttempts: 1,
        analysis: {
          dlNumber: 'DL001',
          stateOfCharge: 85,
          overallVoltage: 51.2,
          current: 5.5,
          remainingCapacity: 200,
          chargeMosOn: true,
          dischargeMosOn: true,
          balanceOn: false,
          highestCellVoltage: 3.45,
          lowestCellVoltage: 3.40,
          averageCellVoltage: 3.42,
          cellVoltageDifference: 0.05,
          cycleCount: 100,
          power: 281.6
        }
      };

      mockCollection.findOne.mockResolvedValue(mockExisting);
      mockCollection.indexes.mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'contentHash_1', key: { contentHash: 1 }, unique: true, sparse: true }
      ]);

      // Import the function to test
      const { handler } = require('../netlify/functions/analyze.cjs');
      
      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({
          image: {
            image: 'base64imagedata',
            mimeType: 'image/png',
            fileName: 'test.png'
          }
        }),
        queryStringParameters: {
          sync: 'true',
          check: 'true'
        }
      };

      const context = { awsRequestId: 'test-request-123' };
      
      const result = await handler(event, context);
      
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      // Should return as duplicate without upgrade
      expect(body.isDuplicate).toBe(true);
      expect(body.needsUpgrade).toBe(false);
      expect(body.recordId).toBe('test-id-123');
      
      // Should NOT have called analysis pipeline
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('high-quality duplicate'),
        expect.objectContaining({
          event: 'HIGH_QUALITY_DUPLICATE',
          decision: 'RETURN_EXISTING'
        })
      );
    });

    it('should flag for upgrade if validation score < 80%', async () => {
      const mockExisting = {
        _id: 'test-id-456',
        contentHash: 'def456hash',
        fileName: 'test2.png',
        validationScore: 75, // Below 80% threshold
        extractionAttempts: 1,
        analysis: {
          dlNumber: 'DL002',
          stateOfCharge: 90,
          overallVoltage: 52.0,
          current: 3.0,
          remainingCapacity: 220,
          chargeMosOn: true,
          dischargeMosOn: true,
          balanceOn: true,
          highestCellVoltage: 3.50,
          lowestCellVoltage: 3.48,
          averageCellVoltage: 3.49,
          cellVoltageDifference: 0.02,
          cycleCount: 50,
          power: 156.0
        }
      };

      mockCollection.findOne.mockResolvedValue(mockExisting);
      mockCollection.indexes.mockResolvedValue([
        { name: 'contentHash_1', key: { contentHash: 1 } }
      ]);

      const { handler } = require('../netlify/functions/analyze.cjs');
      
      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({
          image: {
            image: 'base64imagedata2',
            mimeType: 'image/png',
            fileName: 'test2.png'
          }
        }),
        queryStringParameters: {
          sync: 'true',
          check: 'true'
        }
      };

      const context = { awsRequestId: 'test-request-456' };
      
      const result = await handler(event, context);
      const body = JSON.parse(result.body);
      
      // Should flag for upgrade due to low score
      expect(body.isDuplicate).toBe(true);
      expect(body.needsUpgrade).toBe(true);
    });

    it('should flag for upgrade if missing critical fields', async () => {
      const mockExisting = {
        _id: 'test-id-789',
        contentHash: 'ghi789hash',
        fileName: 'test3.png',
        validationScore: 100, // High score
        extractionAttempts: 1,
        analysis: {
          dlNumber: 'DL003',
          stateOfCharge: 80,
          // Missing: overallVoltage, current, remainingCapacity, etc.
        }
      };

      mockCollection.findOne.mockResolvedValue(mockExisting);
      mockCollection.indexes.mockResolvedValue([
        { name: 'contentHash_1', key: { contentHash: 1 } }
      ]);

      const { handler } = require('../netlify/functions/analyze.cjs');
      
      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({
          image: {
            image: 'base64imagedata3',
            mimeType: 'image/png',
            fileName: 'test3.png'
          }
        }),
        queryStringParameters: {
          sync: 'true',
          check: 'true'
        }
      };

      const context = { awsRequestId: 'test-request-789' };
      
      const result = await handler(event, context);
      const body = JSON.parse(result.body);
      
      // Should flag for upgrade due to missing fields
      expect(body.isDuplicate).toBe(true);
      expect(body.needsUpgrade).toBe(true);
      
      // Verify logging
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing critical fields'),
        expect.objectContaining({
          event: 'UPGRADE_NEEDED',
          decision: 'UPGRADE'
        })
      );
    });

    it('should NOT re-upgrade records that were already retried', async () => {
      const mockExisting = {
        _id: 'test-id-999',
        contentHash: 'jkl999hash',
        fileName: 'test4.png',
        validationScore: 85,
        extractionAttempts: 2, // Already retried
        _wasUpgraded: true,
        _previousQuality: 85,
        _newQuality: 85, // No improvement
        analysis: {
          dlNumber: 'DL004',
          stateOfCharge: 75,
          overallVoltage: 50.0,
          current: 2.0,
          remainingCapacity: 180,
          chargeMosOn: true,
          dischargeMosOn: true,
          balanceOn: false,
          highestCellVoltage: 3.40,
          lowestCellVoltage: 3.38,
          averageCellVoltage: 3.39,
          cellVoltageDifference: 0.02,
          cycleCount: 200,
          power: 100.0
        }
      };

      mockCollection.findOne.mockResolvedValue(mockExisting);
      mockCollection.indexes.mockResolvedValue([
        { name: 'contentHash_1', key: { contentHash: 1 } }
      ]);

      const { handler } = require('../netlify/functions/analyze.cjs');
      
      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({
          image: {
            image: 'base64imagedata4',
            mimeType: 'image/png',
            fileName: 'test4.png'
          }
        }),
        queryStringParameters: {
          sync: 'true',
          check: 'true'
        }
      };

      const context = { awsRequestId: 'test-request-999' };
      
      const result = await handler(event, context);
      const body = JSON.parse(result.body);
      
      // Should NOT upgrade - already tried with no improvement
      expect(body.isDuplicate).toBe(true);
      expect(body.needsUpgrade).toBe(false);
      
      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('already retried with identical results'),
        expect.objectContaining({
          event: 'NO_IMPROVEMENT',
          decision: 'RETURN_EXISTING'
        })
      );
    });
  });
});
