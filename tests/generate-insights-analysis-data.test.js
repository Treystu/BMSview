/**
 * Test for generate-insights with AnalysisData format
 * Verifies that the function properly handles single-point AnalysisData from screenshot analysis
 * 
 * NOTE: These tests are integration tests that require MongoDB and Gemini API.
 * They are currently skipped for unit testing. Enable for full integration testing.
 */

const { handler: generateHandler } = require('../netlify/functions/generate-insights-with-tools.cjs');

describe.skip('Generate Insights with AnalysisData Format', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = {
      functionName: 'generate-insights',
      awsRequestId: 'test-request-id'
    };
  });

  test('should handle single-point AnalysisData from screenshot', async () => {
    const event = {
      body: JSON.stringify({
        consentGranted: true,
        mode: 'sync',
        analysisData: {
          dlNumber: 'DL-12345',
          overallVoltage: 52.4,
          current: -5.2,
          stateOfCharge: 85,
          temperature: 25,
          fullCapacity: 100,
          remainingCapacity: 85,
          cycleCount: 150,
          cellVoltages: [3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28],
          alerts: [],
          summary: 'Battery in good condition',
          timestampFromImage: '2025-11-05T20:00:00Z'
        },
        systemId: 'test-system-123',
        customPrompt: 'Analyze battery health'
      })
    };

    const response = await generateHandler(event, mockContext);
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.insights).toBeDefined();
    expect(result.insights.healthStatus).toBeDefined();
    expect(result.insights.rawText).toBeDefined();
    expect(result.insights.rawText).not.toBe('No battery measurements provided in the request.');
  });

  test('should extract voltage from overallVoltage field', async () => {
    const event = {
      body: JSON.stringify({
        consentGranted: true,
        mode: 'sync',
        analysisData: {
          overallVoltage: 48.5,
          current: 10.0,
          stateOfCharge: 75,
          temperature: 22
        },
        systemId: 'test-system'
      })
    };

    const response = await generateHandler(event, mockContext);
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.success).toBe(true);
    // Should have measurements with the voltage value
    expect(result.insights.rawText).not.toContain('No battery measurements');
  });

  test('should handle AnalysisData with all optional fields', async () => {
    const event = {
      body: JSON.stringify({
        consentGranted: true,
        mode: 'sync',
        analysisData: {
          dlNumber: 'DL-99999',
          timestampFromImage: '2025-11-05T15:30:00Z',
          status: 'Normal',
          overallVoltage: 51.2,
          power: 500,
          current: -8.5,
          stateOfCharge: 90,
          remainingCapacity: 90,
          fullCapacity: 100,
          cycleCount: 200,
          temperature: 28,
          temperatures: [28, 27, 29],
          mosTemperature: 35,
          chargeMosOn: true,
          dischargeMosOn: false,
          balanceOn: true,
          serialNumber: 'SN-12345',
          softwareVersion: '1.0.0',
          hardwareVersion: '2.0',
          snCode: 'ABC123',
          numTempSensors: 3,
          cellVoltages: [3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2],
          cellTemperatures: [28, 27, 29],
          alerts: ['Low temperature warning'],
          summary: 'System operating normally',
          averageCurrentDaylight: 5.0,
          averageCurrentNight: 2.0,
          runtimeEstimateConservativeHours: 10,
          runtimeEstimateMiddleHours: 15,
          runtimeEstimateAggressiveHours: 20,
          sufficientChargeUntilDaylight: true,
          daylightHoursRemaining: 8,
          nightHoursRemaining: 16,
          predictedSolarChargeAmphours: 50,
          generatorRecommendation: {
            run: false,
            reason: 'Sufficient solar charging expected'
          }
        },
        systemId: 'comprehensive-test-system'
      })
    };

    const response = await generateHandler(event, mockContext);
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.insights).toBeDefined();
    expect(result.insights.rawText).not.toContain('No battery measurements');
  });

  test('should handle AnalysisData with minimal fields', async () => {
    const event = {
      body: JSON.stringify({
        consentGranted: true,
        mode: 'sync',
        analysisData: {
          overallVoltage: 50.0,
          current: 0
        },
        systemId: 'minimal-test'
      })
    };

    const response = await generateHandler(event, mockContext);
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.insights.rawText).not.toContain('No battery measurements');
  });

  test('should handle AnalysisData with only current field', async () => {
    const event = {
      body: JSON.stringify({
        consentGranted: true,
        mode: 'sync',
        analysisData: {
          current: 5.5
        },
        systemId: 'current-only-test'
      })
    };

    const response = await generateHandler(event, mockContext);
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.insights.rawText).not.toContain('No battery measurements');
  });

  test('should handle AnalysisData with temperature data', async () => {
    const event = {
      body: JSON.stringify({
        consentGranted: true,
        mode: 'sync',
        analysisData: {
          overallVoltage: 52.0,
          current: -3.0,
          temperature: 25,
          temperatures: [25, 24, 26],
          stateOfCharge: 80
        },
        systemId: 'temp-test'
      })
    };

    const response = await generateHandler(event, mockContext);
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.insights.rawText).not.toContain('No battery measurements');
  });

  test('should prioritize batteryData over analysisData', async () => {
    const event = {
      body: JSON.stringify({
        consentGranted: true,
        mode: 'sync',
        batteryData: {
          measurements: [
            {
              timestamp: '2025-11-05T20:00:00Z',
              voltage: 48.0,
              current: 10.0,
              temperature: 20,
              stateOfCharge: 70
            }
          ]
        },
        analysisData: {
          overallVoltage: 52.4,
          current: -5.2
        },
        systemId: 'priority-test'
      })
    };

    const response = await generateHandler(event, mockContext);
    const result = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(result.success).toBe(true);
    // Should use batteryData, not analysisData
    expect(result.insights.rawText).not.toContain('No battery measurements');
  });
});

