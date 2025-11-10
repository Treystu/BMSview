/**
 * useSyncStatus Hook
 * 
 * Subscribes to SyncManager status changes and provides real-time sync state.
 * Returns sync status, cache statistics, and methods for manual sync control.
 * 
 * Usage:
 * ```typescript
 * const { isSyncing, lastSyncTime, syncError, cacheStats } = useSyncStatus();
 * ```
 */

import { getClientServiceMetrics, resetClientServiceMetrics } from '@/services/clientService';
import syncManager from '@/services/syncManager';
import { useCallback, useEffect, useState } from 'react';

export interface CacheStats {
    mode: 'enabled' | 'disabled-via-override' | 'unavailable';
    systemsHits: number;
    historyHits: number;
    memoryHits: number;
    memoryMisses: number;
    networkTotal: number;
}

export interface SyncStatus {
    isSyncing: boolean;
    lastSyncTime: Record<string, number>;
    syncError: string | null;
    cacheStats: CacheStats;
    nextSyncIn: string;
}

/**
 * Helper to build CacheStats from ClientServiceMetrics
 */
function buildCacheStats(metrics: ReturnType<typeof getClientServiceMetrics>): CacheStats {
    return {
        mode: metrics.cache.mode,
        systemsHits: metrics.cache.systemsHits,
        historyHits: metrics.cache.historyHits,
        memoryHits: metrics.memoryCache.hits,
        memoryMisses: metrics.memoryCache.misses,
        networkTotal: metrics.network.total
    };
}

/**
 * Hook to track sync status and cache metrics
 * Updates whenever SyncManager state changes or cache metrics are updated
 */
export function useSyncStatus(): SyncStatus & { forceSyncNow: () => Promise<void>; resetMetrics: () => void } {
    const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => {
        const status = syncManager.getSyncStatus();
        const metrics = getClientServiceMetrics();

        return {
            isSyncing: status.isSyncing,
            lastSyncTime: status.lastSyncTime,
            syncError: status.syncError,
            nextSyncIn: status.nextSyncIn,
            cacheStats: buildCacheStats(metrics)
        };
    });

    // Poll sync status and cache metrics every 2 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            const status = syncManager.getSyncStatus();
            const metrics = getClientServiceMetrics();

            setSyncStatus({
                isSyncing: status.isSyncing,
                lastSyncTime: status.lastSyncTime,
                syncError: status.syncError,
                nextSyncIn: status.nextSyncIn,
                cacheStats: buildCacheStats(metrics)
            });
        }, 2000);

        return () => clearInterval(interval);
    }, []);

    // Force immediate sync and reset timer
    const forceSyncNow = useCallback(async () => {
        try {
            await syncManager.forceSyncNow();
            // Update status after sync completes
            const status = syncManager.getSyncStatus();
            const metrics = getClientServiceMetrics();

            setSyncStatus({
                isSyncing: status.isSyncing,
                lastSyncTime: status.lastSyncTime,
                syncError: status.syncError,
                nextSyncIn: status.nextSyncIn,
                cacheStats: buildCacheStats(metrics)
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown sync error';
            console.error('Force sync failed:', message);
        }
    }, []);

    // Reset cache metrics
    const resetMetrics = useCallback(() => {
        resetClientServiceMetrics();
        const metrics = getClientServiceMetrics();

        setSyncStatus(prev => ({
            ...prev,
            cacheStats: buildCacheStats(metrics)
        }));
    }, []);

    return {
        ...syncStatus,
        forceSyncNow,
        resetMetrics
    };
}

export default useSyncStatus;
