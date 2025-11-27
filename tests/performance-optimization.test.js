/**
 * Tests for Performance Optimization Infrastructure
 * 
 * Tests caching, batch processing, query optimization, and response optimization
 */

// Mock MongoDB before requiring modules
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn().mockResolvedValue({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      batchSize: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([])
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    })
  })
}));

// Mock logger
jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

const { 
  PerformanceCache, 
  getCache, 
  getHistoryCache,
  getAnalyticsCache,
  generateCacheKey,
  clearAllCaches,
  getAllCacheStats,
  destroyAllCaches
} = require('../netlify/functions/utils/cache.cjs');

const {
  processBatch,
  processParallel,
  aggregateBatch,
  mapBatch,
  filterBatch,
  createStreamProcessor,
  calculateStatsBatch
} = require('../netlify/functions/utils/batch-processor.cjs');

const {
  QUERY_CONFIG,
  buildTimeSeriesAggregation,
  createDatePartitions
} = require('../netlify/functions/utils/query-optimizer.cjs');

const {
  CACHE_PRESETS,
  buildOptimizedResponse,
  createChunkedResponse,
  generateETag,
  shouldReturn304,
  buildConditionalResponse,
  optimizeResponseSize,
  buildErrorResponse
} = require('../netlify/functions/utils/response-optimizer.cjs');

describe('Performance Optimization Infrastructure', () => {
  
  // Test configuration - explicitly enable caching in tests
  const testCacheConfig = { cleanupInterval: 0, enabled: true };
  
  beforeEach(() => {
    clearAllCaches();
  });
  
  afterAll(() => {
    destroyAllCaches();
  });
  
  describe('Cache Module', () => {
    
    describe('PerformanceCache', () => {
      
      test('should create cache with default config', () => {
        const cache = new PerformanceCache('test-namespace', testCacheConfig);
        expect(cache.namespace).toBe('test-namespace');
        expect(cache.config.maxSize).toBe(100);
        cache.destroy();
      });
      
      test('should set and get values', () => {
        const cache = new PerformanceCache('test', testCacheConfig);
        
        cache.set('key1', { data: 'value1' });
        const result = cache.get('key1');
        
        expect(result).toEqual({ data: 'value1' });
        cache.destroy();
      });
      
      test('should return null for non-existent keys', () => {
        const cache = new PerformanceCache('test', testCacheConfig);
        
        const result = cache.get('nonexistent');
        
        expect(result).toBeNull();
        cache.destroy();
      });
      
      test('should expire values after TTL', async () => {
        const cache = new PerformanceCache('test', { 
          ...testCacheConfig,
          defaultTTL: 50 // 50ms
        });
        
        cache.set('key1', 'value1');
        expect(cache.get('key1')).toBe('value1');
        
        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 100));
        
        expect(cache.get('key1')).toBeNull();
        cache.destroy();
      });
      
      test('should evict LRU when at capacity', () => {
        const cache = new PerformanceCache('test', { 
          ...testCacheConfig,
          maxSize: 3
        });
        
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        cache.set('key3', 'value3');
        
        // Access key2 to make it more recently used
        cache.get('key2');
        
        // Add new key, should evict key1 (LRU)
        cache.set('key4', 'value4');
        
        expect(cache.get('key1')).toBeNull(); // Evicted
        expect(cache.get('key2')).toBe('value2');
        expect(cache.get('key3')).toBe('value3');
        expect(cache.get('key4')).toBe('value4');
        cache.destroy();
      });
      
      test('should track cache statistics', () => {
        const cache = new PerformanceCache('test', testCacheConfig);
        
        cache.set('key1', 'value1');
        cache.get('key1'); // Hit
        cache.get('key1'); // Hit
        cache.get('nonexistent'); // Miss
        
        const stats = cache.getStats();
        
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBe('66.67%');
        cache.destroy();
      });
      
      test('should support getOrSet pattern', async () => {
        const cache = new PerformanceCache('test', testCacheConfig);
        let computeCount = 0;
        
        const computeFn = async () => {
          computeCount++;
          return { computed: true };
        };
        
        // First call should compute
        const result1 = await cache.getOrSet('key1', computeFn);
        expect(result1).toEqual({ computed: true });
        expect(computeCount).toBe(1);
        
        // Second call should use cache
        const result2 = await cache.getOrSet('key1', computeFn);
        expect(result2).toEqual({ computed: true });
        expect(computeCount).toBe(1); // Still 1
        cache.destroy();
      });
      
      test('should invalidate by pattern', () => {
        const cache = new PerformanceCache('test', testCacheConfig);
        
        cache.set('system:123:hourly', 'data1');
        cache.set('system:123:daily', 'data2');
        cache.set('system:456:hourly', 'data3');
        
        const invalidated = cache.invalidateByPattern(/system:123/);
        
        expect(invalidated).toBe(2);
        expect(cache.get('system:123:hourly')).toBeNull();
        expect(cache.get('system:123:daily')).toBeNull();
        expect(cache.get('system:456:hourly')).toBe('data3');
        cache.destroy();
      });
    });
    
    describe('Cache Factory Functions', () => {
      
      test('getCache should return same instance for same namespace', () => {
        const cache1 = getCache('test-ns');
        const cache2 = getCache('test-ns');
        
        expect(cache1).toBe(cache2);
      });
      
      test('getHistoryCache should have appropriate TTL', () => {
        const cache = getHistoryCache();
        expect(cache.config.defaultTTL).toBe(600000); // 10 minutes
      });
      
      test('getAnalyticsCache should have appropriate TTL', () => {
        const cache = getAnalyticsCache();
        expect(cache.config.defaultTTL).toBe(300000); // 5 minutes
      });
      
      test('generateCacheKey should create deterministic keys', () => {
        const key1 = generateCacheKey('test', { a: 1, b: 2 });
        const key2 = generateCacheKey('test', { b: 2, a: 1 }); // Different order
        
        expect(key1).toBe(key2); // Should be same (sorted keys)
        expect(key1).toBe('test:a=1:b=2');
      });
      
      test('getAllCacheStats should return stats for all caches', () => {
        getCache('cache1');
        getCache('cache2');
        
        const stats = getAllCacheStats();
        
        expect(stats.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
  
  describe('Batch Processor Module', () => {
    
    describe('processBatch', () => {
      
      test('should process empty array', async () => {
        const result = await processBatch([], async (item) => item);
        
        expect(result.success).toBe(true);
        expect(result.results).toEqual([]);
        expect(result.stats.processed).toBe(0);
      });
      
      test('should process all items', async () => {
        const data = [1, 2, 3, 4, 5];
        
        const result = await processBatch(data, async (item) => item * 2);
        
        expect(result.success).toBe(true);
        expect(result.results).toEqual([2, 4, 6, 8, 10]);
        expect(result.stats.processed).toBe(5);
      });
      
      test('should process in chunks', async () => {
        const data = Array.from({ length: 10 }, (_, i) => i);
        let chunkCalls = 0;
        
        const result = await processBatch(data, async (item) => {
          return item;
        }, { 
          chunkSize: 3,
          onProgress: () => { chunkCalls++; }
        });
        
        expect(result.success).toBe(true);
        expect(result.stats.processed).toBe(10);
      });
      
      test('should handle errors with continueOnError', async () => {
        const data = [1, 2, 3, 4, 5];
        
        const result = await processBatch(data, async (item) => {
          if (item === 3) throw new Error('Test error');
          return item;
        }, { continueOnError: true });
        
        expect(result.success).toBe(false);
        expect(result.results.length).toBe(4); // 1, 2, 4, 5 processed
        expect(result.errors.length).toBe(1);
        expect(result.stats.errors).toBe(1);
      });
      
      test('should call progress callback', async () => {
        const data = Array.from({ length: 100 }, (_, i) => i);
        const progressCalls = [];
        
        await processBatch(data, async (item) => item, {
          chunkSize: 25,
          progressInterval: 0,
          onProgress: (progress) => progressCalls.push(progress)
        });
        
        expect(progressCalls.length).toBeGreaterThan(0);
        expect(progressCalls[progressCalls.length - 1].percent).toBe(100);
      });
    });
    
    describe('processParallel', () => {
      
      test('should process items in parallel', async () => {
        const data = [1, 2, 3, 4, 5, 6];
        
        const result = await processParallel(data, async (item) => item * 2, {
          chunkSize: 2,
          maxParallel: 2
        });
        
        expect(result.success).toBe(true);
        expect(result.stats.processed).toBe(6);
      });
    });
    
    describe('aggregateBatch', () => {
      
      test('should aggregate values', async () => {
        const data = [1, 2, 3, 4, 5];
        
        const result = await aggregateBatch(
          data,
          async (acc, item) => acc + item,
          0
        );
        
        expect(result.success).toBe(true);
        expect(result.result).toBe(15);
      });
      
      test('should handle empty array', async () => {
        const result = await aggregateBatch([], async (acc, item) => acc + item, 0);
        
        expect(result.success).toBe(true);
        expect(result.result).toBe(0);
      });
    });
    
    describe('filterBatch', () => {
      
      test('should filter items', async () => {
        const data = [1, 2, 3, 4, 5, 6];
        
        const result = await filterBatch(data, async (item) => item % 2 === 0);
        
        expect(result.success).toBe(true);
        expect(result.results).toEqual([2, 4, 6]);
        expect(result.stats.matched).toBe(3);
      });
    });
    
    describe('createStreamProcessor', () => {
      
      test('should process streamed items', async () => {
        const processor = createStreamProcessor({
          chunkSize: 3,
          processFn: async (item) => item * 2
        });
        
        // Push items
        await processor.push(1);
        await processor.push(2);
        const chunk1 = await processor.push(3); // Should trigger chunk processing
        
        expect(chunk1).toEqual([2, 4, 6]);
        
        // Flush remaining
        await processor.push(4);
        const final = await processor.flush();
        
        expect(final.results).toEqual([8]);
        expect(final.stats.totalProcessed).toBe(4);
      });
    });
    
    describe('calculateStatsBatch', () => {
      
      test('should calculate statistics correctly', async () => {
        const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        
        const result = await calculateStatsBatch(data);
        
        expect(result.success).toBe(true);
        expect(result.stats.count).toBe(10);
        expect(result.stats.mean).toBe(5.5);
        expect(result.stats.min).toBe(1);
        expect(result.stats.max).toBe(10);
        expect(result.stats.sum).toBe(55);
      });
      
      test('should handle empty data', async () => {
        const result = await calculateStatsBatch([]);
        
        expect(result.success).toBe(false);
      });
      
      test('should handle single value', async () => {
        const data = [42];
        
        const result = await calculateStatsBatch(data);
        
        expect(result.success).toBe(true);
        expect(result.stats.count).toBe(1);
        expect(result.stats.mean).toBe(42);
        expect(result.stats.min).toBe(42);
        expect(result.stats.max).toBe(42);
        expect(result.stats.variance).toBe(0);
        expect(result.stats.stdDev).toBe(0);
        expect(result.note).toBeDefined();
      });
      
      test('should filter null values', async () => {
        const data = [1, null, 2, undefined, 3, NaN];
        
        const result = await calculateStatsBatch(data);
        
        expect(result.success).toBe(true);
        expect(result.stats.count).toBe(3);
        expect(result.stats.mean).toBe(2);
      });
    });
  });
  
  describe('Query Optimizer Module', () => {
    
    describe('buildTimeSeriesAggregation', () => {
      
      test('should build hourly aggregation pipeline', () => {
        const pipeline = buildTimeSeriesAggregation({
          systemId: 'test-system',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          granularity: 'hourly'
        });
        
        expect(pipeline.length).toBeGreaterThan(0);
        expect(pipeline[0].$match.systemId).toBe('test-system');
      });
      
      test('should build daily aggregation pipeline', () => {
        const pipeline = buildTimeSeriesAggregation({
          systemId: 'test-system',
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-31'),
          granularity: 'daily'
        });
        
        expect(pipeline.length).toBeGreaterThan(0);
        // Check that grouping doesn't include hour
        const groupStage = pipeline.find(s => s.$group);
        expect(groupStage.$group._id).not.toHaveProperty('hour');
      });
    });
    
    describe('createDatePartitions', () => {
      
      test('should create correct number of partitions', () => {
        const start = new Date('2024-01-01');
        const end = new Date('2024-01-31');
        
        const partitions = createDatePartitions(start, end, 4);
        
        expect(partitions.length).toBe(4);
        expect(partitions[0].start.toISOString()).toBe(start.toISOString());
        expect(partitions[3].end.toISOString()).toBe(end.toISOString());
      });
      
      test('should have non-overlapping partitions', () => {
        const partitions = createDatePartitions(
          new Date('2024-01-01'),
          new Date('2024-01-10'),
          5
        );
        
        for (let i = 0; i < partitions.length - 1; i++) {
          expect(partitions[i].end.getTime()).toBeLessThanOrEqual(
            partitions[i + 1].start.getTime()
          );
        }
      });
    });
  });
  
  describe('Response Optimizer Module', () => {
    
    describe('CACHE_PRESETS', () => {
      
      test('should have all required presets', () => {
        expect(CACHE_PRESETS).toHaveProperty('realtime');
        expect(CACHE_PRESETS).toHaveProperty('shortLived');
        expect(CACHE_PRESETS).toHaveProperty('historical');
        expect(CACHE_PRESETS).toHaveProperty('static');
        expect(CACHE_PRESETS).toHaveProperty('noCache');
        expect(CACHE_PRESETS).toHaveProperty('immutable');
      });
    });
    
    describe('buildOptimizedResponse', () => {
      
      test('should build response without compression for small data', async () => {
        const response = await buildOptimizedResponse(200, { test: 'data' });
        
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('{"test":"data"}');
        expect(response.headers['Content-Type']).toBe('application/json');
      });
      
      test('should include cache headers', async () => {
        const response = await buildOptimizedResponse(200, { test: 'data' }, {
          cachePreset: 'historical'
        });
        
        expect(response.headers['Cache-Control']).toContain('max-age=3600');
      });
      
      test('should compress large responses', async () => {
        const largeData = { data: 'x'.repeat(10000) };
        
        const response = await buildOptimizedResponse(200, largeData, {
          compress: true,
          acceptEncoding: 'gzip'
        });
        
        expect(response.headers['Content-Encoding']).toBe('gzip');
        expect(response.isBase64Encoded).toBe(true);
      });
    });
    
    describe('createChunkedResponse', () => {
      
      test('should chunk array data', () => {
        const data = Array.from({ length: 250 }, (_, i) => i);
        
        const chunk0 = createChunkedResponse(data, 100, { chunkIndex: 0 });
        const chunk1 = createChunkedResponse(data, 100, { chunkIndex: 1 });
        const chunk2 = createChunkedResponse(data, 100, { chunkIndex: 2 });
        
        expect(chunk0.chunk.length).toBe(100);
        expect(chunk0.metadata.hasMore).toBe(true);
        expect(chunk1.chunk.length).toBe(100);
        expect(chunk2.chunk.length).toBe(50);
        expect(chunk2.metadata.hasMore).toBe(false);
      });
    });
    
    describe('generateETag', () => {
      
      test('should generate consistent ETags', () => {
        const data = { test: 'value' };
        
        const etag1 = generateETag(data);
        const etag2 = generateETag(data);
        
        expect(etag1).toBe(etag2);
        expect(etag1).toMatch(/^"[a-f0-9]+"$/);
      });
      
      test('should generate different ETags for different data', () => {
        const etag1 = generateETag({ a: 1 });
        const etag2 = generateETag({ a: 2 });
        
        expect(etag1).not.toBe(etag2);
      });
    });
    
    describe('shouldReturn304', () => {
      
      test('should return true for matching ETags', () => {
        expect(shouldReturn304('"abc123"', '"abc123"')).toBe(true);
      });
      
      test('should return false for non-matching ETags', () => {
        expect(shouldReturn304('"abc123"', '"def456"')).toBe(false);
      });
      
      test('should return false for null values', () => {
        expect(shouldReturn304(null, '"abc123"')).toBe(false);
        expect(shouldReturn304('"abc123"', null)).toBe(false);
      });
    });
    
    describe('buildConditionalResponse', () => {
      
      test('should return 304 for matching ETag', () => {
        const data = { test: 'value' };
        const etag = generateETag(data);
        
        const response = buildConditionalResponse(data, { ifNoneMatch: etag });
        
        expect(response.statusCode).toBe(304);
        expect(response.body).toBe('');
      });
      
      test('should return full response for non-matching ETag', () => {
        const data = { test: 'value' };
        
        const response = buildConditionalResponse(data, { ifNoneMatch: '"different"' });
        
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(JSON.stringify(data));
      });
    });
    
    describe('optimizeResponseSize', () => {
      
      test('should remove excluded fields', () => {
        const data = { _id: '123', name: 'test', value: 1 };
        
        const optimized = optimizeResponseSize(data, { excludeFields: ['_id'] });
        
        expect(optimized).not.toHaveProperty('_id');
        expect(optimized).toHaveProperty('name');
        expect(optimized).toHaveProperty('value');
      });
      
      test('should handle nested objects', () => {
        const data = {
          _id: '123',
          nested: {
            _id: '456',
            value: 'test'
          }
        };
        
        const optimized = optimizeResponseSize(data, { excludeFields: ['_id'] });
        
        expect(optimized).not.toHaveProperty('_id');
        expect(optimized.nested).not.toHaveProperty('_id');
        expect(optimized.nested.value).toBe('test');
      });
      
      test('should truncate large arrays', () => {
        const data = { items: Array.from({ length: 2000 }, (_, i) => i) };
        
        const optimized = optimizeResponseSize(data, { maxArrayLength: 100 });
        
        expect(optimized.items.length).toBe(100);
      });
      
      test('should remove null/undefined values', () => {
        const data = { a: 1, b: null, c: undefined, d: 2 };
        
        const optimized = optimizeResponseSize(data);
        
        expect(optimized).toEqual({ a: 1, d: 2 });
      });
    });
    
    describe('buildErrorResponse', () => {
      
      test('should build proper error response', () => {
        const response = buildErrorResponse(404, 'NOT_FOUND', 'Resource not found');
        
        expect(response.statusCode).toBe(404);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.message).toBe('Resource not found');
        expect(body.error.timestamp).toBeDefined();
      });
      
      test('should include details when provided', () => {
        const response = buildErrorResponse(400, 'VALIDATION_ERROR', 'Invalid input', {
          field: 'email',
          issue: 'Invalid format'
        });
        
        const body = JSON.parse(response.body);
        expect(body.error.details).toEqual({
          field: 'email',
          issue: 'Invalid format'
        });
      });
    });
  });
});
