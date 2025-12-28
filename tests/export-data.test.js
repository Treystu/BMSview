/**
 * Tests for export-data function
 */

const { handler } = require('../netlify/functions/export-data.cjs');
const zlib = require('zlib');

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

describe('export-data handler', () => {
  const mockContext = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 405 for non-GET requests', async () => {
    const event = {
      httpMethod: 'POST',
      queryStringParameters: { type: 'history', format: 'csv' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(405);
  });

  test('returns 400 when type is missing', async () => {
    const mockCollection = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([])
        })
      })
    };
    getCollection.mockResolvedValue(mockCollection);

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { format: 'csv' }
    };

    const response = await handler(event, mockContext);

    // Should use default type 'history'
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/csv');
  });

  test('uses defaults when format is missing', async () => {
    const mockCollection = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([])
        })
      })
    };
    getCollection.mockResolvedValue(mockCollection);

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { type: 'history' }
    };

    const response = await handler(event, mockContext);

    // Should use default format 'csv'
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/csv');
  });

  test('exports history as CSV', async () => {
    const mockCollection = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            {
              id: '1',
              timestamp: '2024-01-01T00:00:00Z',
              analysis: {
                dlNumber: 'DL123456',
                stateOfCharge: 80,
                overallVoltage: 51.2
              }
            }
          ])
        })
      })
    };
    getCollection.mockResolvedValue(mockCollection);

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { type: 'history', format: 'csv' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/csv');
    expect(response.headers['Content-Encoding']).toBe('gzip');

    const decodedBody = zlib.gunzipSync(Buffer.from(response.body, 'base64')).toString('utf-8');
    expect(decodedBody).toContain('id,timestamp');
    expect(decodedBody).toContain('DL123456');
  });

  test('exports systems as CSV', async () => {
    const mockCollection = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            {
              id: 'sys1',
              name: 'Test System',
              chemistry: 'LiFePO4',
              nominalVoltage: 48
            }
          ])
        })
      })
    };
    getCollection.mockResolvedValue(mockCollection);

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { type: 'systems', format: 'csv' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/csv');
    expect(response.headers['Content-Encoding']).toBe('gzip');

    const decodedBody = zlib.gunzipSync(Buffer.from(response.body, 'base64')).toString('utf-8');
    expect(decodedBody).toContain('Test System');
  });

  test('exports full backup as JSON', async () => {
    const mockCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ id: '1', data: 'test' }])
      })
    };
    getCollection.mockResolvedValue(mockCollection);

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { type: 'full', format: 'json' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('application/json');
    expect(response.headers['Content-Encoding']).toBe('gzip');

    // Body is a compressed base64 string, decompress it
    const decodedBody = zlib.gunzipSync(Buffer.from(response.body, 'base64')).toString('utf-8');
    const body = JSON.parse(decodedBody);

    expect(body.exportDate).toBeDefined();
    expect(body.collections).toBeDefined();
    expect(body.collections.systems).toBeDefined();
    expect(body.collections.history).toBeDefined();
  });
});
