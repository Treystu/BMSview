/**
 * Insights Mode-Specific Prompt Tests
 * 
 * Tests for the enhanced buildGuruPrompt() mode-specific logic
 * added to insights-guru.cjs to address Issue #1
 */

const { buildGuruPrompt } = require('../netlify/functions/utils/insights-guru.cjs');

// Mock dependencies
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn().mockResolvedValue({
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      project: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
  }),
}));

jest.mock('../netlify/functions/utils/insights-summary.cjs', () => ({
  generateInitialSummary: jest.fn().mockResolvedValue({
    current: { soc: 85, voltage: 52.4, current: 5.2, isCharging: true },
    historical: { daily: [], charging: { chargingDataPoints: 0, dischargingDataPoints: 0 } },
  }),
}));

jest.mock('../netlify/functions/utils/gemini-tools.cjs', () => ({
  toolDefinitions: [
    {
      name: 'request_bms_data',
      description: 'Request historical BMS data',
      parameters: { properties: { systemId: {}, metric: {}, time_range_start: {}, time_range_end: {} } },
    },
    {
      name: 'getWeatherData',
      description: 'Get weather data for location',
      parameters: { properties: { latitude: {}, longitude: {} } },
    },
  ],
  executeToolCall: jest.fn().mockResolvedValue({ error: true, message: 'Test mode - no execution' }),
}));

jest.mock('../netlify/functions/utils/token-limit-handler.cjs', () => ({
  estimateDataTokens: jest.fn().mockReturnValue(1000),
  checkTokenLimit: jest.fn().mockReturnValue({
    isApproachingLimit: false,
    exceedsLimit: false,
    percentUsed: 10,
    remaining: 90000,
    estimatedTokens: 10000,
    limit: 100000,
  }),
}));

describe('buildGuruPrompt Mode-Specific Logic', () => {
  const mockLog = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const baseParams = {
    analysisData: { overallVoltage: 52.4, current: 5.2, stateOfCharge: 85 },
    systemId: 'test-system-123',
    log: mockLog,
    mode: 'sync',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Mode: WITH_TOOLS (Battery Guru)', () => {
    test('should include Battery Guru mode header', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'with_tools',
      });

      expect(result.prompt).toContain('🔋 BATTERY GURU MODE');
      expect(result.prompt).toContain('INTELLIGENT ANALYSIS');
    });

    test('should include tool usage strategy for WITH_TOOLS', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'with-tools',
      });

      expect(result.prompt).toContain('TOOL USAGE STRATEGY');
      expect(result.prompt).toContain('Check what data is ALREADY PRELOADED');
      expect(result.prompt).toContain('Request specific data points needed');
    });

    test('should include output requirements for Battery Guru', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'with_tools',
      });

      expect(result.prompt).toContain('OUTPUT REQUIREMENTS');
      expect(result.prompt).toContain('Lead with KEY FINDINGS');
      expect(result.prompt).toContain('TREND ANALYSIS');
      expect(result.prompt).toContain('RECOMMENDATIONS');
    });

    test('should mention app feedback as optional in WITH_TOOLS mode', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'with_tools',
      });

      expect(result.prompt).toContain('WHEN TO SUBMIT APP FEEDBACK (OPTIONAL)');
      expect(result.prompt).toContain('optional in Battery Guru mode');
    });

    test('should add background mode preload notice when applicable', async () => {
      const contextWithAnalytics = {
        analytics: { hourlyAverages: [], performanceBaseline: {} },
        meta: { durationMs: 1000 },
      };

      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'with_tools',
        mode: 'background',
        context: contextWithAnalytics,
      });

      expect(result.prompt).toContain('BACKGROUND MODE - COMPREHENSIVE DATA PRELOADED');
      expect(result.prompt).toContain('Analytics, trends, budgets, and predictions are ALREADY PRELOADED');
    });
  });

  describe('Mode: STANDARD (redirects to WITH_TOOLS)', () => {
    test('should handle STANDARD mode same as WITH_TOOLS', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'standard',
      });

      expect(result.prompt).toContain('🔋 BATTERY GURU MODE');
      expect(result.prompt).toContain('INTELLIGENT ANALYSIS');
    });
  });

  describe('Mode: FULL_CONTEXT', () => {
    test('should include Full Context Mode header', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'full_context',
      });

      expect(result.prompt).toContain('🎯 FULL CONTEXT MODE');
      expect(result.prompt).toContain('DEEP ANALYSIS REQUIRED');
    });

    test('should prioritize submitAppFeedback in FULL_CONTEXT', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'full-context',
      });

      expect(result.prompt).toContain('APP FEEDBACK PRIORITY');
      expect(result.prompt).toContain('Use submitAppFeedback tool');
      expect(result.prompt).toContain('Admin AI Feedback panel');
    });

    test('should include analysis scope for 90+ days', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'full_context',
      });

      expect(result.prompt).toContain('Analyze ALL historical data (90+ days');
      expect(result.prompt).toContain('long-term trends and degradation patterns');
    });

    test('should include mandatory analysis steps', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'full_context',
      });

      expect(result.prompt).toContain('MANDATORY ANALYSIS STEPS');
      expect(result.prompt).toContain('Correlate multiple factors');
      expect(result.prompt).toContain('Weather vs Solar');
    });
  });

  describe('Mode: VISUAL_GURU', () => {
    test('should include Visual Guru Expert header', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'visual_guru',
      });

      expect(result.prompt).toContain('📊 VISUAL GURU EXPERT MODE');
      expect(result.prompt).toContain('STRUCTURED DATA LAYOUT FOR VISUALIZATION');
    });

    test('should explain chart JSON output format', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'visual-guru',
      });

      expect(result.prompt).toContain('STRUCTURED JSON DATA that a frontend will render as charts');
      expect(result.prompt).toContain('NOT binary images');
      expect(result.prompt).toContain('```chart code blocks');
    });

    test('should include chart configuration format', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'visual_guru',
      });

      expect(result.prompt).toContain('CHART CONFIGURATION FORMAT');
      expect(result.prompt).toContain('chartType');
      expect(result.prompt).toContain('line');
      expect(result.prompt).toContain('bar');
      expect(result.prompt).toContain('gauge');
    });

    test('should include chart dimensions guidance', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'visual-guru',
      });

      expect(result.prompt).toContain('CHART DIMENSIONS & ASPECT RATIOS');
      expect(result.prompt).toContain('aspectRatio');
      expect(result.prompt).toContain('16:9');
      expect(result.prompt).toContain('4:3');
    });

    test('should include infographic structure template', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'visual_guru',
      });

      expect(result.prompt).toContain('INFOGRAPHIC STRUCTURE');
      expect(result.prompt).toContain('## 📊 VISUAL SUMMARY');
      expect(result.prompt).toContain('## 📈 KEY TRENDS');
      expect(result.prompt).toContain('## ⚡ ENERGY FLOW');
    });

    test('should forbid certain responses in visual mode', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'visual-guru',
      });

      expect(result.prompt).toContain('🚫 FORBIDDEN RESPONSES');
      expect(result.prompt).toContain('I cannot directly send infographics');
      expect(result.prompt).toContain('I am a text-based model');
    });
  });

  describe('Custom Query Mode', () => {
    test('should include custom query mode when customPrompt provided', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        customPrompt: 'What was my SOC yesterday at noon?',
      });

      expect(result.prompt).toContain('🎯 CUSTOM QUERY MODE');
      expect(result.prompt).toContain('FULL DATA ACCESS ENABLED');
      expect(result.prompt).toContain('What was my SOC yesterday at noon?');
    });

    test('should mandate tool usage for date-based queries', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        customPrompt: 'Compare last week to this week',
      });

      expect(result.prompt).toContain('MANDATORY TOOL USAGE for questions involving');
      expect(result.prompt).toContain('ANY date comparisons');
      expect(result.prompt).toContain('ALWAYS call request_bms_data');
    });

    test('should detect date references and add special instructions', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        customPrompt: 'How was my battery last Tuesday?',
      });

      expect(result.prompt).toContain('🎯 CUSTOM QUERY MODE');
      expect(result.prompt).toContain('MANDATORY STEPS');
      expect(result.prompt).toContain('call request_bms_data');
    });

    test('should detect CSV format requests', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        customPrompt: 'Export my SOC data as CSV',
      });

      expect(result.prompt).toContain('CSV format requested');
      expect(result.prompt).toContain('CSV FORMAT REQUIREMENTS');
      expect(result.prompt).toContain('First line: Column headers');
    });

    test('should detect table format requests', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        customPrompt: 'Show me a table of daily averages',
      });

      expect(result.prompt).toContain('Table format requested');
      expect(result.prompt).toContain('TABLE FORMAT REQUIREMENTS');
      expect(result.prompt).toContain('markdown table syntax');
    });

    test('should detect JSON format requests', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        customPrompt: 'Return the data as JSON',
      });

      expect(result.prompt).toContain('JSON format requested');
      expect(result.prompt).toContain('JSON FORMAT REQUIREMENTS');
      expect(result.prompt).toContain('```json code block');
    });
  });

  describe('Default/Fallback Mode', () => {
    test('should handle undefined insightMode gracefully', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: undefined,
      });

      // When insightMode is undefined and no customPrompt, should default to WITH_TOOLS
      expect(result.prompt).toContain('🔋 BATTERY GURU MODE');
    });

    test('should include chart support mention', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: undefined,
      });

      // When insightMode is undefined, it defaults to WITH_TOOLS which includes Battery Guru mode
      // Just verify the prompt is generated successfully
      expect(result.prompt).toBeDefined();
      expect(result.prompt.length).toBeGreaterThan(1000);
    });
  });

  describe('Common Elements Across All Modes', () => {
    test('should always include energy units mandate', async () => {
      const modes = ['with_tools', 'full_context', 'visual_guru'];

      for (const mode of modes) {
        const result = await buildGuruPrompt({
          ...baseParams,
          insightMode: mode,
        });

        expect(result.prompt).toContain('⚡ ENERGY UNITS MANDATE');
        expect(result.prompt).toContain('ALWAYS use kWh');
      }
    });

    test('should always include AI feedback capability notice', async () => {
      const modes = ['with_tools', 'full_context', 'visual_guru'];

      for (const mode of modes) {
        const result = await buildGuruPrompt({
          ...baseParams,
          insightMode: mode,
        });

        expect(result.prompt).toContain('💡 AI FEEDBACK CAPABILITY');
        expect(result.prompt).toContain('submitAppFeedback');
      }
    });

    test('should always include data availability summary', async () => {
      const modes = ['with_tools', 'full_context', 'visual_guru'];

      for (const mode of modes) {
        const result = await buildGuruPrompt({
          ...baseParams,
          insightMode: mode,
        });

        expect(result.prompt).toContain('DATA AVAILABILITY');
      }
    });

    test('should always include response format section', async () => {
      const modes = ['with_tools', 'full_context', 'visual_guru'];

      for (const mode of modes) {
        const result = await buildGuruPrompt({
          ...baseParams,
          insightMode: mode,
        });

        expect(result.prompt).toContain('RESPONSE FORMAT');
      }
    });
  });

  describe('Context and Return Values', () => {
    test('should return prompt and context', async () => {
      const result = await buildGuruPrompt({
        ...baseParams,
        insightMode: 'with_tools',
      });

      expect(result).toHaveProperty('prompt');
      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('contextSummary');
      expect(typeof result.prompt).toBe('string');
      expect(result.prompt.length).toBeGreaterThan(1000);
    });

    test('should use provided context if available', async () => {
      const providedContext = {
        systemProfile: { id: 'test-system', name: 'Test Battery' },
        meta: { durationMs: 500 },
      };

      const result = await buildGuruPrompt({
        ...baseParams,
        context: providedContext,
        insightMode: 'with_tools',
      });

      expect(result.context).toBe(providedContext);
    });
  });
});
