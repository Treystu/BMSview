/**
 * Test for Generate Insights Mode Selection Fix
 * Verifies that background mode is now the default
 */

describe('Generate Insights Mode Selection', () => {
  // Mock the handler
  let handler;
  let mockEvent;
  let mockContext;

  beforeEach(() => {
    // Load the handler fresh for each test
    jest.resetModules();
    
    // Mock dependencies
    jest.mock('../netlify/functions/utils/insights-jobs.cjs', () => ({
      createInsightsJob: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
      ensureIndexes: jest.fn().mockResolvedValue(true)
    }));

    jest.mock('../netlify/functions/utils/insights-summary.cjs', () => ({
      generateInitialSummary: jest.fn().mockResolvedValue({ generated: 'Test summary' })
    }));

    jest.mock('../netlify/functions/utils/insights-processor.cjs', () => ({
      getAIModelWithTools: jest.fn().mockResolvedValue({
        generateContent: jest.fn().mockResolvedValue({
          response: {
            text: () => JSON.stringify({ final_answer: 'Test insights' })
          }
        })
      })
    }));

    jest.mock('../netlify/functions/utils/insights-guru-runner.cjs', () => ({
      runGuruConversation: jest.fn().mockResolvedValue({
        insights: {
          rawText: 'Test insights',
          formattedText: 'Test insights formatted'
        },
        toolCalls: [],
        usedFunctionCalling: false,
        iterations: 1
      })
    }));

    // Mock fetch for background dispatch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}')
    });

    handler = require('../netlify/functions/generate-insights-with-tools.cjs').handler;

    mockEvent = {
      body: JSON.stringify({
        analysisData: {
          voltage: 52.4,
          current: -5.2,
          soc: 85
        }
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
  });

  test('should default to background mode for simple requests', async () => {
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.jobId).toBe('test-job-id');
    expect(body.status).toBe('processing');
    expect(body.analysisMode).toBe('background');
  });

  test('should use background mode when no parameters specified', async () => {
    mockEvent.queryStringParameters = {};
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.analysisMode).toBe('background');
  });

  test('should use sync mode when explicitly requested', async () => {
    mockEvent.queryStringParameters = { sync: 'true' };
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.analysisMode).toBe('sync');
    expect(body.insights).toBeDefined();
  });

  test('should use sync mode with mode=sync parameter', async () => {
    mockEvent.queryStringParameters = { mode: 'sync' };
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.analysisMode).toBe('sync');
  });

  test('should use background mode for large datasets', async () => {
    mockEvent.body = JSON.stringify({
      analysisData: {
        measurements: Array(400).fill({ voltage: 52.4 })
      }
    });

    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.analysisMode).toBe('background');
  });

  test('should use background mode for long custom prompts', async () => {
    mockEvent.body = JSON.stringify({
      analysisData: { voltage: 52.4 },
      customPrompt: 'x'.repeat(450)
    });

    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.analysisMode).toBe('background');
  });

  test('should dispatch to background function in background mode', async () => {
    const result = await handler(mockEvent, mockContext);
    const body = JSON.parse(result.body);

    expect(body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('generate-insights-background'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('test-job-id')
      })
    );
  });
});
