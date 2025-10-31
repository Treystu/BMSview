/**
 * Gemini API Client with Rate Limiting and Circuit Breaker
 * Handles API calls with retry logic, backoff, and quota management
 */

const { createLogger } = require('./logger');

// Circuit breaker states
const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',     // Normal operation
  OPEN: 'OPEN',         // Failing, reject requests
  HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.halfOpenRequests = options.halfOpenRequests || 3;
    
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  async execute(operation, logger) {
    if (this.state === CIRCUIT_STATES.OPEN) {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        logger.info('Circuit breaker transitioning to HALF_OPEN');
        this.state = CIRCUIT_STATES.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    try {
      const result = await operation();
      this.onSuccess(logger);
      return result;
    } catch (error) {
      this.onFailure(logger, error);
      throw error;
    }
  }

  onSuccess(logger) {
    this.failureCount = 0;
    
    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenRequests) {
        logger.info('Circuit breaker transitioning to CLOSED');
        this.state = CIRCUIT_STATES.CLOSED;
        this.successCount = 0;
      }
    }
  }

  onFailure(logger, error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      logger.warn('Circuit breaker transitioning to OPEN from HALF_OPEN');
      this.state = CIRCUIT_STATES.OPEN;
      this.successCount = 0;
    } else if (this.failureCount >= this.failureThreshold) {
      logger.warn('Circuit breaker transitioning to OPEN', {
        failureCount: this.failureCount,
        threshold: this.failureThreshold
      });
      this.state = CIRCUIT_STATES.OPEN;
    }
  }

  getState() {
    return this.state;
  }
}

class RateLimiter {
  constructor(options = {}) {
    this.tokensPerMinute = options.tokensPerMinute || 60;
    this.tokens = this.tokensPerMinute;
    this.lastRefill = Date.now();
  }

  async acquire(logger) {
    this.refill();

    if (this.tokens < 1) {
      const waitTime = 60000 / this.tokensPerMinute;
      logger.warn('Rate limit reached, waiting', { waitTime });
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refill();
    }

    this.tokens--;
  }

  refill() {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = (timePassed / 60000) * this.tokensPerMinute;
    
    this.tokens = Math.min(this.tokensPerMinute, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

class GeminiClient {
  constructor() {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000,
      halfOpenRequests: 3
    });
    
    this.rateLimiter = new RateLimiter({
      tokensPerMinute: 60
    });

    this.cooldownUntil = null;
  }

  async callAPI(prompt, options = {}, logger) {
    // Check global cooldown
    if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
      const waitTime = this.cooldownUntil - Date.now();
      logger.warn('Global cooldown active', { waitTimeMs: waitTime });
      throw new Error(`API in cooldown, retry after ${Math.ceil(waitTime / 1000)}s`);
    }

    // Rate limiting
    await this.rateLimiter.acquire(logger);

    // Circuit breaker
    return await this.circuitBreaker.execute(async () => {
      return await this._makeRequest(prompt, options, logger);
    }, logger);
  }

  async _makeRequest(prompt, options, logger) {
    const maxRetries = options.maxRetries || 3;
    const baseDelay = options.baseDelay || 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.info('Gemini API request', { 
          attempt: attempt + 1, 
          maxRetries: maxRetries + 1 
        });

        const startTime = Date.now();
        const response = await this._sendRequest(prompt, options);
        const duration = Date.now() - startTime;

        logger.info('Gemini API response', { 
          duration, 
          attempt: attempt + 1 
        });

        return response;

      } catch (error) {
        const isRateLimit = error.status === 429 || error.message?.includes('429');
        const isServerError = error.status >= 500;
        const isLastAttempt = attempt === maxRetries;

        if (isRateLimit) {
          const retryAfter = this._parseRetryAfter(error);
          logger.warn('Rate limit hit', { 
            attempt: attempt + 1, 
            retryAfter 
          });

          // Set global cooldown
          this.cooldownUntil = Date.now() + (retryAfter * 1000);

          if (isLastAttempt) {
            throw new Error(`Rate limit exceeded. Retry after ${retryAfter}s`);
          }

          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }

        if (isServerError && !isLastAttempt) {
          const delay = baseDelay * Math.pow(2, attempt);
          logger.warn('Server error, retrying', { 
            attempt: attempt + 1, 
            delay, 
            error: error.message 
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        logger.error('Gemini API error', { 
          attempt: attempt + 1, 
          error: error.message,
          stack: error.stack 
        });
        throw error;
      }
    }
  }

  async _sendRequest(prompt, options) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // ***UPDATED***: Changed default model to gemini-flash-latest
    const model = options.model || 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let parts = [];
    if (typeof prompt === 'string') {
      parts.push({ text: prompt });
    } else if (typeof prompt === 'object' && prompt.text && prompt.image && prompt.mimeType) {
      parts.push({ text: prompt.text });
      parts.push({
        inlineData: {
          mimeType: prompt.mimeType,
          data: prompt.image
        }
      });
    } else {
      throw new Error('Invalid prompt format. Must be a string or a valid image prompt object.');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: options.temperature || 0.7,
          maxOutputTokens: options.maxOutputTokens || 8192,
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(`Gemini API error: ${response.status}`);
      error.status = response.status;
      error.body = errorBody;
      throw error;
    }

    return await response.json();
  }

  _parseRetryAfter(error) {
    // Try to parse RetryInfo from error
    try {
      if (error.body) {
        const body = JSON.parse(error.body);
        if (body.error?.details) {
          for (const detail of body.error.details) {
            if (detail['@type']?.includes('RetryInfo')) {
              const retryDelay = detail.retryDelay;
              if (retryDelay) {
                // Parse duration like "27s" or "48s"
                const seconds = parseInt(retryDelay.replace('s', ''));
                return seconds || 60;
              }
            }
          }
        }
      }
    } catch (e) {
      // Ignore parsing errors
    }

    // Default to 60 seconds
    return 60;
  }

  getCircuitState() {
    return this.circuitBreaker.getState();
  }

  getCooldownStatus() {
    if (!this.cooldownUntil) return null;
    const remaining = this.cooldownUntil - Date.now();
    return remaining > 0 ? remaining : null;
  }
}

// Singleton instance
let geminiClient = null;

function getGeminiClient() {
  if (!geminiClient) {
    geminiClient = new GeminiClient();
  }
  return geminiClient;
}

module.exports = {
  getGeminiClient,
  GeminiClient,
  CIRCUIT_STATES
};
