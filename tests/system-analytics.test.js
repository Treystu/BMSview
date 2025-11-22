/**
 * Tests for system-analytics function
 */

const { handler } = require('../netlify/functions/system-analytics.cjs');

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

describe('system-analytics handler', () => {
  const mockContext = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 405 for non-GET requests', async () => {
    const event = {
      httpMethod: 'POST',
      queryStringParameters: { systemId: 'test-system' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(405);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Method Not Allowed');
  });

  test('returns 400 when systemId is missing', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {}
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('systemId is required');
  });

  test('returns empty analytics when no history exists', async () => {
    const mockCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([])
      })
    };
    getCollection.mockResolvedValue(mockCollection);

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { systemId: 'test-system' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.hourlyAverages).toEqual([]);
    expect(body.performanceBaseline).toBeDefined();
    expect(body.alertAnalysis).toBeDefined();
  });

  test('processes history records for analytics', async () => {
    const mockHistory = [
      {
        systemId: 'test-system',
        timestamp: new Date('2024-01-01T12:00:00Z').toISOString(),
        analysis: {
          current: 5.0,
          power: 250,
          stateOfCharge: 80,
          temperature: 25,
          overallVoltage: 51.2
        },
        weather: { clouds: 20 }
      }
    ];

    const mockCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(mockHistory)
      })
    };
    getCollection.mockResolvedValue(mockCollection);

    const event = {
      httpMethod: 'GET',
      queryStringParameters: { systemId: 'test-system' }
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.hourlyAverages).toBeDefined();
    expect(Array.isArray(body.hourlyAverages)).toBe(true);
  });
});
