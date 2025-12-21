/**
 * Local-First Cache Service using IndexedDB (Dexie.js)
 * 
 * This service provides a local-first caching layer for BMS data using IndexedDB.
 * All timestamps are ISO 8601 UTC format. Server timestamps always win.
 * 
 * Key Features:
 * - Offline-first data access
 * - Sync status tracking (_syncStatus: 'pending' | 'synced' | 'conflict')
 * - UTC timestamp management (updatedAt)
 * - Metadata checksums for integrity validation
 * - Pending items tracking for background sync
 */

import Dexie, { Table } from 'dexie';
import { AnalysisRecord, BmsSystem, WeatherData } from '../../types';
import { assertUtc, nowUtc } from '../utils/time';

// Sync status enum
export type SyncStatus = 'pending' | 'synced' | 'conflict';

// Base interface for all cached records
export interface CachedRecord {
    id: string;
    updatedAt: string; // ISO 8601 UTC timestamp
    _syncStatus: SyncStatus;
}

// Extended interfaces for cached data
export interface CachedSystem extends BmsSystem, CachedRecord { }

export interface CachedAnalysisRecord extends AnalysisRecord, CachedRecord { }

export interface CachedWeatherData extends WeatherData, CachedRecord {
    id: string;
    location: string; // lat,lng key
}

export interface CachedAnalytics extends CachedRecord {
    systemId: string;
    metric: string;
    value: number;
    timestamp: string;
}

export interface CacheMetadata extends CachedRecord {
    collection: string;
    lastModified: string; // ISO 8601 UTC
    recordCount: number;
    checksum: string;
    lastSyncTime?: string;
}

// Validation regex for UTC timestamps is now imported from ../utils/time

/**
 * BMSview Local Cache Database (Dexie)
 */
class BMSviewCache extends Dexie {
    systems!: Table<CachedSystem, string>;
    history!: Table<CachedAnalysisRecord, string>;
    analytics!: Table<CachedAnalytics, string>;
    weather!: Table<CachedWeatherData, string>;
    metadata!: Table<CacheMetadata, string>;

    constructor() {
        super('BMSviewCache');

        // Schema version 1: Initial setup with sync fields
        this.version(1).stores({
            systems: 'id, updatedAt, _syncStatus, name, chemistry',
            history: 'id, updatedAt, _syncStatus, timestamp, systemId, dlNumber',
            analytics: 'id, updatedAt, _syncStatus, systemId, metric, timestamp',
            weather: 'id, updatedAt, _syncStatus, location',
            metadata: 'id, collection, lastModified'
        });

        // Schema version 2: Compound indexes for performance
        this.version(2).stores({
            systems: 'id, updatedAt, _syncStatus, name, chemistry, [updatedAt+_syncStatus]',
            history: 'id, updatedAt, _syncStatus, timestamp, systemId, dlNumber, [systemId+timestamp], [updatedAt+_syncStatus]',
            analytics: 'id, updatedAt, _syncStatus, systemId, metric, timestamp, [updatedAt+_syncStatus]',
            weather: 'id, updatedAt, _syncStatus, location, [updatedAt+_syncStatus]',
            metadata: 'id, collection, lastModified'
        }).upgrade(() => {
            // No data migration needed, just index creation
        });
    }
}

// Singleton instance
const db = new BMSviewCache();

/**
 * Structured logging for cache operations
 */
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: any) {
    const logEntry = {
        level,
        timestamp: nowUtc(),
        service: 'localCache',
        message,
        context
    };
    console.log(JSON.stringify(logEntry));
}

/**
 * Calculate SHA-256 checksum for data integrity
 */
async function calculateChecksum(data: any[]): Promise<string> {
    const combined = data
        .map(item => `${item.id}:${item.updatedAt}`)
        .sort()
        .join('|');

    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(combined);

    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    log('warn', 'Web Crypto API not available, falling back to simple checksum.');
    return simpleChecksum(combined);
}

function simpleChecksum(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
}

/**
 * SYSTEMS COLLECTION - BMS System Registration
 */
export const systemsCache = {
    /**
     * Get all systems from cache
     */
    async getAll(): Promise<CachedSystem[]> {
        try {
            const systems = await db.systems.toArray();
            log('debug', `Retrieved ${systems.length} systems from cache`);
            return systems;
        } catch (error) {
            log('error', 'Failed to get systems from cache', { error });
            throw error;
        }
    },

    /**
     * Get system by ID
     */
    async getById(id: string): Promise<CachedSystem | undefined> {
        try {
            return await db.systems.get(id);
        } catch (error) {
            log('error', `Failed to get system ${id} from cache`, { error });
            throw error;
        }
    },

    /**
     * Add or update system in cache
     */
    async put(system: BmsSystem, syncStatus: SyncStatus = 'pending'): Promise<void> {
        try {
            const updatedAt = nowUtc();

            assertUtc(updatedAt, 'updatedAt');

            const cachedSystem: CachedSystem = {
                ...system,
                updatedAt,
                _syncStatus: syncStatus
            };

            await db.transaction('rw', db.systems, async (_tx) => {
                await db.systems.put(cachedSystem);
            });
            log('info', `Cached system: ${system.id}`, { syncStatus });
        } catch (error) {
            log('error', `Failed to cache system ${system.id}`, { error });
            throw error;
        }
    },

    /**
     * Bulk put systems
     */
    async bulkPut(systems: BmsSystem[], syncStatus: SyncStatus = 'synced'): Promise<void> {
        try {
            const updatedAt = nowUtc();
            const cachedSystems = systems.map(system => ({
                ...system,
                updatedAt,
                _syncStatus: syncStatus
            }));

            await db.systems.bulkPut(cachedSystems);
            log('info', `Bulk cached ${systems.length} systems`, { syncStatus });
        } catch (error) {
            log('error', 'Failed to bulk cache systems', { error });
            throw error;
        }
    },

    /**
     * Delete system from cache
     */
    async delete(id: string): Promise<void> {
        try {
            await db.systems.delete(id);
            log('info', `Deleted system from cache: ${id}`);
        } catch (error) {
            log('error', `Failed to delete system ${id} from cache`, { error });
            throw error;
        }
    },

    /**
     * Mark system as synced
     */
    async markAsSynced(id: string, serverTimestamp?: string): Promise<void> {
        try {
            const timestamp = serverTimestamp ?? nowUtc();
            await db.systems.update(id, { _syncStatus: 'synced', updatedAt: timestamp });
            log('debug', `Marked system as synced: ${id}`);
        } catch (error) {
            log('error', `Failed to mark system ${id} as synced`, { error });
            throw error;
        }
    },

    /**
     * Get pending systems (not yet synced to server)
     */
    async getPending(): Promise<CachedSystem[]> {
        try {
            const pending = await db.systems.where('_syncStatus').equals('pending').toArray();
            log('debug', `Found ${pending.length} pending systems`);
            return pending;
        } catch (error) {
            log('error', 'Failed to get pending systems', { error });
            throw error;
        }
    }
};

/**
 * HISTORY COLLECTION - Analysis Records
 */
export const historyCache = {
    /**
     * Get all analysis records from cache
     */
    async getAll(): Promise<CachedAnalysisRecord[]> {
        try {
            const records = await db.history.orderBy('timestamp').reverse().toArray();
            log('debug', `Retrieved ${records.length} history records from cache`);
            return records;
        } catch (error) {
            log('error', 'Failed to get history from cache', { error });
            throw error;
        }
    },

    /**
     * Get history by system ID
     */
    async getBySystemId(systemId: string): Promise<CachedAnalysisRecord[]> {
        try {
            return await db.history.where('systemId').equals(systemId).toArray();
        } catch (error) {
            log('error', `Failed to get history for system ${systemId}`, { error });
            throw error;
        }
    },

    /**
     * Add or update analysis record
     */
    async put(record: AnalysisRecord, syncStatus: SyncStatus = 'pending'): Promise<void> {
        try {
            const updatedAt = nowUtc();

            assertUtc(updatedAt, 'updatedAt');

            const cachedRecord: CachedAnalysisRecord = {
                ...record,
                updatedAt,
                _syncStatus: syncStatus
            };

            await db.history.put(cachedRecord);
            log('info', `Cached analysis record: ${record.id}`, { syncStatus });
        } catch (error) {
            log('error', `Failed to cache analysis record ${record.id}`, { error });
            throw error;
        }
    },

    /**
     * Bulk put analysis records
     */
    async bulkPut(records: AnalysisRecord[], syncStatus: SyncStatus = 'synced'): Promise<void> {
        try {
            const updatedAt = nowUtc();
            const cachedRecords = records.map(record => ({
                ...record,
                updatedAt,
                _syncStatus: syncStatus
            }));

            await db.history.bulkPut(cachedRecords);
            log('info', `Bulk cached ${records.length} history records`, { syncStatus });
        } catch (error) {
            log('error', 'Failed to bulk cache history', { error });
            throw error;
        }
    },

    /**
     * Delete analysis record
     */
    async delete(id: string): Promise<void> {
        try {
            await db.history.delete(id);
            log('info', `Deleted analysis record from cache: ${id}`);
        } catch (error) {
            log('error', `Failed to delete analysis record ${id}`, { error });
            throw error;
        }
    },

    /**
     * Mark record as synced
     */
    async markAsSynced(id: string, serverTimestamp?: string): Promise<void> {
        try {
            const timestamp = serverTimestamp ?? nowUtc();
            await (db.history as any).update(id, { _syncStatus: 'synced', updatedAt: timestamp });
            log('debug', `Marked history record as synced: ${id}`);
        } catch (error) {
            log('error', `Failed to mark history ${id} as synced`, { error });
            throw error;
        }
    },

    /**
     * Get pending analysis records
     */
    async getPending(): Promise<CachedAnalysisRecord[]> {
        try {
            const pending = await db.history.where('_syncStatus').equals('pending').toArray();
            log('debug', `Found ${pending.length} pending history records`);
            return pending;
        } catch (error) {
            log('error', 'Failed to get pending history', { error });
            throw error;
        }
    }
};

/**
 * ANALYTICS COLLECTION - System Analytics Data
 */
export const analyticsCache = {
    async getAll(): Promise<CachedAnalytics[]> {
        try {
            return await db.analytics.toArray();
        } catch (error) {
            log('error', 'Failed to get analytics from cache', { error });
            throw error;
        }
    },

    async put(analytics: Omit<CachedAnalytics, 'updatedAt' | '_syncStatus'>, syncStatus: SyncStatus = 'pending'): Promise<void> {
        try {
            const updatedAt = nowUtc();
            const cached: CachedAnalytics = {
                ...analytics,
                updatedAt,
                _syncStatus: syncStatus
            };
            await db.analytics.put(cached);
            log('debug', `Cached analytics: ${analytics.id}`);
        } catch (error) {
            log('error', 'Failed to cache analytics', { error });
            throw error;
        }
    },

    async getPending(): Promise<CachedAnalytics[]> {
        try {
            return await db.analytics.where('_syncStatus').equals('pending').toArray();
        } catch (error) {
            log('error', 'Failed to get pending analytics', { error });
            throw error;
        }
    }
};

/**
 * WEATHER COLLECTION - Cached Weather Data
 */
export const weatherCache = {
    async get(location: string): Promise<CachedWeatherData | undefined> {
        try {
            return await db.weather.where('location').equals(location).first();
        } catch (error) {
            log('error', `Failed to get weather for ${location}`, { error });
            throw error;
        }
    },

    async put(location: string, weather: WeatherData, syncStatus: SyncStatus = 'synced'): Promise<void> {
        try {
            const updatedAt = nowUtc();
            const cached: CachedWeatherData = {
                ...weather,
                id: location,
                location,
                updatedAt,
                _syncStatus: syncStatus
            };
            await db.weather.put(cached);
            log('debug', `Cached weather for ${location}`);
        } catch (error) {
            log('error', 'Failed to cache weather', { error });
            throw error;
        }
    }
};

/**
 * METADATA COLLECTION - Collection Metadata & Checksums
 */
export const metadataCache = {
    /**
     * Get metadata for a collection
     */
    async get(collection: string): Promise<CacheMetadata | undefined> {
        try {
            return await db.metadata.get(collection);
        } catch (error) {
            log('error', `Failed to get metadata for ${collection}`, { error });
            throw error;
        }
    },

    /**
     * Update metadata for a collection
     */
    async update(collection: string, data: Partial<CacheMetadata>): Promise<void> {
        try {
            const existing = await db.metadata.get(collection);
            const updatedAt = nowUtc();

            const metadata: CacheMetadata = {
                id: collection,
                collection,
                lastModified: data.lastModified || updatedAt,
                recordCount: data.recordCount ?? existing?.recordCount ?? 0,
                checksum: data.checksum || existing?.checksum || '',
                lastSyncTime: data.lastSyncTime,
                updatedAt,
                _syncStatus: 'synced'
            };

            await db.metadata.put(metadata);
            log('info', `Updated metadata for ${collection}`, { recordCount: metadata.recordCount });
        } catch (error) {
            log('error', `Failed to update metadata for ${collection}`, { error });
            throw error;
        }
    }
};

/**
 * GLOBAL CACHE OPERATIONS
 */
export const localCache = {
    /**
     * Get metadata for all collections
     */
    async getMetadata(collection: 'systems' | 'history' | 'analytics' | 'weather'): Promise<{
        lastModified: string;
        recordCount: number;
        checksum: string;
        staleCount: number;
    } | null> {
        try {
            let data: CachedRecord[] = [];

            switch (collection) {
                case 'systems':
                    data = await systemsCache.getAll();
                    break;
                case 'history':
                    data = await historyCache.getAll();
                    break;
                case 'analytics':
                    data = await analyticsCache.getAll();
                    break;
                case 'weather':
                    data = await db.weather.toArray();
                    break;
            }

            if (data.length === 0) {
                return null;
            }

            // Find most recent updatedAt
            const lastModified = data.reduce((latest, item) => {
                return item.updatedAt > latest ? item.updatedAt : latest;
            }, data[0].updatedAt);

            const checksum = await calculateChecksum(data);
            const staleCount = await localCache.getStaleCount(collection);

            return {
                lastModified,
                recordCount: data.length,
                checksum,
                staleCount
            };
        } catch (error) {
            log('error', `Failed to get metadata for ${collection}`, { error });
            throw error;
        }
    },

    /**
     * Get all pending items across all collections
     */
    async getPendingItems(): Promise<{
        systems: CachedSystem[];
        history: CachedAnalysisRecord[];
        analytics: CachedAnalytics[];
        weather: CachedWeatherData[];
    }> {
        try {
            const [systems, history, analytics, weather] = await Promise.all([
                systemsCache.getPending(),
                historyCache.getPending(),
                analyticsCache.getPending(),
                db.weather.where('_syncStatus').equals('pending').toArray()
            ]);

            const total = systems.length + history.length + analytics.length + weather.length;
            log('info', `Found ${total} pending items total`, {
                systems: systems.length,
                history: history.length,
                analytics: analytics.length,
                weather: weather.length
            });

            return { systems, history, analytics, weather };
        } catch (error) {
            log('error', 'Failed to get pending items', { error });
            throw error;
        }
    },

    /**
     * Mark items as synced by collection
     */
    async markAsSynced(collection: 'systems' | 'history' | 'analytics' | 'weather', ids: string[], serverTimestamp?: string): Promise<void> {
        try {
            const timestamp = serverTimestamp ?? nowUtc();
            const promises = ids.map(id => {
                switch (collection) {
                    case 'systems':
                        return systemsCache.markAsSynced(id, timestamp);
                    case 'history':
                        return historyCache.markAsSynced(id, timestamp);
                    case 'analytics':
                        return db.analytics.update(id, { _syncStatus: 'synced', updatedAt: timestamp });
                    case 'weather':
                        return db.weather.update(id, { _syncStatus: 'synced', updatedAt: timestamp });
                }
            });

            await Promise.all(promises);
            log('info', `Marked ${ids.length} ${collection} items as synced`);
        } catch (error) {
            log('error', `Failed to mark ${collection} as synced`, { error });
            throw error;
        }
    },

    async getStaleCount(collection: 'systems' | 'history' | 'analytics' | 'weather', thresholdMs = 1000 * 60 * 60): Promise<number> {
        const staleItems = await localCache.getStaleItems(collection, thresholdMs);
        return staleItems.length;
    },

    async getStaleItems(collection: 'systems' | 'history' | 'analytics' | 'weather', thresholdMs = 1000 * 60 * 60): Promise<CachedRecord[]> {
        const cutoff = new Date(Date.now() - thresholdMs).toISOString();
        let table: Table<CachedRecord, string>;

        switch (collection) {
            case 'systems':
                table = db.systems as unknown as Table<CachedRecord, string>;
                break;
            case 'history':
                table = db.history as unknown as Table<CachedRecord, string>;
                break;
            case 'analytics':
                table = db.analytics as unknown as Table<CachedRecord, string>;
                break;
            case 'weather':
                table = db.weather as unknown as Table<CachedRecord, string>;
                break;
        }

        // Use indexed queries for performance - much faster than JS filter
        return await table.where('updatedAt').below(cutoff).toArray();
    },

    async purgeStaleItems(collection: 'systems' | 'history' | 'analytics' | 'weather', thresholdMs = 1000 * 60 * 60): Promise<number> {
        const stale = await localCache.getStaleItems(collection, thresholdMs);
        if (!stale.length) return 0;

        switch (collection) {
            case 'systems':
                await db.systems.bulkDelete(stale.map(item => item.id));
                break;
            case 'history':
                await db.history.bulkDelete(stale.map(item => item.id));
                break;
            case 'analytics':
                await db.analytics.bulkDelete(stale.map(item => item.id));
                break;
            case 'weather':
                await db.weather.bulkDelete(stale.map(item => item.id));
                break;
        }

        log('info', `Purged ${stale.length} stale ${collection} records`, { thresholdMs });
        return stale.length;
    },

    /**
     * Clear all cache data (for testing/reset)
     */
    async clearAll(): Promise<void> {
        try {
            await Promise.all([
                db.systems.clear(),
                db.history.clear(),
                db.analytics.clear(),
                db.weather.clear(),
                db.metadata.clear()
            ]);
            log('info', 'Cleared all cache data');
        } catch (error) {
            log('error', 'Failed to clear cache', { error });
            throw error;
        }
    },

    /**
     * Get cache statistics
     */
    async getStats(): Promise<{
        systemsCount: number;
        historyCount: number;
        analyticsCount: number;
        weatherCount: number;
        cacheSizeBytes: number;
    }> {
        try {
            const [systemsCount, historyCount, analyticsCount, weatherCount] = await Promise.all([
                db.systems.count(),
                db.history.count(),
                db.analytics.count(),
                db.weather.count()
            ]);

            // Rough estimate: assume average record is 1KB
            const cacheSizeBytes = (systemsCount + historyCount + analyticsCount + weatherCount) * 1024;

            return {
                systemsCount,
                historyCount,
                analyticsCount,
                weatherCount,
                cacheSizeBytes
            };
        } catch (error) {
            log('error', 'Failed to get cache stats', { error });
            throw error;
        }
    }
};

export default localCache;
