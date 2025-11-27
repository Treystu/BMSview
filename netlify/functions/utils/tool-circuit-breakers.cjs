/**
 * Per-Tool Circuit Breaker Manager
 * 
 * Provides individual circuit breakers for each external service/tool
 * to prevent cascade failures and enable fine-grained recovery.
 */

"use strict";

// Circuit breaker configuration per tool type
const TOOL_BREAKER_CONFIGS = {
  // Gemini API - already has circuit breaker in geminiClient.cjs
  gemini_api: {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    halfOpenRequests: 3
  },
  
  // Weather API
  weather_api: {
    failureThreshold: 3,
    resetTimeout: 30000, // 30 seconds
    halfOpenRequests: 2
  },
  
  // Solar API
  solar_api: {
    failureThreshold: 3,
    resetTimeout: 30000,
    halfOpenRequests: 2
  },
  
  // MongoDB operations
  mongodb: {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenRequests: 3
  },
  
  // Statistical tools (forecasting, pattern analysis, etc.)
  statistical_tools: {
    failureThreshold: 3,
    resetTimeout: 20000, // 20 seconds
    halfOpenRequests: 2
  },
  
  // Default for unknown tools
  default: {
    failureThreshold: 3,
    resetTimeout: 30000,
    halfOpenRequests: 2
  }
};

// Circuit breaker states
const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',     // Normal operation
  OPEN: 'OPEN',         // Failing, reject requests
  HALF_OPEN: 'HALF_OPEN' // Testing if service recovered
};

/**
 * Circuit Breaker class for individual tools
 */
class ToolCircuitBreaker {
  constructor(toolName, config = {}) {
    this.toolName = toolName;
    
    // Get config for this tool type or use default
    const toolConfig = TOOL_BREAKER_CONFIGS[toolName] || TOOL_BREAKER_CONFIGS.default;
    
    this.failureThreshold = config.failureThreshold || toolConfig.failureThreshold;
    this.resetTimeout = config.resetTimeout || toolConfig.resetTimeout;
    this.halfOpenRequests = config.halfOpenRequests || toolConfig.halfOpenRequests;
    
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.totalRequests = 0;
    this.totalFailures = 0;
  }

  /**
   * Execute an operation with circuit breaker protection
   * 
   * @param {Function} operation - Async function to execute
   * @param {Object} log - Logger instance
   * @returns {Promise} Operation result
   */
  async execute(operation, log) {
    this.totalRequests++;
    
    // Check if circuit is open
    if (this.state === CIRCUIT_STATES.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceFailure > this.resetTimeout) {
        // Transition to half-open to test recovery
        this._transitionTo(CIRCUIT_STATES.HALF_OPEN, log);
      } else {
        log.warn('Circuit breaker is OPEN, rejecting request', {
          toolName: this.toolName,
          state: this.state,
          timeUntilReset: this.resetTimeout - timeSinceFailure,
          failureCount: this.failureCount
        });
        
        const error = new Error(`Circuit breaker is OPEN for ${this.toolName}`);
        error.code = 'CIRCUIT_OPEN';
        error.circuitState = this.state;
        error.retryAfter = this.resetTimeout - timeSinceFailure;
        throw error;
      }
    }

    try {
      const result = await operation();
      this._onSuccess(log);
      return result;
    } catch (error) {
      this._onFailure(error, log);
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  _onSuccess(log) {
    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.halfOpenRequests) {
        // Enough successes in half-open, close the circuit
        this._transitionTo(CIRCUIT_STATES.CLOSED, log);
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.failureCount > 0) {
      // Reset failure count on success in closed state
      log.debug('Circuit breaker reset after success', {
        toolName: this.toolName,
        previousFailures: this.failureCount
      });
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed operation
   */
  _onFailure(error, log) {
    this.failureCount++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      // Failure in half-open, go back to open
      this._transitionTo(CIRCUIT_STATES.OPEN, log);
      this.successCount = 0;
    } else if (this.failureCount >= this.failureThreshold) {
      // Threshold reached, open the circuit
      this._transitionTo(CIRCUIT_STATES.OPEN, log);
    }

    log.warn('Circuit breaker recorded failure', {
      toolName: this.toolName,
      state: this.state,
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      error: error.message
    });
  }

  /**
   * Transition to a new state
   */
  _transitionTo(newState, log) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    log.info('Circuit breaker state transition', {
      toolName: this.toolName,
      oldState,
      newState,
      failureCount: this.failureCount,
      successCount: this.successCount
    });
  }

  /**
   * Get current circuit breaker status
   */
  getStatus() {
    return {
      toolName: this.toolName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      failureRate: this.totalRequests > 0 
        ? ((this.totalFailures / this.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      config: {
        failureThreshold: this.failureThreshold,
        resetTimeout: this.resetTimeout,
        halfOpenRequests: this.halfOpenRequests
      }
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(log) {
    const oldState = this.state;
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    
    if (log) {
      log.info('Circuit breaker manually reset', {
        toolName: this.toolName,
        oldState,
        newState: this.state
      });
    }
  }
}

/**
 * Global registry of circuit breakers
 */
class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker for a tool
   * 
   * @param {string} toolName - Name of the tool
   * @param {Object} config - Optional configuration override
   * @returns {ToolCircuitBreaker} Circuit breaker instance
   */
  getBreaker(toolName, config = {}) {
    if (!this.breakers.has(toolName)) {
      this.breakers.set(toolName, new ToolCircuitBreaker(toolName, config));
    }
    return this.breakers.get(toolName);
  }

  /**
   * Get status of all circuit breakers
   */
  getAllStatus() {
    const statuses = [];
    for (const breaker of this.breakers.values()) {
      statuses.push(breaker.getStatus());
    }
    return statuses;
  }

  /**
   * Reset a specific circuit breaker
   */
  resetBreaker(toolName, log) {
    const breaker = this.breakers.get(toolName);
    if (breaker) {
      breaker.reset(log);
      return true;
    }
    return false;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(log) {
    let count = 0;
    for (const breaker of this.breakers.values()) {
      breaker.reset(log);
      count++;
    }
    return count;
  }

  /**
   * Check if any circuit breakers are open
   */
  anyOpen() {
    for (const breaker of this.breakers.values()) {
      if (breaker.state === CIRCUIT_STATES.OPEN) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const statuses = this.getAllStatus();
    const open = statuses.filter(s => s.state === CIRCUIT_STATES.OPEN).length;
    const halfOpen = statuses.filter(s => s.state === CIRCUIT_STATES.HALF_OPEN).length;
    const closed = statuses.filter(s => s.state === CIRCUIT_STATES.CLOSED).length;

    return {
      total: statuses.length,
      open,
      halfOpen,
      closed,
      anyOpen: open > 0,
      breakers: statuses
    };
  }
}

// Global singleton registry
const globalRegistry = new CircuitBreakerRegistry();

/**
 * Get the global circuit breaker registry
 */
function getRegistry() {
  return globalRegistry;
}

/**
 * Convenience function to execute operation with circuit breaker
 * 
 * @param {string} toolName - Name of the tool
 * @param {Function} operation - Async operation to execute
 * @param {Object} log - Logger instance
 * @param {Object} config - Optional configuration override
 * @returns {Promise} Operation result
 */
async function executeWithCircuitBreaker(toolName, operation, log, config = {}) {
  const breaker = globalRegistry.getBreaker(toolName, config);
  return await breaker.execute(operation, log);
}

module.exports = {
  ToolCircuitBreaker,
  CircuitBreakerRegistry,
  getRegistry,
  executeWithCircuitBreaker,
  CIRCUIT_STATES,
  TOOL_BREAKER_CONFIGS
};
