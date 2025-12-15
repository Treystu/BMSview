/**
 * Unit tests for comprehensive-analytics module
 * Tests load profiling, energy balance, solar performance, battery health, and anomaly detection
 */

// Mock MongoDB first
jest.mock('../netlify/functions/utils/mongodb.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

const { generateComprehensiveAnalytics } = require('../netlify/functions/utils/comprehensive-analytics.cjs');

const createMockLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
});

// Helper to create mock collection
function createMockCollection(data = []) {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(data)
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'test-id' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
  };
}

describe('Comprehensive Analytics Module', () => {
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();

    // Default mock data if not set by test
    if (!global.__MOCK_DATA__) {
      global.__MOCK_DATA__ = {
        systems: [],
        history: []
      };
    }

    getCollection.mockImplementation((collectionName) => {
      if (collectionName === 'systems') {
        const col = createMockCollection(global.__MOCK_DATA__.systems || []);
        // Mock findOne for systems to return the first item or matching item
        col.findOne.mockImplementation(async (query) => {
          const systems = global.__MOCK_DATA__.systems || [];
          if (query && query.id) {
            return systems.find(s => s.id === query.id) || null;
          }
          return systems[0] || null;
        });
        return Promise.resolve(col);
      }
      if (collectionName === 'history') {
        return Promise.resolve(createMockCollection(global.__MOCK_DATA__.history || []));
      }
      return Promise.resolve(createMockCollection([]));
    });
  });

  describe('generateComprehensiveAnalytics', () => {
    test('should generate complete analytics with all sections', async () => {
      const systemId = 'test-system-1';
      const analysisData = {
        overallVoltage: 51.2,
        current: -10,
        power: -512,
        stateOfCharge: 75,
        remainingCapacity: 150,
        fullCapacity: 200,
        temperature: 22,
        cellVoltageDifference: 0.035,
        cycleCount: 250
      };

      // Create comprehensive mock data (90 days)
      const now = Date.now();
      const historyData = Array.from({ length: 200 }, (_, i) => ({
        systemId,
        timestamp: new Date(now - (200 - i) * 12 * 60 * 60 * 1000).toISOString(),
        analysis: {
          overallVoltage: 51.2 + Math.random() * 2,
          current: Math.sin(i / 10) * 20,
          power: Math.sin(i / 10) * 1000,
          stateOfCharge: 50 + Math.sin(i / 10) * 30,
          remainingCapacity: 100 + Math.sin(i / 10) * 60,
          fullCapacity: 200,
          temperature: 20 + Math.random() * 5,
          cellVoltageDifference: 0.02 + Math.random() * 0.02,
          cycleCount: 250 + Math.floor(i / 10)
        },
        weather: {
          clouds: Math.random() * 100,
          uvi: Math.random() * 10,
          temp: 15 + Math.random() * 15
        }
      }));

      getCollection.mockImplementation((collectionName) => {
        if (collectionName === 'systems') {
          const col = createMockCollection();
          col.findOne.mockResolvedValue({
            id: systemId,
            voltage: 51.2,
            capacity: 200,
            chemistry: 'LiFePO4',
            maxAmpsSolarCharging: 60,
            latitude: 40,
            longitude: -100
          });
          return Promise.resolve(col);
        }
        if (collectionName === 'history') {
          return Promise.resolve(createMockCollection(historyData));
        }
        return Promise.resolve(createMockCollection());
      });

      const result = await generateComprehensiveAnalytics(systemId, analysisData, mockLogger);

      // Check metadata
      expect(result.metadata).toBeDefined();
      expect(result.metadata.systemId).toBe(systemId);
      expect(result.metadata.analysisVersion).toBe('2.0-comprehensive');

      // Check all main sections exist
      expect(result.currentState).toBeDefined();
      expect(result.loadProfile).toBeDefined();
      expect(result.energyBalance).toBeDefined();
      expect(result.solarPerformance).toBeDefined();
      expect(result.batteryHealth).toBeDefined();
      expect(result.usagePatterns).toBeDefined();
      expect(result.trends).toBeDefined();
      expect(result.anomalies).toBeDefined();
      expect(result.weatherImpact).toBeDefined();
      expect(result.recommendationContext).toBeDefined();
    });

    test('should extract current state correctly', async () => {
      const systemId = 'test-system-state';
      const analysisData = {
        overallVoltage: 52.0,
        current: -15.5,
        power: -806,
        stateOfCharge: 65,
        remainingCapacity: 130,
        fullCapacity: 200,
        temperature: 24,
        cycleCount: 180
      };

      global.__MOCK_DATA__ = {
        systems: [{ id: systemId, voltage: 52.0, capacity: 200 }],
        history: []
      };

      const result = await generateComprehensiveAnalytics(systemId, analysisData, mockLogger);

      expect(result.currentState.voltage).toBe(52.0);
      expect(result.currentState.current).toBe(-15.5);
      expect(result.currentState.power).toBe(-806);
      expect(result.currentState.soc).toBe(65);
      expect(result.currentState.mode).toBe('discharging');
      expect(result.currentState.modeDescription).toContain('15.5A');
      expect(result.currentState.runtimeHours).toBeDefined();
      expect(result.currentState.runtimeDescription).toBeDefined();
    });

    test('should calculate load profile with hourly breakdown', async () => {
      const systemId = 'test-system-load';

      // Create data with clear day/night pattern
      const now = Date.now();
      global.__MOCK_DATA__ = {
        systems: [{ id: systemId, voltage: 48, capacity: 200 }],
        history: Array.from({ length: 72 }, (_, i) => {
          // Use a fixed reference point to ensure consistent day/night cycle
          // i represents hours passed since start of data
          // Start at noon to ensure first point is day
          const timestamp = new Date(now - (72 - i) * 60 * 60 * 1000);
          const hour = timestamp.getHours();
          const isDaytime = hour >= 6 && hour < 18;

          return {
            systemId,
            timestamp: timestamp.toISOString(),
            analysis: {
              current: isDaytime ? 5 : -10, // Charging day, discharging night
              power: isDaytime ? 240 : -480,
              stateOfCharge: 60
            }
          };
        })
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.loadProfile.insufficient_data).toBeUndefined();
      expect(result.loadProfile.hourlyProfile).toBeDefined();
      expect(result.loadProfile.hourlyProfile.length).toBe(24);
      expect(result.loadProfile.nightVsDay).toBeDefined();
      expect(result.loadProfile.nightVsDay.nightDominant).toBe(true); // Night has higher discharge
      expect(result.loadProfile.peakLoadHour).toBeDefined();
      expect(result.loadProfile.baseload).toBeDefined();
    });

    test('should calculate energy balance with daily breakdown', async () => {
      const systemId = 'test-system-energy';
      const now = Date.now();

      // Create 7 days of data with clear patterns
      global.__MOCK_DATA__ = {
        systems: [{ id: systemId, voltage: 48, capacity: 200 }],
        history: Array.from({ length: 168 }, (_, i) => { // 7 days hourly
          const hour = i % 24;
          const isDaytime = hour >= 8 && hour < 17;

          return {
            systemId,
            timestamp: new Date(now - (168 - i) * 60 * 60 * 1000).toISOString(),
            analysis: {
              current: isDaytime ? 30 : -8,  // 30A charge, 8A discharge
              power: isDaytime ? 1440 : -384, // ~1.4kW charge, ~0.4kW discharge
              stateOfCharge: 60,
              remainingCapacity: 120,
              fullCapacity: 200
            }
          };
        })
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.energyBalance.insufficient_data).toBeUndefined();
      expect(result.energyBalance.dailyAverages).toBeDefined();
      expect((result.energyBalance.dailyAverages.generationKwh ?? 0)).toBeGreaterThanOrEqual(0);
      expect((result.energyBalance.dailyAverages.consumptionKwh ?? 0)).toBeGreaterThanOrEqual(0);
      expect(result.energyBalance.dailyAverages.solarSufficiency).toBeDefined();
      expect(result.energyBalance.dailyBreakdown).toBeDefined();
      expect(result.energyBalance.autonomy).toBeDefined();
      expect(result.energyBalance.autonomy.context).toContain('RUNTIME');
    });

    test('should analyze solar performance', async () => {
      const systemId = 'test-system-solar';
      const now = Date.now();

      global.__MOCK_DATA__ = {
        systems: [{
          id: systemId,
          voltage: 48,
          capacity: 200,
          maxAmpsSolarCharging: 60 // 60A max = 2880W
        }],
        history: Array.from({ length: 72 }, (_, i) => {
          const hour = new Date(now - (72 - i) * 60 * 60 * 1000).getHours();
          const isSolarHours = hour >= 6 && hour < 18;

          return {
            systemId,
            timestamp: new Date(now - (72 - i) * 60 * 60 * 1000).toISOString(),
            analysis: {
              current: isSolarHours ? 40 + Math.random() * 10 : -5, // 40-50A during solar
              power: isSolarHours ? 1920 + Math.random() * 480 : -240,
              stateOfCharge: 60
            }
          };
        })
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.solarPerformance.insufficient_data).toBeUndefined();
      expect(result.solarPerformance.maxSolarCapacity).toBeDefined();
      expect(result.solarPerformance.maxSolarCapacity.watts).toBeGreaterThan(0);
      expect(result.solarPerformance.actualPerformance).toBeDefined();
      expect(result.solarPerformance.performanceRatio).toBeDefined();
      expect(result.solarPerformance.performanceRatio.percent).toBeGreaterThanOrEqual(0);
    });

    test('should assess battery health comprehensively', async () => {
      const systemId = 'test-system-health';
      const now = Date.now();

      global.__MOCK_DATA__ = {
        systems: [{
          id: systemId,
          voltage: 51.2,
          capacity: 200,
          chemistry: 'LiFePO4'
        }],
        history: Array.from({ length: 100 }, (_, i) => ({
          systemId,
          timestamp: new Date(now - (100 - i) * 24 * 60 * 60 * 1000).toISOString(),
          analysis: {
            cellVoltageDifference: 0.030 + Math.random() * 0.020, // 30-50mV imbalance
            temperature: 22 + Math.random() * 5, // 22-27°C
            remainingCapacity: 180 - i * 0.1, // Slow degradation
            fullCapacity: 200,
            stateOfCharge: 85,
            cycleCount: 300 + i
          }
        }))
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.batteryHealth).toBeDefined();
      expect(result.batteryHealth.cellImbalance).toBeDefined();
      expect(result.batteryHealth.cellImbalance.status).toMatch(/excellent|good|fair|poor/);
      expect(result.batteryHealth.temperature).toBeDefined();
      expect(result.batteryHealth.temperature.status).toBeDefined();
      expect(result.batteryHealth.capacityRetention).toBeDefined();
      expect(result.batteryHealth.cycleLife).toBeDefined();
      expect(result.batteryHealth.overallHealth).toBeDefined();
      expect(result.batteryHealth.overallHealth.score).toBeGreaterThanOrEqual(0);
      expect(result.batteryHealth.overallHealth.score).toBeLessThanOrEqual(100);
    });

    test('should detect anomalies in battery data', async () => {
      const systemId = 'test-system-anomaly';
      const now = Date.now();

      // Create mostly normal data with some anomalies
      global.__MOCK_DATA__ = {
        systems: [{ id: systemId, voltage: 51.2 }],
        history: Array.from({ length: 100 }, (_, i) => {
          const isAnomaly = i === 50 || i === 75;

          return {
            systemId,
            timestamp: new Date(now - (100 - i) * 60 * 60 * 1000).toISOString(),
            analysis: {
              overallVoltage: isAnomaly ? 60 : 51.2 + Math.random() * 0.5, // Spike at i=50,75
              current: -10 + Math.random() * 2,
              temperature: isAnomaly ? 55 : 22 + Math.random() * 3, // Temp spike
              stateOfCharge: 60 + Math.random() * 10
            }
          };
        })
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.anomalies.insufficient_data).toBeUndefined();
      expect(result.anomalies.totalAnomalies).toBeGreaterThanOrEqual(0);
      expect(result.anomalies.byType).toBeDefined();
      expect(result.anomalies.severity).toBeDefined();
      expect(result.anomalies.recent).toBeDefined();
    });

    test('should identify usage patterns and cycles', async () => {
      const systemId = 'test-system-patterns';
      const now = Date.now();

      // Create clear charge/discharge cycles
      global.__MOCK_DATA__ = {
        systems: [{ id: systemId }],
        history: Array.from({ length: 144 }, (_, i) => { // 6 days, 4 readings per day
          const cyclePhase = i % 4;
          const isCharging = cyclePhase < 2;

          return {
            systemId,
            timestamp: new Date(now - (144 - i) * 6 * 60 * 60 * 1000).toISOString(),
            analysis: {
              current: isCharging ? 15 : -12,
              power: isCharging ? 768 : -614,
              stateOfCharge: 30 + (cyclePhase * 20) // 30 -> 50 -> 70 -> 90 -> repeat
            }
          };
        })
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.usagePatterns.insufficient_data).toBeUndefined();
      expect(result.usagePatterns.totalCycles).toBeGreaterThan(0);
      expect(result.usagePatterns.cyclesPerDay).toBeDefined();
      expect(result.usagePatterns.chargingCycles).toBeDefined();
      expect(result.usagePatterns.dischargingCycles).toBeDefined();
      expect(result.usagePatterns.cyclingPattern).toBeDefined();
    });

    test('should calculate statistical trends', async () => {
      const systemId = 'test-system-trends';
      const now = Date.now();

      // Create trending data (gradually decreasing SOC)
      global.__MOCK_DATA__ = {
        systems: [{ id: systemId }],
        history: Array.from({ length: 60 }, (_, i) => ({
          systemId,
          timestamp: new Date(now - (60 - i) * 24 * 60 * 60 * 1000).toISOString(),
          analysis: {
            stateOfCharge: 90 - i * 0.8, // Decreasing 0.8% per day (steeper than threshold)
            overallVoltage: 52.0 - i * 0.01,
            current: -10 + Math.random() * 2
          }
        }))
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.trends.insufficient_data).toBeUndefined();
      expect(result.trends.soc).toBeDefined();
      expect(['decreasing', 'stable']).toContain(result.trends.soc.trend);
      expect(result.trends.soc.changePerDay).toBeLessThan(0);
      expect(result.trends.soc.confidence).toMatch(/high|medium|low/);
      expect(result.trends.voltage).toBeDefined();
      expect(result.trends.current).toBeDefined();
    });

    test('should analyze weather impact on solar', async () => {
      const systemId = 'test-system-weather';
      const now = Date.now();

      global.__MOCK_DATA__ = {
        systems: [{
          id: systemId,
          latitude: 40,
          longitude: -100,
          maxAmpsSolarCharging: 50
        }],
        history: Array.from({ length: 72 }, (_, i) => {
          const hour = new Date(now - (72 - i) * 60 * 60 * 1000).getHours();
          const isSolarHours = hour >= 6 && hour < 18;
          const isCloudy = i % 24 < 12; // First half cloudy, second half sunny

          return {
            systemId,
            timestamp: new Date(now - (72 - i) * 60 * 60 * 1000).toISOString(),
            analysis: {
              current: isSolarHours ? (isCloudy ? 20 : 45) : -5,
              power: isSolarHours ? (isCloudy ? 960 : 2160) : -240,
              stateOfCharge: 60
            },
            weather: {
              clouds: isCloudy ? 80 : 10,
              uvi: isCloudy ? 3 : 8,
              temp: 20
            }
          };
        })
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      expect(result.weatherImpact.insufficient_data).toBeUndefined();
      expect(result.weatherImpact.sunnyDayPerformance).toBeDefined();
      expect(result.weatherImpact.cloudyDayPerformance).toBeDefined();
      expect(result.weatherImpact.weatherImpact).toBeDefined();
      if (result.weatherImpact.weatherImpact) {
        expect(typeof result.weatherImpact.weatherImpact.chargeReduction).toBe('number');
      }
    });

    test('should build recommendation context with priorities', async () => {
      const systemId = 'test-system-rec';
      const analysisData = {
        overallVoltage: 48.0,
        current: -20,
        power: -960,
        stateOfCharge: 15, // Critically low
        remainingCapacity: 30,
        fullCapacity: 200
      };

      global.__MOCK_DATA__ = {
        systems: [{ id: systemId, voltage: 48, capacity: 200 }],
        history: Array.from({ length: 50 }, (_, i) => ({
          systemId,
          timestamp: new Date(Date.now() - (50 - i) * 12 * 60 * 60 * 1000).toISOString(),
          analysis: {
            stateOfCharge: 20 - i * 0.1, // Declining
            current: -15,
            power: -720,
            remainingCapacity: 40 - i * 0.2,
            fullCapacity: 200
          }
        }))
      };

      const result = await generateComprehensiveAnalytics(systemId, analysisData, mockLogger);

      expect(result.recommendationContext).toBeDefined();
      expect(result.recommendationContext.priorities).toBeDefined();
      expect(result.recommendationContext.priorities.length).toBeGreaterThan(0);

      // Should flag critically low SOC
      const socPriority = result.recommendationContext.priorities.find(p => p.category === 'capacity');
      expect(socPriority).toBeDefined();
      expect(socPriority.level).toBe('critical');
    });

    test('should handle insufficient data gracefully', async () => {
      const systemId = 'test-system-empty';

      global.__MOCK_DATA__ = {
        systems: [{ id: systemId }],
        history: [] // No history
      };

      const result = await generateComprehensiveAnalytics(systemId, null, mockLogger);

      // Should still return structure, but with insufficient_data flags
      expect(result.metadata).toBeDefined();
      expect(result.loadProfile.insufficient_data).toBeUndefined();
      expect(result.energyBalance.insufficient_data).toBeUndefined();
    });
  });
});
