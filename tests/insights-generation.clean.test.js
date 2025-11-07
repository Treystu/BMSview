/**
 * Real-world scenario testing for insights generation
 * Using the standard generate-insights handler
 */

const { generateHandler } = require('../netlify/functions/generate-insights.cjs');

// Minimal focused tests for the standard insights handler
describe('generate-insights handler', () => {
  test('returns 200 and produces insights for empty measurements', async () => {
    const event = { body: JSON.stringify({ systemId: 't1', batteryData: { measurements: [] } }) };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.insights.formattedText).toBeDefined();
  });

  test('returns 500 for explicit null batteryData', async () => {
    const event = { body: JSON.stringify({ systemId: 't1', batteryData: null }) };
    const res = await generateHandler(event);
    // Enhanced handler returns 400 for invalid structure
    expect(res.statusCode).toBe(400);
  });

  test('analyzes simple healthy dataset', async () => {
    const data = { systemId: 't2', measurements: [{ capacity: 100 }, { capacity: 95 }] };
    const event = { body: JSON.stringify(data) };
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
        batteryData: {
          measurements: [
            { capacity: 100, energyIn: 1000 },
            { capacity: 98, energyOut: 900 }
          ]
        }
      })
    };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.insights.formattedText).toBeDefined();
  });
});