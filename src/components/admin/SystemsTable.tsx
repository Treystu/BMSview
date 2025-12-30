import React, { useState } from 'react';
import { AdminAction } from '../../state/adminState';
import type { BmsSystem } from '../../types';
import PaginationControls from './PaginationControls';

interface SystemsTableProps {
    systems: BmsSystem[];
    dispatch: React.Dispatch<AdminAction>;
    pagination: {
        currentPage: number;
        totalItems: number;
        itemsPerPage: number;
    };
    onMergeRequested?: (systemIds: string[], primaryId: string) => void;
}

const SystemsTable: React.FC<SystemsTableProps> = ({ systems, dispatch, pagination, onMergeRequested }) => {
    const [selectedSystemIds, setSelectedSystemIds] = useState<string[]>([]);
    const [primarySystemId, setPrimarySystemId] = useState<string>('');

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
        if (selectedSystemIds.length < 2 || !primarySystemId || !onMergeRequested) return;
        onMergeRequested(selectedSystemIds, primarySystemId);
        // Clear selections
        setSelectedSystemIds([]);
        setPrimarySystemId('');
    };

    return (
        <section>
            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">Registered Systems</h2>
            <div className="overflow-x-auto bg-neutral-dark rounded-lg shadow-lg">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-700">
                        <tr>
                            {onMergeRequested && (
                                <th className="p-3 w-10">
                                    <span className="text-gray-500 text-xs">Select</span>
                                </th>
                            )}
                            <th className="p-3 text-left">Name</th>
                            <th className="p-3 text-left">Chemistry</th>
                            <th className="p-3 text-left">Specs</th>
                            <th className="p-3 text-left">Location</th>
                            <th className="p-3 text-left">Associated System IDs</th>
                            <th className="p-3 text-left">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {systems.length > 0 ? systems.map(system => {
                            const isSelected = selectedSystemIds.includes(system.id);
                            return (
                                <tr key={system.id} className={`hover:bg-gray-800 ${isSelected ? 'bg-blue-900/30' : ''}`}>
                                    {onMergeRequested && (
                                        <td className="p-3 text-center">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => handleToggleSystemSelection(system.id)}
                                                className="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 text-secondary focus:ring-secondary"
                                            />
                                        </td>
                                    )}
                                    <td className="p-3 font-medium">{system.name}</td>
                                    <td className="p-3">{system.chemistry || 'N/A'}</td>
                                    <td className="p-3">{system.voltage || 'N/A'}V / {system.capacity || 'N/A'}Ah</td>
                                    <td className="p-3 font-mono text-xs max-w-[150px] truncate" title={`${system.latitude}, ${system.longitude}`}>
                                        {system.latitude && system.longitude ? `${system.latitude}, ${system.longitude}` : 'N/A'}
                                    </td>
                                    <td className="p-3 font-mono text-xs break-all max-w-[200px]">
                                        {(system.associatedHardwareIds || system.associatedDLs || []).join(', ') || 'None'}
                                    </td>
                                    <td className="p-3">
                                        <button onClick={() => dispatch({ type: 'SET_EDITING_SYSTEM', payload: system })} className="text-secondary hover:underline font-semibold text-sm">
                                            Edit
                                        </button>
                                    </td>
                                </tr>
                            );
                        }) : (
                            <tr>
                                <td colSpan={onMergeRequested ? 7 : 6} className="p-3 text-center text-gray-400">No systems registered.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Merge Systems Controls */}
            {onMergeRequested && selectedSystemIds.length >= 2 && (
                <div className="mt-6 bg-gray-800 p-4 rounded-md border border-gray-700 shadow-lg">
                    <h3 className="text-lg font-semibold text-secondary mb-3">Merge Selected Systems</h3>
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2 flex-grow md:flex-grow-0">
                            <label htmlFor="primary-system-merge" className="font-semibold text-gray-300 whitespace-nowrap">
                                Primary System (Keep):
                            </label>
                            <select
                                id="primary-system-merge"
                                value={primarySystemId}
                                onChange={(e) => setPrimarySystemId(e.target.value)}
                                className="bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary w-full md:w-auto"
                            >
                                <option value="">-- Select System --</option>
                                {systems
                                    .filter(s => selectedSystemIds.includes(s.id))
                                    .map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))
                                }
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleMergeSystems}
                                disabled={!primarySystemId}
                                className="bg-secondary hover:bg-primary text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                            >
                                🔀 Merge Systems
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
                    <p className="text-sm text-gray-400 mt-2">
                        All history records from the other selected systems will be re-assigned to the Primary System. The other system profiles will be deleted.
                    </p>
                </div>
            )}

            <PaginationControls
                currentPage={pagination.currentPage}
                totalItems={pagination.totalItems}
                itemsPerPage={pagination.itemsPerPage}
                onPageChange={(page) => dispatch({ type: 'SET_SYSTEMS_PAGE', payload: page })}
            />
        </section>
    );
};

export default SystemsTable;