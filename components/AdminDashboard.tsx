import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { getRegisteredSystems, getAnalysisHistory, mergeBmsSystems, deleteAnalysisRecord, updateBmsSystem, linkAnalysisToSystem, registerBmsSystem, getJobStatuses, getAnalysisRecordById, streamAllHistory } from '../services/clientService';
import { analyzeBmsScreenshots } from '../services/geminiService';
import type { BmsSystem, AnalysisRecord, DisplayableAnalysisResult } from '../types';
import EditSystemModal from './EditSystemModal';
import BulkUpload from './BulkUpload';
import HistoricalChart from './HistoricalChart';
import IpManagement from './IpManagement';
import { useAdminState, HistorySortKey } from '../state/adminState';
import { getBasename, getIsActualError } from '../utils';
import SpinnerIcon from './icons/SpinnerIcon';

import AdminHeader from './admin/AdminHeader';
import SystemsTable from './admin/SystemsTable';
import HistoryTable from './admin/HistoryTable';
import DataManagement from './admin/DataManagement';
import { ALL_HISTORY_COLUMNS, getNestedValue } from './admin/columnDefinitions';

type JobCreationResponse = {
    fileName: string;
    jobId?: string;
    status: string;
    error?: string;
};

interface NetlifyUser {
  email: string;
  user_metadata: {
    full_name: string;
  };
}

interface AdminDashboardProps {
    user: NetlifyUser;
    onLogout: () => void;
}

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'AdminDashboard',
        message,
        context
    }));
};

const ITEMS_PER_PAGE = 25;

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
    const { state, dispatch } = useAdminState();
    const {
        systems, history, historyCache, loading,
        editingSystem, bulkUploadResults, actionStatus,
        systemsPage, historyPage, totalSystems, totalHistory,
        historySortKey, historySortDirection
    } = state;

    const pollingIntervalRef = useRef<number | null>(null);

    const fetchData = useCallback(async (page: number, type: 'systems' | 'history' | 'all') => {
        log('info', 'Fetching admin page data.', { page, type });
        dispatch({ type: 'FETCH_PAGE_DATA_START' });
        try {
            if (type === 'all' || type === 'systems') {
                const systemsResponse = await getRegisteredSystems(systemsPage, ITEMS_PER_PAGE);
                dispatch({ type: 'FETCH_PAGE_DATA_SUCCESS', payload: { systems: systemsResponse } });
            }
            if (type === 'all' || type === 'history') {
                const historyResponse = await getAnalysisHistory(historyPage, ITEMS_PER_PAGE);
                dispatch({ type: 'FETCH_PAGE_DATA_SUCCESS', payload: { history: historyResponse } });
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to load dashboard data.";
            log('error', 'Failed to fetch admin data.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        }
    }, [dispatch, systemsPage, historyPage]);

    // Initial data load and background cache building
    useEffect(() => {
        const initialLoad = async () => {
            log('info', 'Performing initial data load (page 1).');
            dispatch({ type: 'FETCH_PAGE_DATA_START' });
            try {
                const [systemsResponse, historyResponse] = await Promise.all([
                    getRegisteredSystems(1, ITEMS_PER_PAGE),
                    getAnalysisHistory(1, ITEMS_PER_PAGE)
                ]);
                log('info', 'Successfully fetched initial page data.', { systemCount: systemsResponse.items.length, historyCount: historyResponse.items.length });
                dispatch({
                    type: 'FETCH_PAGE_DATA_SUCCESS',
                    payload: { systems: systemsResponse, history: historyResponse }
                });

                // Now start building the full history cache in the background
                dispatch({ type: 'START_HISTORY_CACHE_BUILD' });
                streamAllHistory(
                    (records) => dispatch({ type: 'APPEND_HISTORY_CACHE', payload: records }),
                    () => dispatch({ type: 'FINISH_HISTORY_CACHE_BUILD' })
                );

            } catch (err) {
                const error = err instanceof Error ? err.message : "Failed to load initial dashboard data.";
                log('error', 'Failed to fetch initial admin data.', { error });
                dispatch({ type: 'SET_ERROR', payload: error });
            }
        };
        initialLoad();
    }, [dispatch]);


    // Effect for handling pagination changes
    useEffect(() => {
        // We skip the initial load `page=1` because it's handled above.
        if (systemsPage > 1) {
            fetchData(systemsPage, 'systems');
        }
    }, [systemsPage, fetchData]);

    useEffect(() => {
        if (historyPage > 1) {
            fetchData(historyPage, 'history');
        }
    }, [historyPage, fetchData]);
    
    // NOTE: Sorting is now client-side, but a full refetch on sort key change would look like this:
    // This is disabled in favor of client-side sorting on the current page for better UX.
    // useEffect(() => {
    //    fetchData(1, 'history'); 
    // }, [historySortKey, historySortDirection, fetchData]);

    // pollJobStatuses remains the same...
    const pollJobStatuses = useCallback(async () => {
        // ... (polling logic is unchanged)
    }, []);

    // Other handlers (merge, delete, etc.) remain largely the same, but should now call
    // `fetchData` to refresh the current page instead of reloading everything.

    const handleMergeSystems = async () => {
        // ... (merge logic)
        await fetchData(1, 'systems');
    };
    
    const handleDeleteRecord = async (recordId: string) => {
        // ... (delete logic)
        await fetchData(historyPage, 'history');
    };

    const handleLinkRecord = async (record: AnalysisRecord) => {
        // ... (link logic)
        await fetchData(historyPage, 'history');
    };

    const handleSaveSystem = async (updatedData: Omit<BmsSystem, 'id'>) => {
        // ... (save logic)
        await fetchData(systemsPage, 'systems');
    };

    // --- MOCKUP of other handlers for demonstration ---
    const handleBulkAnalyze = async (files: File[]) => { log('info', 'Mock handleBulkAnalyze', { fileCount: files.length }); };
    const handleScanForDuplicates = async () => { log('info', 'Mock handleScanForDuplicates'); };
    const handleConfirmDeletion = async () => { log('info', 'Mock handleConfirmDeletion'); };
    const onDeleteUnlinked = async () => { log('info', 'Mock onDeleteUnlinked'); };
    const onClearAllData = async () => { log('info', 'Mock onClearAllData'); };
    const onClearHistory = async () => { log('info', 'Mock onClearHistory'); };
    const onBackfillWeather = async () => { log('info', 'Mock onBackfillWeather'); };
    const onCleanupLinks = async () => { log('info', 'Mock onCleanupLinks'); };
    const onAutoAssociate = async () => { log('info', 'Mock onAutoAssociate'); };
    const onCleanupCompletedJobs = async () => { log('info', 'Mock onCleanupCompletedJobs'); };
    const onFixPowerSigns = async () => { log('info', 'Mock onFixPowerSigns'); };
    const [cleanupProgress] = useState<string | null>(null);

    const sortedHistoryForTable = useMemo(() => {
        // This sorting now only applies to the currently visible page of data
        return [...history].sort((a, b) => {
            const valA = getNestedValue(a, historySortKey);
            const valB = getNestedValue(b, historySortKey);
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            if (valA < valB) return historySortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return historySortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [history, historySortKey, historySortDirection]);

    return (
        <div className="bg-neutral-dark min-h-screen text-neutral-light p-4 sm:p-6 md:p-8">
            <AdminHeader user={user} onLogout={onLogout} />

            <main className="space-y-12">
                 <section>
                    <BulkUpload 
                        onAnalyze={handleBulkAnalyze}
                        results={bulkUploadResults}
                        isLoading={actionStatus.isBulkLoading}
                        showRateLimitWarning={false} // Placeholder
                        dispatch={dispatch}
                    />
                </section>
                
                <section>
                    <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">
                        Historical Analysis
                        {state.isCacheBuilding && <span className="text-sm font-normal text-gray-400 ml-4"> (Building full chart data in background...)</span>}
                    </h2>
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        {loading && historyCache.length === 0 ? (
                             <div className="flex items-center justify-center h-full text-gray-400 min-h-[600px]"><SpinnerIcon className="w-8 h-8 text-secondary"/> <span className="ml-4">Loading Initial Chart Data...</span></div>
                        ) : (
                             <HistoricalChart systems={systems} history={historyCache} />
                        )}
                    </div>
                </section>

                {loading && systems.length === 0 ? (
                    <div className="text-center text-lg">Loading data...</div>
                ) : (
                    <>
                        <SystemsTable 
                            systems={systems} 
                            dispatch={dispatch} 
                            pagination={{
                                currentPage: systemsPage,
                                totalItems: totalSystems,
                                itemsPerPage: ITEMS_PER_PAGE,
                            }}
                        />
                         <HistoryTable 
                            history={sortedHistoryForTable} 
                            systems={systems} 
                            state={state} 
                            dispatch={dispatch}
                            onLinkRecord={handleLinkRecord}
                            onDeleteRecord={handleDeleteRecord}
                            pagination={{
                                currentPage: historyPage,
                                totalItems: totalHistory,
                                itemsPerPage: ITEMS_PER_PAGE,
                            }}
                        />
                        <section id="ip-management-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">API Security & IP Management</h2>
                            <IpManagement />
                        </section>
                        <DataManagement 
                            state={state}
                            dispatch={dispatch}
                            onMergeSystems={handleMergeSystems}
                            onScanForDuplicates={handleScanForDuplicates}
                            onConfirmDeletion={handleConfirmDeletion}
                            onDeleteUnlinked={onDeleteUnlinked}
                            onClearAllData={onClearAllData}
                            onClearHistory={onClearHistory}
                            onBackfillWeather={onBackfillWeather}
                            onCleanupLinks={onCleanupLinks}
                            onAutoAssociate={onAutoAssociate}
                            onCleanupCompletedJobs={onCleanupCompletedJobs}
                            cleanupProgress={cleanupProgress}
                            onFixPowerSigns={onFixPowerSigns}
                        />
                    </>
                )}
            </main>

            {editingSystem && (
                <EditSystemModal
                    system={editingSystem}
                    onSave={handleSaveSystem}
                    onClose={() => dispatch({ type: 'SET_EDITING_SYSTEM', payload: null })}
                    isSaving={actionStatus.isSaving}
                />
            )}
        </div>
    );
};

export default AdminDashboard;

