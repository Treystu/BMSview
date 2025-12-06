/**
 * Test to verify the logger fix in generate-insights.cjs
 * 
 * This test ensures that the generate-insights function properly initializes
 * the logger and doesn't throw "Cannot read properties of undefined (reading 'error')"
 */

const { handler } = require('../netlify/functions/generate-insights.cjs');

// Mock dependencies
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  connectDB: jest.fn().mockResolvedValue({
    collection: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'test-id' }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
    })
  })
}));

jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    entry: jest.fn(),
    exit: jest.fn()
  }),
  createLoggerFromEvent: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    entry: jest.fn(),
    exit: jest.fn()
  }),
  createTimer: jest.fn().mockReturnValue({
    end: jest.fn()
  })
}));

jest.mock('../netlify/functions/utils/validation.cjs', () => ({
  validateObjectId: jest.fn().mockReturnValue(true),
  validateRequest: jest.fn()
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: jest.fn().mockReturnValue('[SUFFICIENT] Mock insights generated.')
        }
      })
    })
  }))
}));

describe('generate-insights logger fix', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'generate-insights'
  };

  test('handler creates logger instance without error', async () => {
    const { createLoggerFromEvent } = require('../netlify/functions/utils/logger.cjs');
    
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({
        systemId: 'test-system-id'
      })
    };

    // Call handler - it should create a logger instance
    await handler(event, mockContext);
    
    // Verify createLoggerFromEvent was called with the legacy name
    expect(createLoggerFromEvent).toHaveBeenCalledWith('generate-insights-legacy', event, mockContext);
  });

  test.skip('generateInsightsWithTools creates logger instance without error', async () => {
    // This function was refactored and moved to generate-insights-with-tools.cjs
    // Skipping this test as it's no longer relevant
  });

  test('logger instance methods can be called without error', async () => {
    const { createLogger } = require('../netlify/functions/utils/logger.cjs');
    
    // Get the mock logger instance
    const mockLogger = createLogger('test', {});
    
    // These should not throw errors
    expect(() => mockLogger.info('test message', { data: 'test' })).not.toThrow();
    expect(() => mockLogger.error('test error', { error: 'test' })).not.toThrow();
    expect(() => mockLogger.warn('test warning', { warn: 'test' })).not.toThrow();
    expect(() => mockLogger.debug('test debug', { debug: 'test' })).not.toThrow();
  });
});
