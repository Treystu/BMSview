const { buildCompleteContext } = require('../netlify/functions/utils/full-context-builder.cjs');

// Mock the mongo helper used by full-context-builder
jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
    return {
        getCollection: jest.fn(async () => {
            // Dynamic dates relative to now to ensure they fall within the 30-day window
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

            const docs = [
                // top-level systemId + ISO timestamp
                {
                    _id: '1',
                    systemId: 'sys1',
                    timestamp: oneDayAgo.toISOString(),
                    analysis: { overallVoltage: 52.1 }
                },
                // top-level systemId + Date timestamp
                {
                    _id: '2',
                    systemId: 'sys1',
                    timestamp: twoDaysAgo,
                    analysis: { overallVoltage: 52.2 }
                },
                // nested analysis.systemId + ISO timestamp
                {
                    _id: '3',
                    analysis: { systemId: 'sys1', overallVoltage: 52.3 },
                    timestamp: oneDayAgo.toISOString()
                },
                // nested analysis.systemId + Date timestamp
                {
                    _id: '4',
                    analysis: { systemId: 'sys1', overallVoltage: 52.4 },
                    timestamp: twoDaysAgo
                },
                // other system, should not match
                {
                    _id: '5',
                    systemId: 'sys2',
                    timestamp: oneDayAgo.toISOString(),
                    analysis: { overallVoltage: 48.0 }
                }
            ];

            /**
             * @param {string|Date} ts
             * @param {string|Date} start
             * @param {string|Date} end
             */
            function inRange(ts, start, end) {
                const t = new Date(ts).getTime();
                const s = new Date(start).getTime();
                const e = new Date(end).getTime();
                return t >= s && t <= e;
            }

            return {
                find: jest.fn((query) => {
                    const orFilters = query?.$or || [];
                    const timestampFilter = query.timestamp;

                    const matched = docs.filter((d) => {
                        // Check if document matches the $or condition
                        const matchesOr = orFilters.length === 0 || orFilters.some((/** @type {any} */ f) => {
                            return (f.systemId && d.systemId === f.systemId) ||
                                (f['analysis.systemId'] && d.analysis && d.analysis.systemId === f['analysis.systemId']);
                        });

                        if (!matchesOr) return false;

                        // Check if document matches the timestamp condition
                        if (timestampFilter && timestampFilter.$gte && timestampFilter.$lte) {
                            return inRange(d.timestamp, timestampFilter.$gte, timestampFilter.$lte);
                        }

                        return true;
                    });

                    const chain = {
                        sort: jest.fn(() => chain),
                        limit: jest.fn(() => chain),
                        toArray: jest.fn(async () => matched)
                    };
                    return chain;
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
    return {
        createLogger: () => ({
            info: console.log,
            warn: console.warn,
            error: console.error,
            debug: console.log,
            entry: console.log,
            exit: console.log
        })
    };
});

describe('full-context-builder timestamp compatibility', () => {
    test('includes docs with timestamp stored as string or Date across legacy/nested schemas', async () => {
        const ctx = /** @type {any} */ (await buildCompleteContext('sys1', { contextWindowDays: 30 }));
        expect(ctx.raw.totalDataPoints).toBe(4);
        expect(ctx.raw.allVoltageReadings.filter((/** @type {any} */ r) => r.voltage != null).length).toBe(4);
    });
});
