import EditSystemModal from 'components/EditSystemModal';
import SpinnerIcon from 'components/icons/SpinnerIcon';
import React, { useEffect, useState } from 'react';
import {
    getDataIntegrity,
    registerBmsSystem,
    type DataIntegrityItem,
    type DataIntegrityResponse
} from 'services/clientService';
import type { BmsSystem } from '../../../types';

interface ReconciliationDashboardProps {
    onSystemCreated: () => void; // Callback to refresh systems list
}

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'ReconciliationDashboard',
        message,
        context
    }));
};

const ReconciliationDashboard: React.FC<ReconciliationDashboardProps> = ({
    onSystemCreated
}) => {
    const [integrityData, setIntegrityData] = useState<DataIntegrityResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [adoptingDL, setAdoptingDL] = useState<DataIntegrityItem | null>(null);
    const [isSavingNewSystem, setIsSavingNewSystem] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Fetch data integrity report
    const fetchIntegrityData = async () => {
        log('info', 'Fetching data integrity report...');
        setLoading(true);
        setError(null);
        try {
            const data = await getDataIntegrity();
            setIntegrityData(data);
            log('info', 'Data integrity report loaded.', { summary: data.summary });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load data integrity report.';
            log('error', 'Failed to fetch integrity data.', { error: errorMessage });
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchIntegrityData();
    }, []);

    const handleAdoptSystem = (orphanedDL: DataIntegrityItem) => {
        const hwId = orphanedDL.hardware_id || orphanedDL.dl_id;
        log('info', 'User initiated adopt system workflow.', { hardware_id: hwId });
        setAdoptingDL(orphanedDL);
    };

    const handleSaveNewSystem = async (systemData: Omit<BmsSystem, 'id'>) => {
        log('info', 'Saving new system from adoption workflow.', { systemData });
        setIsSavingNewSystem(true);
        setSaveError(null);
        try {
            // Call the registerBmsSystem API with full system data
            await registerBmsSystem(systemData);

            log('info', 'New system created successfully.');
            setAdoptingDL(null);
            await onSystemCreated();
            await fetchIntegrityData(); // Refresh integrity data to show new system as matched
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to create system.';
            log('error', 'Failed to create new system.', { error: errorMessage });
            setSaveError(errorMessage);
            // Don't close modal on error - let user retry
        } finally {
            setIsSavingNewSystem(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <SpinnerIcon className="w-8 h-8 text-secondary mr-3" />
                <span className="text-gray-300">Loading data reconciliation report...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-900/50 border border-red-500 rounded-md p-4 text-red-300">
                <p className="font-semibold">Error loading data integrity report</p>
                <p className="text-sm mt-1">{error}</p>
                <button
                    onClick={fetchIntegrityData}
                    className="mt-3 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (!integrityData) {
        return (
            <div className="text-center py-12 text-gray-400">
                No data available. Please try refreshing.
            </div>
        );
    }

    const orphanedData = integrityData.data.filter(item => item.status === 'ORPHAN');

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
                    <div className="text-sm text-blue-300 mb-1">Total Hardware IDs</div>
                    <div className="text-3xl font-bold text-white">{integrityData.summary.total_dl_sources}</div>
                </div>
                <div className="bg-green-900/30 border border-green-500/50 rounded-lg p-4">
                    <div className="text-sm text-green-300 mb-1">Matched (Healthy)</div>
                    <div className="text-3xl font-bold text-white">{integrityData.summary.matched}</div>
                </div>
                <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-4">
                    <div className="text-sm text-yellow-300 mb-1">Orphaned</div>
                    <div className="text-3xl font-bold text-white">{integrityData.summary.orphaned}</div>
                </div>
                <div className="bg-purple-900/30 border border-purple-500/50 rounded-lg p-4">
                    <div className="text-sm text-purple-300 mb-1">Orphaned Records</div>
                    <div className="text-3xl font-bold text-white">{integrityData.summary.orphaned_records.toLocaleString()}</div>
                </div>
            </div>

            {/* Orphaned Data Sources Section */}
            {orphanedData.length > 0 ? (
                <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-xl font-semibold text-yellow-300">⚠️ Orphaned Hardware IDs</h3>
                            <p className="text-sm text-yellow-100 mt-1">
                                These Hardware IDs have records but no associated system profile. Click Adopt to create a system for them.
                            </p>
                        </div>
                        <button
                            onClick={fetchIntegrityData}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-4 rounded-md transition-colors text-sm"
                        >
                            🔄 Refresh
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-800 border-b border-gray-700">
                                <tr>
                                    <th className="p-3 text-left font-semibold text-gray-300">Hardware ID</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Records</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Date Range</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Previously Linked</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {orphanedData.map(item => (
                                    <tr key={item.hardware_id || item.dl_id} className="hover:bg-gray-800/50">
                                        <td className="p-3 font-mono text-yellow-200 font-semibold">
                                            {(item.hardware_id || item.dl_id) === 'UNIDENTIFIED' ? (
                                                <span className="text-red-400">UNIDENTIFIED</span>
                                            ) : (
                                                item.hardware_id || item.dl_id
                                            )}
                                        </td>
                                        <td className="p-3">{item.record_count.toLocaleString()}</td>
                                        <td className="p-3 text-xs">
                                            <div>{new Date(item.first_seen).toLocaleDateString()}</div>
                                            <div className="text-gray-500">to {new Date(item.last_seen).toLocaleDateString()}</div>
                                        </td>
                                        <td className="p-3 text-xs">
                                            {item.previously_linked_system_name ? (
                                                <div className="text-gray-400">
                                                    {item.previously_linked_system_name}
                                                    <p className="text-gray-300 text-sm italic">Select Adopt to create a new system from this Orphaned ID.</p>
                                                </div>
                                            ) : (
                                                <span className="text-gray-600">Never linked</span>
                                            )}
                                        </td>
                                        <td className="p-3">
                                            {item.dl_id === 'UNIDENTIFIED' ? (
                                                <span className="text-red-400 font-semibold text-xs">
                                                    ⚠️ Extraction Failed - Re-upload Required
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => handleAdoptSystem(item)}
                                                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md transition-colors text-sm"
                                                >
                                                    ➕ Adopt System
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-6 text-center text-green-200">
                    <p className="text-lg font-semibold">✅ No Orphaned Data Found</p>
                    <p className="text-sm mt-1 text-green-300">All data records are correctly assigned to systems.</p>
                </div>
            )}

            {/* Adopt System Modal */}
            {
                adoptingDL && (
                    <EditSystemModal
                        system={null} // null means we're creating a new system
                        onSave={handleSaveNewSystem}
                        onClose={() => {
                            setAdoptingDL(null);
                            setSaveError(null);
                        }}
                        isSaving={isSavingNewSystem}
                        initialData={{
                            name: `System for ${adoptingDL.hardware_id || adoptingDL.dl_id}`,
                            associatedHardwareIds: [adoptingDL.hardware_id || adoptingDL.dl_id],
                            chemistry: 'LiFePO4', // Default
                            voltage: null,
                            capacity: null,
                            latitude: null,
                            longitude: null
                        }}
                        enableGeolocation={true}
                        error={saveError}
                    />
                )
            }
        </div >
    );
};

export default ReconciliationDashboard;
