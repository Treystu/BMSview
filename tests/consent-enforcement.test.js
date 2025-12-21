/**
 * Consent Enforcement Tests for generate-insights-with-tools.cjs
 * 
 * Tests verify that user consent is properly required and validated before AI processing
 * 
 * @jest-environment node
 */

// Mock dependencies before requiring the handler
jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
  const mockCollection = {
    findOne: jest.fn(),
    insertOne: jest.fn(),
    updateOne: jest.fn(),
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        limit: jest.fn(() => ({
          toArray: jest.fn().mockResolvedValue([])
        }))
      }))
    })),
    createIndex: jest.fn().mockResolvedValue('index-created')
  };
  
  return {
    getCollection: jest.fn().mockResolvedValue(mockCollection),
    closeConnection: jest.fn().mockResolvedValue(undefined)
  };
});

jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    audit: jest.fn(),
    rateLimit: jest.fn(),
    sanitization: jest.fn(),
    consent: jest.fn(),
    dataAccess: jest.fn(),
    entry: jest.fn(),
    exit: jest.fn()
  })),
  createLoggerFromEvent: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    audit: jest.fn(),
    rateLimit: jest.fn(),
    sanitization: jest.fn(),
    consent: jest.fn(),
    dataAccess: jest.fn(),
    entry: jest.fn(),
    exit: jest.fn()
  })),
  createTimer: jest.fn(() => ({
    end: jest.fn().mockReturnValue(100)
  }))
}));

// Mock rate limiter to allow all requests
jest.mock('../netlify/functions/utils/rate-limiter.cjs', () => ({
  applyRateLimit: jest.fn().mockResolvedValue({
    allowed: true,
    remaining: 10,
    limit: 10,
    headers: {}
  }),
  RateLimitError: class RateLimitError extends Error {
    constructor(message, retryAfterMs) {
      super(message);
      this.name = 'RateLimitError';
      this.retryAfterMs = retryAfterMs;
    }
  }
}));

// Mock security sanitizer to pass through inputs
jest.mock('../netlify/functions/utils/security-sanitizer.cjs', () => ({
  sanitizeInsightsRequest: jest.fn((body) => ({
    ...body,
    warnings: []
  })),
  SanitizationError: class SanitizationError extends Error {
    constructor(message, field, type) {
      super(message);
      this.name = 'SanitizationError';
      this.field = field;
      this.type = type;
    }
  }
}));

// Mock insights-guru to avoid actual AI calls
jest.mock('../netlify/functions/utils/insights-guru.cjs', () => ({
  generateInsightsWithReActLoop: jest.fn().mockResolvedValue({
    status: 'completed',
    insights: { rawText: 'Mock insights', healthStatus: 'Good' },
    metadata: { iterations: 1 }
  })
}));

// Mock insights-jobs
jest.mock('../netlify/functions/utils/insights-jobs.cjs', () => ({
  createInsightsJob: jest.fn().mockResolvedValue({ id: 'job-123' }),
  getInsightsJob: jest.fn().mockResolvedValue(null),
  ensureIndexes: jest.fn().mockResolvedValue(undefined)
}));

const { handler } = require('../netlify/functions/generate-insights-with-tools.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

describe('Consent Enforcement in generate-insights-with-tools', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = {
      functionName: 'generate-insights-with-tools',
      awsRequestId: 'test-request-id'
    };
    
    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('Missing Consent', () => {
    test('should reject request when consentGranted is missing', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
      expect(result.message).toContain('User consent is required');
      expect(result.message).toContain('consentGranted must be boolean true');
    });

    test('should reject request when consentGranted is false', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: false,
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
    });

    test('should reject request when consentGranted is null', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: null,
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
    });

    test('should reject request when consentGranted is undefined', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: undefined,
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
    });
  });

  describe('Type Validation for consentGranted', () => {
    test('should reject request when consentGranted is string "true"', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: 'true',
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
      expect(result.message).toContain('consentGranted must be boolean true');
    });

    test('should reject request when consentGranted is number 1', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: 1,
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
    });

    test('should reject request when consentGranted is object', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: { value: true },
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
    });

    test('should reject request when consentGranted is array [true]', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: [true],
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(403);
      expect(result.success).toBe(false);
      expect(result.error).toBe('consent_required');
    });
  });

  describe('Valid Consent', () => {
    test('should pass consent validation when consentGranted is boolean true with systemId and analysisData', async () => {
      // Mock system lookup
      const mockCollection = await getCollection('systems');
      mockCollection.findOne.mockResolvedValue({
        _id: 'test-system-123',
        name: 'Test System',
        chemistry: 'LiFePO4',
        capacity: 280
      });

      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          analysisData: {
            dlNumber: 'DL-12345',
            overallVoltage: 52.4,
            current: -5.2,
            stateOfCharge: 85,
            temperature: 25
          },
          consentGranted: true,
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      // Should NOT be a consent error (403)
      expect(response.statusCode).not.toBe(403);
      expect(result.error).not.toBe('consent_required');
      
      // May timeout or have other issues, but not consent-related
      if (response.statusCode >= 400) {
        expect(result.error).not.toContain('consent');
      }
    });

    test('should pass consent validation with analysisData', async () => {
      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          analysisData: {
            dlNumber: 'DL-12345',
            overallVoltage: 52.4,
            current: -5.2,
            stateOfCharge: 85,
            temperature: 25
          },
          consentGranted: true,
          customPrompt: 'Analyze battery health'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      // Should NOT be a consent error (403)
      expect(response.statusCode).not.toBe(403);
      expect(result.error).not.toBe('consent_required');
    });
  });

  describe('Resume Job Consent Bypass', () => {
    test('should allow resume without consent when resumeJobId is provided', async () => {
      // Mock existing job
      const { getInsightsJob } = require('../netlify/functions/utils/insights-jobs.cjs');
      getInsightsJob.mockResolvedValue({
        id: 'job-123',
        systemId: 'test-system-123',
        status: 'in_progress',
        checkpoint: {
          iteration: 5,
          conversationHistory: []
        }
      });

      const event = {
        body: JSON.stringify({
          resumeJobId: 'job-123',
          // No consentGranted field
          customPrompt: 'Continue analysis'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      // Should NOT reject for missing consent
      expect(response.statusCode).not.toBe(403);
      expect(result.error).not.toBe('consent_required');
    });

    test('should allow resume with consentGranted=false when resumeJobId is provided', async () => {
      // Mock existing job
      const { getInsightsJob } = require('../netlify/functions/utils/insights-jobs.cjs');
      getInsightsJob.mockResolvedValue({
        id: 'job-123',
        systemId: 'test-system-123',
        status: 'in_progress',
        checkpoint: {
          iteration: 5,
          conversationHistory: []
        }
      });

      const event = {
        body: JSON.stringify({
          resumeJobId: 'job-123',
          consentGranted: false, // Explicitly false
          customPrompt: 'Continue analysis'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      // Should NOT reject for false consent when resuming
      expect(response.statusCode).not.toBe(403);
      expect(result.error).not.toBe('consent_required');
    });

    test('should allow resume with invalid consent type when resumeJobId is provided', async () => {
      // Mock existing job
      const { getInsightsJob } = require('../netlify/functions/utils/insights-jobs.cjs');
      getInsightsJob.mockResolvedValue({
        id: 'job-123',
        systemId: 'test-system-123',
        status: 'in_progress',
        checkpoint: {
          iteration: 5,
          conversationHistory: []
        }
      });

      const event = {
        body: JSON.stringify({
          resumeJobId: 'job-123',
          consentGranted: 'true', // String instead of boolean
          customPrompt: 'Continue analysis'
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      // Should NOT reject for invalid consent type when resuming
      expect(response.statusCode).not.toBe(403);
      expect(result.error).not.toBe('consent_required');
    });
  });

  describe('Logging', () => {
    // NOTE: These tests are skipped because they test implementation details of logging
    // which are difficult to mock reliably due to Jest module caching.
    // The core consent enforcement tests above verify the main functionality.
    test('should log consent rejection with proper context', async () => {
      const { createLoggerFromEvent } = require('../netlify/functions/utils/logger.cjs');
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        audit: jest.fn(),
        rateLimit: jest.fn(),
        sanitization: jest.fn(),
        consent: jest.fn(),
        dataAccess: jest.fn(),
        entry: jest.fn(),
        exit: jest.fn()
      };
      createLoggerFromEvent.mockReturnValue(mockLogger);

      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: false
        })
      };

      await handler(event, mockContext);

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Insights request rejected: Missing or invalid user consent',
        expect.objectContaining({
          systemId: 'test-system-123',
          consentGranted: false,
          consentType: 'boolean'
        })
      );
    });

    test('should log consent type when consent is invalid type', async () => {
      const { createLoggerFromEvent } = require('../netlify/functions/utils/logger.cjs');
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        audit: jest.fn(),
        rateLimit: jest.fn(),
        sanitization: jest.fn(),
        consent: jest.fn(),
        dataAccess: jest.fn(),
        entry: jest.fn(),
        exit: jest.fn()
      };
      createLoggerFromEvent.mockReturnValue(mockLogger);

      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          consentGranted: 'true' // String type
        })
      };

      await handler(event, mockContext);

      // Verify warning was logged with type information
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Insights request rejected: Missing or invalid user consent',
        expect.objectContaining({
          systemId: 'test-system-123',
          consentGranted: 'true',
          consentType: 'string'
        })
      );
    });

    test('should log successful consent in request info', async () => {
      const { createLoggerFromEvent } = require('../netlify/functions/utils/logger.cjs');
      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        audit: jest.fn(),
        rateLimit: jest.fn(),
        sanitization: jest.fn(),
        consent: jest.fn(),
        dataAccess: jest.fn(),
        entry: jest.fn(),
        exit: jest.fn()
      };
      createLoggerFromEvent.mockReturnValue(mockLogger);

      // Mock system lookup
      const mockCollection = await getCollection('systems');
      mockCollection.findOne.mockResolvedValue({
        _id: 'test-system-123',
        name: 'Test System'
      });

      const event = {
        body: JSON.stringify({
          systemId: 'test-system-123',
          analysisData: { voltage: 48.5, current: -10 },
          consentGranted: true
        })
      };

      await handler(event, mockContext);

      // Verify info log includes consent status
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Insights request received',
        expect.objectContaining({
          consentGranted: true
        })
      );
    });
  });

  describe('Edge Cases', () => {
    test('should require either (systemId and analysisData together) or resumeJobId', async () => {
      const event = {
        body: JSON.stringify({
          consentGranted: true,
          customPrompt: 'Analyze battery health'
          // Missing systemId, analysisData, and resumeJobId
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(result.error).toContain('Either analysisData and systemId, or resumeJobId is required');
    });

    test('should check consent before validating required fields', async () => {
      // Consent verification now happens before required field validation
      // This is a security improvement - reject unauthorized requests early
      const event = {
        body: JSON.stringify({
          consentGranted: false
          // Missing systemId, analysisData, and resumeJobId
        })
      };

      const response = await handler(event, mockContext);
      const result = JSON.parse(response.body);

      // Consent is checked first, so we expect 403 before 400
      expect(response.statusCode).toBe(403);
      expect(result.error).toBe('consent_required');
    });

    test('should handle malformed JSON gracefully', async () => {
      const event = {
        body: 'not valid json'
      };

      const response = await handler(event, mockContext);
      
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
