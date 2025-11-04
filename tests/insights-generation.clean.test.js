/**
 * Real-world scenario testing for insights generation
 */

const { generateHandler } = require('../netlify/functions/generate-insights.clean.cjs');

// Minimal focused tests for the clean insights handler
describe('generate-insights clean handler', () => {
  test('returns 200 and Unknown for empty measurements', async () => {
    const event = { body: JSON.stringify({ systemId: 't1', batteryData: { measurements: [] } }) };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.insights.performance.trend).toBe('Unknown');
  });

  test('returns 500 for explicit null batteryData', async () => {
    const event = { body: JSON.stringify({ systemId: 't1', batteryData: null }) };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(500);
  });

  test('analyzes simple healthy dataset', async () => {
    const data = { systemId: 't2', measurements: [ { capacity: 100 }, { capacity: 95 } ] };
    const event = { body: JSON.stringify(data) };
    const res = await generateHandler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.insights.performance.capacityRetention).toBeGreaterThan(90);
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
    expect(body.insights.performance.trend).toBe('Excellent');
    expect(body.insights.efficiency.chargeEfficiency).toBeGreaterThan(0);
  });
});