/**
 * Test suite for insights data availability enhancements
 * Verifies that Gemini receives accurate information about the full queryable date range
 */

const mockMongoDB = require('./mocks/mongodb.mock.js');

// Mock MongoDB before requiring the module
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn((name) => {
    const store = mockMongoDB.__store;
    if (!store[name]) store[name] = [];
    
    return {
      find: jest.fn((query, options) => ({
        sort: jest.fn(() => ({
          limit: jest.fn(() => ({
            project: jest.fn(() => ({
              toArray: jest.fn(async () => {
                const arr = store[name];
                const filtered = query.systemId ? arr.filter(doc => doc.systemId === query.systemId) : arr;
                
                // Handle timestamp range queries
                if (query.timestamp && query.timestamp.$gte && query.timestamp.$lte) {
                  return filtered.filter(doc => 
                    doc.timestamp >= query.timestamp.$gte && 
                    doc.timestamp <= query.timestamp.$lte
                  );
                }
                
                return filtered;
              })
            }))
          })),
          toArray: jest.fn(async () => {
            const arr = store[name];
            const filtered = query.systemId ? arr.filter(doc => doc.systemId === query.systemId) : arr;
            
            // Handle timestamp range queries
            if (query.timestamp && query.timestamp.$gte && query.timestamp.$lte) {
              return filtered.filter(doc => 
                doc.timestamp >= query.timestamp.$gte && 
                doc.timestamp <= query.timestamp.$lte
              ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            }
            
            return filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          })
        }))
      })),
      countDocuments: jest.fn(async (query) => {
        const arr = store[name];
        const filtered = query.systemId ? arr.filter(doc => doc.systemId === query.systemId) : arr;
        return filtered.length;
      }),
      findOne: jest.fn(async (query) => {
        const arr = store[name];
        return arr.find(doc => {
          if (query.id && doc.id !== query.id) return false;
          if (query.systemId && doc.systemId !== query.systemId) return false;
          return true;
        }) || null;
      })
    };
  })
}));

describe('Insights Data Availability Enhancement', () => {
  let mockLog;

  beforeEach(() => {
    // Clear all module caches to get fresh imports
    jest.resetModules();
    
    mockLog = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // Clear mock database
    const store = mockMongoDB.__store;
    store.history = [];
    store.systems = [];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getActualDataRange', () => {
    it('should query database for full date range of system data', async () => {
      const systemId = 'test-system-123';
      const store = mockMongoDB.__store;
      
      // Populate mock database with test data spanning multiple months
      store.history = [
        {
          systemId,
          timestamp: '2025-08-01T10:00:00Z',
          analysis: { overallVoltage: 52.1, stateOfCharge: 95 }
        },
        {
          systemId,
          timestamp: '2025-09-15T14:30:00Z',
          analysis: { overallVoltage: 51.8, stateOfCharge: 85 }
        },
        {
          systemId,
          timestamp: '2025-10-30T18:00:00Z',
          analysis: { overallVoltage: 51.5, stateOfCharge: 75 }
        },
        {
          systemId,
          timestamp: '2025-11-17T22:00:00Z',
          analysis: { overallVoltage: 51.2, stateOfCharge: 70 }
        }
      ];

      store.systems = [{
        id: systemId,
        name: 'Test System'
      }];

      const insightsGuru = require('../netlify/functions/utils/insights-guru.cjs');
      
      const contextData = {
        systemProfile: { id: systemId, name: 'Test System' },
        recentSnapshots: []
      };

      const { prompt } = await insightsGuru.buildGuruPrompt({
        analysisData: {},
        systemId,
        customPrompt: null,
        log: mockLog,
        context: contextData,
        mode: 'sync'
      });

      // Verify the prompt includes dates from the full range
      expect(prompt).toContain('2025-08');
      expect(prompt).toContain('2025-11');
      expect(prompt).toContain('FULL DATA RANGE AVAILABLE');
      // Should mention records are queryable
      expect(prompt).toContain('queryable');
    });

    it('should handle systems with no data gracefully', async () => {
      const systemId = 'empty-system';
      const store = mockMongoDB.__store;
      
      // No history records for this system
      store.history = [];
      store.systems = [{
        id: systemId,
        name: 'Empty System'
      }];

      const insightsGuru = require('../netlify/functions/utils/insights-guru.cjs');
      
      const contextData = {
        systemProfile: { id: systemId, name: 'Empty System' },
        recentSnapshots: []
      };

      const { prompt } = await insightsGuru.buildGuruPrompt({
        analysisData: {},
        systemId,
        customPrompt: null,
        log: mockLog,
        context: contextData,
        mode: 'sync'
      });

      // Should indicate no historical data
      expect(prompt).toContain('Current snapshot only');
    });

    it('should calculate correct day span for long date ranges', async () => {
      const systemId = 'long-range-system';
      const store = mockMongoDB.__store;
      
      // Create 6 months of data
      const startDate = new Date('2025-05-01T00:00:00Z');
      const endDate = new Date('2025-11-17T23:59:59Z');
      
      store.history = [
        {
          systemId,
          timestamp: startDate.toISOString(),
          analysis: { overallVoltage: 52.0, stateOfCharge: 90 }
        },
        {
          systemId,
          timestamp: endDate.toISOString(),
          analysis: { overallVoltage: 51.0, stateOfCharge: 80 }
        }
      ];

      store.systems = [{
        id: systemId,
        name: 'Long Range System'
      }];

      const insightsGuru = require('../netlify/functions/utils/insights-guru.cjs');
      
      const contextData = {
        systemProfile: { id: systemId },
        recentSnapshots: []
      };

      const { prompt } = await insightsGuru.buildGuruPrompt({
        analysisData: {},
        systemId,
        customPrompt: null,
        log: mockLog,
        context: contextData,
        mode: 'sync'
      });

      // Should have dates from the range
      expect(prompt).toContain('2025-05');
      expect(prompt).toContain('2025-11');
      expect(prompt).toContain('YOU HAVE FULL ACCESS TO ALL DATA');
    });
  });

  describe('Data Availability Prompt Enhancements', () => {
    it('should emphasize full data access in custom query mode', async () => {
      const systemId = 'test-system';
      const store = mockMongoDB.__store;
      
      store.history = [
        {
          systemId,
          timestamp: '2025-10-01T00:00:00Z',
          analysis: { overallVoltage: 52.0 }
        },
        {
          systemId,
          timestamp: '2025-11-15T00:00:00Z',
          analysis: { overallVoltage: 51.5 }
        }
      ];

      const insightsGuru = require('../netlify/functions/utils/insights-guru.cjs');
      
      const { prompt } = await insightsGuru.buildGuruPrompt({
        analysisData: {},
        systemId,
        customPrompt: 'Analyze the past 14 days',
        log: mockLog,
        mode: 'sync'
      });

      // Verify enhanced instructions are present
      expect(prompt).toContain('CUSTOM QUERY MODE - FULL DATA ACCESS ENABLED');
      expect(prompt).toContain('COMPLETE access to all historical data');
      expect(prompt).toContain('NEVER claim \'data not available\' without trying the tool first');
      expect(prompt).toContain('You have ALL the tools needed');
    });

    it('should include explicit warnings against claiming data unavailable', async () => {
      const systemId = 'test-system';
      const store = mockMongoDB.__store;
      
      store.history = [{
        systemId,
        timestamp: '2025-11-01T00:00:00Z',
        analysis: {}
      }];

      const insightsGuru = require('../netlify/functions/utils/insights-guru.cjs');
      
      const { prompt } = await insightsGuru.buildGuruPrompt({
        analysisData: {},
        systemId,
        customPrompt: 'Compare last week to this week',
        log: mockLog,
        mode: 'sync'
      });

      expect(prompt).toContain('NEVER RESPOND WITH \'DATA UNAVAILABLE\'');
      expect(prompt).toContain('YOU HAVE FULL ACCESS TO ALL HISTORICAL DATA');
      expect(prompt).toContain('The data exists and is queryable');
    });

    it('should provide clear systemId and date range information', async () => {
      const systemId = 'precise-system-id-12345';
      const store = mockMongoDB.__store;
      
      store.history = [
        {
          systemId,
          timestamp: '2025-09-01T00:00:00Z',
          analysis: {}
        },
        {
          systemId,
          timestamp: '2025-11-17T23:59:59Z',
          analysis: {}
        }
      ];

      const insightsGuru = require('../netlify/functions/utils/insights-guru.cjs');
      
      const { prompt } = await insightsGuru.buildGuruPrompt({
        analysisData: {},
        systemId,
        customPrompt: null,
        log: mockLog,
        mode: 'sync'
      });

      // Should show exact systemId
      expect(prompt).toContain(`"${systemId}"`);
      expect(prompt).toContain('USE THIS EXACT STRING IN ALL TOOL CALLS');
      
      // Should show full queryable range (dates should be present in some form)
      expect(prompt).toContain('QUERYABLE RANGE');
      expect(prompt).toContain('2025-09');
      expect(prompt).toContain('2025-11');
    });
  });

  describe('Comprehensive Data Access Message', () => {
    it('should include message about full data access at the start', async () => {
      const systemId = 'test-system';
      const store = mockMongoDB.__store;
      
      store.history = [{
        systemId,
        timestamp: '2025-11-01T00:00:00Z',
        analysis: {}
      }];

      const insightsGuru = require('../netlify/functions/utils/insights-guru.cjs');
      
      const { prompt } = await insightsGuru.buildGuruPrompt({
        analysisData: {},
        systemId,
        customPrompt: null,
        log: mockLog,
        mode: 'sync'
      });

      // Check for the critical message at the beginning
      expect(prompt).toContain('CRITICAL: You have FULL ACCESS to ALL historical data');
      expect(prompt).toContain('DO NOT limit yourself or claim \'data unavailable\'');
    });
  });
});
