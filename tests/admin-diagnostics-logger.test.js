/**
 * Test to verify logger initialization fix in admin-diagnostics.cjs
 * This test ensures the logger import and initialization is correct
 */

describe('Admin Diagnostics Logger Initialization', () => {
  test('should properly import createLogger from logger module', () => {
    // Test that the module can be required without errors
    expect(() => {
      const { createLogger } = require('../netlify/functions/utils/logger.cjs');
      expect(createLogger).toBeDefined();
      expect(typeof createLogger).toBe('function');
    }).not.toThrow();
  });

  test('should initialize logger without crashing', () => {
    // Mock the dependencies that admin-diagnostics needs
    jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
      getDb: jest.fn(),
      getCollection: jest.fn()
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

    // Try to require the admin-diagnostics module
    // If logger is properly initialized, this should not throw
    expect(() => {
      require('../netlify/functions/admin-diagnostics.cjs');
    }).not.toThrow();
  });

  test('should create logger instance with proper context', () => {
    const { createLogger } = require('../netlify/functions/utils/logger.cjs');
    
    const mockContext = {
      requestId: 'test-request-123',
      awsRequestId: 'aws-request-456'
    };

    const logger = createLogger('admin-diagnostics', mockContext);

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  test('logger methods should not throw when called', () => {
    const { createLogger } = require('../netlify/functions/utils/logger.cjs');
    const logger = createLogger('admin-diagnostics', {});

    // Mock console methods to prevent actual output
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    expect(() => {
      logger.info('test message', { data: 'test' });
      logger.error('test error', { error: 'test' });
      logger.warn('test warning', { warning: 'test' });
      logger.debug('test debug', { debug: 'test' });
    }).not.toThrow();

    // Restore console methods
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });
});
