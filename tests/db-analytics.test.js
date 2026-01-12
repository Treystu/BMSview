// @ts-nocheck

const mockDb = {
    stats: jest.fn()
};

const mockHistoryCol = {
    stats: jest.fn(),
    aggregate: jest.fn()
};

const mockSystemsCol = {
    stats: jest.fn()
};

jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
    getDb: jest.fn(async () => mockDb),
    getCollection: jest.fn(async (name) => {
        if (name === 'history') return mockHistoryCol;
        if (name === 'systems') return mockSystemsCol;
        return mockHistoryCol;
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

jest.mock('../netlify/functions/utils/auth.cjs', () => ({
    ensureAdminAuthorized: jest.fn(async () => null)
}));

describe('db-analytics endpoint', () => {
    let handler;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        handler = require('../netlify/functions/db-analytics.cjs').handler;

        mockDb.stats.mockResolvedValue({
            db: 'bmsview-test',
            objects: 123,
            avgObjSize: 500,
            dataSize: 1000,
            storageSize: 2000,
            indexes: 3,
            indexSize: 250
        });

        mockHistoryCol.stats.mockResolvedValue({
            count: 10,
            size: 1000,
            avgObjSize: 100,
            storageSize: 2000,
            nindexes: 2,
            totalIndexSize: 300
        });

        mockSystemsCol.stats.mockResolvedValue({
            count: 2,
            size: 200,
            avgObjSize: 100,
            storageSize: 400,
            nindexes: 1,
            totalIndexSize: 50
        });

        mockHistoryCol.aggregate.mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
                { _id: 'analysis', totalSize: 1000, count: 10, avgSize: 100 },
                { _id: 'timestamp', totalSize: 200, count: 10, avgSize: 20 }
            ])
        });
    });

    test('GET mode=summary returns db + collections stats', async () => {
        const res = await handler({
            httpMethod: 'GET',
            path: '/.netlify/functions/db-analytics',
            headers: {},
            queryStringParameters: { mode: 'summary', collection: 'history' }
        }, {});

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);

        expect(body.mode).toBe('summary');
        expect(body.stats).toBeDefined();
        expect(body.stats.db).toBeDefined();
        expect(body.stats.collections).toBeDefined();
        expect(body.stats.collections.history).toBeDefined();
        expect(body.stats.collections.systems).toBeDefined();

        // Proves we call db.stats via getDb() (not via collection internals)
        const { getDb } = require('../netlify/functions/utils/mongodb.cjs');
        expect(getDb).toHaveBeenCalled();
        expect(mockDb.stats).toHaveBeenCalled();
    });

    test('GET mode=full returns fieldAnalysis[] with percentages', async () => {
        const res = await handler({
            httpMethod: 'GET',
            path: '/.netlify/functions/db-analytics',
            headers: {},
            queryStringParameters: { mode: 'full', collection: 'history' }
        }, {});

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);

        expect(body.mode).toBe('full');
        expect(Array.isArray(body.fieldAnalysis)).toBe(true);
        expect(body.fieldAnalysis.length).toBeGreaterThan(0);

        const first = body.fieldAnalysis[0];
        expect(first.field).toBeDefined();
        expect(first.totalSizeHuman).toBeDefined();
        expect(typeof first.percentageOfData).toBe('string');
        expect(first.percentageOfData).toMatch(/%$/);
    });

    test('GET mode=deep returns deepAnalysis[] when collection=history', async () => {
        mockHistoryCol.aggregate.mockReturnValueOnce({
            toArray: jest.fn().mockResolvedValue([
                { _id: 'analysis.someField', totalSize: 123, count: 10 }
            ])
        });

        const res = await handler({
            httpMethod: 'GET',
            path: '/.netlify/functions/db-analytics',
            headers: {},
            queryStringParameters: { mode: 'deep', collection: 'history' }
        }, {});

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);

        expect(body.mode).toBe('deep');
        expect(Array.isArray(body.deepAnalysis)).toBe(true);
        expect(body.deepAnalysis[0].field).toBe('analysis.someField');
    });
});
