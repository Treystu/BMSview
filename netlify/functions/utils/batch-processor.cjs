// @ts-nocheck
/**
 * Batch Processing Utilities for Large Dataset Operations
 * 
 * Provides efficient processing of large datasets through:
 * - Configurable chunk sizes for memory management
 * - Parallel processing for independent calculations
 * - Progress tracking for long-running operations
 * - Error handling with partial results
 * 
 * @module netlify/functions/utils/batch-processor
 */

const { createLogger } = require('./logger.cjs');

const log = createLogger('utils/batch-processor');

/**
 * Default batch processing configuration
 */
const DEFAULT_CONFIG = {
  chunkSize: 1000,        // Default records per chunk
  maxParallel: 4,         // Max parallel chunks for parallel processing
  progressInterval: 1000, // Progress callback interval (ms)
  timeoutMs: 55000,       // Overall timeout (for serverless)
  continueOnError: true   // Continue processing if chunk fails
};

/**
 * Process data in batches with configurable chunk size
 * 
 * @param {Array} data - Array of items to process
 * @param {Function} processFn - Async function to process each item: (item, index) => Promise<result>
 * @param {Object} options - Processing options
 * @param {number} [options.chunkSize] - Items per chunk
 * @param {Function} [options.onProgress] - Progress callback: ({processed, total, percent}) => void
 * @param {boolean} [options.continueOnError] - Continue on errors
 * @returns {Promise<Object>} Processing results
 */
async function processBatch(data, processFn, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const startTime = Date.now();
  
  if (!data || data.length === 0) {
    return {
      success: true,
      results: [],
      stats: { processed: 0, total: 0, errors: 0, durationMs: 0 }
    };
  }
  
  const total = data.length;
  const results = [];
  const errors = [];
  let processed = 0;
  let lastProgressTime = startTime;
  
  log.info('Starting batch processing', { 
    total, 
    chunkSize: config.chunkSize 
  });
  
  // Process in chunks
  for (let i = 0; i < data.length; i += config.chunkSize) {
    // Check timeout
    if (Date.now() - startTime > config.timeoutMs) {
      log.warn('Batch processing timeout reached', { 
        processed, 
        total, 
        elapsedMs: Date.now() - startTime 
      });
      break;
    }
    
    const chunk = data.slice(i, Math.min(i + config.chunkSize, data.length));
    
    // Process chunk items
    for (let j = 0; j < chunk.length; j++) {
      try {
        const result = await processFn(chunk[j], i + j);
        results.push(result);
      } catch (error) {
        errors.push({
          index: i + j,
          error: error.message
        });
        
        if (!config.continueOnError) {
          throw error;
        }
      }
      
      processed++;
    }
    
    // Progress callback
    if (config.onProgress && Date.now() - lastProgressTime >= config.progressInterval) {
      config.onProgress({
        processed,
        total,
        percent: Math.round((processed / total) * 100),
        elapsedMs: Date.now() - startTime
      });
      lastProgressTime = Date.now();
    }
  }
  
  const durationMs = Date.now() - startTime;
  
  log.info('Batch processing complete', {
    processed,
    total,
    errors: errors.length,
    durationMs,
    itemsPerSecond: Math.round(processed / (durationMs / 1000))
  });
  
  return {
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    stats: {
      processed,
      total,
      errors: errors.length,
      durationMs,
      itemsPerSecond: Math.round(processed / (durationMs / 1000))
    }
  };
}

/**
 * Process chunks in parallel for independent operations
 * 
 * @param {Array} data - Array of items to process
 * @param {Function} processFn - Async function to process each item
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing results
 */
async function processParallel(data, processFn, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const startTime = Date.now();
  
  if (!data || data.length === 0) {
    return {
      success: true,
      results: [],
      stats: { processed: 0, total: 0, errors: 0, durationMs: 0 }
    };
  }
  
  const total = data.length;
  
  log.info('Starting parallel batch processing', { 
    total, 
    chunkSize: config.chunkSize,
    maxParallel: config.maxParallel
  });
  
  // Split data into chunks
  const chunks = [];
  for (let i = 0; i < data.length; i += config.chunkSize) {
    chunks.push({
      items: data.slice(i, Math.min(i + config.chunkSize, data.length)),
      startIndex: i
    });
  }
  
  // Process chunks in parallel batches
  const allResults = [];
  const allErrors = [];
  
  for (let i = 0; i < chunks.length; i += config.maxParallel) {
    // Check timeout
    if (Date.now() - startTime > config.timeoutMs) {
      log.warn('Parallel processing timeout reached', { 
        chunksProcessed: i, 
        totalChunks: chunks.length 
      });
      break;
    }
    
    const parallelChunks = chunks.slice(i, Math.min(i + config.maxParallel, chunks.length));
    
    // Process parallel chunks
    const chunkPromises = parallelChunks.map(async (chunk) => {
      const results = [];
      const errors = [];
      
      for (let j = 0; j < chunk.items.length; j++) {
        try {
          const result = await processFn(chunk.items[j], chunk.startIndex + j);
          results.push(result);
        } catch (error) {
          errors.push({
            index: chunk.startIndex + j,
            error: error.message
          });
          
          if (!config.continueOnError) {
            throw error;
          }
        }
      }
      
      return { results, errors };
    });
    
    const chunkResults = await Promise.all(chunkPromises);
    
    for (const { results, errors } of chunkResults) {
      allResults.push(...results);
      allErrors.push(...errors);
    }
    
    // Progress callback
    if (config.onProgress) {
      const processed = allResults.length + allErrors.length;
      config.onProgress({
        processed,
        total,
        percent: Math.round((processed / total) * 100),
        elapsedMs: Date.now() - startTime
      });
    }
  }
  
  const durationMs = Date.now() - startTime;
  const processed = allResults.length + allErrors.length;
  
  log.info('Parallel batch processing complete', {
    processed,
    total,
    errors: allErrors.length,
    durationMs,
    itemsPerSecond: Math.round(processed / (durationMs / 1000))
  });
  
  return {
    success: allErrors.length === 0,
    results: allResults,
    errors: allErrors.length > 0 ? allErrors : undefined,
    stats: {
      processed,
      total,
      errors: allErrors.length,
      durationMs,
      itemsPerSecond: Math.round(processed / (durationMs / 1000))
    }
  };
}

/**
 * Aggregate data in batches using a reducer function
 * Memory-efficient for large datasets
 * 
 * @param {Array} data - Array of items to aggregate
 * @param {Function} reducerFn - Reducer function: (accumulator, item, index) => accumulator
 * @param {*} initialValue - Initial accumulator value
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Aggregation result
 */
async function aggregateBatch(data, reducerFn, initialValue, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const startTime = Date.now();
  
  if (!data || data.length === 0) {
    return {
      success: true,
      result: initialValue,
      stats: { processed: 0, total: 0, durationMs: 0 }
    };
  }
  
  const total = data.length;
  let accumulator = initialValue;
  let processed = 0;
  
  log.info('Starting batch aggregation', { 
    total, 
    chunkSize: config.chunkSize 
  });
  
  // Process in chunks
  for (let i = 0; i < data.length; i += config.chunkSize) {
    // Check timeout
    if (Date.now() - startTime > config.timeoutMs) {
      log.warn('Batch aggregation timeout reached', { processed, total });
      break;
    }
    
    const chunk = data.slice(i, Math.min(i + config.chunkSize, data.length));
    
    // Process chunk
    for (let j = 0; j < chunk.length; j++) {
      try {
        accumulator = await reducerFn(accumulator, chunk[j], i + j);
        processed++;
      } catch (error) {
        log.error('Aggregation error', { index: i + j, error: error.message });
        
        if (!config.continueOnError) {
          throw error;
        }
      }
    }
    
    // Progress callback
    if (config.onProgress) {
      config.onProgress({
        processed,
        total,
        percent: Math.round((processed / total) * 100),
        elapsedMs: Date.now() - startTime
      });
    }
  }
  
  const durationMs = Date.now() - startTime;
  
  log.info('Batch aggregation complete', {
    processed,
    total,
    durationMs
  });
  
  return {
    success: true,
    result: accumulator,
    stats: {
      processed,
      total,
      durationMs
    }
  };
}

/**
 * Map function over data in batches
 * Returns transformed results
 * 
 * @param {Array} data - Array of items to map
 * @param {Function} mapFn - Map function: (item, index) => transformedItem
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Mapped results
 */
async function mapBatch(data, mapFn, options = {}) {
  return processBatch(data, mapFn, options);
}

/**
 * Filter data in batches
 * Memory-efficient for large datasets
 * 
 * @param {Array} data - Array of items to filter
 * @param {Function} filterFn - Filter predicate: (item, index) => boolean
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Filtered results
 */
async function filterBatch(data, filterFn, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const startTime = Date.now();
  
  if (!data || data.length === 0) {
    return {
      success: true,
      results: [],
      stats: { processed: 0, total: 0, matched: 0, durationMs: 0 }
    };
  }
  
  const total = data.length;
  const results = [];
  let processed = 0;
  
  // Process in chunks
  for (let i = 0; i < data.length; i += config.chunkSize) {
    // Check timeout
    if (Date.now() - startTime > config.timeoutMs) {
      break;
    }
    
    const chunk = data.slice(i, Math.min(i + config.chunkSize, data.length));
    
    for (let j = 0; j < chunk.length; j++) {
      try {
        const match = await filterFn(chunk[j], i + j);
        if (match) {
          results.push(chunk[j]);
        }
        processed++;
      } catch (error) {
        log.error('Filter error', { index: i + j, error: error.message });
        
        if (!config.continueOnError) {
          throw error;
        }
      }
    }
  }
  
  const durationMs = Date.now() - startTime;
  
  return {
    success: true,
    results,
    stats: {
      processed,
      total,
      matched: results.length,
      durationMs
    }
  };
}

/**
 * Create a streaming processor for very large datasets
 * Processes data as it comes in without holding all in memory
 * 
 * @param {Object} options - Processor options
 * @returns {Object} Stream processor with push/flush methods
 */
function createStreamProcessor(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const buffer = [];
  let totalProcessed = 0;
  let totalErrors = 0;
  const startTime = Date.now();
  
  return {
    /**
     * Push an item to the processor
     * @param {*} item - Item to process
     * @returns {Promise<Array|null>} Processed results if chunk completed, null otherwise
     */
    async push(item) {
      buffer.push(item);
      
      if (buffer.length >= config.chunkSize) {
        return this._processBuffer();
      }
      
      return null;
    },
    
    /**
     * Process any remaining items in buffer
     * @returns {Promise<Object>} Final processing results
     */
    async flush() {
      const results = [];
      
      if (buffer.length > 0) {
        const chunkResults = await this._processBuffer();
        if (chunkResults) {
          results.push(...chunkResults);
        }
      }
      
      return {
        results,
        stats: {
          totalProcessed,
          totalErrors,
          durationMs: Date.now() - startTime
        }
      };
    },
    
    /**
     * Process current buffer
     * @private
     */
    async _processBuffer() {
      const chunk = buffer.splice(0, config.chunkSize);
      const results = [];
      
      for (const item of chunk) {
        try {
          if (options.processFn) {
            const result = await options.processFn(item, totalProcessed);
            results.push(result);
          } else {
            results.push(item);
          }
          totalProcessed++;
        } catch (error) {
          totalErrors++;
          log.error('Stream processor error', { error: error.message });
          
          if (!config.continueOnError) {
            throw error;
          }
        }
      }
      
      return results;
    },
    
    /**
     * Get current stats
     */
    getStats() {
      return {
        buffered: buffer.length,
        totalProcessed,
        totalErrors,
        durationMs: Date.now() - startTime
      };
    }
  };
}

/**
 * Calculate statistics for a numeric dataset in a memory-efficient way
 * Uses single-pass Welford's algorithm for mean and variance
 * 
 * @param {Array<number>} data - Numeric data array
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Statistical results
 */
async function calculateStatsBatch(data, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  
  if (!data || data.length === 0) {
    return { success: false, error: 'No data provided' };
  }
  
  // Welford's online algorithm for mean and variance (single pass)
  let count = 0;
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  
  for (let i = 0; i < data.length; i += config.chunkSize) {
    const chunk = data.slice(i, Math.min(i + config.chunkSize, data.length));
    
    for (const value of chunk) {
      if (value == null || isNaN(value)) continue;
      
      count++;
      const delta = value - mean;
      mean += delta / count;
      const delta2 = value - mean;
      m2 += delta * delta2;
      
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
    }
  }
  
  if (count < 2) {
    return {
      success: false,
      error: 'Insufficient data for statistics (need at least 2 values)'
    };
  }
  
  const variance = m2 / (count - 1); // Sample variance
  const stdDev = Math.sqrt(variance);
  
  return {
    success: true,
    stats: {
      count,
      sum,
      mean: Math.round(mean * 1000) / 1000,
      variance: Math.round(variance * 1000) / 1000,
      stdDev: Math.round(stdDev * 1000) / 1000,
      min,
      max,
      range: max - min
    }
  };
}

module.exports = {
  processBatch,
  processParallel,
  aggregateBatch,
  mapBatch,
  filterBatch,
  createStreamProcessor,
  calculateStatsBatch,
  DEFAULT_CONFIG
};
