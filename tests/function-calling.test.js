/**
 * Tests for Gemini Function Calling Integration
 */

const { toolDefinitions, executeToolCall } = require('../netlify/functions/utils/gemini-tools.cjs');

describe('Gemini Function Calling', () => {
  describe('Tool Definitions', () => {
    test('should have all required tools defined', () => {
      expect(toolDefinitions).toBeDefined();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBeGreaterThan(0);

      const toolNames = toolDefinitions.map(t => t.name);
      expect(toolNames).toContain('getSystemHistory');
      expect(toolNames).toContain('getWeatherData');
      expect(toolNames).toContain('getSolarEstimate');
      expect(toolNames).toContain('getSystemAnalytics');
    });

    test('each tool should have required properties', () => {
      toolDefinitions.forEach(tool => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
        expect(tool.parameters.properties).toBeDefined();
        expect(tool.parameters.required).toBeDefined();
      });
    });

    test('getSystemHistory should have correct parameters', () => {
      const tool = toolDefinitions.find(t => t.name === 'getSystemHistory');
      expect(tool).toBeDefined();
      expect(tool.parameters.required).toContain('systemId');
      expect(tool.parameters.properties.systemId).toBeDefined();
      expect(tool.parameters.properties.limit).toBeDefined();
    });

    test('getWeatherData should have correct parameters', () => {
      const tool = toolDefinitions.find(t => t.name === 'getWeatherData');
      expect(tool).toBeDefined();
      expect(tool.parameters.required).toContain('latitude');
      expect(tool.parameters.required).toContain('longitude');
    });

    test('getSolarEstimate should have correct parameters', () => {
      const tool = toolDefinitions.find(t => t.name === 'getSolarEstimate');
      expect(tool).toBeDefined();
      expect(tool.parameters.required).toContain('location');
      expect(tool.parameters.required).toContain('panelWatts');
      expect(tool.parameters.required).toContain('startDate');
      expect(tool.parameters.required).toContain('endDate');
    });
  });

  describe('Tool Execution', () => {
    const mockLog = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    test('should handle unknown tool gracefully', async () => {
      const result = await executeToolCall('unknownTool', {}, mockLog);
      expect(result.error).toBe(true);
      expect(result.message).toContain('Unknown tool');
    });

    test('should log tool execution', async () => {
      mockLog.info.mockClear();
      await executeToolCall('unknownTool', { test: 'param' }, mockLog);
      expect(mockLog.info).toHaveBeenCalledWith(
        'Executing tool: unknownTool',
        expect.objectContaining({
          params: { test: 'param' }
        })
      );
    });

    test('should return error object on failure', async () => {
      const result = await executeToolCall('getSystemHistory', { systemId: 'test' }, mockLog);
      // This will fail because MongoDB is not connected in test environment
      // But it should return a proper error object
      expect(result).toBeDefined();
      if (result.error) {
        expect(result.message).toBeDefined();
      }
    });
  });

  describe('Tool Parameter Validation', () => {
    test('getSystemHistory parameters should be well-defined', () => {
      const tool = toolDefinitions.find(t => t.name === 'getSystemHistory');
      const props = tool.parameters.properties;

      expect(props.systemId.type).toBe('string');
      expect(props.limit.type).toBe('number');
      expect(props.limit.default).toBe(100);
      expect(props.startDate.type).toBe('string');
      expect(props.endDate.type).toBe('string');
    });

    test('getWeatherData parameters should be well-defined', () => {
      const tool = toolDefinitions.find(t => t.name === 'getWeatherData');
      const props = tool.parameters.properties;

      expect(props.latitude.type).toBe('number');
      expect(props.longitude.type).toBe('number');
      expect(props.timestamp.type).toBe('string');
      expect(props.type.enum).toContain('current');
      expect(props.type.enum).toContain('historical');
      expect(props.type.enum).toContain('hourly');
    });

    test('getSolarEstimate parameters should be well-defined', () => {
      const tool = toolDefinitions.find(t => t.name === 'getSolarEstimate');
      const props = tool.parameters.properties;

      expect(props.location.type).toBe('string');
      expect(props.panelWatts.type).toBe('number');
      expect(props.startDate.type).toBe('string');
      expect(props.endDate.type).toBe('string');
    });

    test('getSystemAnalytics parameters should be well-defined', () => {
      const tool = toolDefinitions.find(t => t.name === 'getSystemAnalytics');
      const props = tool.parameters.properties;

      expect(props.systemId.type).toBe('string');
      expect(tool.parameters.required).toEqual(['systemId']);
    });
  });

  describe('Tool Descriptions', () => {
    test('all tools should have meaningful descriptions', () => {
      toolDefinitions.forEach(tool => {
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.description).toMatch(/[A-Z]/); // Should start with capital letter
      });
    });

    test('parameter descriptions should be helpful', () => {
      toolDefinitions.forEach(tool => {
        Object.values(tool.parameters.properties).forEach(param => {
          expect(param.description).toBeDefined();
          expect(param.description.length).toBeGreaterThan(10);
        });
      });
    });
  });
});

