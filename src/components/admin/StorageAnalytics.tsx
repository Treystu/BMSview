import React, { useState } from 'react';
import SpinnerIcon from '../icons/SpinnerIcon';

interface FieldStat {
    field: string;
    totalSize: number;
    totalSizeHuman: string;
    avgSize: number;
    count: number;
    percentageOfData: string;
}

interface AnalyticsResult {
    timestamp: string;
    stats: {
        db?: {
            avgObjSize: string;
            dataSize: string;
            storageSize: string;
            indexSize: string;
            objects: number;
        };
        collections?: Record<string, {
            count: number;
            size: string;
            storageSize: string;
            avgObjSize: string;
            totalIndexSize: string;
        }>;
        analyzedTotalSize?: string;
    };
    fieldAnalysis?: FieldStat[];
    deepAnalysis?: { field: string; totalSizeHuman: string; totalSize: number }[];
}

const StorageAnalytics: React.FC = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<AnalyticsResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<'summary' | 'full' | 'deep'>('full');

    const runAnalysis = async (selectedMode: 'summary' | 'full' | 'deep') => {
        setIsLoading(true);
        setError(null);
        setMode(selectedMode);
        try {
            const token = localStorage.getItem('site_password'); // Or however we auth
            // Assuming the function uses the common admin auth check or just works if protected by Netlify Identity on page load
            const res = await fetch(`/.netlify/functions/db-analytics?mode=${selectedMode}&collection=history`, {
                headers: token ? { 'x-admin-token': token } : {}
            });

            if (!res.ok) throw new Error(`Analysis failed: ${res.statusText}`);
            const data = await res.json();
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Analysis failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-gray-800 p-4 rounded-lg shadow-inner mt-6 border border-gray-700">
            <h3 className="font-semibold text-lg mb-2 text-blue-300">📊 Database Storage Analytics</h3>
            <p className="text-sm text-gray-400 mb-4">Analyze MongoDB storage usage to identify large fields and collection sizes.</p>

            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => runAnalysis('summary')}
                    disabled={isLoading}
                    className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded flex items-center gap-2"
                >
                    {isLoading && mode === 'summary' && <SpinnerIcon className="w-3 h-3" />}
                    Collection Overview
                </button>
                <button
                    onClick={() => runAnalysis('full')}
                    disabled={isLoading}
                    className="bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold py-2 px-3 rounded flex items-center gap-2"
                >
                    {isLoading && mode === 'full' && <SpinnerIcon className="w-3 h-3" />}
                    Root Field Analysis
                </button>
                <button
                    onClick={() => runAnalysis('deep')}
                    disabled={isLoading}
                    className="bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold py-2 px-3 rounded flex items-center gap-2"
                >
                    {isLoading && mode === 'deep' && <SpinnerIcon className="w-3 h-3" />}
                    Deep &apos;Analysis&apos; Object Scan
                </button>
            </div>

            {error && (
                <div className="p-3 bg-red-900/50 text-red-200 text-sm rounded mb-4">
                    Error: {error}
                </div>
            )}

            {result && (
                <div className="space-y-4 animate-fadeIn">
                    {/* High Level Stats */}
                    {result.stats.db && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-4 p-3 bg-black/20 rounded">
                            <div>
                                <span className="text-gray-500 block">Total Data Size</span>
                                <span className="text-white font-mono">{result.stats.db.dataSize}</span>
                            </div>
                            <div>
                                <span className="text-gray-500 block">Storage Size</span>
                                <span className="text-white font-mono">{result.stats.db.storageSize}</span>
                            </div>
                            <div>
                                <span className="text-gray-500 block">Object Count</span>
                                <span className="text-white font-mono">{result.stats.db.objects.toLocaleString()}</span>
                            </div>
                            <div>
                                <span className="text-gray-500 block">Avg Object Size</span>
                                <span className="text-white font-mono">{result.stats.db.avgObjSize}</span>
                            </div>
                        </div>
                    )}

                    {/* Collection Stats */}
                    {result.stats.collections && (
                        <div className="overflow-x-auto">
                            <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Collection Sizes</h4>
                            <table className="w-full text-xs text-left mb-4">
                                <thead className="text-gray-400 border-b border-gray-700">
                                    <tr>
                                        <th className="py-1">Name</th>
                                        <th className="py-1">Docs</th>
                                        <th className="py-1">Avg Size</th>
                                        <th className="py-1">Total Size</th>
                                        <th className="py-1">Index Size</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {Object.entries(result.stats.collections).map(([name, stat]) => (
                                        <tr key={name}>
                                            <td className="py-1 font-mono text-blue-300">{name}</td>
                                            <td className="py-1">{stat.count.toLocaleString()}</td>
                                            <td className="py-1">{stat.avgObjSize}</td>
                                            <td className="py-1 font-bold">{stat.size}</td>
                                            <td className="py-1">{stat.totalIndexSize}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Field Analysis */}
                    {result.fieldAnalysis && (
                        <div className="max-h-60 overflow-y-auto border border-gray-700 rounded bg-black/20">
                            <table className="w-full text-xs text-left">
                                <thead className="bg-gray-700 text-gray-300 sticky top-0">
                                    <tr>
                                        <th className="p-2">Field Name</th>
                                        <th className="p-2">Total Size</th>
                                        <th className="p-2">% of Top-Level</th>
                                        <th className="p-2">Avg / Doc</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {result.fieldAnalysis.map((f) => (
                                        <tr key={f.field} className="hover:bg-gray-700/50">
                                            <td className="p-2 font-mono text-green-300">{f.field}</td>
                                            <td className="p-2">{f.totalSizeHuman}</td>
                                            <td className="p-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-blue-500"
                                                            style={{ width: f.percentageOfData }}
                                                        />
                                                    </div>
                                                    <span>{f.percentageOfData}</span>
                                                </div>
                                            </td>
                                            <td className="p-2">{formatBytes(f.avgSize)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Deep Analysis */}
                    {result.deepAnalysis && (
                        <div className="mt-4">
                            <h4 className="text-xs font-bold uppercase text-purple-400 mb-2">Deep 'Analysis' Object Breakdown</h4>
                            <div className="max-h-60 overflow-y-auto border border-gray-700 rounded bg-black/20">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-gray-700 text-gray-300 sticky top-0">
                                        <tr>
                                            <th className="p-2">Nested Field</th>
                                            <th className="p-2">Total Size</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700">
                                        {result.deepAnalysis.map((f) => (
                                            <tr key={f.field} className="hover:bg-gray-700/50">
                                                <td className="p-2 font-mono text-purple-300">{f.field}</td>
                                                <td className="p-2">{f.totalSizeHuman}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Helper for pure component
function formatBytes(bytes: number, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export default StorageAnalytics;
