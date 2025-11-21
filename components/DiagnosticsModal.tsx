
import React, { useState } from 'react';
import SpinnerIcon from './icons/SpinnerIcon';

interface DiagnosticTestResult {
  name: string;
  status: 'success' | 'warning' | 'error' | 'partial' | 'running';
  duration: number;
  details?: Record<string, any>;
  error?: string;
  // Nested test structures
  steps?: Array<{ step: string; status: string; time?: number; [key: string]: any }>;
  tests?: Array<{ test: string; status: string; [key: string]: any }>;
  stages?: Array<{ stage: string; status: string; duration?: number; [key: string]: any }>;
  jobLifecycle?: Array<{ event: string; time?: number; [key: string]: any }>;
}

interface DiagnosticsResponse {
  status: 'success' | 'partial' | 'warning' | 'error';
  timestamp: string;
  duration: number;
  results: DiagnosticTestResult[];
  summary?: {
    total: number;
    success: number;
    partial?: number;
    warnings: number;
    errors: number;
  };
  error?: string;
  testId?: string;
  cleanup?: {
    success: string[];
    failed: string[];
  };
  metadata?: {
    environment?: string;
    requestId?: string;
  };
  details?: Record<string, any>;
}

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: DiagnosticsResponse | null;
  isLoading: boolean;
}

const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose, results, isLoading }) => {
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const toggleSection = (sectionKey: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionKey)) {
      newExpanded.delete(sectionKey);
    } else {
      newExpanded.add(sectionKey);
    }
    setExpandedSections(newExpanded);
  };

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
      case 'partial':
        return 'text-yellow-400';
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
        return 'border-yellow-500 bg-yellow-900/20';
      case 'warning':
        return 'border-yellow-500 bg-yellow-900/20';
      case 'error':
        return 'border-red-500 bg-red-900/20';
      default:
        return 'border-gray-500 bg-gray-900/20';
    }
  };

  // Render nested steps/stages/tests
  const renderNestedItems = (items: any[], label: string, testName: string) => {
    if (!items || items.length === 0) return null;
    
    const sectionKey = `${testName}-${label}`;
    const isExpanded = expandedSections.has(sectionKey);

    return (
      <div className="mt-3 border-l-2 border-gray-600 pl-3">
        <button
          onClick={() => toggleSection(sectionKey)}
          className="text-sm font-semibold text-gray-300 hover:text-white mb-2 flex items-center"
        >
          <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
          {label} ({items.length})
        </button>
        {isExpanded && (
          <div className="space-y-2">
            {items.map((item, idx) => {
              const itemName = item.step || item.test || item.stage || item.event || `Item ${idx + 1}`;
              const itemStatus = item.status || 'unknown';
              const duration = item.time || item.duration;

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
                  {Object.keys(item).length > 3 && (
                    <div className="mt-1 pl-6 text-xs text-gray-400 space-y-0.5">
                      {Object.entries(item)
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

  // ALWAYS show results if they exist, even with errors
  // Only show generic error banner if NO results are available
  const hasGeneralError = results?.status === 'error' && results?.error && (!results.results || results.results.length === 0);
  const summary = results?.summary;
  const testResults = results?.results || [];
  
  // If we have an error but also have results, show both
  const hasResultsWithError = results?.status === 'error' && testResults.length > 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-gray-600 pb-3 mb-4">
          <h2 className="text-xl font-semibold text-secondary">System Diagnostics</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <div className="bg-gray-700 p-6 rounded-md">
              <div className="flex items-center justify-center mb-4">
                <SpinnerIcon className="w-8 h-8 text-secondary" />
                <span className="ml-4 text-lg font-semibold">Running Diagnostic Tests...</span>
              </div>
              <div className="text-center text-sm text-gray-400 mb-4">
                <p>All tests are running in parallel for maximum efficiency</p>
                <p>This typically completes in 10-30 seconds</p>
              </div>
              
              {/* Show what tests will run */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold text-gray-300 mb-2">Tests in Progress:</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {results?.summary ? (
                    // If we have partial results, show them
                    <>
                      <div className="flex items-center text-green-400">
                        <span className="mr-1">✔</span> Completed: {results.summary.success}
                      </div>
                      <div className="flex items-center text-red-400">
                        <span className="mr-1">✖</span> Failed: {results.summary.errors}
                      </div>
                      <div className="flex items-center text-gray-400">
                        <span className="mr-1">↻</span> Running: {results.summary.total - results.summary.success - results.summary.errors}
                      </div>
                    </>
                  ) : (
                    // Show expected test categories (counts match ALL_DIAGNOSTIC_TESTS in AdminDashboard.tsx)
                    // Infrastructure: database, gemini (2)
                    // Core Analysis: analyze, insightsWithTools, asyncAnalysis (3)
                    // Data Management: history, systems, dataExport, idempotency (4)
                    // External Services: weather, solarEstimate, predictiveMaintenance, systemAnalytics (4)
                    // System Utilities: contentHashing, errorHandling, logging, retryMechanism, timeout (5)
                    <>
                      <div className="text-gray-400">• Infrastructure (2)</div>
                      <div className="text-gray-400">• Core Analysis (3)</div>
                      <div className="text-gray-400">• Data Management (4)</div>
                      <div className="text-gray-400">• External Services (4)</div>
                      <div className="text-gray-400">• System Utilities (5)</div>
                    </>
                  )}
                </div>
              </div>
              
              {/* Progress indication */}
              <div className="mt-6">
                <div className="h-2 bg-gray-600 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-secondary transition-all duration-500 ease-out"
                    style={{ 
                      width: results?.summary 
                        ? `${((results.summary.success + results.summary.errors) / results.summary.total * 100)}%`
                        : '10%'
                    }}
                  />
                </div>
                <div className="text-center text-xs text-gray-400 mt-2">
                  {results?.summary 
                    ? `${results.summary.success + results.summary.errors} of ${results.summary.total} tests completed`
                    : 'Initializing tests...'}
                </div>
              </div>
            </div>
            
            {/* Show any completed tests while others are running */}
            {results?.results && results.results.length > 0 && (
              <div className="bg-gray-700/50 p-4 rounded-md">
                <h4 className="text-sm font-semibold text-gray-300 mb-3">Completed Tests:</h4>
                <div className="space-y-2">
                  {results.results.slice(0, 5).map((result, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <div className="flex items-center">
                        <span className={`mr-2 ${getStatusColor(result.status)}`}>
                          {getStatusIcon(result.status)}
                        </span>
                        <span>{result.name}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {result.duration ? `${result.duration}ms` : ''}
                      </span>
                    </div>
                  ))}
                  {results.results.length > 5 && (
                    <div className="text-xs text-gray-400 text-center">
                      + {results.results.length - 5} more...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Show error banner if there's an error with NO results */}
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
            
            {/* Show warning at top if we have results but overall status is error */}
            {hasResultsWithError && results?.error && (
              <div className="bg-yellow-900/50 border border-yellow-500 rounded-md p-3 mb-4">
                <p className="text-yellow-200 text-sm">
                  <span className="font-semibold">⚠️ Note:</span> Some tests encountered errors. Individual test results are shown below.
                </p>
              </div>
            )}

            {/* ALWAYS show results if available, even when overall status is error */}
            {results ? (
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

            {/* Display individual test results */}
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
                      className={`bg-gray-700 p-4 rounded-md transition-all ${
                        result.status === 'error' ? 'border border-red-500/30' : 
                        result.status === 'warning' ? 'border border-yellow-500/30' : 
                        result.status === 'partial' ? 'border border-yellow-500/30' : ''
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

                          {/* Show nested items inline when collapsed */}
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
                            onClick={() => setExpandedTestId(isExpanded ? null : result.name)}
                            className={`ml-2 text-xs px-3 py-1 rounded transition-colors whitespace-nowrap ${
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

                          {/* Render nested structures */}
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
