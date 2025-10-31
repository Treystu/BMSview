"use strict";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function withTimeout(promise, ms, onTimeout) {
  let timeoutId;
  const t = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error("operation_timeout");
      err.code = "operation_timeout";
      if (onTimeout) onTimeout(err);
      reject(err);
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), t]);
}

async function retryAsync(fn, {
  retries = 2,
  baseDelayMs = 200,
  jitterMs = 150,
  shouldRetry = (e) => true,
} = {}) {
  let attempt = 0;
  /* eslint-disable no-constant-condition */
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt > retries || !shouldRetry(e)) throw e;
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
} = {}) {
  const b = getBreaker(key);
  const now = Date.now();
  if (b.openUntil && now < b.openUntil) {
    const err = new Error("circuit_open");
    err.code = "circuit_open";
    throw err;
  }
  try {
    const res = await fn();
    b.failures = 0;
    b.openUntil = 0;
    return res;
  } catch (e) {
    b.failures += 1;
    if (b.failures >= failureThreshold) {
      b.openUntil = now + openMs;
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

module.exports = { withTimeout, retryAsync, circuitBreaker, createRetryWrapper };
