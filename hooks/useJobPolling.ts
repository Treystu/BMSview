import { useEffect, useRef, useState, useCallback } from 'react';
import { getJobStatuses, getAnalysisRecordById } from '../services/clientService';
import type { AnalysisRecord } from '../types';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        hook: 'useJobPolling',
        message,
        context
    }));
};

interface UseJobPollingProps {
    jobIds: string[];
    onJobCompleted: (jobId: string, record: AnalysisRecord) => void;
    onJobStatusUpdate: (jobId: string, status: string) => void;
    onJobFailed: (jobId: string, error: string) => void;
    onPollingError: (error: string) => void;
}

interface PollingState {
    isPolling: boolean;
    errorCount: number;
    lastPollTime: number;
    consecutiveErrors: number;
}

const POLLING_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_BACKOFF_MULTIPLIER = 2;
const MAX_POLLING_TIME_MS = 20 * 60 * 1000; // 20 minutes

export const useJobPolling = ({
    jobIds,
    onJobCompleted,
    onJobStatusUpdate,
    onJobFailed,
    onPollingError
}: UseJobPollingProps) => {
    const [pollingState, setPollingState] = useState<PollingState>({
        isPolling: false,
        errorCount: 0,
        lastPollTime: 0,
        consecutiveErrors: 0
    });

    const intervalRef = useRef<number | null>(null);
    const timeoutRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(Date.now());

    const calculateBackoffDelay = useCallback((errorCount: number): number => {
        const baseDelay = POLLING_INTERVAL_MS;
        const backoffDelay = baseDelay * Math.pow(ERROR_BACKOFF_MULTIPLIER, Math.min(errorCount, 3));
        return Math.min(backoffDelay, 60000); // Cap at 1 minute
    }, []);

    const pollJobStatuses = useCallback(async () => {
        if (jobIds.length === 0) return;

        const now = Date.now();
        
        // Check if we've exceeded max polling time
        if (now - startTimeRef.current > MAX_POLLING_TIME_MS) {
            log('warn', 'Max polling time exceeded, stopping polling', { 
                elapsedTime: now - startTimeRef.current,
                maxTime: MAX_POLLING_TIME_MS 
            });
            
            jobIds.forEach(jobId => {
                onJobFailed(jobId, 'Job processing timeout exceeded');
            });
            
            stopPolling();
            return;
        }

        try {
            log('info', 'Polling job statuses', { jobCount: jobIds.length, jobIds });
            
            const statuses = await getJobStatuses(jobIds);
            let completedJobs = 0;
            
            log('info', 'Received job statuses from server', { statuses });

            for (const status of statuses) {
                if (status.status === 'completed' && status.recordId) {
                    log('info', 'Job completed, fetching full record', { 
                        jobId: status.id, 
                        recordId: status.recordId 
                    });
                    
                    try {
                        const record = await getAnalysisRecordById(status.recordId);
                        if (record) {
                            onJobCompleted(status.id, record);
                            completedJobs++;
                        } else {
                            log('warn', 'Job completed but could not fetch the final record', { 
                                jobId: status.id, 
                                recordId: status.recordId 
                            });
                            onJobFailed(status.id, 'Failed to fetch completed record');
                        }
                    } catch (fetchError) {
                        log('error', 'Error fetching completed record', { 
                            jobId: status.id, 
                            recordId: status.recordId,
                            error: fetchError instanceof Error ? fetchError.message : String(fetchError)
                        });
                        onJobFailed(status.id, 'Failed to fetch completed record');
                    }
                } else if (status.status.startsWith('failed') || status.status === 'not_found') {
                    log('warn', `Job ${status.status}`, { 
                        jobId: status.id, 
                        error: status.error 
                    });
                    onJobFailed(status.id, status.error || 'Job processing failed');
                } else {
                    log('info', 'Job status updated', { 
                        jobId: status.id, 
                        status: status.status 
                    });
                    onJobStatusUpdate(status.id, status.status);
                }
            }

            // Reset error count on successful poll
            setPollingState(prev => ({
                ...prev,
                errorCount: 0,
                consecutiveErrors: 0,
                lastPollTime: now
            }));

            // Stop polling if all jobs are completed or failed
            if (completedJobs === jobIds.length) {
                log('info', 'All jobs completed, stopping polling');
                stopPolling();
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown polling error';
            log('error', 'Failed to poll job statuses', { error: errorMessage });
            
            const newConsecutiveErrors = pollingState.consecutiveErrors + 1;
            
            setPollingState(prev => ({
                ...prev,
                errorCount: prev.errorCount + 1,
                consecutiveErrors: newConsecutiveErrors,
                lastPollTime: now
            }));

            onPollingError(errorMessage);

            // Stop polling if we've exceeded max consecutive errors
            if (newConsecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                log('error', 'Max consecutive polling errors exceeded, stopping polling', { 
                    consecutiveErrors: newConsecutiveErrors 
                });
                
                jobIds.forEach(jobId => {
                    onJobFailed(jobId, 'Polling failed repeatedly, job may be stuck');
                });
                
                stopPolling();
            }
        }
    }, [jobIds, onJobCompleted, onJobStatusUpdate, onJobFailed, onPollingError, pollingState.consecutiveErrors]);

    const startPolling = useCallback(() => {
        if (jobIds.length === 0) return;

        log('info', 'Starting job status polling', { jobCount: jobIds.length, jobIds });
        
        setPollingState(prev => ({
            ...prev,
            isPolling: true,
            startTime: Date.now()
        }));

        startTimeRef.current = Date.now();

        // Initial poll
        pollJobStatuses();

        // Set up interval with dynamic backoff
        const scheduleNextPoll = () => {
            const delay = calculateBackoffDelay(pollingState.consecutiveErrors);
            log('debug', 'Scheduling next poll', { delay, consecutiveErrors: pollingState.consecutiveErrors });
            
            timeoutRef.current = window.setTimeout(() => {
                pollJobStatuses().then(() => {
                    if (pollingState.isPolling) {
                        scheduleNextPoll();
                    }
                });
            }, delay);
        };

        scheduleNextPoll();
    }, [jobIds, pollJobStatuses, calculateBackoffDelay, pollingState.consecutiveErrors]);

    const stopPolling = useCallback(() => {
        log('info', 'Stopping job status polling');
        
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }

        setPollingState(prev => ({
            ...prev,
            isPolling: false
        }));
    }, []);

    // Auto-start polling when jobIds change
    useEffect(() => {
        if (jobIds.length > 0 && !pollingState.isPolling) {
            startPolling();
        } else if (jobIds.length === 0 && pollingState.isPolling) {
            stopPolling();
        }

        return () => {
            stopPolling();
        };
    }, [jobIds, pollingState.isPolling, startPolling, stopPolling]);

    return {
        isPolling: pollingState.isPolling,
        errorCount: pollingState.errorCount,
        lastPollTime: pollingState.lastPollTime,
        consecutiveErrors: pollingState.consecutiveErrors,
        startPolling,
        stopPolling
    };
};