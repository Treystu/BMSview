/**
 * Tests for get-ip function
 */

const { handler } = require('../netlify/functions/get-ip.cjs');

describe('get-ip handler', () => {
  test('returns IP address when header is present', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/.netlify/functions/get-ip',
      headers: {
        'x-nf-client-connection-ip': '192.168.1.1'
      }
    };
    const context = {};

    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ip).toBe('192.168.1.1');
  });

  test('returns 500 when header is missing', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/.netlify/functions/get-ip',
      headers: {}
    };
    const context = {};

    const response = await handler(event, context);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('Could not determine client IP address');
  });
});
