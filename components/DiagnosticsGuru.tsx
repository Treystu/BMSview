import React, { useState, useEffect } from 'react';
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
  results?: any[];
  feedbackSubmitted?: any[];
  summary?: {
    totalToolsTested: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    failureRate: string;
    averageResponseTime: string;
    duration: number;
  };
}

export const DiagnosticsGuru: React.FC<DiagnosticsGuruProps> = ({ className = '' }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [workloadId, setWorkloadId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkloadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

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
      
      setWorkloadId(data.workloadId);
      setStatus({
        workloadId: data.workloadId,
        status: 'running',
        currentStep: data.nextStep,
        stepIndex: 0,
        totalSteps: data.totalSteps,
        progress: 0,
        message: 'Starting diagnostics...'
      });
      
      // Start polling for status
      startPolling(data.workloadId);
      
      // Execute first step
      await executeStep(data.workloadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsRunning(false);
    }
  };

  // Execute a single step
  const executeStep = async (wid: string) => {
    try {
      const response = await fetch('/.netlify/functions/diagnostics-workload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'step', workloadId: wid })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Step execution failed');
      }
      
      // If not complete, schedule next step
      if (!data.complete) {
        setTimeout(() => executeStep(wid), 100);
      }
    } catch (err) {
      console.error('Step execution error:', err);
      setError(err instanceof Error ? err.message : 'Step execution failed');
    }
  };

  // Poll for status updates
  const startPolling = (wid: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch('/.netlify/functions/diagnostics-workload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', workloadId: wid })
        });
        
        const data = await response.json();
        
        if (data.success) {
          setStatus({
            workloadId: data.workloadId,
            status: data.status,
            currentStep: data.currentStep,
            stepIndex: data.stepIndex,
            totalSteps: data.totalSteps,
            progress: data.progress || 0,
            message: data.message,
            results: data.results,
            feedbackSubmitted: data.feedbackSubmitted,
            summary: data.summary
          });
          
          // Stop polling if complete
          if (data.status === 'completed' || data.status === 'failed') {
            if (pollingInterval) {
              clearInterval(pollingInterval);
            }
            setIsRunning(false);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000); // Poll every 2 seconds
    
    setPollingInterval(interval);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

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
              <li>Auto-submits feedback to AI Feedback dashboard with <code className="bg-blue-100 px-1">guruSource: 'diagnostics-guru'</code></li>
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
                {getStepIcon(status.currentStep)} {status.message}
              </span>
              <span className="text-sm text-gray-600">
                Step {status.stepIndex + 1} / {status.totalSteps}
              </span>
            </div>
            
            {/* Progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${status.progress}%` }}
              ></div>
            </div>
            
            <div className="text-xs text-gray-500 mt-1 text-right">
              {status.progress}%
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
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-600">Total Tests</div>
                <div className="text-2xl font-bold text-gray-900">{status.summary.totalTests}</div>
              </div>
              <div>
                <div className="text-gray-600">Pass Rate</div>
                <div className="text-2xl font-bold text-green-600">
                  {((status.summary.passedTests / status.summary.totalTests) * 100).toFixed(1)}%
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
          </div>

          {status.feedbackSubmitted && status.feedbackSubmitted.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-900 mb-2">
                📤 Feedback Submitted ({status.feedbackSubmitted.length})
              </h3>
              <ul className="text-sm text-yellow-800 space-y-1">
                {status.feedbackSubmitted.map((fb: any, idx: number) => (
                  <li key={idx} className="flex items-center justify-between">
                    <span>
                      {fb.category.replace(/_/g, ' ')} 
                      {fb.isDuplicate && <span className="text-yellow-600 ml-2">(duplicate)</span>}
                    </span>
                    <span className="text-xs text-yellow-600">
                      {fb.failureCount} failure{fb.failureCount > 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-yellow-700 mt-3">
                View these in the AI Feedback dashboard filtered by "diagnostics-guru"
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
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-900 mb-2">❌ Error</h3>
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
    </div>
  );
};
