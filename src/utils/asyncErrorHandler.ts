import type { AnalysisData, BmsSystem, AnalysisRecord } from '@/types';

/**
 * Comprehensive async error handling utilities
 * Provides retry logic, circuit breaker pattern, and standardized error responses
 */

export enum ErrorType {
  NETWORK = 'NETWORK',
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  RATE_LIMIT = 'RATE_LIMIT',
  SERVER = 'SERVER',
  CLIENT = 'CLIENT',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface AppError extends Error {
  readonly type: ErrorType;
  readonly severity: ErrorSeverity;
  readonly code?: string | number;
  readonly context?: Record<string, unknown>;
  readonly timestamp: string;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly originalError?: Error;
}

export class BMSError extends Error implements AppError {
  readonly type: ErrorType;
  readonly severity: ErrorSeverity;
  readonly code?: string | number;
  readonly context?: Record<string, unknown>;
  readonly timestamp: string;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly originalError?: Error;

  constructor(
    message: string,
    options: {
      type: ErrorType;
      severity: ErrorSeverity;
      code?: string | number;
      context?: Record<string, unknown>;
      retryable?: boolean;
      userMessage?: string;
      originalError?: Error;
    }
  ) {
    super(message);
    this.name = 'BMSError';
    this.type = options.type;
    this.severity = options.severity;
    this.code = options.code;
    this.context = options.context;
    this.timestamp = new Date().toISOString();
    this.retryable = options.retryable ?? this.isRetryableByDefault();
    this.userMessage = options.userMessage ?? this.generateUserMessage();
    this.originalError = options.originalError;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, BMSError.prototype);
  }

  private isRetryableByDefault(): boolean {
    switch (this.type) {
      case ErrorType.NETWORK:
      case ErrorType.TIMEOUT:
      case ErrorType.SERVER:
        return true;
      case ErrorType.AUTHENTICATION:
      case ErrorType.AUTHORIZATION:
      case ErrorType.VALIDATION:
      case ErrorType.CLIENT:
        return false;
      case ErrorType.RATE_LIMIT:
        return true; // But with backoff
      default:
        return false;
    }
  }

  private generateUserMessage(): string {
    switch (this.type) {
      case ErrorType.NETWORK:
        return 'Network connection issue. Please check your internet connection and try again.';
      case ErrorType.TIMEOUT:
        return 'Request timed out. The server is taking too long to respond.';
      case ErrorType.RATE_LIMIT:
        return 'Too many requests. Please wait a moment before trying again.';
      case ErrorType.AUTHENTICATION:
        return 'Authentication failed. Please sign in again.';
      case ErrorType.AUTHORIZATION:
        return 'Access denied. You do not have permission to perform this action.';
      case ErrorType.VALIDATION:
        return 'Invalid input data. Please check your information and try again.';
      case ErrorType.SERVER:
        return 'Server error occurred. Our team has been notified.';
      case ErrorType.CLIENT:
        return 'Client error. Please refresh the page and try again.';
      default:
        return 'An unexpected error occurred. Please try again or contact support.';
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      severity: this.severity,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      retryable: this.retryable,
      userMessage: this.userMessage,
      stack: this.stack,
    };
  }
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryCondition?: (error: Error) => boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly timeout: number = 60000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.timeout) {
        throw new BMSError('Circuit breaker is OPEN', {
          type: ErrorType.SERVER,
          severity: ErrorSeverity.HIGH,
          retryable: false,
        });
      } else {
        this.state = 'HALF_OPEN';
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.state = 'CLOSED';
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error;

  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      const isRetryable = finalConfig.retryCondition
        ? finalConfig.retryCondition(lastError)
        : lastError instanceof BMSError
          ? lastError.retryable
          : true;

      if (attempt === finalConfig.maxAttempts || !isRetryable) {
        break;
      }

      const delay = Math.min(
        finalConfig.initialDelay * Math.pow(finalConfig.backoffMultiplier, attempt - 1),
        finalConfig.maxDelay
      );

      console.warn(`[withRetry] Attempt ${attempt} failed, retrying in ${delay}ms:`, lastError);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function createErrorFromResponse(response: Response, context?: Record<string, unknown>): BMSError {
  const { status, statusText } = response;

  let type: ErrorType;
  let severity: ErrorSeverity;

  if (status >= 500) {
    type = ErrorType.SERVER;
    severity = ErrorSeverity.HIGH;
  } else if (status === 429) {
    type = ErrorType.RATE_LIMIT;
    severity = ErrorSeverity.MEDIUM;
  } else if (status === 401) {
    type = ErrorType.AUTHENTICATION;
    severity = ErrorSeverity.MEDIUM;
  } else if (status === 403) {
    type = ErrorType.AUTHORIZATION;
    severity = ErrorSeverity.MEDIUM;
  } else if (status >= 400) {
    type = ErrorType.CLIENT;
    severity = ErrorSeverity.LOW;
  } else {
    type = ErrorType.UNKNOWN;
    severity = ErrorSeverity.MEDIUM;
  }

  return new BMSError(`HTTP ${status}: ${statusText}`, {
    type,
    severity,
    code: status,
    context: { ...context, url: response.url },
  });
}

export function createErrorFromException(error: unknown, context?: Record<string, unknown>): BMSError {
  if (error instanceof BMSError) {
    return error;
  }

  if (error instanceof Error) {
    let type: ErrorType = ErrorType.UNKNOWN;
    let severity: ErrorSeverity = ErrorSeverity.MEDIUM;

    if (error.name === 'TypeError' || error.name === 'SyntaxError') {
      type = ErrorType.CLIENT;
      severity = ErrorSeverity.LOW;
    } else if (error.message.toLowerCase().includes('network')) {
      type = ErrorType.NETWORK;
      severity = ErrorSeverity.MEDIUM;
    } else if (error.message.toLowerCase().includes('timeout')) {
      type = ErrorType.TIMEOUT;
      severity = ErrorSeverity.MEDIUM;
    }

    return new BMSError(error.message, {
      type,
      severity,
      context,
      originalError: error,
    });
  }

  return new BMSError('Unknown error occurred', {
    type: ErrorType.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    context: { ...context, originalError: error },
  });
}

// Service-specific error handlers
export class ServiceErrorHandler {
  private static circuitBreakers = new Map<string, CircuitBreaker>();

  static getCircuitBreaker(serviceName: string): CircuitBreaker {
    if (!this.circuitBreakers.has(serviceName)) {
      this.circuitBreakers.set(serviceName, new CircuitBreaker());
    }
    return this.circuitBreakers.get(serviceName)!;
  }

  static async handleApiCall<T>(
    serviceName: string,
    operation: () => Promise<T>,
    options: {
      retryConfig?: Partial<RetryConfig>;
      useCircuitBreaker?: boolean;
      context?: Record<string, unknown>;
    } = {}
  ): Promise<T> {
    const { retryConfig, useCircuitBreaker = true, context } = options;

    const wrappedOperation = async (): Promise<T> => {
      try {
        if (useCircuitBreaker) {
          const circuitBreaker = this.getCircuitBreaker(serviceName);
          return await circuitBreaker.execute(operation);
        } else {
          return await operation();
        }
      } catch (error) {
        throw createErrorFromException(error, { ...context, service: serviceName });
      }
    };

    return await withRetry(wrappedOperation, retryConfig);
  }
}

// Type-safe result wrapper for better error handling
export type Result<T, E = BMSError> =
  | { success: true; data: T; error?: never }
  | { success: false; error: E; data?: never };

export function createSuccess<T>(data: T): Result<T> {
  return { success: true, data };
}

export function createFailure<E = BMSError>(error: E): Result<never, E> {
  return { success: false, error };
}

export async function safeAsync<T>(
  operation: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<Result<T>> {
  try {
    const data = await operation();
    return createSuccess(data);
  } catch (error) {
    return createFailure(createErrorFromException(error, context));
  }
}

// Specific error factories for common scenarios
export const ErrorFactory = {
  networkError: (message = 'Network request failed', context?: Record<string, unknown>) =>
    new BMSError(message, {
      type: ErrorType.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      context,
    }),

  validationError: (message = 'Validation failed', field?: string, context?: Record<string, unknown>) =>
    new BMSError(message, {
      type: ErrorType.VALIDATION,
      severity: ErrorSeverity.LOW,
      context: { ...context, field },
      retryable: false,
    }),

  timeoutError: (message = 'Request timed out', timeout?: number, context?: Record<string, unknown>) =>
    new BMSError(message, {
      type: ErrorType.TIMEOUT,
      severity: ErrorSeverity.MEDIUM,
      context: { ...context, timeout },
    }),

  rateLimitError: (message = 'Rate limit exceeded', context?: Record<string, unknown>) =>
    new BMSError(message, {
      type: ErrorType.RATE_LIMIT,
      severity: ErrorSeverity.MEDIUM,
      context,
    }),

  authenticationError: (message = 'Authentication required', context?: Record<string, unknown>) =>
    new BMSError(message, {
      type: ErrorType.AUTHENTICATION,
      severity: ErrorSeverity.MEDIUM,
      context,
      retryable: false,
    }),

  serverError: (message = 'Internal server error', context?: Record<string, unknown>) =>
    new BMSError(message, {
      type: ErrorType.SERVER,
      severity: ErrorSeverity.HIGH,
      context,
    }),
};

export default {
  BMSError,
  ServiceErrorHandler,
  ErrorFactory,
  withRetry,
  safeAsync,
  createSuccess,
  createFailure,
  CircuitBreaker,
};