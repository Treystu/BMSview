const { generateHandler } = require('../netlify/functions/generate-insights.cjs');

// Converted to a Jest smoke test to avoid running side-effectful scripts during test runs

describe('generate-insights smoke', () => {
  test('exports generateHandler function', () => {
    expect(typeof generateHandler).toBe('function');
  });
});
