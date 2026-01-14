/**
 * SyncManager - Background synchronization service
 * 
 * Handles periodic data synchronization between local IndexedDB cache and remote MongoDB.
 * Implements event-driven architecture with status tracking and error handling.
 */

// DEBUG: Add visibility to track bundle loading issues
console.warn('[BUNDLE-DEBUG] syncManager.ts module executed', {
    timestamp: new Date().toISOString(),
    pathname: typeof window !== 'undefined' ? window.location.pathname : 'N/A',
    stack: new Error().stack
});

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

import type { AnalysisRecord, BmsSystem } from '../types';
import { nowUtc } from '../utils/time';
type CacheCollection = 'systems' | 'history' | 'analytics' | 'weather';

function isCacheCollection(value: string): value is CacheCollection {
    return value === 'systems' || value === 'history' || value === 'analytics' || value === 'weather';
}

type LocalCacheModule = typeof import('./localCache');

type LocalCacheApi = {
    getPendingItems?: () => Promise<{
        systems: Array<{ id: string } & Record<string, unknown>>;
        history: Array<{ id: string } & Record<string, unknown>>;
    }>;
    getMetadata?: (collection: CacheCollection) => Promise<{
        lastModified?: string | null;
        recordCount: number;
        checksum?: string | null;
    } | null>;
    markAsSynced?: (collection: 'systems' | 'history', ids: string[], timestamp: string) => Promise<void>;
};

function resolveLocalCacheApi(module: LocalCacheModule): LocalCacheApi | null {
    const mod = module as unknown as Record<string, unknown>;
    const candidate = (mod.localCache ?? mod.default) as unknown;
    if (!candidate || typeof candidate !== 'object') return null;
    return candidate as LocalCacheApi;
}

type IdentifiableRecord = {
    id: string;
    updatedAt?: string | number | null;
    [key: string]: unknown;
};

function stripSyncStatus(item: unknown): Record<string, unknown> {
    if (!item || typeof item !== 'object') {
        return {};
    }
    const { _syncStatus: _syncStatus, ...rest } = item as Record<string, unknown>;
    void _syncStatus;
    return rest;
}

const log = (level: 'info' | 'debug' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: nowUtc(),
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

    // DRIFT CHECK: Compare server time with local time
    if (serverMeta.serverTime) {
        const serverTs = new Date(serverMeta.serverTime).getTime();
        const localTs = Date.now();
        const diff = Math.abs(serverTs - localTs);

        if (diff > 60000) { // 60 seconds
            log('warn', 'Generic Time Drift Detected', {
                diffMs: diff,
                serverTime: serverMeta.serverTime,
                localTime: nowUtc()
            });
            // We could dispatch an event here or set a global state flag for UI warning
        }
    }

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
    localData: IdentifiableRecord[],
    serverData: IdentifiableRecord[],
    serverDeletedIds: string[] = []
): { merged: IdentifiableRecord[]; conflicts: Array<{ id: string; localVersion: IdentifiableRecord; serverVersion: IdentifiableRecord; resolution: 'server-won' | 'local-won' }> } {
    const merged: IdentifiableRecord[] = [];
    const conflicts: Array<{ id: string; localVersion: IdentifiableRecord; serverVersion: IdentifiableRecord; resolution: 'server-won' | 'local-won' }> = [];

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


export type SyncEvent =
    | { type: 'sync-start' }
    | { type: 'sync-complete'; stats: { pulled: number; pushed: number; duration: number }; collection?: string }
    | { type: 'sync-error'; error: string }
    | { type: 'drift-warning'; diff: number }
    | { type: 'data-changed'; collection: 'systems' | 'history'; count: number };

/**
 * SyncManager class
 * Orchestrates intelligent sync with periodic scheduling and timer reset
 */
export class SyncManager {
    private static instance: SyncManager;
    private isSyncing = false;
    private lastSyncTime: Record<string, number> = {};
    private syncError: string | null = null;
    private syncInterval: NodeJS.Timeout | null = null; // Renamed from periodicSyncTimer
    private readonly syncIntervalMs = 90 * 1000; // 90 seconds
    private readonly maxConcurrentSyncs = 1;
    private listeners: ((event: SyncEvent) => void)[] = [];

    public subscribe(listener: (event: SyncEvent) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private emit(event: SyncEvent) {
        this.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (err) {
                console.error('Error in sync listener:', err);
            }
        });
    }

    public constructor() {
        // Load last sync times from localStorage if available
        try {
            const saved = localStorage.getItem('lastSyncTime');
            if (saved) {
                this.lastSyncTime = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load last sync time', e);
        }
        log('info', 'SyncManager initialized', { syncIntervalMs: this.syncIntervalMs });
    }

    // Static instance getter if needed, but we export a singleton instance below
    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager();
        }
        return SyncManager.instance;
    }

    /**
     * Intelligent sync for a collection
     * Fetches metadata from server and compares with local state
     */
    async intelligentSync(collection: string): Promise<SyncDecision> {
        log('info', 'Starting intelligent sync', { collection });
        this.emit({ type: 'sync-start' });

        try {
            // Load local cache lazily to avoid SSR/indexedDB issues
            const localCacheModule = await this.loadLocalCache();
            const localCacheApi = localCacheModule ? resolveLocalCacheApi(localCacheModule) : null;

            // Get local metadata from IndexedDB if available
            let localMeta: LocalMetadata = {
                collection,
                lastModified: this.lastSyncTime[collection]
                    ? new Date(this.lastSyncTime[collection]).toISOString()
                    : undefined,
                recordCount: 0,
                checksum: undefined
            };

            if (localCacheApi && localCacheApi.getMetadata && isCacheCollection(collection)) {
                try {
                    const meta = await localCacheApi.getMetadata(collection);
                    if (meta) {
                        localMeta = {
                            collection,
                            lastModified: meta.lastModified || localMeta.lastModified,
                            recordCount: meta.recordCount,
                            checksum: meta.checksum || undefined
                        };
                    }
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
    async startPeriodicSync(): Promise<void> {
        if (this.syncInterval) {
            log('warn', 'Periodic sync already started, skipping');
            return;
        }

        log('info', 'Starting periodic sync', { intervalMs: this.syncIntervalMs });

        // Initial sync promise
        const initialSync = this.performPeriodicSync().catch(err =>
            log('error', 'Initial sync failed', { error: (err as Error).message })
        );

        // Schedule periodic sync
        this.syncInterval = setInterval(() => {
            this.performPeriodicSync().catch(err =>
                log('error', 'Periodic sync failed', { error: (err as Error).message })
            );
        }, this.syncIntervalMs);

        log('debug', 'Periodic sync scheduled', { intervalMs: this.syncIntervalMs });

        return initialSync;
    }

    /**
     * Reset periodic sync timer (call after user actions)
     */
    async resetPeriodicTimer(): Promise<void> {
        log('debug', 'Resetting periodic sync timer');
        // Clear existing interval and restart to reset the timer
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null; // Ensure it's null before calling startPeriodicSync
        }
        await this.startPeriodicSync();
    }

    /**
     * Perform periodic sync (finds pending items and syncs them)
     */
    private async performPeriodicSync(): Promise<void> {
        if (this.isSyncing) {
            log('warn', 'Sync already in progress, skipping periodic sync');
            return;
        }

        // --- Multi-Tab Sync Lock ---
        const LOCK_KEY = 'bmsview_sync_lock';
        const LOCK_DURATION = 10000; // 10 seconds
        const now = Date.now();
        const lockValue = localStorage.getItem(LOCK_KEY);

        if (lockValue) {
            const { timestamp, tabId } = JSON.parse(lockValue);
            if (now - timestamp < LOCK_DURATION) {
                // Lock is active and not expired
                log('debug', 'Sync locked by another tab', { tabId });
                return;
            }
        }

        // Acquire lock
        const myTabId = Math.random().toString(36).substring(7);
        localStorage.setItem(LOCK_KEY, JSON.stringify({ timestamp: now, tabId: myTabId }));

        this.isSyncing = true;
        this.emit({ type: 'sync-start' });
        const startTime = Date.now();

        try {
            log('info', 'Performing periodic sync');

            const localCacheModule = await this.loadLocalCache();

            // If local cache unavailable (SSR or disabled), skip gracefully
            if (!localCacheModule) {
                log('warn', 'Local cache unavailable, skipping periodic sync');
                return;
            }

            const localCacheApi = resolveLocalCacheApi(localCacheModule);
            if (!localCacheApi || !localCacheApi.getPendingItems) {
                log('warn', 'Local cache API unavailable, skipping periodic sync');
                return;
            }

            // 1. Find all pending items in localCache
            const pending = await localCacheApi.getPendingItems();
            const pendingSystems = pending.systems;
            const pendingHistory = pending.history;

            // 2. Batch push via sync-push endpoint (systems)
            if (pendingSystems.length > 0) {
                await this.pushBatch(
                    'systems',
                    pendingSystems.map(stripSyncStatus)
                );
                // Mark all pushed items as synced in batch
                if (localCacheApi.markAsSynced) {
                    await localCacheApi.markAsSynced('systems', pendingSystems.map(item => item.id), nowUtc());
                }
            }

            // 2b. Batch push via sync-push endpoint (history)
            if (pendingHistory.length > 0) {
                await this.pushBatch(
                    'history',
                    pendingHistory.map(stripSyncStatus)
                );
                // Mark all pushed items as synced in batch
                if (localCacheApi.markAsSynced) {
                    await localCacheApi.markAsSynced('history', pendingHistory.map(item => item.id), nowUtc());
                }
            }

            // 3. Pull incremental updates for both collections
            await this.pullIncremental('systems', localCacheModule);
            await this.pullIncremental('history', localCacheModule);

            this.lastSyncTime['all'] = Date.now();
            this.syncError = null;

            const duration = Date.now() - startTime;
            log('info', 'Periodic sync complete', { duration });
            this.emit({
                type: 'sync-complete',
                stats: { pulled: 0, pushed: 0, duration } // Simplified stats for now
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.syncError = err.message;
            log('error', 'Periodic sync failed', { error: err.message, durationMs: Date.now() - startTime });
            this.emit({ type: 'sync-error', error: (err as Error).message });
        } finally {
            this.isSyncing = false;
            // Immediate unlock or let it expire? Let's clear it to be responsive.
            localStorage.removeItem(LOCK_KEY);
        }
    }

    /**
     * Force sync immediately
     */
    async forceSyncNow(): Promise<void> {
        log('info', 'Forcing immediate sync');
        await this.resetPeriodicTimer(); // This will trigger an immediate sync and reschedule
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            isSyncing: this.isSyncing,
            lastSyncTime: this.lastSyncTime,
            syncError: this.syncError,
            nextSyncIn: this.syncInterval ? 'pending' : 'stopped'
        };
    }

    /**
     * Stop periodic sync
     */
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        log('info', 'Periodic sync stopped');
    }

    /**
     * Cleanup on unmount
     */
    destroy(): void {
        this.stopPeriodicSync();
        this.isSyncing = false;
        log('info', 'SyncManager destroyed');
    }

    // ===========================
    // Internal helpers
    // ===========================
    private async loadLocalCache(): Promise<LocalCacheModule | null> {
        try {
            // Dynamic import to respect ESM and alias
            return await import('./localCache');
        } catch (e) {
            log('warn', 'Failed to load local cache module', { error: (e as Error).message });
            return null;
        }
    }

    private async pushBatch(collection: 'systems' | 'history', items: Array<Record<string, unknown>>): Promise<void> {
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

    private async pullIncremental(collection: 'systems' | 'history', localCacheModule: LocalCacheModule): Promise<void> {
        const since = this.lastSyncTime[collection]
            ? new Date(this.lastSyncTime[collection]).toISOString()
            : new Date(0).toISOString();
        const url = `/.netlify/functions/sync-incremental?collection=${encodeURIComponent(collection)}&since=${encodeURIComponent(since)}`;
        const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`sync-incremental ${collection} failed: ${resp.status} ${text}`);
        }
        const data: unknown = await resp.json();
        const obj = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
        const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
        const deletedRaw = Array.isArray(obj.deletedIds) ? obj.deletedIds : [];
        const deletedIds: string[] = deletedRaw.filter((v): v is string => typeof v === 'string');

        const updates: BmsSystem[] | AnalysisRecord[] = collection === 'systems'
            ? (itemsRaw as BmsSystem[])
            : (itemsRaw as AnalysisRecord[]);

        // Apply updates to local cache
        if (updates.length) {
            try {
                if (collection === 'systems') {
                    if (localCacheModule.systemsCache.bulkPut) {
                        await localCacheModule.systemsCache.bulkPut(updates as BmsSystem[]);
                    } else {
                        for (const u of updates as BmsSystem[]) await localCacheModule.systemsCache.put(u);
                    }
                } else {
                    if (localCacheModule.historyCache.bulkPut) {
                        await localCacheModule.historyCache.bulkPut(updates as AnalysisRecord[]);
                    } else {
                        for (const u of updates as AnalysisRecord[]) await localCacheModule.historyCache.put(u);
                    }
                }
            } catch (e) {
                log('warn', 'Failed to write updates to local cache', { collection, error: (e as Error).message });
            }
        }

        // Apply deletions to local cache if API exists
        if (deletedIds.length) {
            try {
                if (collection === 'systems') {
                    for (const id of deletedIds) await localCacheModule.systemsCache.delete(id);
                } else {
                    for (const id of deletedIds) await localCacheModule.historyCache.delete(id);
                }
            } catch (e) {
                log('warn', 'Failed to delete records from local cache', { collection, error: (e as Error).message });
            }
        }

        // Update last sync time
        this.lastSyncTime[collection] = Date.now();
        log('info', 'Pulled incremental updates', { collection, updates: updates.length, deleted: deletedIds.length });
        if (updates.length > 0 || deletedIds.length > 0) {
            this.emit({
                type: 'data-changed',
                collection: collection as 'systems' | 'history',
                count: updates.length + deletedIds.length
            });
        }
    }
}

// Lazy singleton instance - only created when accessed
let _syncManager: SyncManager | null = null;

export function getSyncManager(): SyncManager {
    if (!_syncManager) {
        _syncManager = new SyncManager();
    }
    return _syncManager;
}

// Export default as the lazy getter for backward compatibility
export default getSyncManager();
