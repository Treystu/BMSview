import React, { Component, ReactNode } from 'react';
import type { ErrorInfo } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string;
  retryCount: number;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo, errorId: string) => void;
  maxRetries?: number;
  resetOnPropsChange?: boolean;
  resetKeys?: unknown[];
}

/**
 * Enhanced Error Boundary Component
 * Provides graceful error handling with retry functionality and detailed error reporting
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId: number | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: '',
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return {
      hasError: true,
      error,
      errorId,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError } = this.props;
    const { errorId } = this.state;

    // Enhanced error logging
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorId,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      retryCount: this.state.retryCount,
    };

    console.error('[ErrorBoundary] Component error caught:', errorDetails);

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo, errorId);
    }

    // Report to monitoring service in production
    if (process.env.NODE_ENV === 'production') {
      this.reportError(errorDetails);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetOnPropsChange, resetKeys } = this.props;
    const { hasError } = this.state;

    if (hasError && prevProps.resetKeys !== resetKeys && resetOnPropsChange) {
      this.resetErrorBoundary();
    }
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      window.clearTimeout(this.resetTimeoutId);
    }
  }

  private reportError = (errorDetails: Record<string, unknown>) => {
    // Report to external monitoring service (e.g., Sentry, LogRocket)
    try {
      fetch('/.netlify/functions/error-reporting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'client_error',
          error: errorDetails,
        }),
      }).catch(err => {
        console.warn('[ErrorBoundary] Failed to report error:', err);
      });
    } catch (err) {
      console.warn('[ErrorBoundary] Error reporting failed:', err);
    }
  };

  private resetErrorBoundary = () => {
    if (this.resetTimeoutId) {
      window.clearTimeout(this.resetTimeoutId);
    }

    this.setState({
      hasError: false,
      error: null,
      errorId: '',
      retryCount: 0,
    });
  };

  private handleRetry = () => {
    const { maxRetries = 3 } = this.props;
    const { retryCount } = this.state;

    if (retryCount >= maxRetries) {
      console.error('[ErrorBoundary] Max retry attempts reached');
      return;
    }

    this.setState({
      hasError: false,
      error: null,
      errorId: '',
      retryCount: retryCount + 1,
    });

    // Auto-reset after 5 seconds if error occurs again
    this.resetTimeoutId = window.setTimeout(() => {
      if (this.state.hasError) {
        this.resetErrorBoundary();
      }
    }, 5000);
  };

  private renderDefaultErrorUI = (error: Error) => {
    const { errorId, retryCount } = this.state;
    const { maxRetries = 3 } = this.props;
    const canRetry = retryCount < maxRetries;

    return (
      <div className="error-boundary-container bg-red-50 border border-red-200 rounded-lg p-6 m-4">
        <div className="flex items-center mb-4">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-red-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">
              Something went wrong
            </h3>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-sm text-red-700 mb-2">
            An unexpected error occurred while rendering this component.
          </p>
          <details className="text-sm text-red-600">
            <summary className="cursor-pointer font-medium hover:text-red-800">
              Error Details
            </summary>
            <div className="mt-2 p-3 bg-red-100 rounded border font-mono text-xs overflow-x-auto">
              <div><strong>Error:</strong> {error.message}</div>
              <div><strong>Error ID:</strong> {errorId}</div>
              <div><strong>Retry Attempt:</strong> {retryCount + 1}</div>
            </div>
          </details>
        </div>

        <div className="flex space-x-3">
          {canRetry && (
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Try Again
            </button>
          )}
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-3 py-2 border border-red-300 text-sm leading-4 font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Reload Page
          </button>
        </div>

        {!canRetry && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-sm text-yellow-800">
              Maximum retry attempts reached. Please reload the page or contact support if the problem persists.
            </p>
          </div>
        )}
      </div>
    );
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback(error, this.handleRetry);
      }
      return this.renderDefaultErrorUI(error);
    }

    return children;
  }
}

// Higher-order component for easy wrapping
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

// Hook for imperative error reporting
export function useErrorReporting() {
  const reportError = React.useCallback((error: Error, context?: Record<string, unknown>) => {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    console.error('[useErrorReporting] Manual error report:', errorDetails);

    if (process.env.NODE_ENV === 'production') {
      fetch('/.netlify/functions/error-reporting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'manual_error',
          error: errorDetails,
        }),
      }).catch(err => {
        console.warn('[useErrorReporting] Failed to report error:', err);
      });
    }
  }, []);

  return { reportError };
}

export default ErrorBoundary;