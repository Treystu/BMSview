/**
 * SyncManager - Intelligent Sync Decision Engine
 * 
 * Compares local cache state with server metadata to determine optimal sync strategy:
 * - If local empty: pull from server
 * - If local newer: push to server
 * - If server newer: pull from server
 * - If equal timestamps: compare record counts
 */

export interface SyncMetadata {
    collection: string;
    lastModified: string; // ISO 8601 UTC
    recordCount: number;
    checksum?: string;
    serverTime: string;
}

export interface SyncDecision {
    action: 'pull' | 'push' | 'reconcile' | 'skip';
    reason: string;
    localTimestamp?: string;
    serverTimestamp?: string;
    localCount: number;
    serverCount: number;
}

export interface LocalMetadata {
    collection: string;
    lastModified?: string;
    recordCount: number;
    checksum?: string;
}

const log = (level: 'info' | 'debug' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        service: 'SyncManager',
        message,
        context
    }));
};

/**
 * Intelligent sync decision logic
 * Returns the action to take based on metadata comparison
 */
export function intelligentSync(localMeta: LocalMetadata, serverMeta: SyncMetadata): SyncDecision {
    const localCount = localMeta.recordCount || 0;
    const serverCount = serverMeta.recordCount || 0;
    const localTime = localMeta.lastModified;
    const serverTime = serverMeta.lastModified;

    // Empty local cache: pull all from server
    if (localCount === 0 && serverCount > 0) {
        return {
            action: 'pull',
            reason: 'Local cache empty, pulling all records from server',
            serverTimestamp: serverTime,
            localCount,
            serverCount
        };
    }

    // Empty server and empty local: skip
    if (localCount === 0 && serverCount === 0) {
        return {
            action: 'skip',
            reason: 'Both local and server are empty',
            localCount,
            serverCount
        };
    }

    // Only local has data: push to server
    if (localCount > 0 && serverCount === 0) {
        return {
            action: 'push',
            reason: 'Local has data but server is empty, pushing to server',
            localTimestamp: localTime,
            localCount,
            serverCount
        };
    }

    // Both have data: compare timestamps
    if (localTime && serverTime) {
        const localDate = new Date(localTime);
        const serverDate = new Date(serverTime);

        // Local is newer: push
        if (localDate > serverDate) {
            return {
                action: 'push',
                reason: 'Local data is newer than server',
                localTimestamp: localTime,
                serverTimestamp: serverTime,
                localCount,
                serverCount
            };
        }

        // Server is newer: pull
        if (serverDate > localDate) {
            return {
                action: 'pull',
                reason: 'Server data is newer than local',
                localTimestamp: localTime,
                serverTimestamp: serverTime,
                localCount,
                serverCount
            };
        }

        // Timestamps equal: compare record counts
        if (serverDate.getTime() === localDate.getTime()) {
            if (localCount > serverCount) {
                return {
                    action: 'push',
                    reason: 'Timestamps equal but local has more records',
                    localTimestamp: localTime,
                    serverTimestamp: serverTime,
                    localCount,
                    serverCount
                };
            } else if (serverCount > localCount) {
                return {
                    action: 'pull',
                    reason: 'Timestamps equal but server has more records',
                    localTimestamp: localTime,
                    serverTimestamp: serverTime,
                    localCount,
                    serverCount
                };
            } else {
                return {
                    action: 'skip',
                    reason: 'Local and server are identical (same timestamp, same count)',
                    localTimestamp: localTime,
                    serverTimestamp: serverTime,
                    localCount,
                    serverCount
                };
            }
        }
    }

    // No metadata: reconcile
    return {
        action: 'reconcile',
        reason: 'Unable to determine sync direction from metadata, performing full reconciliation',
        localCount,
        serverCount
    };
}

/**
 * Data reconciliation: merge server and local changes
 * Returns merged dataset with conflict resolution
 */
export function reconcileData(
    localData: any[],
    serverData: any[],
    serverDeletedIds: string[] = []
): { merged: any[]; conflicts: any[] } {
    const merged: any[] = [];
    const conflicts: any[] = [];

    // Create maps by ID for O(1) lookup
    const localMap = new Map(localData.map(item => [item.id, item]));
    const serverMap = new Map(serverData.map(item => [item.id, item]));
    const deletedSet = new Set(serverDeletedIds);

    // Process server data first (server version wins on timestamp comparison)
    for (const [id, serverItem] of serverMap) {
        // Skip if marked as deleted on server
        if (deletedSet.has(id)) {
            log('debug', 'Skipping item marked as deleted on server', { id });
            continue;
        }

        const localItem = localMap.get(id);

        if (!localItem) {
            // Only on server: add it
            merged.push(serverItem);
        } else {
            // On both: compare timestamps
            const serverTime = new Date(serverItem.updatedAt || 0).getTime();
            const localTime = new Date(localItem.updatedAt || 0).getTime();

            if (serverTime >= localTime) {
                // Server is newer or equal: use server version
                merged.push(serverItem);
            } else {
                // Local is newer: use local version
                merged.push(localItem);
            }

            // Record as conflict if timestamps differ significantly
            if (Math.abs(serverTime - localTime) > 1000) { // >1s difference
                conflicts.push({
                    id,
                    localVersion: localItem,
                    serverVersion: serverItem,
                    resolution: serverTime >= localTime ? 'server-won' : 'local-won'
                });
            }

            localMap.delete(id); // Mark as processed
        }
    }

    // Process remaining local items (only on client)
    for (const [id, localItem] of localMap) {
        // Skip if deleted on server
        if (!deletedSet.has(id)) {
            merged.push(localItem);
        }
    }

    return { merged, conflicts };
}

/**
 * SyncManager class
 * Orchestrates intelligent sync with periodic scheduling and timer reset
 */
export class SyncManager {
    private isSyncing = false;
    private lastSyncTime: Record<string, number> = {};
    private syncError: string | null = null;
    private periodicSyncTimer: NodeJS.Timeout | null = null;
    private readonly syncIntervalMs = 90 * 1000; // 90 seconds
    private readonly maxConcurrentSyncs = 1;

    constructor() {
        log('info', 'SyncManager initialized', { syncIntervalMs: this.syncIntervalMs });
    }

    /**
     * Intelligent sync for a collection
     * Fetches metadata from server and compares with local state
     */
    async intelligentSync(collection: string): Promise<SyncDecision> {
        log('info', 'Starting intelligent sync', { collection });

        try {
            // Load local cache lazily to avoid SSR/indexedDB issues
            const localCache = await this.loadLocalCache();

            // Get local metadata from IndexedDB if available
            let localMeta: LocalMetadata = {
                collection,
                lastModified: this.lastSyncTime[collection]
                    ? new Date(this.lastSyncTime[collection]).toISOString()
                    : undefined,
                recordCount: 0,
                checksum: undefined
            };

            if (localCache) {
                try {
                    const meta = await localCache.getMetadata(collection as any);
                    localMeta = {
                        collection,
                        lastModified: meta.lastModified || localMeta.lastModified,
                        recordCount: meta.recordCount,
                        checksum: meta.checksum || undefined
                    };
                } catch (e) {
                    log('warn', 'Failed to read local metadata, falling back to empty', { collection, error: (e as Error).message });
                }
            }

            // Fetch server metadata
            const resp = await fetch(`/.netlify/functions/sync-metadata?collection=${encodeURIComponent(collection)}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!resp.ok) {
                throw new Error(`sync-metadata failed with ${resp.status}`);
            }
            const serverMeta = (await resp.json()) as SyncMetadata;

            const decision = intelligentSync(localMeta, serverMeta);
            log('info', 'Intelligent sync decision made', { collection, decision: decision.action });

            return decision;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log('error', 'Intelligent sync failed', { collection, error: err.message });
            throw error;
        }
    }

    /**
     * Reconcile local and server data
     */
    async reconcileData(collection: string, localData: any[], serverData: any[], deletedIds: string[] = []): Promise<{ merged: any[]; conflicts: any[] }> {
        log('info', 'Starting data reconciliation', { collection, localCount: localData.length, serverCount: serverData.length, deletedCount: deletedIds.length });

        const result = reconcileData(localData, serverData, deletedIds);
        log('info', 'Data reconciliation complete', { collection, mergedCount: result.merged.length, conflictCount: result.conflicts.length });

        return result;
    }

    /**
     * Start periodic sync with 90-second interval
     */
    startPeriodicSync(): void {
        if (this.periodicSyncTimer) {
            log('warn', 'Periodic sync already started, skipping');
            return;
        }

        log('info', 'Starting periodic sync', { intervalMs: this.syncIntervalMs });
        this.scheduleNextSync();
    }

    /**
     * Schedule the next sync
     */
    private scheduleNextSync(): void {
        if (this.periodicSyncTimer) {
            clearTimeout(this.periodicSyncTimer);
        }

        this.periodicSyncTimer = setTimeout(() => {
            this.performPeriodicSync();
            // Reschedule even if sync fails
            this.scheduleNextSync();
        }, this.syncIntervalMs);

        log('debug', 'Next periodic sync scheduled', { inMs: this.syncIntervalMs });
    }

    /**
     * Reset periodic sync timer (call after user actions)
     */
    resetPeriodicTimer(): void {
        log('debug', 'Resetting periodic sync timer');
        this.scheduleNextSync();
    }

    /**
     * Perform periodic sync (finds pending items and syncs them)
     */
    private async performPeriodicSync(): Promise<void> {
        if (this.isSyncing) {
            log('warn', 'Sync already in progress, skipping periodic sync');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();

        try {
            log('info', 'Performing periodic sync');

            const localCache = await this.loadLocalCache();

            // If local cache unavailable (SSR or disabled), skip gracefully
            if (!localCache) {
                log('warn', 'Local cache unavailable, skipping periodic sync');
                return;
            }

            // 1. Find all pending items in localCache
            const pending = await localCache.getPendingItems();
            const pendingSystems = pending.systems;
            const pendingHistory = pending.history;

            // 2. Batch push via sync-push endpoint (systems)
            if (pendingSystems.length > 0) {
                await this.pushBatch('systems', pendingSystems.map(({ _syncStatus, ...rest }) => rest));
                for (const item of pendingSystems) {
                    await localCache.systems.markAsSynced(item.id, new Date().toISOString());
                }
            }

            // 2b. Batch push via sync-push endpoint (history)
            if (pendingHistory.length > 0) {
                await this.pushBatch('history', pendingHistory.map(({ _syncStatus, ...rest }) => rest));
                for (const item of pendingHistory) {
                    await localCache.history.markAsSynced(item.id, new Date().toISOString());
                }
            }

            // 3. Pull incremental updates for both collections
            await this.pullIncremental('systems', localCache);
            await this.pullIncremental('history', localCache);

            this.lastSyncTime['all'] = Date.now();
            this.syncError = null;

            log('info', 'Periodic sync completed', { durationMs: Date.now() - startTime });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.syncError = err.message;
            log('error', 'Periodic sync failed', { error: err.message, durationMs: Date.now() - startTime });
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Force sync immediately
     */
    async forceSyncNow(): Promise<void> {
        log('info', 'Forcing immediate sync');
        this.resetPeriodicTimer();
        await this.performPeriodicSync();
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            isSyncing: this.isSyncing,
            lastSyncTime: this.lastSyncTime,
            syncError: this.syncError,
            nextSyncIn: this.periodicSyncTimer ? 'pending' : 'stopped'
        };
    }

    /**
     * Stop periodic sync
     */
    stopPeriodicSync(): void {
        if (this.periodicSyncTimer) {
            clearTimeout(this.periodicSyncTimer);
            this.periodicSyncTimer = null;
        }
        log('info', 'Periodic sync stopped');
    }

    /**
     * Cleanup on unmount
     */
    destroy(): void {
        this.stopPeriodicSync();
        log('info', 'SyncManager destroyed');
    }

    // ===========================
    // Internal helpers
    // ===========================
    private async loadLocalCache(): Promise<null | {
        getMetadata: (collection: 'systems' | 'history' | 'analytics' | 'weather') => Promise<{ lastModified: string | null; recordCount: number; checksum: string | null }>;
        getPendingItems: () => Promise<{ systems: any[]; history: any[]; analytics: any[] }>;
        systems: { markAsSynced: (id: string, serverTimestamp?: string) => Promise<void> };
        history: { markAsSynced: (id: string, serverTimestamp?: string) => Promise<void> };
        // Minimal writes for pull
        systemsCache?: { put: (item: any) => Promise<void>; bulkPut?: (items: any[]) => Promise<void> };
        historyCache?: { put: (item: any) => Promise<void>; bulkPut?: (items: any[]) => Promise<void> };
    }> {
        try {
            // Dynamic import to respect ESM and alias
            const mod = await import('@/services/localCache');
            return mod as any;
        } catch (e) {
            log('warn', 'Failed to load local cache module', { error: (e as Error).message });
            return null;
        }
    }

    private async pushBatch(collection: 'systems' | 'history', items: any[]): Promise<void> {
        if (!items.length) return;
        const resp = await fetch('/.netlify/functions/sync-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection, items })
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`sync-push ${collection} failed: ${resp.status} ${text}`);
        }
        log('info', 'Pushed batch to server', { collection, count: items.length });
    }

    private async pullIncremental(collection: 'systems' | 'history', localCache: any): Promise<void> {
        const since = this.lastSyncTime[collection]
            ? new Date(this.lastSyncTime[collection]).toISOString()
            : new Date(0).toISOString();
        const url = `/.netlify/functions/sync-incremental?collection=${encodeURIComponent(collection)}&since=${encodeURIComponent(since)}`;
        const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`sync-incremental ${collection} failed: ${resp.status} ${text}`);
        }
        const data = await resp.json();
        const updates: any[] = data.items || [];
        const deletedIds: string[] = data.deletedIds || [];

        // Apply updates to local cache
        if (updates.length) {
            try {
                if (localCache[`${collection}Cache`]?.bulkPut) {
                    await localCache[`${collection}Cache`].bulkPut(updates);
                } else if (localCache[`${collection}Cache`]?.put) {
                    for (const u of updates) await localCache[`${collection}Cache`].put(u);
                }
            } catch (e) {
                log('warn', 'Failed to write updates to local cache', { collection, error: (e as Error).message });
            }
        }

        // Apply deletions to local cache if API exists
        if (deletedIds.length && localCache[`${collection}Cache`]?.delete) {
            try {
                for (const id of deletedIds) await localCache[`${collection}Cache`].delete(id);
            } catch (e) {
                log('warn', 'Failed to delete records from local cache', { collection, error: (e as Error).message });
            }
        }

        // Update last sync time
        this.lastSyncTime[collection] = Date.now();
        log('info', 'Pulled incremental updates', { collection, updates: updates.length, deleted: deletedIds.length });
    }
}

// Export singleton instance
export const syncManager = new SyncManager();

export default syncManager;
