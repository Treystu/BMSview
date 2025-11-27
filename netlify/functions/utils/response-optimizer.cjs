// @ts-nocheck
/**
 * Response Optimization Utilities for API Responses
 * 
 * Provides utilities for:
 * - Response compression
 * - Cache-Control headers
 * - Response chunking for large payloads
 * - Content negotiation
 * 
 * @module netlify/functions/utils/response-optimizer
 */

const { createLogger } = require('./logger.cjs');
const zlib = require('zlib');
const { promisify } = require('util');

const log = createLogger('utils/response-optimizer');

const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

/**
 * Response optimization configuration
 */
const RESPONSE_CONFIG = {
  compressionThreshold: 1024,     // Compress responses > 1KB
  maxUncompressedSize: 1048576,   // 1MB max uncompressed
  defaultCacheMaxAge: 300,        // 5 minutes default cache
  staticCacheMaxAge: 3600,        // 1 hour for static data
  realtimeCacheMaxAge: 60,        // 1 minute for real-time data
  compressionLevel: 6             // Balanced compression level (1-9)
};

/**
 * Cache-Control header presets for different data types
 */
const CACHE_PRESETS = {
  // Real-time data (current battery state, live metrics)
  realtime: {
    'Cache-Control': 'private, max-age=60, stale-while-revalidate=30',
    'Vary': 'Accept-Encoding'
  },
  
  // Short-lived data (aggregated hourly data)
  shortLived: {
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    'Vary': 'Accept-Encoding'
  },
  
  // Historical data (daily/weekly aggregations)
  historical: {
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300',
    'Vary': 'Accept-Encoding'
  },
  
  // Static data (system config, metadata)
  static: {
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    'Vary': 'Accept-Encoding'
  },
  
  // No cache (dynamic/personalized content)
  noCache: {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  },
  
  // Immutable (versioned content that never changes)
  immutable: {
    'Cache-Control': 'public, max-age=31536000, immutable'
  }
};

/**
 * Build optimized response with compression and caching headers
 * 
 * @param {number} statusCode - HTTP status code
 * @param {*} body - Response body (will be JSON stringified)
 * @param {Object} options - Response options
 * @param {string} [options.cachePreset='noCache'] - Cache preset name
 * @param {boolean} [options.compress=true] - Enable compression
 * @param {string} [options.acceptEncoding] - Accept-Encoding header from request
 * @param {Object} [options.headers] - Additional headers
 * @returns {Promise<Object>} Netlify function response
 */
async function buildOptimizedResponse(statusCode, body, options = {}) {
  const {
    cachePreset = 'noCache',
    compress = true,
    acceptEncoding = '',
    headers = {}
  } = options;
  
  const startTime = Date.now();
  
  // Stringify body
  let bodyString = typeof body === 'string' ? body : JSON.stringify(body);
  const originalSize = Buffer.byteLength(bodyString, 'utf8');
  
  // Get cache headers
  const cacheHeaders = CACHE_PRESETS[cachePreset] || CACHE_PRESETS.noCache;
  
  // Base headers
  const responseHeaders = {
    'Content-Type': 'application/json',
    ...cacheHeaders,
    ...headers,
    'X-Response-Time': `${Date.now() - startTime}ms`,
    'X-Content-Length-Original': originalSize.toString()
  };
  
  // Check if compression should be applied
  const shouldCompress = compress && 
    originalSize > RESPONSE_CONFIG.compressionThreshold &&
    statusCode !== 204;
  
  if (shouldCompress) {
    const encoding = selectEncoding(acceptEncoding);
    
    if (encoding) {
      try {
        const compressed = await compressBody(bodyString, encoding);
        const compressedSize = compressed.length;
        const ratio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
        
        log.debug('Response compressed', {
          encoding,
          originalSize,
          compressedSize,
          ratio: `${ratio}%`
        });
        
        return {
          statusCode,
          body: compressed.toString('base64'),
          isBase64Encoded: true,
          headers: {
            ...responseHeaders,
            'Content-Encoding': encoding,
            'Content-Length': compressedSize.toString(),
            'X-Compression-Ratio': ratio
          }
        };
      } catch (error) {
        log.warn('Compression failed, returning uncompressed', { error: error.message });
      }
    }
  }
  
  // Return uncompressed
  return {
    statusCode,
    body: bodyString,
    headers: responseHeaders
  };
}

/**
 * Select best encoding based on Accept-Encoding header
 * 
 * @param {string} acceptEncoding - Accept-Encoding header value
 * @returns {string|null} Selected encoding or null
 */
function selectEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;
  
  const encodings = acceptEncoding.toLowerCase();
  
  // Prefer gzip as it has better browser support
  if (encodings.includes('gzip')) return 'gzip';
  if (encodings.includes('deflate')) return 'deflate';
  
  return null;
}

/**
 * Compress body with selected encoding
 * 
 * @param {string} body - Body to compress
 * @param {string} encoding - Encoding to use
 * @returns {Promise<Buffer>} Compressed body
 */
async function compressBody(body, encoding) {
  const options = { level: RESPONSE_CONFIG.compressionLevel };
  
  switch (encoding) {
    case 'gzip':
      return gzip(Buffer.from(body), options);
    case 'deflate':
      return deflate(Buffer.from(body), options);
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

/**
 * Chunk large response into manageable pieces
 * Useful for streaming or progressive loading
 * 
 * @param {Array} data - Array of items to chunk
 * @param {number} chunkSize - Items per chunk
 * @param {Object} options - Chunking options
 * @returns {Object} Chunked response with metadata
 */
function createChunkedResponse(data, chunkSize = 100, options = {}) {
  const {
    chunkIndex = 0,
    includeMetadata = true
  } = options;
  
  if (!Array.isArray(data)) {
    return {
      success: false,
      error: 'Data must be an array'
    };
  }
  
  const totalChunks = Math.ceil(data.length / chunkSize);
  const startIndex = chunkIndex * chunkSize;
  const chunk = data.slice(startIndex, startIndex + chunkSize);
  
  const response = {
    chunk,
    chunkSize: chunk.length
  };
  
  if (includeMetadata) {
    response.metadata = {
      chunkIndex,
      totalChunks,
      totalItems: data.length,
      hasMore: chunkIndex < totalChunks - 1,
      nextChunk: chunkIndex < totalChunks - 1 ? chunkIndex + 1 : null
    };
  }
  
  return response;
}

/**
 * Build ETag for response caching
 * 
 * @param {*} data - Data to generate ETag for
 * @returns {string} ETag value
 */
function generateETag(data) {
  const crypto = require('crypto');
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = crypto.createHash('md5').update(content).digest('hex');
  return `"${hash.substring(0, 16)}"`;
}

/**
 * Check if response should return 304 Not Modified
 * 
 * @param {string} requestIfNoneMatch - If-None-Match header from request
 * @param {string} currentETag - Current ETag value
 * @returns {boolean} True if should return 304
 */
function shouldReturn304(requestIfNoneMatch, currentETag) {
  if (!requestIfNoneMatch || !currentETag) return false;
  return requestIfNoneMatch === currentETag;
}

/**
 * Build conditional response with ETag support
 * 
 * @param {*} data - Response data
 * @param {Object} options - Response options
 * @returns {Object} Response object
 */
function buildConditionalResponse(data, options = {}) {
  const {
    statusCode = 200,
    ifNoneMatch = null,
    cachePreset = 'shortLived',
    headers = {}
  } = options;
  
  const etag = generateETag(data);
  
  // Check for 304
  if (shouldReturn304(ifNoneMatch, etag)) {
    return {
      statusCode: 304,
      body: '',
      headers: {
        'ETag': etag,
        ...CACHE_PRESETS[cachePreset]
      }
    };
  }
  
  // Return full response with ETag
  return {
    statusCode,
    body: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json',
      'ETag': etag,
      ...CACHE_PRESETS[cachePreset],
      ...headers
    }
  };
}

/**
 * Optimize response size by removing unnecessary fields
 * 
 * @param {Object|Array} data - Data to optimize
 * @param {Object} options - Optimization options
 * @returns {Object|Array} Optimized data
 */
function optimizeResponseSize(data, options = {}) {
  const {
    excludeFields = ['_id'],
    includeFields = null, // If set, only include these fields
    maxDepth = 5,
    maxArrayLength = 1000
  } = options;
  
  function optimize(obj, depth = 0) {
    if (depth > maxDepth) return obj;
    
    if (Array.isArray(obj)) {
      // Truncate large arrays
      const truncated = obj.length > maxArrayLength 
        ? obj.slice(0, maxArrayLength)
        : obj;
      return truncated.map(item => optimize(item, depth + 1));
    }
    
    if (obj && typeof obj === 'object') {
      const result = {};
      
      for (const [key, value] of Object.entries(obj)) {
        // Skip excluded fields
        if (excludeFields.includes(key)) continue;
        
        // Only include specified fields (if set)
        if (includeFields && !includeFields.includes(key)) continue;
        
        // Skip null/undefined values to save space
        if (value === null || value === undefined) continue;
        
        result[key] = optimize(value, depth + 1);
      }
      
      return result;
    }
    
    return obj;
  }
  
  return optimize(data);
}

/**
 * Build streaming response headers for large datasets
 * 
 * @param {Object} options - Stream options
 * @returns {Object} Response headers for streaming
 */
function buildStreamingHeaders(options = {}) {
  const {
    contentType = 'application/json',
    totalSize = null
  } = options;
  
  return {
    'Content-Type': contentType,
    'Transfer-Encoding': 'chunked',
    'X-Content-Type-Options': 'nosniff',
    ...(totalSize && { 'X-Total-Size': totalSize.toString() })
  };
}

/**
 * Create CORS headers for cross-origin requests
 * 
 * @param {Object} options - CORS options
 * @returns {Object} CORS headers
 */
function buildCORSHeaders(options = {}) {
  const {
    origin = '*',
    methods = 'GET, POST, OPTIONS',
    headers = 'Content-Type, Authorization, Accept-Encoding',
    maxAge = 86400
  } = options;
  
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': headers,
    'Access-Control-Max-Age': maxAge.toString()
  };
}

/**
 * Build a standard error response with proper caching
 * 
 * @param {number} statusCode - Error status code
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {Object} [details] - Additional error details
 * @returns {Object} Error response
 */
function buildErrorResponse(statusCode, code, message, details = null) {
  const body = {
    error: {
      code,
      message,
      ...(details && { details }),
      timestamp: new Date().toISOString()
    }
  };
  
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...CACHE_PRESETS.noCache
    }
  };
}

module.exports = {
  RESPONSE_CONFIG,
  CACHE_PRESETS,
  buildOptimizedResponse,
  selectEncoding,
  compressBody,
  createChunkedResponse,
  generateETag,
  shouldReturn304,
  buildConditionalResponse,
  optimizeResponseSize,
  buildStreamingHeaders,
  buildCORSHeaders,
  buildErrorResponse
};
