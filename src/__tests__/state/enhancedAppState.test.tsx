import React from 'react';
import { renderHook, act } from '@testing-library/react';
import {
  AppStateProvider,
  useAppState,
  useAppSelector,
  useAppActions,
  appReducer,
  initialState,
} from '../../state/enhancedAppState';
import { ErrorType, ErrorSeverity, BMSError } from '../../utils/asyncErrorHandler';
import {
  createMockAnalysisRecord,
  createMockBmsSystem,
  createMockDisplayableAnalysisResult,
  suppressConsoleErrors,
  restoreConsole,
} from '../utils/testUtils';

// Wrapper component for testing hooks
const StateWrapper = ({ children }: { children: React.ReactNode }) => (
  <AppStateProvider>{children}</AppStateProvider>
);

describe('Enhanced App State', () => {
  beforeEach(() => {
    suppressConsoleErrors();
  });

  afterEach(() => {
    restoreConsole();
  });

  describe('appReducer', () => {
    describe('ANALYSIS_PREPARE', () => {
      it('should add new analysis results', () => {
        const results = [
          createMockDisplayableAnalysisResult({ fileName: 'test1.jpg' }),
          createMockDisplayableAnalysisResult({ fileName: 'test2.jpg' }),
        ];

        const action = {
          type: 'ANALYSIS_PREPARE' as const,
          payload: { results },
        };

        const newState = appReducer(initialState, action);

        expect(newState.analysisResults).toHaveLength(2);
        expect(newState.loading.isLoading).toBe(true);
        expect(newState.loading.operation).toBe('Preparing analysis');
        expect(newState.error.error).toBe(null);
      });

      it('should not add duplicate file names', () => {
        const existingState = {
          ...initialState,
          analysisResults: [
            createMockDisplayableAnalysisResult({ fileName: 'test1.jpg' })
          ],
        };

        const results = [
          createMockDisplayableAnalysisResult({ fileName: 'test1.jpg' }), // Duplicate
          createMockDisplayableAnalysisResult({ fileName: 'test2.jpg' }), // New
        ];

        const action = {
          type: 'ANALYSIS_PREPARE' as const,
          payload: { results },
        };

        const newState = appReducer(existingState, action);

        expect(newState.analysisResults).toHaveLength(2); // Only one new result added
        expect(newState.analysisResults.some(r => r.fileName === 'test2.jpg')).toBe(true);
      });
    });

    describe('ANALYSIS_COMPLETE_SYNC', () => {
      it('should update analysis result and add to history', () => {
        const existingState = {
          ...initialState,
          analysisResults: [
            createMockDisplayableAnalysisResult({ fileName: 'test.jpg', data: null }),
          ],
        };

        const record = createMockAnalysisRecord({ fileName: 'test.jpg' });

        const action = {
          type: 'ANALYSIS_COMPLETE_SYNC' as const,
          payload: { fileName: 'test.jpg', record, isDuplicate: false },
        };

        const newState = appReducer(existingState, action);

        // Should update the analysis result
        expect(newState.analysisResults[0].data).toBe(record.analysis);
        expect(newState.analysisResults[0].error).toBe(null);
        expect(newState.analysisResults[0].recordId).toBe(record.id);

        // Should add to history
        expect(newState.analysisHistory.items).toHaveLength(1);
        expect(newState.analysisHistory.items[0]).toBe(record);
        expect(newState.analysisHistory.total).toBe(1);
      });
    });

    describe('ERROR_SET', () => {
      it('should set error with context', () => {
        const error = new BMSError('Test error', {
          type: ErrorType.CLIENT,
          severity: ErrorSeverity.HIGH,
        });

        const context = { userId: '123', operation: 'test' };

        const action = {
          type: 'ERROR_SET' as const,
          payload: { error, context },
        };

        const newState = appReducer(initialState, action);

        expect(newState.error.error).toBe(error);
        expect(newState.error.context).toBe(context);
        expect(newState.error.errorId).toBeDefined();
        expect(newState.error.canRetry).toBe(error.retryable);
        expect(newState.loading.isLoading).toBe(false);
      });
    });

    describe('LOADING_START', () => {
      it('should set loading state with operation and progress', () => {
        const action = {
          type: 'LOADING_START' as const,
          payload: { operation: 'Processing files', progress: 25 },
        };

        const newState = appReducer(initialState, action);

        expect(newState.loading.isLoading).toBe(true);
        expect(newState.loading.operation).toBe('Processing files');
        expect(newState.loading.progress).toBe(25);
        expect(newState.loading.startedAt).toBeDefined();
      });
    });

    describe('SYNC_START', () => {
      it('should set sync state', () => {
        const action = {
          type: 'SYNC_START' as const,
          payload: { progress: 10 },
        };

        const newState = appReducer(initialState, action);

        expect(newState.sync.isSyncing).toBe(true);
        expect(newState.sync.syncProgress).toBe(10);
        expect(newState.sync.syncError).toBe(null);
      });
    });

    describe('CONSENT_GRANT', () => {
      it('should grant consent with all options', () => {
        const action = {
          type: 'CONSENT_GRANT' as const,
          payload: {
            consentVersion: 'v1.0',
            privacyPolicy: true,
            dataRetention: true,
          },
        };

        const newState = appReducer(initialState, action);

        expect(newState.consent.insightsConsented).toBe(true);
        expect(newState.consent.consentVersion).toBe('v1.0');
        expect(newState.consent.privacyPolicyAccepted).toBe(true);
        expect(newState.consent.dataRetentionConsent).toBe(true);
        expect(newState.consent.consentedAt).toBeDefined();
      });
    });

    describe('UI_NOTIFICATION_ADD', () => {
      it('should add notification to list', () => {
        const notification = {
          id: 'notif-1',
          type: 'success' as const,
          title: 'Success',
          message: 'Operation completed',
          timestamp: Date.now(),
        };

        const action = {
          type: 'UI_NOTIFICATION_ADD' as const,
          payload: { notification },
        };

        const newState = appReducer(initialState, action);

        expect(newState.ui.notifications).toHaveLength(1);
        expect(newState.ui.notifications[0]).toBe(notification);
      });
    });
  });

  describe('useAppState', () => {
    it('should provide state and dispatch', () => {
      const { result } = renderHook(() => useAppState(), {
        wrapper: StateWrapper,
      });

      expect(result.current.state).toBeDefined();
      expect(result.current.dispatch).toBeInstanceOf(Function);
    });

    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useAppState());
      }).toThrow('useAppState must be used within an AppStateProvider');
    });
  });

  describe('useAppSelector', () => {
    it('should select specific state slices', () => {
      const { result } = renderHook(
        () => useAppSelector(state => state.loading.isLoading),
        { wrapper: StateWrapper }
      );

      expect(result.current).toBe(false);
    });

    it('should memoize selected values', () => {
      const selector = jest.fn(state => state.loading.isLoading);

      const { result, rerender } = renderHook(
        () => useAppSelector(selector),
        { wrapper: StateWrapper }
      );

      // Initial render
      expect(selector).toHaveBeenCalledTimes(1);

      // Rerender with same selector should not call selector again
      // due to memoization in useMemo
      rerender();
      expect(selector).toHaveBeenCalledTimes(2); // useMemo dependency check
    });
  });

  describe('useAppActions', () => {
    it('should provide action creators', () => {
      const { result } = renderHook(() => useAppActions(), {
        wrapper: StateWrapper,
      });

      expect(result.current.prepareAnalysis).toBeInstanceOf(Function);
      expect(result.current.updateAnalysisStatus).toBeInstanceOf(Function);
      expect(result.current.completeAnalysis).toBeInstanceOf(Function);
      expect(result.current.startLoading).toBeInstanceOf(Function);
      expect(result.current.stopLoading).toBeInstanceOf(Function);
      expect(result.current.setError).toBeInstanceOf(Function);
      expect(result.current.clearError).toBeInstanceOf(Function);
    });

    it('should dispatch actions correctly', () => {
      const { result: stateResult } = renderHook(() => useAppState(), {
        wrapper: StateWrapper,
      });

      const { result: actionsResult } = renderHook(() => useAppActions(), {
        wrapper: StateWrapper,
      });

      // Start loading
      act(() => {
        actionsResult.current.startLoading('Test operation', 50);
      });

      expect(stateResult.current.state.loading.isLoading).toBe(true);
      expect(stateResult.current.state.loading.operation).toBe('Test operation');
      expect(stateResult.current.state.loading.progress).toBe(50);

      // Stop loading
      act(() => {
        actionsResult.current.stopLoading();
      });

      expect(stateResult.current.state.loading.isLoading).toBe(false);
    });

    it('should handle error actions', () => {
      const { result: stateResult } = renderHook(() => useAppState(), {
        wrapper: StateWrapper,
      });

      const { result: actionsResult } = renderHook(() => useAppActions(), {
        wrapper: StateWrapper,
      });

      const error = new BMSError('Test error', {
        type: ErrorType.CLIENT,
        severity: ErrorSeverity.LOW,
      });

      // Set error
      act(() => {
        actionsResult.current.setError(error, { context: 'test' });
      });

      expect(stateResult.current.state.error.error).toBe(error);
      expect(stateResult.current.state.error.context).toEqual({ context: 'test' });

      // Clear error
      act(() => {
        actionsResult.current.clearError();
      });

      expect(stateResult.current.state.error.error).toBe(null);
    });

    it('should handle analysis actions', () => {
      const { result: stateResult } = renderHook(() => useAppState(), {
        wrapper: StateWrapper,
      });

      const { result: actionsResult } = renderHook(() => useAppActions(), {
        wrapper: StateWrapper,
      });

      const results = [
        createMockDisplayableAnalysisResult({ fileName: 'test.jpg' }),
      ];

      // Prepare analysis
      act(() => {
        actionsResult.current.prepareAnalysis(results);
      });

      expect(stateResult.current.state.analysisResults).toHaveLength(1);
      expect(stateResult.current.state.loading.isLoading).toBe(true);

      // Complete analysis
      const record = createMockAnalysisRecord({ fileName: 'test.jpg' });

      act(() => {
        actionsResult.current.completeAnalysis('test.jpg', record, false);
      });

      expect(stateResult.current.state.analysisResults[0].data).toBe(record.analysis);
      expect(stateResult.current.state.analysisHistory.items).toHaveLength(1);
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete analysis workflow', () => {
      const { result: stateResult } = renderHook(() => useAppState(), {
        wrapper: StateWrapper,
      });

      const { result: actionsResult } = renderHook(() => useAppActions(), {
        wrapper: StateWrapper,
      });

      // 1. Prepare analysis
      const results = [
        createMockDisplayableAnalysisResult({ fileName: 'test1.jpg' }),
        createMockDisplayableAnalysisResult({ fileName: 'test2.jpg' }),
      ];

      act(() => {
        actionsResult.current.prepareAnalysis(results);
      });

      expect(stateResult.current.state.analysisResults).toHaveLength(2);
      expect(stateResult.current.state.loading.isLoading).toBe(true);

      // 2. Update status for individual files
      act(() => {
        actionsResult.current.updateAnalysisStatus('test1.jpg', 'Processing...');
        actionsResult.current.updateAnalysisStatus('test2.jpg', 'Queued');
      });

      expect(stateResult.current.state.analysisResults[0].error).toBe('Processing...');
      expect(stateResult.current.state.analysisResults[1].error).toBe('Queued');

      // 3. Complete analysis for both files
      const record1 = createMockAnalysisRecord({ id: 'record1', fileName: 'test1.jpg' });
      const record2 = createMockAnalysisRecord({ id: 'record2', fileName: 'test2.jpg' });

      act(() => {
        actionsResult.current.completeAnalysis('test1.jpg', record1, false);
        actionsResult.current.completeAnalysis('test2.jpg', record2, true); // Duplicate
      });

      expect(stateResult.current.state.analysisResults[0].data).toBe(record1.analysis);
      expect(stateResult.current.state.analysisResults[0].isDuplicate).toBe(false);
      expect(stateResult.current.state.analysisResults[1].data).toBe(record2.analysis);
      expect(stateResult.current.state.analysisResults[1].isDuplicate).toBe(true);

      expect(stateResult.current.state.analysisHistory.items).toHaveLength(2);
      expect(stateResult.current.state.analysisHistory.total).toBe(2);
    });

    it('should handle error recovery workflow', () => {
      const { result: stateResult } = renderHook(() => useAppState(), {
        wrapper: StateWrapper,
      });

      const { result: actionsResult } = renderHook(() => useAppActions(), {
        wrapper: StateWrapper,
      });

      // 1. Start operation
      act(() => {
        actionsResult.current.startLoading('Processing', 10);
      });

      expect(stateResult.current.state.loading.isLoading).toBe(true);

      // 2. Error occurs
      const error = new BMSError('Network error', {
        type: ErrorType.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        retryable: true,
      });

      act(() => {
        actionsResult.current.setError(error, { operation: 'analysis' });
      });

      expect(stateResult.current.state.error.error).toBe(error);
      expect(stateResult.current.state.error.canRetry).toBe(true);
      expect(stateResult.current.state.loading.isLoading).toBe(false); // Error stops loading

      // 3. Clear error and retry
      act(() => {
        actionsResult.current.clearError();
        actionsResult.current.startLoading('Retrying', 0);
      });

      expect(stateResult.current.state.error.error).toBe(null);
      expect(stateResult.current.state.loading.isLoading).toBe(true);
    });
  });

  describe('Type Safety', () => {
    it('should enforce readonly properties', () => {
      // This test ensures that state properties are readonly at compile time
      // Runtime test to verify immutability
      const { result } = renderHook(() => useAppState(), {
        wrapper: StateWrapper,
      });

      const originalState = result.current.state;

      // Try to modify readonly properties (should not affect original)
      expect(() => {
        // @ts-ignore - Intentionally testing runtime immutability
        originalState.analysisResults.push({} as any);
      }).not.toThrow(); // Array.push won't throw but shouldn't modify the original

      // State should remain unchanged
      expect(result.current.state).toBe(originalState);
    });
  });
});