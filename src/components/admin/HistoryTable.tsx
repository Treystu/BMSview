import React from 'react';
import { AdminAction, AdminState, HistorySortKey } from '../../state/adminState';
import type { AnalysisRecord, BmsSystem } from '../../types';
import { ALL_HISTORY_COLUMNS, getNestedValue, HistoryColumnKey } from './columnDefinitions';
import ColumnSelector from './ColumnSelector';
import PaginationControls from './PaginationControls';

interface HistoryTableProps {
    history: AnalysisRecord[];
    systems: BmsSystem[];
    state: AdminState;
    dispatch: React.Dispatch<AdminAction>;
    onLinkRecord: (record: AnalysisRecord) => void;
    onDeleteRecord: (recordId: string) => void;
    pagination: {
        currentPage: number;
        totalItems: number;
        itemsPerPage: number;
    }
}

const SortableHeader: React.FC<{
    label: string;
    sortKey: HistorySortKey;
    currentSortKey: HistorySortKey;
    currentSortDirection: 'asc' | 'desc';
    onSort: (key: HistorySortKey) => void;
    className?: string;
}> = ({ label, sortKey, currentSortKey, currentSortDirection, onSort, className = '' }) => {
    const isCurrent = currentSortKey === sortKey;

    return (
        <th className={`p-3 text-left cursor-pointer select-none whitespace-nowrap ${className}`} onClick={() => onSort(sortKey)}>
            {label}
            {isCurrent && <span className="ml-1 text-xs">{currentSortDirection === 'asc' ? '▲' : '▼'}</span>}
        </th>
    );
};


const HistoryTable: React.FC<HistoryTableProps> = ({ history, systems, state, dispatch, onLinkRecord, onDeleteRecord, pagination }) => {
    const { linkSelections, actionStatus, expandedHistoryId, historySortKey, historySortDirection, visibleHistoryColumns } = state;

    const handleSort = (key: HistorySortKey) => {
        dispatch({ type: 'SET_HISTORY_SORT', payload: { key } });
    };

    const handleVisibleColumnsChange = (columns: HistoryColumnKey[]) => {
        dispatch({ type: 'SET_VISIBLE_HISTORY_COLUMNS', payload: columns });
    };

    return (
        <section>
            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
                <h2 className="text-2xl font-semibold text-secondary border-b-2 border-gray-600 pb-2 sm:border-none">Analysis History</h2>
                <ColumnSelector
                    visibleColumns={visibleHistoryColumns}
                    onVisibleColumnsChange={handleVisibleColumnsChange}
                />
            </div>
            <div className="overflow-x-auto bg-neutral-dark rounded-lg shadow-lg">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-700">
                        <tr>
                            {visibleHistoryColumns.map(colKey => {
                                const colDef = ALL_HISTORY_COLUMNS[colKey];
                                if (!colDef) return null;
                                const label = colDef.unit ? `${colDef.label} (${colDef.unit})` : colDef.label;
                                return colDef.sortable ? (
                                    <SortableHeader
                                        key={colKey}
                                        label={label}
                                        sortKey={colKey}
                                        currentSortKey={historySortKey}
                                        currentSortDirection={historySortDirection}
                                        onSort={handleSort}
                                    />
                                ) : (
                                    <th key={colKey} className="p-3 text-left whitespace-nowrap">{label}</th>
                                );
                            })}
                            <th className="p-3 text-left">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                        {history.length > 0 ? history.map(record => (
                            <React.Fragment key={record.id}>
                                <tr className="hover:bg-gray-800">
                                    {visibleHistoryColumns.map(colKey => {
                                        const colDef = ALL_HISTORY_COLUMNS[colKey];
                                        if (!colDef) return <td key={colKey} className="p-3"></td>;

                                        const value = getNestedValue(record, colKey);
                                        const displayValue = colDef.format
                                            ? colDef.format(value, record)
                                            : (value == null ? 'N/A' : (typeof value === 'string' || typeof value === 'number' ? value : String(value)));

                                        return (
                                            <td key={colKey} className={`p-3 whitespace-nowrap ${colKey.includes('Number') || colKey.includes('dlNumber') || colKey === 'hardwareSystemId' ? 'font-mono text-xs' : ''}`}>
                                                {displayValue}
                                            </td>
                                        );
                                    })}

                                    <td className="p-3 whitespace-nowrap">
                                        <div className="flex items-center space-x-2">
                                            {!record.systemId && (
                                                <div className="flex items-center space-x-1">
                                                    <select
                                                        value={linkSelections[record.id] || ''}
                                                        onChange={(e) => dispatch({ type: 'SET_LINK_SELECTION', payload: { recordId: record.id, systemId: e.target.value } })}
                                                        className="bg-gray-700 border border-gray-600 rounded-md p-1 text-xs text-white focus:ring-secondary focus:border-secondary"
                                                        aria-label={`Link analysis from ${new Date(record.timestamp).toLocaleString()} to a system`}
                                                    >
                                                        <option value="">Link to...</option>
                                                        {systems.map(system => (
                                                            <option key={system.id} value={system.id}>{system.name}</option>
                                                        ))}
                                                        {(record.hardwareSystemId || record.dlNumber || record.analysis?.hardwareSystemId || record.analysis?.dlNumber) && (
                                                            <option value="--create-new--" className="font-bold text-secondary">
                                                                + Create New System...
                                                            </option>
                                                        )}
                                                    </select>
                                                    <button
                                                        onClick={() => onLinkRecord(record)}
                                                        disabled={!linkSelections[record.id] || actionStatus.linkingRecordId === record.id}
                                                        className="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-2 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors text-xs"
                                                    >
                                                        {actionStatus.linkingRecordId === record.id ? '...' : 'Link'}
                                                    </button>
                                                </div>
                                            )}
                                            <button onClick={() => dispatch({ type: 'TOGGLE_HISTORY_DETAIL', payload: record.id })} className="text-secondary hover:underline font-semibold text-sm">
                                                {expandedHistoryId === record.id ? 'Hide' : 'View'}
                                            </button>
                                            <button
                                                onClick={() => onDeleteRecord(record.id)}
                                                disabled={actionStatus.deletingRecordId === record.id}
                                                className="text-red-500 hover:text-red-400 font-semibold text-sm disabled:text-gray-500 disabled:cursor-wait"
                                            >
                                                {actionStatus.deletingRecordId === record.id ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                                {expandedHistoryId === record.id && (
                                    <tr className="bg-gray-900">
                                        <td colSpan={visibleHistoryColumns.length + 1} className="p-4">
                                            <pre className="text-xs whitespace-pre-wrap text-yellow-300 bg-black p-4 rounded-md">
                                                {JSON.stringify(record, null, 2)}
                                            </pre>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        )) : (
                            <tr>
                                <td colSpan={visibleHistoryColumns.length + 1} className="p-3 text-center text-gray-400">No analysis history found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <PaginationControls
                currentPage={pagination.currentPage}
                totalItems={pagination.totalItems}
                itemsPerPage={pagination.itemsPerPage}
                onPageChange={(page) => dispatch({ type: 'SET_HISTORY_PAGE', payload: page })}
            />
        </section>
    );
};

export default HistoryTable;