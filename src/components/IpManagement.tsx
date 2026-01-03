import React, { useState, useEffect, useCallback } from 'react';
import { getIpData, addVerifiedRange, removeVerifiedRange, getCurrentIp, deleteIpRecord, addBlockedRange, removeBlockedRange } from '../services/clientService';

interface TrackedIp {
    ip: string;
    key: string;
    count: number;
    lastSeen: string;
    isVerified: boolean;
    isBlocked: boolean;
}

interface IpData {
    trackedIps: TrackedIp[];
    verifiedRanges: string[];
    blockedRanges: string[];
}

const IpManagement: React.FC = () => {
    const [data, setData] = useState<IpData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newRange, setNewRange] = useState('');
    const [newBlockedRange, setNewBlockedRange] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingKey, setDeletingKey] = useState<string | null>(null);
    const [currentUserIp, setCurrentUserIp] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        // Don't set loading to true on refresh, only on initial load
        if (!data) setLoading(true);
        try {
            setError(null);
            const ipData = await getIpData();
            setData(ipData);
        } catch (err) {
            setError(err instanceof Error ? err.message : "An unknown error occurred.");
        } finally {
            setLoading(false);
        }
    }, [data]);

    useEffect(() => {
        fetchData();
        getCurrentIp().then(data => setCurrentUserIp(data.ip)).catch(err => {
            console.warn("Could not fetch current user IP:", err);
        });
    }, []); // Only run once on mount

    const handleAction = async (action: 'add' | 'remove' | 'block' | 'unblock', range: string) => {
        setIsSubmitting(true);
        setError(null);
        try {
            if (action === 'add') await addVerifiedRange(range);
            if (action === 'remove') await removeVerifiedRange(range);
            if (action === 'block') await addBlockedRange(range);
            if (action === 'unblock') await removeBlockedRange(range);
            
            await fetchData(); // Refresh entire dataset
            if (action === 'add') setNewRange('');
            if (action === 'block') setNewBlockedRange('');

        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update IP list.");
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleAddSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newRange.trim()) {
            handleAction('add', newRange.trim());
        }
    };

    const handleBlockSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newBlockedRange.trim()) {
            handleAction('block', newBlockedRange.trim());
        }
    };

    const handleDeleteIp = async (key: string, ip: string) => {
        if (!window.confirm(`Are you sure you want to delete the record for "${ip}"? This will remove it from the activity list but will not block future requests.`)) {
            return;
        }
        setDeletingKey(key);
        setError(null);
        try {
            await deleteIpRecord(key);
            await fetchData(); 
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete IP record.");
        } finally {
            setDeletingKey(null);
        }
    };

    if (loading && !data) {
        return <div className="text-center text-gray-400 p-8">Loading IP Data...</div>;
    }

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-inner space-y-8">
            {error && <p className="text-red-500 p-3 bg-red-900/50 border border-red-500 rounded-md">{error}</p>}
            
            {currentUserIp && (
                <div className="mb-4 p-3 bg-gray-900/50 rounded-md flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="text-sm text-center sm:text-left">
                        <span className="text-gray-400">Your current IP appears to be: </span>
                        <span className="font-mono text-secondary">{currentUserIp}</span>
                    </div>
                    <button
                        onClick={() => handleAction('add', currentUserIp)}
                        disabled={isSubmitting || data?.verifiedRanges.includes(currentUserIp)}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-3 rounded-md text-xs disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors w-full sm:w-auto"
                    >
                        {data?.verifiedRanges.includes(currentUserIp) ? '✓ Verified' : 'Verify This IP'}
                    </button>
                </div>
            )}
            
            <div className="grid md:grid-cols-2 gap-8">
                {/* Verified Ranges Section */}
                <div>
                    <h3 className="font-semibold text-lg text-white mb-2">Verified IPs & Subnets</h3>
                    <p className="text-sm text-gray-400 mb-4">IPs on this list have an unlimited rate limit. Add individual IPs or CIDR subnets (e.g., 1.2.3.0/24).</p>
                    <form onSubmit={handleAddSubmit} className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newRange}
                            onChange={(e) => setNewRange(e.target.value)}
                            placeholder="Enter IP or CIDR range"
                            className="flex-grow px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary text-white"
                            disabled={isSubmitting}
                        />
                        <button type="submit" className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-600 transition-colors" disabled={isSubmitting || !newRange.trim()}>
                            {isSubmitting && newRange ? '...' : 'Add'}
                        </button>
                    </form>
                    <div className="space-y-2 p-3 bg-gray-900/50 rounded-md max-h-60 overflow-y-auto">
                        {data?.verifiedRanges && data.verifiedRanges.length > 0 ? (
                            data.verifiedRanges.map(range => (
                                <div key={range} className="flex justify-between items-center bg-gray-700 p-2 rounded">
                                    <span className="font-mono text-sm text-green-300">{range}</span>
                                    <button onClick={() => handleAction('remove', range)} disabled={isSubmitting} className="text-red-500 hover:text-red-400 text-xs font-bold">REMOVE</button>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-gray-500 text-sm p-4">No verified ranges found.</p>
                        )}
                    </div>
                </div>
                 {/* Blocked Ranges Section */}
                <div>
                    <h3 className="font-semibold text-lg text-red-400 mb-2">Blocked IPs & Subnets</h3>
                    <p className="text-sm text-gray-400 mb-4">IPs on this list are denied all access. Use this to stop abuse.</p>
                    <form onSubmit={handleBlockSubmit} className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newBlockedRange}
                            onChange={(e) => setNewBlockedRange(e.target.value)}
                            placeholder="Enter IP or CIDR range"
                            className="flex-grow px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-white"
                            disabled={isSubmitting}
                        />
                        <button type="submit" className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-600 transition-colors" disabled={isSubmitting || !newBlockedRange.trim()}>
                            {isSubmitting && newBlockedRange ? '...' : 'Block'}
                        </button>
                    </form>
                    <div className="space-y-2 p-3 bg-red-900/20 border border-red-500/30 rounded-md max-h-60 overflow-y-auto">
                        {data?.blockedRanges && data.blockedRanges.length > 0 ? (
                            data.blockedRanges.map(range => (
                                <div key={range} className="flex justify-between items-center bg-red-900/50 p-2 rounded">
                                    <span className="font-mono text-sm text-red-300">{range}</span>
                                    <button onClick={() => handleAction('unblock', range)} disabled={isSubmitting} className="text-yellow-400 hover:text-yellow-300 text-xs font-bold">UNBLOCK</button>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-gray-500 text-sm p-4">No blocked ranges found.</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Tracked IPs Section */}
            <div className="md:col-span-2 pt-8 border-t border-gray-700/50">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-lg text-white">Recent IP Activity (Last 24 hours)</h3>
                    <button onClick={() => fetchData()} className="text-sm text-secondary hover:underline" disabled={loading}>
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
                    <p className="text-sm text-gray-400 mb-4">Unverified IPs are limited to {'100 reqs/min'}. This accommodates batch uploads and status polling.</p>
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto border border-gray-700 rounded-lg">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-700 sticky top-0">
                            <tr>
                                <th className="p-3 text-left">IP Address</th>
                                <th className="p-3 text-left">Reqs/min</th>
                                <th className="p-3 text-left">Last Seen</th>
                                <th className="p-3 text-left">Status</th>
                                <th className="p-3 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {data?.trackedIps && data.trackedIps.length > 0 ? (
                                data.trackedIps.map(ip => (
                                    <tr key={ip.key} className={`hover:bg-gray-900/50 ${ip.isBlocked ? 'bg-red-900/20' : ''}`}>
                                        <td className="p-3 font-mono text-gray-300">{ip.ip}</td>
                                        <td className="p-3 text-center">{ip.count}</td>
                                        <td className="p-3 whitespace-nowrap">{new Date(ip.lastSeen).toLocaleString()}</td>
                                        <td className="p-3">
                                            {ip.isBlocked ? (
                                                <span className="font-bold text-red-400 px-2 py-1 rounded-full bg-red-900/50 text-[10px]">BLOCKED</span>
                                            ) : ip.isVerified ? (
                                                <span className="font-bold text-green-400 px-2 py-1 rounded-full bg-green-900/50 text-[10px]">VERIFIED</span>
                                            ) : (
                                                <span className="font-bold text-yellow-400 px-2 py-1 rounded-full bg-yellow-900/50 text-[10px]">UNVERIFIED</span>
                                            )}
                                        </td>
                                        <td className="p-3">
                                            <div className="flex items-center space-x-4">
                                                {ip.isBlocked ? (
                                                    <button onClick={() => handleAction('unblock', ip.ip)} disabled={isSubmitting} className="text-yellow-400 hover:text-yellow-300 font-semibold text-sm">Unblock</button>
                                                ) : (
                                                    <button onClick={() => handleAction('block', ip.ip)} disabled={isSubmitting} className="text-red-500 hover:text-red-400 font-semibold text-sm">Block</button>
                                                )}
                                                
                                                {!ip.isVerified && !ip.isBlocked && !ip.ip.includes('[') && (
                                                    <button onClick={() => handleAction('add', ip.ip)} disabled={isSubmitting} className="text-green-500 hover:text-green-400 font-semibold text-sm">Verify</button>
                                                )}

                                                <button 
                                                    onClick={() => handleDeleteIp(ip.key, ip.ip)} 
                                                    disabled={deletingKey === ip.key}
                                                    className="text-gray-400 hover:text-gray-300 font-semibold text-sm disabled:text-gray-600">
                                                    {deletingKey === ip.key ? '...' : 'Delete Log'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-gray-500">No recent IP activity found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default IpManagement;