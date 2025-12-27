import React from 'react';
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
    }
}

const SystemsTable: React.FC<SystemsTableProps> = ({ systems, dispatch, pagination }) => {
    return (
        <section>
            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">Registered Systems</h2>
            <div className="overflow-x-auto bg-neutral-dark rounded-lg shadow-lg">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-700">
                        <tr>
                            <th className="p-3 text-left">Name</th>
                            <th className="p-3 text-left">Chemistry</th>
                            <th className="p-3 text-left">Specs</th>
                            <th className="p-3 text-left">Location</th>
                            <th className="p-3 text-left">Associated System IDs</th>
                            <th className="p-3 text-left">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {systems.length > 0 ? systems.map(system => (
                            <tr key={system.id} className="hover:bg-gray-800">
                                <td className="p-3 font-medium">{system.name}</td>
                                <td className="p-3">{system.chemistry || 'N/A'}</td>
                                <td className="p-3">{system.voltage || 'N/A'}V / {system.capacity || 'N/A'}Ah</td>
                                <td className="p-3 font-mono text-xs">{system.latitude}, {system.longitude}</td>
                                <td className="p-3 font-mono text-xs break-all">
                                    {(system.associatedHardwareIds?.length ? system.associatedHardwareIds : system.associatedDLs)?.join(', ') || 'None'}
                                </td>
                                <td className="p-3">
                                    <button onClick={() => dispatch({ type: 'SET_EDITING_SYSTEM', payload: system })} className="text-secondary hover:underline font-semibold text-sm">
                                        Edit
                                    </button>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={6} className="p-3 text-center text-gray-400">No systems registered.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
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