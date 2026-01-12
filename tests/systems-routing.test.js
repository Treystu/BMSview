// @ts-nocheck

const mockSystemsCollection = {
    findOne: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
    deleteMany: jest.fn(),
    deleteOne: jest.fn()
};

const mockHistoryCollection = {
    updateMany: jest.fn(),
    countDocuments: jest.fn()
};

jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
    getCollection: jest.fn(async (name) => {
        if (name === 'systems') return mockSystemsCollection;
        if (name === 'history') return mockHistoryCollection;
        throw new Error(`Unexpected collection: ${name}`);
    })
}));

jest.mock('../netlify/functions/utils/logger.cjs', () => ({
    createLoggerFromEvent: () => ({
        entry: jest.fn(),
        exit: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        dbOperation: jest.fn()
    }),
    createTimer: () => ({ end: jest.fn() })
}));

jest.mock('../netlify/functions/utils/handler-logging.cjs', () => ({
    createStandardEntryMeta: jest.fn(() => ({}))
}));

jest.mock('../netlify/functions/utils/cors.cjs', () => ({
    getCorsHeaders: jest.fn(() => ({ 'access-control-allow-origin': '*' }))
}));

jest.mock('../netlify/functions/utils/data-merge.cjs', () => ({
    mergeBmsAndCloudData: jest.fn(async () => ([{ timestamp: '2024-01-01T00:00:00.000Z', source: 'bms', data: { overallVoltage: 12 } }])),
    downsampleMergedData: jest.fn((data) => data)
}));

describe('systems.cjs routing compatibility', () => {
    let handler;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        handler = require('../netlify/functions/systems.cjs').handler;
    });

    test('OPTIONS preflight does not throw and returns 200', async () => {
        const res = await handler({
            httpMethod: 'OPTIONS',
            path: '/.netlify/functions/systems',
            headers: {}
        }, {});

        expect(res.statusCode).toBe(200);
        expect(res.headers).toBeDefined();
    });

    test('GET /.netlify/functions/systems/:id returns the system', async () => {
        mockSystemsCollection.findOne.mockResolvedValue({ id: 'sys-1', name: 'System 1', associatedHardwareIds: [] });

        const res = await handler({
            httpMethod: 'GET',
            path: '/.netlify/functions/systems/sys-1',
            headers: {}
        }, {});

        expect(mockSystemsCollection.findOne).toHaveBeenCalledWith({ id: 'sys-1' }, { projection: { _id: 0 } });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).id).toBe('sys-1');
    });

    test('PUT /.netlify/functions/systems/:id updates using path param', async () => {
        mockSystemsCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        mockSystemsCollection.findOne.mockResolvedValue({ id: 'sys-1', name: 'Updated', associatedHardwareIds: ['DL-123'] });

        const res = await handler({
            httpMethod: 'PUT',
            path: '/.netlify/functions/systems/sys-1',
            headers: {},
            body: JSON.stringify({ name: 'Updated', associatedHardwareIds: ['dl123'] })
        }, {});

        expect(mockSystemsCollection.updateOne).toHaveBeenCalled();
        const [filter, update] = mockSystemsCollection.updateOne.mock.calls[0];
        expect(filter).toEqual({ id: 'sys-1' });
        expect(update.$set.associatedHardwareIds).toEqual(['DL-123']);
        expect(update.$set.associatedDLs).toEqual(['DL-123']);

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).name).toBe('Updated');
    });

    test('POST /.netlify/functions/systems/associate-hardware normalizes and adds hardwareId', async () => {
        mockSystemsCollection.findOne.mockResolvedValue({ id: 'sys-1', associatedHardwareIds: ['DL-999'] });
        mockSystemsCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

        const res = await handler({
            httpMethod: 'POST',
            path: '/.netlify/functions/systems/associate-hardware',
            headers: {},
            body: JSON.stringify({ systemId: 'sys-1', hardwareId: 'dl123' })
        }, {});

        expect(mockSystemsCollection.updateOne).toHaveBeenCalledWith(
            { id: 'sys-1' },
            { $set: { associatedHardwareIds: ['DL-999', 'DL-123'], associatedDLs: ['DL-999', 'DL-123'] } }
        );

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.hardwareId).toBe('DL-123');
        expect(body.added).toBe(true);
    });

    test('POST /.netlify/functions/systems/merge works with path routing and no explicit action', async () => {
        mockSystemsCollection.find.mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
                { id: 'primary', name: 'Primary', associatedHardwareIds: ['DL-111'] },
                { id: 'other', name: 'Other', associatedHardwareIds: ['DL-222'] }
            ])
        });
        mockHistoryCollection.updateMany.mockResolvedValue({ modifiedCount: 5 });
        mockSystemsCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        mockSystemsCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

        const res = await handler({
            httpMethod: 'POST',
            path: '/.netlify/functions/systems/merge',
            headers: {},
            body: JSON.stringify({ primarySystemId: 'primary', idsToMerge: ['primary', 'other'] })
        }, {});

        expect(mockHistoryCollection.updateMany).toHaveBeenCalledWith(
            { systemId: { $in: ['other'] } },
            { $set: { systemId: 'primary', systemName: 'Primary' } }
        );

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).success).toBe(true);
    });

    test('GET /.netlify/functions/systems/:id/merged-timeline is supported', async () => {
        const res = await handler({
            httpMethod: 'GET',
            path: '/.netlify/functions/systems/sys-1/merged-timeline',
            headers: {},
            queryStringParameters: {
                startDate: '2024-01-01T00:00:00.000Z',
                endDate: '2024-01-02T00:00:00.000Z'
            }
        }, {});

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.systemId).toBe('sys-1');
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.totalPoints).toBeGreaterThan(0);
    });
});
