import React, { useState } from 'react';
import { runDiagnostics, type DiagnosticsResponse } from '../../../services/clientService';
import SpinnerIcon from '../../icons/SpinnerIcon';

interface ToolsPanelProps {
    selectedSystemId: string;
    onAnalyzeHistory?: () => void;
    onPredictMaintenance?: () => void;
    isAnalyzing?: boolean;
    isPredicting?: boolean;
}

const ToolsPanel: React.FC<ToolsPanelProps> = ({
    selectedSystemId,
    onAnalyzeHistory,
    onPredictMaintenance,
    isAnalyzing,
    isPredicting
}) => {
    const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
    const [diagnosticsResult, setDiagnosticsResult] = useState<DiagnosticsResponse | null>(null);
    const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

    const handleRunDiagnostics = async () => {
        if (!selectedSystemId) {
            setDiagnosticsError('Please select a system first');
            return;
        }

        setDiagnosticsLoading(true);
        setDiagnosticsError(null);
        setDiagnosticsResult(null);

        try {
            const result = await runDiagnostics();
            setDiagnosticsResult(result);
        } catch (error) {
            setDiagnosticsError(error instanceof Error ? error.message : 'Failed to run diagnostics');
        } finally {
            setDiagnosticsLoading(false);
        }
    };

    const handleAnalyzeHistory = () => {
        if (!selectedSystemId) {
            alert('Please select a system first');
            return;
        }
        if (onAnalyzeHistory) {
            onAnalyzeHistory();
        }
    };

    const handlePredictMaintenance = () => {
        if (!selectedSystemId) {
            alert('Please select a system first');
            return;
        }
        if (onPredictMaintenance) {
            onPredictMaintenance();
        }
    };

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-4">
            {/* Header */}
            <div className="border-b border-gray-700 pb-4">
                <h2 className="text-xl font-bold text-white">Analysis Tools</h2>
                <p className="text-sm text-gray-400 mt-1">
                    Run system diagnostics, analyze historical data, and predict maintenance needs
                </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
                {/* Run Diagnostics */}
                <button
                    onClick={handleRunDiagnostics}
                    disabled={!selectedSystemId || diagnosticsLoading}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    {diagnosticsLoading ? (
                        <>
                            <SpinnerIcon className="w-5 h-5" />
                            Running Diagnostics...
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                            </svg>
                            Run Diagnostics
                        </>
                    )}
                </button>

                {/* Analyze History */}
                <button
                    onClick={handleAnalyzeHistory}
                    disabled={!selectedSystemId || isAnalyzing}
                    className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    {isAnalyzing ? (
                        <>
                            <SpinnerIcon className="w-5 h-5" />
                            Analyzing...
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            Analyze History (Guru)
                        </>
                    )}
                </button>

                {/* Predict Maintenance */}
                <button
                    onClick={handlePredictMaintenance}
                    disabled={!selectedSystemId || isPredicting}
                    className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    {isPredicting ? (
                        <>
                            <SpinnerIcon className="w-5 h-5" />
                            Predicting...
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Predict Maintenance
                        </>
                    )}
                </button>
            </div>

            {/* Diagnostics Result */}
            {diagnosticsResult && (
                <div className="mt-4 space-y-2">
                    <div className={`p-3 rounded-lg ${diagnosticsResult.status === 'success' ? 'bg-green-900/30 border border-green-700' :
                            diagnosticsResult.status === 'warning' ? 'bg-yellow-900/30 border border-yellow-700' :
                                'bg-red-900/30 border border-red-700'
                        }`}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-white">Diagnostics Complete</span>
                            <span className={`text-xs font-medium px-2 py-1 rounded ${diagnosticsResult.status === 'success' ? 'bg-green-500 text-white' :
                                    diagnosticsResult.status === 'warning' ? 'bg-yellow-500 text-black' :
                                        'bg-red-500 text-white'
                                }`}>
                                {diagnosticsResult.status.toUpperCase()}
                            </span>
                        </div>
                        {diagnosticsResult.summary && (
                            <div className="text-xs text-gray-300 grid grid-cols-4 gap-2">
                                <div>Total: {diagnosticsResult.summary.total}</div>
                                <div className="text-green-400">Success: {diagnosticsResult.summary.passed}</div>
                                <div className="text-yellow-400">Warnings: {diagnosticsResult.summary.warnings}</div>
                                <div className="text-red-400">Errors: {diagnosticsResult.summary.errors}</div>
                            </div>
                        )}
                    </div>

                    {diagnosticsResult.results && diagnosticsResult.results.length > 0 && (
                        <div className="max-h-60 overflow-y-auto space-y-1">
                            {diagnosticsResult.results.map((test, idx) => (
                                <div
                                    key={idx}
                                    className="text-xs p-2 rounded bg-gray-900 border border-gray-700 flex items-center justify-between"
                                >
                                    <span className="text-gray-300">{test.name}</span>
                                    <span className={`font-medium ${test.status === 'success' ? 'text-green-400' :
                                            test.status === 'warning' ? 'text-yellow-400' :
                                                'text-red-400'
                                        }`}>
                                        {test.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Diagnostics Error */}
            {diagnosticsError && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg">
                    <p className="text-sm text-red-300">{diagnosticsError}</p>
                </div>
            )}

            {/* Disabled State Message */}
            {!selectedSystemId && (
                <div className="mt-4 p-3 bg-gray-900/50 border border-gray-700 rounded-lg">
                    <p className="text-sm text-gray-400 text-center">
                        Select a system to enable analysis tools
                    </p>
                </div>
            )}
        </div>
    );
};

export default ToolsPanel;
