/**
 * Tests for Usage Stats Endpoint
 * Tests the /usage-stats endpoint for AI cost monitoring and budget management
 */

// Store mock data per collection - must be defined before mocks
const mockCollections = new Map();

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs', () => {
  return {
    getCollection: jest.fn(async (name) => {
      if (!mockCollections.has(name)) {
        const items = [];
        mockCollections.set(name, {
          insertOne: jest.fn(async (doc) => {
            items.push(doc);
            return { insertedId: doc.id };
          }),
          findOne: jest.fn(async (query) => {
            return items.find(item => {
              if (query.month && item.month !== query.month) return false;
              if (query.alertType && item.alertType !== query.alertType) return false;
              return true;
            }) || null;
          }),
          find: jest.fn((query) => ({
            sort: jest.fn(() => ({
              limit: jest.fn(() => ({
                toArray: jest.fn(async () => {
                  let results = items;
                  if (query.type && query.type.$in) {
                    results = results.filter(item => query.type.$in.includes(item.type));
                  }
                  if (query.resolved !== undefined) {
                    results = results.filter(item => 
                      query.resolved.$ne !== undefined 
                        ? item.resolved !== query.resolved.$ne 
                        : item.resolved === query.resolved
                    );
                  }
                  return results.slice(0, 5);
                })
              }))
            })),
            toArray: jest.fn(async () => items)
          })),
          aggregate: jest.fn((pipeline) => ({
            toArray: jest.fn(async () => {
              // Return mock aggregation results based on the collection
              if (name === 'ai_operations') {
                const match = pipeline.find(p => p.$match);
                let filteredItems = items;
                
                if (match && match.$match.timestamp) {
                  const gte = match.$match.timestamp.$gte;
                  const lte = match.$match.timestamp.$lte;
                  filteredItems = items.filter(item => {
                    if (gte && item.timestamp < gte) return false;
                    if (lte && item.timestamp > lte) return false;
                    return true;
                  });
                }
                
                // Check if this is a grouping aggregation for budget status
                const group = pipeline.find(p => p.$group);
                if (group && group.$group._id === null) {
                  // Budget status aggregation
                  const result = {
                    totalCost: filteredItems.reduce((sum, i) => sum + (i.cost || 0), 0),
                    totalTokens: filteredItems.reduce((sum, i) => sum + (i.tokensUsed || 0), 0),
                    totalInputTokens: filteredItems.reduce((sum, i) => sum + (i.inputTokens || 0), 0),
                    totalOutputTokens: filteredItems.reduce((sum, i) => sum + (i.outputTokens || 0), 0),
                    operationCount: filteredItems.length,
                    analysisOps: filteredItems.filter(i => i.operation === 'analysis').length,
                    insightsOps: filteredItems.filter(i => i.operation === 'insights').length
                  };
                  return [result];
                }
                
                // Daily breakdown aggregation
                const dailyGroups = {};
                filteredItems.forEach(item => {
                  const date = item.timestamp ? item.timestamp.slice(0, 10) : 'unknown';
                  if (!dailyGroups[date]) {
                    dailyGroups[date] = {
                      date,
                      totalCost: 0,
                      totalInputTokens: 0,
                      totalOutputTokens: 0,
                      operationCount: 0,
                      successCount: 0,
                      errorCount: 0,
                      avgDuration: 0,
                      breakdown: { analysis: 0, insights: 0, feedback: 0 }
                    };
                  }
                  dailyGroups[date].totalCost += item.cost || 0;
                  dailyGroups[date].totalInputTokens += item.inputTokens || 0;
                  dailyGroups[date].totalOutputTokens += item.outputTokens || 0;
                  dailyGroups[date].operationCount++;
                  if (item.success) dailyGroups[date].successCount++;
                  else dailyGroups[date].errorCount++;
                  if (item.operation === 'analysis') dailyGroups[date].breakdown.analysis++;
                  if (item.operation === 'insights') dailyGroups[date].breakdown.insights++;
                });
                
                return Object.values(dailyGroups).map(g => ({
                  ...g,
                  successRate: g.operationCount > 0 
                    ? (g.successCount / g.operationCount) * 100 
                    : 0
                }));
              }
              return [];
            })
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

// Must require handler AFTER mocks are set up
const { handler } = require('../netlify/functions/usage-stats.cjs');

// Mock logger
jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })),
  createLoggerFromEvent: jest.fn(() => ({
    entry: jest.fn(),
    exit: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })),
  createTimer: jest.fn(() => ({
    end: jest.fn()
  }))
}));

// Mock CORS
jest.mock('../netlify/functions/utils/cors.cjs', () => ({
  getCorsHeaders: jest.fn(() => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  }))
}));

// Mock errors
jest.mock('../netlify/functions/utils/errors.cjs', () => ({
  errorResponse: jest.fn((status, code, message, details, headers) => ({
    statusCode: status,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: code, message, details })
  }))
}));

// Mock metrics-collector
jest.mock('../netlify/functions/utils/metrics-collector.cjs', () => ({
  getCostMetrics: jest.fn(async () => ({
    totalCost: 0.05,
    totalTokens: 10000,
    averageCostPerOperation: 0.005,
    operationBreakdown: {
      analysis: { count: 5, cost: 0.025 },
      insights: { count: 5, cost: 0.025 }
    }
  })),
  getRealtimeMetrics: jest.fn(async () => ({
    currentOperationsPerMinute: 2,
    averageLatency: 1500,
    errorRate: 0.05,
    circuitBreakerStatus: 'closed'
  })),
  createAlert: jest.fn(async () => 'alert-123')
}));

// Mock fetch for GitHub issue creation
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ number: 123, html_url: 'https://github.com/test/issues/123' })
  })
);

describe('Usage Stats Endpoint', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    mockCollections.clear();
    
    // Reset environment variables
    delete process.env.AI_MONTHLY_TOKEN_BUDGET;
    delete process.env.AI_MONTHLY_COST_BUDGET;
    delete process.env.AI_BUDGET_ALERT_THRESHOLD;
  });

  describe('HTTP Methods', () => {
    test('returns 200 for OPTIONS preflight request', async () => {
      const event = {
        httpMethod: 'OPTIONS',
        path: '/usage-stats'
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(200);
    });

    test('returns 405 for non-GET methods', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/usage-stats'
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(405);
    });
  });

  describe('Period Queries', () => {
    test('handles daily period query (default)', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(response.statusCode).toBe(200);
      expect(body.period).toBe('daily');
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('dailyBreakdown');
      expect(body).toHaveProperty('tokenBudget');
    });

    test('handles weekly period query', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: { period: 'weekly' }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(response.statusCode).toBe(200);
      expect(body.period).toBe('weekly');
    });

    test('handles monthly period query', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: { period: 'monthly' }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(response.statusCode).toBe(200);
      expect(body.period).toBe('monthly');
    });
  });

  describe('Custom Date Range Queries', () => {
    test('handles custom date range query', async () => {
      const startDate = '2024-01-01T00:00:00.000Z';
      const endDate = '2024-01-31T23:59:59.999Z';
      
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: { startDate, endDate }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(response.statusCode).toBe(200);
      expect(body.dateRange.start).toBe(new Date(startDate).toISOString());
      expect(body.dateRange.end).toBe(new Date(endDate).toISOString());
    });
  });

  describe('Budget Status', () => {
    test('returns budget status at /budget endpoint', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats/budget',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(response.statusCode).toBe(200);
      expect(body).toHaveProperty('tokenBudget');
      expect(body).toHaveProperty('costBudget');
      expect(body).toHaveProperty('status');
    });

    test('calculates healthy status when under threshold', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats/budget',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body.status).toBe('healthy');
    });

    test('uses default budget values when env vars not set', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats/budget',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body.tokenBudget.monthly).toBe(5_000_000); // Default 5M tokens
      expect(body.tokenBudget.alertThreshold).toBe(80); // Default 80%
    });

    test('respects custom budget environment variables', async () => {
      process.env.AI_MONTHLY_TOKEN_BUDGET = '1000000'; // 1M tokens
      process.env.AI_BUDGET_ALERT_THRESHOLD = '0.9'; // 90%
      
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats/budget',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body.tokenBudget.monthly).toBe(1_000_000);
      expect(body.tokenBudget.alertThreshold).toBe(90);
    });
  });

  describe('Response Structure', () => {
    test('includes tokenBudget at top level for frontend', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('tokenBudget');
      expect(body.tokenBudget).toHaveProperty('monthly');
      expect(body.tokenBudget).toHaveProperty('current');
      expect(body.tokenBudget).toHaveProperty('remaining');
      expect(body.tokenBudget).toHaveProperty('usagePercent');
    });

    test('includes costBudget at top level for frontend', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('costBudget');
      expect(body.costBudget).toHaveProperty('monthly');
      expect(body.costBudget).toHaveProperty('current');
      expect(body.costBudget).toHaveProperty('remaining');
      expect(body.costBudget).toHaveProperty('usagePercent');
    });

    test('includes legacy budget wrapper for backwards compatibility', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('budget');
      expect(body.budget).toHaveProperty('budget');
      expect(body.budget).toHaveProperty('status');
      expect(body.budget).toHaveProperty('recentAlerts');
    });

    test('includes operation breakdown', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('operationBreakdown');
      expect(body.operationBreakdown).toHaveProperty('analysis');
      expect(body.operationBreakdown).toHaveProperty('insights');
      expect(body.operationBreakdown).toHaveProperty('total');
    });

    test('includes realtime metrics', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body).toHaveProperty('realtime');
      expect(body.realtime).toHaveProperty('currentOperationsPerMinute');
      expect(body.realtime).toHaveProperty('averageLatency');
      expect(body.realtime).toHaveProperty('errorRate');
    });
  });

  describe('Budget Status States', () => {
    test('returns warning status when near threshold', async () => {
      // Add mock data that will trigger warning
      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('ai_operations');
      
      // Add operations totaling 4.5M tokens (90% of 5M default)
      collection._items.push({
        timestamp: new Date().toISOString(),
        tokensUsed: 4_500_000,
        inputTokens: 3_000_000,
        outputTokens: 1_500_000,
        cost: 0.5,
        operation: 'insights',
        success: true
      });
      
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats/budget',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body.status).toBe('warning');
      expect(body.tokenBudget.usagePercent).toBeGreaterThanOrEqual(80);
    });

    test('returns exceeded status when over budget', async () => {
      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('ai_operations');
      
      // Add operations totaling 6M tokens (120% of 5M default)
      collection._items.push({
        timestamp: new Date().toISOString(),
        tokensUsed: 6_000_000,
        inputTokens: 4_000_000,
        outputTokens: 2_000_000,
        cost: 1.0,
        operation: 'analysis',
        success: true
      });
      
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats/budget',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(body.status).toBe('exceeded');
      expect(body.tokenBudget.usagePercent).toBeGreaterThan(100);
    });
  });

  describe('Error Handling', () => {
    test('handles database errors gracefully', async () => {
      // Mock a database error
      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      getCollection.mockRejectedValueOnce(new Error('Database connection failed'));
      
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: {}
      };

      const response = await handler(event, {});
      
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('internal_error');
    });
  });

  describe('Daily Breakdown', () => {
    test('returns daily breakdown with correct structure', async () => {
      const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
      const collection = await getCollection('ai_operations');
      
      // Add some operations
      const today = new Date().toISOString().slice(0, 10);
      collection._items.push(
        {
          timestamp: `${today}T10:00:00.000Z`,
          tokensUsed: 1000,
          inputTokens: 700,
          outputTokens: 300,
          cost: 0.001,
          operation: 'analysis',
          success: true,
          duration: 1500
        },
        {
          timestamp: `${today}T11:00:00.000Z`,
          tokensUsed: 2000,
          inputTokens: 1400,
          outputTokens: 600,
          cost: 0.002,
          operation: 'insights',
          success: true,
          duration: 3000
        }
      );
      
      const event = {
        httpMethod: 'GET',
        path: '/usage-stats',
        queryStringParameters: { period: 'daily' }
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);
      
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(body.dailyBreakdown)).toBe(true);
    });
  });
});
