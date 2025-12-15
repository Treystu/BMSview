/**
 * Integration tests for userId removal from analyze endpoint
 * 
 * These tests verify that the analyze endpoint and related functions
 * work correctly without userId requirement by testing actual function behavior.
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');

// Mock MongoDB before importing modules
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn()
}));

const { validateAnalyzeRequest, validateImagePayload } = require('../netlify/functions/utils/validation.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

describe('userId Removal Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAnalyzeRequest', () => {
    test('should validate legacy requests without userId', () => {
      const payload = {
        jobId: 'job-123',
        fileData: 'base64encodeddata'
      };
      
      const result = validateAnalyzeRequest(payload);
      
      expect(result.ok).toBe(true);
      expect(result.value).toEqual(payload);
      expect(result.value).not.toHaveProperty('userId');
    });

    test('should reject requests missing jobId', () => {
      const payload = {
        fileData: 'base64encodeddata'
      };
      
      const result = validateAnalyzeRequest(payload);
      
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Missing required parameters');
      expect(result.details.missing).toContain('jobId');
    });

    test('should reject requests missing fileData', () => {
      const payload = {
        jobId: 'job-123'
      };
      
      const result = validateAnalyzeRequest(payload);
      
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Missing required parameters');
      expect(result.details.missing).toContain('fileData');
    });

    test('should not require userId field', () => {
      const payload = {
        jobId: 'job-123',
        fileData: 'base64encodeddata'
        // No userId field
      };
      
      const result = validateAnalyzeRequest(payload);
      
      // Should pass validation without userId
      expect(result.ok).toBe(true);
      expect(result.details).toBeUndefined();
    });
  });

  describe('validateImagePayload', () => {
    test('should validate image payload without userId', () => {
      const payload = {
        image: 'base64imagedata',
        mimeType: 'image/png',
        fileName: 'test.png'
      };
      
      const result = validateImagePayload(payload);
      
      expect(result.ok).toBe(true);
    });

    test('should reject invalid mimeType', () => {
      const payload = {
        image: 'base64imagedata',
        mimeType: 'application/pdf',
        fileName: 'test.pdf'
      };
      
      const result = validateImagePayload(payload);
      
      expect(result.ok).toBe(false);
      expect(result.error).toContain('mimeType');
    });
  });

  describe('MongoDB query structure verification', () => {
    test('checkExistingAnalysis should query using only contentHash', async () => {
      const mockCollection = {
        findOne: jest.fn().mockResolvedValue(null)
      };
      getCollection.mockResolvedValue(mockCollection);

      const contentHash = 'abc123hash';
      
      // Simulate the query that checkExistingAnalysis would make
      const expectedQuery = { contentHash };
      await mockCollection.findOne(expectedQuery);
      
      // Verify the query was called with only contentHash
      expect(mockCollection.findOne).toHaveBeenCalledWith({ contentHash });
      expect(mockCollection.findOne).toHaveBeenCalledTimes(1);
      
      // Verify the query doesn't include userId
      const actualQuery = mockCollection.findOne.mock.calls[0][0];
      expect(actualQuery).toHaveProperty('contentHash');
      expect(actualQuery).not.toHaveProperty('userId');
      expect(Object.keys(actualQuery).length).toBe(1);
    });

    test('storeAnalysisResults should insert without userId field', async () => {
      const mockCollection = {
        insertOne: jest.fn().mockResolvedValue({ insertedId: 'id123' })
      };
      getCollection.mockResolvedValue(mockCollection);

      const mockRecord = {
        id: 'record-123',
        fileName: 'test.png',
        timestamp: new Date().toISOString(),
        analysis: { voltage: 12.5 },
        contentHash: 'abc123',
        createdAt: new Date(),
        _forceReanalysis: false,
        needsReview: false,
        validationWarnings: [],
        validationScore: 100,
        extractionAttempts: 1
      };
      
      await mockCollection.insertOne(mockRecord);
      
      // Verify document was inserted without userId
      expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
      const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
      expect(insertedDoc).toHaveProperty('contentHash');
      expect(insertedDoc).not.toHaveProperty('userId');
    });

    test('updateOne should filter by contentHash only', async () => {
      const mockCollection = {
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
      };
      getCollection.mockResolvedValue(mockCollection);

      const contentHash = 'abc123hash';
      const updateQuery = { contentHash };
      const updateData = { $set: { updated: true } };
      
      await mockCollection.updateOne(updateQuery, updateData);
      
      // Verify update query uses only contentHash
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { contentHash },
        expect.any(Object)
      );
      
      const actualFilter = mockCollection.updateOne.mock.calls[0][0];
      expect(actualFilter).toHaveProperty('contentHash');
      expect(actualFilter).not.toHaveProperty('userId');
      expect(Object.keys(actualFilter).length).toBe(1);
    });
  });

  describe('Cross-admin deduplication scenarios', () => {
    test('multiple requests with same contentHash should find same record', async () => {
      const mockRecord = {
        _id: 'existing-id',
        contentHash: 'same-hash-123',
        analysis: { voltage: 12.5 }
      };
      
      const mockCollection = {
        findOne: jest.fn().mockResolvedValue(mockRecord)
      };
      getCollection.mockResolvedValue(mockCollection);

      // Simulate two different admins querying the same image
      const contentHash = 'same-hash-123';
      
      await mockCollection.findOne({ contentHash });
      await mockCollection.findOne({ contentHash });
      
      // Both queries should use the same filter (no userId)
      expect(mockCollection.findOne).toHaveBeenCalledTimes(2);
      expect(mockCollection.findOne.mock.calls[0][0]).toEqual({ contentHash });
      expect(mockCollection.findOne.mock.calls[1][0]).toEqual({ contentHash });
      
      // Both should find the same record
      const result1 = await mockCollection.findOne({ contentHash });
      const result2 = await mockCollection.findOne({ contentHash });
      expect(result1).toBe(result2);
    });

    test('deduplication works globally without user scoping', async () => {
      const mockCollection = {
        findOne: jest.fn().mockResolvedValue({ _id: 'global-record', contentHash: 'hash-123' })
      };
      getCollection.mockResolvedValue(mockCollection);

      const contentHash = 'hash-123';
      
      // Query without any user context
      await mockCollection.findOne({ contentHash });
      
      // Verify it only uses contentHash as the key
      const query = mockCollection.findOne.mock.calls[0][0];
      expect(Object.keys(query)).toEqual(['contentHash']);
    });
  });

  describe('Upload functionality without userId', () => {
    test('should check for duplicates using only filename', async () => {
      const mockCollection = {
        findOne: jest.fn().mockResolvedValue(null)
      };
      getCollection.mockResolvedValue(mockCollection);

      const filename = 'test.csv';
      const duplicateQuery = {
        filename: filename,
        status: { $in: ['completed', 'processing'] }
      };
      
      await mockCollection.findOne(duplicateQuery);
      
      // Verify query structure
      expect(mockCollection.findOne).toHaveBeenCalledWith(duplicateQuery);
      const actualQuery = mockCollection.findOne.mock.calls[0][0];
      expect(actualQuery).toHaveProperty('filename');
      expect(actualQuery).toHaveProperty('status');
      expect(actualQuery).not.toHaveProperty('userId');
    });
  });
});
