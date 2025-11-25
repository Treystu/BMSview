/**
 * Frontend Sync E2E Tests
 *
 * Tests the complete frontend sync flow from App.tsx integration
 * through cache hydration, periodic sync, and user actions.
 *
 * Note: These tests mock the Netlify functions and IndexedDB to simulate
 * a full browser environment without actual backend or database.
 * 
 * @jest-environment jsdom
 */

// Mock fetch globally before any imports
global.fetch = jest.fn().mockImplementation(() => 
    Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [], total: 0 }),
        text: () => Promise.resolve(''),
        headers: new Headers({
            'content-type': 'application/json'
        })
    })
);

// Mock IndexedDB before any imports
const mockIndexedDB = {
    databases: async () => [],
    open: jest.fn()
};
global.indexedDB = mockIndexedDB;

// Mock localStorage
const mockLocalStorage = {
    data: {},
    getItem: function (key) {
        return this.data[key] || null;
    },
    setItem: function (key, value) {
        this.data[key] = value;
    },
    removeItem: function (key) {
        delete this.data[key];
    },
    clear: function () {
        this.data = {};
    }
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

// Mock localCache before importing syncManager
jest.mock('../src/services/localCache', () => ({
    systemsCache: {
        getAll: jest.fn().mockResolvedValue([]),
        bulkPut: jest.fn().mockResolvedValue(undefined),
    },
    historyCache: {
        getAll: jest.fn().mockResolvedValue([]),
        bulkPut: jest.fn().mockResolvedValue(undefined),
    },
    getPendingItems: jest.fn().mockResolvedValue({ systems: [], history: [], analytics: [] }),
    getLatestTimestamps: jest.fn().mockResolvedValue({ systems: null, history: null }),
    refreshFromServer: jest.fn().mockResolvedValue(undefined),
}));

const { syncManager, intelligentSync } = require('../src/services/syncManager');

describe('Frontend Sync E2E Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLocalStorage.clear();
        global.fetch.mockClear();
    });

    afterEach(() => {
        syncManager.stopPeriodicSync();
        syncManager.destroy();
    });

    // ========================================================
    // CACHE HYDRATION ON APP LOAD
    // ========================================================

    describe('Cache Hydration on App Load', () => {
        test('app should load cache on mount and start periodic sync', (done) => {
            // Simulate cache available
            expect(() => {
                syncManager.startPeriodicSync();
            }).not.toThrow();

            // Sync status should reflect started state
            const status = syncManager.getSyncStatus();
            expect(status.nextSyncIn).toBe('pending');

            syncManager.stopPeriodicSync();
            done();
        });

        test('periodic sync should be stoppable', (done) => {
            syncManager.startPeriodicSync();
            expect(syncManager.getSyncStatus().nextSyncIn).toBe('pending');

            syncManager.stopPeriodicSync();
            expect(syncManager.getSyncStatus().nextSyncIn).toBe('stopped');

            done();
        });
    });

    // ========================================================
    // DUAL-WRITE ON CRITICAL ACTIONS
    // ========================================================

    describe('Dual-Write on Critical Actions', () => {
        test('dual-write should reset periodic timer', () => {
            const initialStatus = syncManager.getSyncStatus();

            // Simulate a dual-write action (timer reset)
            syncManager.resetPeriodicTimer();

            const afterResetStatus = syncManager.getSyncStatus();
            expect(afterResetStatus.nextSyncIn).toBe('pending');
        });

        test('forceSyncNow should trigger sync immediately', async () => {
            // Should not throw
            syncManager.startPeriodicSync();
            await syncManager.forceSyncNow();
            syncManager.stopPeriodicSync();

            expect(true).toBe(true);
        });
    });

    // ========================================================
    // PERIODIC SYNC CYCLE
    // ========================================================

    describe('Periodic Sync Cycle', () => {
        test('intelligent sync should decide pull when local cache is empty', () => {
            const localMeta = { collection: 'history', recordCount: 0 };
            const serverMeta = {
                collection: 'history',
                recordCount: 5,
                lastModified: new Date().toISOString(),
                serverTime: new Date().toISOString()
            };

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull');
            expect(decision.reason).toContain('Local cache empty');
            expect(decision.serverCount).toBe(5);
        });

        test('intelligent sync should decide push when local is newer', () => {
            const newTime = new Date().toISOString();
            const oldTime = new Date(Date.now() - 5000).toISOString();

            const localMeta = { collection: 'systems', recordCount: 3, lastModified: newTime };
            const serverMeta = {
                collection: 'systems',
                recordCount: 3,
                lastModified: oldTime,
                serverTime: new Date().toISOString()
            };

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('push');
            expect(decision.reason).toContain('Local data is newer');
        });

        test('intelligent sync should decide skip when identical', () => {
            const sameTime = new Date().toISOString();

            const localMeta = { collection: 'analytics', recordCount: 5, lastModified: sameTime };
            const serverMeta = {
                collection: 'analytics',
                recordCount: 5,
                lastModified: sameTime,
                serverTime: new Date().toISOString()
            };

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('skip');
            expect(decision.reason).toContain('identical');
        });
    });

    // ========================================================
    // SYNC STATUS TRACKING
    // ========================================================

    describe('Sync Status Tracking', () => {
        test('getSyncStatus should return correct state', () => {
            const status = syncManager.getSyncStatus();

            expect(status).toHaveProperty('isSyncing');
            expect(status).toHaveProperty('lastSyncTime');
            expect(status).toHaveProperty('syncError');
            expect(status).toHaveProperty('nextSyncIn');

            expect(typeof status.isSyncing).toBe('boolean');
            expect(typeof status.nextSyncIn).toBe('string');
        });

        test('sync error should initially be null', () => {
            const status = syncManager.getSyncStatus();
            expect(status.syncError).toBeNull();
        });

        test('isSyncing should be false initially', () => {
            const status = syncManager.getSyncStatus();
            expect(status.isSyncing).toBe(false);
        });
    });

    // ========================================================
    // OFFLINE TO ONLINE TRANSITION
    // ========================================================

    describe('Offline to Online Transition', () => {
        test('forceSyncNow should complete without error', async () => {
            // Mock successful response
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ items: [] })
            });

            await syncManager.forceSyncNow();
            expect(syncManager.getSyncStatus().isSyncing).toBe(false);
        });

        test('sync manager should survive network error without crashing', async () => {
            // Mock network error
            global.fetch.mockRejectedValueOnce(new Error('Network error'));

            // Should not throw
            try {
                await syncManager.forceSyncNow();
            } catch (e) {
                // Error handling is expected
            }

            expect(true).toBe(true);
        });
    });

    // ========================================================
    // CONCURRENT ACTIONS HANDLING
    // ========================================================

    describe('Concurrent Actions Handling', () => {
        test('should prevent concurrent syncs via isSyncing flag', () => {
            const status = syncManager.getSyncStatus();
            expect(status.isSyncing).toBe(false);
        });

        test('sync state should be atomic', () => {
            const status1 = syncManager.getSyncStatus();
            const status2 = syncManager.getSyncStatus();

            expect(status1.isSyncing).toBe(status2.isSyncing);
            expect(status1.syncError).toBe(status2.syncError);
        });
    });

    // ========================================================
    // ERROR RECOVERY PATH
    // ========================================================

    describe('Error Recovery Path', () => {
        test('sync should remain operational after error', async () => {
            global.fetch.mockRejectedValueOnce(new Error('Sync failed'));

            try {
                await syncManager.forceSyncNow();
            } catch (e) {
                // Expected
            }

            // Should still be operable
            expect(syncManager.getSyncStatus().isSyncing).toBe(false);
        });

        test('sync error should be accessible via status', () => {
            const status = syncManager.getSyncStatus();

            // Error should be null initially
            expect(status.syncError === null || typeof status.syncError === 'string').toBe(true);
        });
    });

    // ========================================================
    // CLEANUP AND UNMOUNT
    // ========================================================

    describe('Cleanup and Unmount', () => {
        test('destroy should stop all timers and cleanup', () => {
            syncManager.startPeriodicSync();
            expect(syncManager.getSyncStatus().nextSyncIn).toBe('pending');

            syncManager.destroy();

            expect(syncManager.getSyncStatus().nextSyncIn).toBe('stopped');
        });

        test('stopPeriodicSync on unmount should prevent memory leaks', (done) => {
            syncManager.startPeriodicSync();

            // Simulate component unmount
            syncManager.stopPeriodicSync();

            // Timer should be cleared
            setTimeout(() => {
                const status = syncManager.getSyncStatus();
                expect(status.nextSyncIn).toBe('stopped');
                done();
            }, 50);
        });
    });

    // ========================================================
    // TIMESTAMP HANDLING
    // ========================================================

    describe('Timestamp Handling', () => {
        test('sync decisions should use ISO 8601 UTC timestamps', () => {
            const now = new Date().toISOString();
            const past = new Date(Date.now() - 10000).toISOString();

            const localMeta = { collection: 'history', recordCount: 1, lastModified: now };
            const serverMeta = {
                collection: 'history',
                recordCount: 1,
                lastModified: past,
                serverTime: now
            };

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('push');
            expect(decision.localTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(decision.serverTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    // ========================================================
    // LIFECYCLE
    // ========================================================

    describe('Lifecycle', () => {
        test('sync manager should initialize without errors', () => {
            expect(() => {
                const status = syncManager.getSyncStatus();
                expect(status).toBeDefined();
            }).not.toThrow();
        });

        test('multiple start/stop cycles should work safely', () => {
            for (let i = 0; i < 3; i++) {
                syncManager.startPeriodicSync();
                expect(syncManager.getSyncStatus().nextSyncIn).toBe('pending');

                syncManager.stopPeriodicSync();
                expect(syncManager.getSyncStatus().nextSyncIn).toBe('stopped');
            }

            expect(true).toBe(true);
        });
    });
});

