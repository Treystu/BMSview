/**
 * Insights State Management Tests
 * 
 * Tests for the new insights lifecycle, consent, and circuit breaker state management
 * added to appState.tsx to address Issue #3, #4, #5, and #6
 */

describe('Insights State Management', () => {
  // Mock the reducer function
  let appReducer;
  let initialState;

  beforeEach(() => {
    // Dynamically require the actual reducer and initialState from appState.tsx
    jest.resetModules();
    const appState = require('../src/state/appState.tsx');
    appReducer = appState.appReducer;
    initialState = appState.initialState;
  });

  describe('Insights Lifecycle Actions', () => {
    test('INSIGHTS_LOADING sets loading state', () => {
      const action = {
        type: 'INSIGHTS_LOADING',
        payload: { recordId: 'test-record-1' },
      };

      const newState = appReducer(initialState, action);

      expect(newState.insightsState['test-record-1']).toEqual({
        isLoading: true,
        insights: undefined,
        error: undefined,
      });
    });

    test('INSIGHTS_SUCCESS sets success state with insights', () => {
      const action = {
        type: 'INSIGHTS_SUCCESS',
        payload: {
          recordId: 'test-record-1',
          insights: 'Battery health is excellent. SOC trending upward.',
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.insightsState['test-record-1']).toEqual({
        isLoading: false,
        insights: 'Battery health is excellent. SOC trending upward.',
        error: undefined,
      });
    });

    test('INSIGHTS_ERROR sets error state', () => {
      const action = {
        type: 'INSIGHTS_ERROR',
        payload: {
          recordId: 'test-record-1',
          error: 'Failed to generate insights: API timeout',
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.insightsState['test-record-1']).toEqual({
        isLoading: false,
        insights: undefined,
        error: 'Failed to generate insights: API timeout',
      });
    });

    test('INSIGHTS_RETRY sets retry state with resumeJobId', () => {
      const action = {
        type: 'INSIGHTS_RETRY',
        payload: {
          recordId: 'test-record-1',
          resumeJobId: 'job-12345',
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.insightsState['test-record-1']).toEqual({
        isLoading: true,
        insights: undefined,
        error: undefined,
        resumeJobId: 'job-12345',
      });
    });

    test('INSIGHTS_TIMEOUT creates pending resume and sets timeout error', () => {
      const action = {
        type: 'INSIGHTS_TIMEOUT',
        payload: {
          recordId: 'test-record-1',
          resumeJobId: 'job-67890',
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.pendingResumes).toHaveLength(1);
      expect(newState.pendingResumes[0]).toMatchObject({
        recordId: 'test-record-1',
        resumeJobId: 'job-67890',
        attempts: 1,
      });
      expect(newState.pendingResumes[0].lastAttempt).toBeGreaterThan(Date.now() - 1000);

      expect(newState.insightsState['test-record-1']).toEqual({
        isLoading: false,
        insights: undefined,
        error: 'Request timed out. Resume job created.',
        resumeJobId: 'job-67890',
      });
    });

    test('INSIGHTS_TIMEOUT increments attempts for duplicate timeouts', () => {
      let state = initialState;

      // First timeout
      state = appReducer(state, {
        type: 'INSIGHTS_TIMEOUT',
        payload: {
          recordId: 'test-record-1',
          resumeJobId: 'job-first',
        },
      });

      expect(state.pendingResumes).toHaveLength(1);
      expect(state.pendingResumes[0].attempts).toBe(1);
      expect(state.pendingResumes[0].resumeJobId).toBe('job-first');

      // Second timeout for same record
      state = appReducer(state, {
        type: 'INSIGHTS_TIMEOUT',
        payload: {
          recordId: 'test-record-1',
          resumeJobId: 'job-second',
        },
      });

      expect(state.pendingResumes).toHaveLength(1); // Still only 1 entry
      expect(state.pendingResumes[0].attempts).toBe(2); // Attempts incremented
      expect(state.pendingResumes[0].resumeJobId).toBe('job-second'); // Job ID updated
      expect(state.pendingResumes[0].recordId).toBe('test-record-1');
    });

    test('Multiple insight states can coexist for different records', () => {
      let state = initialState;

      // Load insights for record 1
      state = appReducer(state, {
        type: 'INSIGHTS_LOADING',
        payload: { recordId: 'record-1' },
      });

      // Load insights for record 2
      state = appReducer(state, {
        type: 'INSIGHTS_LOADING',
        payload: { recordId: 'record-2' },
      });

      // Complete record 1
      state = appReducer(state, {
        type: 'INSIGHTS_SUCCESS',
        payload: { recordId: 'record-1', insights: 'Insights for record 1' },
      });

      expect(state.insightsState['record-1'].isLoading).toBe(false);
      expect(state.insightsState['record-1'].insights).toBe('Insights for record 1');
      expect(state.insightsState['record-2'].isLoading).toBe(true);
    });
  });

  describe('Consent Flow Actions', () => {
    test('CONSENT_GRANTED sets consent with version and timestamp', () => {
      const action = {
        type: 'CONSENT_GRANTED',
        payload: { consentVersion: 'v2.0' },
      };

      const newState = appReducer(initialState, action);

      expect(newState.consentStatus.insightsConsented).toBe(true);
      expect(newState.consentStatus.consentVersion).toBe('v2.0');
      expect(newState.consentStatus.consentedAt).toBeGreaterThan(Date.now() - 1000);
    });

    test('CONSENT_REVOKED clears consent status', () => {
      const stateWithConsent = {
        ...initialState,
        consentStatus: {
          insightsConsented: true,
          consentedAt: Date.now(),
          consentVersion: 'v1.0',
        },
      };

      const action = { type: 'CONSENT_REVOKED' };
      const newState = appReducer(stateWithConsent, action);

      expect(newState.consentStatus).toEqual({
        insightsConsented: false,
        consentedAt: undefined,
        consentVersion: undefined,
      });
    });

    test('Consent can be granted multiple times (version updates)', () => {
      let state = initialState;

      // Grant v1.0
      state = appReducer(state, {
        type: 'CONSENT_GRANTED',
        payload: { consentVersion: 'v1.0' },
      });
      expect(state.consentStatus.consentVersion).toBe('v1.0');

      // Update to v2.0
      state = appReducer(state, {
        type: 'CONSENT_GRANTED',
        payload: { consentVersion: 'v2.0' },
      });
      expect(state.consentStatus.consentVersion).toBe('v2.0');
      expect(state.consentStatus.insightsConsented).toBe(true);
    });
  });

  describe('Circuit Breaker Actions', () => {
    test('UPDATE_CIRCUIT_BREAKER changes service state', () => {
      const action = {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'insights', state: 'open', reason: 'Too many failures' },
      };

      const newState = appReducer(initialState, action);

      expect(newState.circuitBreakers.insights).toBe('open');
      expect(newState.circuitBreakers.analysis).toBe('closed');
      expect(newState.circuitBreakers.lastTripped).toMatchObject({
        service: 'insights',
        reason: 'Too many failures',
      });
      expect(newState.circuitBreakers.lastTripped.at).toBeGreaterThan(Date.now() - 1000);
    });

    test('UPDATE_CIRCUIT_BREAKER without reason preserves lastTripped', () => {
      const stateWithTripped = {
        ...initialState,
        circuitBreakers: {
          insights: 'open',
          analysis: 'closed',
          lastTripped: {
            service: 'insights',
            reason: 'Previous failure',
            at: Date.now() - 60000,
          },
        },
      };

      const action = {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'insights', state: 'half-open' },
      };

      const newState = appReducer(stateWithTripped, action);

      expect(newState.circuitBreakers.insights).toBe('half-open');
      expect(newState.circuitBreakers.lastTripped).toEqual(stateWithTripped.circuitBreakers.lastTripped);
    });

    test('RESET_CIRCUIT_BREAKERS resets all breakers to closed but preserves lastTripped', () => {
      const stateWithOpen = {
        ...initialState,
        circuitBreakers: {
          insights: 'open',
          analysis: 'half-open',
          lastTripped: {
            service: 'insights',
            reason: 'Test failure',
            at: Date.now(),
          },
        },
      };

      const action = { type: 'RESET_CIRCUIT_BREAKERS' };
      const newState = appReducer(stateWithOpen, action);

      expect(newState.circuitBreakers.insights).toBe('closed');
      expect(newState.circuitBreakers.analysis).toBe('closed');
      expect(newState.circuitBreakers.lastTripped).toEqual(stateWithOpen.circuitBreakers.lastTripped);
    });

    test('Circuit breakers can transition through states', () => {
      let state = initialState;

      // Open insights breaker
      state = appReducer(state, {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'insights', state: 'open', reason: 'High failure rate' },
      });
      expect(state.circuitBreakers.insights).toBe('open');

      // Transition to half-open after timeout
      state = appReducer(state, {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'insights', state: 'half-open' },
      });
      expect(state.circuitBreakers.insights).toBe('half-open');

      // Close after successful test
      state = appReducer(state, {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'insights', state: 'closed' },
      });
      expect(state.circuitBreakers.insights).toBe('closed');
    });

    test('Multiple services can have different breaker states', () => {
      let state = initialState;

      state = appReducer(state, {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'insights', state: 'open', reason: 'Insights failures' },
      });

      state = appReducer(state, {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'analysis', state: 'half-open', reason: 'Analysis recovering' },
      });

      expect(state.circuitBreakers.insights).toBe('open');
      expect(state.circuitBreakers.analysis).toBe('half-open');
    });
  });

  describe('Integration Scenarios', () => {
    test('Complete insights generation flow with retry', () => {
      let state = initialState;

      // 1. Start loading
      state = appReducer(state, {
        type: 'INSIGHTS_LOADING',
        payload: { recordId: 'test-1' },
      });
      expect(state.insightsState['test-1'].isLoading).toBe(true);

      // 2. Timeout occurs
      state = appReducer(state, {
        type: 'INSIGHTS_TIMEOUT',
        payload: { recordId: 'test-1', resumeJobId: 'job-123' },
      });
      expect(state.insightsState['test-1'].error).toContain('timed out');
      expect(state.pendingResumes).toHaveLength(1);

      // 3. Retry with resume job
      state = appReducer(state, {
        type: 'INSIGHTS_RETRY',
        payload: { recordId: 'test-1', resumeJobId: 'job-123' },
      });
      expect(state.insightsState['test-1'].isLoading).toBe(true);
      expect(state.insightsState['test-1'].resumeJobId).toBe('job-123');

      // 4. Success
      state = appReducer(state, {
        type: 'INSIGHTS_SUCCESS',
        payload: { recordId: 'test-1', insights: 'Final insights after retry' },
      });
      expect(state.insightsState['test-1'].isLoading).toBe(false);
      expect(state.insightsState['test-1'].insights).toBe('Final insights after retry');
    });

    test('Circuit breaker trip during insights generation', () => {
      let state = initialState;

      // Grant consent
      state = appReducer(state, {
        type: 'CONSENT_GRANTED',
        payload: { consentVersion: 'v1.0' },
      });

      // Start insights
      state = appReducer(state, {
        type: 'INSIGHTS_LOADING',
        payload: { recordId: 'test-1' },
      });

      // Circuit breaker trips
      state = appReducer(state, {
        type: 'UPDATE_CIRCUIT_BREAKER',
        payload: { service: 'insights', state: 'open', reason: 'Multiple timeouts' },
      });

      // Insights fail
      state = appReducer(state, {
        type: 'INSIGHTS_ERROR',
        payload: { recordId: 'test-1', error: 'Circuit breaker open' },
      });

      expect(state.circuitBreakers.insights).toBe('open');
      expect(state.insightsState['test-1'].error).toBe('Circuit breaker open');
      expect(state.consentStatus.insightsConsented).toBe(true); // Consent remains
    });
  });
});
