/**
 * Enhanced Job Polling Hook
 * Implements exponential backoff and intelligent retry logic
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface JobStatus {
  jobId: string;
  status: string;
  recordId?: string;
  retryCount?: number;
  nextRetryAt?: string;
  lastFailureReason?: string;
  fileName?: string;
  error?: string;
}

interface PollingConfig {
  initialInterval?: number;
  maxInterval?: number;
  backoffMultiplier?: number;
  maxRetries?: number;
  onComplete?: (jobId: string, recordId: string) => void;
  onError?: (jobId: string, error: string) => void;
}

const DEFAULT_CONFIG: Required<PollingConfig> = {
  initialInterval: 2000,
  maxInterval: 30000,
  backoffMultiplier: 1.5,
  maxRetries: 50,
  onComplete: () => { },
  onError: () => { }
};

export function useJobPolling(jobIds: string[], config: PollingConfig = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  const [statuses, setStatuses] = useState<Map<string, JobStatus>>(new Map());
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<number>(fullConfig.initialInterval);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);
  const consecutiveErrorsRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchStatuses = useCallback(async () => {
    if (jobIds.length === 0) return;

    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/.netlify/functions/get-job-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobIds }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const newStatuses = new Map<string, JobStatus>();

      let allCompleted = true;
      let hasErrors = false;

      for (const status of data.statuses) {
        newStatuses.set(status.jobId, status);

        // Check if job is in terminal state
        if (status.status === 'completed') {
          fullConfig.onComplete(status.jobId, status.recordId);
        } else if (status.status === 'failed' || status.status.startsWith('failed_')) {
          hasErrors = true;
          fullConfig.onError(status.jobId, status.error || status.lastFailureReason || 'Unknown error');
        } else if (status.status !== 'completed') {
          allCompleted = false;
        }
      }

      setStatuses(newStatuses);
      setError(null);
      consecutiveErrorsRef.current = 0;

      // Stop polling if all jobs are complete or failed
      if (allCompleted || hasErrors) {
        setIsPolling(false);
        // Clean up abort controller when stopping
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        return true; // Signal to stop polling
      }

      // Reset interval on successful fetch
      intervalRef.current = fullConfig.initialInterval;
      return false; // Continue polling

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled, ignore
        return false;
      }

      console.error('Error fetching job statuses:', err);
      consecutiveErrorsRef.current++;

      // Exponential backoff on errors
      if (consecutiveErrorsRef.current >= 3) {
        intervalRef.current = Math.min(
          intervalRef.current * fullConfig.backoffMultiplier,
          fullConfig.maxInterval
        );
      }

      // Stop polling after too many consecutive errors
      if (consecutiveErrorsRef.current >= 10) {
        setError('Too many consecutive errors. Polling stopped.');
        setIsPolling(false);
        return true;
      }

      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [jobIds, fullConfig]);

  const poll = useCallback(async () => {
    if (!isPolling) return;

    retryCountRef.current++;

    if (retryCountRef.current > fullConfig.maxRetries) {
      setError('Maximum polling attempts reached');
      setIsPolling(false);
      return;
    }

    const shouldStop = await fetchStatuses();

    if (!shouldStop && isPolling) {
      timeoutRef.current = setTimeout(poll, intervalRef.current);
    }
  }, [isPolling, fetchStatuses, fullConfig.maxRetries]);

  const startPolling = useCallback(() => {
    if (jobIds.length === 0) return;

    setIsPolling(true);
    setError(null);
    retryCountRef.current = 0;
    consecutiveErrorsRef.current = 0;
    intervalRef.current = fullConfig.initialInterval;
  }, [jobIds, fullConfig.initialInterval]);

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
    setStatuses(new Map());
    setError(null);
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
    statuses: Array.from(statuses.values()),
    isPolling,
    error,
    startPolling,
    stopPolling,
    resetPolling,
    currentInterval: intervalRef.current,
    retryCount: retryCountRef.current
  };
}