const { generateHandler } = require('../netlify/functions/generate-insights.cjs');

describe('Battery Insights Generator - Comprehensive Tests', () => {
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
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.insights.healthStatus).toBe('Unknown');
    });

    test('handles null measurements', async () => {
      const event = {
        body: JSON.stringify({ measurements: null })
      };
      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.insights.healthStatus).toBe('Unknown');
    });

    test('handles malformed JSON', async () => {
      const event = {
        body: 'invalid json'
      };
      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.insights.healthStatus).toBe('Unknown');
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
      expect(body.insights.healthStatus).toMatch(/excellent|good/i);
      expect(body.insights.performance.capacityRetention).toBeGreaterThan(90);
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
      expect(body.insights.healthStatus).toMatch(/poor|critical/i);
      expect(body.insights.recommendations.length).toBeGreaterThan(0);
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
      expect(body.insights.performance.analysis.usageIntensity).toBe('high');
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
      expect(body.insights.performance.estimatedRuntime).toBeDefined();
      expect(body.insights.performance.estimatedRuntime.atCurrentDraw).toMatch(/hours|minutes/);
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
      expect(body.insights.performance.estimatedRuntime).toBeDefined();
      expect(body.insights.performance.estimatedRuntime.atAverageUse).toBeDefined();
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
      expect(body.insights.efficiency.chargeEfficiency).toBeGreaterThan(0);
      expect(body.insights.efficiency.cyclesAnalyzed).toBeGreaterThan(0);
    });
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
      expect(response.statusCode).toBe(200);
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

      const event = {
        body: JSON.stringify({ measurements })
      };

      const response = await generateHandler(event, mockContext);
      expect(response.statusCode).toBe(413);
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
      expect(body.insights.queryResponse).toBeDefined();
      expect(body.insights.queryResponse.answer).toBeDefined();
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
      expect(body.insights.metadata.confidence).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(body.insights.metadata.confidence);
    });
  });
});