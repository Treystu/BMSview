
import React, { useState } from 'react';
import SpinnerIcon from './icons/SpinnerIcon';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: Record<string, { status: string; message: string }>;
  isLoading: boolean;
}

const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose, results, isLoading }) => {
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);

  if (!isOpen) return null;

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return 'text-green-400';
      case 'failure':
        return 'text-red-400';
      case 'skipped':
        return 'text-yellow-400';
      default:
        return 'text-yellow-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'success':
        return '✔';
      case 'failure':
        return '✖';
      case 'skipped':
        return 'ℹ';
      default:
        return '?';
    }
  };

  // Filter out metadata keys that shouldn't be displayed as test results
  const metadataKeys = ['suggestions', 'availableTests', 'availableTestsList', 'availableComprehensiveTests', 'testSummary'];
  const testResults = Object.entries(results).filter(([key]) => !metadataKeys.includes(key));
  const suggestions = Array.isArray(results.suggestions) ? results.suggestions : [];
  const summary = results.testSummary as any;

  // Check if there's a general error (e.g., from failed API call)
  const hasGeneralError = testResults.length === 1 && testResults[0][0] === 'error';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-gray-600 pb-3 mb-4">
          <h2 className="text-xl font-semibold text-secondary">System Diagnostics</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerIcon className="w-8 h-8 text-secondary" />
            <span className="ml-4 text-lg">Running diagnostic tests... (this may take up to 60 seconds)</span>
          </div>
        ) : hasGeneralError ? (
          // Display general error message prominently
          <div className="bg-red-900/50 border border-red-500 rounded-md p-4 mb-4">
            <h3 className="font-semibold text-lg flex items-center text-red-300">
              <span className="mr-2 text-red-400">✖</span>
              Diagnostics Error
            </h3>
            <p className="text-red-300 mt-2 pl-6">{testResults[0][1].message}</p>
          </div>
        ) : (
          <>
            {/* Display summary if available */}
            {summary && (
              <div className="bg-gray-700 p-4 rounded-md mb-4">
                <h3 className="font-semibold text-lg mb-2">Test Summary</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-400">Total Tests:</span>
                    <span className="ml-2 font-semibold">{summary.total}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Success Rate:</span>
                    <span className="ml-2 font-semibold text-green-400">{summary.successRate}%</span>
                  </div>
                  <div>
                    <span className="text-green-400">✔ Passed:</span>
                    <span className="ml-2 font-semibold">{summary.success}</span>
                  </div>
                  <div>
                    <span className="text-red-400">✖ Failed:</span>
                    <span className="ml-2 font-semibold">{summary.failure}</span>
                  </div>
                  {summary.skipped > 0 && (
                    <div>
                      <span className="text-yellow-400">ℹ Skipped:</span>
                      <span className="ml-2 font-semibold">{summary.skipped}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Display individual test results */}
            <div className="space-y-3">
              {testResults.map(([key, result]) => {
                const r = result as any;
                const isExpanded = expandedTestId === key;
                const isFailed = r.status && r.status.toLowerCase() === 'failure';

                return (
                  <div key={key} className={`bg-gray-700 p-3 rounded-md ${isFailed ? 'border border-red-500/30' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-base capitalize flex items-center">
                          <span className={`mr-2 ${getStatusColor(r.status || '')}`}>
                            {getStatusIcon(r.status)}
                          </span>
                          {key.replace(/([A-Z])/g, ' $1')}
                        </h3>
                        <p className="text-gray-300 text-sm mt-1 pl-6">{r && r.message ? String(r.message) : ''}</p>
                        {r && r.responseTime && (
                          <p className="text-gray-400 text-xs mt-1 pl-6">Response time: {r.responseTime}ms</p>
                        )}
                      </div>
                      {isFailed && (
                        <button
                          onClick={() => setExpandedTestId(isExpanded ? null : key)}
                          className="ml-2 text-red-400 hover:text-red-300 text-xs px-2 py-1 bg-red-900/30 rounded"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                      )}
                    </div>

                    {/* Expanded raw output for failures */}
                    {isExpanded && isFailed && (
                      <div className="mt-3 p-3 bg-gray-800 rounded text-gray-300 text-xs font-mono border border-red-500/20">
                        <div className="font-semibold text-red-300 mb-2">Error Details:</div>
                        <div className="overflow-x-auto max-h-64 overflow-y-auto">
                          {typeof r.error === 'string' ? (
                            <pre>{r.error}</pre>
                          ) : (
                            <pre>{JSON.stringify(r, null, 2)}</pre>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Display suggestions if any */}
            {suggestions.length > 0 && (
              <div className="bg-blue-900/30 border border-blue-500 p-4 rounded-md mt-4">
                <h3 className="font-semibold text-lg mb-2">Suggestions</h3>
                <ul className="list-disc list-inside text-gray-300 space-y-1 text-sm">
                  {suggestions.map((s, idx) => <li key={idx}>{String(s)}</li>)}
                </ul>
              </div>
            )}

            {/* Troubleshooting section for partial failures */}
            {testResults.some(([, r]) => (r as any).status?.toLowerCase() === 'failure') && (
              <div className="bg-yellow-900/20 border border-yellow-600 p-4 rounded-md mt-4">
                <h3 className="font-semibold text-lg text-yellow-300 mb-2">Troubleshooting Failed Tests</h3>
                <ul className="list-disc list-inside text-gray-300 space-y-2 text-sm">
                  <li><strong>Check Dependencies:</strong> Ensure MongoDB, Netlify Functions, and external APIs (Gemini, Weather) are reachable.</li>
                  <li><strong>Review Logs:</strong> Check Netlify function logs for detailed error messages and stack traces.</li>
                  <li><strong>Test Isolation:</strong> Failed tests do not affect other tests—retry individual failures after fixing upstream issues.</li>
                  <li><strong>Network Issues:</strong> Verify connectivity and timeout values if requests are timing out.</li>
                  <li><strong>Configuration:</strong> Verify environment variables (GEMINI_API_KEY, MONGODB_URI, etc.) are set correctly.</li>
                </ul>
              </div>
            )}
          </>
        )}

        <div className="mt-6 text-right">
          <button
            onClick={onClose}
            className="bg-secondary hover:bg-secondary-dark text-white font-bold py-2 px-4 rounded-md transition duration-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsModal;
