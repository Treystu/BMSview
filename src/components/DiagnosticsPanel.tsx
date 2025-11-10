/**
 * DiagnosticsPanel Component
 * Displays production diagnostic tests and results
 */

import React, { useState } from 'react';

export interface DiagnosticTest {
    id: string;
    name: string;
    description: string;
    category: string;
}

export interface DiagnosticResult {
    id: string;
    name: string;
    status: 'Success' | 'Failure' | 'Warning' | 'Running';
    duration: number;
    message: string;
    details?: Record<string, any>;
}

export const DiagnosticsPanel: React.FC = () => {
    const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<DiagnosticResult[]>([]);
    const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

    // Available diagnostic tests
    const availableTests: DiagnosticTest[] = [
        {
            id: 'cache-integrity',
            name: 'Cache Integrity Check',
            description: 'Verify MongoDB records have required sync fields',
            category: 'Data Quality',
        },
        {
            id: 'sync-status',
            name: 'MongoDB Sync Status',
            description: 'Check sync metadata and pending items',
            category: 'Sync Health',
        },
        {
            id: 'conflict-detection',
            name: 'Sync Conflict Detection',
            description: 'Query records with sync conflicts',
            category: 'Sync Health',
        },
        {
            id: 'timestamp-consistency',
            name: 'Timestamp Consistency Check',
            description: 'Verify all timestamps are UTC ISO 8601 format',
            category: 'Data Quality',
        },
        {
            id: 'checksum-integrity',
            name: 'Data Integrity Checksum',
            description: 'Generate SHA-256 hash of data and verify consistency',
            category: 'Data Quality',
        },
        {
            id: 'full-sync-cycle',
            name: 'Full Sync Cycle Test',
            description: 'Create, modify, and delete test records',
            category: 'Integration',
        },
        {
            id: 'cache-stats',
            name: 'Cache Statistics',
            description: 'Count records and estimate cache size',
            category: 'Performance',
        },
    ];

    const handleSelectTest = (testId: string) => {
        const newSelected = new Set(selectedTests);
        if (newSelected.has(testId)) {
            newSelected.delete(testId);
        } else {
            newSelected.add(testId);
        }
        setSelectedTests(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedTests.size === availableTests.length) {
            setSelectedTests(new Set());
        } else {
            setSelectedTests(new Set(availableTests.map(t => t.id)));
        }
    };

    const handleRunTests = async () => {
        if (selectedTests.size === 0) {
            alert('Please select at least one test');
            return;
        }

        setIsRunning(true);
        setResults([]);

        try {
            // Call diagnostics endpoint with selected tests
            const response = await fetch('/.netlify/functions/admin-diagnostics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selectedTests: Array.from(selectedTests),
                }),
            });

            if (!response.ok) {
                throw new Error(`Diagnostics endpoint returned ${response.status}`);
            }

            const data = await response.json();

            // Transform results for display
            const displayResults: DiagnosticResult[] = Array.from(selectedTests)
                .map(testId => {
                    const testResult = data[testId];
                    return {
                        id: testId,
                        name: availableTests.find(t => t.id === testId)?.name || testId,
                        status: testResult?.status || 'Unknown',
                        duration: testResult?.duration || 0,
                        message: testResult?.message || 'No result',
                        details: testResult?.details,
                    };
                });

            setResults(displayResults);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            alert(`Failed to run diagnostics: ${message}`);
        } finally {
            setIsRunning(false);
        }
    };

    const toggleExpanded = (testId: string) => {
        const newExpanded = new Set(expandedResults);
        if (newExpanded.has(testId)) {
            newExpanded.delete(testId);
        } else {
            newExpanded.add(testId);
        }
        setExpandedResults(newExpanded);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Success': return 'bg-green-100 text-green-800 border-green-300';
            case 'Failure': return 'bg-red-100 text-red-800 border-red-300';
            case 'Warning': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'Running': return 'bg-blue-100 text-blue-800 border-blue-300';
            default: return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'Success': return '✓';
            case 'Failure': return '✗';
            case 'Warning': return '⚠';
            case 'Running': return '↻';
            default: return '?';
        }
    };

    // Group tests by category
    const groupedTests = availableTests.reduce((acc, test) => {
        if (!acc[test.category]) {
            acc[test.category] = [];
        }
        acc[test.category].push(test);
        return acc;
    }, {} as Record<string, DiagnosticTest[]>);

    return (
        <div className="space-y-6 p-6 bg-white rounded-lg border border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900">Production Diagnostics</h2>

            {/* Test Selection */}
            <div className="space-y-4 border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-700">Select Tests</h3>
                    <button
                        onClick={handleSelectAll}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                        {selectedTests.size === availableTests.length ? 'Deselect All' : 'Select All'}
                    </button>
                </div>

                <div className="space-y-3 max-h-64 overflow-y-auto">
                    {Object.entries(groupedTests).map(([category, tests]) => (
                        <div key={category} className="space-y-2">
                            <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide">{category}</h4>
                            <div className="space-y-2 ml-4">
                                {tests.map(test => (
                                    <label key={test.id} className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedTests.has(test.id)}
                                            onChange={() => handleSelectTest(test.id)}
                                            disabled={isRunning}
                                            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 disabled:bg-gray-100"
                                        />
                                        <div className="flex-1">
                                            <div className="font-medium text-gray-700">{test.name}</div>
                                            <div className="text-sm text-gray-500">{test.description}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 border-t border-gray-200 pt-6">
                <button
                    onClick={handleRunTests}
                    disabled={isRunning || selectedTests.size === 0}
                    className="px-4 py-2 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 disabled:bg-gray-400 transition"
                >
                    {isRunning ? 'Running Tests...' : 'Run Selected Tests'}
                </button>
            </div>

            {/* Results */}
            {results.length > 0 && (
                <div className="space-y-4 border-t border-gray-200 pt-6">
                    <h3 className="text-lg font-semibold text-gray-700">Test Results</h3>

                    <div className="grid grid-cols-1 gap-3">
                        {results.map(result => (
                            <div
                                key={result.id}
                                className={`border-l-4 p-4 rounded ${getStatusColor(result.status)} cursor-pointer`}
                                onClick={() => toggleExpanded(result.id)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xl font-bold">{getStatusIcon(result.status)}</span>
                                        <div>
                                            <div className="font-semibold">{result.name}</div>
                                            <div className="text-sm opacity-80">{result.message}</div>
                                        </div>
                                    </div>
                                    <div className="text-sm font-mono">{result.duration}ms</div>
                                </div>

                                {/* Expanded Details */}
                                {expandedResults.has(result.id) && result.details && (
                                    <div className="mt-4 pt-4 border-t border-current opacity-50">
                                        <pre className="text-xs overflow-x-auto">
                                            {JSON.stringify(result.details, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Summary */}
                    <div className="bg-gray-50 p-4 rounded text-sm text-gray-600">
                        <div className="font-semibold mb-2">Summary:</div>
                        <div>
                            Success: {results.filter(r => r.status === 'Success').length} |
                            Failures: {results.filter(r => r.status === 'Failure').length} |
                            Warnings: {results.filter(r => r.status === 'Warning').length}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DiagnosticsPanel;

// Helper to convert Set to Array (not built-in for Set in some environments)
declare global {
    interface Set<T> {
        toArray(): T[];
    }
}

if (!Set.prototype.toArray) {
    Set.prototype.toArray = function <T>(this: Set<T>): T[] {
        return Array.from(this);
    };
}
