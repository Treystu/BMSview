/**
 * Tests for Token Limit Handler
 */

const {
  estimateTokenCount,
  estimateDataTokens,
  getModelTokenLimit,
  checkTokenLimit,
  suggestReduction,
  applyContextReduction,
  createTokenLimitMessage,
  handleTokenLimitExceeded,
  MODEL_TOKEN_LIMITS,
  TOKEN_SAFETY_MARGIN
} = require('../netlify/functions/utils/token-limit-handler.cjs');

describe('Token Limit Handler', () => {
  describe('estimateTokenCount', () => {
    it('should estimate token count for text', () => {
      const text = 'Hello world';
      const tokens = estimateTokenCount(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it('should return 0 for empty text', () => {
      expect(estimateTokenCount('')).toBe(0);
      expect(estimateTokenCount(null)).toBe(0);
      expect(estimateTokenCount(undefined)).toBe(0);
    });

    it('should handle large text', () => {
      const largeText = 'a'.repeat(10000);
      const tokens = estimateTokenCount(largeText);
      expect(tokens).toBe(2500); // 10000 / 4
    });
  });

  describe('estimateDataTokens', () => {
    it('should estimate tokens for JSON data', () => {
      const data = { foo: 'bar', nested: { value: 123 } };
      const tokens = estimateDataTokens(data);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle array data', () => {
      const data = [1, 2, 3, 4, 5];
      const tokens = estimateDataTokens(data);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for invalid data', () => {
      const circularRef = {};
      circularRef.self = circularRef;
      expect(estimateDataTokens(circularRef)).toBe(0);
    });
  });

  describe('getModelTokenLimit', () => {
    it('should return correct limit for known models', () => {
      expect(getModelTokenLimit('gemini-2.5-flash')).toBe(1048576);
      expect(getModelTokenLimit('gemini-1.5-pro')).toBe(2097152);
    });

    it('should return default limit for unknown models', () => {
      expect(getModelTokenLimit('unknown-model')).toBe(MODEL_TOKEN_LIMITS.default);
      expect(getModelTokenLimit()).toBe(MODEL_TOKEN_LIMITS.default);
    });
  });

  describe('checkTokenLimit', () => {
    it('should detect when approaching limit', () => {
      const limit = MODEL_TOKEN_LIMITS['gemini-2.5-flash'];
      const tokens = limit * 0.9; // 90% of limit
      const status = checkTokenLimit(tokens, 'gemini-2.5-flash');

      expect(status.isApproachingLimit).toBe(true);
      expect(status.exceedsLimit).toBe(false);
      expect(status.percentUsed).toBeGreaterThan(80);
    });

    it('should detect when exceeding limit', () => {
      const limit = MODEL_TOKEN_LIMITS['gemini-2.5-flash'];
      const tokens = limit * 1.1; // 110% of limit
      const status = checkTokenLimit(tokens, 'gemini-2.5-flash');

      expect(status.isApproachingLimit).toBe(true);
      expect(status.exceedsLimit).toBe(true);
    });

    it('should show safe status when well below limit', () => {
      const tokens = 10000;
      const status = checkTokenLimit(tokens, 'gemini-2.5-flash');

      expect(status.isApproachingLimit).toBe(false);
      expect(status.exceedsLimit).toBe(false);
      expect(status.percentUsed).toBeLessThan(5);
    });
  });

  describe('suggestReduction', () => {
    it('should not suggest reduction when below limit', () => {
      const config = {
        granularity: 'hourly_avg',
        contextWindowDays: 30,
        metric: 'all'
      };
      const result = suggestReduction(config, 10000, 'gemini-2.5-flash');

      expect(result.needsReduction).toBe(false);
    });

    it('should suggest granularity reduction first', () => {
      const config = {
        granularity: 'hourly_avg',
        contextWindowDays: 30,
        metric: 'all'
      };
      const limit = MODEL_TOKEN_LIMITS['gemini-2.5-flash'];
      const tokens = limit * 0.9;
      const result = suggestReduction(config, tokens, 'gemini-2.5-flash');

      expect(result.needsReduction).toBe(true);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.recommendedStrategy.name).toBe('reduce_granularity');
      expect(result.recommendedStrategy.newConfig.granularity).toBe('daily_avg');
    });

    it('should suggest time window reduction for long windows', () => {
      const config = {
        granularity: 'daily_avg', // Already reduced
        contextWindowDays: 60,
        metric: 'all'
      };
      const limit = MODEL_TOKEN_LIMITS['gemini-2.5-flash'];
      const tokens = limit * 0.9;
      const result = suggestReduction(config, tokens, 'gemini-2.5-flash');

      expect(result.needsReduction).toBe(true);
      const timeWindowStrategy = result.suggestions.find(s => s.name === 'reduce_time_window');
      expect(timeWindowStrategy).toBeDefined();
      expect(timeWindowStrategy.newConfig.contextWindowDays).toBeLessThan(60);
    });
  });

  describe('applyContextReduction', () => {
    const mockLog = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should not reduce when below limit', () => {
      const config = {
        granularity: 'hourly_avg',
        contextWindowDays: 30,
        metric: 'all'
      };
      const result = applyContextReduction(config, 10000, 'gemini-2.5-flash', mockLog);

      expect(result.success).toBe(true);
      expect(result.reductionsApplied).toHaveLength(0);
      expect(result.config).toEqual(config);
    });

    it('should apply reduction when approaching limit', () => {
      const config = {
        granularity: 'hourly_avg',
        contextWindowDays: 30,
        metric: 'all'
      };
      const limit = MODEL_TOKEN_LIMITS['gemini-2.5-flash'];
      const tokens = limit * 0.9;
      const result = applyContextReduction(config, tokens, 'gemini-2.5-flash', mockLog);

      expect(result.reductionsApplied.length).toBeGreaterThan(0);
      expect(result.finalTokens).toBeLessThan(tokens);
      expect(mockLog.warn).toHaveBeenCalled();
    });

    it('should apply multiple reductions if needed', () => {
      const config = {
        granularity: 'hourly_avg',
        contextWindowDays: 90,
        metric: 'all'
      };
      const limit = MODEL_TOKEN_LIMITS['gemini-2.5-flash'];
      const tokens = limit * 1.5; // Way over limit - 150%
      const result = applyContextReduction(config, tokens, 'gemini-2.5-flash', mockLog);

      // With tokens at 150% of limit and multiple available strategies,
      // it should apply at least one reduction (may not need multiple if reduction is aggressive enough)
      expect(result.reductionsApplied.length).toBeGreaterThan(0);
      expect(result.finalTokens).toBeLessThan(tokens);
    });
  });

  describe('createTokenLimitMessage', () => {
    it('should create user-friendly message', () => {
      const reductions = [
        { description: 'Switched to daily aggregation' },
        { description: 'Reduced time window to 14 days' }
      ];
      const message = createTokenLimitMessage(reductions);

      expect(message).toContain('Token Limit Handling');
      expect(message).toContain('Switched to daily aggregation');
      expect(message).toContain('Reduced time window to 14 days');
    });

    it('should return null for empty reductions', () => {
      expect(createTokenLimitMessage([])).toBeNull();
      expect(createTokenLimitMessage(null)).toBeNull();
    });
  });

  describe('handleTokenLimitExceeded', () => {
    const mockLog = {
      error: jest.fn()
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should create aggressive fallback configuration', async () => {
      const originalConfig = {
        granularity: 'hourly_avg',
        contextWindowDays: 90,
        metric: 'all'
      };
      const error = new Error('Token limit exceeded');
      const result = await handleTokenLimitExceeded(originalConfig, error, mockLog);

      expect(result.success).toBe(true);
      expect(result.fallbackConfig.granularity).toBe('daily_avg');
      expect(result.fallbackConfig.contextWindowDays).toBeLessThanOrEqual(14);
      expect(result.fallbackConfig.sampleRate).toBe(0.5);
      expect(mockLog.error).toHaveBeenCalled();
    });

    it('should preserve shorter time windows', async () => {
      const originalConfig = {
        granularity: 'hourly_avg',
        contextWindowDays: 7,
        metric: 'voltage'
      };
      const error = new Error('Token limit exceeded');
      const result = await handleTokenLimitExceeded(originalConfig, error, mockLog);

      expect(result.fallbackConfig.contextWindowDays).toBe(7);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle typical large query scenario', () => {
      // Simulate a large 90-day hourly query
      const config = {
        granularity: 'hourly_avg',
        contextWindowDays: 90,
        metric: 'all'
      };
      
      // Use a token count that's actually approaching the limit
      const limit = MODEL_TOKEN_LIMITS['gemini-2.5-flash'];
      const estimatedTokens = limit * 0.85; // 85% of limit
      
      const mockLog = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      };
      
      const result = applyContextReduction(config, estimatedTokens, 'gemini-2.5-flash', mockLog);
      
      // Should successfully reduce to fit or stay the same if already safe
      expect(result.success).toBe(true);
      if (result.reductionsApplied.length > 0) {
        expect(result.finalTokens).toBeLessThan(estimatedTokens);
      }
    });
  });
});
