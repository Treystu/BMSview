import React, { useEffect, useRef, useState } from 'react';
import { ALL_DIAGNOSTIC_TESTS, DIAGNOSTIC_TEST_SECTIONS } from '@/constants/diagnostics';
import type { AdminAction, AdminState, DiagnosticTestResult, DiagnosticsResponse } from '@/state/adminState';
import { runSingleDiagnosticTest } from '@/services/clientService';
import { ensureNumber } from '@/utils/stateHelpers';
import SpinnerIcon from './icons/SpinnerIcon';

interface UnifiedDiagnosticsDashboardProps {
  state: AdminState;
  dispatch: React.Dispatch<AdminAction>;
}

interface WorkloadStatus {
  workloadId: string;
  status: string;
  currentStep: string;
  stepIndex: number;
  totalSteps: number;
  progress: number;
  message: string;
  results?: unknown[];
  feedbackSubmitted?: unknown[];
  summary?: {
    totalToolsTested: number;
    totalTests: number | string;
    passedTests: number | string;
    failedTests: number | string;
    failureRate: string;
    averageResponseTime: string;
    duration: number;
    errors?: {
      analysisError?: string | null;
      feedbackError?: string | null;
      finalizationError?: string | null;
    };
    toolResults?: Array<{
      tool: string;
      validTestPassed: boolean;
      edgeCaseTestPassed: boolean;
    }>;
    recommendations?: Array<{
      severity: string;
      message: string;
      action: string;
    }>;
    githubIssuesCreated?: Array<{
      issueNumber: number;
      issueUrl: string;
      category: string;
    }>;
  };
  warning?: string;
}

const UnifiedDiagnosticsDashboard: React.FC<UnifiedDiagnosticsDashboardProps> = ({ state, dispatch }) => {
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [guruRunning, setGuruRunning] = useState(false);
  const [guruWorkloadId, setGuruWorkloadId] = useState<string | null>(null);
  const [guruStatus, setGuruStatus] = useState<WorkloadStatus | null>(null);
  const [guruError, setGuruError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isExecutingRef = useRef(false);

  const handleTestToggle = (testId: string, checked: boolean) => {
    const currentTests = state.selectedDiagnosticTests || ALL_DIAGNOSTIC_TESTS;
    const newTests = checked
      ? [...currentTests, testId]
      : currentTests.filter(t => t !== testId);
    dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: newTests });
  };

  const handleRunDiagnostics = async () => {
    const selectedTests = state.selectedDiagnosticTests || ALL_DIAGNOSTIC_TESTS;

    const initialResults: DiagnosticsResponse = {
      status: 'partial',
      timestamp: new Date().toISOString(),
      duration: 0,
      results: selectedTests.map(testId => {
        const testConfig = DIAGNOSTIC_TEST_SECTIONS.find(t => t.id === testId);
        return {
          name: testConfig?.label || testId,
          status: 'running',
          duration: 0
        };
      }),
      summary: {
        total: selectedTests.length,
        success: 0,
        warnings: 0,
        errors: 0,
        partial: 0
      }
    };

    dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: initialResults });
    dispatch({ type: 'ACTION_START', payload: 'isRunningDiagnostics' });

    const startTime = Date.now();

    try {
      const testPromises = selectedTests.map(async (testId) => {
        const testConfig = DIAGNOSTIC_TEST_SECTIONS.find(t => t.id === testId);
        const displayName = testConfig?.label || testId;

        try {
          const result = await runSingleDiagnosticTest(testId);
          dispatch({
            type: 'UPDATE_SINGLE_DIAGNOSTIC_RESULT',
            payload: { testId, result }
          });
          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Test failed';
          const errorResult: DiagnosticTestResult = {
            name: displayName,
            status: 'error',
            error: errorMessage,
            duration: 0
          };
          dispatch({
            type: 'UPDATE_SINGLE_DIAGNOSTIC_RESULT',
            payload: { testId, result: errorResult }
          });
          return errorResult;
        }
      });

      const allResults = await Promise.all(testPromises);
      const summary = {
        total: allResults.length,
        success: allResults.filter(r => r.status === 'success').length,
        partial: allResults.filter(r => r.status === 'partial').length,
        warnings: allResults.filter(r => r.status === 'warning').length,
        errors: allResults.filter(r => r.status === 'error').length
      };

      const overallStatus = summary.errors > 0 || summary.warnings > 0 || summary.partial > 0
        ? 'partial'
        : 'success';

      const finalResults: DiagnosticsResponse = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        results: allResults,
        summary
      };

      dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: finalResults });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to run diagnostics.';
      const errorResponse: DiagnosticsResponse = {
        status: 'error',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        results: selectedTests.map(testId => {
          const testConfig = DIAGNOSTIC_TEST_SECTIONS.find(t => t.id === testId);
          return {
            name: testConfig?.label || testId,
            status: 'error',
            error: 'Diagnostic orchestration failed',
            duration: 0
          };
        }),
        summary: {
          total: selectedTests.length,
          success: 0,
          warnings: 0,
          errors: selectedTests.length
        },
        error
      };
      dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: errorResponse });
    } finally {
      dispatch({ type: 'ACTION_END', payload: 'isRunningDiagnostics' });
    }
  };

  const toggleSection = (sectionKey: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionKey)) {
      newExpanded.delete(sectionKey);
    } else {
      newExpanded.add(sectionKey);
    }
    setExpandedSections(newExpanded);
  };

  const renderError = (error: unknown): string => {
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object') {
      const errorObj = error as { message?: string };
      return errorObj.message || JSON.stringify(error, null, 2);
    }
    return 'Unknown error occurred';
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return 'text-green-400';
      case 'partial':
      case 'warning':
        return 'text-yellow-400';
      case 'error':
      case 'failed':
        return 'text-red-400';
      case 'running':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'success':
        return '✔';
      case 'partial':
        return '◐';
      case 'warning':
        return '⚠';
      case 'error':
      case 'failed':
        return '✖';
      case 'running':
        return '↻';
      default:
        return '?';
    }
  };

  const getOverallStatusColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case 'success':
        return 'border-green-500 bg-green-900/20';
      case 'partial':
      case 'warning':
        return 'border-yellow-500 bg-yellow-900/20';
      case 'error':
        return 'border-red-500 bg-red-900/20';
      default:
        return 'border-gray-500 bg-gray-900/20';
    }
  };

  const renderNestedItems = (items: unknown[], label: string, testName: string) => {
    if (!items || items.length === 0) return null;

    const sectionKey = `${testName}-${label}`;
    const isExpanded = expandedSections.has(sectionKey);

    return (
      <div className="mt-3 border-l-2 border-gray-600 pl-3">
        <button
          type="button"
          onClick={() => toggleSection(sectionKey)}
          className="text-sm font-semibold text-gray-300 hover:text-white mb-2 flex items-center"
        >
          <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
          {label} ({items.length})
        </button>
        {isExpanded && (
          <div className="space-y-2">
            {items.map((item, idx) => {
              const typedItem = item as {
                step?: string;
                test?: string;
                stage?: string;
                event?: string;
                status?: string;
                time?: number;
                duration?: number;
                [key: string]: unknown;
              };
              const itemName = typedItem.step || typedItem.test || typedItem.stage || typedItem.event || `Item ${idx + 1}`;
              const itemStatus = typedItem.status || 'unknown';
              const duration = typedItem.time || typedItem.duration;

              return (
                <div key={idx} className="bg-gray-800/50 rounded p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className={`mr-2 ${getStatusColor(itemStatus)}`}>
                        {getStatusIcon(itemStatus)}
                      </span>
                      <span className="font-medium">{itemName}</span>
                    </div>
                    {duration !== undefined && (
                      <span className="text-xs text-gray-400">
                        {typeof duration === 'number' ? `${duration}ms` : duration}
                      </span>
                    )}
                  </div>
                  {Object.keys(typedItem).length > 3 && (
                    <div className="mt-1 pl-6 text-xs text-gray-400 space-y-0.5">
                      {Object.entries(typedItem)
                        .filter(([key]) => !['step', 'test', 'stage', 'event', 'status', 'time', 'duration'].includes(key))
                        .map(([key, value]) => (
                          <div key={key}>
                            <span className="font-semibold">{key}:</span> {JSON.stringify(value)}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const startDiagnosticsGuru = async () => {
    setGuruRunning(true);
    setGuruError(null);
    setGuruStatus(null);

    try {
      const response = await fetch('/.netlify/functions/diagnostics-workload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to start diagnostics');
      }

      const newWorkloadId = data.workloadId;
      setGuruWorkloadId(newWorkloadId);
      setGuruStatus({
        workloadId: newWorkloadId,
        status: 'running',
        currentStep: data.nextStep,
        stepIndex: 0,
        totalSteps: data.totalSteps,
        progress: 0,
        message: 'Starting diagnostics...'
      });

      startPolling(newWorkloadId);
      await triggerBackendExecution(newWorkloadId);
    } catch (err) {
      setGuruError(err instanceof Error ? err.message : 'Unknown error');
      setGuruRunning(false);
    }
  };

  const triggerBackendExecution = async (wid: string) => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    try {
      let isComplete = false;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      while (!isComplete && consecutiveErrors < maxConsecutiveErrors) {
        try {
          const response = await fetch('/.netlify/functions/diagnostics-workload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'step', workloadId: wid })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();

          if (!data.success) {
            throw new Error(data.error || 'Step execution failed');
          }

          if (data.complete) {
            isComplete = true;
            break;
          }

          if (!data.nextStep && !isComplete) {
            isComplete = true;
            break;
          }

          consecutiveErrors = 0;
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          consecutiveErrors++;

          if (consecutiveErrors >= maxConsecutiveErrors) {
            setGuruError(err instanceof Error ? err.message : 'Step execution failed after multiple retries');
            setGuruRunning(false);
            break;
          }

          await new Promise(resolve => setTimeout(resolve, Math.pow(2, consecutiveErrors - 1) * 1000));
        }
      }
    } catch (err) {
      setGuruError(err instanceof Error ? err.message : 'Unknown error during step execution');
      setGuruRunning(false);
    } finally {
      isExecutingRef.current = false;
    }
  };

  const startPolling = (wid: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/.netlify/functions/diagnostics-workload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', workloadId: wid })
        });

        const data = await response.json();

        if (data.success) {
          setGuruStatus({
            workloadId: data.workloadId || wid,
            status: data.status || 'pending',
            currentStep: data.currentStep || 'initialize',
            stepIndex: typeof data.stepIndex === 'number' ? data.stepIndex : 0,
            totalSteps: typeof data.totalSteps === 'number' ? data.totalSteps : 0,
            progress: typeof data.progress === 'number' ? data.progress : 0,
            message: data.message || 'Processing...',
            results: Array.isArray(data.results) ? data.results : [],
            feedbackSubmitted: Array.isArray(data.feedbackSubmitted) ? data.feedbackSubmitted : [],
            summary: data.summary || undefined,
            warning: data.warning || undefined
          });

          if (data.status === 'completed' || data.status === 'failed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            setGuruRunning(false);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000);

    pollingIntervalRef.current = interval;
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  const getStepIcon = (step: string) => {
    const icons: Record<string, string> = {
      initialize: '🔧',
      test_tool: '🧪',
      analyze_failures: '📊',
      submit_feedback: '📤',
      finalize: '✅'
    };
    return icons[step] || '⚙️';
  };

  const results = state.diagnosticResults;
  const summary = results?.summary;
  const testResults = results?.results || [];
  const hasGeneralError = results?.status === 'error' && results?.error && (!results.results || results.results.length === 0);
  const hasResultsWithError = results?.status === 'error' && testResults.length > 0;

  return (
    <section id="system-diagnostics-section">
      <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">🔧 System Diagnostics</h2>
      <div className="bg-gray-800 p-4 rounded-lg shadow-inner space-y-6">
        <div>
          <p className="mb-4">Run quick system checks and the comprehensive diagnostics workload from one place.</p>
          <div className="mb-4">
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Infrastructure</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['database', 'gemini'].includes(t.id)).map(test => (
                  <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                      onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span>{test.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Core Analysis</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['analyze', 'insightsWithTools', 'asyncAnalysis'].includes(t.id)).map(test => (
                  <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                      onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span>{test.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Data Management</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['history', 'systems', 'dataExport', 'idempotency'].includes(t.id)).map(test => (
                  <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                      onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span>{test.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">External Services</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['weather', 'backfillWeather', 'backfillHourlyCloud', 'solarEstimate', 'systemAnalytics', 'predictiveMaintenance'].includes(t.id)).map(test => (
                  <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                      onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span>{test.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">System Utilities</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['contentHashing', 'errorHandling', 'logging', 'retryMechanism', 'timeout'].includes(t.id)).map(test => (
                  <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                      onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span>{test.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: ALL_DIAGNOSTIC_TESTS })}
              className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 text-sm"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: [] })}
              className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 text-sm"
            >
              Deselect All
            </button>
            <button
              type="button"
              onClick={handleRunDiagnostics}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 disabled:opacity-50 ml-auto"
              disabled={state.actionStatus.isRunningDiagnostics || (state.selectedDiagnosticTests?.length === 0)}
            >
              {state.actionStatus.isRunningDiagnostics ? (
                <div className="flex items-center">
                  <SpinnerIcon className="w-5 h-5 mr-2" />
                  <span>Running...</span>
                </div>
              ) : (
                `Run ${state.selectedDiagnosticTests?.length || ALL_DIAGNOSTIC_TESTS.length} Test${(state.selectedDiagnosticTests?.length || ALL_DIAGNOSTIC_TESTS.length) !== 1 ? 's' : ''}`
              )}
            </button>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-6">
          <h3 className="text-lg font-semibold text-secondary mb-3">Diagnostics Results</h3>
          {state.actionStatus.isRunningDiagnostics && (!results || results.results.length === 0) ? (
            <div className="bg-gray-700 p-4 rounded-md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <SpinnerIcon className="w-6 h-6 text-secondary" />
                  <span className="ml-3 text-lg font-semibold">Initializing Diagnostic Tests</span>
                </div>
                <span className="text-sm text-gray-400">
                  {(state.selectedDiagnosticTests || ALL_DIAGNOSTIC_TESTS).length} test{(state.selectedDiagnosticTests || ALL_DIAGNOSTIC_TESTS).length !== 1 ? 's' : ''} selected
                </span>
              </div>
              <p className="text-gray-400 text-sm">Please wait while the diagnostic system prepares...</p>
            </div>
          ) : (
            <>
              {hasGeneralError && (
                <div className="bg-red-900/50 border border-red-500 rounded-md p-4 mb-4">
                  <h3 className="font-semibold text-lg flex items-center text-red-300">
                    <span className="mr-2 text-red-400">✖</span>
                    Diagnostics Error
                  </h3>
                  <p className="text-red-300 mt-2 pl-6">{renderError(results?.error)}</p>
                  <p className="text-red-200 text-sm mt-3 pl-6">
                    The diagnostic system encountered a critical error before tests could run.
                    This usually indicates a configuration or connectivity issue.
                  </p>
                </div>
              )}

              {hasResultsWithError && results?.error && (
                <div className="bg-yellow-900/50 border border-yellow-500 rounded-md p-3 mb-4">
                  <p className="text-yellow-200 text-sm">
                    <span className="font-semibold">⚠️ Note:</span> Some tests encountered errors. Individual test results are shown below.
                  </p>
                </div>
              )}

              {results ? (
                <>
                  {state.actionStatus.isRunningDiagnostics && (
                    <div className="bg-blue-900/20 border border-blue-500 p-3 rounded-md mb-4">
                      <div className="flex items-center">
                        <SpinnerIcon className="w-5 h-5 text-blue-400 mr-3" />
                        <div className="flex-1">
                          <div className="font-semibold text-blue-300">Tests Running in Parallel...</div>
                          {summary && (
                            <div className="text-sm text-gray-400 mt-1">
                              {summary.success + summary.errors + (summary.warnings || 0)} of {summary.total} completed
                            </div>
                          )}
                        </div>
                      </div>
                      {summary && (
                        <progress
                          className="mt-3 w-full h-1.5 rounded-full overflow-hidden bg-gray-700 accent-blue-500"
                          max={100}
                          value={summary.total > 0 ? ((summary.success + summary.errors + (summary.warnings || 0)) / summary.total * 100) : 0}
                        />
                      )}
                    </div>
                  )}

                  {results.status && results.status !== 'error' && (
                    <div className={`border rounded-md p-4 mb-4 ${getOverallStatusColor(results.status)}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <span className={`text-2xl mr-3 ${getStatusColor(results.status)}`}>
                            {getStatusIcon(results.status)}
                          </span>
                          <div>
                            <h3 className="font-semibold text-lg">
                              {results.status === 'success' && 'All Tests Passed'}
                              {results.status === 'partial' && 'Partial Success'}
                              {results.status === 'warning' && 'Tests Completed with Warnings'}
                            </h3>
                            <p className="text-sm text-gray-300 mt-1">
                              Completed in {results.duration ? `${(results.duration / 1000).toFixed(2)}s` : 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {summary && summary.total > 0 && (
                    <div className="bg-gray-700 p-4 rounded-md mb-4">
                      <h3 className="font-semibold text-lg mb-3">Test Summary</h3>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-300">{summary.total}</div>
                          <div className="text-sm text-gray-400">Total Tests</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-400">{summary.success}</div>
                          <div className="text-sm text-gray-400">Passed</div>
                        </div>
                        {(summary.partial && summary.partial > 0) && (
                          <div className="text-center">
                            <div className="text-2xl font-bold text-yellow-400">{summary.partial}</div>
                            <div className="text-sm text-gray-400">Partial</div>
                          </div>
                        )}
                        {(summary.warnings && summary.warnings > 0) && (
                          <div className="text-center">
                            <div className="text-2xl font-bold text-yellow-400">{summary.warnings}</div>
                            <div className="text-sm text-gray-400">Warnings</div>
                          </div>
                        )}
                        <div className="text-center">
                          <div className="text-2xl font-bold text-red-400">{summary.errors}</div>
                          <div className="text-sm text-gray-400">Failed</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {testResults.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-lg mb-2">Test Results</h3>
                      {testResults.map((result, index) => {
                        const isExpanded = expandedTestId === result.name;
                        const hasDetails = result.details || result.error;
                        const hasNestedItems = result.steps || result.tests || result.stages || result.jobLifecycle;

                        return (
                          <div
                            key={index}
                            className={`bg-gray-700 p-4 rounded-md transition-all ${result.status === 'error' ? 'border border-red-500/30' :
                              result.status === 'warning' ? 'border border-yellow-500/30' :
                                result.status === 'partial' ? 'border border-yellow-500/30' : ''
                              }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center">
                                  {result.status === 'running' ? (
                                    <SpinnerIcon className="w-5 h-5 text-blue-400 mr-2" />
                                  ) : (
                                    <span className={`text-xl mr-2 ${getStatusColor(result.status)}`}>
                                      {getStatusIcon(result.status)}
                                    </span>
                                  )}
                                  <h4 className="font-semibold text-base">{result.name}</h4>
                                  <span className="ml-3 text-xs text-gray-400">
                                    {result.status === 'running' ? (
                                      <span className="text-blue-400">running...</span>
                                    ) : result.duration ? (
                                      `${result.duration}ms`
                                    ) : ''}
                                  </span>
                                </div>

                                {result.error && !isExpanded && (
                                  <p className="text-sm text-red-300 mt-2 pl-7">{renderError(result.error)}</p>
                                )}

                                {hasNestedItems && !isExpanded && (
                                  <div className="mt-2 pl-7 text-sm text-gray-400">
                                    {result.steps && <span>• {result.steps.length} steps</span>}
                                    {result.tests && <span>• {result.tests.length} tests</span>}
                                    {result.stages && <span>• {result.stages.length} stages</span>}
                                    {result.jobLifecycle && <span>• {result.jobLifecycle.length} lifecycle events</span>}
                                  </div>
                                )}
                              </div>

                              {(hasDetails || hasNestedItems) && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedTestId(isExpanded ? null : result.name)}
                                  className={`ml-2 text-xs px-3 py-1 rounded transition-colors whitespace-nowrap ${result.status === 'error'
                                    ? 'text-red-400 hover:text-red-300 bg-red-900/30 hover:bg-red-900/50'
                                    : 'text-blue-400 hover:text-blue-300 bg-blue-900/30 hover:bg-blue-900/50'
                                    }`}
                                >
                                  {isExpanded ? 'Hide Details' : 'Show Details'}
                                </button>
                              )}
                            </div>

                            {isExpanded && (hasDetails || hasNestedItems) && (
                              <div className="mt-4 p-3 bg-gray-800 rounded border border-gray-600">
                                {result.error && (
                                  <div className="mb-3">
                                    <div className="font-semibold text-red-300 text-sm mb-1">Error:</div>
                                    <div className="text-sm text-red-200 font-mono bg-red-900/20 p-2 rounded whitespace-pre-wrap break-words">
                                      {renderError(result.error)}
                                    </div>
                                  </div>
                                )}

                                {result.steps && renderNestedItems(result.steps, 'Steps', result.name)}
                                {result.tests && renderNestedItems(result.tests, 'Tests', result.name)}
                                {result.stages && renderNestedItems(result.stages, 'Stages', result.name)}
                                {result.jobLifecycle && renderNestedItems(result.jobLifecycle, 'Job Lifecycle', result.name)}

                                {result.details && Object.keys(result.details).length > 0 && (
                                  <div className="mt-3">
                                    <div className="font-semibold text-gray-300 text-sm mb-2">Additional Details:</div>
                                    <div className="text-xs text-gray-300 font-mono bg-gray-900/50 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
                                      <pre>{JSON.stringify(result.details, null, 2)}</pre>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {testResults.some(r => r.status === 'error' || r.status === 'warning') && (
                    <div className="bg-blue-900/20 border border-blue-500 p-4 rounded-md mt-4">
                      <h3 className="font-semibold text-lg text-blue-300 mb-2 flex items-center">
                        <span className="mr-2">💡</span>
                        Troubleshooting Tips
                      </h3>
                      <ul className="list-disc list-inside text-gray-300 space-y-2 text-sm">
                        <li><strong>Check Dependencies:</strong> Ensure MongoDB, Netlify Functions, and external APIs (Gemini, Weather) are reachable.</li>
                        <li><strong>Review Logs:</strong> Check Netlify function logs for detailed error messages and stack traces.</li>
                        <li><strong>Configuration:</strong> Verify environment variables (GEMINI_API_KEY, MONGODB_URI, etc.) are set correctly.</li>
                        <li><strong>Network Issues:</strong> Verify connectivity and timeout values if requests are timing out.</li>
                        <li><strong>Async Analysis:</strong> If async analysis shows warnings, ensure background job processor is running.</li>
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-gray-400 py-8">
                  No diagnostic results available. Click Run Tests to start diagnostics.
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-gray-700 pt-6">
          <h3 className="text-lg font-semibold text-secondary mb-3">Diagnostics Guru Workload</h3>
          {!guruRunning && !guruStatus?.summary && (
            <div className="space-y-4">
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
                <h4 className="font-semibold text-blue-200 mb-2">What this does:</h4>
                <ul className="text-sm text-blue-100 space-y-1 list-disc list-inside">
                  <li>Tests tools with valid and edge-case parameters</li>
                  <li>Records success/failure, response times, and error details</li>
                  <li>Categorizes failures (network, database, parameters, etc.)</li>
                  <li>Auto-submits feedback to AI Feedback dashboard with <code className="bg-blue-800 px-1">guruSource: diagnostics-guru</code></li>
                  <li>Provides comprehensive pass/fail summary</li>
                </ul>
              </div>

              <button
                type="button"
                onClick={startDiagnosticsGuru}
                disabled={guruRunning}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <span className="text-xl mr-2">▶️</span>
                Run Diagnostics
              </button>
            </div>
          )}

          {guruRunning && guruStatus && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {getStepIcon(guruStatus.currentStep)} {guruStatus.message || 'Processing...'}
                  </span>
                  <span className="text-sm text-gray-600">
                    Step {(ensureNumber(guruStatus.stepIndex, 0) + 1)} / {ensureNumber(guruStatus.totalSteps, 0)}
                  </span>
                </div>

                <progress
                  className="w-full h-2.5 rounded-full overflow-hidden bg-gray-200 accent-blue-600"
                  max={100}
                  value={Math.min(100, Math.max(0, ensureNumber(guruStatus.progress, 0)))}
                />

                <div className="text-xs text-gray-500 mt-1 text-right">
                  {ensureNumber(guruStatus.progress, 0)}%
                </div>
              </div>

              <div className="flex items-center justify-center text-blue-600">
                <SpinnerIcon className="h-5 w-5 mr-2" />
                <span className="text-sm">Running diagnostics...</span>
              </div>
            </div>
          )}

          {guruStatus?.summary && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-semibold text-green-900 mb-3 flex items-center">
                  <span className="text-xl mr-2">✅</span>
                  Diagnostics Complete
                </h3>

                {guruWorkloadId && (
                  <div className="text-xs text-gray-600 mb-3 font-mono">
                    Workload ID: {guruWorkloadId}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-gray-600">Total Tests</div>
                    <div className="text-2xl font-bold text-gray-900">{guruStatus.summary.totalTests}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Pass Rate</div>
                    <div className="text-2xl font-bold text-green-600">
                      {typeof guruStatus.summary.totalTests === 'number' && typeof guruStatus.summary.passedTests === 'number' && guruStatus.summary.totalTests > 0
                        ? ((guruStatus.summary.passedTests / guruStatus.summary.totalTests) * 100).toFixed(1)
                        : 'N/A'}%
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-600">Passed</div>
                    <div className="text-lg font-semibold text-green-700">{guruStatus.summary.passedTests}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Failed</div>
                    <div className="text-lg font-semibold text-red-600">{guruStatus.summary.failedTests}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Avg Response</div>
                    <div className="text-lg font-semibold text-gray-700">{guruStatus.summary.averageResponseTime}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Duration</div>
                    <div className="text-lg font-semibold text-gray-700">
                      {(guruStatus.summary.duration / 1000).toFixed(1)}s
                    </div>
                  </div>
                </div>

                {guruStatus.summary.errors && (guruStatus.summary.errors.analysisError || guruStatus.summary.errors.feedbackError || guruStatus.summary.errors.finalizationError) && (
                  <div className="mt-4 bg-yellow-50 border border-yellow-300 rounded p-3">
                    <h4 className="font-semibold text-yellow-900 text-sm mb-2">⚠️ Diagnostics Completed with Warnings</h4>
                    <ul className="text-xs text-yellow-800 space-y-1 list-disc list-inside">
                      {guruStatus.summary.errors.analysisError && (
                        <li>Analysis step had errors: {guruStatus.summary.errors.analysisError}</li>
                      )}
                      {guruStatus.summary.errors.feedbackError && (
                        <li>Feedback submission had errors: {guruStatus.summary.errors.feedbackError}</li>
                      )}
                      {guruStatus.summary.errors.finalizationError && (
                        <li>Finalization had errors: {guruStatus.summary.errors.finalizationError}</li>
                      )}
                    </ul>
                    <p className="text-xs text-yellow-700 mt-2">
                      Despite these warnings, all tools were tested and results are available. Review logs for details.
                    </p>
                  </div>
                )}
              </div>

              {guruStatus.summary.toolResults && Array.isArray(guruStatus.summary.toolResults) && guruStatus.summary.toolResults.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">🔧 Tool Test Results</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {guruStatus.summary.toolResults.map((tool: unknown, idx: number) => {
                      const toolResult = tool as { tool: string; validTestPassed: boolean; edgeCaseTestPassed: boolean };
                      return (
                        <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span className="text-sm font-medium text-gray-700">{toolResult.tool}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-1 rounded ${toolResult.validTestPassed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              Valid: {toolResult.validTestPassed ? '✅' : '❌'}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded ${toolResult.edgeCaseTestPassed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              Edge: {toolResult.edgeCaseTestPassed ? '✅' : '❌'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {guruStatus.summary.recommendations && Array.isArray(guruStatus.summary.recommendations) && guruStatus.summary.recommendations.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-3">💡 Recommendations</h3>
                  <div className="space-y-2">
                    {guruStatus.summary.recommendations.map((rec: unknown, idx: number) => {
                      const recommendation = rec as {
                        severity: string;
                        message: string;
                        action: string;
                        priority: string
                      };
                      return (
                        <div key={idx} className={`p-3 rounded border ${recommendation.severity === 'critical' ? 'bg-red-50 border-red-300' :
                          recommendation.severity === 'high' ? 'bg-orange-50 border-orange-300' :
                            recommendation.severity === 'medium' ? 'bg-yellow-50 border-yellow-300' :
                              'bg-blue-50 border-blue-200'
                          }`}>
                          <div className="flex items-start gap-2">
                            <span className="text-lg">
                              {recommendation.severity === 'critical' ? '🔴' :
                                recommendation.severity === 'high' ? '🟠' :
                                  recommendation.severity === 'medium' ? '🟡' : 'ℹ️'}
                            </span>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900">{recommendation.message}</p>
                              <p className="text-xs text-gray-600 mt-1">{recommendation.action}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {guruStatus.summary.githubIssuesCreated && Array.isArray(guruStatus.summary.githubIssuesCreated) && guruStatus.summary.githubIssuesCreated.length > 0 && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 className="font-semibold text-purple-900 mb-3">
                    🎫 GitHub Issues Created ({guruStatus.summary.githubIssuesCreated.length})
                  </h3>
                  <div className="space-y-2">
                    {guruStatus.summary.githubIssuesCreated.map((issue: unknown, idx: number) => {
                      const githubIssue = issue as {
                        issueNumber: number;
                        category?: string;
                        title: string;
                        url: string;
                        issueUrl: string;
                        status: string;
                      };
                      return (
                        <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border border-purple-200">
                          <div className="flex-1">
                            <span className="text-sm font-medium text-purple-900">
                              #{githubIssue.issueNumber} - {githubIssue.category?.replace(/_/g, ' ') || 'Unknown'}
                            </span>
                          </div>
                          <a
                            href={githubIssue.issueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
                          >
                            View Issue →
                          </a>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-purple-700 mt-3">
                    Critical failures have been automatically reported. Review and assign these issues as needed.
                  </p>
                </div>
              )}

              {guruStatus.feedbackSubmitted && Array.isArray(guruStatus.feedbackSubmitted) && guruStatus.feedbackSubmitted.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="font-semibold text-yellow-900 mb-2">
                    📤 Feedback Submitted
                  </h3>
                  <ul className="text-sm text-yellow-800 space-y-1">
                    {guruStatus.feedbackSubmitted.map((fb: unknown, idx: number) => {
                      const feedback = fb as {
                        feedbackId?: string;
                        failureCount?: number;
                        title?: string;
                        status?: string;
                        category?: string;
                        isDuplicate?: boolean;
                        error?: string;
                      };
                      const failureCount = (feedback && typeof feedback.failureCount === 'number') ? feedback.failureCount : 0;
                      return (
                        <li key={idx} className="flex items-center justify-between">
                          <span>
                            {(feedback && feedback.feedbackId) ? '✅' : '❌'} {(feedback && feedback.category) ? feedback.category.replace(/_/g, ' ') : 'Unknown category'}
                            {feedback && feedback.isDuplicate && <span className="text-yellow-600 ml-2">(duplicate)</span>}
                            {feedback && feedback.error && <span className="text-red-600 ml-2 text-xs">({feedback.error})</span>}
                          </span>
                          <span className="text-xs text-yellow-600">
                            {failureCount} failure{failureCount !== 1 ? 's' : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-yellow-700 mt-3">
                    View submitted feedback in the AI Feedback dashboard filtered by diagnostics-guru
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setGuruStatus(null);
                  setGuruWorkloadId(null);
                }}
                className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Run Again
              </button>
            </div>
          )}

          {guruError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="font-semibold text-red-900 mb-2">❌ Error</h3>
              <p className="text-sm text-red-800">{guruError}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default UnifiedDiagnosticsDashboard;
