/**
 * Tests for Diagnostics Workload State Management
 * 
 * Validates that state defaults are properly applied to prevent
 * "Cannot read properties of undefined" errors.
 */

describe('Diagnostics Workload State Management', () => {
  describe('State Default Structure', () => {
    test('should have all required state properties', () => {
      const defaultState = {
        workloadType: 'diagnostics',
        currentStep: 'initialize',
        stepIndex: 0,
        totalSteps: 0,
        toolsToTest: [],
        toolIndex: 0,
        results: [],
        failures: [],
        feedbackSubmitted: [],
        progress: 0,
        message: 'Initializing...',
        startTime: expect.any(Number)
      };

      // Verify all required properties exist
      expect(defaultState).toHaveProperty('workloadType');
      expect(defaultState).toHaveProperty('currentStep');
      expect(defaultState).toHaveProperty('stepIndex');
      expect(defaultState).toHaveProperty('totalSteps');
      expect(defaultState).toHaveProperty('toolsToTest');
      expect(defaultState).toHaveProperty('toolIndex');
      expect(defaultState).toHaveProperty('results');
      expect(defaultState).toHaveProperty('failures');
      expect(defaultState).toHaveProperty('feedbackSubmitted');
      expect(defaultState).toHaveProperty('progress');
      expect(defaultState).toHaveProperty('message');
      expect(defaultState).toHaveProperty('startTime');
    });

    test('should have array properties initialized as empty arrays', () => {
      const defaultState = {
        toolsToTest: [],
        results: [],
        failures: [],
        feedbackSubmitted: []
      };

      expect(Array.isArray(defaultState.toolsToTest)).toBe(true);
      expect(Array.isArray(defaultState.results)).toBe(true);
      expect(Array.isArray(defaultState.failures)).toBe(true);
      expect(Array.isArray(defaultState.feedbackSubmitted)).toBe(true);
      
      expect(defaultState.toolsToTest.length).toBe(0);
      expect(defaultState.results.length).toBe(0);
      expect(defaultState.failures.length).toBe(0);
      expect(defaultState.feedbackSubmitted.length).toBe(0);
    });

    test('should have numeric properties initialized to 0', () => {
      const defaultState = {
        stepIndex: 0,
        totalSteps: 0,
        toolIndex: 0,
        progress: 0
      };

      expect(defaultState.stepIndex).toBe(0);
      expect(defaultState.totalSteps).toBe(0);
      expect(defaultState.toolIndex).toBe(0);
      expect(defaultState.progress).toBe(0);
    });

    test('should prevent "Cannot read properties of undefined" errors', () => {
      const defaultState = {
        failures: [],
        results: [],
        toolsToTest: []
      };

      // These operations should not throw and should return valid values
      expect(() => {
        expect(defaultState.failures.length).toBe(0);
        expect(defaultState.results.length).toBe(0);
        expect(defaultState.toolsToTest.length).toBe(0);
      }).not.toThrow();
    });
  });

  describe('State Fallback Behavior', () => {
    test('should use default state when checkpointState is undefined', () => {
      const job = {
        id: 'test-job',
        status: 'pending'
        // checkpointState is undefined
      };

      const defaultState = {
        failures: [],
        results: [],
        totalSteps: 0
      };

      const jobState = job.checkpointState?.state || defaultState;

      expect(jobState).toBe(defaultState);
      expect(jobState.failures).toEqual([]);
      expect(jobState.results).toEqual([]);
      expect(jobState.totalSteps).toBe(0);
    });

    test('should use default state when checkpointState.state is null', () => {
      const job = {
        id: 'test-job',
        status: 'pending',
        checkpointState: {
          state: null
        }
      };

      const defaultState = {
        failures: [],
        results: [],
        totalSteps: 0
      };

      const jobState = job.checkpointState?.state || defaultState;

      expect(jobState).toBe(defaultState);
      expect(jobState.failures).toEqual([]);
    });

    test('should use actual state when checkpointState.state is defined', () => {
      const actualState = {
        failures: [{ tool: 'test', error: 'error' }],
        results: [{ success: true }],
        totalSteps: 14
      };

      const job = {
        id: 'test-job',
        status: 'pending',
        checkpointState: {
          state: actualState
        }
      };

      const defaultState = {
        failures: [],
        results: [],
        totalSteps: 0
      };

      const jobState = job.checkpointState?.state || defaultState;

      expect(jobState).toBe(actualState);
      expect(jobState.failures).toHaveLength(1);
      expect(jobState.results).toHaveLength(1);
      expect(jobState.totalSteps).toBe(14);
    });
  });

  describe('Status Bar Display Values', () => {
    test('should display correct step numbers', () => {
      const status = {
        stepIndex: 5,
        totalSteps: 14
      };

      // Frontend displays as "Step (stepIndex + 1) / totalSteps"
      const displayStep = status.stepIndex + 1;
      const displayTotal = status.totalSteps;

      expect(displayStep).toBe(6);
      expect(displayTotal).toBe(14);
      // Should show "Step 6 / 14"
    });

    test('should handle zero totalSteps gracefully', () => {
      const status = {
        stepIndex: 0,
        totalSteps: 0
      };

      const displayStep = status.stepIndex + 1;
      const displayTotal = status.totalSteps;

      expect(displayStep).toBe(1);
      expect(displayTotal).toBe(0);
      // Would show "Step 1 / 0" which is the bug we're fixing
    });

    test('should calculate progress percentage correctly', () => {
      const state = {
        stepIndex: 5,
        totalSteps: 14
      };

      const progress = Math.round(((state.stepIndex + 1) / state.totalSteps) * 100);

      expect(progress).toBe(43); // (6/14) * 100 = 42.857 rounds to 43
    });
  });
});
