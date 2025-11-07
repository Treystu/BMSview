/**
 * Tests for insights-jobs utility
 */

const {
  createInsightsJob,
  getInsightsJob,
  updateJobStatus,
  addProgressEvent,
  updatePartialInsights,
  completeJob,
  failJob
} = require('../netlify/functions/utils/insights-jobs.cjs');

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

describe('Insights Jobs Utility', () => {
  let mockCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'test-id' }),
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      createIndex: jest.fn().mockResolvedValue('index-created')
    };
    
    getCollection.mockResolvedValue(mockCollection);
  });

  describe('createInsightsJob', () => {
    it('should create a new insights job', async () => {
      const params = {
        analysisData: { voltage: 24.5 },
        systemId: 'sys-123',
        customPrompt: 'Test prompt',
        initialSummary: { current: { voltage: 24.5 } }
      };

      const job = await createInsightsJob(params, mockLog);

      expect(job).toBeDefined();
      expect(job.id).toMatch(/^insights_\d+_[a-z0-9]+$/);
      expect(job.status).toBe('queued');
      expect(job.analysisData).toEqual(params.analysisData);
      expect(job.systemId).toBe(params.systemId);
      expect(mockCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
        status: 'queued',
        systemId: 'sys-123'
      }));
    });

    it('should handle errors when creating job', async () => {
      mockCollection.insertOne.mockRejectedValue(new Error('DB error'));

      await expect(
        createInsightsJob({ analysisData: {} }, mockLog)
      ).rejects.toThrow('DB error');

      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('getInsightsJob', () => {
    it('should retrieve job by ID', async () => {
      const mockJob = {
        id: 'job-123',
        status: 'processing',
        progress: []
      };
      mockCollection.findOne.mockResolvedValue(mockJob);

      const job = await getInsightsJob('job-123', mockLog);

      expect(job).toEqual(mockJob);
      expect(mockCollection.findOne).toHaveBeenCalledWith({ id: 'job-123' });
    });

    it('should return null for non-existent job', async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const job = await getInsightsJob('non-existent', mockLog);

      expect(job).toBeNull();
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });

  describe('updateJobStatus', () => {
    it('should update job status', async () => {
      const success = await updateJobStatus('job-123', 'completed', mockLog);

      expect(success).toBe(true);
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { id: 'job-123' },
        { $set: { status: 'completed', updatedAt: expect.any(Date) } }
      );
    });

    it('should return false if job not found', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

      const success = await updateJobStatus('non-existent', 'completed', mockLog);

      expect(success).toBe(false);
    });
  });

  describe('addProgressEvent', () => {
    it('should add progress event to job', async () => {
      const event = {
        type: 'tool_call',
        data: { tool: 'request_bms_data', parameters: {} }
      };

      const success = await addProgressEvent('job-123', event, mockLog);

      expect(success).toBe(true);
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { id: 'job-123' },
        {
          $push: { progress: expect.objectContaining({ type: 'tool_call', timestamp: expect.any(Date) }) },
          $set: { updatedAt: expect.any(Date) }
        }
      );
    });
  });

  describe('updatePartialInsights', () => {
    it('should update partial insights', async () => {
      const insights = 'Preliminary analysis...';

      const success = await updatePartialInsights('job-123', insights, mockLog);

      expect(success).toBe(true);
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { id: 'job-123' },
        { $set: { partialInsights: insights, updatedAt: expect.any(Date) } }
      );
    });
  });

  describe('completeJob', () => {
    it('should mark job as completed with final insights', async () => {
      const finalInsights = {
        rawText: 'Final analysis',
        formattedText: 'Formatted analysis'
      };

      const success = await completeJob('job-123', finalInsights, mockLog);

      expect(success).toBe(true);
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { id: 'job-123' },
        {
          $set: {
            status: 'completed',
            finalInsights,
            updatedAt: expect.any(Date)
          }
        }
      );
    });
  });

  describe('failJob', () => {
    it('should mark job as failed with error message', async () => {
      const errorMessage = 'Processing failed';

      const success = await failJob('job-123', errorMessage, mockLog);

      expect(success).toBe(true);
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { id: 'job-123' },
        {
          $set: {
            status: 'failed',
            error: errorMessage,
            updatedAt: expect.any(Date)
          }
        }
      );
    });
  });
});
