"use strict";

/**
 * Rate Limiter Utility for AI Feedback Endpoints
 * Provides per-user/system throttling to prevent API abuse
 * 
 * Features:
 * - Sliding window rate limiting
 * - Per-endpoint configuration
 * - IP and systemId based tracking
 * - Configurable limits and windows
 */

const { getCollection } = require('./mongodb.cjs');

// Default rate limit configurations
const DEFAULT_LIMITS = {
  insights: {
    maxRequests: 10,     // Max 10 requests
    windowMs: 60000,     // Per minute
    keyPrefix: 'insights'
  },
  feedback: {
    maxRequests: 20,     // Max 20 requests
    windowMs: 60000,     // Per minute
    keyPrefix: 'feedback'
  },
  analysis: {
    maxRequests: 30,     // Max 30 requests
    windowMs: 60000,     // Per minute
    keyPrefix: 'analysis'
  }
};

/**
 * Rate limit error class for consistent error handling
 */
class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Extract client identifier from request
 * Uses IP address and optionally systemId for rate limiting
 * @param {Object} event - Netlify event object
 * @param {string} [systemId] - Optional systemId for more specific limiting
 * @returns {string} Client identifier
 */
function getClientIdentifier(event, systemId = null) {
  const ip = event?.headers?.['x-nf-client-connection-ip'] ||
             event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
             'unknown';
  
  if (systemId) {
    return `${ip}:${systemId}`;
  }
  return ip;
}

/**
 * Check rate limit for a client
 * Uses sliding window algorithm stored in MongoDB
 * 
 * @param {string} clientId - Client identifier (IP:systemId or IP)
 * @param {string} endpoint - Endpoint type ('insights', 'feedback', 'analysis')
 * @param {Object} log - Logger instance
 * @param {Object} [customLimits] - Optional custom rate limits
 * @returns {Promise<Object>} Rate limit status with remaining requests
 * @throws {RateLimitError} If rate limit exceeded
 */
async function checkRateLimit(clientId, endpoint, log, customLimits = null) {
  const limits = customLimits || DEFAULT_LIMITS[endpoint] || DEFAULT_LIMITS.insights;
  const { maxRequests, windowMs, keyPrefix } = limits;
  
  const rateLimitKey = `${keyPrefix}:${clientId}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  
  try {
    const rateLimitCollection = await getCollection('rate_limits');
    
    // Find existing rate limit document
    const doc = await rateLimitCollection.findOne({ key: rateLimitKey });
    
    // Filter timestamps within the current window
    const timestamps = doc?.timestamps || [];
    const recentTimestamps = timestamps.filter(ts => ts > windowStart);
    const currentCount = recentTimestamps.length;
    
    log.debug('Rate limit check', {
      clientId,
      endpoint,
      currentCount,
      maxRequests,
      windowMs,
      remaining: Math.max(0, maxRequests - currentCount)
    });
    
    // Check if limit exceeded
    if (currentCount >= maxRequests) {
      const oldestTimestamp = recentTimestamps[0] || now;
      const retryAfterMs = Math.max(0, oldestTimestamp + windowMs - now);
      
      log.warn('Rate limit exceeded', {
        clientId,
        endpoint,
        currentCount,
        maxRequests,
        retryAfterMs
      });
      
      throw new RateLimitError(
        `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
        retryAfterMs
      );
    }
    
    // Update rate limit record
    const updatedTimestamps = [...recentTimestamps, now];
    await rateLimitCollection.updateOne(
      { key: rateLimitKey },
      {
        $set: {
          timestamps: updatedTimestamps,
          lastRequest: now,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date(),
          endpoint,
          clientId
        }
      },
      { upsert: true }
    );
    
    return {
      allowed: true,
      remaining: maxRequests - updatedTimestamps.length,
      resetMs: windowMs,
      limit: maxRequests
    };
    
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    
    // Log error but fail open to prevent service disruption
    log.error('Rate limit check failed', {
      clientId,
      endpoint,
      error: error.message
    });
    
    // Fail open - allow request through on database errors
    return {
      allowed: true,
      remaining: maxRequests,
      resetMs: windowMs,
      limit: maxRequests,
      error: 'Rate limit check failed, allowing through'
    };
  }
}

/**
 * Create rate limit middleware headers for response
 * @param {Object} rateLimitResult - Result from checkRateLimit
 * @returns {Object} Headers with rate limit information
 */
function getRateLimitHeaders(rateLimitResult) {
  return {
    'X-RateLimit-Limit': String(rateLimitResult.limit || 0),
    'X-RateLimit-Remaining': String(rateLimitResult.remaining || 0),
    'X-RateLimit-Reset': String(Math.ceil((Date.now() + (rateLimitResult.resetMs || 0)) / 1000))
  };
}

/**
 * Apply rate limiting to an endpoint handler
 * Convenience wrapper for common usage pattern
 * 
 * @param {Object} event - Netlify event object
 * @param {string} endpoint - Endpoint type
 * @param {Object} log - Logger instance
 * @param {string} [systemId] - Optional systemId for more specific limiting
 * @returns {Promise<Object>} Rate limit result with headers
 */
async function applyRateLimit(event, endpoint, log, systemId = null) {
  const clientId = getClientIdentifier(event, systemId);
  const result = await checkRateLimit(clientId, endpoint, log);
  const headers = getRateLimitHeaders(result);
  
  return {
    ...result,
    headers,
    clientId
  };
}

/**
 * Clean up old rate limit records
 * Should be called periodically to prevent unbounded growth
 * @param {Object} log - Logger instance
 * @param {number} [maxAgeMs=3600000] - Maximum age of records to keep (default 1 hour)
 */
async function cleanupRateLimits(log, maxAgeMs = 3600000) {
  try {
    const rateLimitCollection = await getCollection('rate_limits');
    const cutoff = Date.now() - maxAgeMs;
    
    const result = await rateLimitCollection.deleteMany({
      updatedAt: { $lt: new Date(cutoff) }
    });
    
    log.info('Rate limit cleanup completed', {
      deletedCount: result.deletedCount,
      maxAgeMs
    });
    
    return result.deletedCount;
  } catch (error) {
    log.error('Rate limit cleanup failed', { error: error.message });
    return 0;
  }
}

module.exports = {
  checkRateLimit,
  applyRateLimit,
  getClientIdentifier,
  getRateLimitHeaders,
  cleanupRateLimits,
  RateLimitError,
  DEFAULT_LIMITS
};
