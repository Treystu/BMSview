import {
  BMSError,
  ErrorType,
  ErrorSeverity,
  withRetry,
  CircuitBreaker,
  ServiceErrorHandler,
  safeAsync,
  createSuccess,
  createFailure,
  createErrorFromResponse,
  createErrorFromException,
  ErrorFactory,
} from '../../utils/asyncErrorHandler';
import { waitForNextUpdate } from './testUtils';

describe('AsyncErrorHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('BMSError', () => {
    it('should create error with all properties', () => {
      const error = new BMSError('Test error', {
        type: ErrorType.CLIENT,
        severity: ErrorSeverity.HIGH,
        code: 400,
        context: { userId: '123' },
        retryable: false,
        userMessage: 'Something went wrong',
      });

      expect(error.message).toBe('Test error');
      expect(error.type).toBe(ErrorType.CLIENT);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.code).toBe(400);
      expect(error.context).toEqual({ userId: '123' });
      expect(error.retryable).toBe(false);
      expect(error.userMessage).toBe('Something went wrong');
      expect(error.timestamp).toBeDefined();
    });

    it('should auto-determine retryable status', () => {
      const networkError = new BMSError('Network error', {
        type: ErrorType.NETWORK,
        severity: ErrorSeverity.MEDIUM,
      });
      expect(networkError.retryable).toBe(true);

      const validationError = new BMSError('Validation error', {
        type: ErrorType.VALIDATION,
        severity: ErrorSeverity.LOW,
      });
      expect(validationError.retryable).toBe(false);
    });

    it('should generate appropriate user messages', () => {
      const networkError = new BMSError('Network timeout', {
        type: ErrorType.NETWORK,
        severity: ErrorSeverity.MEDIUM,
      });
      expect(networkError.userMessage).toContain('Network connection');

      const authError = new BMSError('Token expired', {
        type: ErrorType.AUTHENTICATION,
        severity: ErrorSeverity.MEDIUM,
      });
      expect(authError.userMessage).toContain('Authentication failed');
    });

    it('should serialize properly', () => {
      const error = new BMSError('Test error', {
        type: ErrorType.SERVER,
        severity: ErrorSeverity.HIGH,
        code: 500,
      });

      const serialized = error.toJSON();
      expect(serialized.name).toBe('BMSError');
      expect(serialized.message).toBe('Test error');
      expect(serialized.type).toBe(ErrorType.SERVER);
      expect(serialized.severity).toBe(ErrorSeverity.HIGH);
      expect(serialized.code).toBe(500);
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const successOperation = jest.fn().mockResolvedValue('success');
      const result = await withRetry(successOperation);

      expect(result).toBe('success');
      expect(successOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValueOnce('success');

      const result = await withRetry(operation, { maxAttempts: 3, initialDelay: 1 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should respect maxAttempts', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        withRetry(operation, { maxAttempts: 2, initialDelay: 1 })
      ).rejects.toThrow('Always fails');

      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableError = new BMSError('Validation error', {
        type: ErrorType.VALIDATION,
        severity: ErrorSeverity.LOW,
        retryable: false,
      });

      const operation = jest.fn().mockRejectedValue(nonRetryableError);

      await expect(
        withRetry(operation, { maxAttempts: 3 })
      ).rejects.toThrow('Validation error');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should respect custom retry condition', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Custom error'));

      const retryCondition = jest.fn().mockReturnValue(false);

      await expect(
        withRetry(operation, { maxAttempts: 3, retryCondition })
      ).rejects.toThrow('Custom error');

      expect(operation).toHaveBeenCalledTimes(1);
      expect(retryCondition).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should implement exponential backoff', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce('success');

      const startTime = Date.now();
      await withRetry(operation, {
        maxAttempts: 2,
        initialDelay: 100,
        backoffMultiplier: 2,
      });
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThan(100);
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('CircuitBreaker', () => {
    it('should start in closed state', () => {
      const breaker = new CircuitBreaker(3, 1000);
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should open after threshold failures', async () => {
      const breaker = new CircuitBreaker(2, 1000);
      const failingOperation = jest.fn().mockRejectedValue(new Error('Failure'));

      // First failure
      await expect(breaker.execute(failingOperation)).rejects.toThrow('Failure');
      expect(breaker.getState()).toBe('CLOSED');

      // Second failure - should open the circuit
      await expect(breaker.execute(failingOperation)).rejects.toThrow('Failure');
      expect(breaker.getState()).toBe('OPEN');

      // Third attempt - should fail fast
      await expect(breaker.execute(failingOperation)).rejects.toThrow('Circuit breaker is OPEN');
      expect(failingOperation).toHaveBeenCalledTimes(2);
    });

    it('should reset on success', async () => {
      const breaker = new CircuitBreaker(2, 1000);
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Failure'))
        .mockResolvedValueOnce('success');

      await expect(breaker.execute(operation)).rejects.toThrow('Failure');
      expect(breaker.getState()).toBe('CLOSED');

      const result = await breaker.execute(operation);
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker(1, 50); // Short timeout for testing
      const failingOperation = jest.fn().mockRejectedValue(new Error('Failure'));

      // Open the circuit
      await expect(breaker.execute(failingOperation)).rejects.toThrow('Failure');
      expect(breaker.getState()).toBe('OPEN');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Next call should put it in half-open
      const successOperation = jest.fn().mockResolvedValue('success');
      const result = await breaker.execute(successOperation);

      expect(result).toBe('success');
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('ServiceErrorHandler', () => {
    it('should handle successful operations', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await ServiceErrorHandler.handleApiCall('testService', operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should wrap exceptions in BMSError', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Raw error'));

      await expect(
        ServiceErrorHandler.handleApiCall('testService', operation)
      ).rejects.toBeInstanceOf(BMSError);
    });

    it('should use circuit breaker by default', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('Service failure'));

      // Multiple failures should eventually trigger circuit breaker
      for (let i = 0; i < 6; i++) {
        try {
          await ServiceErrorHandler.handleApiCall('testService', failingOperation);
        } catch (error) {
          // Expected
        }
      }

      // Circuit should be open now
      await expect(
        ServiceErrorHandler.handleApiCall('testService', failingOperation)
      ).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should allow disabling circuit breaker', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Failure'));

      await expect(
        ServiceErrorHandler.handleApiCall('testService', operation, {
          useCircuitBreaker: false
        })
      ).rejects.toBeInstanceOf(BMSError);

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('safeAsync', () => {
    it('should return success result for successful operations', async () => {
      const operation = () => Promise.resolve('success');
      const result = await safeAsync(operation);

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.error).toBeUndefined();
    });

    it('should return failure result for failed operations', async () => {
      const operation = () => Promise.reject(new Error('Failure'));
      const result = await safeAsync(operation);

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(BMSError);
      expect(result.data).toBeUndefined();
    });

    it('should include context in error', async () => {
      const operation = () => Promise.reject(new Error('Failure'));
      const context = { userId: '123', action: 'test' };
      const result = await safeAsync(operation, context);

      expect(result.success).toBe(false);
      expect(result.error?.context).toEqual(expect.objectContaining(context));
    });
  });

  describe('createSuccess and createFailure', () => {
    it('should create success result', () => {
      const result = createSuccess('data');
      expect(result.success).toBe(true);
      expect(result.data).toBe('data');
      expect(result.error).toBeUndefined();
    });

    it('should create failure result', () => {
      const error = new BMSError('Test error', {
        type: ErrorType.CLIENT,
        severity: ErrorSeverity.LOW,
      });
      const result = createFailure(error);
      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.data).toBeUndefined();
    });
  });

  describe('createErrorFromResponse', () => {
    it('should create appropriate error types for different status codes', () => {
      const responses = [
        { status: 400, statusText: 'Bad Request', expectedType: ErrorType.CLIENT },
        { status: 401, statusText: 'Unauthorized', expectedType: ErrorType.AUTHENTICATION },
        { status: 403, statusText: 'Forbidden', expectedType: ErrorType.AUTHORIZATION },
        { status: 429, statusText: 'Too Many Requests', expectedType: ErrorType.RATE_LIMIT },
        { status: 500, statusText: 'Internal Server Error', expectedType: ErrorType.SERVER },
      ];

      responses.forEach(({ status, statusText, expectedType }) => {
        const mockResponse = {
          status,
          statusText,
          url: 'http://test.com',
        } as Response;

        const error = createErrorFromResponse(mockResponse);
        expect(error.type).toBe(expectedType);
        expect(error.code).toBe(status);
        expect(error.message).toContain(statusText);
      });
    });
  });

  describe('createErrorFromException', () => {
    it('should return BMSError unchanged', () => {
      const originalError = new BMSError('Test', {
        type: ErrorType.CLIENT,
        severity: ErrorSeverity.LOW,
      });
      const result = createErrorFromException(originalError);
      expect(result).toBe(originalError);
    });

    it('should wrap regular errors', () => {
      const originalError = new Error('Regular error');
      const result = createErrorFromException(originalError);

      expect(result).toBeInstanceOf(BMSError);
      expect(result.message).toBe('Regular error');
      expect(result.originalError).toBe(originalError);
    });

    it('should handle non-Error objects', () => {
      const result = createErrorFromException('string error');

      expect(result).toBeInstanceOf(BMSError);
      expect(result.message).toBe('Unknown error occurred');
      expect(result.context?.originalError).toBe('string error');
    });

    it('should categorize known error types', () => {
      const typeError = new TypeError('Type error');
      const result = createErrorFromException(typeError);

      expect(result.type).toBe(ErrorType.CLIENT);
      expect(result.originalError).toBe(typeError);
    });
  });

  describe('ErrorFactory', () => {
    it('should create network errors', () => {
      const error = ErrorFactory.networkError('Connection failed');
      expect(error.type).toBe(ErrorType.NETWORK);
      expect(error.message).toBe('Connection failed');
      expect(error.retryable).toBe(true);
    });

    it('should create validation errors', () => {
      const error = ErrorFactory.validationError('Invalid input', 'email');
      expect(error.type).toBe(ErrorType.VALIDATION);
      expect(error.retryable).toBe(false);
      expect(error.context?.field).toBe('email');
    });

    it('should create timeout errors', () => {
      const error = ErrorFactory.timeoutError('Request timed out', 30000);
      expect(error.type).toBe(ErrorType.TIMEOUT);
      expect(error.context?.timeout).toBe(30000);
    });

    it('should create rate limit errors', () => {
      const error = ErrorFactory.rateLimitError();
      expect(error.type).toBe(ErrorType.RATE_LIMIT);
      expect(error.retryable).toBe(true);
    });

    it('should create authentication errors', () => {
      const error = ErrorFactory.authenticationError();
      expect(error.type).toBe(ErrorType.AUTHENTICATION);
      expect(error.retryable).toBe(false);
    });

    it('should create server errors', () => {
      const error = ErrorFactory.serverError();
      expect(error.type).toBe(ErrorType.SERVER);
      expect(error.retryable).toBe(true);
    });
  });
});