const { calculateRuntimeEstimate, generateGeneratorRecommendations } = require('../utils/battery-analysis.new.cjs');

describe('calculateRuntimeEstimate', () => {
    test('returns null runtime when no data', () => {
        const out = calculateRuntimeEstimate([], {});
        expect(out.runtimeHours).toBeNull();
        expect(out.confidence).toBe('low');
    });

    test('calculates hours from capacity and soc with discharge power', () => {
        const now = Date.now();
        const measurements = [
            { timestamp: now - 1000 * 60 * 60, current: -10, voltage: 48, stateOfCharge: 55 },
            { timestamp: now, current: -10, voltage: 48, stateOfCharge: 50 }
        ];
        const lastKnown = { capacityAh: 100, soc: 50, voltage: 48 };
        const out = calculateRuntimeEstimate(measurements, lastKnown);
        expect(out.runtimeHours).toBeGreaterThan(0);
        expect(out.explanation).toMatch(/Estimated from last known capacity/);
    });
});

describe('generateGeneratorRecommendations', () => {
    test('returns not recommended when no runtime', () => {
        const rec = generateGeneratorRecommendations(null, null);
        expect(Array.isArray(rec)).toBe(true);
        expect(rec[0].recommended).toBe(false);
    });

    test('recommends size when runtime and avgPower known', () => {
        const rec = generateGeneratorRecommendations(5, 2000);
        expect(rec[0].recommended).toBe(true);
        expect(rec[0].suggestedGeneratorKW).toBeGreaterThan(0);
    });
});
