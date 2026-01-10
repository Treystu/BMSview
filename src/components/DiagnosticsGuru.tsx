import React, { useEffect, useRef, useState } from 'react';
import { ensureNumber } from '../utils/stateHelpers';
import SpinnerIcon from './icons/SpinnerIcon';

interface DiagnosticsGuruProps {
  className?: string;
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
    // Fields returned by finalizeDiagnostics
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

export const DiagnosticsGuru: React.FC<DiagnosticsGuruProps> = ({ className = '' }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [workloadId, setWorkloadId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkloadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isExecutingRef = useRef(false);

  // Start diagnostics workload
  const startDiagnostics = async () => {
    setIsRunning(true);
    setError(null);
    setStatus(null);

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
      setWorkloadId(newWorkloadId);
      setStatus({
        workloadId: newWorkloadId,
        status: 'running',
        currentStep: data.nextStep,
        stepIndex: 0,
        totalSteps: data.totalSteps,
        progress: 0,
        message: 'Starting diagnostics...'
      });

      // Start polling for status (backend will execute steps autonomously)
      startPolling(newWorkloadId);

      // Trigger backend to start executing steps
      await triggerBackendExecution(newWorkloadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsRunning(false);
    }
  };

  // Trigger backend to execute all steps (loop until complete)
  const triggerBackendExecution = async (wid: string) => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    try {
      let isComplete = false;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      // Keep executing steps until the workload is complete
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

          // Log step completion
          console.log('Step completed:', {
            step: data.step,
            nextStep: data.nextStep,
            complete: data.complete,
            warning: data.warning
          });

          // If this step reported completion, we're done
          if (data.complete) {
            isComplete = true;
            console.log('Diagnostics workload complete');
            break;
          }

          // Safety check: prevent infinite loops if backend returns malformed response
          if (!data.nextStep && !isComplete) {
            console.warn('No next step indicated but not complete - treating as complete');
            isComplete = true;
            break;
          }

          // Reset error counter on success
          consecutiveErrors = 0;

          // Small delay between steps to avoid overwhelming the backend
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (err) {
          consecutiveErrors++;
          console.error(`Step execution error (${consecutiveErrors}/${maxConsecutiveErrors}):`, err);

          if (consecutiveErrors >= maxConsecutiveErrors) {
            setError(err instanceof Error ? err.message : 'Step execution failed after multiple retries');
            setIsRunning(false);
            break;
          }

          // Exponential backoff on errors: 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, consecutiveErrors - 1) * 1000));
        }
      }
    } catch (err) {
      console.error('Fatal error in step execution:', err);
      setError(err instanceof Error ? err.message : 'Unknown error during step execution');
      setIsRunning(false);
    } finally {
      isExecutingRef.current = false;
    }
  };

  // Poll for status updates
  const startPolling = (wid: string) => {
    // Clear any existing interval
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

        // Debug logging for diagnostics
        console.log('Diagnostics status response:', {
          success: data.success,
          status: data.status,
          currentStep: data.currentStep,
          hasSummary: !!data.summary,
          summaryKeys: data.summary ? Object.keys(data.summary) : []
        });

        if (data.success) {
          // CRITICAL FIX: Defensive state update with explicit defaults
          setStatus({
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

          // Stop polling if complete
          if (data.status === 'completed' || data.status === 'failed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            setIsRunning(false);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000); // Poll every 2 seconds

    pollingIntervalRef.current = interval;
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []); // Empty deps array - only cleanup on unmount

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

  return (
    <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <div className="border-b border-gray-200 pb-4 mb-4">
        <h2 className="text-2xl font-semibold text-gray-900 flex items-center">
          <span className="text-3xl mr-3">🔧</span>
          Diagnostics Guru
        </h2>
        <p className="text-sm text-gray-600 mt-2">
          Systematically test all available tools and submit diagnostic reports to AI Feedback
        </p>
      </div>

      {/* Start Button */}
      {!isRunning && !status?.summary && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">What this does:</h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Tests 11 available tools with valid and edge-case parameters</li>
              <li>Records success/failure, response times, and error details</li>
              <li>Categorizes failures (network, database, parameters, etc.)</li>
              <li>Auto-submits feedback to AI Feedback dashboard with <code className="bg-blue-100 px-1">guruSource: diagnostics-guru</code></li>
              <li>Provides comprehensive pass/fail summary</li>
            </ul>
          </div>

          <button
            onClick={startDiagnostics}
            disabled={isRunning}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
          >
            <span className="text-xl mr-2">▶️</span>
            Run Diagnostics
          </button>
        </div>
      )}

      {/* Progress */}
      {isRunning && status && (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {getStepIcon(status.currentStep)} {status.message || 'Processing...'}
              </span>
              <span className="text-sm text-gray-600">
                Step {(ensureNumber(status.stepIndex, 0) + 1)} / {ensureNumber(status.totalSteps, 0)}
              </span>
            </div>

            {/* Progress bar */}
            <progress
              className="w-full h-2.5 rounded-full overflow-hidden bg-gray-200 accent-blue-600"
              max={100}
              value={Math.min(100, Math.max(0, ensureNumber(status.progress, 0)))}
            />

            <div className="text-xs text-gray-500 mt-1 text-right">
              {ensureNumber(status.progress, 0)}%
            </div>
          </div>

          <div className="flex items-center justify-center text-blue-600">
            <SpinnerIcon className="h-5 w-5 mr-2" />
            <span className="text-sm">Running diagnostics...</span>
          </div>
        </div>
      )}

      {/* Summary */}
      {status?.summary && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 className="font-semibold text-green-900 mb-3 flex items-center">
              <span className="text-xl mr-2">✅</span>
              Diagnostics Complete
            </h3>

            {workloadId && (
              <div className="text-xs text-gray-600 mb-3 font-mono">
                Workload ID: {workloadId}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-600">Total Tests</div>
                <div className="text-2xl font-bold text-gray-900">{status.summary.totalTests}</div>
              </div>
              <div>
                <div className="text-gray-600">Pass Rate</div>
                <div className="text-2xl font-bold text-green-600">
                  {typeof status.summary.totalTests === 'number' && typeof status.summary.passedTests === 'number' && status.summary.totalTests > 0
                    ? ((status.summary.passedTests / status.summary.totalTests) * 100).toFixed(1)
                    : 'N/A'}%
                </div>
              </div>
              <div>
                <div className="text-gray-600">Passed</div>
                <div className="text-lg font-semibold text-green-700">{status.summary.passedTests}</div>
              </div>
              <div>
                <div className="text-gray-600">Failed</div>
                <div className="text-lg font-semibold text-red-600">{status.summary.failedTests}</div>
              </div>
              <div>
                <div className="text-gray-600">Avg Response</div>
                <div className="text-lg font-semibold text-gray-700">{status.summary.averageResponseTime}</div>
              </div>
              <div>
                <div className="text-gray-600">Duration</div>
                <div className="text-lg font-semibold text-gray-700">
                  {(status.summary.duration / 1000).toFixed(1)}s
                </div>
              </div>
            </div>

            {/* Show warnings/errors if any occurred during processing */}
            {status.summary.errors && (status.summary.errors.analysisError || status.summary.errors.feedbackError || status.summary.errors.finalizationError) && (
              <div className="mt-4 bg-yellow-50 border border-yellow-300 rounded p-3">
                <h4 className="font-semibold text-yellow-900 text-sm mb-2">⚠️ Diagnostics Completed with Warnings</h4>
                <ul className="text-xs text-yellow-800 space-y-1 list-disc list-inside">
                  {status.summary.errors.analysisError && (
                    <li>Analysis step had errors: {status.summary.errors.analysisError}</li>
                  )}
                  {status.summary.errors.feedbackError && (
                    <li>Feedback submission had errors: {status.summary.errors.feedbackError}</li>
                  )}
                  {status.summary.errors.finalizationError && (
                    <li>Finalization had errors: {status.summary.errors.finalizationError}</li>
                  )}
                </ul>
                <p className="text-xs text-yellow-700 mt-2">
                  Despite these warnings, all tools were tested and results are available. Review logs for details.
                </p>
              </div>
            )}
          </div>

          {/* Detailed Tool Results */}
          {status.summary.toolResults && Array.isArray(status.summary.toolResults) && status.summary.toolResults.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">🔧 Tool Test Results</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {status.summary.toolResults.map((tool: unknown, idx: number) => {
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

          {/* Recommendations */}
          {status.summary.recommendations && Array.isArray(status.summary.recommendations) && status.summary.recommendations.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-3">💡 Recommendations</h3>
              <div className="space-y-2">
                {status.summary.recommendations.map((rec: unknown, idx: number) => {
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

          {/* GitHub Issues Created */}
          {status.summary.githubIssuesCreated && Array.isArray(status.summary.githubIssuesCreated) && status.summary.githubIssuesCreated.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h3 className="font-semibold text-purple-900 mb-3">
                🎫 GitHub Issues Created ({status.summary.githubIssuesCreated.length})
              </h3>
              <div className="space-y-2">
                {status.summary.githubIssuesCreated.map((issue: unknown, idx: number) => {
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

          {status.feedbackSubmitted && Array.isArray(status.feedbackSubmitted) && status.feedbackSubmitted.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-900 mb-2">
                📤 Feedback Submitted
              </h3>
              <ul className="text-sm text-yellow-800 space-y-1">
                {status.feedbackSubmitted && status.feedbackSubmitted.map((fb: unknown, idx: number) => {
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
            onClick={() => {
              setStatus(null);
              setWorkloadId(null);
            }}
            className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Run Again
          </button>
        </div>
      )
      }

      {/* Error */}
      {
        error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 className="font-semibold text-red-900 mb-2">❌ Error</h3>
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )
      }
    </div >
  );
};
