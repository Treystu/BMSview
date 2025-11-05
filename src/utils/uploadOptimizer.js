/**
 * Dynamic Upload Optimization Utility
 * Optimizes upload performance based on file count, size, and network conditions
 */

class UploadOptimizer {
  constructor() {
    this.maxConcurrency = 5;
    this.minConcurrency = 1;
    this.maxRetries = 5;
    this.baseRetryDelay = 1000; // 1 second
    this.maxFileSize = 50 * 1024 * 1024; // 50MB
    this.chunkSize = 1024 * 1024; // 1MB chunks for large files
  }

  /**
   * Calculate optimal concurrency based on file count and total size
   */
  calculateConcurrency(fileCount, totalSize) {
    if (fileCount <= 5) {
      return Math.min(5, fileCount);
    }
    if (fileCount <= 20) {
      return 3;
    }
    if (fileCount <= 50) {
      return 2;
    }
    return 1; // For very large batches, process sequentially
  }

  /**
   * Calculate optimal batch size for processing
   */
  calculateBatchSize(fileCount, averageFileSize) {
    // Smaller batches for larger files
    if (averageFileSize > 10 * 1024 * 1024) { // > 10MB
      return Math.max(1, Math.floor(10 / fileCount));
    }
    if (averageFileSize > 5 * 1024 * 1024) { // > 5MB
      return Math.max(2, Math.floor(20 / fileCount));
    }
    return Math.min(10, fileCount);
  }

  /**
   * Upload with exponential backoff retry logic
   */
  async uploadWithBackoff(file, uploadFunction, attempt = 1) {
    try {
      const startTime = Date.now();
      const result = await uploadFunction(file);
      const duration = Date.now() - startTime;

      // Log performance metrics
      this.logPerformanceMetrics(file, duration, attempt, true);

      return result;
    } catch (error) {
      const isRetryable = this.isRetryableError(error);
      const shouldRetry = isRetryable && attempt < this.maxRetries;

      if (shouldRetry) {
        const delay = this.calculateRetryDelay(attempt, error);
        console.log(`Upload failed for ${file.name}, retry ${attempt}/${this.maxRetries} in ${delay}ms`);

        await this.sleep(delay);
        return this.uploadWithBackoff(file, uploadFunction, attempt + 1);
      }

      // Log failure
      this.logPerformanceMetrics(file, 0, attempt, false, error);
      throw error;
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /rate limit/i,
      /too many requests/i
    ];

    return (
      retryableStatuses.includes(error.status) ||
      retryablePatterns.some(pattern => pattern.test(error.message))
    );
  }

  /**
   * Calculate retry delay with jitter
   */
  calculateRetryDelay(attempt, error) {
    let baseDelay = this.baseRetryDelay * Math.pow(2, attempt - 1);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * baseDelay;
    baseDelay += jitter;

    // Adjust delay based on error type
    if (error.status === 429) {
      // Rate limit - use longer delay
      baseDelay *= 2;
    }

    return Math.min(baseDelay, 30000); // Cap at 30 seconds
  }

  /**
   * Process multiple files with optimized concurrency
   */
  async processBatch(files, uploadFunction, progressCallback) {
    const concurrency = this.calculateConcurrency(files.length, this.getTotalSize(files));
    const batchSize = this.calculateBatchSize(files.length, this.getAverageSize(files));

    console.log(`Processing ${files.length} files with concurrency ${concurrency}, batch size ${batchSize}`);

    const results = [];
    const errors = [];
    let completed = 0;

    // Create batches
    const batches = [];
    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }

    // Process batches with concurrency control
    const semaphore = new Semaphore(concurrency);

    const batchPromises = batches.map(async (batch, batchIndex) => {
      await semaphore.acquire();

      try {
        const batchResults = await Promise.allSettled(
          batch.map(file => this.uploadWithBackoff(file, uploadFunction))
        );

        // Process results
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            errors.push({
              file: batch[index].name,
              error: result.reason
            });
          }
          completed++;

          // Report progress
          if (progressCallback) {
            progressCallback({
              completed,
              total: files.length,
              percentage: Math.round((completed / files.length) * 100),
              currentBatch: batchIndex + 1,
              totalBatches: batches.length
            });
          }
        });
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(batchPromises);

    return {
      results,
      errors,
      summary: {
        total: files.length,
        successful: results.length,
        failed: errors.length,
        successRate: Math.round((results.length / files.length) * 100)
      }
    };
  }

  /**
   * Optimize file order for better performance
   */
  optimizeFileOrder(files) {
    // Sort by size (small files first for quicker feedback)
    return [...files].sort((a, b) => a.size - b.size);
  }

  /**
   * Get total size of all files
   */
  getTotalSize(files) {
    return files.reduce((total, file) => total + file.size, 0);
  }

  /**
   * Get average file size
   */
  getAverageSize(files) {
    return files.length > 0 ? this.getTotalSize(files) / files.length : 0;
  }

  /**
   * Validate files before upload
   */
  validateFiles(files) {
    const validationResults = [];

    files.forEach(file => {
      const result = {
        name: file.name,
        size: file.size,
        valid: true,
        errors: []
      };

      // Check file size
      if (file.size > this.maxFileSize) {
        result.valid = false;
        result.errors.push(`File size ${this.formatBytes(file.size)} exceeds maximum ${this.formatBytes(this.maxFileSize)}`);
      }

      // Check file type (basic validation)
      const allowedTypes = ['image/', 'text/', 'application/json', 'application/csv'];
      if (!allowedTypes.some(type => file.type.startsWith(type))) {
        result.valid = false;
        result.errors.push(`File type ${file.type} is not supported`);
      }

      // Check filename
      if (file.name.length > 255) {
        result.valid = false;
        result.errors.push('Filename is too long (max 255 characters)');
      }

      validationResults.push(result);
    });

    const validFiles = validationResults.filter(r => r.valid).map(r => r.name);
    const invalidFiles = validationResults.filter(r => !r.valid);

    return {
      validFiles,
      invalidFiles,
      allValid: invalidFiles.length === 0
    };
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Log performance metrics for monitoring
   */
  logPerformanceMetrics(file, duration, attempt, success, error = null) {
    const metrics = {
      filename: file.name,
      size: file.size,
      duration,
      attempt,
      success,
      timestamp: new Date().toISOString(),
      error: error?.message
    };

    // In production, this would go to a monitoring service
    console.log('Upload Metrics:', JSON.stringify(metrics, null, 2));

    // Store in telemetry only if enabled (opt-in). Default: no persistent storage in prod.
    // Telemetry is an ES module, so we can't use require() in a .js file
    // Instead, we'll use a simple localStorage fallback for metrics storage
    if (this._shouldStoreTelemetry()) {
      this._storeMetricToLocalStorage('uploadMetrics', metrics);
    }
  }

  /**
   * Check if telemetry should be stored (opt-in only)
   */
  _shouldStoreTelemetry() {
    try {
      if (typeof window !== 'undefined' && window.__ENABLE_TELEMETRY__ === true) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('enableTelemetry') === '1') return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Store metric to localStorage or test storage
   */
  _storeMetricToLocalStorage(key, metric) {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(key) || '[]';
        const arr = JSON.parse(raw);
        arr.push(metric);
        localStorage.setItem(key, JSON.stringify(arr.slice(-100))); // Keep last 100
      } else {
        // For testing environments without localStorage
        if (!this._testMetrics) {
          this._testMetrics = [];
        }
        this._testMetrics.push(metric);
        this._testMetrics = this._testMetrics.slice(-100); // Keep last 100
      }
    } catch (e) {
      // swallow
    }
  }

  /**
   * Simple sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get upload statistics
   */
  getStatistics() {
    try {
      let metrics = [];
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('uploadMetrics') || '[]';
          metrics = JSON.parse(raw);
        } else if (this._testMetrics) {
          // For testing environments without localStorage
          metrics = this._testMetrics;
        }
      } catch (e) {
        // ignore
      }

      if (metrics.length === 0) {
        return { message: 'No upload statistics available' };
      }

      const successful = metrics.filter(m => m.success);
      const failed = metrics.filter(m => !m.success);

      const avgDuration = successful.length > 0
        ? successful.reduce((sum, m) => sum + m.duration, 0) / successful.length
        : 0;
      const totalSize = metrics.reduce((sum, m) => sum + m.size, 0);

      return {
        totalUploads: metrics.length,
        successful: successful.length,
        failed: failed.length,
        successRate: Math.round((successful.length / metrics.length) * 100),
        averageDuration: Math.round(avgDuration),
        totalBytesTransferred: totalSize,
        averageFileSize: Math.round(totalSize / metrics.length),
        lastUpload: metrics[metrics.length - 1]?.timestamp
      };
    } catch (error) {
      return { error: 'Could not retrieve statistics' };
    }
  }

  /**
   * Clear stored metrics
   */
  clearStatistics() {
    try {
      const telemetry = require('./telemetry');
      if (telemetry && typeof telemetry.clearMetrics === 'function') {
        telemetry.clearMetrics('uploadMetrics');
        return;
      }
    } catch (e) { }
    try { localStorage.removeItem('uploadMetrics'); } catch (e) { }
  }
}

/**
 * Simple semaphore implementation for concurrency control
 */
class Semaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.currentConcurrency = 0;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (this.currentConcurrency < this.maxConcurrency) {
        this.currentConcurrency++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    this.currentConcurrency--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.currentConcurrency++;
      next();
    }
  }
}

export default UploadOptimizer;
export { Semaphore };
