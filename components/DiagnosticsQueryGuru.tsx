import React, { useState } from 'react';

interface FunctionDiagnostic {
    name: string;
    description: string;
    collections: string[];
    commonIssues: string[];
}

const NETLIFY_FUNCTIONS: FunctionDiagnostic[] = [
    {
        name: 'analyze.cjs',
        description: 'BMS screenshot analysis with dual-write to analysis-results and history',
        collections: ['analysis-results', 'history', 'idempotent-requests'],
        commonIssues: [
            'Gemini API timeout or rate limit',
            'Invalid image format',
            'Dual-write to history failed (check logs)',
            'Duplicate detection not working (contentHash issues)'
        ]
    },
    {
        name: 'generate-insights-with-tools.cjs',
        description: 'AI insights generation with ReAct loop and tool calling',
        collections: ['insights-jobs', 'analysis-results', 'history', 'systems'],
        commonIssues: [
            'Tool execution timeout',
            'No data found in history collection (check dual-write)',
            'Full Context Mode not providing context',
            'Checkpoint save failures during timeout'
        ]
    },
    {
        name: 'history.cjs',
        description: 'Historical analysis data retrieval and linking',
        collections: ['history', 'systems', 'hourly-weather', 'hourly-irradiance'],
        commonIssues: [
            'No data returned (check if analyze.cjs dual-write is working)',
            'System linking failures',
            'Weather/irradiance data missing'
        ]
    },
    {
        name: 'request_bms_data (tool)',
        description: 'Gemini tool for fetching BMS time-series data',
        collections: ['history'],
        commonIssues: [
            'Empty results despite analysis existing (collection mismatch)',
            'Time range validation errors',
            'Data sampling applied but not expected'
        ]
    },
    {
        name: 'full-context-builder.cjs',
        description: 'Pre-loads ALL context for Full Context Mode',
        collections: ['analysis-results', 'systems', 'ai_feedback'],
        commonIssues: [
            'Statistical analysis failures',
            'Missing raw data arrays',
            'Timeout during context building'
        ]
    }
];

export const DiagnosticsQueryGuru: React.FC = () => {
    const [selectedFunction, setSelectedFunction] = useState<string>('');
    const [diagnosticResults, setDiagnosticResults] = useState<any>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [customQuery, setCustomQuery] = useState('');

    const runDiagnostics = async (functionName: string) => {
        setIsRunning(true);
        setDiagnosticResults(null);

        try {
            const response = await fetch('/.netlify/functions/diagnose-function', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    functionName,
                    customQuery: customQuery || undefined
                })
            });

            if (!response.ok) {
                throw new Error(`Diagnostics failed: ${response.statusText}`);
            }

            const results = await response.json();
            setDiagnosticResults(results);
        } catch (error) {
            setDiagnosticResults({
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setIsRunning(false);
        }
    };

    const runCustomQuery = async () => {
        if (!customQuery.trim()) {
            alert('Please enter a diagnostic query');
            return;
        }

        setIsRunning(true);
        setDiagnosticResults(null);

        try {
            const response = await fetch('/.netlify/functions/diagnostics-guru-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: customQuery,
                    includeContext: true
                })
            });

            if (!response.ok) {
                throw new Error(`Query failed: ${response.statusText}`);
            }

            const results = await response.json();
            setDiagnosticResults(results);
        } catch (error) {
            setDiagnosticResults({
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <div className="border-b pb-4 mb-6">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    🔧 Diagnostics Query Guru
                </h2>
                <p className="text-sm text-gray-600 mt-2">
                    Diagnose specific functions or ask custom diagnostic queries
                </p>
            </div>

            {/* Function Diagnostics */}
            <div className="mb-8">
                <h3 className="text-lg font-semibold mb-3">Function-Specific Diagnostics</h3>
                <p className="text-sm text-gray-600 mb-4">
                    Select a function to diagnose. The system will check collections, logs, and common issues.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {NETLIFY_FUNCTIONS.map(func => (
                        <div
                            key={func.name}
                            className={`border rounded-lg p-4 cursor-pointer transition-all ${
                                selectedFunction === func.name
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-gray-300 hover:border-blue-300'
                            }`}
                            onClick={() => setSelectedFunction(func.name)}
                        >
                            <h4 className="font-semibold text-gray-800 mb-1">{func.name}</h4>
                            <p className="text-xs text-gray-600 mb-2">{func.description}</p>
                            <div className="text-xs">
                                <span className="font-semibold">Collections:</span>{' '}
                                {func.collections.join(', ')}
                            </div>
                        </div>
                    ))}
                </div>

                {selectedFunction && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
                        <h4 className="font-semibold text-yellow-800 mb-2">
                            Common Issues for {selectedFunction}:
                        </h4>
                        <ul className="list-disc list-inside text-sm text-yellow-700">
                            {NETLIFY_FUNCTIONS.find(f => f.name === selectedFunction)?.commonIssues.map(
                                (issue, idx) => (
                                    <li key={idx}>{issue}</li>
                                )
                            )}
                        </ul>
                    </div>
                )}

                <button
                    onClick={() => selectedFunction && runDiagnostics(selectedFunction)}
                    disabled={!selectedFunction || isRunning}
                    className={`px-4 py-2 rounded font-semibold transition-colors ${
                        !selectedFunction || isRunning
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                >
                    {isRunning ? 'Running Diagnostics...' : 'Run Function Diagnostics'}
                </button>
            </div>

            {/* Custom Query */}
            <div className="border-t pt-6">
                <h3 className="text-lg font-semibold mb-3">Custom Diagnostic Query</h3>
                <p className="text-sm text-gray-600 mb-4">
                    Ask a specific diagnostic question. The AI will analyze logs, collections, and system
                    state to provide insights.
                </p>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Diagnostic Query
                    </label>
                    <textarea
                        className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={4}
                        placeholder="Example: Why is request_bms_data returning empty results for system XYZ?"
                        value={customQuery}
                        onChange={e => setCustomQuery(e.target.value)}
                    />
                </div>

                <button
                    onClick={runCustomQuery}
                    disabled={isRunning || !customQuery.trim()}
                    className={`px-4 py-2 rounded font-semibold transition-colors ${
                        isRunning || !customQuery.trim()
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                >
                    {isRunning ? 'Analyzing...' : 'Run Custom Query'}
                </button>
            </div>

            {/* Results Display */}
            {diagnosticResults && (
                <div className="mt-6 border-t pt-6">
                    <h3 className="text-lg font-semibold mb-3">Diagnostic Results</h3>

                    {diagnosticResults.error ? (
                        <div className="bg-red-50 border border-red-200 rounded p-4">
                            <p className="text-red-800 font-semibold">Error</p>
                            <p className="text-red-700 text-sm">{diagnosticResults.message}</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {diagnosticResults.collectionStatus && (
                                <div className="bg-blue-50 border border-blue-200 rounded p-4">
                                    <h4 className="font-semibold text-blue-800 mb-2">
                                        Collection Status
                                    </h4>
                                    {Object.entries(diagnosticResults.collectionStatus).map(
                                        ([collection, status]: [string, any]) => (
                                            <div key={collection} className="text-sm mb-2">
                                                <span className="font-medium">{collection}:</span>{' '}
                                                {status.count} records
                                                {status.recentCount && (
                                                    <span className="text-blue-700">
                                                        {' '}
                                                        ({status.recentCount} in last 24h)
                                                    </span>
                                                )}
                                            </div>
                                        )
                                    )}
                                </div>
                            )}

                            {diagnosticResults.issues && diagnosticResults.issues.length > 0 && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                                    <h4 className="font-semibold text-yellow-800 mb-2">
                                        Issues Detected
                                    </h4>
                                    <ul className="list-disc list-inside text-sm text-yellow-700">
                                        {diagnosticResults.issues.map((issue: string, idx: number) => (
                                            <li key={idx}>{issue}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {diagnosticResults.recommendations && (
                                <div className="bg-green-50 border border-green-200 rounded p-4">
                                    <h4 className="font-semibold text-green-800 mb-2">
                                        Recommendations
                                    </h4>
                                    <div className="text-sm text-green-700 whitespace-pre-wrap">
                                        {diagnosticResults.recommendations}
                                    </div>
                                </div>
                            )}

                            {diagnosticResults.logs && (
                                <div className="bg-gray-50 border border-gray-200 rounded p-4">
                                    <h4 className="font-semibold text-gray-800 mb-2">
                                        Recent Logs (Last 10)
                                    </h4>
                                    <div className="text-xs font-mono space-y-1 max-h-64 overflow-y-auto">
                                        {diagnosticResults.logs.map((log: any, idx: number) => (
                                            <div
                                                key={idx}
                                                className={`p-2 rounded ${
                                                    log.level === 'error'
                                                        ? 'bg-red-100'
                                                        : log.level === 'warn'
                                                        ? 'bg-yellow-100'
                                                        : 'bg-white'
                                                }`}
                                            >
                                                <span className="text-gray-500">
                                                    {log.timestamp}
                                                </span>{' '}
                                                <span className="font-semibold">[{log.level}]</span>{' '}
                                                {log.message}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
