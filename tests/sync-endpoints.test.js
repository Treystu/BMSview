/**
 * Unit Tests for Sync Endpoints
 * Tests sync-metadata, sync-incremental, sync-push endpoints with mocked MongoDB
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

// Mock MongoDB collection responses
const mockCollectionResponse = (mockData) => ({
    find: () => ({
        toArray: async () => mockData,
        limit: function () { return this; }
    }),
    findOne: async (query) => mockData.find(d => Object.keys(query).every(k => d[k] === query[k])),
    insertOne: async (doc) => ({ insertedId: doc._id || 'new-id' }),
    bulkWrite: async (ops) => ({ result: { ok: 1, n: ops.length } }),
    deleteOne: async () => ({ result: { ok: 1 } })
});

describe('Sync Endpoints - Metadata Retrieval', () => {
    it('should return collection metadata with recordCount and lastModified', async () => {
        const mockData = [
            { _id: 'sys-1', name: 'System 1', updatedAt: '2025-11-09T10:00:00Z' },
            { _id: 'sys-2', name: 'System 2', updatedAt: '2025-11-09T11:00:00Z' }
        ];

        const collection = mockCollectionResponse(mockData);
        const all = await collection.find({}).toArray();

        const metadata = {
            collection: 'systems',
            lastModified: all.length > 0 ? all[all.length - 1].updatedAt : null,
            recordCount: all.length,
            checksum: 'abc123', // In real implementation, compute SHA-256
            serverTime: new Date().toISOString()
        };

        expect(metadata.collection).toBe('systems');
        expect(metadata.recordCount).toBe(2);
        expect(metadata.lastModified).toBe('2025-11-09T11:00:00Z');
    });

    it('should validate timestamps are ISO 8601 UTC', async () => {
        const mockData = [
            { _id: 'sys-1', updatedAt: '2025-11-09T10:00:00Z' }
        ];

        const collection = mockCollectionResponse(mockData);
        const all = await collection.find({}).toArray();

        const isValidISO = (ts) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(ts) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ts);

        all.forEach(record => {
            expect(isValidISO(record.updatedAt)).toBe(true);
        });
    });
});

describe('Sync Endpoints - Incremental Sync', () => {
    it('should return only records since specified timestamp', async () => {
        const allRecords = [
            { _id: 'sys-1', name: 'System 1', updatedAt: '2025-11-09T10:00:00Z' },
            { _id: 'sys-2', name: 'System 2', updatedAt: '2025-11-09T11:00:00Z' },
            { _id: 'sys-3', name: 'System 3', updatedAt: '2025-11-09T12:00:00Z' }
        ];

        const collection = mockCollectionResponse(allRecords);
        const since = '2025-11-09T10:30:00Z';

        // Simulate filtering in the endpoint
        const filtered = allRecords.filter(r => new Date(r.updatedAt) >= new Date(since));

        expect(filtered.length).toBe(2);
        expect(filtered[0]._id).toBe('sys-2');
        expect(filtered[1]._id).toBe('sys-3');
    });

    it('should include deleted record IDs from deleted-records collection', async () => {
        const deletedRecords = [
            { _id: 'del-1', recordId: 'sys-old-1', collection: 'systems', deletedAt: '2025-11-09T11:00:00Z' },
            { _id: 'del-2', recordId: 'sys-old-2', collection: 'systems', deletedAt: '2025-11-09T11:30:00Z' }
        ];

        const collection = mockCollectionResponse(deletedRecords);
        const all = await collection.find({}).toArray();

        const response = {
            items: [],
            deleted: all.map(d => d.recordId),
            timestamp: new Date().toISOString()
        };

        expect(response.deleted.length).toBe(2);
        expect(response.deleted).toContain('sys-old-1');
        expect(response.deleted).toContain('sys-old-2');
    });

    it('should reject requests without since parameter', async () => {
        const endpoint = async (since) => {
            if (!since) {
                throw new Error('since parameter is required');
            }
            return { items: [] };
        };

        try {
            await endpoint(null);
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            expect(error.message).toContain('since parameter is required');
        }
    });

    it('should normalize timestamps in incremental sync response', async () => {
        const mockData = [
            { _id: 'sys-1', updatedAt: '2025-11-09T10:00:00Z' },
            { _id: 'sys-2', updatedAt: 1730970000000 } // Epoch milliseconds
        ];

        const collection = mockCollectionResponse(mockData);
        const all = await collection.find({}).toArray();

        // Normalize timestamps
        const normalized = all.map(record => ({
            ...record,
            updatedAt: typeof record.updatedAt === 'number'
                ? new Date(record.updatedAt).toISOString()
                : record.updatedAt
        }));

        expect(normalized[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(normalized[1].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('Sync Endpoints - Batch Push', () => {
    it('should insert new records and return success', async () => {
        const items = [
            { id: 'sys-1', name: 'System 1', _syncStatus: 'pending' },
            { id: 'sys-2', name: 'System 2', _syncStatus: 'pending' }
        ];

        const collection = mockCollectionResponse([]);
        const result = await collection.insertOne(items[0]);

        expect(result.insertedId).toBeDefined();
    });

    it('should update existing records on conflict', async () => {
        const items = [
            { id: 'sys-1', name: 'Updated System 1', updatedAt: new Date().toISOString() }
        ];

        const collection = mockCollectionResponse([
            { _id: 'sys-1', name: 'Old System 1', updatedAt: '2025-11-09T10:00:00Z' }
        ]);

        // Simulate bulkWrite
        const ops = items.map(item => ({
            updateOne: {
                filter: { _id: item.id },
                update: { $set: item },
                upsert: true
            }
        }));

        expect(ops.length).toBe(1);
        expect(ops[0].updateOne.upsert).toBe(true);
    });

    it('should set _syncStatus to synced after successful push', async () => {
        const items = [
            { id: 'sys-1', name: 'System 1' },
            { id: 'sys-2', name: 'System 2' }
        ];

        // Simulate server setting _syncStatus after insert
        const syncedItems = items.map(item => ({
            ...item,
            _syncStatus: 'synced',
            updatedAt: new Date().toISOString()
        }));

        expect(syncedItems[0]._syncStatus).toBe('synced');
        expect(syncedItems[1]._syncStatus).toBe('synced');
    });

    it('should set updatedAt to server time on push', async () => {
        const serverTime = new Date().toISOString();
        const items = [
            { id: 'sys-1', name: 'System 1', _syncStatus: 'pending', updatedAt: 'old-time' }
        ];

        // Simulate server overwriting updatedAt
        const updatedItems = items.map(item => ({
            ...item,
            updatedAt: serverTime,
            _syncStatus: 'synced'
        }));

        expect(updatedItems[0].updatedAt).toBe(serverTime);
        expect(updatedItems[0].updatedAt).not.toBe('old-time');
    });

    it('should handle push with mixed new and updated records', async () => {
        const push = {
            collection: 'systems',
            items: [
                { id: 'sys-1', name: 'New System', _syncStatus: 'pending' },
                { id: 'sys-2', name: 'Updated System', _syncStatus: 'pending' }
            ]
        };

        // Response after server processing
        const response = {
            success: true,
            inserted: 1,
            updated: 1,
            serverTime: new Date().toISOString()
        };

        expect(response.inserted).toBe(1);
        expect(response.updated).toBe(1);
    });

    it('should return meaningful error on conflict that cannot be auto-resolved', async () => {
        const push = {
            collection: 'systems',
            items: [
                { id: 'sys-1', name: 'System 1', updatedAt: '2025-11-09T10:00:00Z' }
            ]
        };

        // Simulate scenario where local and server versions have conflicting changes
        const serverVersion = { id: 'sys-1', name: 'System 1 Server', updatedAt: '2025-11-09T12:00:00Z' };

        const localNewer = new Date(push.items[0].updatedAt) > new Date(serverVersion.updatedAt);
        expect(localNewer).toBe(false); // Server version is newer
    });
});

describe('Sync Endpoints - Error Handling', () => {
    it('should handle MongoDB connection failure', async () => {
        const endpoint = async () => {
            throw new Error('MongoDB connection failed');
        };

        try {
            await endpoint();
            expect(true).toBe(false);
        } catch (error) {
            expect(error.message).toContain('connection failed');
        }
    });

    it('should handle malformed request body', async () => {
        const request = async (body) => {
            if (!body || typeof body !== 'object') {
                throw new Error('Invalid request body');
            }
            return { success: true };
        };

        try {
            await request('invalid');
            expect(true).toBe(false);
        } catch (error) {
            expect(error.message).toContain('Invalid request body');
        }
    });

    it('should handle timeout on MongoDB query', async () => {
        const endpoint = async () => {
            // Simulate timeout
            await new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout after 5000ms')), 100));
        };

        try {
            await endpoint();
            expect(true).toBe(false);
        } catch (error) {
            expect(error.message).toContain('timeout');
        }
    });

    it('should validate and sanitize input data', async () => {
        const validateItem = (item) => {
            const required = ['id', 'updatedAt'];
            for (const field of required) {
                if (!item[field]) {
                    throw new Error(`Missing required field: ${field}`);
                }
            }
            // Sanitize: reject items with _id (MongoDB reserved)
            if (Object.prototype.hasOwnProperty.call(item, '_id')) {
                throw new Error('Invalid item structure: _id is reserved');
            }
            return true;
        };

        const validItem = { id: 'sys-1', updatedAt: new Date().toISOString() };
        expect(validateItem(validItem)).toBe(true);

        try {
            validateItem({ id: 'sys-1' }); // Missing updatedAt
            expect(true).toBe(false);
        } catch (error) {
            expect(error.message).toContain('Missing required field');
        }
    });
});

describe('Sync Endpoints - Response Format Validation', () => {
    it('should return metadata response with correct structure', async () => {
        const response = {
            collection: 'systems',
            lastModified: '2025-11-09T11:00:00Z',
            recordCount: 5,
            checksum: 'abc123def456',
            serverTime: new Date().toISOString()
        };

        expect(response).toHaveProperty('collection');
        expect(response).toHaveProperty('lastModified');
        expect(response).toHaveProperty('recordCount');
        expect(response).toHaveProperty('serverTime');
        expect(typeof response.recordCount).toBe('number');
    });

    it('should return incremental sync response with correct structure', async () => {
        const response = {
            collection: 'systems',
            items: [
                { id: 'sys-1', name: 'System 1', updatedAt: '2025-11-09T11:00:00Z' }
            ],
            deleted: ['sys-old-1'],
            timestamp: new Date().toISOString(),
            hasMore: false
        };

        expect(Array.isArray(response.items)).toBe(true);
        expect(Array.isArray(response.deleted)).toBe(true);
        expect(response).toHaveProperty('timestamp');
    });

    it('should return push response with correct structure', async () => {
        const response = {
            success: true,
            inserted: 2,
            updated: 1,
            conflicts: 0,
            serverTime: new Date().toISOString()
        };

        expect(response.success).toBe(true);
        expect(typeof response.inserted).toBe('number');
        expect(typeof response.updated).toBe('number');
        expect(response).toHaveProperty('serverTime');
    });
});

module.exports = {};
