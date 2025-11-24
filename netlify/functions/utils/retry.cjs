"use strict";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withTimeout(promise, ms, onTimeout, log = null) {
  let timeoutId;
  const startTime = Date.now();
  
  if (log) {
    log.debug('Starting timeout operation', { timeoutMs: ms });
  }
  
  const t = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const elapsed = Date.now() - startTime;
      const err = new Error("operation_timeout");
      err.code = "operation_timeout";
      if (log) {
        log.warn('Operation timed out', { timeoutMs: ms, elapsedMs: elapsed });
      }
      if (onTimeout) onTimeout(err);
      reject(err);
    }, ms);
  });
  
  return Promise.race([
    promise.finally(() => {
      clearTimeout(timeoutId);
      if (log) {
        const elapsed = Date.now() - startTime;
        log.debug('Timeout operation completed', { timeoutMs: ms, elapsedMs: elapsed });
      }
    }), 
    t
  ]);
}

async function retryAsync(fn, {
  retries = 2,
  baseDelayMs = 200,
  jitterMs = 150,
  shouldRetry = (e) => true,
  log = null, // Optional logger for retry attempts
} = {}) {
  let attempt = 0;
  /* eslint-disable no-constant-condition */
  while (true) {
    try {
      const result = await fn();
      if (log && attempt > 0) {
        log.debug('Retry successful', { attempt, totalRetries: retries });
      }
      return result;
    } catch (e) {
      attempt++;
      const willRetry = attempt <= retries && shouldRetry(e);
      
      if (log) {
        if (willRetry) {
          const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * jitterMs);
          log.debug('Retry attempt', { 
            attempt, 
            maxRetries: retries, 
            backoffMs: backoff,
            error: e.message,
            willRetry: true
          });
        } else {
          log.warn('Retry exhausted or error not retryable', { 
            attempt, 
            maxRetries: retries, 
            error: e.message,
            willRetry: false,
            reason: attempt > retries ? 'max_retries_reached' : 'error_not_retryable'
          });
        }
      }
      
      if (!willRetry) throw e;
      const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * jitterMs);
      await sleep(backoff);
    }
  }
}

// Simple in-memory circuit breaker
const breakers = new Map();

function getBreaker(key) {
  if (!breakers.has(key)) breakers.set(key, { failures: 0, openUntil: 0 });
  return breakers.get(key);
}

async function circuitBreaker(key, fn, {
  failureThreshold = 5,
  openMs = 30000,
  log = null, // Optional logger for circuit breaker state changes
} = {}) {
  const b = getBreaker(key);
  const now = Date.now();
  if (b.openUntil && now < b.openUntil) {
    if (log) {
      log.warn('Circuit breaker is OPEN', { 
        key, 
        openUntil: new Date(b.openUntil).toISOString(),
        failures: b.failures,
        threshold: failureThreshold
      });
    }
    const err = new Error("circuit_open");
    err.code = "circuit_open";
    throw err;
  }
  try {
    const res = await fn();
    if (b.failures > 0) {
      if (log) {
        log.debug('Circuit breaker reset after success', { key, previousFailures: b.failures });
      }
      b.failures = 0;
      b.openUntil = 0;
    }
    return res;
  } catch (e) {
    b.failures += 1;
    if (b.failures >= failureThreshold) {
      b.openUntil = now + openMs;
      if (log) {
        log.warn('Circuit breaker opened', { 
          key, 
          failures: b.failures,
          threshold: failureThreshold,
          openUntil: new Date(b.openUntil).toISOString(),
          error: e.message
        });
      }
    } else if (log) {
      log.debug('Circuit breaker failure increment', { 
        key, 
        failures: b.failures,
        threshold: failureThreshold
      });
    }
    throw e;
  }
}

const createRetryWrapper = (log) => async (fn, maxRetries = 3, initialDelay = 250) => {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            // Retry on 401 (auth issue), 429 (rate limit), 5xx server errors, or generic TypeError (network issue)
            const isRetryable = (error instanceof TypeError) || 
                                (error.status && error.status >= 500) ||
                                (error.status === 401) ||
                                (error.status === 429) ||
                                (error.message && (error.message.includes('401') || error.message.includes('429') || error.message.includes('502')));
                                
            if (isRetryable && i < maxRetries) {
                const delay = initialDelay * Math.pow(2, i) + Math.random() * initialDelay;
                log('warn', `A retryable blob store operation failed. Retrying...`, { attempt: i + 1, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

/**
 * Get status of all circuit breakers
 * Used for monitoring and debugging
 */
function getCircuitBreakerStatus() {
  const now = Date.now();
  const breakerArray = Array.from(breakers.entries()).map(([key, b]) => {
    const isOpen = b.openUntil && now < b.openUntil;
    // Circuit breaker states:
    // - 'open': Breaker is open, rejecting requests (openUntil is in the future)
    // - 'closed': Breaker is closed, accepting requests normally (no failures)
    // - 'degraded': Has some failures but still accepting requests (transitioning)
    let state;
    if (isOpen) {
      state = 'open';
    } else if (b.failures > 0) {
      state = 'degraded'; // Has failures but not open yet
    } else {
      state = 'closed';
    }
    
    return {
      key,
      state,
      failures: b.failures,
      openUntil: b.openUntil,
      isOpen
    };
  });

  return {
    breakers: breakerArray,
    total: breakerArray.length,
    open: breakerArray.filter(b => b.isOpen).length,
    closed: breakerArray.filter(b => b.state === 'closed').length,
    anyOpen: breakerArray.some(b => b.isOpen)
  };
}

/**
 * Reset a specific circuit breaker
 * Returns info about the reset operation
 */
function resetCircuitBreaker(key) {
  const b = getBreaker(key);
  const wasOpen = b.openUntil && Date.now() < b.openUntil;
  const previousFailures = b.failures;
  
  b.failures = 0;
  b.openUntil = 0;
  
  return {
    key,
    wasOpen,
    previousFailures,
    resetAt: new Date().toISOString()
  };
}

/**
 * Reset all circuit breakers
 * Use with caution - for emergency recovery only
 */
function resetAllCircuitBreakers() {
  const keys = Array.from(breakers.keys());
  const results = keys.map(key => resetCircuitBreaker(key));
  
  return {
    count: results.length,
    keys,
    resetAt: new Date().toISOString()
  };
}

module.exports = { 
  withTimeout, 
  retryAsync, 
  circuitBreaker, 
  createRetryWrapper,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  resetAllCircuitBreakers
};
