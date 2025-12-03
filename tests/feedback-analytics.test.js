/**
 * Tests for Feedback Loop Metrics & Analytics
 * 
 * These tests cover:
 * - Implementation tracking
 * - ROI calculations
 * - Time-to-implementation metrics
 * - Effectiveness scoring
 * - User satisfaction metrics
 * - Data sanitization for privacy
 */

const {
  calculateAnalytics,
  calculateEffectivenessScore,
  calculateROIMetrics,
  daysBetween,
  calculateMedian,
  calculatePercentile,
  sanitizeAnalyticsResponse
} = require('../netlify/functions/feedback-analytics.cjs');

const {
  calculateBasicEffectivenessScore
} = require('../netlify/functions/update-feedback-status.cjs');

// Mock logger - must be defined inline to avoid hoisting issues
jest.mock('../netlify/functions/utils/logger.cjs', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    entry: jest.fn(),
    exit: jest.fn()
  }),
  createLoggerFromEvent: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    entry: jest.fn(),
    exit: jest.fn()
  }),
  createTimer: () => ({
    end: jest.fn()
  })
}));

describe('Feedback Analytics - Utility Functions', () => {
  describe('daysBetween', () => {
    it('should calculate days between two dates', () => {
      const start = '2024-01-01T00:00:00Z';
      const end = '2024-01-11T00:00:00Z';
      expect(daysBetween(start, end)).toBe(10);
    });

    it('should return 0 for same day', () => {
      const date = '2024-01-01T00:00:00Z';
      expect(daysBetween(date, date)).toBe(0);
    });

    it('should return null for invalid dates', () => {
      expect(daysBetween(null, '2024-01-01')).toBeNull();
      expect(daysBetween('2024-01-01', null)).toBeNull();
      expect(daysBetween(null, null)).toBeNull();
    });
  });

  describe('calculateMedian', () => {
    it('should calculate median for odd number of elements', () => {
      expect(calculateMedian([1, 2, 3, 4, 5])).toBe(3);
    });

    it('should calculate median for even number of elements', () => {
      expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
    });

    it('should return null for empty array', () => {
      expect(calculateMedian([])).toBeNull();
    });

    it('should handle single element', () => {
      expect(calculateMedian([42])).toBe(42);
    });
  });

  describe('calculatePercentile', () => {
    it('should calculate 90th percentile', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(calculatePercentile(arr, 90)).toBe(9);
    });

    it('should calculate 50th percentile (median)', () => {
      const arr = [1, 2, 3, 4, 5];
      expect(calculatePercentile(arr, 50)).toBe(3);
    });

    it('should return null for empty array', () => {
      expect(calculatePercentile([], 90)).toBeNull();
    });
  });
});

describe('Feedback Analytics - Effectiveness Scoring', () => {
  describe('calculateEffectivenessScore', () => {
    it('should calculate score with all metrics available', () => {
      const feedback = {
        id: 'test-1',
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-05T00:00:00Z',
        actualBenefitScore: 80,
        stabilityScore: 90
      };
      
      const score = calculateEffectivenessScore(feedback, []);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should factor in user satisfaction from surveys', () => {
      const feedback = {
        id: 'test-1',
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-03T00:00:00Z',
        stabilityScore: 80
      };
      
      const surveys = [
        { feedbackId: 'test-1', satisfactionScore: 5 },
        { feedbackId: 'test-1', satisfactionScore: 4 }
      ];
      
      const scoreWithSurveys = calculateEffectivenessScore(feedback, surveys);
      const scoreWithoutSurveys = calculateEffectivenessScore(feedback, []);
      
      // Score with positive surveys should be different
      expect(scoreWithSurveys).not.toBe(scoreWithoutSurveys);
    });

    it('should give higher score for faster implementation', () => {
      const fastFeedback = {
        id: 'fast',
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-02T00:00:00Z',
        stabilityScore: 80
      };
      
      const slowFeedback = {
        id: 'slow',
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-20T00:00:00Z',
        stabilityScore: 80
      };
      
      const fastScore = calculateEffectivenessScore(fastFeedback, []);
      const slowScore = calculateEffectivenessScore(slowFeedback, []);
      
      expect(fastScore).toBeGreaterThan(slowScore);
    });
  });

  describe('calculateBasicEffectivenessScore', () => {
    it('should calculate score from update data', () => {
      const updateData = {
        actualBenefitScore: 75,
        stabilityScore: 85
      };
      
      const score = calculateBasicEffectivenessScore(updateData);
      expect(score).toBe(80); // Average of 75 and 85
    });

    it('should handle performance improvement', () => {
      const updateData = {
        performanceImprovementPercent: 30
      };
      
      const score = calculateBasicEffectivenessScore(updateData);
      // 50 + 30 = 80
      expect(score).toBe(80);
    });

    it('should handle negative satisfaction change', () => {
      const updateData = {
        userSatisfactionChange: -20
      };
      
      const score = calculateBasicEffectivenessScore(updateData);
      // 50 + (-20/2) = 40
      expect(score).toBe(40);
    });

    it('should return null when no metrics provided', () => {
      const score = calculateBasicEffectivenessScore({});
      expect(score).toBeNull();
    });
  });
});

describe('Feedback Analytics - ROI Calculations', () => {
  describe('calculateROIMetrics', () => {
    it('should calculate ROI for implemented feedback', () => {
      const implementedFeedback = [
        {
          id: 'fb-1',
          category: 'performance',
          suggestion: {
            title: 'Optimize database queries',
            estimatedEffort: 'days',
            expectedBenefit: 'Faster load times'
          },
          actualBenefitScore: 80,
          implementationDate: '2024-01-10'
        },
        {
          id: 'fb-2',
          category: 'bug_report',
          suggestion: {
            title: 'Fix memory leak',
            estimatedEffort: 'hours',
            expectedBenefit: 'Improved stability'
          },
          actualBenefitScore: 90,
          implementationDate: '2024-01-15'
        }
      ];
      
      const roi = calculateROIMetrics(implementedFeedback);
      
      expect(roi.totalEstimatedSavings).toBeGreaterThan(0);
      expect(roi.averageROIScore).toBe(85); // Average of 80 and 90
      expect(roi.topROIImplementations).toHaveLength(2);
    });

    it('should sort implementations by savings', () => {
      const implementedFeedback = [
        {
          id: 'small',
          category: 'ui_ux',
          suggestion: { estimatedEffort: 'hours' }
        },
        {
          id: 'large',
          category: 'performance',
          suggestion: { estimatedEffort: 'weeks' }
        }
      ];
      
      const roi = calculateROIMetrics(implementedFeedback);
      
      // Performance with weeks effort should have higher savings
      expect(roi.topROIImplementations[0].category).toBe('performance');
    });

    it('should handle empty array', () => {
      const roi = calculateROIMetrics([]);
      
      expect(roi.totalEstimatedSavings).toBe(0);
      expect(roi.averageROIScore).toBe(0);
      expect(roi.topROIImplementations).toHaveLength(0);
    });
  });
});

describe('Feedback Analytics - Full Analytics Calculation', () => {
  const createMockCollection = (feedbackData) => ({
    find: jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue(feedbackData)
    }))
  });

  it('should return empty analytics for no feedback', async () => {
    const mockCollection = createMockCollection([]);
    const analytics = await calculateAnalytics(mockCollection);
    
    expect(analytics.totalFeedback).toBe(0);
    expect(analytics.implementationRate).toBe(0);
    expect(analytics.acceptanceRate).toBe(0);
  });

  it('should calculate correct acceptance rate', async () => {
    const feedbackData = [
      { id: '1', status: 'pending', priority: 'high', category: 'performance', timestamp: new Date().toISOString() },
      { id: '2', status: 'accepted', priority: 'medium', category: 'ui_ux', timestamp: new Date().toISOString() },
      { id: '3', status: 'implemented', priority: 'low', category: 'bug_report', timestamp: new Date().toISOString(), implementationDate: new Date().toISOString() },
      { id: '4', status: 'rejected', priority: 'high', category: 'optimization', timestamp: new Date().toISOString() }
    ];
    
    const mockCollection = createMockCollection(feedbackData);
    const analytics = await calculateAnalytics(mockCollection);
    
    // Acceptance = (accepted + implemented) / total = 2/4 = 50%
    expect(analytics.acceptanceRate).toBe(50);
  });

  it('should calculate implementation rate from accepted', async () => {
    const feedbackData = [
      { id: '1', status: 'accepted', priority: 'high', category: 'performance', timestamp: new Date().toISOString() },
      { id: '2', status: 'implemented', priority: 'medium', category: 'ui_ux', timestamp: new Date().toISOString(), implementationDate: new Date().toISOString() }
    ];
    
    const mockCollection = createMockCollection(feedbackData);
    const analytics = await calculateAnalytics(mockCollection);
    
    // Implementation = implemented / (accepted + implemented) = 1/2 = 50%
    expect(analytics.implementationRate).toBe(50);
  });

  it('should include enhanced implementation metrics', async () => {
    const feedbackData = [
      { 
        id: '1', 
        status: 'implemented', 
        priority: 'high', 
        category: 'performance', 
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-05T00:00:00Z',
        suggestion: { estimatedEffort: 'days' }
      },
      { 
        id: '2', 
        status: 'pending', 
        priority: 'high', 
        category: 'performance', 
        timestamp: new Date().toISOString(),
        suggestion: { estimatedEffort: 'days' }
      }
    ];
    
    const mockCollection = createMockCollection(feedbackData);
    const analytics = await calculateAnalytics(mockCollection);
    
    expect(analytics.implementationMetrics).toBeDefined();
    expect(analytics.implementationMetrics.byPriority.high).toBeDefined();
    expect(analytics.implementationMetrics.byPriority.high.rate).toBe(50); // 1/2
  });

  it('should include ROI summary', async () => {
    const feedbackData = [
      { 
        id: '1', 
        status: 'implemented', 
        priority: 'high', 
        category: 'performance', 
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-05T00:00:00Z',
        suggestion: { estimatedEffort: 'days', title: 'Test' },
        actualBenefitScore: 80
      }
    ];
    
    const mockCollection = createMockCollection(feedbackData);
    const analytics = await calculateAnalytics(mockCollection);
    
    expect(analytics.roiSummary).toBeDefined();
    expect(analytics.roiSummary.totalEstimatedSavings).toBeGreaterThan(0);
    expect(analytics.roiSummary.averageROIScore).toBe(80);
  });

  it('should include time-to-implementation metrics', async () => {
    const feedbackData = [
      { 
        id: '1', 
        status: 'implemented', 
        priority: 'critical', 
        category: 'bug_report', 
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-03T00:00:00Z'
      },
      { 
        id: '2', 
        status: 'implemented', 
        priority: 'low', 
        category: 'ui_ux', 
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-15T00:00:00Z'
      }
    ];
    
    const mockCollection = createMockCollection(feedbackData);
    const analytics = await calculateAnalytics(mockCollection);
    
    expect(analytics.timeToImplementation).toBeDefined();
    expect(analytics.timeToImplementation.averageDays).toBe(8); // (2 + 14) / 2 = 8
    expect(analytics.timeToImplementation.byPriority.critical).toBe(2);
    expect(analytics.timeToImplementation.byPriority.low).toBe(14);
  });

  it('should include effectiveness overview', async () => {
    const feedbackData = [
      { 
        id: '1', 
        status: 'implemented', 
        priority: 'high', 
        category: 'performance', 
        timestamp: '2024-01-01T00:00:00Z',
        implementationDate: '2024-01-03T00:00:00Z',
        stabilityScore: 90
      }
    ];
    
    const mockCollection = createMockCollection(feedbackData);
    const analytics = await calculateAnalytics(mockCollection);
    
    expect(analytics.effectivenessOverview).toBeDefined();
    expect(analytics.effectivenessOverview.scoreDistribution).toHaveLength(5);
  });

  it('should include monthly breakdown', async () => {
    const feedbackData = [
      { 
        id: '1', 
        status: 'implemented', 
        priority: 'high', 
        category: 'performance', 
        timestamp: new Date().toISOString(),
        implementationDate: new Date().toISOString()
      }
    ];
    
    const mockCollection = createMockCollection(feedbackData);
    const analytics = await calculateAnalytics(mockCollection);
    
    expect(analytics.monthlyBreakdown).toBeDefined();
    expect(analytics.monthlyBreakdown.length).toBe(12); // Last 12 months
  });

  it('should include user satisfaction metrics when surveys available', async () => {
    const feedbackData = [
      { 
        id: '1', 
        status: 'implemented', 
        priority: 'high', 
        category: 'performance', 
        timestamp: new Date().toISOString()
      }
    ];
    
    const surveysData = [
      { feedbackId: '1', surveyDate: new Date().toISOString(), satisfactionScore: 4, impactRating: 5, wouldRecommend: true }
    ];
    
    const mockFeedbackCollection = createMockCollection(feedbackData);
    const mockSurveysCollection = createMockCollection(surveysData);
    
    const analytics = await calculateAnalytics(mockFeedbackCollection, mockSurveysCollection);
    
    expect(analytics.userSatisfaction).toBeDefined();
    expect(analytics.userSatisfaction.surveyCount).toBe(1);
    expect(analytics.userSatisfaction.averageScore).toBe(4);
    expect(analytics.userSatisfaction.recommendations).toBe(1);
  });
});

describe('Feedback Analytics - Data Sanitization', () => {
  describe('sanitizeAnalyticsResponse', () => {
    it('should mask feedbackIds in ROI top implementations', () => {
      const analytics = {
        roiSummary: {
          topROIImplementations: [
            { feedbackId: 'sensitive-id-123', feedbackTitle: 'Test', category: 'performance' },
            { feedbackId: 'sensitive-id-456', feedbackTitle: 'Test 2', category: 'ui_ux' }
          ]
        }
      };
      
      const sanitized = sanitizeAnalyticsResponse(analytics);
      
      expect(sanitized.roiSummary.topROIImplementations[0].feedbackId).toBe('impl-1');
      expect(sanitized.roiSummary.topROIImplementations[1].feedbackId).toBe('impl-2');
      // Other fields should be preserved
      expect(sanitized.roiSummary.topROIImplementations[0].feedbackTitle).toBe('Test');
    });

    it('should mask feedbackIds in effectiveness top performers', () => {
      const analytics = {
        effectivenessOverview: {
          topPerformers: [
            { feedbackId: 'top-secret-1', totalScore: 95 }
          ],
          bottomPerformers: [
            { feedbackId: 'bottom-secret-1', totalScore: 25 }
          ]
        }
      };
      
      const sanitized = sanitizeAnalyticsResponse(analytics);
      
      expect(sanitized.effectivenessOverview.topPerformers[0].feedbackId).toBe('top-1');
      expect(sanitized.effectivenessOverview.bottomPerformers[0].feedbackId).toBe('bottom-1');
      // Scores should be preserved
      expect(sanitized.effectivenessOverview.topPerformers[0].totalScore).toBe(95);
    });

    it('should remove userId from satisfaction trend data', () => {
      const analytics = {
        userSatisfaction: {
          satisfactionTrend: [
            { month: '2024-01', avgScore: 4.5, count: 10, userId: 'user-123' },
            { month: '2024-02', avgScore: 4.2, count: 8 }
          ]
        }
      };
      
      const sanitized = sanitizeAnalyticsResponse(analytics);
      
      expect(sanitized.userSatisfaction.satisfactionTrend[0].userId).toBeUndefined();
      expect(sanitized.userSatisfaction.satisfactionTrend[0].month).toBe('2024-01');
      expect(sanitized.userSatisfaction.satisfactionTrend[0].avgScore).toBe(4.5);
    });

    it('should preserve aggregate statistics unchanged', () => {
      const analytics = {
        totalFeedback: 100,
        acceptanceRate: 75.5,
        implementationRate: 60,
        byStatus: { pending: 20, implemented: 60, rejected: 20 },
        byPriority: { high: 30, medium: 50, low: 20 }
      };
      
      const sanitized = sanitizeAnalyticsResponse(analytics);
      
      expect(sanitized.totalFeedback).toBe(100);
      expect(sanitized.acceptanceRate).toBe(75.5);
      expect(sanitized.implementationRate).toBe(60);
      expect(sanitized.byStatus).toEqual(analytics.byStatus);
      expect(sanitized.byPriority).toEqual(analytics.byPriority);
    });

    it('should handle missing optional fields gracefully', () => {
      const analytics = {
        totalFeedback: 50
        // No roiSummary, effectivenessOverview, or userSatisfaction
      };
      
      const sanitized = sanitizeAnalyticsResponse(analytics);
      
      expect(sanitized.totalFeedback).toBe(50);
      expect(sanitized.roiSummary).toBeUndefined();
    });
  });
});

describe('Feedback Analytics - Authentication & Authorization', () => {
  let handler;
  let mockGetCollection;
  let mockLogger;
  
  // Sample feedback data for comprehensive testing
  const sampleFeedback = [
    {
      id: 'fb-001',
      status: 'implemented',
      priority: 'critical',
      category: 'bug_report',
      timestamp: '2024-01-01T00:00:00Z',
      implementationDate: '2024-01-03T00:00:00Z',
      suggestion: { title: 'Fix memory leak', estimatedEffort: 'days', expectedBenefit: 'Stability' },
      actualBenefitScore: 90,
      stabilityScore: 95,
      effectivenessScore: 88
    },
    {
      id: 'fb-002',
      status: 'implemented',
      priority: 'high',
      category: 'performance',
      timestamp: '2024-01-05T00:00:00Z',
      implementationDate: '2024-01-08T00:00:00Z',
      suggestion: { title: 'Optimize queries', estimatedEffort: 'hours', expectedBenefit: 'Speed' },
      actualBenefitScore: 75,
      stabilityScore: 85,
      effectivenessScore: 72
    },
    {
      id: 'fb-003',
      status: 'pending',
      priority: 'medium',
      category: 'ui_ux',
      timestamp: '2024-01-10T00:00:00Z',
      suggestion: { title: 'Improve dashboard', estimatedEffort: 'weeks', expectedBenefit: 'UX' }
    },
    {
      id: 'fb-004',
      status: 'rejected',
      priority: 'low',
      category: 'analytics',
      timestamp: '2024-01-12T00:00:00Z',
      suggestion: { title: 'Add tracking', estimatedEffort: 'days', expectedBenefit: 'Insights' }
    }
  ];

  const sampleSurveys = [
    { feedbackId: 'fb-001', surveyDate: '2024-01-10T00:00:00Z', satisfactionScore: 5, impactRating: 5, wouldRecommend: true },
    { feedbackId: 'fb-002', surveyDate: '2024-01-15T00:00:00Z', satisfactionScore: 4, impactRating: 4, wouldRecommend: true }
  ];

  beforeEach(() => {
    jest.resetModules();
    
    // Create comprehensive MongoDB mock
    mockGetCollection = jest.fn().mockImplementation((collectionName) => {
      const collections = {
        'ai_feedback': sampleFeedback,
        'satisfaction_surveys': sampleSurveys
      };
      
      return Promise.resolve({
        find: jest.fn(() => ({
          toArray: jest.fn().mockResolvedValue(collections[collectionName] || [])
        }))
      });
    });
    
    jest.doMock('../netlify/functions/utils/mongodb.cjs', () => ({
      getCollection: mockGetCollection
    }));
    
    // Mock CORS with realistic headers
    jest.doMock('../netlify/functions/utils/cors.cjs', () => ({
      getCorsHeaders: jest.fn().mockReturnValue({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      })
    }));
    
    // Track logger calls for audit verification
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      entry: jest.fn(),
      exit: jest.fn()
    };
    
    jest.doMock('../netlify/functions/utils/logger.cjs', () => ({
      createLogger: jest.fn().mockReturnValue(mockLogger),
      createLoggerFromEvent: jest.fn().mockReturnValue(mockLogger),
      createTimer: jest.fn().mockReturnValue({
        end: jest.fn()
      })
    }));
    
    handler = require('../netlify/functions/feedback-analytics.cjs').handler;
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const mockEvent = {
    httpMethod: 'GET',
    path: '/.netlify/functions/feedback-analytics'
  };

  describe('Authentication Checks', () => {
    it('should reject unauthenticated requests with 401 and proper error message', async () => {
      const context = {}; // No clientContext
      
      const response = await handler(mockEvent, context);
      
      expect(response.statusCode).toBe(401);
      expect(response.headers['Content-Type']).toBe('application/json');
      
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication required');
      expect(body.message).toContain('authentication');
      expect(body.message).toContain('Admin Dashboard');
      
      // Verify audit log was called
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unauthorized access attempt to feedback analytics',
        expect.objectContaining({
          hasContext: false,
          path: expect.any(String)
        })
      );
      
      // Verify DB was NOT accessed
      expect(mockGetCollection).not.toHaveBeenCalled();
    });

    it('should reject requests with null user', async () => {
      const context = { clientContext: { user: null } };
      
      const response = await handler(mockEvent, context);
      
      expect(response.statusCode).toBe(401);
      expect(mockGetCollection).not.toHaveBeenCalled();
    });

    it('should reject requests with undefined clientContext', async () => {
      const context = { clientContext: undefined };
      
      const response = await handler(mockEvent, context);
      
      expect(response.statusCode).toBe(401);
    });
  });

  describe('Authentication - Any Authenticated User Allowed', () => {
    it('should allow any authenticated user (no role check)', async () => {
      const context = {
        clientContext: {
          user: { 
            email: 'regular.user@example.com', 
            sub: 'user-regular-123',
            app_metadata: { roles: ['viewer', 'editor'] }, // No admin role
            user_metadata: { role: 'member' }
          }
        }
      };
      
      const response = await handler(mockEvent, context);
      
      // Should succeed - any authenticated user can access from admin page
      expect(response.statusCode).toBe(200);
      expect(mockGetCollection).toHaveBeenCalledWith('ai_feedback');
      
      // Verify success audit log
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authenticated user accessing feedback analytics',
        expect.objectContaining({
          userEmail: 'regular.user@example.com',
          userId: 'user-regular-123'
        })
      );
    });

    it('should allow user with empty metadata', async () => {
      const context = {
        clientContext: {
          user: { 
            email: 'empty@example.com', 
            sub: 'user-empty',
            app_metadata: {},
            user_metadata: {}
          }
        }
      };
      
      const response = await handler(mockEvent, context);
      
      // Should succeed - metadata doesn't matter, only authentication
      expect(response.statusCode).toBe(200);
    });

    it('should allow user with null metadata', async () => {
      const context = {
        clientContext: {
          user: { 
            email: 'null@example.com', 
            sub: 'user-null',
            app_metadata: null,
            user_metadata: null
          }
        }
      };
      
      const response = await handler(mockEvent, context);
      
      // Should succeed - metadata doesn't matter, only authentication
      expect(response.statusCode).toBe(200);
    });

    it('should allow user with admin role in app_metadata', async () => {
      const context = {
        clientContext: {
          user: { 
            email: 'admin.roles@example.com', 
            sub: 'admin-roles-123',
            app_metadata: { roles: ['editor', 'admin', 'reviewer'] },
            user_metadata: {}
          }
        }
      };
      
      const response = await handler(mockEvent, context);
      
      expect(response.statusCode).toBe(200);
      expect(mockGetCollection).toHaveBeenCalledWith('ai_feedback');
      
      // Verify success audit log
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authenticated user accessing feedback analytics',
        expect.objectContaining({
          userEmail: 'admin.roles@example.com',
          userId: 'admin-roles-123'
        })
      );
    });

    it('should allow user with admin role in user_metadata', async () => {
      const context = {
        clientContext: {
          user: { 
            email: 'admin.metadata@example.com', 
            sub: 'admin-metadata-456',
            app_metadata: {},
            user_metadata: { role: 'admin' }
          }
        }
      };
      
      const response = await handler(mockEvent, context);
      
      expect(response.statusCode).toBe(200);
      expect(mockGetCollection).toHaveBeenCalledWith('ai_feedback');
    });

    it('should allow user with admin in both metadata locations', async () => {
      const context = {
        clientContext: {
          user: { 
            email: 'super.admin@example.com', 
            sub: 'super-admin-789',
            app_metadata: { roles: ['admin', 'super_admin'] },
            user_metadata: { role: 'admin' }
          }
        }
      };
      
      const response = await handler(mockEvent, context);
      
      expect(response.statusCode).toBe(200);
    });
  });

  describe('Successful Response Structure', () => {
    const authenticatedContext = {
      clientContext: {
        user: { 
          email: 'user@example.com', 
          sub: 'user-test',
          app_metadata: {},
          user_metadata: {}
        }
      }
    };

    it('should return complete analytics structure for authenticated user', async () => {
      const response = await handler(mockEvent, authenticatedContext);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Verify top-level structure
      expect(body).toHaveProperty('totalFeedback');
      expect(body).toHaveProperty('acceptanceRate');
      expect(body).toHaveProperty('implementationRate');
      expect(body).toHaveProperty('surveysAvailable');
      expect(body).toHaveProperty('lastUpdated');
      
      // Verify nested structures
      expect(body).toHaveProperty('byStatus');
      expect(body).toHaveProperty('byPriority');
      expect(body).toHaveProperty('implementationMetrics');
      expect(body).toHaveProperty('roiSummary');
      expect(body).toHaveProperty('timeToImplementation');
      expect(body).toHaveProperty('effectivenessOverview');
      expect(body).toHaveProperty('monthlyBreakdown');
    });

    it('should include surveysAvailable flag indicating data availability', async () => {
      const response = await handler(mockEvent, authenticatedContext);
      const body = JSON.parse(response.body);
      
      expect(typeof body.surveysAvailable).toBe('boolean');
      expect(body.surveysAvailable).toBe(true); // Mock returns survey data
    });

    it('should calculate correct statistics from sample data', async () => {
      const response = await handler(mockEvent, authenticatedContext);
      const body = JSON.parse(response.body);
      
      // 4 total feedback items
      expect(body.totalFeedback).toBe(4);
      
      // 2 implemented out of 4 = 50% acceptance
      // Actually: 2 implemented + 0 accepted = 2 accepted/implemented, 1 rejected, 1 pending
      expect(body.byStatus.implemented).toBe(2);
      expect(body.byStatus.pending).toBe(1);
      expect(body.byStatus.rejected).toBe(1);
    });

    it('should sanitize feedbackIds in ROI data for security', async () => {
      const response = await handler(mockEvent, authenticatedContext);
      const body = JSON.parse(response.body);
      
      if (body.roiSummary?.topROIImplementations?.length > 0) {
        body.roiSummary.topROIImplementations.forEach((impl, idx) => {
          // Should be masked as impl-1, impl-2, etc.
          expect(impl.feedbackId).toBe(`impl-${idx + 1}`);
          // Original IDs should NOT be present
          expect(impl.feedbackId).not.toMatch(/^fb-/);
        });
      }
    });

    it('should sanitize feedbackIds in effectiveness data', async () => {
      const response = await handler(mockEvent, authenticatedContext);
      const body = JSON.parse(response.body);
      
      if (body.effectivenessOverview?.topPerformers?.length > 0) {
        body.effectivenessOverview.topPerformers.forEach((perf, idx) => {
          expect(perf.feedbackId).toBe(`top-${idx + 1}`);
        });
      }
      
      if (body.effectivenessOverview?.bottomPerformers?.length > 0) {
        body.effectivenessOverview.bottomPerformers.forEach((perf, idx) => {
          expect(perf.feedbackId).toBe(`bottom-${idx + 1}`);
        });
      }
    });

    it('should include user satisfaction metrics when surveys available', async () => {
      const response = await handler(mockEvent, authenticatedContext);
      const body = JSON.parse(response.body);
      
      expect(body.userSatisfaction).toBeDefined();
      expect(body.userSatisfaction.surveyCount).toBe(2);
      expect(body.userSatisfaction.averageScore).toBeCloseTo(4.5, 1);
      expect(body.userSatisfaction.recommendations).toBe(2);
    });
  });

  describe('HTTP Method Handling', () => {
    it('should handle OPTIONS preflight requests without auth', async () => {
      const optionsEvent = { ...mockEvent, httpMethod: 'OPTIONS' };
      const context = {}; // No auth needed for preflight
      
      const response = await handler(optionsEvent, context);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Origin']).toBeDefined();
    });

    it('should reject POST requests with 405', async () => {
      const postEvent = { ...mockEvent, httpMethod: 'POST', body: '{}' };
      const context = {};
      
      const response = await handler(postEvent, context);
      
      expect(response.statusCode).toBe(405);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Method not allowed');
    });

    it('should reject PUT requests with 405', async () => {
      const putEvent = { ...mockEvent, httpMethod: 'PUT', body: '{}' };
      const context = {};
      
      const response = await handler(putEvent, context);
      
      expect(response.statusCode).toBe(405);
    });

    it('should reject DELETE requests with 405', async () => {
      const deleteEvent = { ...mockEvent, httpMethod: 'DELETE' };
      const context = {};
      
      const response = await handler(deleteEvent, context);
      
      expect(response.statusCode).toBe(405);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 with error details when MongoDB fails', async () => {
      // Override mock to simulate DB failure
      jest.resetModules();
      jest.doMock('../netlify/functions/utils/mongodb.cjs', () => ({
        getCollection: jest.fn().mockRejectedValue(new Error('Connection timeout'))
      }));
      jest.doMock('../netlify/functions/utils/cors.cjs', () => ({
        getCorsHeaders: jest.fn().mockReturnValue({ 'Access-Control-Allow-Origin': '*' })
      }));
      jest.doMock('../netlify/functions/utils/logger.cjs', () => ({
        createLogger: jest.fn().mockReturnValue(mockLogger),
        createLoggerFromEvent: jest.fn().mockReturnValue(mockLogger),
        createTimer: jest.fn().mockReturnValue({
          end: jest.fn()
        })
      }));
      
      const failHandler = require('../netlify/functions/feedback-analytics.cjs').handler;
      
      const authenticatedContext = {
        clientContext: {
          user: { 
            email: 'admin@example.com', 
            sub: 'admin-error',
            app_metadata: { roles: ['admin'] }
          }
        }
      };
      
      const response = await failHandler(mockEvent, authenticatedContext);
      
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Failed to calculate feedback analytics');
      expect(body.message).toContain('Connection timeout');
      
      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle surveys collection unavailable gracefully', async () => {
      jest.resetModules();
      
      // Mock where ai_feedback works but satisfaction_surveys fails
      jest.doMock('../netlify/functions/utils/mongodb.cjs', () => ({
        getCollection: jest.fn().mockImplementation((name) => {
          if (name === 'ai_feedback') {
            return Promise.resolve({
              find: jest.fn(() => ({
                toArray: jest.fn().mockResolvedValue(sampleFeedback)
              }))
            });
          }
          // Surveys collection fails
          return Promise.reject(new Error('Collection not found'));
        })
      }));
      jest.doMock('../netlify/functions/utils/cors.cjs', () => ({
        getCorsHeaders: jest.fn().mockReturnValue({ 'Access-Control-Allow-Origin': '*' })
      }));
      jest.doMock('../netlify/functions/utils/logger.cjs', () => ({
        createLogger: jest.fn().mockReturnValue(mockLogger),
        createLoggerFromEvent: jest.fn().mockReturnValue(mockLogger),
        createTimer: jest.fn().mockReturnValue({
          end: jest.fn()
        })
      }));
      
      const gracefulHandler = require('../netlify/functions/feedback-analytics.cjs').handler;
      
      const authenticatedContext = {
        clientContext: {
          user: { 
            email: 'admin@example.com', 
            sub: 'admin-graceful',
            app_metadata: { roles: ['admin'] }
          }
        }
      };
      
      const response = await gracefulHandler(mockEvent, authenticatedContext);
      
      // Should still succeed, just without survey data
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.surveysAvailable).toBe(false);
      expect(body.userSatisfaction.surveyCount).toBe(0);
    });
  });

  describe('Audit Logging', () => {
    it('should log successful user access with user details', async () => {
      const authenticatedContext = {
        clientContext: {
          user: { 
            email: 'audit.user@example.com', 
            sub: 'audit-user-123',
            app_metadata: {}
          }
        }
      };
      
      await handler(mockEvent, authenticatedContext);
      
      // Verify access was logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authenticated user accessing feedback analytics',
        expect.objectContaining({
          userEmail: 'audit.user@example.com',
          userId: 'audit-user-123'
        })
      );
      
      // Verify success was logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Analytics calculated successfully',
        expect.objectContaining({
          totalFeedback: expect.any(Number),
          userEmail: 'audit.user@example.com',
          surveysAvailable: expect.any(Boolean)
        })
      );
    });

    it('should log failed auth attempts with request details', async () => {
      const context = {};
      
      await handler(mockEvent, context);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unauthorized access attempt to feedback analytics',
        expect.objectContaining({
          hasContext: false,
          path: expect.stringContaining('feedback-analytics')
        })
      );
    });
  });
});
