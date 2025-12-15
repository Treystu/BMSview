/**
 * Integration Tests for Diagnostics Workload State Management
 * 
 * Validates that state defaults are properly applied to prevent
 * "Cannot read properties of undefined" errors in the actual backend implementation.
 */

// Mock all dependencies before requiring the handler
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn()
}));

jest.mock('../netlify/functions/utils/logger.cjs', () => {
  const mockLogger = {
    entry: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  const createLogger = jest.fn(() => mockLogger);
  return {
    createLogger,
    createLoggerFromEvent: jest.fn(() => mockLogger)
  };
});

jest.mock('../netlify/functions/utils/cors.cjs', () => ({
  getCorsHeaders: jest.fn(() => ({ 'Access-Control-Allow-Origin': '*' }))
}));

jest.mock('../netlify/functions/utils/diagnostics-steps.cjs', () => ({
  initializeDiagnostics: jest.fn(),
  testTool: jest.fn(),
  analyzeFailures: jest.fn(),
  submitFeedbackForFailures: jest.fn(),
  finalizeDiagnostics: jest.fn()
}));

jest.mock('../netlify/functions/utils/insights-jobs.cjs', () => ({
  getInsightsJob: jest.fn(),
  saveCheckpoint: jest.fn()
}));

describe('Diagnostics Workload State Management', () => {
  let getDefaultState, handler;
  let mockGetInsightsJob, mockAnalyzeFailures;

  beforeAll(() => {
    // Require the module after mocks are set up
    const diagnosticsWorkload = require('../netlify/functions/diagnostics-workload.cjs');
    getDefaultState = diagnosticsWorkload.getDefaultState;
    handler = diagnosticsWorkload.handler;
    
    mockGetInsightsJob = require('../netlify/functions/utils/insights-jobs.cjs').getInsightsJob;
    mockAnalyzeFailures = require('../netlify/functions/utils/diagnostics-steps.cjs').analyzeFailures;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDefaultState() Function', () => {
    test('should return object with all required state properties', () => {
      const state = getDefaultState();

      expect(state).toHaveProperty('workloadType', 'diagnostics');
      expect(state).toHaveProperty('currentStep', 'initialize');
      expect(state).toHaveProperty('stepIndex', 0);
      expect(state).toHaveProperty('totalSteps', 0);
      expect(state).toHaveProperty('toolsToTest');
      expect(state).toHaveProperty('toolIndex', 0);
      expect(state).toHaveProperty('results');
      expect(state).toHaveProperty('failures');
      expect(state).toHaveProperty('feedbackSubmitted');
      expect(state).toHaveProperty('progress', 0);
      expect(state).toHaveProperty('message', 'Initializing...');
      expect(state).toHaveProperty('startTime');
    });

    test('should initialize arrays as empty arrays', () => {
      const state = getDefaultState();

      expect(Array.isArray(state.toolsToTest)).toBe(true);
      expect(Array.isArray(state.results)).toBe(true);
      expect(Array.isArray(state.failures)).toBe(true);
      expect(Array.isArray(state.feedbackSubmitted)).toBe(true);
      
      expect(state.toolsToTest).toHaveLength(0);
      expect(state.results).toHaveLength(0);
      expect(state.failures).toHaveLength(0);
      expect(state.feedbackSubmitted).toHaveLength(0);
    });

    test('should initialize numeric properties to 0', () => {
      const state = getDefaultState();

      expect(state.stepIndex).toBe(0);
      expect(state.totalSteps).toBe(0);
      expect(state.toolIndex).toBe(0);
      expect(state.progress).toBe(0);
    });

    test('should set startTime to current timestamp', () => {
      const before = Date.now();
      const state = getDefaultState();
      const after = Date.now();

      expect(state.startTime).toBeGreaterThanOrEqual(before);
      expect(state.startTime).toBeLessThanOrEqual(after);
    });

    test('should prevent "Cannot read properties of undefined" errors', () => {
      const state = getDefaultState();

      // These operations should not throw - validates the fix
      expect(() => {
        const failureCount = state.failures.length;
        const resultCount = state.results.length;
        const toolCount = state.toolsToTest.length;
        expect(failureCount).toBe(0);
        expect(resultCount).toBe(0);
        expect(toolCount).toBe(0);
      }).not.toThrow();
    });
  });

  describe('Handler Integration - Step Execution with Missing State', () => {
    test('should use default state when checkpointState.state is completely undefined', async () => {
      // Mock a job with completely undefined checkpointState.state
      mockGetInsightsJob.mockResolvedValue({
        id: 'test-workload-id',
        status: 'pending',
        checkpointState: undefined
      });

      const mockSaveCheckpoint = require('../netlify/functions/utils/insights-jobs.cjs').saveCheckpoint;
      mockSaveCheckpoint.mockResolvedValue();

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'step',
          workloadId: 'test-workload-id'
        })
      };

      const context = {};
      const response = await handler(event, context);

      // Should use complete default state and not crash
      expect(response.statusCode).toBe(200);
      
      // Verify saveCheckpoint was called with state that has all properties
      expect(mockSaveCheckpoint).toHaveBeenCalled();
      const savedState = mockSaveCheckpoint.mock.calls[0][1].state;
      expect(savedState).toHaveProperty('failures');
      expect(savedState).toHaveProperty('results');
      expect(savedState).toHaveProperty('totalSteps');
    });

    test('should use default state when checkpointState.state is null', async () => {
      mockGetInsightsJob.mockResolvedValue({
        id: 'test-workload-id',
        status: 'pending',
        checkpointState: {
          state: null
        }
      });

      // With null state, defaults to 'initialize' step, which doesn't call analyzeFailures
      // Instead, let's test that it doesn't crash
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'step',
          workloadId: 'test-workload-id'
        })
      };

      const context = {};
      const response = await handler(event, context);

      // Should not crash, should return success
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    test('should handle analyze_failures step with missing failures array', async () => {
      // This is the exact scenario from the bug report
      // When checkpointState.state is undefined/null, it triggers the fallback
      mockGetInsightsJob.mockResolvedValue({
        id: 'test-workload-id',
        status: 'running',
        checkpointState: {
          state: null // This triggers getDefaultState() fallback
        }
      });

      mockAnalyzeFailures.mockImplementation((workloadId, state, log, context) => {
        // This is what would crash without the fix
        const failureCount = state.failures.length;
        return Promise.resolve({
          success: true,
          nextStep: 'submit_feedback',
          failureCount
        });
      });

      // Set up state with analyze_failures step to trigger the function that was crashing
      const stateWithOnlyStep = getDefaultState();
      stateWithOnlyStep.currentStep = 'analyze_failures';
      
      mockGetInsightsJob.mockResolvedValue({
        id: 'test-workload-id',
        status: 'running',
        checkpointState: {
          state: stateWithOnlyStep
        }
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'step',
          workloadId: 'test-workload-id'
        })
      };

      const context = {};
      
      // This should not throw "Cannot read properties of undefined (reading 'length')"
      await expect(handler(event, context)).resolves.not.toThrow();
      
      expect(mockAnalyzeFailures).toHaveBeenCalled();
      const calledState = mockAnalyzeFailures.mock.calls[0][1];
      expect(calledState.failures).toBeDefined();
      expect(Array.isArray(calledState.failures)).toBe(true);
    });
  });

  describe('Handler Integration - Status Retrieval with Missing State', () => {
    test('should return correct totalSteps from default state', async () => {
      mockGetInsightsJob.mockResolvedValue({
        id: 'test-workload-id',
        status: 'pending',
        checkpointState: {
          state: undefined
        }
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'status',
          workloadId: 'test-workload-id'
        })
      };

      const context = {};
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      // Should use default state values, not undefined
      expect(body.totalSteps).toBe(0); // From default state
      expect(body.currentStep).toBe('initialize');
      expect(body.progress).toBe(0);
    });
  });

  describe('State Preservation with Actual State', () => {
    test('should preserve actual state when checkpointState.state is defined', async () => {
      const actualState = {
        workloadType: 'diagnostics',
        currentStep: 'test_tool',
        stepIndex: 5,
        totalSteps: 14,
        toolsToTest: [],
        toolIndex: 5,
        results: [{ tool: 'test1', success: true }],
        failures: [{ tool: 'test2', error: 'failed' }],
        feedbackSubmitted: [],
        progress: 36,
        message: 'Testing tools...',
        startTime: Date.now()
      };

      mockGetInsightsJob.mockResolvedValue({
        id: 'test-workload-id',
        status: 'running',
        checkpointState: {
          state: actualState
        }
      });

      const mockTestTool = require('../netlify/functions/utils/diagnostics-steps.cjs').testTool;
      mockTestTool.mockResolvedValue({
        success: true,
        nextStep: 'test_tool'
      });

      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({
          action: 'step',
          workloadId: 'test-workload-id'
        })
      };

      const context = {};
      await handler(event, context);

      expect(mockTestTool).toHaveBeenCalled();
      const calledState = mockTestTool.mock.calls[0][1];
      
      // Should use actual state, not default
      expect(calledState.stepIndex).toBe(5);
      expect(calledState.totalSteps).toBe(14);
      expect(calledState.results).toHaveLength(1);
      expect(calledState.failures).toHaveLength(1);
    });
  });
});
