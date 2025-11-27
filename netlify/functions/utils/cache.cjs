// @ts-nocheck
/**
 * In-Memory Cache Utility for Performance Optimization
 * 
 * Provides a lightweight caching layer for frequently accessed data with:
 * - TTL (time-to-live) based expiration
 * - LRU (least-recently-used) eviction when size limits are reached
 * - Namespace isolation for different data types
 * - Cache statistics for monitoring
 * 
 * @module netlify/functions/utils/cache
 */

const { createLogger } = require('./logger.cjs');

// Module-scoped cache instances
const caches = new Map();
const log = createLogger('utils/cache');

/**
 * Default cache configuration
 * 
 * Caching can be disabled via:
 * - Setting enabled: false in config when creating cache
 * - Setting NODE_ENV=test (automatically disabled in test environment)
 * - Setting DISABLE_CACHE=true environment variable
 */
const DEFAULT_CONFIG = {
  maxSize: 100,           // Maximum number of entries
  defaultTTL: 300000,     // Default TTL: 5 minutes (in ms)
  cleanupInterval: 60000, // Cleanup expired entries every minute
  enabled: process.env.DISABLE_CACHE !== 'true' && process.env.NODE_ENV !== 'test'
};

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {*} value - Cached value
 * @property {number} createdAt - Timestamp when entry was created
 * @property {number} expiresAt - Timestamp when entry expires
 * @property {number} lastAccessedAt - Timestamp when entry was last accessed
 * @property {number} accessCount - Number of times entry was accessed
 * @property {number} size - Estimated size of entry in bytes
 */

/**
 * Cache class with TTL and LRU eviction
 */
class PerformanceCache {
  /**
   * Create a new cache instance
   * @param {string} namespace - Namespace for this cache (e.g., 'history', 'analytics')
   * @param {Object} config - Configuration options
   */
  constructor(namespace, config = {}) {
    this.namespace = namespace;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expired: 0,
      totalSize: 0
    };
    
    // Start cleanup interval
    if (this.config.enabled && this.config.cleanupInterval > 0) {
      this._startCleanup();
    }
    
    log.info('Cache initialized', { 
      namespace, 
      maxSize: this.config.maxSize,
      defaultTTL: this.config.defaultTTL 
    });
  }
  
  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*|null} Cached value or null if not found/expired
   */
  get(key) {
    if (!this.config.enabled) {
      return null;
    }
    
    const entry = this.store.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.expired++;
      this.stats.misses++;
      this.stats.totalSize -= entry.size;
      return null;
    }
    
    // Update access metadata for LRU
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    this.stats.hits++;
    
    log.debug('Cache hit', { namespace: this.namespace, key });
    return entry.value;
  }
  
  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} [ttl] - Optional TTL in milliseconds (overrides default)
   * @returns {boolean} True if successfully cached
   */
  set(key, value, ttl) {
    if (!this.config.enabled) {
      return false;
    }
    
    // Estimate size of value
    const size = this._estimateSize(value);
    const effectiveTTL = ttl || this.config.defaultTTL;
    const now = Date.now();
    
    // Evict if at capacity
    if (this.store.size >= this.config.maxSize && !this.store.has(key)) {
      this._evictLRU();
    }
    
    // Remove existing entry size if updating
    if (this.store.has(key)) {
      const existing = this.store.get(key);
      this.stats.totalSize -= existing.size;
    }
    
    const entry = {
      value,
      createdAt: now,
      expiresAt: now + effectiveTTL,
      lastAccessedAt: now,
      accessCount: 0,
      size
    };
    
    this.store.set(key, entry);
    this.stats.totalSize += size;
    
    log.debug('Cache set', { 
      namespace: this.namespace, 
      key, 
      ttl: effectiveTTL,
      size 
    });
    
    return true;
  }
  
  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   * @returns {boolean} True if entry existed and was deleted
   */
  delete(key) {
    const entry = this.store.get(key);
    if (entry) {
      this.stats.totalSize -= entry.size;
      this.store.delete(key);
      log.debug('Cache delete', { namespace: this.namespace, key });
      return true;
    }
    return false;
  }
  
  /**
   * Clear all entries in cache
   */
  clear() {
    this.store.clear();
    this.stats.totalSize = 0;
    log.info('Cache cleared', { namespace: this.namespace });
  }
  
  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    if (!this.config.enabled) {
      return false;
    }
    
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.totalSize -= entry.size;
      this.stats.expired++;
      return false;
    }
    
    return true;
  }
  
  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      namespace: this.namespace,
      size: this.store.size,
      maxSize: this.config.maxSize,
      totalSizeBytes: this.stats.totalSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: `${hitRate}%`,
      evictions: this.stats.evictions,
      expired: this.stats.expired
    };
  }
  
  /**
   * Get or set pattern - fetch from cache or compute and cache
   * @param {string} key - Cache key
   * @param {Function} computeFn - Async function to compute value if not cached
   * @param {number} [ttl] - Optional TTL in milliseconds
   * @returns {Promise<*>} Cached or computed value
   */
  async getOrSet(key, computeFn, ttl) {
    // Try cache first
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }
    
    // Compute value
    const value = await computeFn();
    
    // Cache the result
    this.set(key, value, ttl);
    
    return value;
  }
  
  /**
   * Warm cache with pre-computed values
   * @param {Array<{key: string, value: *, ttl?: number}>} entries - Entries to warm
   */
  warmCache(entries) {
    let warmed = 0;
    for (const entry of entries) {
      if (this.set(entry.key, entry.value, entry.ttl)) {
        warmed++;
      }
    }
    log.info('Cache warmed', { namespace: this.namespace, entriesWarmed: warmed });
    return warmed;
  }
  
  /**
   * Invalidate entries matching a pattern
   * @param {RegExp|string} pattern - Key pattern to match
   * @returns {number} Number of entries invalidated
   */
  invalidateByPattern(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let invalidated = 0;
    
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        invalidated++;
      }
    }
    
    log.info('Cache invalidated by pattern', { 
      namespace: this.namespace, 
      pattern: pattern.toString(),
      invalidated 
    });
    
    return invalidated;
  }
  
  /**
   * Estimate size of a value in bytes
   * @private
   */
  _estimateSize(value) {
    try {
      const str = JSON.stringify(value);
      return str ? str.length * 2 : 0; // Rough estimate: 2 bytes per character
    } catch {
      return 1000; // Default estimate for non-serializable values
    }
  }
  
  /**
   * Evict least recently used entry
   * @private
   */
  _evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.store.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      const entry = this.store.get(oldestKey);
      this.stats.totalSize -= entry.size;
      this.store.delete(oldestKey);
      this.stats.evictions++;
      log.debug('Cache LRU eviction', { namespace: this.namespace, key: oldestKey });
    }
  }
  
  /**
   * Start background cleanup of expired entries
   * @private
   */
  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      this._cleanupExpired();
    }, this.config.cleanupInterval);
    
    // Ensure timer doesn't prevent process exit
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }
  
  /**
   * Clean up expired entries
   * @private
   */
  _cleanupExpired() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.stats.totalSize -= entry.size;
        this.store.delete(key);
        this.stats.expired++;
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      log.debug('Cache cleanup', { namespace: this.namespace, cleanedEntries: cleaned });
    }
  }
  
  /**
   * Stop the cleanup timer (for testing/shutdown)
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.clear();
  }
}

/**
 * Get or create a cache instance by namespace
 * @param {string} namespace - Cache namespace
 * @param {Object} [config] - Optional configuration
 * @returns {PerformanceCache}
 */
function getCache(namespace, config = {}) {
  if (!caches.has(namespace)) {
    caches.set(namespace, new PerformanceCache(namespace, config));
  }
  return caches.get(namespace);
}

/**
 * Pre-configured cache for historical data (longer TTL)
 */
function getHistoryCache() {
  return getCache('history', {
    maxSize: 200,
    defaultTTL: 600000 // 10 minutes for historical data
  });
}

/**
 * Pre-configured cache for analytics results (shorter TTL)
 */
function getAnalyticsCache() {
  return getCache('analytics', {
    maxSize: 50,
    defaultTTL: 300000 // 5 minutes for analytics
  });
}

/**
 * Pre-configured cache for aggregated data
 */
function getAggregationCache() {
  return getCache('aggregation', {
    maxSize: 100,
    defaultTTL: 180000 // 3 minutes for aggregations
  });
}

/**
 * Generate cache key from parameters
 * @param {string} prefix - Key prefix (e.g., function name)
 * @param {Object} params - Parameters to include in key
 * @returns {string} Cache key
 */
function generateCacheKey(prefix, params) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join(':');
  return `${prefix}:${sortedParams}`;
}

/**
 * Clear all caches (useful for testing)
 */
function clearAllCaches() {
  for (const cache of caches.values()) {
    cache.clear();
  }
  log.info('All caches cleared');
}

/**
 * Get stats for all caches
 * @returns {Array<Object>} Array of cache stats
 */
function getAllCacheStats() {
  const stats = [];
  for (const cache of caches.values()) {
    stats.push(cache.getStats());
  }
  return stats;
}

/**
 * Destroy all cache instances (for cleanup)
 */
function destroyAllCaches() {
  for (const cache of caches.values()) {
    cache.destroy();
  }
  caches.clear();
  log.info('All caches destroyed');
}

module.exports = {
  PerformanceCache,
  getCache,
  getHistoryCache,
  getAnalyticsCache,
  getAggregationCache,
  generateCacheKey,
  clearAllCaches,
  getAllCacheStats,
  destroyAllCaches
};
