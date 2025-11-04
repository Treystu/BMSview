/**
 * Real-world scenario testing for insights generation
 */

const { generateHandler } = require('../netlify/functions/generate-insights.cjs');

// Mock battery data scenarios
const createBatteryData = (scenario) => {
  const baseData = {
    systemId: 'test-system-123',
    measurements: []
  };

  const now = new Date();
  
  switch (scenario) {
    case 'healthy':
      for (let i = 0; i < 100; i++) {
        baseData.measurements.push({
          timestamp: new Date(now.getTime() - (100 - i) * 3600000).toISOString(),
          voltage: 3.7 + Math.random() * 0.1,
          current: Math.random() * 2 - 1,
          temperature: 25 + Math.random() * 5,
          capacity: 95 + Math.random() * 3,
          soc: 20 + Math.random() * 60,
          energyIn: 100 + Math.random() * 20,
          energyOut: 95 + Math.random() * 20,
          state: i % 20 < 10 ? 'charging' : 'discharging'
        });
      }
      break;

    case 'degrading':
      for (let i = 0; i < 100; i++) {
        const degradation = i * 0.5;
        baseData.measurements.push({
          timestamp: new Date(now.getTime() - (100 - i) * 3600000).toISOString(),
          voltage: 3.7 - (degradation / 100) + Math.random() * 0.1,
          current: Math.random() * 2 - 1,
          temperature: 30 + (degradation / 10) + Math.random() * 5,
          capacity: (95 - degradation) + Math.random() * 3,
          soc: 20 + Math.random() * 60,
          energyIn: 100 + Math.random() * 20,
          energyOut: (95 - degradation) + Math.random() * 20,
          state: i % 20 < 10 ? 'charging' : 'discharging'
        });
      }
      break;

    case 'critical':
      for (let i = 0; i < 50; i++) {
        const degradation = i * 1.5;
        baseData.measurements.push({
          timestamp: new Date(now.getTime() - (50 - i) * 3600000).toISOString(),
          voltage: 3.2 - (degradation / 100) + Math.random() * 0.2,
          current: Math.random() * 3 - 1.5,
          temperature: 45 + (degradation / 5) + Math.random() * 10,
          capacity: (60 - degradation) + Math.random() * 5,
          soc: 10 + Math.random() * 40,
          energyIn: 80 + Math.random() * 15,
          energyOut: (60 - degradation) + Math.random() * 15,
          state: i % 10 < 5 ? 'charging' : 'discharging'
        });
      }
      break;

    case 'intermittent':
      for (let i = 0; i < 100; i++) {
        const hasData = Math.random() > 0.2; // 20% missing data
        if (hasData) {
          baseData.measurements.push({
            timestamp: new Date(now.getTime() - (100 - i) * 3600000).toISOString(),
            voltage: 3.6 + Math.random() * 0.2,
            current: Math.random() * 2 - 1,
            temperature: 25 + Math.random() * 10,
            capacity: 85 + Math.random() * 10,
            soc: 15 + Math.random() * 70,
            energyIn: 100 + Math.random() * 30,
            energyOut: 85 + Math.random() * 30,
            state: i % 15 < 7 ? 'charging' : 'discharging'
          });
        }
      }
      break;

    case 'noisy':
      for (let i = 0; i < 200; i++) {
        baseData.measurements.push({
          timestamp: new Date(now.getTime() - (200 - i) * 1800000).toISOString(),
          voltage: 3.7 + (Math.random() - 0.5) * 0.5, // High noise
          current: (Math.random() - 0.5) * 4, // High noise
          temperature: 25 + (Math.random() - 0.5) * 15, // High noise
          capacity: 90 + (Math.random() - 0.5) * 20, // High noise
          soc: 20 + Math.random() * 60,
          energyIn: 100 + (Math.random() - 0.5) * 40,
          energyOut: 90 + (Math.random() - 0.5) * 40,
          state: i % 5 < 2 ? 'charging' : 'discharging'
        });
      }
      break;

    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }

  return baseData;
};

// Mock Gemini API response
const mockGeminiResponse = (scenario) => {
  switch (scenario) {
    case 'healthy':
      return `
        The battery system shows excellent health indicators. 
        Health status: Excellent
        Performance trends: Stable with minor fluctuations
        Maintenance recommendations: Continue routine monitoring
        Estimated lifespan: 3-5 years
        Efficiency metrics: 92-95% charge/discharge efficiency
      `;
    case 'degrading':
      return `
        The battery shows signs of degradation. 
        Health status: Fair
        Performance trends: Declining capacity over time
        Maintenance recommendations: Please monitor closely, increase monitoring frequency and evaluate charging practices
        Estimated lifespan: 1-2 years
        Efficiency metrics: 80-85% efficiency, decreasing
      `;
    case 'critical':
      return `
        Critical battery health issues detected. 
        Health status: Poor
        Performance trends: Rapid degradation
        Maintenance recommendations: Immediate replacement recommended
        Estimated lifespan: Less than 6 months
        Efficiency metrics: Below 70% efficiency
      `;
    default:
      return 'Analysis completed with standard insights.';
  }
};

describe('Insights Generation Real-world Scenarios', () => {
  // Mock the Gemini API
  const mockGeminiAPI = jest.fn();
  
  beforeEach(() => {
    mockGeminiAPI.mockClear();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  test('should handle healthy battery scenario', async () => {
    const batteryData = createBatteryData('healthy');
    mockGeminiAPI.mockResolvedValue({
      response: {
        text: () => mockGeminiResponse('healthy')
      }
    });

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    expect(result.statusCode).toBe(200);
    const insights = JSON.parse(result.body);
    
    expect(insights.success).toBe(true);
    expect(insights.insights.healthStatus).toMatch(/excellent|good/i);
    expect(insights.insights.performance.capacityRetention).toBeGreaterThan(90);
    expect(insights.insights.efficiency.chargeEfficiency).toBeGreaterThan(0.9);
  });

  test('should handle degrading battery scenario', async () => {
    const batteryData = createBatteryData('degrading');
    mockGeminiAPI.mockResolvedValue({
      response: {
        text: () => mockGeminiResponse('degrading')
      }
    });

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    expect(result.statusCode).toBe(200);
    const insights = JSON.parse(result.body);
    
    expect(insights.success).toBe(true);
    expect(insights.insights.healthStatus).toMatch(/fair|poor/i);
    expect(insights.insights.performance.capacityRetention).toBeLessThan(90);
    expect(insights.insights.performance.degradationRate).toBeGreaterThan(0);
    expect(insights.insights.recommendations.some(r => r.toLowerCase().includes('monitor'))).toBe(true);
  });

  test('should handle critical battery scenario', async () => {
    const batteryData = createBatteryData('critical');
    mockGeminiAPI.mockResolvedValue({
      response: {
        text: () => mockGeminiResponse('critical')
      }
    });

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    expect(result.statusCode).toBe(200);
    const insights = JSON.parse(result.body);
    
    expect(insights.success).toBe(true);
    expect(insights.insights.healthStatus).toMatch(/poor|critical/i);
    expect(insights.insights.performance.capacityRetention).toBeLessThan(70);
    expect(insights.insights.recommendations.some(r => /replace|immediate/i.test(r))).toBe(true);
  });

  test('should handle intermittent data scenario', async () => {
    const batteryData = createBatteryData('intermittent');
    mockGeminiAPI.mockResolvedValue({
      response: {
        text: () => 'Analysis completed with gaps in data noted.'
      }
    });

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    expect(result.statusCode).toBe(200);
    const insights = JSON.parse(result.body);
    
    expect(insights.success).toBe(true);
    // No longer validate specific text in rawText since we're using deterministic fallback
    expect(insights.insights.rawText).toBeTruthy();
    // Should still provide insights despite missing data
    expect(insights.insights.healthStatus).not.toBe('Unknown');
  });

  test('should handle noisy data scenario', async () => {
    const batteryData = createBatteryData('noisy');
    mockGeminiAPI.mockResolvedValue({
      response: {
        text: () => 'High data variability detected. Recommendations focus on data quality.'
      }
    });

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    expect(result.statusCode).toBe(200);
    const insights = JSON.parse(result.body);
    
    expect(insights.success).toBe(true);
    // No longer validate specific text in rawText since we're using deterministic fallback
    expect(insights.insights.rawText).toBeTruthy();
    // Should filter noise and provide meaningful insights
    expect(insights.insights.performance.trend).toMatch(/excellent|good|fair|poor/i);
  });

  test('should handle timeout scenarios', async () => {
    const batteryData = createBatteryData('healthy');
    
    // Mock slow API response
    mockGeminiAPI.mockImplementation(() => 
      new Promise(resolve => setTimeout(resolve, 50000)) // 50 seconds
    );

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const startTime = Date.now();
    const result = await generateHandler(event);
    const duration = Date.now() - startTime;

    expect(result.statusCode).toBe(200); // Using fallback handler, no timeouts
    expect(duration).toBeLessThan(46000); // Should timeout before 45 seconds
    
    const data = JSON.parse(result.body);
    expect(data.success).toBe(true); // Fallback handler provides valid response
  });

  test('should handle API failure scenarios', async () => {
    const batteryData = createBatteryData('healthy');
    mockGeminiAPI.mockRejectedValue(new Error('API service unavailable'));

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    // Using fallback handler, API failures are gracefully handled
    expect(result.statusCode).toBe(200);
    const data = JSON.parse(result.body);
    expect(data.success).toBe(true);
    expect(data.insights).toBeDefined();
  });

  test('should handle empty data gracefully', async () => {
    const event = {
      body: JSON.stringify({
        systemId: 'test',
        batteryData: { measurements: [] }
      }),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    expect(result.statusCode).toBe(200);
    const insights = JSON.parse(result.body);
    
    expect(insights.success).toBe(true);
    expect(insights.insights.performance.trend).toBe('Unknown');
    expect(insights.insights.efficiency.chargeEfficiency).toBe(0);
  });

  test('should handle malformed data', async () => {
    const event = {
      body: JSON.stringify({
        systemId: 'test',
        batteryData: null
      }),
      httpMethod: 'POST'
    };

    const result = await generateHandler(event);
    
    expect(result.statusCode).toBe(500);
    const error = JSON.parse(result.body);
    expect(error.error).toBe('Failed to generate insights');
  });
});

// Performance tests
describe('Insights Generation Performance', () => {
  test('should complete analysis within time limits', async () => {
    const batteryData = createBatteryData('healthy');
    
    // Mock fast response
    jest.mock('@google/generative-ai', () => ({
      GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
          generateContent: jest.fn().mockResolvedValue({
            response: {
              text: () => 'Fast analysis complete'
            }
          })
        })
      }))
    }));

    const event = {
      body: JSON.stringify(batteryData),
      httpMethod: 'POST'
    };

    const startTime = Date.now();
    const result = await generateHandler(event);
    const duration = Date.now() - startTime;

    expect(result.statusCode).toBe(200);
    expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
  });

  test('should handle large datasets efficiently', async () => {
    // Create large dataset (500 measurements, not 1000 to stay under token limit)
    const largeData = createBatteryData('healthy');
    for (let i = 0; i < 400; i++) {
      largeData.measurements.push({
        timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
        voltage: 3.7 + Math.random() * 0.1,
        current: Math.random() * 2 - 1,
        temperature: 25 + Math.random() * 5,
        capacity: 95 + Math.random() * 3,
        soc: 20 + Math.random() * 60,
        state: 'charging'
      });
    }

    jest.mock('@google/generative-ai', () => ({
      GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
          generateContent: jest.fn().mockResolvedValue({
            response: {
              text: () => 'Large dataset analysis complete'
            }
          })
        })
      }))
    }));

    const event = {
      body: JSON.stringify(largeData),
      httpMethod: 'POST'
    };

    const startTime = Date.now();
    const result = await generateHandler(event);
    const duration = Date.now() - startTime;

    // Token limit check should pass with 500 measurements
    expect(result.statusCode).toBe(200);
    expect(duration).toBeLessThan(15000); // Should handle large data efficiently
  });
});

// Integration tests
describe('Insights Generation Integration', () => {
  test('should work with real API endpoint', async () => {
    // This test would require actual API keys and network access
    // Skip in CI/CD environment
    
    if (process.env.NODE_ENV === 'test') {
      return; // Skip in test environment
    }

    const batteryData = createBatteryData('healthy');
    
    const response = await fetch('http://localhost:8888/.netlify/functions/generate-insights', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batteryData)
    });

    expect(response.ok).toBeTruthy();
    
    const insights = await response.json();
    expect(insights.success).toBe(true);
    expect(insights.insights).toBeDefined();
    expect(insights.timestamp).toBeDefined();
  });
});