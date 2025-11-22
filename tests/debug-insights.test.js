/**
 * Tests for debug-insights function
 */

const { handler } = require('../netlify/functions/debug-insights.cjs');

describe('debug-insights handler', () => {
  const mockContext = {};

  test('returns debug information for valid request', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        analysisData: {
          measurements: [{ value: 1 }]
        }
      })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.debug).toBeDefined();
    expect(body.debug.requestMethod).toBe('POST');
    expect(body.recommendations).toBeDefined();
  });

  test('handles request with no body', async () => {
    const event = {
      httpMethod: 'GET',
      headers: {}
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.debug.bodyKeys).toEqual([]);
  });

  test('provides recommendations for missing data', async () => {
    const event = {
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({})
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.recommendations).toBeDefined();
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations[0]).toContain('analysisData');
  });

  test('analyzes nested object structure', async () => {
    const event = {
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        nested: {
          level1: {
            level2: { value: 'test' }
          }
        }
      })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.debug.bodyStructure).toBeDefined();
    expect(body.debug.bodyStructure.nested).toBeDefined();
  });

  test('handles arrays in structure analysis', async () => {
    const event = {
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        measurements: [1, 2, 3]
      })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.debug.bodyStructure.measurements).toBe('Array(3)');
  });

  test('handles invalid JSON gracefully', async () => {
    const event = {
      httpMethod: 'POST',
      headers: {},
      body: 'invalid json'
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBeDefined();
  });
});
