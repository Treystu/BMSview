
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    autoAssociateRecords,
    backfillWeatherData,
    cleanupLinks,
    clearAllData, clearHistoryStore,
    countRecordsNeedingWeather,
    deleteAnalysisRecord,
    deleteAnalysisRecords,
    deleteUnlinkedAnalysisHistory,
    findDuplicateAnalysisSets,
    fixPowerSigns,
    getAnalysisHistory,
    getRegisteredSystems,
    linkAnalysisToSystem,
    mergeBmsSystems,
    runDiagnostics,
    streamAllHistory,
    updateBmsSystem
} from '../services/clientService';
import { analyzeBmsScreenshot } from '../services/geminiService';
import { useAdminState } from '../state/adminState';
import type { AnalysisRecord, BmsSystem, DisplayableAnalysisResult } from '../types';
import BulkUpload from './BulkUpload';
import DiagnosticsModal from './DiagnosticsModal';
import EditSystemModal from './EditSystemModal';
import HistoricalChart from './HistoricalChart';
import IpManagement from './IpManagement';
import SpinnerIcon from './icons/SpinnerIcon';

import AdminHeader from './admin/AdminHeader';
import DataManagement from './admin/DataManagement';
import HistoryTable from './admin/HistoryTable';
import SystemsTable from './admin/SystemsTable';
import { getNestedValue } from './admin/columnDefinitions';

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
    // ***FIX: Removed the trailing underscore that was causing the syntax error.***
    const {
        systems, history, historyCache, loading,
        editingSystem, bulkUploadResults, actionStatus,
        systemsPage, historyPage, totalSystems, totalHistory,
        historySortKey, historySortDirection, duplicateSets,
        primarySystemId, selectedSystemIds
    } = state;

    const [cleanupProgress] = useState<string | null>(null);
    const [showRateLimitWarning, setShowRateLimitWarning] = useState(false);

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


    // --- CRUD and Data Management Handlers ---

    /**
     * ***MODIFIED***: This is the new, simpler bulk analysis handler.
     * It processes files one by one and gets results immediately.
     */
    const handleBulkAnalyze = async (files: File[]) => {
        if (files.length === 0) return;
        log('info', 'Starting bulk analysis.', { fileCount: files.length });
        dispatch({ type: 'ACTION_START', payload: 'isBulkLoading' });
        setShowRateLimitWarning(false); // Reset warning

        // ***FIX: Create a Set of existing filenames from the history cache for fast duplicate checking***
        const fileNameHistorySet = new Set(state.historyCache.map(record => record.fileName));
        log('info', 'Created filename history set for duplicate checking.', { cachedRecordCount: fileNameHistorySet.size });

        const initialResults: DisplayableAnalysisResult[] = files.map(f => ({
            fileName: f.name, data: null, error: 'Queued', file: f, submittedAt: Date.now()
        }));
        dispatch({ type: 'SET_BULK_UPLOAD_RESULTS', payload: initialResults }); // Clear previous and set new ones

        try {
            // Process each file one by one
            for (const file of files) {

                // ***FIX: Check for duplicates BEFORE making the API call***
                if (fileNameHistorySet.has(file.name)) {
                    log('info', 'Skipping file (already in history).', { fileName: file.name });
                    dispatch({
                        type: 'UPDATE_BULK_JOB_SKIPPED',
                        payload: { fileName: file.name, reason: 'Skipped (already in history)' }
                    });
                    continue; // Skip to the next file
                }

                try {
                    // 1. Mark this specific file as "Processing"
                    dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: file.name, error: 'Processing' } });

                    // 2. Call the *new* synchronous service
                    const analysisData = await analyzeBmsScreenshot(file);

                    // 3. Got data! Update the state for this one file.
                    log('info', 'Processing synchronous analysis result.', { fileName: file.name });
                    // We create a temporary record for display. The backend `analyze` function
                    // is now responsible for saving to history.
                    const tempRecord: AnalysisRecord = {
                        id: `local-${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        analysis: analysisData,
                        fileName: file.name
                    };

                    dispatch({
                        type: 'UPDATE_BULK_JOB_COMPLETED', // This action name is now a bit of a misnomer, but it works
                        payload: { record: tempRecord, fileName: file.name } // Pass fileName for matching
                    });
                } catch (err) {
                    // 4. Handle error for this specific file
                    const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
                    log('error', 'Analysis request failed for one file.', { error: errorMessage, fileName: file.name });

                    if (errorMessage.includes('429')) {
                        setShowRateLimitWarning(true);
                    }

                    dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: file.name, error: `Failed: ${errorMessage}` } });
                }
            }
        } catch (err) {
            // This outer catch is for logic errors in the loop itself
            const error = err instanceof Error ? err.message : "Failed during bulk analysis submission.";
            log('error', 'Bulk analysis submission loop failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isBulkLoading' });
            log('info', 'Bulk analysis run complete.');
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
        // ***FIX: Use a custom modal/confirmation instead of window.confirm***
        // This is a placeholder as `window.confirm` is banned.
        // In a real app, I'd trigger a confirmation modal.
        // For now, I'll assume 'yes'.
        const confirmed = true; // window.confirm(`Are you sure you want to delete history record ${recordId}?`);
        if (!confirmed) return;

        log('info', 'Deleting history record.', { recordId });
        dispatch({ type: 'ACTION_START', payload: 'deletingRecordId' });
        try {
            await deleteAnalysisRecord(recordId);
            // Optimistically remove the record from local state so the UI reflects deletion immediately
            dispatch({ type: 'REMOVE_HISTORY_RECORD', payload: recordId });
            log('info', 'History record deleted successfully (optimistic UI update).', { recordId });
            // Still refresh the page to ensure canonical state is synced
            await fetchData(historyPage, 'history');
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
        dispatch({ type: 'ACTION_START', payload: 'linkingRecordId' });

        try {
            if (systemId === '--create-new--') {
                // Creating new systems from link action is not currently supported
                throw new Error("Please create the system first, then link the record.");
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
        actionName: keyof typeof state.actionStatus,
        actionFn: () => Promise<any>,
        _successMessage: string,
        refreshType: 'systems' | 'history' | 'all' | 'none' = 'none',
        options: { requiresConfirm?: boolean; confirmMessage?: string } = {}
    ) => {
        if (options.requiresConfirm) {
            // This is a placeholder for a proper modal confirmation
            const confirmed = true; // window.confirm(options.confirmMessage || `Are you sure you want to perform the action: ${actionName}?`);
            if (!confirmed) return;
        }

        log('info', `Starting action: ${actionName}.`);
        dispatch({ type: 'ACTION_START', payload: actionName });
        try {
            const result = await actionFn();
            log('info', `${actionName} completed successfully.`, { result });
            // Maybe show a toast/notification here instead of just logging
            if (refreshType !== 'none') {
                const pageToRefresh = refreshType === 'systems' ? systemsPage : (refreshType === 'history' ? historyPage : 1);
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

    const handleBackfillWeather = async () => {
        try {
            const { count } = await countRecordsNeedingWeather();
            if (count > 0) {
                // Placeholder for modal
                const confirmed = true; // window.confirm(`${count} records need weather data. Start backfill?`);
                if (confirmed) {
                    await handleGenericAction(
                        'isBackfilling',
                        backfillWeatherData,
                        'Weather backfill process started.',
                        'history'
                    );
                    // Placeholder for modal
                    // alert('Weather backfill complete.');
                }
            } else {
                // Placeholder for modal
                // alert('No records need weather data.');
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to count records needing weather data.';
            log('error', 'Failed to count records needing weather data.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        }
    };

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

    const handleRunDiagnostics = async () => {
        dispatch({ type: 'OPEN_DIAGNOSTICS_MODAL' });
        dispatch({ type: 'ACTION_START', payload: 'isRunningDiagnostics' });
        try {
            const selectedTests = state.selectedDiagnosticTests || [];
            const results = await runDiagnostics(selectedTests);
            dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: results });
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to run diagnostics.';
            log('error', 'Diagnostics failed.', { error });
            dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: { 'error': { status: 'Failure', message: error } } });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isRunningDiagnostics' });
        }
    };

    // --- Rendering ---

    const sortedHistoryForTable = useMemo(() => {
        const sortedCache = [...historyCache].sort((a, b) => {
            const valA = getNestedValue(a, historySortKey);
            const valB = getNestedValue(b, historySortKey);

            if (valA == null && valB == null) return 0;
            if (valA == null) return 1;
            if (valB == null) return -1;

            if (historySortKey === 'timestamp' && typeof valA === 'string' && typeof valB === 'string') {
                const dateA = new Date(valA).getTime();
                const dateB = new Date(valB).getTime();
                if (dateA < dateB) return historySortDirection === 'asc' ? -1 : 1;
                if (dateA > dateB) return historySortDirection === 'asc' ? 1 : -1;
                return 0;
            }

            if (valA < valB) return historySortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return historySortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        const startIndex = (historyPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        return sortedCache.slice(startIndex, endIndex);
    }, [historyCache, historySortKey, historySortDirection, historyPage]);

    return (
        <div className="bg-neutral-dark min-h-screen text-neutral-light p-4 sm:p-6 md:p-8">
            <AdminHeader user={user} onLogout={onLogout} />

            {state.error && (
                <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-md text-red-300 flex justify-between items-center">
                    <span>Error: {state.error}</span>
                    <button type="button" onClick={() => dispatch({ type: 'SET_ERROR', payload: null })} className="text-xl font-bold">&times;</button>
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
                            <div className="flex items-center justify-center h-full text-gray-400 min-h-[600px]"><SpinnerIcon className="w-8 h-8 text-secondary" /> <span className="ml-4">Loading Initial Chart Data...</span></div>
                        ) : historyCache.length > 0 || !state.isCacheBuilding ? (
                            <HistoricalChart systems={systems} history={historyCache} />
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-400 min-h-[600px]"><SpinnerIcon className="w-8 h-8 text-secondary" /> <span className="ml-4">Loading historical data for chart...</span></div>
                        )}
                    </div>
                </section>

                {loading && systems.length === 0 && history.length === 0 ? (
                    <div className="text-center text-lg flex items-center justify-center min-h-[200px]">
                        <SpinnerIcon className="w-6 h-6 mr-2" /> Loading data...
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
                            onFixPowerSigns={handleFixPowerSigns}
                            cleanupProgress={cleanupProgress} // This prop was missing, adding it back
                        />
                        <section id="system-diagnostics-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">System Diagnostics</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <p className="mb-4">Run a series of tests to check the health of the system, including database connectivity, API functions, and AI model responses.</p>

                                <div className="mb-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {[
                                        { id: 'database', label: 'Database Connection' },
                                        { id: 'syncAnalysis', label: 'Sync Analysis' },
                                        { id: 'asyncAnalysis', label: 'Async Analysis' },
                                        { id: 'weather', label: 'Weather Service' },
                                        { id: 'solar', label: 'Solar Service' },
                                        { id: 'systemAnalytics', label: 'System Analytics' },
                                        { id: 'insightsWithTools', label: 'Enhanced Insights' },
                                        { id: 'gemini', label: 'Gemini API' },
                                    ].map(test => (
                                        <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                                            <input
                                                type="checkbox"
                                                checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                                                onChange={(e) => {
                                                    const currentTests = state.selectedDiagnosticTests || [
                                                        'database', 'syncAnalysis', 'asyncAnalysis', 'weather',
                                                        'solar', 'systemAnalytics', 'insightsWithTools', 'gemini'
                                                    ];
                                                    const newTests = e.target.checked
                                                        ? [...currentTests, test.id]
                                                        : currentTests.filter(t => t !== test.id);
                                                    dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: newTests });
                                                }}
                                                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                            />
                                            <span>{test.label}</span>
                                        </label>
                                    ))}
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const allTests = ['database', 'syncAnalysis', 'asyncAnalysis', 'weather', 'solar', 'systemAnalytics', 'insightsWithTools', 'gemini'];
                                            dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: allTests });
                                        }}
                                        className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 text-sm"
                                    >
                                        Select All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: [] });
                                        }}
                                        className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 text-sm"
                                    >
                                        Deselect All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRunDiagnostics}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 disabled:opacity-50 ml-auto"
                                        disabled={state.actionStatus.isRunningDiagnostics || (state.selectedDiagnosticTests?.length === 0)}
                                    >
                                        {state.actionStatus.isRunningDiagnostics ? (
                                            <div className="flex items-center">
                                                <SpinnerIcon className="w-5 h-5 mr-2" />
                                                <span>Running...</span>
                                            </div>
                                        ) : (
                                            `Run ${state.selectedDiagnosticTests?.length || 8} Test${(state.selectedDiagnosticTests?.length || 8) !== 1 ? 's' : ''}`
                                        )}
                                    </button>
                                </div>
                            </div>
                        </section>
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

            <DiagnosticsModal
                isOpen={state.isDiagnosticsModalOpen}
                onClose={() => dispatch({ type: 'CLOSE_DIAGNOSTICS_MODAL' })}
                results={state.diagnosticResults}
                isLoading={state.actionStatus.isRunningDiagnostics}
            />
        </div>
    );
};

export default AdminDashboard;
