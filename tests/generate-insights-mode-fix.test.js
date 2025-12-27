// @ts-nocheck
/**
 * Test for Generate Insights Mode Selection Fix
 * Verifies that background mode is now the default
 * 
 * NOTE: These tests are currently skipped because they require extensive
 * mocking of the entire generate-insights pipeline including MongoDB, Gemini API,
 * and multiple internal modules. The tests need to be updated with proper
 * integration testing patterns before re-enabling.
 */

const mockCreateInsightsJob = jest.fn().mockResolvedValue({ id: 'test-job-id' });
const mockEnsureIndexes = jest.fn().mockResolvedValue(true);
const mockGenerateInitialSummary = jest.fn().mockResolvedValue({ generated: 'Test summary' });
const mockGetAIModelWithTools = jest.fn().mockResolvedValue({
  generateContent: jest.fn().mockResolvedValue({
    response: {
      text: () => JSON.stringify({ final_answer: 'Test insights' })
    }
  })
});
const mockRunGuruConversation = jest.fn().mockResolvedValue({
  insights: {
    rawText: 'Test insights',
    formattedText: 'Test insights formatted'
  },
  toolCalls: [],
  usedFunctionCalling: false,
  iterations: 1
});
const mockExecuteReActLoop = jest.fn().mockResolvedValue({
  success: true,
  finalAnswer: 'Test insights from ReAct loop',
  turns: 1,
  toolCalls: 0
});

const mockProcessInsightsInBackground = jest.fn().mockResolvedValue(true);
const mockTriggerInsightsWorkload = jest.fn().mockResolvedValue({ eventId: 'test-event-id', jobId: 'test-job-id' });

// Mock dependencies
jest.mock('../netlify/functions/utils/insights-jobs.cjs', () => ({
  createInsightsJob: mockCreateInsightsJob,
  ensureIndexes: mockEnsureIndexes
}));

jest.mock('../netlify/functions/utils/insights-summary.cjs', () => ({
  generateInitialSummary: mockGenerateInitialSummary
}));

jest.mock('../netlify/functions/utils/insights-processor.cjs', () => ({
  getAIModelWithTools: mockGetAIModelWithTools
}));

jest.mock('../netlify/functions/utils/insights-async-client.cjs', () => ({
  triggerInsightsWorkload: mockTriggerInsightsWorkload
}));

jest.mock('../netlify/functions/utils/insights-guru-runner.cjs', () => ({
  runGuruConversation: mockRunGuruConversation
}));

jest.mock('../netlify/functions/utils/react-loop.cjs', () => ({
  executeReActLoop: mockExecuteReActLoop
}));

jest.mock('../netlify/functions/utils/rate-limiter.cjs', () => ({
  applyRateLimit: jest.fn().mockResolvedValue({ remaining: 10, limit: 100 }),
  RateLimitError: class RateLimitError extends Error { }
}));

jest.mock('../netlify/functions/utils/security-sanitizer.cjs', () => ({
  sanitizeInsightsRequest: jest.fn().mockImplementation((body) => ({
    ...body,
    analysisData: body.analysisData || body.batteryData,
    systemId: body.systemId || 'test-system-id',
    mode: body.mode,
    consentGranted: body.consentGranted
  })),
  SanitizationError: class SanitizationError extends Error { }
}));

describe('Generate Insights Mode Selection', () => {
  // Mock the handler
  let handler;
  let mockEvent;
  let mockContext;

  // Set env vars
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Reset process.env and set required vars
    process.env = { ...ORIGINAL_ENV };
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';

    // Reset mocks
    jest.clearAllMocks();

    // Reset modules to reload handler with new mocks/env
    jest.resetModules();

    // Mock fetch for background dispatch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}')
    });

    handler = require('../netlify/functions/generate-insights-with-tools.cjs').handler;


    mockEvent = {
      body: JSON.stringify({
        consentGranted: true,
        analysisData: {
          voltage: 52.4,
          current: -5.2,
          soc: 85
        },
        systemId: 'test-system-id'
      }),
      headers: {
        host: 'test.netlify.app',
        'x-forwarded-proto': 'https'
      },
      queryStringParameters: {}
    };

    mockContext = {
      awsRequestId: 'test-request-id'
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  test('should default to background mode for simple requests', async () => {
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(202);
    expect(body.success).toBe(true);
    expect(body.jobId).toBe('test-job-id');
    expect(body.status).toBe('processing');
  });

  test('should use background mode when no parameters specified', async () => {
    mockEvent.queryStringParameters = {};
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.status).toBe('processing');
  });

  test('should use sync mode when explicitly requested', async () => {
    mockEvent.queryStringParameters = { sync: 'true' };
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.insights).toBeDefined();
  });

  test('should use sync mode with mode=sync parameter', async () => {
    mockEvent.queryStringParameters = { mode: 'sync' };
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.insights).toBeDefined();
  });

  test('should use background mode for large datasets', async () => {
    mockEvent.body = JSON.stringify({
      consentGranted: true,
      analysisData: {
        measurements: Array(400).fill({ voltage: 52.4 })
      }
    });

    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.status).toBe('processing');
  });

  test('should use background mode for long custom prompts', async () => {
    mockEvent.body = JSON.stringify({
      analysisData: { voltage: 52.4 },
      consentGranted: true,
      customPrompt: 'x'.repeat(450)
    });

    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(202);
    expect(body.status).toBe('processing');
  });

  test('should dispatch to background function in background mode', async () => {
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.success).toBe(true);
    expect(body.success).toBe(true);
    expect(mockTriggerInsightsWorkload).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'test-job-id',
        analysisData: expect.anything(),
        systemId: 'test-system-id',
        fullContextMode: false
      })
    );
  });
});
