/**
 * Load testing for upload optimization
 */

const _uploadOptimizerModule = require('../src/utils/uploadOptimizer');
const UploadOptimizer = _uploadOptimizerModule && _uploadOptimizerModule.default ? _uploadOptimizerModule.default : _uploadOptimizerModule;

// Mock upload function
const createMockUploadFunction = (delay = 100, failureRate = 0) => {
  return async (file) => {
    await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 50));

    if (Math.random() < failureRate) {
      const error = new Error('Simulated upload failure');
      error.status = Math.random() < 0.5 ? 429 : 500;
      throw error;
    }

    return {
      fileId: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      filename: file.name,
      size: file.size
    };
  };
};

// Create test files
const createTestFiles = (count, size = 1024) => {
  return Array(count).fill(null).map((_, i) => ({
    name: `test-file-${i}.csv`,
    size: size + Math.random() * size,
    type: 'text/csv'
  }));
};

describe('Upload Optimization Tests', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new UploadOptimizer();
  });

  describe('Concurrency Calculation', () => {
    test('should calculate optimal concurrency for small batches', () => {
      expect(optimizer.calculateConcurrency(3, 3072)).toBe(3);
      expect(optimizer.calculateConcurrency(5, 5120)).toBe(5);
    });

    test('should calculate optimal concurrency for medium batches', () => {
      expect(optimizer.calculateConcurrency(10, 10240)).toBe(3);
      expect(optimizer.calculateConcurrency(20, 20480)).toBe(3);
    });

    test('should calculate optimal concurrency for large batches', () => {
      expect(optimizer.calculateConcurrency(50, 51200)).toBe(2);
      expect(optimizer.calculateConcurrency(100, 102400)).toBe(1);
    });

    test('should limit concurrency to available files', () => {
      expect(optimizer.calculateConcurrency(1, 1024)).toBe(1);
      expect(optimizer.calculateConcurrency(2, 2048)).toBe(2);
    });
  });

  describe('Batch Size Calculation', () => {
    test('should calculate smaller batches for larger files', () => {
      expect(optimizer.calculateBatchSize(10, 20 * 1024 * 1024)).toBeLessThan(5);
      expect(optimizer.calculateBatchSize(10, 5 * 1024 * 1024)).toBeLessThanOrEqual(10);
    });

    test('should calculate larger batches for smaller files', () => {
      expect(optimizer.calculateBatchSize(10, 1024 * 1024)).toBe(10);
      expect(optimizer.calculateBatchSize(20, 2 * 1024 * 1024)).toBe(10);
    });
  });

  describe('Retry Logic', () => {
    test('should retry on retryable errors', async () => {
      // Use a custom optimizer with shorter delays for testing
      const testOptimizer = new UploadOptimizer();
      testOptimizer.baseRetryDelay = 10; // 10ms instead of 1000ms
      testOptimizer.maxRetries = 3;

      const file = createTestFiles(1)[0];

      let attemptCount = 0;
      const mockFunction = async (file) => {
        attemptCount++;
        const error = new Error('Rate limited');
        error.status = 429;
        throw error;
      };

      try {
        await testOptimizer.uploadWithBackoff(file, mockFunction);
      } catch (error) {
        expect(attemptCount).toBe(testOptimizer.maxRetries);
      }
    }, 5000); // 5 second timeout

    test('should not retry on non-retryable errors', async () => {
      const file = createTestFiles(1)[0];
      let attemptCount = 0;

      const mockFunction = async (file) => {
        attemptCount++;
        const error = new Error('Bad request');
        error.status = 400;
        throw error;
      };

      try {
        await optimizer.uploadWithBackoff(file, mockFunction);
      } catch (error) {
        expect(attemptCount).toBe(1);
      }
    });

    test('should calculate exponential backoff', async () => {
      const delays = [];
      const originalSleep = optimizer.sleep;
      optimizer.sleep = (ms) => {
        delays.push(ms);
        return originalSleep.call(optimizer, 1); // Minimal delay for testing
      };

      const file = createTestFiles(1)[0];
      let attempt = 0;

      const mockFunction = async (file) => {
        attempt++;
        const error = new Error('Rate limited');
        error.status = 429;
        throw error;
      };

      try {
        await optimizer.uploadWithBackoff(file, mockFunction);
      } catch (error) {
        // Verify exponential growth with jitter
        expect(delays).toHaveLength(optimizer.maxRetries - 1);
        for (let i = 1; i < delays.length; i++) {
          expect(delays[i]).toBeGreaterThan(delays[i - 1]);
        }
      }

      optimizer.sleep = originalSleep;
    });
  });

  describe('Batch Processing', () => {
    test('should process small batches with high concurrency', async () => {
      const files = createTestFiles(3);
      const uploadFunction = createMockUploadFunction(50);

      const startTime = Date.now();
      const result = await optimizer.processBatch(files, uploadFunction);
      const duration = Date.now() - startTime;

      expect(result.summary.successful).toBe(3);
      expect(result.summary.failed).toBe(0);
      // Should complete quickly due to parallel processing
      expect(duration).toBeLessThan(200);
    });

    test('should process large batches sequentially', async () => {
      const files = createTestFiles(100);
      const uploadFunction = createMockUploadFunction(10);

      const result = await optimizer.processBatch(files, uploadFunction);

      expect(result.summary.successful).toBe(100);
      expect(result.summary.failed).toBe(0);
      expect(result.summary.successRate).toBe(100);
    });

    test('should handle mixed success and failure', async () => {
      const files = createTestFiles(10);
      const uploadFunction = createMockUploadFunction(50, 0.3); // 30% failure rate

      const result = await optimizer.processBatch(files, uploadFunction);

      expect(result.summary.successful + result.summary.failed).toBe(10);
      expect(result.summary.successRate).toBeGreaterThan(60);
      expect(result.summary.successRate).toBeLessThanOrEqual(100);
    });

    test('should report progress correctly', async () => {
      const files = createTestFiles(5);
      const uploadFunction = createMockUploadFunction(50);
      const progressCalls = [];

      const progressCallback = (progress) => {
        progressCalls.push(progress);
      };

      await optimizer.processBatch(files, uploadFunction, progressCallback);

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1].percentage).toBe(100);
      expect(progressCalls[progressCalls.length - 1].completed).toBe(files.length);
    });
  });

  describe('File Validation', () => {
    test('should validate file size', () => {
      const oversizedFile = {
        name: 'large-file.csv',
        size: 100 * 1024 * 1024, // 100MB
        type: 'text/csv'
      };

      const validation = optimizer.validateFiles([oversizedFile]);
      expect(validation.allValid).toBe(false);
      expect(validation.invalidFiles[0].errors[0]).toContain('size');
    });

    test('should validate file type', () => {
      const invalidFile = {
        name: 'script.exe',
        size: 1024,
        type: 'application/octet-stream'
      };

      const validation = optimizer.validateFiles([invalidFile]);
      expect(validation.allValid).toBe(false);
      expect(validation.invalidFiles[0].errors[0]).toContain('type');
    });

    test('should validate filename length', () => {
      const longFile = {
        name: 'a'.repeat(300) + '.csv',
        size: 1024,
        type: 'text/csv'
      };

      const validation = optimizer.validateFiles([longFile]);
      expect(validation.allValid).toBe(false);
      expect(validation.invalidFiles[0].errors[0]).toContain('long');
    });

    test('should allow valid files', () => {
      const validFiles = [
        { name: 'data.csv', size: 1024, type: 'text/csv' },
        { name: 'config.json', size: 2048, type: 'application/json' },
        { name: 'logs.txt', size: 512, type: 'text/plain' }
      ];

      const validation = optimizer.validateFiles(validFiles);
      expect(validation.allValid).toBe(true);
      expect(validation.invalidFiles).toHaveLength(0);
    });
  });

  describe('Performance Metrics', () => {
    test('should log performance metrics', async () => {
      const files = createTestFiles(1);
      const uploadFunction = createMockUploadFunction(50);

      // Clear any existing metrics
      optimizer.clearStatistics();

      await optimizer.processBatch(files, uploadFunction);

      const stats = optimizer.getStatistics();
      expect(stats.totalUploads).toBe(1);
      expect(stats.successful).toBe(1);
      expect(stats.averageDuration).toBeGreaterThan(0);
    });

    test('should calculate statistics correctly', async () => {
      const files = createTestFiles(5, 2048);
      const uploadFunction = createMockUploadFunction(100);

      optimizer.clearStatistics();
      await optimizer.processBatch(files, uploadFunction);

      const stats = optimizer.getStatistics();
      expect(stats.totalUploads).toBe(5);
      expect(stats.successful).toBe(5);
      expect(stats.failed).toBe(0);
      expect(stats.successRate).toBe(100);
      expect(stats.totalBytesTransferred).toBeGreaterThan(0);
      expect(stats.averageFileSize).toBeGreaterThan(0);
    });
  });
});

// Load tests
describe('Load Tests', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new UploadOptimizer();
  });

  test('should handle 100 concurrent uploads', async () => {
    const files = createTestFiles(100);
    const uploadFunction = createMockUploadFunction(20); // Fast upload
    const startTime = Date.now();

    const result = await optimizer.processBatch(files, uploadFunction);
    const duration = Date.now() - startTime;

    expect(result.summary.successful).toBe(100);
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second
  }, 10000); // 10 second timeout

  test('should handle 500 uploads with failures', async () => {
    const files = createTestFiles(500);
    const uploadFunction = createMockUploadFunction(10, 0.1); // 10% failure rate

    const result = await optimizer.processBatch(files, uploadFunction);

    expect(result.summary.successful + result.summary.failed).toBe(500);
    expect(result.summary.successRate).toBeGreaterThan(85);
    expect(result.summary.successRate).toBeLessThanOrEqual(100);
  }, 60000); // 60 second timeout

  test('should maintain performance under memory pressure', async () => {
    const files = createTestFiles(1000, 10 * 1024); // 10KB files
    const uploadFunction = createMockUploadFunction(5);

    const result = await optimizer.processBatch(files, uploadFunction);

    expect(result.summary.successful).toBe(1000);
    expect(result.summary.successRate).toBe(100);
  }, 60000); // 60 second timeout
});

// Stress tests
describe('Stress Tests', () => {
  test('should handle rapid successive uploads', async () => {
    const optimizer = new UploadOptimizer();
    const uploadFunction = createMockUploadFunction(10);

    const promises = [];
    for (let i = 0; i < 10; i++) {
      const files = createTestFiles(10);
      promises.push(optimizer.processBatch(files, uploadFunction));
    }

    const results = await Promise.all(promises);

    results.forEach(result => {
      expect(result.summary.successful).toBe(10);
      expect(result.summary.successRate).toBe(100);
    });
  }, 30000);

  test('should recover from temporary failures', async () => {
    const optimizer = new UploadOptimizer();
    let failureCount = 0;
    const uploadFunction = async (file) => {
      failureCount++;
      if (failureCount <= 3) {
        const error = new Error('Temporary failure');
        error.status = 503;
        throw error;
      }
      return { fileId: 'success', filename: file.name };
    };

    const files = createTestFiles(1);
    const result = await optimizer.processBatch(files, uploadFunction);

    expect(result.summary.successful).toBe(1);
    expect(failureCount).toBeGreaterThan(3);
  });
});