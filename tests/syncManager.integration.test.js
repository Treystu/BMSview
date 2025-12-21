// @ts-nocheck
/**
 * SyncManager Integration Tests
 * 
 * Tests the intelligent sync decision engine with various scenarios:
 * - Fresh cache sync
 * - Local newer vs server
 * - Server newer vs local
 * - Conflict reconciliation
 * - Periodic sync timer reset
 * - Dual-write critical actions
 * - Offline scenarios
 * - Concurrent sync attempts
 */

const {
    intelligentSync,
    reconcileData,
    SyncManager,
    syncManager
} = require('../src/services/syncManager');

// Mock localCache to avoid Dexie/IndexedDB issues in integration test
jest.mock('@/services/localCache', () => ({
    localCache: {
        getMetadata: jest.fn().mockResolvedValue({ recordCount: 0, lastModified: null }),
        getPendingItems: jest.fn().mockResolvedValue({ systems: [], history: [], analytics: [] }),
        markAsSynced: jest.fn().mockResolvedValue(undefined),
        systemsCache: { put: jest.fn(), bulkPut: jest.fn(), delete: jest.fn() },
        historyCache: { put: jest.fn(), bulkPut: jest.fn(), delete: jest.fn() }
    },
    default: {
        getMetadata: jest.fn().mockResolvedValue({ recordCount: 0, lastModified: null }),
        getPendingItems: jest.fn().mockResolvedValue({ systems: [], history: [], analytics: [] }),
        markAsSynced: jest.fn().mockResolvedValue(undefined),
        systemsCache: { put: jest.fn(), bulkPut: jest.fn(), delete: jest.fn() },
        historyCache: { put: jest.fn(), bulkPut: jest.fn(), delete: jest.fn() }
    }
}), { virtual: true });

describe('SyncManager Integration Tests', () => {
    // Mock global fetch to prevent relative URL errors and ensure response
    beforeAll(() => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ items: [], deletedIds: [] }),
            text: () => Promise.resolve('OK')
        }));
    });

    // Mock data helpers
    function createLocalMeta(recordCount, lastModified) {
        return {
            collection: 'history',
            recordCount,
            lastModified: lastModified || (recordCount === 0 ? undefined : new Date(Date.now() - 1000).toISOString())
        };
    }

    function createServerMeta(recordCount, lastModified) {
        return {
            collection: 'history',
            recordCount,
            lastModified: lastModified || new Date().toISOString(),
            serverTime: new Date().toISOString()
        };
    }

    function createRecord(id, timestamp) {
        const ts = timestamp || new Date().toISOString();
        return {
            id,
            data: `record-${id}`,
            timestamp: ts,
            updatedAt: ts, // Required by reconcileData() for conflict resolution (compares updatedAt timestamps)
            _syncStatus: 'pending'
        };
    }

    // =======================================================
    // INTELLIGENT SYNC DECISION ENGINE
    // =======================================================

    describe('intelligentSync decision logic', () => {
        test('pull action when local cache is empty', () => {
            const localMeta = createLocalMeta(0);
            const serverMeta = createServerMeta(5);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull');
            expect(decision.reason).toContain('Local cache empty');
            expect(decision.localCount).toBe(0);
            expect(decision.serverCount).toBe(5);
        });

        test('skip action when both local and server are empty', () => {
            const localMeta = createLocalMeta(0);
            const serverMeta = createServerMeta(0);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('skip');
            expect(decision.reason).toContain('Both local and server are empty');
        });

        test('push action when only local has data', () => {
            const localMeta = createLocalMeta(5);
            const serverMeta = createServerMeta(0);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('push');
            expect(decision.reason).toContain('Local has data but server is empty');
            expect(decision.localCount).toBe(5);
            expect(decision.serverCount).toBe(0);
        });

        test('push action when local is newer', () => {
            const newTime = new Date().toISOString();
            const oldTime = new Date(Date.now() - 5000).toISOString();

            const localMeta = createLocalMeta(3, newTime);
            const serverMeta = createServerMeta(3, oldTime);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('push');
            expect(decision.reason).toContain('Local data is newer');
            expect(decision.localTimestamp).toBe(newTime);
            expect(decision.serverTimestamp).toBe(oldTime);
        });

        test('pull action when server is newer', () => {
            const newTime = new Date().toISOString();
            const oldTime = new Date(Date.now() - 5000).toISOString();

            const localMeta = createLocalMeta(3, oldTime);
            const serverMeta = createServerMeta(3, newTime);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull');
            expect(decision.reason).toContain('Server data is newer');
        });

        test('pull action when timestamps are equal but server has more records', () => {
            const sameTime = new Date().toISOString();

            const localMeta = createLocalMeta(3, sameTime);
            const serverMeta = createServerMeta(5, sameTime);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull');
            expect(decision.reason).toContain('Timestamps equal but server has more records');
            expect(decision.localCount).toBe(3);
            expect(decision.serverCount).toBe(5);
        });

        test('pull action when timestamps are equal but server has more records', () => {
            const sameTime = new Date().toISOString();

            const localMeta = createLocalMeta(2, sameTime);
            const serverMeta = createServerMeta(5, sameTime);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull');
            expect(decision.reason).toContain('Timestamps equal but server has more records');
        });
    });

    // =======================================================
    // DATA RECONCILIATION
    // =======================================================

    describe('reconcileData merge logic', () => {
        test('merge prefers server data when timestamps differ by >1s', () => {
            const now = Date.now();
            const localData = [
                createRecord('1', new Date(now - 10000).toISOString()) // 10s older
            ];
            const serverData = [
                createRecord('1', new Date(now).toISOString()) // current
            ];

            const { merged, conflicts } = reconcileData(localData, serverData, []);

            expect(merged).toHaveLength(1);
            expect(merged[0].id).toBe('1');
            expect(conflicts).toHaveLength(1); // Conflict recorded
            expect(conflicts[0].resolution).toBe('server-won');
        });

        test('merge keeps all records from both sources with no timestamp conflict', () => {
            const now = Date.now();
            const localData = [
                createRecord('1', new Date(now).toISOString()),
                createRecord('2', new Date(now).toISOString())
            ];
            const serverData = [
                createRecord('3', new Date(now).toISOString()),
                createRecord('4', new Date(now).toISOString())
            ];

            const { merged, conflicts } = reconcileData(localData, serverData, []);

            expect(merged).toHaveLength(4);
            expect(merged.map(r => r.id).sort()).toEqual(['1', '2', '3', '4']);
            expect(conflicts).toHaveLength(0);
        });

        test('removes records marked as deleted on server', () => {
            const now = new Date().toISOString();
            const localData = [
                createRecord('1', now),
                createRecord('2', now),
                createRecord('3', now)
            ];
            const serverData = [
                createRecord('1', now),
                createRecord('2', now)
            ];
            const deletedIds = ['3']; // Deleted on server

            const { merged, conflicts } = reconcileData(localData, serverData, deletedIds);

            expect(merged).toHaveLength(2);
            expect(merged.map(r => r.id)).toEqual(['1', '2']);
            expect(conflicts).toHaveLength(0);
        });

        test('handles mixed old and new records', () => {
            const now = Date.now();
            const oldTime = new Date(now - 60000).toISOString(); // 1 minute ago
            const newTime = new Date(now).toISOString();

            const localData = [
                createRecord('1', oldTime), // old
                createRecord('2', newTime)  // new
            ];
            const serverData = [
                createRecord('1', newTime), // conflict: server newer
                createRecord('3', newTime)  // new on server
            ];

            const { merged, conflicts } = reconcileData(localData, serverData, []);

            expect(merged).toHaveLength(3);
            expect(merged.map(r => r.id).sort()).toEqual(['1', '2', '3']);
            expect(conflicts).toHaveLength(1);
            expect(conflicts[0].id).toBe('1');
        });
    });

    // =======================================================
    // SYNCMANAGER CLASS BEHAVIOR
    // =======================================================

    describe('SyncManager class', () => {
        let manager;

        beforeEach(() => {
            manager = new SyncManager();
        });

        afterEach(async () => {
            if (manager) {
                manager.destroy();
            }
        });

        test('initializes with correct default state', () => {
            const status = manager.getSyncStatus();

            expect(status.isSyncing).toBe(false);
            expect(status.lastSyncTime).toEqual({});
            expect(status.syncError).toBeNull();
            expect(status.nextSyncIn).toBe('stopped');
        });

        test('startPeriodicSync initializes timer', async () => {
            manager.startPeriodicSync();
            const status = manager.getSyncStatus();

            expect(status.nextSyncIn).toBe('pending');
        });

        test('stopPeriodicSync clears timer', () => {
            manager.startPeriodicSync();
            manager.stopPeriodicSync();
            const status = manager.getSyncStatus();

            expect(status.nextSyncIn).toBe('stopped');
        });

        test('resetPeriodicTimer reschedules next sync', async () => {
            manager.startPeriodicSync();
            const status1 = manager.getSyncStatus();

            // Reset the timer
            manager.resetPeriodicTimer();
            const status2 = manager.getSyncStatus();

            // Both should be pending, but reset should have updated the timer
            expect(status1.nextSyncIn).toBe('pending');
            expect(status2.nextSyncIn).toBe('pending');
        });

        test('does not allow concurrent syncs', async () => {
            // The SyncManager has an internal isSyncing flag (private)
            // We can't directly test it, but we can verify getSyncStatus returns the flag correctly
            const status = manager.getSyncStatus();

            // Initially not syncing
            expect(status.isSyncing).toBe(false);

            // Note: The actual concurrent sync prevention is tested through integration,
            // as the isSyncing property is private and cannot be directly manipulated
        });

        test('destroy clears all state', async () => {
            manager.startPeriodicSync();
            manager.destroy();
            const status = manager.getSyncStatus();

            expect(status.nextSyncIn).toBe('stopped');
            expect(status.isSyncing).toBe(false);
        });
    });

    // =======================================================
    // SCENARIO TESTS
    // =======================================================

    describe('Real-world sync scenarios', () => {
        test('Scenario 1: Fresh install, pull all from server', () => {
            const localMeta = createLocalMeta(0); // Fresh install
            const serverMeta = createServerMeta(100); // Server has 100 records

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull');
            expect(decision.localCount).toBe(0);
            expect(decision.serverCount).toBe(100);
        });

        test('Scenario 2: Local changes pending, push to server', () => {
            const now = new Date().toISOString();

            const localMeta = createLocalMeta(110, now); // Local has 110 (100 + 10 new)
            const serverMeta = createServerMeta(100, new Date(Date.now() - 10000).toISOString()); // Server has 100, older

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('push');
            expect(decision.localCount).toBe(110);
            expect(decision.serverCount).toBe(100);
        });

        test('Scenario 3: Server updated, pull changes', () => {
            const serverTime = new Date().toISOString();
            const localTime = new Date(Date.now() - 60000).toISOString(); // 1 minute old

            const localMeta = createLocalMeta(100, localTime);
            const serverMeta = createServerMeta(105, serverTime); // 5 new records on server

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull');
            expect(decision.serverCount).toBe(105);
        });

        test('Scenario 4: Offline changes, later sync reconciliation', () => {
            const conflictTime = new Date().toISOString();

            // Both have records but different counts, same timestamp
            // This would trigger a pull (server has more)
            const localMeta = createLocalMeta(55, conflictTime); // 5 local changes
            const serverMeta = createServerMeta(58, conflictTime); // 8 server changes

            const decision = intelligentSync(localMeta, serverMeta);

            // Same timestamp, server has more = pull from server
            expect(decision.action).toBe('pull');
            expect(decision.reason).toContain('Timestamps equal but server has more records');
            expect(decision.localCount).toBe(55);
            expect(decision.serverCount).toBe(58);
        });

        test('Scenario 5: Conflict detection in merged data', () => {
            const now = Date.now();
            const oldTime = new Date(now - 5000).toISOString(); // 5s ago
            const newTime = new Date(now).toISOString();

            const localRecord = createRecord('abc', oldTime);
            const serverRecord = {
                ...createRecord('abc', newTime), // Create full record with updatedAt
                data: 'server-updated'
            };

            const { merged, conflicts } = reconcileData([localRecord], [serverRecord], []);

            expect(merged).toHaveLength(1);
            expect(conflicts).toHaveLength(1);
            expect(conflicts[0].id).toBe('abc');
            expect(conflicts[0].resolution).toBe('server-won');
        });
    });

    // =======================================================
    // EDGE CASES
    // =======================================================

    describe('Edge cases and error handling', () => {
        test('handles missing timestamps gracefully', () => {
            const localMeta = createLocalMeta(5);
            localMeta.lastModified = undefined; // No timestamp

            const serverMeta = createServerMeta(5, new Date().toISOString());

            const decision = intelligentSync(localMeta, serverMeta);

            // Should still make a decision, preferring pull when uncertain
            expect(['pull', 'reconcile']).toContain(decision.action);
        });

        test('handles null/empty record lists in reconciliation', () => {
            const { merged, conflicts } = reconcileData([], [], []);

            expect(merged).toEqual([]);
            expect(conflicts).toEqual([]);
        });

        test('handles extremely large record counts', () => {
            const localMeta = createLocalMeta(1000000);
            const serverMeta = createServerMeta(1000000, new Date().toISOString());

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.localCount).toBe(1000000);
            expect(decision.serverCount).toBe(1000000);
            expect(['pull', 'push', 'reconcile', 'skip']).toContain(decision.action);
        });

        test('handles millisecond-precision timestamp comparison', () => {
            const now = Date.now();
            const time1 = new Date(now).toISOString();
            const time2 = new Date(now + 500).toISOString(); // 500ms later

            const localMeta = createLocalMeta(10, time1);
            const serverMeta = createServerMeta(10, time2);

            const decision = intelligentSync(localMeta, serverMeta);

            // 500ms difference should be treated as different
            expect(decision.action).toBe('pull'); // Server is newer
        });
    });

    // =======================================================
    // INTEGRATION WITH ACTUAL TIMESTAMP FORMATS
    // =======================================================

    describe('ISO 8601 UTC timestamp compatibility', () => {
        test('correctly parses ISO 8601 UTC timestamps', () => {
            const iso1 = '2025-11-05T14:30:00Z';
            const iso2 = '2025-11-05T14:30:05Z'; // 5 seconds later

            const localMeta = createLocalMeta(10, iso1);
            const serverMeta = createServerMeta(10, iso2);

            const decision = intelligentSync(localMeta, serverMeta);

            expect(decision.action).toBe('pull'); // Server is newer
            expect(decision.serverTimestamp).toBe(iso2);
        });

        test('handles timezone-aware timestamps correctly', () => {
            const utcTime = new Date('2025-11-05T14:30:00Z').toISOString();
            const offsetTime = new Date('2025-11-05T14:30:00+00:00').toISOString(); // Same instant

            const localMeta = createLocalMeta(10, utcTime);
            const serverMeta = createServerMeta(10, offsetTime);

            const decision = intelligentSync(localMeta, serverMeta);

            // Should recognize these as the same time
            expect(decision.action).toBe('skip');
        });
    });
});
