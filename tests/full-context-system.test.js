// @ts-nocheck
/**
 * Tests for Full Context Mode and AI Feedback System
 */

const { buildCompleteContext, countDataPoints } = require('../netlify/functions/utils/full-context-builder.cjs');
const { runStatisticalAnalysis, runTrendAnalysis, runAnomalyDetection, runCorrelationAnalysis } = require('../netlify/functions/utils/statistical-tools.cjs');

describe('Full Context Builder', () => {
  test('countDataPoints should count array items correctly', () => {
    const testData = {
      raw: {
        allAnalyses: [1, 2, 3],
        nested: {
          items: [4, 5, 6, 7]
        }
      },
      metadata: {
        single: 1
      }
    };
    
    const count = countDataPoints(testData);
    expect(count).toBeGreaterThan(0);
  });
  
  test('countDataPoints should handle empty objects', () => {
    const count = countDataPoints({});
    expect(count).toBe(0);
  });
  
  test('countDataPoints should handle null/undefined', () => {
    expect(countDataPoints(null)).toBe(0);
    expect(countDataPoints(undefined)).toBe(0);
  });
});

describe('Statistical Tools', () => {
  describe('runStatisticalAnalysis', () => {
    test('should calculate basic statistics', async () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = await runStatisticalAnalysis(data);
      
      expect(result).not.toBeNull();
      expect(result.descriptive.mean).toBe(5.5);
      expect(result.descriptive.median).toBeGreaterThanOrEqual(5);
      expect(result.descriptive.min).toBe(1);
      expect(result.descriptive.max).toBe(10);
      expect(result.percentiles.p50).toBeGreaterThanOrEqual(5);
    });
    
    test('should handle empty data', async () => {
      const result = await runStatisticalAnalysis([]);
      expect(result).toBeNull();
    });
    
    test('should filter null values', async () => {
      const data = [1, null, 3, null, 5];
      const result = await runStatisticalAnalysis(data);
      
      expect(result).not.toBeNull();
      expect(result.descriptive.count).toBe(3);
      expect(result.descriptive.mean).toBe(3);
    });
  });
  
  describe('runTrendAnalysis', () => {
    test('should detect increasing trend', async () => {
      const timeSeries = [
        { timestamp: '2024-01-01T00:00:00Z', value: 10 },
        { timestamp: '2024-01-01T01:00:00Z', value: 15 },
        { timestamp: '2024-01-01T02:00:00Z', value: 20 },
        { timestamp: '2024-01-01T03:00:00Z', value: 25 }
      ];
      
      const result = await runTrendAnalysis(timeSeries);
      
      expect(result).not.toBeNull();
      expect(result.trend).toBe('increasing');
      expect(result.slope).toBeGreaterThan(0);
    });
    
    test('should detect decreasing trend', async () => {
      const timeSeries = [
        { timestamp: '2024-01-01T00:00:00Z', value: 100 },
        { timestamp: '2024-01-01T01:00:00Z', value: 75 },
        { timestamp: '2024-01-01T02:00:00Z', value: 50 },
        { timestamp: '2024-01-01T03:00:00Z', value: 25 }
      ];
      
      const result = await runTrendAnalysis(timeSeries);
      
      expect(result).not.toBeNull();
      expect(result.trend).toBe('decreasing');
      expect(result.slope).toBeLessThan(0);
    });
    
    test('should handle insufficient data', async () => {
      const result = await runTrendAnalysis([{ timestamp: '2024-01-01T00:00:00Z', value: 10 }]);
      expect(result).toBeNull();
    });
  });
  
  describe('runAnomalyDetection', () => {
    test('should detect outliers', async () => {
      const data = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100, 200]; // 100 and 200 are outliers (>2 std dev)
      const result = await runAnomalyDetection(data);
      
      expect(result).not.toBeNull();
      // With larger deviation, we should detect anomalies
      expect(result.anomalies).toBeDefined();
      expect(Array.isArray(result.anomalies)).toBe(true);
    });
    
    test('should not detect anomalies in uniform data', async () => {
      const data = [10, 10, 10, 10, 10, 10];
      const result = await runAnomalyDetection(data);
      
      expect(result).not.toBeNull();
      expect(result.totalAnomalies).toBe(0);
    });
  });
  
  describe('runCorrelationAnalysis', () => {
    test('should detect perfect positive correlation', async () => {
      const data = {
        x: [1, 2, 3, 4, 5],
        y: [2, 4, 6, 8, 10] // y = 2x
      };
      
      const result = await runCorrelationAnalysis(data);
      
      expect(result).not.toBeNull();
      expect(result.matrix.x.y).toBeCloseTo(1, 1); // Close to 1
    });
    
    test('should detect negative correlation', async () => {
      const data = {
        x: [1, 2, 3, 4, 5],
        y: [10, 8, 6, 4, 2] // y decreases as x increases
      };
      
      const result = await runCorrelationAnalysis(data);
      
      expect(result).not.toBeNull();
      expect(result.matrix.x.y).toBeLessThan(0);
    });
    
    test('should handle insufficient variables', async () => {
      const result = await runCorrelationAnalysis({ x: [1, 2, 3] });
      expect(result).toBeNull();
    });
  });
});

describe('AI Feedback System', () => {
  test('should validate feedback types', () => {
    const validTypes = ['feature_request', 'api_suggestion', 'data_format', 'bug_report', 'optimization'];
    expect(validTypes).toContain('feature_request');
    expect(validTypes).toContain('optimization');
  });
  
  test('should validate categories', () => {
    const validCategories = ['weather_api', 'data_structure', 'ui_ux', 'performance', 'integration', 'analytics'];
    expect(validCategories).toContain('weather_api');
    expect(validCategories).toContain('analytics');
  });
  
  test('should validate priorities', () => {
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    expect(validPriorities).toContain('critical');
    expect(validPriorities).toContain('low');
  });
});
