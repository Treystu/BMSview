import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
    getRegisteredSystems, getAnalysisHistory, mergeBmsSystems, deleteAnalysisRecord,
    updateBmsSystem, linkAnalysisToSystem, registerBmsSystem, getJobStatuses,
    getAnalysisRecordById, streamAllHistory, findDuplicateAnalysisSets, deleteAnalysisRecords,
    deleteUnlinkedAnalysisHistory, clearAllData, clearHistoryStore, backfillWeatherData,
    cleanupLinks, autoAssociateRecords, cleanupCompletedJobs, fixPowerSigns
} from '../services/clientService';
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
    duplicateRecordId?: string; // Added to handle duplicates properly
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
const POLLING_INTERVAL_MS = 5000; // Define polling interval

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
    const { state, dispatch } = useAdminState();
    const {
        systems, history, historyCache, loading,
        editingSystem, bulkUploadResults, actionStatus,
        systemsPage, historyPage, totalSystems, totalHistory,
        historySortKey, historySortDirection, duplicateSets,
        primarySystemId, selectedSystemIds, isConfirmingClearAll,
        clearAllConfirmationText
    } = state;

    const [cleanupProgress, setCleanupProgress] = useState<string | null>(null);
    const [showRateLimitWarning, setShowRateLimitWarning] = useState(false);
    const pollingIntervalRef = useRef<number | null>(null);

    // --- Data Fetching ---
    const fetchData = useCallback(async (page: number, type: 'systems' | 'history' | 'all') => {
        log('info', 'Fetching admin page data.', { page, type });
        dispatch({ type: 'FETCH_PAGE_DATA_START' });
        try {
            const promises = [];
            if (type === 'all' || type === 'systems') {
                promises.push(getRegisteredSystems(page, ITEMS_PER_PAGE));
            }
            if (type === 'all' || type === 'history') {
                promises.push(getAnalysisHistory(page, ITEMS_PER_PAGE));
            }

            const responses = await Promise.all(promises);

            const payload: any = {};
            if (type === 'all') {
                payload.systems = responses[0];
                payload.history = responses[1];
            } else if (type === 'systems') {
                payload.systems = responses[0];
            } else if (type === 'history') {
                payload.history = responses[0];
            }

            dispatch({ type: 'FETCH_PAGE_DATA_SUCCESS', payload });

        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to load dashboard data.";
            log('error', 'Failed to fetch admin data.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        }
    }, [dispatch]); // Removed page dependencies to allow fetching specific pages

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

                // Start building the full history cache
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
        // Fetch data only if page number changes AND it's not the initial load (page 1)
        if (systemsPage > 1) {
            fetchData(systemsPage, 'systems');
        }
    }, [systemsPage, fetchData]);

    useEffect(() => {
        if (historyPage > 1) {
            fetchData(historyPage, 'history');
        }
    }, [historyPage, fetchData]);

    // --- Bulk Upload Polling ---
    const pollJobStatuses = useCallback(async () => {
        const pendingJobs = state.bulkUploadResults.filter(r => r.jobId && !r.data && !getIsActualError(r));
        if (pendingJobs.length === 0) {
            if (pollingIntervalRef.current) {
                log('info', 'No pending bulk jobs. Stopping poller.');
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
            return;
        }

        const jobIds = pendingJobs.map(j => j.jobId!);
        log('info', 'Polling bulk job statuses.', { jobCount: jobIds.length, jobIds });
        try {
            const statuses = await getJobStatuses(jobIds);
            log('debug', 'Received job statuses from server.', { statuses });

            let needsHistoryRefresh = false;
            for (const status of statuses) {
                const existingResult = state.bulkUploadResults.find(r => r.jobId === status.id);
                // Only update if status has changed or if it completed
                if (!existingResult || existingResult.error !== status.status || (status.status === 'completed' && !existingResult.data)) {
                    if (status.status === 'completed' && status.recordId) {
                        log('info', 'Bulk job completed, fetching full record.', { jobId: status.id, recordId: status.recordId });
                        try {
                            const record = await getAnalysisRecordById(status.recordId);
                            if (record) {
                                dispatch({ type: 'UPDATE_BULK_JOB_COMPLETED', payload: { jobId: status.id, record } });
                                needsHistoryRefresh = true;
                            } else {
                                log('warn', 'Bulk job completed but could not fetch the final record.', { jobId: status.id, recordId: status.recordId });
                                dispatch({ type: 'UPDATE_BULK_JOB_STATUS', payload: { jobId: status.id, status: 'failed_record_fetch' } });
                            }
                        } catch (fetchErr) {
                            log('error', 'Error fetching completed record for bulk job.', { jobId: status.id, recordId: status.recordId, error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) });
                            dispatch({ type: 'UPDATE_BULK_JOB_STATUS', payload: { jobId: status.id, status: 'failed_record_fetch' } });
                        }
                    } else if (status.status.startsWith('failed') || status.status === 'not_found') {
                        log('warn', `Bulk job ${status.status}.`, { jobId: status.id, error: status.error });
                        dispatch({ type: 'UPDATE_BULK_JOB_STATUS', payload: { jobId: status.id, status: status.error || 'Failed' } });
                    } else {
                        log('info', 'Bulk job status updated.', { jobId: status.id, status: status.status });
                        dispatch({ type: 'UPDATE_BULK_JOB_STATUS', payload: { jobId: status.id, status: status.status } });
                    }
                }
            }
            if (needsHistoryRefresh) {
                log('info', 'A bulk job completed. Displayed history page might need manual refresh if relevant.');
                // Optionally auto-refresh current history page: await fetchData(historyPage, 'history');
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown polling error';
            log('error', 'Failed to poll bulk job statuses.', { error });
            // Potentially update all pending jobs with an error status if it's a server issue
        }
    }, [state.bulkUploadResults, dispatch]); // Removed historyPage from dependencies

    // Start/Stop polling based on pending bulk jobs
    useEffect(() => {
        const pendingJobs = bulkUploadResults.some(r => r.jobId && !r.data && !getIsActualError(r));
        if (pendingJobs && !pollingIntervalRef.current) {
            log('info', 'Pending bulk jobs detected, starting poller.');
            pollingIntervalRef.current = window.setInterval(pollJobStatuses, POLLING_INTERVAL_MS);
        } else if (!pendingJobs && pollingIntervalRef.current) {
            log('info', 'No pending bulk jobs. Stopping poller.');
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        // Cleanup interval on unmount
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };
    }, [bulkUploadResults, pollJobStatuses]);

    // --- CRUD and Data Management Handlers ---

    const handleBulkAnalyze = async (files: File[]) => {
        if (files.length === 0) return;
        log('info', 'Starting bulk analysis.', { fileCount: files.length });
        dispatch({ type: 'ACTION_START', payload: 'isBulkLoading' });

        const initialResults: DisplayableAnalysisResult[] = files.map(f => ({
            fileName: f.name, data: null, error: 'Submitting', file: f, submittedAt: Date.now()
        }));
        dispatch({ type: 'SET_BULK_UPLOAD_RESULTS', payload: initialResults }); // Clear previous and set new ones

        try {
            // Fetch current systems to pass to the backend for potential duplicate checks/matching
            const currentSystems = await getRegisteredSystems(1, 1000).then(res => res.items); // Fetch up to 1000 systems
            const jobCreationResults = await analyzeBmsScreenshots(files, currentSystems);
            log('info', 'Received bulk job creation results from service.', { results: jobCreationResults });

            const historyMap = new Map(historyCache.map(r => [r.id, r])); // Use cache for duplicates

            // Update results based on job creation response
            const updatedResults = initialResults.map(initial => {
                const job = jobCreationResults.find(jcr => jcr.fileName === initial.fileName);
                if (!job) return { ...initial, error: 'failed_submission' }; // Should not happen ideally

                if (job.status === 'duplicate_history' && job.duplicateRecordId) {
                    const originalRecord = historyMap.get(job.duplicateRecordId);
                    return {
                        ...initial,
                        isDuplicate: true,
                        isBatchDuplicate: false,
                        data: originalRecord?.analysis || null,
                        weather: originalRecord?.weather,
                        recordId: originalRecord?.id,
                        error: null, // Clear 'submitting' status
                    };
                }
                 if (job.status === 'duplicate_batch') {
                    return { ...initial, isDuplicate: true, isBatchDuplicate: true, error: null };
                }
                return { ...initial, jobId: job.jobId, error: job.status };
            });

            dispatch({ type: 'SET_BULK_UPLOAD_RESULTS', payload: updatedResults });
            // Polling will start automatically via useEffect

        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed during bulk analysis submission.";
            log('error', 'Bulk analysis submission failed.', { error });
            if (error.includes('Too Many Requests')) {
                setShowRateLimitWarning(true);
            }
            dispatch({ type: 'SET_ERROR', payload: error });
            // Mark all submitted files as failed
            dispatch({ type: 'SET_BULK_UPLOAD_RESULTS', payload: initialResults.map(r => ({ ...r, error: 'failed_submission' })) });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isBulkLoading' });
        }
    };

    const handleMergeSystems = async () => {
        if (!primarySystemId || selectedSystemIds.length < 2) return;
        log('info', 'Starting system merge.', { primarySystemId, count: selectedSystemIds.length });
        dispatch({ type: 'ACTION_START', payload: 'isMerging' });
        try {
            await mergeBmsSystems(primarySystemId, selectedSystemIds);
            log('info', 'System merge successful.');
            dispatch({ type: 'MERGE_SYSTEMS_SUCCESS' });
            await fetchData(1, 'systems'); // Refresh first page of systems
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to merge systems.";
            log('error', 'System merge failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isMerging' });
        }
    };

    const handleDeleteRecord = async (recordId: string) => {
        if (!window.confirm(`Are you sure you want to delete history record ${recordId}?`)) return;
        log('info', 'Deleting history record.', { recordId });
        dispatch({ type: 'ACTION_START', payload: 'deletingRecordId', recordId }); // Pass recordId if needed
        try {
            await deleteAnalysisRecord(recordId);
            log('info', 'History record deleted successfully.', { recordId });
            await fetchData(historyPage, 'history'); // Refresh current history page
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to delete record.";
            log('error', 'Failed to delete history record.', { recordId, error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'deletingRecordId' });
        }
    };

    const handleLinkRecord = async (record: AnalysisRecord) => {
        const systemId = state.linkSelections[record.id];
        if (!systemId) return;
        log('info', 'Linking record to system.', { recordId: record.id, systemId });
        dispatch({ type: 'ACTION_START', payload: 'linkingRecordId', recordId: record.id }); // Pass recordId if needed

        try {
            if (systemId === '--create-new--') {
                if (record.dlNumber) {
                    // Open register modal (handled by dispatch in reducer/component)
                    dispatch({ type: 'OPEN_REGISTER_MODAL', payload: { dlNumber: record.dlNumber } });
                } else {
                    throw new Error("Cannot create new system without a DL number in the record.");
                }
            } else {
                await linkAnalysisToSystem(record.id, systemId, record.dlNumber);
                log('info', 'Link successful.');
                await fetchData(historyPage, 'history'); // Refresh history
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to link record.";
            log('error', 'Failed to link record.', { recordId: record.id, systemId, error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'linkingRecordId' });
        }
    };

    const handleSaveSystem = async (updatedData: Omit<BmsSystem, 'id'>) => {
        if (!editingSystem) return;
        log('info', 'Saving system edits.', { systemId: editingSystem.id });
        dispatch({ type: 'ACTION_START', payload: 'isSaving' });
        try {
            await updateBmsSystem(editingSystem.id, updatedData);
            log('info', 'System saved successfully.');
            dispatch({ type: 'SET_EDITING_SYSTEM', payload: null });
            await fetchData(systemsPage, 'systems'); // Refresh current systems page
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to save system.";
            log('error', 'Failed to save system.', { systemId: editingSystem.id, error });
            dispatch({ type: 'SET_ERROR', payload: error }); // Keep modal open on error
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isSaving' });
        }
    };

    // --- Data Management Handlers ---

    const handleGenericAction = async (
        actionName: keyof AdminState['actionStatus'],
        actionFn: () => Promise<any>,
        successMessage: string,
        refreshType: 'systems' | 'history' | 'all' | 'none' = 'none',
        options: { requiresConfirm?: boolean; confirmMessage?: string } = {}
    ) => {
        if (options.requiresConfirm && !window.confirm(options.confirmMessage || `Are you sure you want to perform the action: ${actionName}?`)) {
            return;
        }
        log('info', `Starting action: ${actionName}.`);
        dispatch({ type: 'ACTION_START', payload: actionName });
        try {
            const result = await actionFn();
            log('info', `${actionName} completed successfully.`, { result });
            // Maybe show a toast/notification here instead of just logging
            if (refreshType !== 'none') {
                const pageToRefresh = refreshType === 'systems' ? systemsPage : historyPage;
                await fetchData(pageToRefresh, refreshType);
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : `Failed to execute action: ${actionName}.`;
            log('error', `${actionName} failed.`, { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: actionName });
        }
    };

    const handleScanForDuplicates = async () => {
        await handleGenericAction('isScanning', findDuplicateAnalysisSets, 'Scan complete.', 'none');
        // Need to update state with results
        dispatch({ type: 'ACTION_START', payload: 'isScanning' });
        try {
            const sets = await findDuplicateAnalysisSets();
            dispatch({ type: 'SCAN_DUPLICATES_SUCCESS', payload: sets });
        } catch (err) {
             const error = err instanceof Error ? err.message : `Failed to scan for duplicates.`;
             dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
             dispatch({ type: 'ACTION_END', payload: 'isScanning' });
        }
    };

    const handleConfirmDeletion = async () => {
        const idsToDelete = duplicateSets.flatMap(set => set.slice(1).map(record => record.id));
        await handleGenericAction(
            'isConfirmingDeletion',
            () => deleteAnalysisRecords(idsToDelete),
            'Duplicates deleted.',
            'history',
             { requiresConfirm: false } // Confirmation is implicit here
        );
         dispatch({ type: 'DELETE_DUPLICATES_SUCCESS' }); // Clear sets from state
    };

    const handleDeleteUnlinked = () => handleGenericAction(
        'isDeletingUnlinked',
        deleteUnlinkedAnalysisHistory,
        'Unlinked records deleted.',
        'history',
        { requiresConfirm: true, confirmMessage: 'Are you sure you want to delete ALL history records not linked to a system? This is irreversible.' }
    );

    const handleClearAllData = () => handleGenericAction(
        'isClearingAll',
        clearAllData,
        'All application data cleared.',
        'all',
        { requiresConfirm: false } // Confirmation handled by input field
    );

     const handleClearHistory = () => handleGenericAction(
        'isClearingHistory',
        clearHistoryStore,
        'History store cleared.',
        'history',
        { requiresConfirm: true, confirmMessage: 'Are you sure you want to clear ONLY the analysis history store? This is irreversible.' }
    );

    const handleBackfillWeather = () => handleGenericAction(
        'isBackfilling',
        backfillWeatherData,
        'Weather backfill process started.',
        'history' // Refresh history to potentially show new weather data
    );

    const handleCleanupLinks = () => handleGenericAction(
        'isCleaningLinks',
        cleanupLinks,
        'Link cleanup process started.',
        'history'
    );

    const handleAutoAssociate = () => handleGenericAction(
        'isAutoAssociating',
        autoAssociateRecords,
        'Auto-association process started.',
        'history'
    );

     const handleFixPowerSigns = () => handleGenericAction(
        'isFixingPowerSigns',
        fixPowerSigns,
        'Fix power signs process started.',
        'history'
    );

    const handleCleanupCompletedJobs = async () => {
        log('info', 'Starting cleanup of completed job blobs.');
        dispatch({ type: 'ACTION_START', payload: 'isCleaningJobs' });
        setCleanupProgress('Starting...');
        try {
            let nextCursor: string | null = null;
            let totalCleaned = 0;
            do {
                const result = await cleanupCompletedJobs(nextCursor || undefined);
                totalCleaned += result.cleanedCount;
                nextCursor = result.nextCursor;
                setCleanupProgress(`Cleaned ${totalCleaned} jobs...`);
                log('debug', 'Job cleanup batch complete.', { cleaned: result.cleanedCount, next: nextCursor });
            } while (nextCursor);
            log('info', 'Completed job blob cleanup.', { totalCleaned });
            setCleanupProgress(null);
            // No data refresh needed for this action
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to clean up job blobs.';
            log('error', 'Job blob cleanup failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
            setCleanupProgress('Error!');
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isCleaningJobs' });
            // Optionally clear progress message after a delay
            setTimeout(() => setCleanupProgress(null), 3000);
        }
    };


    // --- Rendering ---

    const sortedHistoryForTable = useMemo(() => {
        // Client-side sorting for the current page
        return [...history].sort((a, b) => {
            const valA = getNestedValue(a, historySortKey);
            const valB = getNestedValue(b, historySortKey);

            // Handle potential null/undefined values for sorting robustness
            if (valA == null && valB == null) return 0;
            if (valA == null) return 1; // Put nulls/undefined last
            if (valB == null) return -1;

            // Handle date strings specifically for correct chronological sort
            if (historySortKey === 'timestamp' && typeof valA === 'string' && typeof valB === 'string') {
                const dateA = new Date(valA).getTime();
                const dateB = new Date(valB).getTime();
                 if (dateA < dateB) return historySortDirection === 'asc' ? -1 : 1;
                 if (dateA > dateB) return historySortDirection === 'asc' ? 1 : -1;
                 return 0;
            }

            // Standard comparison for other types
            if (valA < valB) return historySortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return historySortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [history, historySortKey, historySortDirection]);

    return (
        <div className="bg-neutral-dark min-h-screen text-neutral-light p-4 sm:p-6 md:p-8">
            <AdminHeader user={user} onLogout={onLogout} />

            {state.error && (
                <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-md text-red-300 flex justify-between items-center">
                    <span>Error: {state.error}</span>
                    <button onClick={() => dispatch({ type: 'SET_ERROR', payload: null })} className="text-xl font-bold">&times;</button>
                </div>
            )}


            <main className="space-y-12">
                 <section>
                    <BulkUpload
                        onAnalyze={handleBulkAnalyze}
                        results={bulkUploadResults}
                        isLoading={actionStatus.isBulkLoading}
                        showRateLimitWarning={showRateLimitWarning}
                        dispatch={dispatch}
                    />
                </section>

                <section>
                    <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">
                        Historical Analysis
                        {state.isCacheBuilding && <span className="text-sm font-normal text-gray-400 ml-4"> (Building full chart data: {historyCache.length} records loaded...)</span>}
                    </h2>
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        {loading && historyCache.length === 0 ? (
                             <div className="flex items-center justify-center h-full text-gray-400 min-h-[600px]"><SpinnerIcon className="w-8 h-8 text-secondary"/> <span className="ml-4">Loading Initial Chart Data...</span></div>
                        ) : historyCache.length > 0 || !state.isCacheBuilding ? (
                             <HistoricalChart systems={systems} history={historyCache} />
                        ): (
                            <div className="flex items-center justify-center h-full text-gray-400 min-h-[600px]"><SpinnerIcon className="w-8 h-8 text-secondary"/> <span className="ml-4">Loading historical data for chart...</span></div>
                        )}
                    </div>
                </section>

                {loading && systems.length === 0 && history.length === 0 ? (
                    <div className="text-center text-lg flex items-center justify-center min-h-[200px]">
                        <SpinnerIcon className="w-6 h-6 mr-2"/> Loading data...
                    </div>
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
                            onDeleteUnlinked={handleDeleteUnlinked}
                            onClearAllData={handleClearAllData}
                            onClearHistory={handleClearHistory}
                            onBackfillWeather={handleBackfillWeather}
                            onCleanupLinks={handleCleanupLinks}
                            onAutoAssociate={handleAutoAssociate}
                            onCleanupCompletedJobs={handleCleanupCompletedJobs}
                            cleanupProgress={cleanupProgress}
                            onFixPowerSigns={handleFixPowerSigns}
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
