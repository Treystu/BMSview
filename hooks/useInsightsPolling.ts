/**
 * Custom Hook for Insights Job Polling
 * 
 * Polls for insights generation status with real-time progress updates.
 * Implements exponential backoff and handles streaming progress events.
 * 
 * @module hooks/useInsightsPolling
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface InsightsProgress {
  timestamp: string;
  type: 'tool_call' | 'tool_response' | 'ai_response' | 'iteration' | 'status' | 'error';
  data: any;
}

export interface InsightsJobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  initialSummary?: any;
  progress?: InsightsProgress[];
  progressCount?: number;
  partialInsights?: string;
  finalInsights?: any;
  error?: string;
}

interface PollingConfig {
  initialInterval?: number;
  maxInterval?: number;
  backoffMultiplier?: number;
  maxRetries?: number;
  onComplete?: (jobId: string, insights: any) => void;
  onError?: (jobId: string, error: string) => void;
  onProgress?: (jobId: string, progress: InsightsProgress[]) => void;
}

const DEFAULT_CONFIG: Required<PollingConfig> = {
  initialInterval: 2000,
  maxInterval: 10000,
  backoffMultiplier: 1.3,
  maxRetries: Infinity, // "Starter Motor" approach: never give up until definitive result
  onComplete: () => {},
  onError: () => {},
  onProgress: () => {}
};

/**
 * Hook for polling insights job status
 * 
 * @param jobId - Insights job ID to poll
 * @param config - Polling configuration
 * @returns Polling state and control functions
 */
export function useInsightsPolling(jobId: string | null, config: PollingConfig = {}) {
  // Memoize fullConfig to prevent unnecessary re-renders
  const fullConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [
    config.initialInterval,
    config.maxInterval,
    config.backoffMultiplier,
    config.maxRetries,
    config.onComplete,
    config.onError,
    config.onProgress
  ]);
  
  const [status, setStatus] = useState<InsightsJobStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProgressCount, setLastProgressCount] = useState(0);
  
  const intervalRef = useRef<number>(fullConfig.initialInterval);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);
  const consecutiveErrorsRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!jobId) return true; // Stop polling if no jobId

    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/.netlify/functions/generate-insights-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: InsightsJobStatus = await response.json();
      
      setStatus(data);
      setError(null);
      consecutiveErrorsRef.current = 0;

      // Check for new progress events
      if (data.progress && data.progressCount && data.progressCount > lastProgressCount) {
        setLastProgressCount(data.progressCount);
        fullConfig.onProgress(jobId, data.progress);
      }

      // Check if job is in terminal state
      if (data.status === 'completed') {
        if (data.finalInsights) {
          fullConfig.onComplete(jobId, data.finalInsights);
        }
        setIsPolling(false);
        return true; // Stop polling
      } else if (data.status === 'failed') {
        fullConfig.onError(jobId, data.error || 'Job failed');
        setIsPolling(false);
        return true; // Stop polling
      }

      // Reset interval on successful fetch
      intervalRef.current = fullConfig.initialInterval;
      return false; // Continue polling

    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Request was cancelled, ignore
        return false;
      }

      // Log error for debugging but don't update UI state to "Error"
      console.warn(JSON.stringify({
        level: 'WARN',
        timestamp: new Date().toISOString(),
        message: 'Polling request failed, will retry',
        context: {
          error: err.message,
          consecutiveErrors: consecutiveErrorsRef.current + 1,
          jobId
        }
      }));
      
      consecutiveErrorsRef.current++;

      // Exponential backoff on errors
      if (consecutiveErrorsRef.current >= 3) {
        intervalRef.current = Math.min(
          intervalRef.current * fullConfig.backoffMultiplier,
          fullConfig.maxInterval
        );
      }

      // "Starter Motor" approach: Only stop on catastrophic errors that won't recover
      // Network errors (500, 502, 504, timeouts) are transient - keep trying
      // Check HTTP status code from error object or response
      const status = err.status || err.response?.status;
      const isCatastrophic = status === 404 || // Job not found
                             status === 403 || // Forbidden
                             status === 401;   // Unauthorized
      
      if (isCatastrophic) {
        setError(`Fatal error: ${err.message}`);
        setIsPolling(false);
        return true;
      }

      // For transient errors, don't update UI error state, just continue polling
      // This keeps the UI showing "Analyzing..." instead of flashing error messages
      return false; // Continue polling
    }
  }, [jobId, fullConfig, lastProgressCount]);

  const poll = useCallback(async () => {
    if (!isPolling) return;

    retryCountRef.current++;

    // "Starter Motor" approach: No maximum retry limit
    // Comment out the maxRetries check - we keep trying until definitive result
    // if (retryCountRef.current > fullConfig.maxRetries) {
    //   setError('Maximum polling attempts reached');
    //   setIsPolling(false);
    //   return;
    // }

    const shouldStop = await fetchStatus();

    if (!shouldStop && isPolling) {
      timeoutRef.current = setTimeout(poll, intervalRef.current);
    }
  }, [isPolling, fetchStatus]);

  const startPolling = useCallback(() => {
    if (!jobId) return;
    
    setIsPolling(true);
    setError(null);
    setLastProgressCount(0);
    retryCountRef.current = 0;
    consecutiveErrorsRef.current = 0;
    intervalRef.current = fullConfig.initialInterval;
  }, [jobId, fullConfig.initialInterval]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const resetPolling = useCallback(() => {
    stopPolling();
    setStatus(null);
    setError(null);
    setLastProgressCount(0);
    retryCountRef.current = 0;
    consecutiveErrorsRef.current = 0;
    intervalRef.current = fullConfig.initialInterval;
  }, [stopPolling, fullConfig.initialInterval]);

  // Start polling when isPolling becomes true
  useEffect(() => {
    if (isPolling) {
      poll();
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isPolling, poll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    status,
    isPolling,
    error,
    startPolling,
    stopPolling,
    resetPolling,
    currentInterval: intervalRef.current,
    retryCount: retryCountRef.current
  };
}
