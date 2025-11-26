/**
 * Tests for Tool Circuit Breakers
 */

const {
  ToolCircuitBreaker,
  CircuitBreakerRegistry,
  executeWithCircuitBreaker,
  CIRCUIT_STATES
} = require('../netlify/functions/utils/tool-circuit-breakers.cjs');

const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('Tool Circuit Breakers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ToolCircuitBreaker', () => {
    it('should start in CLOSED state', () => {
      const breaker = new ToolCircuitBreaker('test-tool');
      expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
      expect(breaker.failureCount).toBe(0);
    });

    it('should execute successful operations', async () => {
      const breaker = new ToolCircuitBreaker('test-tool');
      const operation = jest.fn().mockResolvedValue('success');

      const result = await breaker.execute(operation, mockLog);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
    });

    it('should track failures and open circuit after threshold', async () => {
      const breaker = new ToolCircuitBreaker('test-tool', { failureThreshold: 3 });
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      // Fail 3 times to reach threshold
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(operation, mockLog);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);
      expect(breaker.failureCount).toBe(3);
    });

    it('should reject requests when circuit is OPEN', async () => {
      const breaker = new ToolCircuitBreaker('test-tool', { failureThreshold: 2 });
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      // Fail twice to open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(operation, mockLog);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);

      // Next request should be rejected immediately
      await expect(breaker.execute(operation, mockLog)).rejects.toThrow('Circuit breaker is OPEN');
      
      // Operation should not have been called
      expect(operation).toHaveBeenCalledTimes(2); // Only the first 2 attempts
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      const breaker = new ToolCircuitBreaker('test-tool', {
        failureThreshold: 2,
        resetTimeout: 100 // 100ms for fast test
      });
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(operation, mockLog);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Mock successful operation for half-open test
      operation.mockResolvedValueOnce('recovered');

      // Should transition to HALF_OPEN and execute
      const result = await breaker.execute(operation, mockLog);
      expect(result).toBe('recovered');
      expect(breaker.state).toBe(CIRCUIT_STATES.HALF_OPEN);
    });

    it('should close circuit after enough successes in HALF_OPEN', async () => {
      const breaker = new ToolCircuitBreaker('test-tool', {
        failureThreshold: 2,
        resetTimeout: 100,
        halfOpenRequests: 2
      });

      // Open the circuit
      const failingOp = jest.fn().mockRejectedValue(new Error('Test error'));
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(failingOp, mockLog);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.state).toBe(CIRCUIT_STATES.OPEN);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Execute successful operations in half-open state
      const successOp = jest.fn().mockResolvedValue('success');
      
      await breaker.execute(successOp, mockLog);
      expect(breaker.state).toBe(CIRCUIT_STATES.HALF_OPEN);

      await breaker.execute(successOp, mockLog);
      expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
    });

    it('should track statistics correctly', async () => {
      const breaker = new ToolCircuitBreaker('test-tool');
      const successOp = jest.fn().mockResolvedValue('success');
      const failOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Execute some operations
      await breaker.execute(successOp, mockLog);
      try {
        await breaker.execute(failOp, mockLog);
      } catch (e) {
        // Expected
      }
      await breaker.execute(successOp, mockLog);

      const status = breaker.getStatus();
      expect(status.totalRequests).toBe(3);
      expect(status.totalFailures).toBe(1);
      expect(status.failureRate).toBe('33.33%');
    });

    it('should reset manually', () => {
      const breaker = new ToolCircuitBreaker('test-tool', { failureThreshold: 1 });
      
      // Open the circuit
      breaker.failureCount = 5;
      breaker.state = CIRCUIT_STATES.OPEN;
      breaker.lastFailureTime = Date.now();

      breaker.reset(mockLog);

      expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
      expect(breaker.failureCount).toBe(0);
      expect(breaker.lastFailureTime).toBeNull();
    });
  });

  describe('CircuitBreakerRegistry', () => {
    it('should create and retrieve circuit breakers', () => {
      const registry = new CircuitBreakerRegistry();
      
      const breaker1 = registry.getBreaker('tool1');
      const breaker2 = registry.getBreaker('tool2');
      const breaker1Again = registry.getBreaker('tool1');

      expect(breaker1).toBeInstanceOf(ToolCircuitBreaker);
      expect(breaker2).toBeInstanceOf(ToolCircuitBreaker);
      expect(breaker1).toBe(breaker1Again); // Same instance
    });

    it('should get status of all breakers', () => {
      const registry = new CircuitBreakerRegistry();
      
      registry.getBreaker('tool1');
      registry.getBreaker('tool2');

      const statuses = registry.getAllStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses[0].toolName).toBeDefined();
      expect(statuses[1].toolName).toBeDefined();
    });

    it('should detect when any breaker is open', async () => {
      const registry = new CircuitBreakerRegistry();
      
      const breaker = registry.getBreaker('test-tool', { failureThreshold: 1 });
      
      expect(registry.anyOpen()).toBe(false);

      // Open the circuit
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')), mockLog);
      } catch (e) {
        // Expected
      }

      expect(registry.anyOpen()).toBe(true);
    });

    it('should reset specific breaker', () => {
      const registry = new CircuitBreakerRegistry();
      
      const breaker = registry.getBreaker('test-tool');
      breaker.state = CIRCUIT_STATES.OPEN;
      breaker.failureCount = 5;

      const result = registry.resetBreaker('test-tool', mockLog);
      expect(result).toBe(true);
      expect(breaker.state).toBe(CIRCUIT_STATES.CLOSED);
    });

    it('should reset all breakers', () => {
      const registry = new CircuitBreakerRegistry();
      
      const breaker1 = registry.getBreaker('tool1');
      const breaker2 = registry.getBreaker('tool2');
      
      breaker1.state = CIRCUIT_STATES.OPEN;
      breaker2.state = CIRCUIT_STATES.OPEN;

      const count = registry.resetAll(mockLog);
      expect(count).toBe(2);
      expect(breaker1.state).toBe(CIRCUIT_STATES.CLOSED);
      expect(breaker2.state).toBe(CIRCUIT_STATES.CLOSED);
    });

    it('should provide summary statistics', () => {
      const registry = new CircuitBreakerRegistry();
      
      const breaker1 = registry.getBreaker('tool1');
      const breaker2 = registry.getBreaker('tool2');
      const breaker3 = registry.getBreaker('tool3');
      
      breaker1.state = CIRCUIT_STATES.OPEN;
      breaker2.state = CIRCUIT_STATES.HALF_OPEN;
      breaker3.state = CIRCUIT_STATES.CLOSED;

      const summary = registry.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.open).toBe(1);
      expect(summary.halfOpen).toBe(1);
      expect(summary.closed).toBe(1);
      expect(summary.anyOpen).toBe(true);
    });
  });

  describe('executeWithCircuitBreaker', () => {
    it('should execute operation with circuit breaker protection', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await executeWithCircuitBreaker('test-tool', operation, mockLog);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use same breaker instance for same tool', async () => {
      const op1 = jest.fn().mockResolvedValue('result1');
      const op2 = jest.fn().mockResolvedValue('result2');
      
      await executeWithCircuitBreaker('shared-tool', op1, mockLog);
      await executeWithCircuitBreaker('shared-tool', op2, mockLog);
      
      // Both operations should have been executed (circuit still closed)
      expect(op1).toHaveBeenCalledTimes(1);
      expect(op2).toHaveBeenCalledTimes(1);
    });
  });
});
