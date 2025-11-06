
import React from 'react';
import SpinnerIcon from './icons/SpinnerIcon';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: Record<string, { status: string; message: string }>;
  isLoading: boolean;
}

const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose, results, isLoading }) => {
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
                return (
                  <div key={key} className="bg-gray-700 p-3 rounded-md">
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
