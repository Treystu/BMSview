/**
 * Test to verify that insights status endpoint does not return duplicate output
 * when job is completed.
 * 
 * This test ensures the fix for the duplicate final_answer issue is working correctly.
 * Reference: Issues #73 and #56
 */

const { handler } = require('../netlify/functions/generate-insights-status.cjs');

// Mock dependencies
jest.mock('../netlify/functions/utils/insights-jobs.cjs');
jest.mock('../src/utils/logger.cjs');

const { getInsightsJob } = require('../netlify/functions/utils/insights-jobs.cjs');
const { createLogger } = require('../src/utils/logger.cjs');

describe('Insights Status - No Duplicate Output', () => {
  let mockLog;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLog = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    
    createLogger.mockReturnValue(mockLog);
  });

  test('should NOT include partialInsights when job is completed with finalInsights', async () => {
    // Arrange: Mock a completed job with both partialInsights and finalInsights
    const mockJob = {
      id: 'test-job-123',
      status: 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      partialInsights: {
        rawText: '## KEY FINDINGS\n* Test partial insight',
        formattedText: '## KEY FINDINGS\n* Test partial insight',
        contextSummary: { test: 'partial' }
      },
      finalInsights: {
        rawText: '## KEY FINDINGS\n* Test final insight',
        formattedText: '## KEY FINDINGS\n* Test final insight',
        contextSummary: { test: 'final' }
      },
      progress: [
        { type: 'status', data: { message: 'Processing...' } }
      ]
    };

    getInsightsJob.mockResolvedValue(mockJob);

    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ jobId: 'test-job-123' })
    };
    const context = {};

    // Act: Call the handler
    const result = await handler(event, context);

    // Assert: Response should include insights (from finalInsights) but NOT partialInsights
    expect(result.statusCode).toBe(200);
    
    const responseBody = JSON.parse(result.body);
    
    // Should have insights (from finalInsights)
    expect(responseBody.insights).toBeDefined();
    expect(responseBody.insights.rawText).toBe('## KEY FINDINGS\n* Test final insight');
    
    // Should NOT have partialInsights (this is the key assertion for the fix)
    expect(responseBody.partialInsights).toBeUndefined();
    
    // Should have metadata
    expect(responseBody.metadata).toBeDefined();
    
    // Should have completedAt
    expect(responseBody.completedAt).toBeDefined();
  });

  test('should include partialInsights when job is processing (not completed)', async () => {
    // Arrange: Mock a processing job with only partialInsights
    const mockJob = {
      id: 'test-job-456',
      status: 'processing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      partialInsights: {
        rawText: '## Analyzing...',
        formattedText: '## Analyzing...',
        contextSummary: { test: 'partial' }
      },
      progress: [
        { type: 'status', data: { message: 'Processing...' } },
        { type: 'tool_call', data: { toolName: 'request_bms_data' } }
      ]
    };

    getInsightsJob.mockResolvedValue(mockJob);

    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ jobId: 'test-job-456' })
    };
    const context = {};

    // Act: Call the handler
    const result = await handler(event, context);

    // Assert: Response should include partialInsights (job not completed yet)
    expect(result.statusCode).toBe(200);
    
    const responseBody = JSON.parse(result.body);
    
    // Should have partialInsights since job is still processing
    expect(responseBody.partialInsights).toBeDefined();
    expect(responseBody.partialInsights.rawText).toBe('## Analyzing...');
    
    // Should NOT have insights (which is from finalInsights)
    expect(responseBody.insights).toBeUndefined();
    
    // Should have progress
    expect(responseBody.progress).toHaveLength(2);
  });

  test('should handle completed job without partialInsights', async () => {
    // Arrange: Mock a completed job with only finalInsights (no partialInsights stored)
    const mockJob = {
      id: 'test-job-789',
      status: 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finalInsights: {
        rawText: '## KEY FINDINGS\n* Final insight only',
        formattedText: '## KEY FINDINGS\n* Final insight only'
      },
      progress: []
    };

    getInsightsJob.mockResolvedValue(mockJob);

    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ jobId: 'test-job-789' })
    };
    const context = {};

    // Act: Call the handler
    const result = await handler(event, context);

    // Assert: Should work correctly with only finalInsights
    expect(result.statusCode).toBe(200);
    
    const responseBody = JSON.parse(result.body);
    
    expect(responseBody.insights).toBeDefined();
    expect(responseBody.partialInsights).toBeUndefined();
  });
});
