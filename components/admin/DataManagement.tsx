import React, { useMemo } from 'react';
import type { BmsSystem, AnalysisRecord } from '../../types';
import { AdminState, AdminAction } from '../../state/adminState';

interface DataManagementProps {
    state: AdminState;
    dispatch: React.Dispatch<AdminAction>;
    onMergeSystems: () => void;
    onScanForDuplicates: () => void;
    onConfirmDeletion: () => void;
    onDeleteUnlinked: () => void;
    onClearAllData: () => void;
    onClearHistory: () => void;
    onBackfillWeather: () => void;
    onCleanupLinks: () => void;
    onAutoAssociate: () => void;
    cleanupProgress: string | null;
    onFixPowerSigns: () => void;
}

const DataManagement: React.FC<DataManagementProps> = ({
    state,
    dispatch,
    onMergeSystems,
    onScanForDuplicates,
    onConfirmDeletion,
    onDeleteUnlinked,
    onClearAllData,
    onClearHistory,
    onBackfillWeather,
    onCleanupLinks,
    onAutoAssociate,
    onFixPowerSigns
}) => {
    const { 
        systems, error, selectedSystemIds, primarySystemId, 
        duplicateSets, actionStatus, isConfirmingClearAll, clearAllConfirmationText 
    } = state;

    const totalDeletions = useMemo(() => {
        return duplicateSets.reduce((acc, set) => acc + set.length - 1, 0);
    }, [duplicateSets]);

    return (
        <section>
            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">Data Management</h2>
            {error && <p className="text-red-500 mb-4 p-3 bg-red-900/50 border border-red-500 rounded-md">{error}</p>}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-gray-800 p-4 rounded-lg shadow-inner lg:col-span-2">
                    <h3 className="font-semibold text-lg mb-2">Combine Duplicate Systems</h3>
                    <p className="text-sm text-gray-400 mb-4">Select at least two systems to merge. All associated DLs and analysis history will be moved to the selected primary system, and the other selected systems will be deleted.</p>
                    
                    <div className="overflow-x-auto border border-gray-700 rounded-md mb-4 max-h-60">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-700 sticky top-0">
                                <tr>
                                    <th className="p-2 w-10"></th>
                                    <th className="p-2 text-left">Name</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {systems.map(system => (
                                    <tr key={`select-${system.id}`} className="hover:bg-gray-900">
                                        <td className="p-2 text-center">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedSystemIds.includes(system.id)}
                                                onChange={(e) => {
                                                    const newSelection = e.target.checked
                                                        ? [...selectedSystemIds, system.id]
                                                        : selectedSystemIds.filter(id => id !== system.id);
                                                    dispatch({ type: 'SET_SELECTED_SYSTEM_IDS', payload: newSelection });
                                                }}
                                                className="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 text-secondary focus:ring-secondary"
                                            />
                                        </td>
                                        <td className="p-2 font-medium">{system.name}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {selectedSystemIds.length >= 2 && (
                        <div className="mt-4 flex flex-wrap items-center gap-4 bg-gray-900 p-3 rounded-md">
                            <label htmlFor="primary-system-select" className="font-semibold">Primary System:</label>
                            <select 
                                id="primary-system-select"
                                value={primarySystemId} 
                                onChange={(e) => dispatch({ type: 'SET_PRIMARY_SYSTEM_ID', payload: e.target.value })}
                                className="bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary"
                            >
                                <option value="">-- Select System to Keep --</option>
                                {systems
                                    .filter(s => selectedSystemIds.includes(s.id))
                                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                                }
                            </select>
                            <button 
                                onClick={onMergeSystems} 
                                disabled={!primarySystemId || actionStatus.isMerging}
                                className="bg-secondary hover:bg-primary text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                            >
                                {actionStatus.isMerging ? 'Merging...' : `Merge ${selectedSystemIds.length} Systems`}
                            </button>
                        </div>
                    )}
                </div>
                
                <div className="space-y-6">
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        <h3 className="font-semibold text-lg mb-2">Data Maintenance</h3>
                        <p className="text-sm text-gray-400 mb-4">Run tasks to enrich data or clean up inconsistencies.</p>
                        <div className="flex flex-wrap gap-4">
                            <button 
                                onClick={onBackfillWeather} 
                                disabled={actionStatus.isBackfilling} 
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-blue-900 disabled:cursor-not-allowed transition-colors"
                            >
                                {actionStatus.isBackfilling ? 'Backfilling...' : 'Backfill Weather'}
                            </button>
                            <button 
                                onClick={onCleanupLinks} 
                                disabled={actionStatus.isCleaningLinks} 
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-blue-900 disabled:cursor-not-allowed transition-colors"
                            >
                                {actionStatus.isCleaningLinks ? 'Cleaning...' : 'Verify & Clean Links'}
                            </button>
                            <button 
                                onClick={onAutoAssociate} 
                                disabled={actionStatus.isAutoAssociating} 
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-blue-900 disabled:cursor-not-allowed transition-colors"
                            >
                                {actionStatus.isAutoAssociating ? 'Associating...' : 'Auto-associate Unlinked DLs'}
                            </button>
                             <button 
                                onClick={onFixPowerSigns} 
                                disabled={actionStatus.isFixingPowerSigns} 
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-blue-900 disabled:cursor-not-allowed transition-colors"
                            >
                                {actionStatus.isFixingPowerSigns ? 'Fixing...' : 'Fix Power Signs'}
                            </button>

                        </div>
                    </div>
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        <h3 className="font-semibold text-lg mb-2">Remove Duplicate History</h3>
                        <p className="text-sm text-gray-400 mb-4">Scan all analysis records and remove entries that are duplicates based on key metrics. The earliest record in a duplicate set will be kept.</p>
                        
                        {duplicateSets.length === 0 ? (
                            <button 
                                onClick={onScanForDuplicates}
                                disabled={actionStatus.isScanning}
                                className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-yellow-900 disabled:cursor-not-allowed transition-colors"
                            >
                                {actionStatus.isScanning ? 'Scanning...' : 'Scan for Duplicates'}
                            </button>
                        ) : (
                            <div className="mt-4 border-t border-gray-700 pt-4">
                                <h4 className="text-lg font-semibold text-yellow-400">Verification Step</h4>
                                <p className="text-gray-300 my-2">Found {duplicateSets.length} sets with a total of {totalDeletions} duplicate records. Review the records below and confirm deletion.</p>
                                
                                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 my-4 border border-gray-700 rounded-md p-2 bg-black/20">
                                    {duplicateSets.map((set, index) => (
                                        <div key={index} className="bg-gray-900 p-3 rounded-md">
                                            <h5 className="font-semibold text-gray-400 mb-2">Set {index + 1} ({set.length} items)</h5>
                                            <table className="min-w-full text-xs">
                                                <thead>
                                                    <tr className="text-left text-gray-400">
                                                        <th className="p-1 font-semibold">Status</th>
                                                        <th className="p-1 font-semibold">Timestamp</th>
                                                        <th className="p-1 font-semibold">System</th>
                                                        <th className="p-1 font-semibold">DL Number</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {set.map((record, recordIndex) => (
                                                        <tr key={record.id} className={recordIndex > 0 ? 'opacity-70' : ''}>
                                                            <td className="p-1">
                                                                {recordIndex === 0 ? (
                                                                    <span className="font-bold text-green-400 px-2 py-1 rounded-full bg-green-900/50 text-[10px]">KEEP</span>
                                                                ) : (
                                                                    <span className="font-bold text-red-400 px-2 py-1 rounded-full bg-red-900/50 text-[10px]">DELETE</span>
                                                                )}
                                                            </td>
                                                            <td className="p-1">{new Date(record.timestamp).toLocaleString()}</td>
                                                            <td className="p-1">{record.systemName}</td>
                                                            <td className="p-1 font-mono">{record.dlNumber || 'N/A'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 flex items-center space-x-4">
                                    <button
                                        onClick={onConfirmDeletion}
                                        disabled={actionStatus.isConfirmingDeletion}
                                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-red-900 disabled:cursor-not-allowed"
                                    >
                                        {actionStatus.isConfirmingDeletion ? 'Deleting...' : `Confirm and Delete ${totalDeletions} Duplicates`}
                                    </button>
                                    <button
                                        onClick={() => dispatch({ type: 'SCAN_DUPLICATES_SUCCESS', payload: [] })}
                                        disabled={actionStatus.isConfirmingDeletion}
                                        className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        <h3 className="font-semibold text-lg mb-2">Cleanup Stale Data</h3>
                        <p className="text-sm text-gray-400 mb-4">Permanently delete all analysis history records that are not linked to any registered system.</p>
                        <button 
                            onClick={onDeleteUnlinked} 
                            disabled={actionStatus.isDeletingUnlinked} 
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md disabled:bg-red-900 disabled:cursor-not-allowed transition-colors"
                        >
                            {actionStatus.isDeletingUnlinked ? 'Deleting...' : 'Delete Unlinked History'}
                        </button>
                    </div>
                </div>
            </div>
        
            <div className="mt-8 border-t-2 border-red-500/30 pt-6">
                <h3 className="font-semibold text-lg text-red-400 mb-2">Danger Zone</h3>
                <div className="bg-red-900/20 p-4 rounded-lg border border-red-500/50 space-y-6">
                    <div>
                        <h4 className="font-semibold text-lg text-red-300 mb-2">Clear History Store Only</h4>
                        <p className="text-sm text-red-400 mb-4">If you are experiencing storage-related errors, this will clear ALL analysis history but leave registered systems intact. This action is irreversible.</p>
                        <button
                            onClick={onClearHistory}
                            disabled={actionStatus.isClearingHistory || actionStatus.isClearingAll}
                            className="bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded-md disabled:bg-red-900/50 disabled:cursor-not-allowed transition-colors"
                        >
                            {actionStatus.isClearingHistory ? 'Clearing History...' : 'Clear Analysis History Store'}
                        </button>
                    </div>
                    <div className="pt-6 border-t border-red-500/50">
                        <h4 className="font-semibold text-lg text-red-300 mb-2">Clear All Data</h4>
                        {!isConfirmingClearAll ? (
                        <>
                            <p className="text-sm text-red-400 mb-4">Permanently delete all registered systems and analysis history. This action is irreversible.</p>
                            <button
                                onClick={() => dispatch({ type: 'SET_CONFIRMING_CLEAR_ALL', payload: true })}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors"
                            >
                                Clear All Data
                            </button>
                        </>
                    ) : (
                        <div className="space-y-4">
                            <p className="font-bold text-white">Are you absolutely sure?</p>
                            <p className="text-sm text-red-300">This will permanently delete all systems and history records. This data cannot be recovered.</p>
                            <label htmlFor="delete-confirm" className="block text-sm font-medium text-gray-300">
                                Please type <strong className="text-white">delete</strong> to confirm.
                            </label>
                            <input
                                id="delete-confirm"
                                type="text"
                                value={clearAllConfirmationText}
                                onChange={(e) => dispatch({ type: 'SET_CLEAR_ALL_CONFIRMATION_TEXT', payload: e.target.value })}
                                className="w-full sm:w-auto px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-white"
                            />
                            <div className="flex items-center space-x-4">
                                <button
                                    onClick={onClearAllData}
                                    disabled={clearAllConfirmationText !== 'delete' || actionStatus.isClearingAll}
                                    className="bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded-md disabled:bg-red-900/50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {actionStatus.isClearingAll ? 'Deleting...' : 'I understand, delete everything'}
                                </button>
                                <button
                                    onClick={() => dispatch({ type: 'SET_CONFIRMING_CLEAR_ALL', payload: false })}
                                    disabled={actionStatus.isClearingAll}
                                    className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default DataManagement;