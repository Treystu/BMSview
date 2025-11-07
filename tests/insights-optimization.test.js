/**
 * Tests for Insights Generation Query Optimization
 * 
 * Validates that the new optimization features work correctly:
 * - Compact statistical summaries
 * - Intelligent data sampling
 * - Conversation history pruning
 * - Tool result compactification
 */

const { 
  createCompactSummary, 
  sampleDataPoints,
  aggregateHourlyData 
} = require('../netlify/functions/utils/data-aggregation.cjs');

describe('Insights Generation Optimization', () => {
  
  // Mock logger
  const mockLog = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCompactSummary', () => {
    
    it('should create statistical summary from hourly data', () => {
      const hourlyData = [
        {
          timestamp: '2025-01-01T00:00:00Z',
          dataPoints: 5,
          metrics: {
            avgVoltage: 52.0,
            avgCurrent: -10.5,
            avgSoC: 85,
            avgTemperature: 20.5
          }
        },
        {
          timestamp: '2025-01-01T01:00:00Z',
          dataPoints: 4,
          metrics: {
            avgVoltage: 52.2,
            avgCurrent: -8.0,
            avgSoC: 83,
            avgTemperature: 21.0
          }
        },
        {
          timestamp: '2025-01-01T02:00:00Z',
          dataPoints: 6,
          metrics: {
            avgVoltage: 51.8,
            avgCurrent: -12.0,
            avgSoC: 80,
            avgTemperature: 22.0
          }
        }
      ];

      const summary = createCompactSummary(hourlyData, mockLog);

      expect(summary).toBeDefined();
      expect(summary.timeRange).toBeDefined();
      expect(summary.timeRange.hours).toBe(3);
      expect(summary.timeRange.dataPoints).toBe(15);
      
      // Check voltage statistics
      expect(summary.statistics.voltage).toBeDefined();
      expect(summary.statistics.voltage.min).toBe(51.8);
      expect(summary.statistics.voltage.max).toBe(52.2);
      expect(summary.statistics.voltage.latest).toBe(51.8);
      
      // Check current statistics
      expect(summary.statistics.current).toBeDefined();
      expect(summary.statistics.current.min).toBe(-12.0);
      expect(summary.statistics.current.max).toBe(-8.0);
      
      // Check sample data points
      expect(summary.sampleDataPoints).toBeDefined();
      expect(summary.sampleDataPoints.length).toBe(3); // First, middle, last
      expect(summary.sampleDataPoints[0].time).toBe('2025-01-01T00:00:00Z');
      expect(summary.sampleDataPoints[2].time).toBe('2025-01-01T02:00:00Z');
    });

    it('should handle empty data', () => {
      const summary = createCompactSummary([], mockLog);
      expect(summary).toBeNull();
    });

    it('should handle single data point', () => {
      const hourlyData = [
        {
          timestamp: '2025-01-01T00:00:00Z',
          dataPoints: 5,
          metrics: { avgVoltage: 52.0, avgCurrent: -10.5 }
        }
      ];

      const summary = createCompactSummary(hourlyData, mockLog);
      
      expect(summary).toBeDefined();
      expect(summary.timeRange.hours).toBe(1);
      expect(summary.sampleDataPoints.length).toBe(1);
      expect(summary.statistics.voltage.min).toBe(52.0);
      expect(summary.statistics.voltage.max).toBe(52.0);
      expect(summary.statistics.voltage.avg).toBe(52.0);
    });

    it('should compress data significantly', () => {
      // Generate 720 hours of data (30 days)
      const hourlyData = [];
      for (let i = 0; i < 720; i++) {
        hourlyData.push({
          timestamp: new Date(Date.now() - (720 - i) * 3600000).toISOString(),
          dataPoints: 5,
          metrics: {
            avgVoltage: 52.0 + Math.random(),
            avgCurrent: -10 + Math.random() * 20,
            avgSoC: 50 + Math.random() * 50,
            avgTemperature: 20 + Math.random() * 10
          }
        });
      }

      const fullSize = JSON.stringify(hourlyData).length;
      const summary = createCompactSummary(hourlyData, mockLog);
      const summarySize = JSON.stringify(summary).length;

      expect(summarySize).toBeLessThan(fullSize / 5); // At least 5x compression
      expect(summary.timeRange.hours).toBe(720);
      expect(summary.sampleDataPoints.length).toBe(3);
      
      // Verify logging
      expect(mockLog.info).toHaveBeenCalledWith(
        'Compact summary created',
        expect.objectContaining({
          originalHours: 720,
          compressionRatio: expect.any(String)
        })
      );
    });
  });

  describe('sampleDataPoints', () => {
    
    it('should return all data if under limit', () => {
      const data = Array(50).fill().map((_, i) => ({
        timestamp: `2025-01-01T${String(i).padStart(2, '0')}:00:00Z`,
        value: i
      }));

      const sampled = sampleDataPoints(data, 100, mockLog);
      
      expect(sampled).toHaveLength(50);
      expect(sampled).toEqual(data);
    });

    it('should sample data when over limit', () => {
      const data = Array(500).fill().map((_, i) => ({
        timestamp: `hour-${i}`,
        value: i
      }));

      const sampled = sampleDataPoints(data, 100, mockLog);
      
      expect(sampled).toHaveLength(100);
      expect(sampled[0]).toEqual(data[0]); // First point included
      expect(sampled[99]).toEqual(data[499]); // Last point included
      
      // Verify systematic sampling
      const indices = sampled.map(d => parseInt(d.timestamp.split('-')[1]));
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i-1]);
      }
    });

    it('should handle empty array', () => {
      const sampled = sampleDataPoints([], 100, mockLog);
      expect(sampled).toEqual([]);
    });

    it('should always include last point', () => {
      const data = Array(250).fill().map((_, i) => ({
        timestamp: `hour-${i}`,
        value: i
      }));

      const sampled = sampleDataPoints(data, 100, mockLog);
      
      expect(sampled[sampled.length - 1].timestamp).toBe('hour-249');
      expect(sampled[sampled.length - 1].value).toBe(249);
    });

    it('should log compression ratio', () => {
      const data = Array(1000).fill().map((_, i) => ({ value: i }));
      
      sampleDataPoints(data, 100, mockLog);
      
      expect(mockLog.info).toHaveBeenCalledWith(
        'Sampling data points',
        expect.objectContaining({
          originalHours: 1000,
          maxPoints: 100
        })
      );
      
      expect(mockLog.debug).toHaveBeenCalledWith(
        'Sampling complete',
        expect.objectContaining({
          sampledPoints: 100,
          compressionRatio: '10.00'
        })
      );
    });
  });

  describe('Integration: Compact Summary Token Savings', () => {
    
    it('should demonstrate significant token savings for 30 days of data', () => {
      // Generate realistic 30 days of hourly data
      const hourlyData = [];
      const now = Date.now();
      
      for (let i = 0; i < 720; i++) {
        const timestamp = new Date(now - (720 - i) * 3600000);
        hourlyData.push({
          timestamp: timestamp.toISOString(),
          dataPoints: 3 + Math.floor(Math.random() * 5),
          metrics: {
            avgVoltage: 51.5 + Math.random() * 2,
            avgCurrent: -15 + Math.random() * 30,
            avgChargingCurrent: Math.random() * 20,
            avgDischargingCurrent: Math.random() * 20,
            avgPower: -200 + Math.random() * 400,
            avgSoC: 40 + Math.random() * 60,
            avgCapacity: 180 + Math.random() * 20,
            avgTemperature: 18 + Math.random() * 15,
            avgMosTemperature: 20 + Math.random() * 20,
            avgCellVoltageDiff: 0.01 + Math.random() * 0.05,
            chargingCount: Math.floor(Math.random() * 5),
            dischargingCount: Math.floor(Math.random() * 5)
          }
        });
      }

      const fullData = {
        timeRange: {
          start: hourlyData[0].timestamp,
          end: hourlyData[719].timestamp,
          totalHours: 720,
          totalDataPoints: hourlyData.reduce((sum, h) => sum + h.dataPoints, 0)
        },
        hourlyData: hourlyData.map(h => ({
          time: h.timestamp,
          dataPoints: h.dataPoints,
          ...h.metrics
        }))
      };

      const compactSummary = createCompactSummary(hourlyData, mockLog);

      const fullSize = JSON.stringify(fullData).length;
      const compactSize = JSON.stringify(compactSummary).length;
      const fullTokens = Math.ceil(fullSize / 4); // Rough estimate: 1 token ≈ 4 chars
      const compactTokens = Math.ceil(compactSize / 4);

      console.log('\n📊 Token Savings Analysis:');
      console.log(`  Full Data: ${fullSize} bytes (~${fullTokens} tokens)`);
      console.log(`  Compact Summary: ${compactSize} bytes (~${compactTokens} tokens)`);
      console.log(`  Savings: ${fullSize - compactSize} bytes (~${fullTokens - compactTokens} tokens)`);
      console.log(`  Compression Ratio: ${(fullSize / compactSize).toFixed(2)}x\n`);

      expect(compactSize).toBeLessThan(fullSize / 8); // At least 8x compression
      expect(compactTokens).toBeLessThan(5000); // Should fit well within token budget
      
      // Verify key information is preserved
      expect(compactSummary.timeRange.hours).toBe(720);
      expect(compactSummary.statistics.voltage).toBeDefined();
      expect(compactSummary.statistics.current).toBeDefined();
      expect(compactSummary.statistics.soc).toBeDefined();
      expect(compactSummary.sampleDataPoints).toHaveLength(3);
    });
  });

  describe('Error Handling', () => {
    
    it('should handle null input gracefully', () => {
      expect(() => createCompactSummary(null, mockLog)).not.toThrow();
      expect(createCompactSummary(null, mockLog)).toBeNull();
    });

    it('should handle undefined input gracefully', () => {
      expect(() => createCompactSummary(undefined, mockLog)).not.toThrow();
      expect(createCompactSummary(undefined, mockLog)).toBeNull();
    });

    it('should handle data with missing metrics', () => {
      const hourlyData = [
        {
          timestamp: '2025-01-01T00:00:00Z',
          dataPoints: 5,
          metrics: { avgVoltage: 52.0 } // Only voltage, missing other metrics
        },
        {
          timestamp: '2025-01-01T01:00:00Z',
          dataPoints: 4,
          metrics: { avgCurrent: -10.0 } // Only current
        }
      ];

      const summary = createCompactSummary(hourlyData, mockLog);
      
      expect(summary).toBeDefined();
      expect(summary.statistics.voltage).toBeDefined();
      expect(summary.statistics.current).toBeDefined();
      expect(summary.statistics.soc).toBeUndefined(); // Missing from all records
    });
  });
});
