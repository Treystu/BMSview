/**
 * SyncStatusIndicator Component
 * Displays real-time sync status, cache stats, and manual sync button
 */

import React from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus';

export const SyncStatusIndicator: React.FC = () => {
    const { isSyncing, lastSyncTime, syncError, cacheStats, nextSyncIn, forceSyncNow } = useSyncStatus();

    const handleForceSyncClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        try {
            await forceSyncNow();
        } catch (error) {
            console.error('Failed to trigger sync:', error);
        }
    };

    // Determine status indicator color
    let statusColor = 'bg-green-500'; // Default: synced
    let statusText = 'Synced';
    let statusIcon = '✓';

    if (syncError) {
        statusColor = 'bg-red-500';
        statusText = 'Sync Error';
        statusIcon = '⚠';
    } else if (isSyncing) {
        statusColor = 'bg-yellow-500';
        statusText = 'Syncing...';
        statusIcon = '↻';
    }

    // Format last sync time
    const getLastSyncString = (): string => {
        const times = Object.values(lastSyncTime);
        if (times.length === 0) return 'Never synced';

        const mostRecent = Math.max(...times);
        const secondsAgo = Math.floor((Date.now() - mostRecent) / 1000);

        if (secondsAgo < 60) return `${secondsAgo}s ago`;
        if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
        return `${Math.floor(secondsAgo / 3600)}h ago`;
    };

    // Count pending items
    const getPendingCount = (): number => {
        // Would come from cache in real implementation
        return 0;
    };

    return (
        <div className="inline-flex items-center gap-4 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg">
            {/* Status Indicator */}
            <div className="flex items-center gap-2">
                <div className={`${statusColor} text-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1`}>
                    <span className="text-lg">{statusIcon}</span>
                    {statusText}
                </div>
            </div>

            {/* Sync Time */}
            <div className="flex flex-col text-sm">
                <span className="text-gray-500">Last synced</span>
                <span className="font-mono text-gray-700">{getLastSyncString()}</span>
            </div>

            {/* Cache Stats */}
            <div className="flex flex-col text-sm border-l border-gray-300 pl-4">
                <span className="text-gray-500">Cache</span>
                <span className="font-mono text-gray-700">
                    Hits: {cacheStats.systemsHits + cacheStats.historyHits || 0} | Network: {cacheStats.networkTotal || 0}
                </span>
            </div>

            {/* Pending Items */}
            {getPendingCount() > 0 && (
                <div className="flex flex-col text-sm border-l border-gray-300 pl-4">
                    <span className="text-gray-500">Pending sync</span>
                    <span className="font-mono text-amber-600 font-medium">{getPendingCount()} items</span>
                </div>
            )}

            {/* Manual Sync Button */}
            <button
                onClick={handleForceSyncClick}
                disabled={isSyncing}
                className="ml-auto px-3 py-1 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded transition"
                title="Trigger immediate sync"
            >
                {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>

            {/* Next Sync Time */}
            <div className="text-xs text-gray-500">
                Next sync: {nextSyncIn}
            </div>
        </div>
    );
};

export default SyncStatusIndicator;
