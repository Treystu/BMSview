import React, { useEffect, useState } from 'react';
import { 
    getDataIntegrity, 
    registerBmsSystem,
    type DataIntegrityItem, 
    type DataIntegrityResponse 
} from 'services/clientService';
import type { BmsSystem } from '../../../types';
import SpinnerIcon from 'components/icons/SpinnerIcon';
import EditSystemModal from 'components/EditSystemModal';

interface ReconciliationDashboardProps {
    systems: BmsSystem[];
    onSystemCreated: () => void; // Callback to refresh systems list
    onMergeRequested: (systemIds: string[], primaryId: string) => void;
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
    systems,
    onSystemCreated,
    onMergeRequested
}) => {
    const [integrityData, setIntegrityData] = useState<DataIntegrityResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [adoptingDL, setAdoptingDL] = useState<DataIntegrityItem | null>(null);
    const [selectedSystemIds, setSelectedSystemIds] = useState<string[]>([]);
    const [primarySystemId, setPrimarySystemId] = useState<string>('');
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
        log('info', 'User initiated adopt system workflow.', { dl_id: orphanedDL.dl_id });
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

    const handleToggleSystemSelection = (systemId: string) => {
        setSelectedSystemIds(prev => {
            const isSelected = prev.includes(systemId);
            if (isSelected) {
                return prev.filter(id => id !== systemId);
            } else {
                return [...prev, systemId];
            }
        });
    };

    const handleMergeSystems = () => {
        if (selectedSystemIds.length < 2 || !primarySystemId) return;
        log('info', 'User initiated merge systems.', { selectedSystemIds, primarySystemId });
        onMergeRequested(selectedSystemIds, primarySystemId);
        // Clear selections
        setSelectedSystemIds([]);
        setPrimarySystemId('');
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
    const matchedData = integrityData.data.filter(item => item.status === 'MATCHED');

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
                    <div className="text-sm text-blue-300 mb-1">Total DL Sources</div>
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
            {orphanedData.length > 0 && (
                <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-xl font-semibold text-yellow-300">⚠️ Orphaned Data Sources</h3>
                            <p className="text-sm text-yellow-100 mt-1">
                                These DL-# sources have records but no associated system profile. Click "Adopt" to create a system for them.
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
                                    <th className="p-3 text-left font-semibold text-gray-300">DL-#</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Records</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Date Range</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Previously Linked</th>
                                    <th className="p-3 text-left font-semibold text-gray-300">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {orphanedData.map(item => (
                                    <tr key={item.dl_id} className="hover:bg-gray-800/50">
                                        <td className="p-3 font-mono text-yellow-200 font-semibold">{item.dl_id}</td>
                                        <td className="p-3">{item.record_count.toLocaleString()}</td>
                                        <td className="p-3 text-xs">
                                            <div>{new Date(item.first_seen).toLocaleDateString()}</div>
                                            <div className="text-gray-500">to {new Date(item.last_seen).toLocaleDateString()}</div>
                                        </td>
                                        <td className="p-3 text-xs">
                                            {item.previously_linked_system_name ? (
                                                <div className="text-gray-400">
                                                    {item.previously_linked_system_name}
                                                    <div className="text-gray-600 text-[10px]">({item.previously_linked_system_id})</div>
                                                </div>
                                            ) : (
                                                <span className="text-gray-600">Never linked</span>
                                            )}
                                        </td>
                                        <td className="p-3">
                                            <button
                                                onClick={() => handleAdoptSystem(item)}
                                                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md transition-colors text-sm"
                                            >
                                                ➕ Adopt System
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Matched Systems & Duplicates Section */}
            <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-xl font-semibold text-green-300">✅ System Status & Management</h3>
                        <p className="text-sm text-gray-400 mt-1">
                            Review all matched systems, merge duplicates, or edit system details.
                        </p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-700 border-b border-gray-600">
                            <tr>
                                <th className="p-3 w-10">
                                    <span className="text-gray-500 text-xs">Merge</span>
                                </th>
                                <th className="p-3 text-left font-semibold text-gray-300">System Name</th>
                                <th className="p-3 text-left font-semibold text-gray-300">Linked DL-#s</th>
                                <th className="p-3 text-left font-semibold text-gray-300">Total Records</th>
                                <th className="p-3 text-left font-semibold text-gray-300">Chemistry</th>
                                <th className="p-3 text-left font-semibold text-gray-300">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {systems.map(system => {
                                // Find all matched data for this system
                                const systemDLs = matchedData.filter(item => item.system_id === system.id);
                                const totalRecords = systemDLs.reduce((sum, item) => sum + item.record_count, 0);
                                const isSelected = selectedSystemIds.includes(system.id);

                                return (
                                    <tr key={system.id} className={`hover:bg-gray-900 ${isSelected ? 'bg-blue-900/30' : ''}`}>
                                        <td className="p-3 text-center">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => handleToggleSystemSelection(system.id)}
                                                className="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 text-secondary focus:ring-secondary"
                                            />
                                        </td>
                                        <td className="p-3 font-semibold">{system.name}</td>
                                        <td className="p-3">
                                            <div className="flex flex-wrap gap-1">
                                                {system.associatedDLs?.length > 0 ? (
                                                    system.associatedDLs.map(dl => (
                                                        <span key={dl} className="bg-gray-700 px-2 py-1 rounded text-xs font-mono">
                                                            {dl}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-gray-600 text-xs">None</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-3">{totalRecords.toLocaleString()}</td>
                                        <td className="p-3 text-xs">{system.chemistry || 'N/A'}</td>
                                        <td className="p-3">
                                            <button
                                                onClick={() => {
                                                    // For now, just log - EditSystemModal integration would go here
                                                    log('info', 'Edit system clicked', { systemId: system.id });
                                                }}
                                                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md transition-colors text-xs"
                                            >
                                                ✏️ Edit
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Merge Systems Controls */}
                {selectedSystemIds.length >= 2 && (
                    <div className="mt-6 bg-gray-900 p-4 rounded-md border border-gray-700">
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2">
                                <label htmlFor="primary-system-merge" className="font-semibold text-gray-300">
                                    Primary System:
                                </label>
                                <select
                                    id="primary-system-merge"
                                    value={primarySystemId}
                                    onChange={(e) => setPrimarySystemId(e.target.value)}
                                    className="bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary"
                                >
                                    <option value="">-- Select System to Keep --</option>
                                    {systems
                                        .filter(s => selectedSystemIds.includes(s.id))
                                        .map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))
                                    }
                                </select>
                            </div>
                            <button
                                onClick={handleMergeSystems}
                                disabled={!primarySystemId}
                                className="bg-secondary hover:bg-primary text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                            >
                                🔀 Merge {selectedSystemIds.length} Systems
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedSystemIds([]);
                                    setPrimarySystemId('');
                                }}
                                className="bg-gray-600 hover:bg-gray-500 text-white font-semibold py-2 px-4 rounded-md transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Adopt System Modal */}
            {adoptingDL && (
                <EditSystemModal
                    system={null} // null means we're creating a new system
                    onSave={handleSaveNewSystem}
                    onClose={() => {
                        setAdoptingDL(null);
                        setSaveError(null);
                    }}
                    isSaving={isSavingNewSystem}
                    initialData={{
                        name: `System for ${adoptingDL.dl_id}`,
                        associatedDLs: [adoptingDL.dl_id],
                        chemistry: 'LiFePO4', // Default
                        voltage: null,
                        capacity: null,
                        latitude: null,
                        longitude: null
                    }}
                    enableGeolocation={true}
                    error={saveError}
                />
            )}
        </div>
    );
};

export default ReconciliationDashboard;
