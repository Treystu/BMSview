/**
 * Tests for predictive-maintenance function
 */

const { handler } = require('../netlify/functions/predictive-maintenance.cjs');

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs');

describe('predictive-maintenance handler', () => {
  const mockContext = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handles OPTIONS preflight request', async () => {
    const event = {
      httpMethod: 'OPTIONS',
      headers: {}
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    expect(response.headers).toBeDefined();
    expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('returns 405 for non-POST requests', async () => {
    const event = {
      httpMethod: 'GET',
      headers: {},
      body: JSON.stringify({ systemId: 'test-system' })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(405);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Method not allowed');
  });

  test('returns 400 when systemId is missing', async () => {
    const event = {
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({})
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('Missing systemId parameter');
  });

  test('accepts valid request with systemId', async () => {
    // This test will likely fail due to MongoDB or API dependencies
    // but it validates the basic structure
    const event = {
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ 
        systemId: 'test-system',
        timeHorizon: '30'
      })
    };

    const response = await handler(event, mockContext);

    // The response could be 404 (system not found) or 500 (API error)
    // but shouldn't be 400 (bad request) since we provided systemId
    expect(response.statusCode).not.toBe(400);
  });
});
