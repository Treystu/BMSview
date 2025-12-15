/**
 * Comprehensive integration tests for battery insights generator
 * 
 * NOTE: These tests are integration tests that require MongoDB and Gemini API.
 * They are currently skipped for unit testing. Enable for full integration testing.
 */

const { handler: generateHandler } = require('../netlify/functions/generate-insights-with-tools.cjs');

describe.skip('Battery Insights Generator - Comprehensive Tests', () => {
  // Mock context and timer
  const mockContext = {
    awsRequestId: 'test-request-id'
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };

  const mockTimer = {
    end: jest.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    test('handles empty event object', async () => {
      const response = await generateHandler({}, mockContext);
      // Enhanced handler requires structured data and returns 400 when missing
      expect(response.statusCode).toBe(400);
    });

    test('handles null measurements', async () => {
      const event = {
        body: JSON.stringify({ measurements: null })
      };
      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(400);
    });

    test('handles malformed JSON', async () => {
      const event = {
        body: 'invalid json'
      };
      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('Data Analysis', () => {
    test('analyzes healthy battery data', async () => {
      const measurements = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 13.2,
        current: i % 2 ? 5 : -2,
        temperature: 25,
        stateOfCharge: 95 - (i * 0.5),
        capacity: 100
      }));

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(typeof body.insights.formattedText).toBe('string');
      expect(body.insights.formattedText.length).toBeGreaterThan(0);
    });

    test('analyzes degrading battery', async () => {
      const measurements = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 12.2 - (i * 0.01),
        current: i % 2 ? 3 : -4,
        temperature: 30,
        stateOfCharge: 75 - i,
        capacity: 80 - i
      }));

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(typeof body.insights.formattedText).toBe('string');
      expect(body.insights.formattedText.length).toBeGreaterThan(0);
    });

    test('analyzes high usage patterns', async () => {
      const measurements = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 12.5,
        current: i % 2 ? 15 : -10,
        temperature: 35,
        stateOfCharge: 60 - (i * 2),
        capacity: 90
      }));

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(typeof body.insights.formattedText).toBe('string');
    });
  });

  describe('Runtime Estimation', () => {
    test('calculates accurate runtime for known load', async () => {
      const measurements = Array.from({ length: 10 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 12.8,
        current: -5, // Constant 5A draw
        temperature: 25,
        stateOfCharge: 80,
        capacity: 100
      }));

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.insights.formattedText).toBeDefined();
    });

    test('handles variable loads', async () => {
      const measurements = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 12.8,
        current: i % 2 ? -3 : -7, // Alternating loads
        temperature: 25,
        stateOfCharge: 80,
        capacity: 100
      }));

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.insights.formattedText).toBeDefined();
    });
  });

  describe('Efficiency Calculation', () => {
    test('calculates charging efficiency', async () => {
      const measurements = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 13.2,
        current: i < 12 ? 10 : -5, // Charging then discharging
        temperature: 25,
        stateOfCharge: i < 12 ? 50 + (i * 4) : 98 - ((i - 12) * 4),
        capacity: 100
      }));

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.insights.formattedText).toBeDefined();
    });
  });

  test('should respect timeout in sync mode', async () => {
    const event = {
      body: JSON.stringify({ measurements: [] }),
      queryStringParameters: { sync: 'true', timeout: '100' }
    };

    // Call the handler and assert the response
    const result = await generateHandler(event, mockContext);
    expect(result.statusCode).toBe(504);
    expect(JSON.parse(result.body).error).toBe('Request timed out');
  });

  test('should handle tool execution errors gracefully', async () => {
    const event = {
      body: JSON.stringify({ measurements: [] }),
      queryStringParameters: { sync: 'true' }
    };

    // Call the handler and assert the response
    const result = await generateHandler(event, mockContext);
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('Internal Server Error');
  });
  describe('Error Handling', () => {
    test('handles missing timer gracefully', async () => {
      const event = {
        body: JSON.stringify({ measurements: [] })
      };
      const response = await generateHandler(event, {});
      expect(response.statusCode).toBe(200);
    });

    test('handles timer errors gracefully', async () => {
      const badTimer = {
        end: () => { throw new Error('Timer failed'); }
      };
      const response = await generateHandler({}, { timer: badTimer });
      // Enhanced handler requires structured input; empty event returns 400 even if timer throws
      expect(response.statusCode).toBe(400);
    });

    test('handles extremely large datasets', async () => {
      const measurements = Array.from({ length: 1000 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 13.2,
        current: 5,
        temperature: 25,
        stateOfCharge: 95,
        capacity: 100
      }));

      // Explicitly request sync mode to test error handling of large datasets
      // without requiring background job infrastructure in test environment
      const event = {
        body: JSON.stringify({ measurements }),
        queryStringParameters: { sync: 'true' }
      };

      const response = await generateHandler(event, mockContext);
      // Should handle large dataset in sync mode or return proper error
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBeDefined();
    });
  });

  describe('Custom Query Handling', () => {
    test('processes custom runtime queries', async () => {
      const measurements = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 12.8,
        current: -5,
        temperature: 25,
        stateOfCharge: 80,
        capacity: 100
      }));

      const event = {
        body: JSON.stringify({
          measurements,
          customPrompt: 'What is the current runtime at 5A draw?'
        })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.insights.formattedText).toBeDefined();
    });
  });

  describe('Data Quality Assessment', () => {
    test('assigns correct confidence levels', async () => {
      const measurements = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        voltage: 12.8 + (Math.random() * 0.4 - 0.2),
        current: -5 + (Math.random() * 2 - 1),
        temperature: 25 + (Math.random() * 4 - 2),
        stateOfCharge: 80 - (i * 0.5),
        capacity: 100
      }));

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.insights.formattedText).toBeDefined();
    });
  });
});