/**
 * Tests for Metrics Collector Utility
 */

const {
  logAIOperation,
  recordMetric,
  createAlert,
  resolveAlert,
  trackFeedbackImplementation,
  getCostMetrics,
  getRealtimeMetrics,
  calculateGeminiCost,
  getModelPricing,
  getCurrentModelInfo
} = require('../netlify/functions/utils/metrics-collector.cjs');

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
  const mockCollections = new Map();
  
  return {
    getCollection: jest.fn(async (name) => {
      if (!mockCollections.has(name)) {
        const items = [];
        mockCollections.set(name, {
          insertOne: jest.fn(async (doc) => {
            items.push(doc);
            return { insertedId: doc.id };
          }),
          updateOne: jest.fn(async (filter, update) => {
            const item = items.find(i => i.id === filter.id);
            if (item) {
              Object.assign(item, update.$set);
            }
            return { modifiedCount: item ? 1 : 0 };
          }),
          find: jest.fn((query) => ({
            toArray: jest.fn(async () => {
              let results = items;
              
              // Apply timestamp filter if present
              if (query.timestamp) {
                if (query.timestamp.$gte) {
                  results = results.filter(item => item.timestamp >= query.timestamp.$gte);
                }
                if (query.timestamp.$lte) {
                  results = results.filter(item => item.timestamp <= query.timestamp.$lte);
                }
              }
              
              // Apply success filter if present
              if (query.success !== undefined) {
                results = results.filter(item => item.success === query.success);
              }
              
              // Apply resolved filter if present
              if (query.resolved !== undefined) {
                results = results.filter(item => item.resolved === query.resolved);
              }
              
              return results;
            }),
            sort: jest.fn(() => ({
              limit: jest.fn(() => ({
                toArray: jest.fn(async () => items.slice(0, 10))
              }))
            }))
          })),
          aggregate: jest.fn((pipeline) => ({
            toArray: jest.fn(async () => [])
          })),
          _items: items
        });
      }
      return mockCollections.get(name);
    }),
    _mockCollections: mockCollections,
    _resetMocks: () => {
      mockCollections.clear();
    }
  };
});

// Mock logger
jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('Metrics Collector', () => {
  beforeEach(() => {
    const { _resetMocks } = require('../netlify/functions/utils/mongodb.cjs');
    _resetMocks();
  });

  describe('calculateGeminiCost', () => {
    test('calculates cost for gemini-2.5-flash correctly', () => {
      const cost = calculateGeminiCost('gemini-2.5-flash', 1000000, 1000000);
      expect(cost).toBeCloseTo(0.50, 6); // (1M * 0.10/1M) + (1M * 0.40/1M)
    });

    test('uses default model when not specified', () => {
      const cost = calculateGeminiCost(undefined, 1000000, 1000000);
      expect(cost).toBeCloseTo(0.50, 6);
    });

    test('calculates cost for different models', () => {
      const costPro = calculateGeminiCost('gemini-1.5-pro', 1000000, 1000000);
      expect(costPro).toBeCloseTo(6.25, 6); // (1M * 1.25/1M) + (1M * 5.00/1M)
    });
  });

  describe('logAIOperation', () => {
    test('logs successful operation with all details', async () => {
      const operationId = await logAIOperation({
        operation: 'analysis',
        systemId: 'test-system',
        duration: 5000,
        tokensUsed: 1500,
        inputTokens: 1000,
        outputTokens: 500,
        success: true,
        model: 'gemini-2.5-flash'
      });

      expect(operationId).toBeTruthy();
      expect(typeof operationId).toBe('string');

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('ai_operations');
      const operations = await collection.find({}).toArray();
      
      expect(operations).toHaveLength(1);
      expect(operations[0].operation).toBe('analysis');
      expect(operations[0].systemId).toBe('test-system');
      expect(operations[0].duration).toBe(5000);
      expect(operations[0].success).toBe(true);
    });

    test('logs failed operation', async () => {
      const operationId = await logAIOperation({
        operation: 'insights',
        duration: 2000,
        success: false,
        error: 'API timeout'
      });

      expect(operationId).toBeTruthy();

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('ai_operations');
      const operations = await collection.find({}).toArray();
      
      expect(operations[0].success).toBe(false);
      expect(operations[0].error).toBe('API timeout');
    });

    test('calculates cost automatically', async () => {
      await logAIOperation({
        operation: 'analysis',
        inputTokens: 1000,
        outputTokens: 500,
        model: 'gemini-2.5-flash'
      });

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('ai_operations');
      const operations = await collection.find({}).toArray();
      
      expect(operations[0].cost).toBeGreaterThan(0);
    });
  });

  describe('recordMetric', () => {
    test('records metric successfully', async () => {
      const metricId = await recordMetric({
        metricType: 'accuracy',
        metricName: 'extraction_accuracy',
        value: 95.5,
        unit: 'percent',
        systemId: 'test-system'
      });

      expect(metricId).toBeTruthy();

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('ai_metrics');
      const metrics = await collection.find({}).toArray();
      
      expect(metrics).toHaveLength(1);
      expect(metrics[0].metricType).toBe('accuracy');
      expect(metrics[0].value).toBe(95.5);
    });
  });

  describe('createAlert', () => {
    test('creates alert with correct severity', async () => {
      const alertId = await createAlert({
        severity: 'high',
        type: 'cost_spike',
        message: 'Cost exceeded threshold',
        metadata: { threshold: 10, actual: 15 }
      });

      expect(alertId).toBeTruthy();

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('anomaly_alerts');
      const alerts = await collection.find({}).toArray();
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('high');
      expect(alerts[0].type).toBe('cost_spike');
      expect(alerts[0].resolved).toBe(false);
    });

    test('defaults to medium severity if not specified', async () => {
      await createAlert({
        type: 'latency',
        message: 'High latency detected'
      });

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('anomaly_alerts');
      const alerts = await collection.find({}).toArray();
      
      expect(alerts[0].severity).toBe('medium');
    });
  });

  describe('resolveAlert', () => {
    test('resolves an existing alert', async () => {
      const alertId = await createAlert({
        type: 'error_rate',
        message: 'High error rate'
      });

      const resolved = await resolveAlert(alertId);
      expect(resolved).toBe(true);

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('anomaly_alerts');
      const alerts = await collection.find({}).toArray();
      
      expect(alerts[0].resolved).toBe(true);
      expect(alerts[0].resolvedAt).toBeTruthy();
    });
  });

  describe('trackFeedbackImplementation', () => {
    test('tracks pending feedback', async () => {
      const trackingId = await trackFeedbackImplementation({
        feedbackId: 'feedback-123',
        status: 'pending'
      });

      expect(trackingId).toBeTruthy();

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('feedback_tracking');
      const tracking = await collection.find({}).toArray();
      
      expect(tracking).toHaveLength(1);
      expect(tracking[0].status).toBe('pending');
    });

    test('tracks implemented feedback with effectiveness', async () => {
      await trackFeedbackImplementation({
        feedbackId: 'feedback-456',
        status: 'implemented',
        implementedAt: new Date().toISOString(),
        effectiveness: 85
      });

      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('feedback_tracking');
      const tracking = await collection.find({}).toArray();
      
      expect(tracking[0].status).toBe('implemented');
      expect(tracking[0].effectiveness).toBe(85);
    });
  });

  describe('getCostMetrics', () => {
    test('calculates cost metrics for a period', async () => {
      // Add some test operations
      await logAIOperation({
        operation: 'analysis',
        duration: 1000,
        tokensUsed: 1500,
        inputTokens: 1000,
        outputTokens: 500,
        success: true
      });

      await logAIOperation({
        operation: 'insights',
        duration: 2000,
        tokensUsed: 3000,
        inputTokens: 2000,
        outputTokens: 1000,
        success: true
      });

      const metrics = await getCostMetrics('daily');
      
      expect(metrics).toBeTruthy();
      expect(metrics.totalCost).toBeGreaterThan(0);
      expect(metrics.operationBreakdown.analysis.count).toBe(1);
      expect(metrics.operationBreakdown.insights.count).toBe(1);
    });

    test('returns zero metrics when no data', async () => {
      const metrics = await getCostMetrics('daily');
      
      expect(metrics.totalCost).toBe(0);
      expect(metrics.totalTokens).toBe(0);
      expect(metrics.averageCostPerOperation).toBe(0);
    });
  });

  describe('getRealtimeMetrics', () => {
    test('returns realtime metrics', async () => {
      const metrics = await getRealtimeMetrics();
      
      expect(metrics).toBeTruthy();
      expect(metrics).toHaveProperty('currentOperationsPerMinute');
      expect(metrics).toHaveProperty('averageLatency');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('circuitBreakerStatus');
    });

    test('calculates error rate correctly', async () => {
      // Add operations with some failures
      await logAIOperation({ operation: 'analysis', success: true, duration: 100 });
      await logAIOperation({ operation: 'analysis', success: true, duration: 200 });
      await logAIOperation({ operation: 'analysis', success: false, duration: 150, error: 'Timeout' });

      const metrics = await getRealtimeMetrics();
      
      expect(metrics.currentOperationsPerMinute).toBeGreaterThan(0);
      expect(metrics.averageLatency).toBeGreaterThan(0);
    });
  });

  describe('getModelPricing', () => {
    test('returns correct pricing for known models', () => {
      const flashPricing = getModelPricing('gemini-2.5-flash');
      expect(flashPricing.inputTokens).toBe(0.10 / 1_000_000);
      expect(flashPricing.outputTokens).toBe(0.40 / 1_000_000);
      
      const proPricing = getModelPricing('gemini-1.5-pro');
      expect(proPricing.inputTokens).toBe(1.25 / 1_000_000);
      expect(proPricing.outputTokens).toBe(5.00 / 1_000_000);
    });

    test('handles versioned model names via partial matching', () => {
      const pricing = getModelPricing('gemini-2.5-flash-001');
      expect(pricing.inputTokens).toBe(0.10 / 1_000_000);
      expect(pricing.outputTokens).toBe(0.40 / 1_000_000);
    });

    test('falls back to default pricing for unknown models', () => {
      const pricing = getModelPricing('unknown-model-xyz');
      expect(pricing.inputTokens).toBe(0.10 / 1_000_000);
      expect(pricing.outputTokens).toBe(0.40 / 1_000_000);
    });

    test('returns correct pricing for Gemini 3.0 models', () => {
      const gemini3Pricing = getModelPricing('gemini-3-pro-preview');
      expect(gemini3Pricing.inputTokens).toBe(2.00 / 1_000_000);
      expect(gemini3Pricing.outputTokens).toBe(12.00 / 1_000_000);
    });

    test('returns correct pricing for Gemini 2.0 Pro', () => {
      const gemini2ProPricing = getModelPricing('gemini-2.0-pro');
      expect(gemini2ProPricing.inputTokens).toBe(0.50 / 1_000_000);
      expect(gemini2ProPricing.outputTokens).toBe(5.00 / 1_000_000);
    });

    test('returns context-aware pricing for 1.5-pro with large context', () => {
      const standardPricing = getModelPricing('gemini-1.5-pro', 100000); // ≤128k
      expect(standardPricing.inputTokens).toBe(1.25 / 1_000_000);
      expect(standardPricing.outputTokens).toBe(5.00 / 1_000_000);
      expect(standardPricing.isLongContext).toBe(false);

      const longContextPricing = getModelPricing('gemini-1.5-pro', 200000); // >128k
      expect(longContextPricing.inputTokens).toBe(2.50 / 1_000_000);
      expect(longContextPricing.outputTokens).toBe(10.00 / 1_000_000);
      expect(longContextPricing.isLongContext).toBe(true);
    });

    test('returns context-aware pricing for 1.5-flash with large context', () => {
      const standardPricing = getModelPricing('gemini-1.5-flash', 100000); // ≤128k
      expect(standardPricing.inputTokens).toBe(0.075 / 1_000_000);
      expect(standardPricing.outputTokens).toBe(0.30 / 1_000_000);

      const longContextPricing = getModelPricing('gemini-1.5-flash', 200000); // >128k
      expect(longContextPricing.inputTokens).toBe(0.15 / 1_000_000);
      expect(longContextPricing.outputTokens).toBe(0.60 / 1_000_000);
    });

    test('returns context-aware pricing for 2.5-pro with large context', () => {
      const standardPricing = getModelPricing('gemini-2.5-pro', 100000); // ≤200k
      expect(standardPricing.inputTokens).toBe(1.25 / 1_000_000);
      expect(standardPricing.outputTokens).toBe(10.00 / 1_000_000);

      const longContextPricing = getModelPricing('gemini-2.5-pro', 250000); // >200k
      expect(longContextPricing.inputTokens).toBe(2.50 / 1_000_000);
      expect(longContextPricing.outputTokens).toBe(15.00 / 1_000_000);
    });
  });

  describe('getCurrentModelInfo', () => {
    const originalEnv = process.env.GEMINI_MODEL;

    afterEach(() => {
      // Restore original env
      if (originalEnv !== undefined) {
        process.env.GEMINI_MODEL = originalEnv;
      } else {
        delete process.env.GEMINI_MODEL;
      }
    });

    test('reads GEMINI_MODEL environment variable correctly', () => {
      process.env.GEMINI_MODEL = 'gemini-1.5-pro';
      const info = getCurrentModelInfo();
      
      expect(info.model).toBe('gemini-1.5-pro');
      expect(info.pricing.inputPerMillion).toBe(1.25);
      expect(info.pricing.outputPerMillion).toBe(5.00);
    });

    test('returns default model when env not set', () => {
      delete process.env.GEMINI_MODEL;
      const info = getCurrentModelInfo();
      
      expect(info.model).toBe('gemini-2.5-flash');
      expect(info.pricing.inputPerMillion).toBe(0.10);
      expect(info.pricing.outputPerMillion).toBe(0.40);
    });

    test('returns formatted pricing information', () => {
      process.env.GEMINI_MODEL = 'gemini-2.0-flash';
      const info = getCurrentModelInfo();
      
      expect(info).toHaveProperty('model');
      expect(info).toHaveProperty('pricing');
      expect(info.pricing).toHaveProperty('inputPerMillion');
      expect(info.pricing).toHaveProperty('outputPerMillion');
      expect(info.pricing).toHaveProperty('description');
    });
  });
});
