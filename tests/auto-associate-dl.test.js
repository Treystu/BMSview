// @ts-nocheck
const { ensureSystemAssociation } = require('../netlify/functions/analyze.cjs');

jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
    const historyUpdates = [];
    const resultUpdates = [];
    const systems = [
        { id: 'sys-1', name: 'System One', associatedDLs: ['DL123'] },
        { id: 'sys-2', name: 'System Two', associatedDLs: ['DL999'] }
    ];

    return {
        __historyUpdates: historyUpdates,
        __resultUpdates: resultUpdates,
        __systems: systems,
        getCollection: jest.fn(async (name) => {
            if (name === 'systems') {
                return {
                    find: () => ({ toArray: async () => systems })
                };
            }
            if (name === 'history') {
                return {
                    updateOne: jest.fn(async (filter, update) => {
                        historyUpdates.push({ filter, update });
                        return { matchedCount: 1 };
                    })
                };
            }
            if (name === 'analysis-results') {
                return {
                    updateOne: jest.fn(async (filter, update) => {
                        resultUpdates.push({ filter, update });
                        return { matchedCount: 1 };
                    })
                };
            }
            throw new Error(`Unknown collection ${name}`);
        })
    };
});

const { __historyUpdates, __resultUpdates } = require('../netlify/functions/utils/mongodb.cjs');

describe('ensureSystemAssociation', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    beforeEach(() => {
        __historyUpdates.length = 0;
        __resultUpdates.length = 0;
        jest.clearAllMocks();
    });

    it('associates a record when there is exactly one matching system', async () => {
        const record = { id: 'rec-1', dlNumber: 'dl123', systemId: null, analysis: { dlNumber: 'dl123' } };

        const updated = await ensureSystemAssociation(record, log);

        expect(updated.systemId).toBe('sys-1');
        expect(updated.systemName).toBe('System One');
        expect(__historyUpdates).toHaveLength(1);
        expect(__resultUpdates).toHaveLength(1);
        expect(__historyUpdates[0].filter).toEqual({ id: 'rec-1' });
        expect(__resultUpdates[0].filter).toEqual({ id: 'rec-1' });
    });

    it('does not associate when multiple systems match', async () => {
        const record = { id: 'rec-2', dlNumber: 'DL999', systemId: null, analysis: { dlNumber: 'DL999' } };

        // Add another system sharing the same DL to make it ambiguous
        const { __systems } = require('../netlify/functions/utils/mongodb.cjs');
        __systems.push({ id: 'sys-3', name: 'System Three', associatedDLs: ['dl999'] });

        const updated = await ensureSystemAssociation(record, log);

        expect(updated.systemId).toBeNull();
        expect(__historyUpdates).toHaveLength(0);
        expect(__resultUpdates).toHaveLength(0);

        // cleanup added system for other tests
        __systems.pop();
    });

    it('skips association when systemId already present', async () => {
        const record = { id: 'rec-3', dlNumber: 'DL123', systemId: 'already', analysis: { dlNumber: 'DL123' } };
        const updated = await ensureSystemAssociation(record, log);
        expect(updated.systemId).toBe('already');
        expect(__historyUpdates).toHaveLength(0);
    });
});
