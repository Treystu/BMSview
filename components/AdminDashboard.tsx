
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    autoAssociateRecords,
    backfillWeatherData,
    backfillHourlyCloudData,
    cleanupLinks,
    clearAllData, clearHistoryStore,
    countRecordsNeedingWeather,
    createAnalysisStory,
    deleteAnalysisRecord,
    deleteAnalysisRecords,
    deleteUnlinkedAnalysisHistory,
    findDuplicateAnalysisSets,
    fixPowerSigns,
    getAnalysisHistory,
    getRegisteredSystems,
    getDiagnosticProgress,
    linkAnalysisToSystem,
    mergeBmsSystems,
    registerBmsSystem,
    runDiagnostics,
    runSingleDiagnosticTest,
    streamAllHistory,
    updateBmsSystem
} from '../services/clientService';
import { analyzeBmsScreenshot, checkFileDuplicate } from '../services/geminiService';
import { useAdminState } from '../state/adminState';
import type { AnalysisRecord, BmsSystem, DisplayableAnalysisResult } from '../types';
import BulkUpload from './BulkUpload';
import DiagnosticsModal from './DiagnosticsModal';
import EditSystemModal from './EditSystemModal';
import HistoricalChart from './HistoricalChart';
import IpManagement from './IpManagement';
import SpinnerIcon from './icons/SpinnerIcon';

import AdminHeader from './admin/AdminHeader';
import AdminStoryManager from './admin/AdminStoryManager';
import DataManagement from './admin/DataManagement';
import HistoryTable from './admin/HistoryTable';
import SystemsTable from './admin/SystemsTable';
import ReconciliationDashboard from './admin/reconciliation/ReconciliationDashboard';
import MonitoringDashboard from './admin/MonitoringDashboard';
import { getNestedValue } from './admin/columnDefinitions';
import { AIFeedbackDashboard } from './AIFeedbackDashboard';

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
        const [isStoryMode, setIsStoryMode] = useState(false);
        const [storyTitle, setStoryTitle] = useState('');
        const [storySummary, setStorySummary] = useState('');
        const [storyUserContext, setStoryUserContext] = useState('');
        const [confirmation, setConfirmation] = useState<{
            isOpen: boolean;
            message: string;
            onConfirm: () => void;
        }>({ isOpen: false, message: '', onConfirm: () => {} });

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
        log('info', 'Starting bulk analysis.', { fileCount: files.length, isStoryMode });

        if (isStoryMode) {
            try {
                dispatch({ type: 'ACTION_START', payload: 'isBulkLoading' });
                const story = await createAnalysisStory(storyTitle, storySummary, files, storyUserContext || undefined);
                log('info', 'Story analysis complete.', { storyId: story.id });
                // We could update some state here to show the story was created.
                // For now, we'll just clear the form.
                setStoryTitle('');
                setStorySummary('');
                setStoryUserContext('');
                // Maybe clear the files in BulkUpload component state via a callback?
            } catch (err) {
                const error = err instanceof Error ? err.message : "Failed to create story.";
                log('error', 'Story mode analysis failed.', { error });
                dispatch({ type: 'SET_ERROR', payload: error });
            } finally {
                dispatch({ type: 'ACTION_END', payload: 'isBulkLoading' });
            }
            return;
        }

        dispatch({ type: 'ACTION_START', payload: 'isBulkLoading' });
        setShowRateLimitWarning(false); // Reset warning

        // ***ISSUE 4 FIX: Warn if cache is still building***
        if (state.isCacheBuilding) {
            log('warn', 'Duplicate check may be incomplete - history cache still building.', { 
                cachedRecordCount: state.historyCache.length 
            });
        }

        const initialResults: DisplayableAnalysisResult[] = files.map(f => ({
            fileName: f.name, data: null, error: 'Checking for duplicates...', file: f, submittedAt: Date.now()
        }));
        dispatch({ type: 'SET_BULK_UPLOAD_RESULTS', payload: initialResults });

        try {
            // ***PHASE 1: Check ALL files for duplicates upfront***
            log('info', 'Phase 1: Checking all files for duplicates upfront.', { fileCount: files.length });
            
            const duplicateCheckResults = await Promise.all(
                files.map(async (file) => {
                    try {
                        const result = await checkFileDuplicate(file);
                        return { file, ...result };
                    } catch (err) {
                        log('warn', 'Duplicate check failed for file, will analyze anyway.', { fileName: file.name });
                        return { file, isDuplicate: false };
                    }
                })
            );

            // Separate duplicates from files to analyze
            const duplicates = duplicateCheckResults.filter(r => r.isDuplicate);
            const filesToAnalyze = duplicateCheckResults.filter(r => !r.isDuplicate);

            log('info', 'Duplicate check complete.', { 
                totalFiles: files.length,
                duplicates: duplicates.length,
                toAnalyze: filesToAnalyze.length
            });

            // Mark all duplicates as skipped immediately
            for (const dup of duplicates) {
                dispatch({
                    type: 'UPDATE_BULK_JOB_SKIPPED',
                    payload: { 
                        fileName: dup.file.name, 
                        reason: 'Duplicate content detected (same image)' 
                    }
                });
            }

            // Update remaining files to "Queued" status
            for (const item of filesToAnalyze) {
                dispatch({ 
                    type: 'UPDATE_BULK_UPLOAD_RESULT', 
                    payload: { fileName: item.file.name, error: 'Queued' } 
                });
            }

            // ***PHASE 2: Analyze non-duplicate files***
            log('info', 'Phase 2: Starting analysis of non-duplicate files.', { count: filesToAnalyze.length });
            
            let retryCount = 0;
            for (const item of filesToAnalyze) {
                const file = item.file;
                try {
                    // 1. Mark this specific file as "Processing"
                    dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: file.name, error: 'Processing' } });

                    // 2. Call the synchronous service
                    const analysisData = await analyzeBmsScreenshot(file);

                    // 3. Got data! Create record with real backend ID
                    log('info', 'Processing synchronous analysis result.', { fileName: file.name });

                    // ***ISSUE 1 FIX: Use real record ID from backend instead of temporary ID***
                    const tempRecord: AnalysisRecord = {
                        id: analysisData._recordId || `local-${Date.now()}`,
                        timestamp: analysisData._timestamp || new Date().toISOString(),
                        analysis: analysisData,
                        fileName: file.name
                    };

                    dispatch({
                        type: 'UPDATE_BULK_JOB_COMPLETED',
                        payload: { record: tempRecord, fileName: file.name }
                    });
                    
                    // Reset retry count on success
                    retryCount = 0;
                } catch (err) {
                    // 4. Handle error for this specific file
                    const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
                    log('error', 'Analysis request failed for one file.', { error: errorMessage, fileName: file.name });

                    // ***ISSUE 5 FIX: Add exponential backoff for rate limit errors***
                    if (errorMessage.includes('429')) {
                        setShowRateLimitWarning(true);
                        retryCount++;
                        const backoffMs = Math.min(2000 * Math.pow(2, retryCount - 1), 30000); // Max 30 seconds
                        log('warn', 'Rate limit detected, applying exponential backoff.', { 
                            retryCount, 
                            backoffMs,
                            fileName: file.name 
                        });
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
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
            setConfirmation({
                isOpen: true,
                message: `Are you sure you want to delete history record ${recordId}?`,
                onConfirm: async () => {
                    log('info', 'Deleting history record.', { recordId });
                    dispatch({ type: 'ACTION_START', payload: 'deletingRecordId' });
                    try {
                        await deleteAnalysisRecord(recordId);
                        dispatch({ type: 'REMOVE_HISTORY_RECORD', payload: recordId });
                        log('info', 'History record deleted successfully (optimistic UI update).', { recordId });
                        await fetchData(historyPage, 'history');
                    } catch (err) {
                        const error = err instanceof Error ? err.message : "Failed to delete record.";
                        log('error', 'Failed to delete history record.', { recordId, error });
                        dispatch({ type: 'SET_ERROR', payload: error });
                    } finally {
                        dispatch({ type: 'ACTION_END', payload: 'deletingRecordId' });
                        setConfirmation({ isOpen: false, message: '', onConfirm: () => {} });
                    }
                }
            });
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
                    setConfirmation({
                        isOpen: true,
                        message: options.confirmMessage || `Are you sure you want to perform the action: ${actionName}?`,
                        onConfirm: async () => {
                            setConfirmation({ isOpen: false, message: '', onConfirm: () => {} });
                            await executeAction();
                        }
                    });
                } else {
                    await executeAction();
                }
        
                async function executeAction() {

        log('info', `Starting action: ${actionName}.`);
                dispatch({ type: 'ACTION_START', payload: actionName });
                try {
                    const result = await actionFn();
                    log('info', `${actionName} completed successfully.`, { result });
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
                const confirmed = window.confirm(`${count} records need weather data. This will process up to 50 records per run. Multiple runs may be needed. Continue?`);
                if (confirmed) {
                    dispatch({ type: 'ACTION_START', payload: 'isBackfilling' });
                    try {
                        const result = await backfillWeatherData();
                        log('info', 'Weather backfill completed.', { result });
                        
                        // Show result message to user
                        const message = result.message || `Processed ${result.processedCount || result.updatedCount} records. ${result.updatedCount} updated, ${result.errorCount || 0} errors.`;
                        alert(message + (result.completed === false ? '\n\nRun again to continue backfilling remaining records.' : ''));
                        
                        await fetchData(historyPage, 'history');
                    } catch (err) {
                        const error = err instanceof Error ? err.message : 'Failed to backfill weather data.';
                        log('error', 'Failed to backfill weather data.', { error });
                        dispatch({ type: 'SET_ERROR', payload: error });
                    } finally {
                        dispatch({ type: 'ACTION_END', payload: 'isBackfilling' });
                    }
                }
            } else {
                alert('No records need weather data.');
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to count records needing weather data.';
            log('error', 'Failed to count records needing weather data.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        }
    };

    const handleHourlyCloudBackfill = async () => {
        const confirmed = window.confirm('This will fetch hourly weather data for up to 10 days per run. Multiple runs may be needed for full history. This uses weather API calls. Continue?');
        if (confirmed) {
            dispatch({ type: 'ACTION_START', payload: 'isBackfillingHourlyCloud' });
            try {
                const result = await backfillHourlyCloudData();
                log('info', 'Hourly cloud backfill completed.', { result });
                
                // Show result message to user
                const message = result.message || `Processed ${result.processedDays} days. ${result.hoursInserted} hours inserted, ${result.errors} errors.`;
                alert(message + (result.completed === false ? '\n\nRun again to continue backfilling remaining days.' : ''));
                
                await fetchData(historyPage, 'history');
            } catch (err) {
                const error = err instanceof Error ? err.message : 'Failed to backfill hourly cloud data.';
                log('error', 'Failed to backfill hourly cloud data.', { error });
                dispatch({ type: 'SET_ERROR', payload: error });
            } finally {
                dispatch({ type: 'ACTION_END', payload: 'isBackfillingHourlyCloud' });
            }
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

    // All available diagnostic tests (matching backend implementation)
    // Dynamically define all available diagnostic tests by extracting from the UI sections
    // This ensures that any new tests added to the UI are automatically included in "Select All"
    const DIAGNOSTIC_TEST_SECTIONS = [
        // Infrastructure
        { id: 'database', label: 'Database Connection' },
        { id: 'gemini', label: 'Gemini API' },
        // Core Analysis
        { id: 'analyze', label: 'Analyze Endpoint' },
        { id: 'insightsWithTools', label: 'Insights with Tools' },
        { id: 'asyncAnalysis', label: 'Async Analysis' },
        // Data Management
        { id: 'history', label: 'History' },
        { id: 'systems', label: 'Systems' },
        { id: 'dataExport', label: 'Data Export' },
        { id: 'idempotency', label: 'Idempotency' },
        // External Services
        { id: 'weather', label: 'Weather Service' },
        { id: 'backfillWeather', label: 'Backfill Weather' },
        { id: 'backfillHourlyCloud', label: 'Backfill Hourly Cloud' },
        { id: 'solarEstimate', label: 'Solar Estimate' },
        { id: 'systemAnalytics', label: 'System Analytics' },
        { id: 'predictiveMaintenance', label: 'Predictive Maintenance' },
        // System Utilities
        { id: 'contentHashing', label: 'Content Hashing' },
        { id: 'errorHandling', label: 'Error Handling' },
        { id: 'logging', label: 'Logging System' },
        { id: 'retryMechanism', label: 'Retry Mechanism' },
        { id: 'timeout', label: 'Timeout Handling' },
    ];
    
    // Extract all test IDs from the sections
    const ALL_DIAGNOSTIC_TESTS = DIAGNOSTIC_TEST_SECTIONS.map(test => test.id);

    const handleTestToggle = (testId: string, checked: boolean) => {
        const currentTests = state.selectedDiagnosticTests || ALL_DIAGNOSTIC_TESTS;
        const newTests = checked
            ? [...currentTests, testId]
            : currentTests.filter(t => t !== testId);
        dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: newTests });
    };

    const handleRunDiagnostics = async () => {
        const selectedTests = state.selectedDiagnosticTests || ALL_DIAGNOSTIC_TESTS;
        
        log('info', 'Starting real-time parallel diagnostics', { 
            testCount: selectedTests.length,
            tests: selectedTests 
        });
        
        // Create initial stub results to show tests as "running" immediately
        const initialResults = {
            status: 'partial' as const,
            timestamp: new Date().toISOString(),
            duration: 0,
            results: selectedTests.map(testId => {
                const testConfig = DIAGNOSTIC_TEST_SECTIONS.find(t => t.id === testId);
                return {
                    name: testConfig?.label || testId,
                    status: 'running' as const,
                    duration: 0
                };
            }),
            summary: {
                total: selectedTests.length,
                success: 0,
                warnings: 0,
                errors: 0,
                partial: 0
            }
        };
        
        // Open modal with initial stub results (all tests showing as "running")
        dispatch({ type: 'OPEN_DIAGNOSTICS_MODAL' });
        dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: initialResults });
        dispatch({ type: 'ACTION_START', payload: 'isRunningDiagnostics' });
        
        const startTime = Date.now();
        
        try {
            // Run ALL tests in parallel, each with its own API call
            // This is the key change: instead of one monolithic call, fire multiple parallel requests
            const testPromises = selectedTests.map(async (testId) => {
                const testConfig = DIAGNOSTIC_TEST_SECTIONS.find(t => t.id === testId);
                const displayName = testConfig?.label || testId;
                
                log('info', `Starting test: ${testId}`, { displayName });
                
                try {
                    // Each test runs independently using the scope parameter
                    const result = await runSingleDiagnosticTest(testId);
                    
                    log('info', `Completed test: ${testId}`, { 
                        displayName,
                        status: result.status,
                        duration: result.duration 
                    });
                    
                    // Immediately update UI with this specific test result
                    dispatch({ 
                        type: 'UPDATE_SINGLE_DIAGNOSTIC_RESULT', 
                        payload: { testId, result }
                    });
                    
                    return result;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Test failed';
                    log('error', `Test failed: ${testId}`, { displayName, error: errorMessage });
                    
                    // Create error result for this test
                    const errorResult = {
                        name: displayName,
                        status: 'error' as const,
                        error: errorMessage,
                        duration: 0
                    };
                    
                    // Update UI with error immediately
                    dispatch({ 
                        type: 'UPDATE_SINGLE_DIAGNOSTIC_RESULT', 
                        payload: { testId, result: errorResult }
                    });
                    
                    return errorResult;
                }
            });
            
            // Wait for all tests to complete (they run in parallel)
            const allResults = await Promise.all(testPromises);
            
            // Calculate final summary
            const summary = {
                total: allResults.length,
                success: allResults.filter(r => r.status === 'success').length,
                partial: allResults.filter(r => r.status === 'partial').length,
                warnings: allResults.filter(r => r.status === 'warning').length,
                errors: allResults.filter(r => r.status === 'error').length
            };
            
            // Determine overall status
            const overallStatus = summary.errors > 0 || summary.warnings > 0 || summary.partial > 0 
                ? 'partial' as const 
                : 'success' as const;
            
            // Create final results object
            const finalResults = {
                status: overallStatus,
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                results: allResults,
                summary
            };
            
            // Update with final complete results
            dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: finalResults });
            
            log('info', 'All diagnostics completed', { 
                duration: finalResults.duration,
                total: summary.total,
                success: summary.success,
                errors: summary.errors,
                warnings: summary.warnings
            });
            
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to run diagnostics.';
            log('error', 'Diagnostics orchestration failed.', { error });
            
            // Create an error response object
            const errorResponse: any = {
                status: 'error',
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                results: selectedTests.map(testId => {
                    const testConfig = DIAGNOSTIC_TEST_SECTIONS.find(t => t.id === testId);
                    return {
                        name: testConfig?.label || testId,
                        status: 'error' as const,
                        error: 'Diagnostic orchestration failed',
                        duration: 0
                    };
                }),
                summary: {
                    total: selectedTests.length,
                    success: 0,
                    warnings: 0,
                    errors: selectedTests.length
                },
                error
            };
            dispatch({ type: 'SET_DIAGNOSTIC_RESULTS', payload: errorResponse });
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
                        isStoryMode={isStoryMode}
                        setIsStoryMode={setIsStoryMode}
                        storyTitle={storyTitle}
                        setStoryTitle={setStoryTitle}
                        storySummary={storySummary}
                        setStorySummary={setStorySummary}
                        storyUserContext={storyUserContext}
                        setStoryUserContext={setStoryUserContext}
                    />
                </section>

                <section id="stories-management-section">
                    <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">
                        📖 Stories Management
                    </h2>
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        <AdminStoryManager />
                    </div>
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
                        <section id="data-reconciliation-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">
                                Data Reconciliation & System Management
                            </h2>
                            <ReconciliationDashboard
                                systems={systems}
                                onSystemCreated={async () => {
                                    // Refresh systems list after creating a new system
                                    await fetchData(1, 'systems');
                                }}
                                onMergeRequested={async (systemIds: string[], primaryId: string) => {
                                    // Use existing merge handler
                                    dispatch({ type: 'SET_SELECTED_SYSTEM_IDS', payload: systemIds });
                                    dispatch({ type: 'SET_PRIMARY_SYSTEM_ID', payload: primaryId });
                                    await handleMergeSystems();
                                }}
                            />
                        </section>
                        <section id="ai-feedback-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">🤖 AI Feedback & Suggestions</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <AIFeedbackDashboard />
                            </div>
                        </section>
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
                            onHourlyCloudBackfill={handleHourlyCloudBackfill}
                            onCleanupLinks={handleCleanupLinks}
                            onAutoAssociate={handleAutoAssociate}
                            onFixPowerSigns={handleFixPowerSigns}
                            cleanupProgress={cleanupProgress} // This prop was missing, adding it back
                        />
                        <section id="monitoring-dashboard-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">AI Feedback Monitoring</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <MonitoringDashboard />
                            </div>
                        </section>
                        <section id="system-diagnostics-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">System Diagnostics</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <p className="mb-4">Run a series of tests to check the health of the system, including database connectivity, API functions, and AI model responses.</p>

                                <div className="mb-4">
                                    {/* Infrastructure Tests */}
                                    <div className="mb-3">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Infrastructure</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['database', 'gemini'].includes(t.id)).map(test => (
                                                <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                                                        onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span>{test.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Core Analysis Tests */}
                                    <div className="mb-3">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Core Analysis</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['analyze', 'insightsWithTools', 'asyncAnalysis'].includes(t.id)).map(test => (
                                                <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                                                        onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span>{test.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Data Management Tests */}
                                    <div className="mb-3">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Data Management</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['history', 'systems', 'dataExport', 'idempotency'].includes(t.id)).map(test => (
                                                <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                                                        onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span>{test.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* External Services Tests */}
                                    <div className="mb-3">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">External Services</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['weather', 'backfillWeather', 'backfillHourlyCloud', 'solarEstimate', 'systemAnalytics', 'predictiveMaintenance'].includes(t.id)).map(test => (
                                                <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                                                        onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span>{test.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* System Utilities Tests */}
                                    <div className="mb-3">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">System Utilities</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {DIAGNOSTIC_TEST_SECTIONS.filter(t => ['contentHashing', 'errorHandling', 'logging', 'retryMechanism', 'timeout'].includes(t.id)).map(test => (
                                                <label key={test.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-gray-700 p-2 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={state.selectedDiagnosticTests?.includes(test.id) ?? true}
                                                        onChange={(e) => handleTestToggle(test.id, e.target.checked)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span>{test.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            dispatch({ type: 'SET_SELECTED_DIAGNOSTIC_TESTS', payload: ALL_DIAGNOSTIC_TESTS });
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
                                            `Run ${state.selectedDiagnosticTests?.length || ALL_DIAGNOSTIC_TESTS.length} Test${(state.selectedDiagnosticTests?.length || ALL_DIAGNOSTIC_TESTS.length) !== 1 ? 's' : ''}`
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
                            selectedTests={state.selectedDiagnosticTests || ALL_DIAGNOSTIC_TESTS}
                        />
            
                        {confirmation.isOpen && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                                <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                                    <h2 className="text-lg font-bold mb-4">Confirm Action</h2>
                                    <p>{confirmation.message}</p>
                                    <div className="mt-6 flex justify-end gap-4">
                                        <button
                                            onClick={() => setConfirmation({ isOpen: false, message: '', onConfirm: () => {} })}
                                            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={confirmation.onConfirm}
                                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
                                        >
                                            Confirm
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            };

export default AdminDashboard;
