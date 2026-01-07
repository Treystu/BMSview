import { useState, useEffect, useCallback } from 'react';
import { getSystemAnalytics, type SystemAnalytics } from '../services/clientService';
import type { AnalysisRecord } from '../types';

interface UseAnalyticsDataProps {
    selectedSystemId: string;
    history: AnalysisRecord[];
    visibleTimeRange?: { start: number; end: number } | null;
}

interface UseAnalyticsDataReturn {
    analyticsData: SystemAnalytics | null;
    isLoading: boolean;
    error: string | null;
    filteredHistory: AnalysisRecord[];
    visibleAlerts: Array<{ timestamp: string; type: string; message: string }>;
    refreshAnalytics: () => Promise<void>;
}

/**
 * Hook for managing analytics data including system analytics, filtered history, and visible alerts.
 * Implements deduplication and context-aware filtering based on visible time range.
 */
export const useAnalyticsData = ({
    selectedSystemId,
    history,
    visibleTimeRange
}: UseAnalyticsDataProps): UseAnalyticsDataReturn => {
    const [analyticsData, setAnalyticsData] = useState<SystemAnalytics | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch system analytics when system changes
    const fetchAnalytics = useCallback(async () => {
        if (!selectedSystemId) {
            setAnalyticsData(null);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const data = await getSystemAnalytics(selectedSystemId);
            setAnalyticsData(data);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch analytics';
            setError(errorMessage);
            setAnalyticsData(null);
        } finally {
            setIsLoading(false);
        }
    }, [selectedSystemId]);

    // Auto-fetch on system change
    useEffect(() => {
        fetchAnalytics();
    }, [fetchAnalytics]);

    // Filter history to selected system
    const filteredHistory = history.filter(record => record.systemId === selectedSystemId);

    // Extract and deduplicate alerts from analytics data and history
    const visibleAlerts = (() => {
        if (!analyticsData && filteredHistory.length === 0) return [];

        const alertsSet = new Set<string>();
        const alerts: Array<{ timestamp: string; type: string; message: string }> = [];

        // Add alerts from history records
        filteredHistory.forEach(record => {
            const recordTime = new Date(record.timestamp).getTime();
            
            // Filter by visible time range if provided
            if (visibleTimeRange) {
                if (recordTime < visibleTimeRange.start || recordTime > visibleTimeRange.end) {
                    return; // Skip records outside visible range
                }
            }

            // Extract alerts from analysis
            if (record.analysis?.alerts && Array.isArray(record.analysis.alerts)) {
                record.analysis.alerts.forEach(alert => {
                    // Create unique key for deduplication: timestamp + alert
                    const uniqueKey = `${record.timestamp}-${alert}`;
                    
                    if (!alertsSet.has(uniqueKey)) {
                        alertsSet.add(uniqueKey);
                        
                        // Determine alert type based on content
                        let type: 'critical' | 'warning' | 'info' = 'info';
                        const upperAlert = alert.toUpperCase();
                        if (upperAlert.includes('CRITICAL')) type = 'critical';
                        else if (upperAlert.includes('WARNING')) type = 'warning';
                        
                        alerts.push({
                            timestamp: record.timestamp,
                            type,
                            message: alert
                        });
                    }
                });
            }
        });

        // Sort by timestamp (newest first)
        return alerts.sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    })();

    return {
        analyticsData,
        isLoading,
        error,
        filteredHistory,
        visibleAlerts,
        refreshAnalytics: fetchAnalytics
    };
};
