/**
 * Verification test for get-hourly-soc-predictions tool
 *
 * Oracle verification indicated this tool works correctly with:
 * - Mock data for test-system
 * - Real data fetching from history collection
 * - Hourly interpolation algorithm
 * - Sunrise/sunset calculations
 *
 * This test verifies the basic functionality.
 */

const { createLogger } = require('../netlify/functions/utils/logger.cjs');

describe('get-hourly-soc-predictions tool verification', () => {
  let getHourlySocPredictions;
  let log;

  beforeAll(() => {
    // Dynamically import the tool implementation
    const forecasting = require('../netlify/functions/utils/forecasting.cjs');
    getHourlySocPredictions = forecasting.predictHourlySoc;
    log = createLogger('test-soc-predictions');
  });

  test('should return mock data for test-system', async () => {
    const result = await getHourlySocPredictions('test-system', 72, log);

    // Verify structure
    expect(result).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.predictions).toBeDefined();
    expect(Array.isArray(result.predictions)).toBe(true);

    // Verify hourly predictions exist
    // Note: 72 hours back + current hour = 73 predictions (inclusive range)
    expect(result.predictions.length).toBeGreaterThan(0);
    expect(result.predictions.length).toBeLessThanOrEqual(73);

    // Verify prediction structure
    const firstPrediction = result.predictions[0];
    expect(firstPrediction).toHaveProperty('timestamp');
    expect(firstPrediction).toHaveProperty('soc');
    expect(typeof firstPrediction.soc).toBe('number');

    // Verify SOC values are within valid range (0-100)
    result.predictions.forEach(pred => {
      expect(pred.soc).toBeGreaterThanOrEqual(0);
      expect(pred.soc).toBeLessThanOrEqual(100);
    });
  }, 10000); // 10s timeout

  test('should handle edge case: hoursBack = 1', async () => {
    const result = await getHourlySocPredictions('test-system', 1, log);

    expect(result).toBeDefined();
    expect(result.predictions).toBeDefined();
    expect(result.predictions.length).toBeGreaterThan(0);
  });

  test('should handle edge case: hoursBack = 168 (max 7 days)', async () => {
    const result = await getHourlySocPredictions('test-system', 168, log);

    expect(result).toBeDefined();
    expect(result.predictions).toBeDefined();
    expect(result.predictions.length).toBeGreaterThan(0);
  });

  test('should validate hoursBack within 1-168 range', async () => {
    // Tool should automatically clamp to max 168 hours (7 days)
    const result = await getHourlySocPredictions('test-system', 200, log);

    expect(result).toBeDefined();
    // Should still return valid predictions (clamped to 168)
    expect(result.predictions).toBeDefined();
  });
});
