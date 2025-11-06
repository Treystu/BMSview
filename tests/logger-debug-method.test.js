/**
 * Test suite for logger.cjs debug method
 * 
 * This test ensures that the log.debug method is properly implemented
 * and prevents the "log.debug is not a function" error that was causing
 * the Generate Insights feature to fail.
 */

const { createLogger, createTimer } = require('../utils/logger.cjs');

describe('Logger debug method', () => {
  let consoleLogSpy;
  let originalEnv;

  beforeEach(() => {
    // Spy on console.log to capture log output
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    
    // Save original environment
    originalEnv = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    // Restore console.log
    consoleLogSpy.mockRestore();
    
    // Restore environment
    if (originalEnv === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalEnv;
    }
  });

  describe('debug method existence', () => {
    it('should have debug method defined', () => {
      const log = createLogger('test-function', {});
      expect(log.debug).toBeDefined();
      expect(typeof log.debug).toBe('function');
    });

    it('should have all required log methods', () => {
      const log = createLogger('test-function', {});
      expect(log.debug).toBeDefined();
      expect(log.info).toBeDefined();
      expect(log.warn).toBeDefined();
      expect(log.error).toBeDefined();
    });
  });

  describe('debug method behavior', () => {
    it('should not log when LOG_LEVEL is not DEBUG', () => {
      delete process.env.LOG_LEVEL;
      const log = createLogger('test-function', {});
      
      log.debug('Test message', { data: 'value' });
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log when LOG_LEVEL is INFO', () => {
      process.env.LOG_LEVEL = 'INFO';
      const log = createLogger('test-function', {});
      
      log.debug('Test message', { data: 'value' });
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log when LOG_LEVEL is DEBUG', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const log = createLogger('test-function', { awsRequestId: 'test-123' });
      
      log.debug('Test message', { data: 'value' });
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe('DEBUG');
      expect(logOutput.message).toBe('Test message');
      expect(logOutput.data).toBe('value');
      expect(logOutput.function).toBe('test-function');
      expect(logOutput.requestId).toBe('test-123');
    });

    it('should include timestamp in debug logs', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const log = createLogger('test-function', {});
      
      log.debug('Test message');
      
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.timestamp).toBeDefined();
      expect(new Date(logOutput.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  describe('generate-insights-with-tools.cjs scenarios', () => {
    it('should handle line 288 scenario - Fetching system history', () => {
      const context = { 
        awsRequestId: 'f5a0f2f9-ab09-444c-9678-c829c8f7f6bd',
        functionName: 'generate-insights-with-tools'
      };
      const log = createLogger('generate-insights-with-tools', context);
      
      // This should not throw "log.debug is not a function"
      expect(() => {
        log.debug('Fetching system history', { 
          systemId: '6ac431c7-fb5d-4714-8b2f-c16e2e9bc8dd', 
          limit: 30 
        });
      }).not.toThrow();
    });

    it('should handle line 297 scenario - System history fetch completed', () => {
      const log = createLogger('generate-insights-with-tools', {});
      
      expect(() => {
        log.debug('System history fetch completed', { 
          duration: '451ms',
          recordsReturned: 30 
        });
      }).not.toThrow();
    });

    it('should handle line 336 scenario - Fetching system analytics', () => {
      const log = createLogger('generate-insights-with-tools', {});
      
      expect(() => {
        log.debug('Fetching system analytics', { 
          systemId: '6ac431c7-fb5d-4714-8b2f-c16e2e9bc8dd' 
        });
      }).not.toThrow();
    });

    it('should handle line 445 scenario - Starting Gemini API call', () => {
      const log = createLogger('generate-insights-with-tools', {});
      
      expect(() => {
        log.debug('Starting Gemini API call', {
          timeout: 25000,
          promptPreview: 'You are an expert battery system analyst...'
        });
      }).not.toThrow();
    });

    it('should handle line 145 scenario - Extracting trending insights', () => {
      const log = createLogger('generate-insights-with-tools', {});
      
      expect(() => {
        log.debug('Extracting trending insights from historical data', { 
          recordCount: 30 
        });
      }).not.toThrow();
    });
  });

  describe('consistency with other log methods', () => {
    it('should use same JSON structure as info method', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const log = createLogger('test-function', { awsRequestId: 'test-123' });
      
      log.debug('Debug message', { extra: 'data' });
      log.info('Info message', { extra: 'data' });
      
      const debugLog = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const infoLog = JSON.parse(consoleLogSpy.mock.calls[1][0]);
      
      expect(Object.keys(debugLog).sort()).toEqual(Object.keys(infoLog).sort());
      expect(debugLog.level).toBe('DEBUG');
      expect(infoLog.level).toBe('INFO');
    });

    it('should handle missing data parameter like other methods', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const log = createLogger('test-function', {});
      
      // Should not throw when called without data parameter
      expect(() => {
        log.debug('Message without data');
      }).not.toThrow();
    });
  });

  describe('createTimer integration', () => {
    it('should work with timer that uses log.info', () => {
      const log = createLogger('test-function', {});
      const timer = createTimer(log, 'test-operation');
      
      // Timer should work even if debug method exists
      expect(() => {
        timer.end();
      }).not.toThrow();
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe('INFO');
      expect(logOutput.message).toBe('test-operation completed');
    });
  });
});
