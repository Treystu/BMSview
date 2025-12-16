const { buildCompleteContext } = require('../netlify/functions/utils/full-context-builder.cjs');

// Mock the mongo helper used by full-context-builder
jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
    return {
        getCollection: jest.fn(async () => {
            // Minimal in-memory collection mock
            const docs = [
                // top-level systemId + ISO timestamp
                {
                    systemId: 'sys1',
                    timestamp: '2025-12-10T00:00:00.000Z',
                    analysis: { overallVoltage: 52.1 }
                },
                // top-level systemId + Date timestamp
                {
                    systemId: 'sys1',
                    timestamp: new Date('2025-12-11T00:00:00.000Z'),
                    analysis: { overallVoltage: 52.2 }
                },
                // nested analysis.systemId + ISO timestamp
                {
                    analysis: { systemId: 'sys1', overallVoltage: 52.3 },
                    timestamp: '2025-12-12T00:00:00.000Z'
                },
                // nested analysis.systemId + Date timestamp
                {
                    analysis: { systemId: 'sys1', overallVoltage: 52.4 },
                    timestamp: new Date('2025-12-13T00:00:00.000Z')
                },
                // other system, should not match
                {
                    systemId: 'sys2',
                    timestamp: '2025-12-12T00:00:00.000Z',
                    analysis: { overallVoltage: 48.0 }
                }
            ];

            /**
             * @param {string|Date} ts
             * @param {string|Date} start
             * @param {string|Date} end
             */
            function inRange(ts, start, end) {
                if (ts instanceof Date) {
                    if (!(start instanceof Date) || !(end instanceof Date)) return false;
                    return ts >= start && ts <= end;
                }
                if (typeof ts === 'string') {
                    if (typeof start !== 'string' || typeof end !== 'string') return false;
                    return ts >= start && ts <= end;
                }
                return false;
            }

            return {
                find: jest.fn((query) => {
                    const orFilters = query?.$or || [];
                    const matched = docs.filter((d) => {
                        return orFilters.some((/** @type {any} */ f) => {
                            const sysOk =
                                (f.systemId && d.systemId === f.systemId) ||
                                (f['analysis.systemId'] && d.analysis && d.analysis.systemId === f['analysis.systemId']);
                            if (!sysOk) return false;

                            const tsFilter = f.timestamp;
                            if (!tsFilter || !tsFilter.$gte || !tsFilter.$lte) return false;
                            return inRange(d.timestamp, tsFilter.$gte, tsFilter.$lte);
                        });
                    });

                    return {
                        sort: jest.fn(() => ({
                            toArray: jest.fn(async () => matched)
                        })),
                        toArray: jest.fn(async () => matched)
                    };
                }),
                aggregate: jest.fn(() => {
                    // Force agg to return nulls so builder uses the manual-scan fallback
                    return {
                        toArray: jest.fn(async () => [{ minDate: null, maxDate: null }])
                    };
                })
            };
        })
    };
});

jest.mock('../netlify/functions/utils/logger.cjs', () => {
    const noop = () => { };
    return {
        createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop })
    };
});

describe('full-context-builder timestamp compatibility', () => {
    test('includes docs with timestamp stored as string or Date across legacy/nested schemas', async () => {
        const ctx = /** @type {any} */ (await buildCompleteContext('sys1', { contextWindowDays: 30 }));
        expect(ctx.raw.totalDataPoints).toBe(4);
        expect(ctx.raw.allVoltageReadings.filter((/** @type {any} */ r) => r.voltage != null).length).toBe(4);
    });
});
