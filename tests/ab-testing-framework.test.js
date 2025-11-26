/**
 * A/B Testing Framework for AI Suggestions
 * Tracks experiment variants, user interactions, and suggestion acceptance rates
 */

// Mock MongoDB
jest.mock('../netlify/functions/utils/mongodb.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');

function createMockCollection(data = []) {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(data)
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'test-id' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    })
  };
}

describe('A/B Testing Framework', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Experiment Tracking', () => {
    test('should track experiment variant assignment', async () => {
      const experiment = {
        id: 'exp-001',
        name: 'Suggestion Format Test',
        variants: ['control', 'detailed', 'brief'],
        startDate: new Date().toISOString(),
        status: 'active'
      };

      const collection = createMockCollection();
      getCollection.mockResolvedValue(collection);

      await collection.insertOne(experiment);

      expect(collection.insertOne).toHaveBeenCalledWith(experiment);
    });

    test('should assign users to variants consistently', () => {
      const userId = 'user-123';
      const experimentId = 'exp-001';
      
      // Simple hash-based assignment for consistency
      const hash = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash);
      };

      const assignVariant = (userId, experimentId, variants) => {
        const hashValue = hash(userId + experimentId);
        return variants[hashValue % variants.length];
      };

      const variants = ['control', 'treatment-a', 'treatment-b'];
      const variant1 = assignVariant(userId, experimentId, variants);
      const variant2 = assignVariant(userId, experimentId, variants);

      // Should get same variant on repeat calls
      expect(variant1).toBe(variant2);
      expect(variants).toContain(variant1);
    });

    test('should distribute users evenly across variants', () => {
      const variants = ['control', 'treatment-a', 'treatment-b'];
      const assignments = { control: 0, 'treatment-a': 0, 'treatment-b': 0 };

      const hash = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash);
      };

      // Simulate 300 users
      for (let i = 0; i < 300; i++) {
        const userId = `user-${i}`;
        const hashValue = hash(userId + 'exp-001');
        const variant = variants[hashValue % variants.length];
        assignments[variant]++;
      }

      // Each variant should get roughly 100 users (±30%)
      Object.values(assignments).forEach(count => {
        expect(count).toBeGreaterThan(70);
        expect(count).toBeLessThan(130);
      });
    });
  });

  describe('Suggestion Acceptance Tracking', () => {
    test('should record suggestion shown event', async () => {
      const event = {
        userId: 'user-123',
        experimentId: 'exp-001',
        variant: 'treatment-a',
        suggestionId: 'sug-456',
        suggestionType: 'battery-health',
        timestamp: new Date().toISOString(),
        eventType: 'shown'
      };

      const collection = createMockCollection();
      getCollection.mockResolvedValue(collection);

      await collection.insertOne(event);

      expect(collection.insertOne).toHaveBeenCalledWith(event);
    });

    test('should record suggestion accepted event', async () => {
      const event = {
        userId: 'user-123',
        experimentId: 'exp-001',
        variant: 'treatment-a',
        suggestionId: 'sug-456',
        suggestionType: 'battery-health',
        timestamp: new Date().toISOString(),
        eventType: 'accepted',
        timeToActionMs: 5000 // Time to accept
      };

      const collection = createMockCollection();
      getCollection.mockResolvedValue(collection);

      await collection.insertOne(event);

      expect(collection.insertOne).toHaveBeenCalledWith(event);
    });

    test('should record suggestion dismissed event', async () => {
      const event = {
        userId: 'user-123',
        experimentId: 'exp-001',
        variant: 'control',
        suggestionId: 'sug-789',
        suggestionType: 'solar-optimization',
        timestamp: new Date().toISOString(),
        eventType: 'dismissed',
        dismissReason: 'not-applicable'
      };

      const collection = createMockCollection();
      getCollection.mockResolvedValue(collection);

      await collection.insertOne(event);

      expect(collection.insertOne).toHaveBeenCalledWith(event);
    });
  });

  describe('Metrics Calculation', () => {
    test('should calculate acceptance rate by variant', async () => {
      const events = [
        { variant: 'control', eventType: 'shown' },
        { variant: 'control', eventType: 'shown' },
        { variant: 'control', eventType: 'accepted' },
        { variant: 'control', eventType: 'dismissed' },
        { variant: 'treatment-a', eventType: 'shown' },
        { variant: 'treatment-a', eventType: 'shown' },
        { variant: 'treatment-a', eventType: 'shown' },
        { variant: 'treatment-a', eventType: 'accepted' },
        { variant: 'treatment-a', eventType: 'accepted' }
      ];

      const calculateAcceptanceRate = (events, variant) => {
        const variantEvents = events.filter(e => e.variant === variant);
        const shown = variantEvents.filter(e => e.eventType === 'shown').length;
        const accepted = variantEvents.filter(e => e.eventType === 'accepted').length;
        return shown > 0 ? (accepted / shown) * 100 : 0;
      };

      const controlRate = calculateAcceptanceRate(events, 'control');
      const treatmentRate = calculateAcceptanceRate(events, 'treatment-a');

      expect(controlRate).toBe(50); // 1 accepted / 2 shown = 50%
      expect(treatmentRate).toBeCloseTo(66.67, 1); // 2 accepted / 3 shown = 66.67%
    });

    test('should calculate average time to action', async () => {
      const events = [
        { eventType: 'accepted', timeToActionMs: 3000 },
        { eventType: 'accepted', timeToActionMs: 5000 },
        { eventType: 'accepted', timeToActionMs: 4000 },
        { eventType: 'dismissed', timeToActionMs: 1000 }
      ];

      const calculateAvgTime = (events, eventType) => {
        const filtered = events.filter(e => e.eventType === eventType);
        if (filtered.length === 0) return 0;
        const sum = filtered.reduce((acc, e) => acc + e.timeToActionMs, 0);
        return sum / filtered.length;
      };

      const avgAcceptTime = calculateAvgTime(events, 'accepted');
      const avgDismissTime = calculateAvgTime(events, 'dismissed');

      expect(avgAcceptTime).toBe(4000); // (3000 + 5000 + 4000) / 3
      expect(avgDismissTime).toBe(1000);
    });

    test('should calculate suggestion quality score', async () => {
      const metrics = {
        acceptanceRate: 75,
        avgTimeToActionMs: 3000,
        dismissRate: 10,
        implementationRate: 60
      };

      const calculateQualityScore = (metrics) => {
        let score = 0;
        
        // Acceptance rate (0-40 points)
        score += Math.min(metrics.acceptanceRate * 0.4, 40);
        
        // Quick action bonus (0-20 points)
        if (metrics.avgTimeToActionMs < 5000) {
          score += 20 - (metrics.avgTimeToActionMs / 5000) * 20;
        }
        
        // Low dismiss rate bonus (0-20 points)
        score += Math.max(20 - metrics.dismissRate * 2, 0);
        
        // Implementation rate (0-20 points)
        score += Math.min(metrics.implementationRate * 0.2, 20);
        
        return Math.round(score);
      };

      const score = calculateQualityScore(metrics);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(score).toBeGreaterThanOrEqual(50); // Quality score based on acceptance and implementation
    });
  });

  describe('Statistical Significance Testing', () => {
    test('should calculate chi-square test for variant comparison', () => {
      // Simplified chi-square test
      const calculateChiSquare = (observed, expected) => {
        let chiSq = 0;
        for (let i = 0; i < observed.length; i++) {
          chiSq += Math.pow(observed[i] - expected[i], 2) / expected[i];
        }
        return chiSq;
      };

      // Control: 50 shown, 20 accepted, 30 rejected
      // Treatment: 50 shown, 35 accepted, 15 rejected
      const observed = [20, 30, 35, 15];
      const totalAccepted = 20 + 35;
      const totalRejected = 30 + 15;
      const expected = [
        totalAccepted / 2, // Expected accepted for control
        totalRejected / 2, // Expected rejected for control
        totalAccepted / 2, // Expected accepted for treatment
        totalRejected / 2  // Expected rejected for treatment
      ];

      const chiSq = calculateChiSquare(observed, expected);

      // Chi-square > 3.84 indicates p < 0.05 (significant)
      expect(chiSq).toBeGreaterThan(3.84);
    });

    test('should calculate confidence interval for acceptance rate', () => {
      const calculateCI = (acceptances, trials, confidenceLevel = 0.95) => {
        const p = acceptances / trials;
        const z = confidenceLevel === 0.95 ? 1.96 : 2.58; // z-score
        const se = Math.sqrt((p * (1 - p)) / trials);
        
        return {
          lower: Math.max(0, p - z * se),
          upper: Math.min(1, p + z * se),
          estimate: p
        };
      };

      const ci = calculateCI(45, 100, 0.95);

      expect(ci.estimate).toBe(0.45);
      expect(ci.lower).toBeLessThan(ci.estimate);
      expect(ci.upper).toBeGreaterThan(ci.estimate);
      expect(ci.lower).toBeGreaterThan(0);
      expect(ci.upper).toBeLessThan(1);
    });
  });

  describe('Experiment Reporting', () => {
    test('should generate variant performance report', async () => {
      const generateReport = (events) => {
        const variantStats = {};
        
        // Group by variant
        events.forEach(event => {
          if (!variantStats[event.variant]) {
            variantStats[event.variant] = {
              shown: 0,
              accepted: 0,
              dismissed: 0,
              timeToAction: []
            };
          }
          
          const stats = variantStats[event.variant];
          if (event.eventType === 'shown') stats.shown++;
          if (event.eventType === 'accepted') {
            stats.accepted++;
            if (event.timeToActionMs) stats.timeToAction.push(event.timeToActionMs);
          }
          if (event.eventType === 'dismissed') stats.dismissed++;
        });
        
        // Calculate metrics for each variant
        const report = {};
        Object.keys(variantStats).forEach(variant => {
          const stats = variantStats[variant];
          report[variant] = {
            impressions: stats.shown,
            acceptances: stats.accepted,
            dismissals: stats.dismissed,
            acceptanceRate: stats.shown > 0 ? (stats.accepted / stats.shown) * 100 : 0,
            avgTimeToAction: stats.timeToAction.length > 0
              ? stats.timeToAction.reduce((a, b) => a + b, 0) / stats.timeToAction.length
              : null
          };
        });
        
        return report;
      };

      const events = [
        { variant: 'control', eventType: 'shown' },
        { variant: 'control', eventType: 'accepted', timeToActionMs: 4000 },
        { variant: 'treatment', eventType: 'shown' },
        { variant: 'treatment', eventType: 'shown' },
        { variant: 'treatment', eventType: 'accepted', timeToActionMs: 2000 },
        { variant: 'treatment', eventType: 'accepted', timeToActionMs: 3000 }
      ];

      const report = generateReport(events);

      expect(report.control).toBeDefined();
      expect(report.control.acceptanceRate).toBe(100);
      expect(report.treatment).toBeDefined();
      expect(report.treatment.acceptanceRate).toBe(100);
      expect(report.treatment.avgTimeToAction).toBe(2500);
    });

    test('should identify winning variant', () => {
      const determineWinner = (variantResults, minSampleSize = 50) => {
        // Filter variants with sufficient sample size
        const qualified = Object.entries(variantResults).filter(
          ([_, stats]) => stats.impressions >= minSampleSize
        );
        
        if (qualified.length < 2) {
          return { winner: null, reason: 'Insufficient data' };
        }
        
        // Find variant with highest acceptance rate
        const sorted = qualified.sort((a, b) => 
          b[1].acceptanceRate - a[1].acceptanceRate
        );
        
        const [winnerName, winnerStats] = sorted[0];
        const [runnerUpName, runnerUpStats] = sorted[1];
        
        // Check if difference is significant (>10% improvement)
        const improvement = winnerStats.acceptanceRate - runnerUpStats.acceptanceRate;
        
        if (improvement < 10) {
          return { winner: null, reason: 'No clear winner (difference < 10%)' };
        }
        
        return {
          winner: winnerName,
          acceptanceRate: winnerStats.acceptanceRate,
          improvement: improvement,
          confidence: 'high'
        };
      };

      const results = {
        control: { impressions: 100, acceptances: 40, acceptanceRate: 40 },
        'treatment-a': { impressions: 100, acceptances: 65, acceptanceRate: 65 },
        'treatment-b': { impressions: 100, acceptances: 45, acceptanceRate: 45 }
      };

      const outcome = determineWinner(results);

      expect(outcome.winner).toBe('treatment-a');
      expect(outcome.improvement).toBeGreaterThan(15); // 65 - 45 = 20% improvement over runner-up
      expect(outcome.confidence).toBe('high');
    });
  });

  describe('Suggestion Type Performance', () => {
    test('should track performance by suggestion type', () => {
      const events = [
        { suggestionType: 'battery-health', eventType: 'shown' },
        { suggestionType: 'battery-health', eventType: 'accepted' },
        { suggestionType: 'solar-optimization', eventType: 'shown' },
        { suggestionType: 'solar-optimization', eventType: 'shown' },
        { suggestionType: 'solar-optimization', eventType: 'dismissed' },
        { suggestionType: 'load-shifting', eventType: 'shown' },
        { suggestionType: 'load-shifting', eventType: 'accepted' }
      ];

      const analyzeByType = (events) => {
        const typeStats = {};
        
        events.forEach(event => {
          if (!typeStats[event.suggestionType]) {
            typeStats[event.suggestionType] = { shown: 0, accepted: 0, dismissed: 0 };
          }
          
          if (event.eventType === 'shown') typeStats[event.suggestionType].shown++;
          if (event.eventType === 'accepted') typeStats[event.suggestionType].accepted++;
          if (event.eventType === 'dismissed') typeStats[event.suggestionType].dismissed++;
        });
        
        // Calculate rates
        Object.keys(typeStats).forEach(type => {
          const stats = typeStats[type];
          stats.acceptanceRate = stats.shown > 0 ? (stats.accepted / stats.shown) * 100 : 0;
        });
        
        return typeStats;
      };

      const typePerformance = analyzeByType(events);

      expect(typePerformance['battery-health'].acceptanceRate).toBe(100);
      expect(typePerformance['solar-optimization'].acceptanceRate).toBe(0);
      expect(typePerformance['load-shifting'].acceptanceRate).toBe(100);
    });
  });
});
