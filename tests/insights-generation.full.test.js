/*
 Full insights generation integration-style tests (standard handler)
*/

const { generateHandler } = require('../netlify/functions/generate-insights.cjs');

const createBatteryData = (n = 100) => {
  const base = { systemId: 's1', measurements: [] };
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    base.measurements.push({ timestamp: new Date(now - (n - i) * 1000 * 60).toISOString(), capacity: 100 - i * 0.1, energyIn: 100 + i, energyOut: 95 + i });
  }
  return base;
};

describe('generate-insights full scenarios (standard handler)', () => {
  test('healthy dataset returns success and insight text', async () => {
    const data = createBatteryData(50);
    const res = await generateHandler({ body: JSON.stringify(data) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.insights.formattedText).toBe('string');
    expect(body.insights.formattedText.length).toBeGreaterThan(0);
  });

  test('empty measurements returns formatted insights', async () => {
    const res = await generateHandler({ body: JSON.stringify({ systemId: 'x', batteryData: { measurements: [] } }) });
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body);
    expect(typeof b.insights.formattedText).toBe('string');
  });

  test('malformed null batteryData returns 400', async () => {
    const res = await generateHandler({ body: JSON.stringify({ batteryData: null }) });
    expect(res.statusCode).toBe(400);
  });
});
