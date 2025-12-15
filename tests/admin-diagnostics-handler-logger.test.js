/**
 * Integration test for admin-diagnostics handler logger functionality
 * Verifies that the logger is properly initialized and works in the handler
 */

// Mock all dependencies before requiring the handler
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getDb: jest.fn().mockResolvedValue({
    collection: jest.fn().mockReturnValue({
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 })
    })
  }),
  getCollection: jest.fn().mockResolvedValue({
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    })
  })
}));

jest.mock('../netlify/functions/utils/analysis-pipeline.cjs', () => ({
  performAnalysisPipeline: jest.fn()
}));

jest.mock('../netlify/functions/utils/insights-tools.cjs', () => ({
  generateInsightsWithTools: jest.fn()
}));

jest.mock('../netlify/functions/utils/insights-jobs.cjs', () => ({
  createInsightsJob: jest.fn(),
  getJobById: jest.fn(),
  updateJobProgress: jest.fn()
}));

jest.mock('../netlify/functions/utils/geminiClient.cjs', () => ({
  GeminiClient: jest.fn()
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn()
}));

describe('Admin Diagnostics Handler Logger Integration', () => {
  let handler;
  let originalLog, originalError, originalWarn;

  beforeAll(() => {
    // Mock console methods to capture output
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;

    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Require handler after mocks are set up
    handler = require('../netlify/functions/admin-diagnostics.cjs').handler;
  });

  afterAll(() => {
    // Restore console methods
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  test('handler should initialize logger and log without errors', async () => {
    const mockEvent = {
      httpMethod: 'OPTIONS',
      headers: {}
    };

    const mockContext = {
      requestId: 'test-request-123',
      awsRequestId: 'aws-123'
    };

    // Call the handler - should not throw
    const response = await handler(mockEvent, mockContext);

    // Verify response structure
    expect(response).toBeDefined();
    expect(response.statusCode).toBe(200);
    expect(response.headers).toBeDefined();
  });

  test('handler should handle POST request with empty body', async () => {
    const mockEvent = {
      httpMethod: 'POST',
      body: JSON.stringify({ selectedTests: [] }),
      headers: {}
    };

    const mockContext = {
      requestId: 'test-request-456',
      awsRequestId: 'aws-456'
    };

    // Call the handler
    const response = await handler(mockEvent, mockContext);

    // Verify response
    expect(response).toBeDefined();
    expect(response.statusCode).toBe(200);
    expect(response.body).toBeDefined();

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('testId');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('results');
  });

  test('logger should be called during handler execution', async () => {
    // Use POST request instead of OPTIONS to ensure logger is initialized
    const mockEvent = {
      httpMethod: 'POST',
      body: JSON.stringify({ selectedTests: [] }),
      headers: {}
    };

    const mockContext = {
      requestId: 'test-logger-call',
      awsRequestId: 'aws-logger'
    };

    // Call the handler
    await handler(mockEvent, mockContext);

    // Verify logger was called (console.log should be invoked)
    expect(console.log).toHaveBeenCalled();

    // Check if log output contains expected structure
    const logCalls = console.log.mock.calls;
    const hasValidLogStructure = logCalls.some(call => {
      if (typeof call[0] === 'string') {
        try {
          const logEntry = JSON.parse(call[0]);
          return logEntry.function === 'admin-diagnostics' &&
            logEntry.requestId === 'test-logger-call';
        } catch {
          return false;
        }
      }
      return false;
    });

    expect(hasValidLogStructure).toBe(true);
  });

  test('handler should not throw when logger is used with empty tests', async () => {
    const mockEvent = {
      httpMethod: 'POST',
      body: JSON.stringify({ selectedTests: [] }),
      headers: {}
    };

    const mockContext = {
      requestId: 'test-no-throw'
    };

    // This should not throw "Cannot read properties of undefined (reading 'info')"
    const response = await handler(mockEvent, mockContext);
    expect(response).toBeDefined();
    expect(response.statusCode).toBe(200);
  });
});
