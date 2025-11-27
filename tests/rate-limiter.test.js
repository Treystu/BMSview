/**
 * Tests for rate-limiter.cjs
 * Tests rate limiting functionality for AI feedback endpoints
 */

// Mock mongodb before requiring the module
jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
  const mockCollection = {
    findOne: jest.fn(),
    updateOne: jest.fn(),
    deleteMany: jest.fn()
  };
  return {
    getCollection: jest.fn().mockResolvedValue(mockCollection)
  };
});

const {
  checkRateLimit,
  applyRateLimit,
  getClientIdentifier,
  getRateLimitHeaders,
  cleanupRateLimits,
  RateLimitError,
  DEFAULT_LIMITS
} = require('../netlify/functions/utils/rate-limiter.cjs');

const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

// Mock logger
const mockLog = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  rateLimit: jest.fn()
};

describe('Rate Limiter', () => {
  let mockCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 })
    };
    getCollection.mockResolvedValue(mockCollection);
  });

  describe('getClientIdentifier', () => {
    it('should extract IP from x-nf-client-connection-ip header', () => {
      const event = {
        headers: {
          'x-nf-client-connection-ip': '192.168.1.100'
        }
      };
      expect(getClientIdentifier(event)).toBe('192.168.1.100');
    });

    it('should fall back to x-forwarded-for header', () => {
      const event = {
        headers: {
          'x-forwarded-for': '10.0.0.1, 192.168.1.1'
        }
      };
      expect(getClientIdentifier(event)).toBe('10.0.0.1');
    });

    it('should return "unknown" when no IP headers present', () => {
      const event = { headers: {} };
      expect(getClientIdentifier(event)).toBe('unknown');
    });

    it('should include systemId when provided', () => {
      const event = {
        headers: {
          'x-nf-client-connection-ip': '192.168.1.100'
        }
      };
      expect(getClientIdentifier(event, 'system-123')).toBe('192.168.1.100:system-123');
    });
  });

  describe('checkRateLimit', () => {
    it('should allow request when under limit', async () => {
      mockCollection.findOne.mockResolvedValue({
        timestamps: [Date.now() - 30000, Date.now() - 20000] // 2 recent requests
      });

      const result = await checkRateLimit('test-client', 'insights', mockLog);
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(DEFAULT_LIMITS.insights.maxRequests - 3); // 2 existing + 1 new
    });

    it('should throw RateLimitError when limit exceeded', async () => {
      const now = Date.now();
      const timestamps = Array(10).fill(0).map((_, i) => now - (i * 1000)); // 10 requests in last 10 seconds
      mockCollection.findOne.mockResolvedValue({ timestamps });

      await expect(checkRateLimit('test-client', 'insights', mockLog))
        .rejects
        .toThrow(RateLimitError);
    });

    it('should filter out old timestamps outside window', async () => {
      const now = Date.now();
      const timestamps = [
        now - 120000, // 2 minutes ago (outside window)
        now - 30000,  // 30 seconds ago (inside window)
        now - 10000   // 10 seconds ago (inside window)
      ];
      mockCollection.findOne.mockResolvedValue({ timestamps });

      const result = await checkRateLimit('test-client', 'insights', mockLog);
      
      expect(result.allowed).toBe(true);
      // Should only count 2 requests in window + 1 new
      expect(result.remaining).toBe(DEFAULT_LIMITS.insights.maxRequests - 3);
    });

    it('should allow request when no existing record', async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await checkRateLimit('test-client', 'insights', mockLog);
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(DEFAULT_LIMITS.insights.maxRequests - 1);
    });

    it('should fail open on database errors', async () => {
      mockCollection.findOne.mockRejectedValue(new Error('DB connection failed'));

      const result = await checkRateLimit('test-client', 'insights', mockLog);
      
      expect(result.allowed).toBe(true);
      expect(result.error).toBeDefined();
      expect(mockLog.error).toHaveBeenCalled();
    });

    it('should use custom limits when provided', async () => {
      mockCollection.findOne.mockResolvedValue({ timestamps: [] });

      const customLimits = {
        maxRequests: 5,
        windowMs: 30000,
        keyPrefix: 'custom'
      };

      const result = await checkRateLimit('test-client', 'custom', mockLog, customLimits);
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
    });
  });

  describe('getRateLimitHeaders', () => {
    it('should return correct rate limit headers', () => {
      const result = {
        limit: 10,
        remaining: 5,
        resetMs: 60000
      };

      const headers = getRateLimitHeaders(result);
      
      expect(headers['X-RateLimit-Limit']).toBe('10');
      expect(headers['X-RateLimit-Remaining']).toBe('5');
      expect(headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('should handle missing values gracefully', () => {
      const headers = getRateLimitHeaders({});
      
      expect(headers['X-RateLimit-Limit']).toBe('0');
      expect(headers['X-RateLimit-Remaining']).toBe('0');
    });
  });

  describe('applyRateLimit', () => {
    it('should combine rate limit check with header generation', async () => {
      mockCollection.findOne.mockResolvedValue({ timestamps: [] });

      const event = {
        headers: {
          'x-nf-client-connection-ip': '192.168.1.100'
        }
      };

      const result = await applyRateLimit(event, 'insights', mockLog);
      
      expect(result.allowed).toBe(true);
      expect(result.headers).toBeDefined();
      expect(result.clientId).toBe('192.168.1.100');
    });

    it('should include systemId in client identifier when provided', async () => {
      mockCollection.findOne.mockResolvedValue({ timestamps: [] });

      const event = {
        headers: {
          'x-nf-client-connection-ip': '192.168.1.100'
        }
      };

      const result = await applyRateLimit(event, 'insights', mockLog, 'system-123');
      
      expect(result.clientId).toBe('192.168.1.100:system-123');
    });
  });

  describe('cleanupRateLimits', () => {
    it('should delete old rate limit records', async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 5 });

      const result = await cleanupRateLimits(mockLog);
      
      expect(result).toBe(5);
      expect(mockLog.info).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockCollection.deleteMany.mockRejectedValue(new Error('Delete failed'));

      const result = await cleanupRateLimits(mockLog);
      
      expect(result).toBe(0);
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('RateLimitError', () => {
    it('should have correct properties', () => {
      const error = new RateLimitError('Rate limit exceeded', 30000);
      
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.name).toBe('RateLimitError');
      expect(error.statusCode).toBe(429);
      expect(error.retryAfterMs).toBe(30000);
    });
  });

  describe('DEFAULT_LIMITS', () => {
    it('should have correct default limits for insights', () => {
      expect(DEFAULT_LIMITS.insights.maxRequests).toBe(10);
      expect(DEFAULT_LIMITS.insights.windowMs).toBe(60000);
    });

    it('should have correct default limits for feedback', () => {
      expect(DEFAULT_LIMITS.feedback.maxRequests).toBe(20);
      expect(DEFAULT_LIMITS.feedback.windowMs).toBe(60000);
    });

    it('should have correct default limits for analysis', () => {
      expect(DEFAULT_LIMITS.analysis.maxRequests).toBe(30);
      expect(DEFAULT_LIMITS.analysis.windowMs).toBe(60000);
    });
  });
});
