
import React, { useState } from 'react';
import SpinnerIcon from './icons/SpinnerIcon';

interface DiagnosticTestResult {
  name: string;
  status: 'success' | 'warning' | 'error';
  duration: number;
  details?: Record<string, any>;
  error?: string;
}

interface DiagnosticsResponse {
  status: 'success' | 'partial' | 'warning' | 'error';
  timestamp: string;
  duration: number;
  results: DiagnosticTestResult[];
  summary?: {
    total: number;
    success: number;
    warnings: number;
    errors: number;
  };
  error?: string;
}

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: DiagnosticsResponse | null;
  isLoading: boolean;
}

const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose, results, isLoading }) => {
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);

  if (!isOpen) return null;

  // Helper function to safely render error messages
  const renderError = (error: any): string => {
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object') {
      // If it's an object, try to extract a message or stringify it
      return error.message || JSON.stringify(error, null, 2);
    }
    return 'Unknown error occurred';
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return 'text-green-400';
      case 'warning':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'success':
        return '✔';
      case 'warning':
        return '⚠';
      case 'error':
        return '✖';
      default:
        return '?';
    }
  };

  const getOverallStatusColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case 'success':
        return 'border-green-500 bg-green-900/20';
      case 'partial':
        return 'border-yellow-500 bg-yellow-900/20';
      case 'warning':
        return 'border-yellow-500 bg-yellow-900/20';
      case 'error':
        return 'border-red-500 bg-red-900/20';
      default:
        return 'border-gray-500 bg-gray-900/20';
    }
  };

  const hasGeneralError = results?.status === 'error' && results?.error && (!results.results || results.results.length === 0);
  const summary = results?.summary;
  const testResults = results?.results || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
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
            <p className="text-red-300 mt-2 pl-6">{renderError(results.error)}</p>
          </div>
        ) : results ? (
          <>
            {/* Overall Status Banner */}
            {results.status && (
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
                        {results.status === 'error' && 'Tests Failed'}
                      </h3>
                      <p className="text-sm text-gray-300 mt-1">
                        Completed in {results.duration ? `${(results.duration / 1000).toFixed(2)}s` : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Display summary if available */}
            {summary && summary.total > 0 && (
              <div className="bg-gray-700 p-4 rounded-md mb-4">
                <h3 className="font-semibold text-lg mb-3">Test Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-300">{summary.total}</div>
                    <div className="text-sm text-gray-400">Total Tests</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">{summary.success}</div>
                    <div className="text-sm text-gray-400">Passed</div>
                  </div>
                  {summary.warnings > 0 && (
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

            {/* Display individual test results */}
            {testResults.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-lg mb-2">Test Results</h3>
                {testResults.map((result, index) => {
                  const isExpanded = expandedTestId === result.name;
                  const hasDetails = result.details || result.error;

                  return (
                    <div 
                      key={index} 
                      className={`bg-gray-700 p-4 rounded-md transition-all ${
                        result.status === 'error' ? 'border border-red-500/30' : 
                        result.status === 'warning' ? 'border border-yellow-500/30' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center">
                            <span className={`text-xl mr-2 ${getStatusColor(result.status)}`}>
                              {getStatusIcon(result.status)}
                            </span>
                            <h4 className="font-semibold text-base">{result.name}</h4>
                            <span className="ml-3 text-xs text-gray-400">
                              {result.duration ? `${result.duration}ms` : ''}
                            </span>
                          </div>
                          
                          {result.error && !isExpanded && (
                            <p className="text-sm text-red-300 mt-2 pl-7">{renderError(result.error)}</p>
                          )}
                        </div>
                        
                        {hasDetails && (
                          <button
                            onClick={() => setExpandedTestId(isExpanded ? null : result.name)}
                            className={`ml-2 text-xs px-3 py-1 rounded transition-colors ${
                              result.status === 'error' 
                                ? 'text-red-400 hover:text-red-300 bg-red-900/30 hover:bg-red-900/50' 
                                : 'text-blue-400 hover:text-blue-300 bg-blue-900/30 hover:bg-blue-900/50'
                            }`}
                          >
                            {isExpanded ? 'Hide Details' : 'Show Details'}
                          </button>
                        )}
                      </div>

                      {/* Expanded details */}
                      {isExpanded && hasDetails && (
                        <div className="mt-4 p-3 bg-gray-800 rounded border border-gray-600">
                          {result.error && (
                            <div className="mb-3">
                              <div className="font-semibold text-red-300 text-sm mb-1">Error:</div>
                              <div className="text-sm text-red-200 font-mono bg-red-900/20 p-2 rounded whitespace-pre-wrap break-words">
                                {renderError(result.error)}
                              </div>
                            </div>
                          )}
                          
                          {result.details && Object.keys(result.details).length > 0 && (
                            <div>
                              <div className="font-semibold text-gray-300 text-sm mb-2">Details:</div>
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

            {/* Troubleshooting section for failures */}
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
            No diagnostic results available. Click "Run Tests" to start diagnostics.
          </div>
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
