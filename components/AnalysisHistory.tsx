

import React from 'react';
import type { AnalysisRecord, BmsSystem } from '../types';

interface AnalysisHistoryProps {
  history: AnalysisRecord[];
  systems: BmsSystem[];
  onLinkSystem: (recordId: string, systemId: string) => void;
  onDeleteRecord: (recordId: string) => void;
  onToggleExpand: (recordId: string) => void;
  expandedId: string | null;
  onRegisterNewSystem: (dlNumber: string) => void;
}

const AnalysisHistory: React.FC<AnalysisHistoryProps> = ({ 
    history, 
    systems, 
    onLinkSystem, 
    onDeleteRecord,
    onToggleExpand,
    expandedId,
    onRegisterNewSystem
}) => {
    const [linkSelections, setLinkSelections] = React.useState<{ [recordId: string]: string }>({});
    const [linkingStates, setLinkingStates] = React.useState<{ [recordId: string]: boolean }>({});

    const handleLinkRecord = async (recordId: string, dlNumber: string | null | undefined) => {
        const systemId = linkSelections[recordId];
        if (!systemId) return;

        setLinkingStates(prev => ({...prev, [recordId]: true }));
        try {
            if (systemId === '--create-new--') {
                if (dlNumber) {
                    onRegisterNewSystem(dlNumber);
                }
            } else {
                await onLinkSystem(recordId, systemId);
            }
        } finally {
            setLinkingStates(prev => ({...prev, [recordId]: false }));
        }
    }

  return (
    <section id="history-section" className="py-20 bg-neutral-light">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-neutral-dark">Analysis History ({history.length})</h2>
            <p className="text-neutral mt-2 max-w-2xl mx-auto">
                Review your past analysis results to track your systems' health over time.
            </p>
        </div>
        
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-lg overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">System Name</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DL Number</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key Metrics</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Summary</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {history.map(record => (
                        <React.Fragment key={record.id}>
                            <tr className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-gray-700">{
                                    new Date(record.timestamp).toLocaleString('en-US', {
                                        year: 'numeric', month: 'short', day: 'numeric',
                                        hour: 'numeric', minute: '2-digit', second: '2-digit',
                                        hour12: false, timeZone: 'UTC'
                                    }) + ' UTC'
                                }</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {!record.systemId ? (
                                        <div className="flex items-center space-x-2">
                                            <select
                                                value={linkSelections[record.id] || ''}
                                                onChange={(e) => setLinkSelections(prev => ({...prev, [record.id]: e.target.value}))}
                                                className="block w-32 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-secondary focus:border-secondary sm:text-sm rounded-md"
                                            >
                                                <option value="">Link to...</option>
                                                {systems.map(system => (
                                                    <option key={system.id} value={system.id}>{system.name}</option>
                                                ))}
                                                {record.dlNumber && (
                                                    <option value="--create-new--" className="font-bold text-secondary">
                                                        + Register New...
                                                    </option>
                                                )}
                                            </select>
                                            <button
                                                onClick={() => handleLinkRecord(record.id, record.dlNumber)}
                                                disabled={!linkSelections[record.id] || linkingStates[record.id]}
                                                className="bg-secondary hover:bg-primary text-white font-bold py-2 px-3 rounded-lg shadow-md disabled:bg-gray-400 transition-colors text-xs"
                                            >
                                                {linkingStates[record.id] ? '...' : 'Link'}
                                            </button>
                                        </div>
                                    ) : (
                                        <span className="font-semibold text-neutral-dark">{record.systemName || 'Unlinked'}</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap font-mono text-gray-600 text-xs">{record.dlNumber || 'N/A'}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                    V: {record.analysis?.overallVoltage?.toFixed(1) ?? 'N/A'}<br/>
                                    A: {record.analysis?.current?.toFixed(1) ?? 'N/A'}<br/>
                                    SOC: {record.analysis?.stateOfCharge?.toFixed(1) ?? 'N/A'}%
                                </td>
                                <td className="px-6 py-4 max-w-xs text-gray-600">
                                    <p className="truncate" title={record.analysis?.summary}>
                                        {record.analysis?.summary}
                                    </p>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center space-x-4">
                                        <button onClick={() => onToggleExpand(record.id)} className="text-secondary hover:underline font-semibold text-sm">
                                            {expandedId === record.id ? 'Hide' : 'View'}
                                        </button>
                                        <button
                                            onClick={() => onDeleteRecord(record.id)}
                                            className="text-red-600 hover:text-red-800 font-semibold text-sm"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            {expandedId === record.id && (
                                <tr className="bg-gray-100">
                                    <td colSpan={6} className="p-4">
                                        <pre className="text-xs whitespace-pre-wrap text-white bg-neutral-dark p-4 rounded-md shadow-inner">
                                            {JSON.stringify(record, null, 2)}
                                        </pre>
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
      </div>
    </section>
  );
};

export default AnalysisHistory;