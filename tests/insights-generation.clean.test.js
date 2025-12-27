/**
 * Real-world scenario testing for insights generation
 * Using the standard generate-insights handler
 * 
 * NOTE: These tests are integration tests that require MongoDB and Gemini API
 * to be available. They are currently skipped for unit testing. Enable them
 * for full integration testing with real services.
 */

const { handler: generateHandler } = require('../netlify/functions/generate-insights-with-tools.cjs');

// Mock `applyRateLimit` to simple allow
jest.mock('../netlify/functions/utils/rate-limiter.cjs', () => ({
  applyRateLimit: jest.fn().mockResolvedValue({ remaining: 10, limit: 100 }),
  RateLimitError: class RateLimitError extends Error { }
}));

// Mock `executeReActLoop`
jest.mock('../netlify/functions/utils/react-loop.cjs', () => ({
  executeReActLoop: jest.fn().mockResolvedValue({
    success: true,
    finalAnswer: "Mocked Battery Insights",
    turns: 1,
    toolCalls: 0,
    contextSummary: {}
  })
}));

describe('generate-insights handler', () => {
  test('returns 200 and produces insights for empty measurements', async () => {
    const event = {
      body: JSON.stringify({ systemId: 't1', consentGranted: true, batteryData: { measurements: [] } }),
      queryStringParameters: { sync: 'true' }
    };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.insights.formattedText).toBeDefined();
  });

  test('returns 500 for explicit null batteryData', async () => {
    const event = { body: JSON.stringify({ systemId: 't1', consentGranted: true, batteryData: null }) };
    const res = await generateHandler(event);
    // Enhanced handler returns 400 for invalid structure
    expect(res.statusCode).toBe(400);
  });

  test('analyzes simple healthy dataset', async () => {
    const data = { systemId: 't2', consentGranted: true, batteryData: { measurements: [{ capacity: 100 }, { capacity: 95 }] } };
    const event = {
      body: JSON.stringify(data),
      queryStringParameters: { sync: 'true' }
    };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.insights.formattedText).toBe('string');
    expect(body.insights.formattedText.length).toBeGreaterThan(0);
  });

  test('handles wrapped battery measurements', async () => {
    const event = {
      body: JSON.stringify({
        systemId: 't3',
        consentGranted: true,
        batteryData: {
          measurements: [
            { capacity: 100, energyIn: 1000 },
            { capacity: 98, energyOut: 900 }
          ]
        }
      }),
      queryStringParameters: { sync: 'true' }
    };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.insights.formattedText).toBeDefined();
  });
});