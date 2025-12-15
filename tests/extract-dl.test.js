/**
 * Tests for extract-dl function
 */

const { handler } = require('../netlify/functions/extract-dl.cjs');

describe('extract-dl handler', () => {
  const mockContext = {};

  test('extracts DL numbers from text', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': '127.0.0.1' },
      body: JSON.stringify({
        text: 'Battery system DL123456 is operational. Also found DL-234567.'
      })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.dlNumbers).toContain('123456');
    expect(body.dlNumbers).toContain('234567');
    expect(body.count).toBe(2);
  });

  test('handles text with no DL numbers', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': '127.0.0.1' },
      body: JSON.stringify({
        text: 'No battery identifiers here'
      })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.dlNumbers).toEqual([]);
    expect(body.count).toBe(0);
  });

  test('returns 405 for non-POST requests', async () => {
    const event = {
      httpMethod: 'GET',
      headers: { 'x-nf-client-connection-ip': '127.0.0.1' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(405);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Method Not Allowed');
  });

  test('returns 400 for missing text field', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': '127.0.0.1' },
      body: JSON.stringify({})
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('Missing or invalid text field');
  });

  test('handles various DL formats', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': '127.0.0.1' },
      body: JSON.stringify({
        text: 'Found DL 345678, DL:456789, and DL-567890'
      })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.count).toBeGreaterThan(0);
  });

  test('handles OCR noise and spacing while avoiding false matches', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': '127.0.0.1' },
      body: JSON.stringify({
        text: 'DL 123 456 appears with spaces, Driver License: 987-654 has a dash, but code AB765432 should not match.'
      })
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.dlNumbers).toContain('123456');
    expect(body.dlNumbers).toContain('987654');
    expect(body.count).toBe(2);
    expect(body.dlNumbers).not.toContain('765432');
  });
});
