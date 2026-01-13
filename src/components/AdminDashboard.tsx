
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';
import {
    autoAssociateRecords,
    backfillHourlyCloudData,
    backfillWeatherData,
    cleanupLinks,
    clearAllData, clearHistoryStore,
    countRecordsNeedingWeather,
    createAnalysisStory,
    deleteAnalysisRecord,
    deleteAnalysisRecords,
    deleteBmsSystem,
    deleteUnlinkedAnalysisHistory,
    findDuplicateAnalysisSets,
    fixPowerSigns,
    getAnalysisHistory,
    getRegisteredSystems,
    linkAnalysisToSystem,
    mergeBmsSystems,
    normalizeIds,
    registerBmsSystem,
    runSingleDiagnosticTest,
    streamAllHistory,
    updateBmsSystem
} from '../services/clientService';
import { analyzeBmsScreenshot } from '../services/geminiService';
import { useAdminState } from '../state/adminState';
import type { AnalysisRecord, BmsSystem, DisplayableAnalysisResult } from '../types';
import { checkFilesForDuplicates, partitionCachedFiles, type CachedDuplicateResult, type DuplicateCheckResult } from '../utils/duplicateChecker';

import BulkUpload from './BulkUpload';
import DiagnosticsModal from './DiagnosticsModal';
import HistoricalChart from './HistoricalChart';
import IpManagement from './IpManagement';
import SpinnerIcon from './icons/SpinnerIcon';

import UploadOptimizer from '../utils/uploadOptimizer';
import { AIFeedbackDashboard } from './AIFeedbackDashboard';
import CostDashboard from './CostDashboard';
import { DiagnosticsGuru } from './DiagnosticsGuru';
import { SolarIntegrationDashboard } from './SolarIntegrationDashboard';
import AdminHeader from './admin/AdminHeader';
import AdminStoryManager from './admin/AdminStoryManager';
import AdminSystemsManager from './admin/AdminSystemsManager';
import DataManagement from './admin/DataManagement';
import FeedbackMonitoringDashboard from './admin/FeedbackMonitoringDashboard';
import HistoryTable from './admin/HistoryTable';
import SystemsTable from './admin/SystemsTable';
import { getNestedValue } from './admin/columnDefinitions';
import ReconciliationDashboard from './admin/reconciliation/ReconciliationDashboard';

import { SystemStatusWidget } from './admin/SystemStatusWidget';

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

const log = (level: string, message: string, context?: unknown) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'AdminDashboard',
        message,
        context
    }));
};

const ITEMS_PER_PAGE = 100;

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
    }>({ isOpen: false, message: '', onConfirm: () => { } });

    // Cache of ALL systems for dropdowns (independent of pagination)
    const [allSystems, setAllSystems] = useState<BmsSystem[]>([]);

    const [isCreatingSystem, setIsCreatingSystem] = useState(false);

    // Track job IDs from async analysis requests
    const [asyncJobIds, setAsyncJobIds] = useState<string[]>([]);

    // --- Data Fetching ---
    const fetchData = useCallback(async (page: number, type: 'systems' | 'history' | 'all', options: { forceRefresh?: boolean } = {}) => {
        log('info', 'Fetching admin page data.', { page, type, ...options });
        dispatch({ type: 'FETCH_PAGE_DATA_START' });
        try {
            const promises = [];
            if (type === 'all' || type === 'systems') {
                promises.push(getRegisteredSystems(page, ITEMS_PER_PAGE, options));
            }
            if (type === 'all' || type === 'history') {
                // Include sorting parameters when fetching history
                const historyOptions = {
                    ...options,
                    sortBy: state.historySortKey,
                    sortOrder: state.historySortDirection
                };
                promises.push(getAnalysisHistory(page, ITEMS_PER_PAGE, historyOptions));
            }

            const responses = await Promise.all(promises);

            const payload: {
                systems?: { items: BmsSystem[]; total: number };
                history?: { items: AnalysisRecord[]; total: number };
            } = {};

            if (type === 'all') {
                const [systemsResponse, historyResponse] = responses as [
                    { items: BmsSystem[]; total: number },
                    { items: AnalysisRecord[]; total: number }
                ];
                payload.systems = systemsResponse;
                payload.history = historyResponse;
            } else if (type === 'systems') {
                payload.systems = responses[0] as { items: BmsSystem[]; total: number };
            } else if (type === 'history') {
                payload.history = responses[0] as { items: AnalysisRecord[]; total: number };
            }

            dispatch({ type: 'FETCH_PAGE_DATA_SUCCESS', payload });

        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to load dashboard data.";
            log('error', 'Failed to fetch admin data.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        }
    }, [dispatch, state.historySortKey, state.historySortDirection]); // Added sort dependencies

    // --- Job Polling for Async Analysis ---
    const jobPollingConfig: {
        onComplete: (jobId: string, recordId: string) => Promise<void>;
        onError: (jobId: string, error: string) => void;
    } = {
        onComplete: useCallback(async (jobId: string, recordId: string) => {
            log('info', 'Async analysis job completed', { jobId, recordId });

            // Fetch the completed analysis record
            try {
                const historyResponse = await getAnalysisHistory(1, 1);
                const completedRecord = historyResponse.items.find(r => r.id === recordId);

                if (completedRecord) {
                    // Update the bulk upload results with the completed record
                    dispatch({
                        type: 'UPDATE_BULK_JOB_COMPLETED',
                        payload: {
                            record: completedRecord,
                            fileName: completedRecord.fileName || 'Unknown'
                        }
                    });

                    // Update local cache
                    const localCacheModule = await import('../services/localCache');
                    await localCacheModule.historyCache.put(completedRecord, 'synced');

                    // No refresh needed - UI updates in real-time via UPDATE_BULK_JOB_COMPLETED dispatches
                }
            } catch (error) {
                log('error', 'Failed to fetch completed analysis record', { jobId, recordId, error });
            }

            // Remove job from tracking
            setAsyncJobIds(prev => prev.filter(id => id !== jobId));
        }, [dispatch, historyPage, fetchData]),

        onError: useCallback((jobId: string, error: string) => {
            log('error', 'Async analysis job failed', { jobId, error });

            // Find the corresponding result and update with error
            const failedResult = bulkUploadResults.find(r =>
                r.data && typeof r.data === 'object' && '_recordId' in r.data && r.data._recordId === jobId
            );

            if (failedResult) {
                dispatch({
                    type: 'UPDATE_BULK_UPLOAD_RESULT',
                    payload: {
                        fileName: failedResult.fileName,
                        error: `Failed: ${error}`
                    }
                });
            }

            // Remove job from tracking
            setAsyncJobIds(prev => prev.filter(id => id !== jobId));
        }, [dispatch, bulkUploadResults])
    };

    const { isPolling, startPolling, stopPolling } = useJobPolling(asyncJobIds, jobPollingConfig);

    // Auto-start polling when there are jobs
    useEffect(() => {
        if (asyncJobIds.length > 0 && !isPolling) {
            startPolling();
        } else if (asyncJobIds.length === 0 && isPolling) {
            stopPolling();
        }
    }, [asyncJobIds, isPolling, startPolling, stopPolling]);

    // Initial data load and background cache building
    useEffect(() => {
        const initialLoad = async () => {
            log('info', 'Performing initial data load (page 1).');
            dispatch({ type: 'FETCH_PAGE_DATA_START' });
            try {
                const [systemsResponse, historyResponse] = await Promise.all([
                    getRegisteredSystems(1, 'all'),
                    getAnalysisHistory(1, ITEMS_PER_PAGE)
                ]);
                log('info', 'Successfully fetched initial page data.', { systemCount: systemsResponse.items.length, historyCount: historyResponse.items.length });
                dispatch({
                    type: 'FETCH_PAGE_DATA_SUCCESS',
                    payload: { systems: systemsResponse, history: historyResponse }
                });
                setAllSystems(systemsResponse.items); // Store full list for dropdowns

                // Start building the full history cache with a slight delay to allow UI to settle
                setTimeout(() => {
                    dispatch({ type: 'START_HISTORY_CACHE_BUILD' });
                    streamAllHistory(
                        (records) => dispatch({ type: 'APPEND_HISTORY_CACHE', payload: records }),
                        () => dispatch({ type: 'FINISH_HISTORY_CACHE_BUILD' })
                    );
                }, 1500);

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

    // Refetch history when sorting changes (always go to page 1)
    useEffect(() => {
        if (state.historyPage === 1) {
            fetchData(1, 'history'); // Remove forceRefresh to avoid page reload
        } else {
            // If not on page 1, dispatch to reset to page 1
            dispatch({ type: 'SET_HISTORY_PAGE', payload: 1 });
        }
    }, [state.historySortKey, state.historySortDirection]); // Only depend on sort changes


    // --- CRUD and Data Management Handlers ---

    /**
     * ***MODIFIED***: This is the new, simpler bulk analysis handler.
     * It processes files one by one and gets results immediately.
     */
    const handleBulkAnalyze = async (files: File[] | FileList | null | undefined, options: { forceReanalysis?: boolean; useAsync?: boolean } = {}) => {
        const normalizedFiles = Array.isArray(files) ? files : Array.from(files || []);
        if (normalizedFiles.length === 0) return;
        const { forceReanalysis = false, useAsync = false } = options;

        const newRecords: AnalysisRecord[] = []; // Track all processed records (including restored duplicates)
        log('info', 'Starting bulk analysis.', { fileCount: normalizedFiles.length, isStoryMode, forceReanalysis, useAsync });

        if (isStoryMode) {
            try {
                dispatch({ type: 'ACTION_START', payload: 'isBulkLoading' });
                const story = await createAnalysisStory({
                    title: storyTitle,
                    summary: storySummary,
                    userContext: storyUserContext || undefined
                });
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

        const initialResults: DisplayableAnalysisResult[] = normalizedFiles.map(f => ({
            fileName: f.name, data: null, error: forceReanalysis ? 'Queued (Force Override)' : 'Checking for duplicates...', file: f, submittedAt: Date.now()
        }));
        dispatch({ type: 'SET_BULK_UPLOAD_RESULTS', payload: initialResults });

        try {
            let trueDuplicates: DuplicateCheckResult[] = [];
            let needsUpgrade: DuplicateCheckResult[] = [];
            let newFiles: DuplicateCheckResult[] = [];
            let cachedDuplicates: CachedDuplicateResult[] = [];
            let cachedUpgrades: File[] = [];

            if (forceReanalysis) {
                log('info', 'Force Re-analysis enabled: Bypassing duplicate checks and treating all files as new.');
                // Map all files to "newFiles" to ensure they are processed
                newFiles = normalizedFiles.map(f => ({
                    file: f,
                    isDuplicate: false,
                    needsUpgrade: false
                }));
            } else {
                // Layer 1: Client-side cache fast-path (PR #341) - instant for cached duplicates
                // Layer 1.5: 'New File' metadata pre-check (unification fix)
                const partitionResult = partitionCachedFiles(normalizedFiles);
                cachedDuplicates = partitionResult.cachedDuplicates;
                cachedUpgrades = partitionResult.cachedUpgrades;
                const alreadyCheckedNewFiles = partitionResult.alreadyCheckedNewFiles;
                const remainingFiles = partitionResult.remainingFiles;

                // Skip cached duplicates silently - no action needed, just mark as skipped
                if (cachedDuplicates.length > 0) {
                    const skippedCached = cachedDuplicates.map(dup => ({
                        fileName: dup.file.name,
                        reason: 'Duplicate (Already Cached)'
                    }));
                    dispatch({
                        type: 'BATCH_BULK_JOB_SKIPPED',
                        payload: skippedCached
                    });
                    log('info', `Skipped ${cachedDuplicates.length} cached duplicates.`);
                }

                // Prepare cached upgrades as DuplicateCheckResults
                const cachedUpgradeResults: DuplicateCheckResult[] = cachedUpgrades.map(file => ({
                    file,
                    isDuplicate: true,
                    needsUpgrade: true
                }));

                // Prepare already-checked new files
                const alreadyCheckedResults: DuplicateCheckResult[] = alreadyCheckedNewFiles.map(file => ({
                    file,
                    isDuplicate: false,
                    needsUpgrade: false
                }));

                // PHASE 1: Check remaining files for duplicates upfront - categorize into three groups
                if (remainingFiles.length > 0) {
                    const result = await checkFilesForDuplicates(remainingFiles, log);
                    trueDuplicates = result.trueDuplicates;
                    needsUpgrade = result.needsUpgrade;
                    newFiles = result.newFiles;
                }

                // Combine cached upgrades with network-checked upgrades
                needsUpgrade = [...cachedUpgradeResults, ...needsUpgrade];

                // Combine pre-checked new files with verified new files
                newFiles = [...alreadyCheckedResults, ...newFiles];
            }

            // Skip all true duplicates immediately - no analysis or restore action needed
            if (trueDuplicates.length > 0 && !forceReanalysis) {
                const skippedFiles = trueDuplicates.map(dup => ({
                    fileName: dup.file.name,
                    reason: 'Duplicate (Already in Database)'
                }));
                dispatch({
                    type: 'BATCH_BULK_JOB_SKIPPED',
                    payload: skippedFiles
                });
                log('info', `Skipped ${trueDuplicates.length} duplicates from network check.`);
            }

            // Update status for files that need upgrade or are new in batches
            const statusUpdates = [
                ...needsUpgrade.map(item => ({ fileName: item.file.name, error: 'Queued (upgrading)' })),
                ...newFiles.map(item => ({ fileName: item.file.name, error: 'Queued' }))
            ];

            if (statusUpdates.length > 0) {
                dispatch({
                    type: 'BATCH_UPDATE_BULK_UPLOAD_RESULT',
                    payload: statusUpdates
                });
            }

            // ***PHASE 2: Analyze only upgrades and new files (true duplicates already handled)***
            const filesToAnalyze = [...needsUpgrade, ...newFiles];
            log('info', 'Phase 2: Starting parallel analysis of non-duplicate files.', {
                count: filesToAnalyze.length,
                upgrades: needsUpgrade.length,
                new: newFiles.length,
                cachedDuplicates: cachedDuplicates.length,
                cachedUpgrades: cachedUpgrades.length,
                forceReanalysis
            });

            // Create optimizer instance for parallel processing
            const optimizer = new UploadOptimizer();

            // Define single-file processor for optimizer
            const processFile = async (item: DuplicateCheckResult) => {
                const file = item.file;
                dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: file.name, error: 'Processing' } });

                const analysisData = await analyzeBmsScreenshot(file, forceReanalysis, state.primarySystemId, useAsync);

                log('info', 'Processing analysis result.', { fileName: file.name, useAsync });

                // If async, we might just get a jobId and status='pending'
                // We should handle that gracefully in the UI
                if (analysisData.status === 'pending') {
                    // Track the job ID for polling
                    if (analysisData._recordId) {
                        setAsyncJobIds(prev => [...prev, analysisData._recordId!]);
                    }

                    dispatch({
                        type: 'UPDATE_BULK_UPLOAD_RESULT',
                        payload: {
                            fileName: file.name,
                            error: 'Async Job Started', // User-friendly status
                            data: analysisData // Attach data so it counts as "success" or handled
                        }
                    });
                    return analysisData;
                }

                const tempRecord: AnalysisRecord = {
                    id: analysisData._recordId || `local-${Date.now()}`,
                    timestamp: analysisData._timestamp || new Date().toISOString(),
                    analysis: analysisData,
                    fileName: file.name
                };

                newRecords.push(tempRecord);

                // CRITICAL FIX: Explicitly save to local cache so UI components (History, Charts)
                // that rely on the cache-first strategy can see the new record immediately.
                try {
                    // We mark as 'synced' because this data just came from the server analysis
                    const localCacheModule = await import('../services/localCache');
                    await localCacheModule.historyCache.put(tempRecord, 'synced');
                    log('info', 'Updated local cache with new analysis record', { id: tempRecord.id });
                } catch (err) {
                    log('warn', 'Failed to update local cache with new record', { error: err instanceof Error ? err.message : String(err) });
                }

                log('info', 'Dispatching UPDATE_BULK_JOB_COMPLETED', {
                    fileName: file.name,
                    recordId: tempRecord.id,
                    hasAnalysis: !!tempRecord.analysis,
                    analysisKeys: tempRecord.analysis ? Object.keys(tempRecord.analysis).length : 0
                });

                dispatch({
                    type: 'UPDATE_BULK_JOB_COMPLETED',
                    payload: { record: tempRecord, fileName: file.name }
                });

                return analysisData; // Contains _meta.headers for optimizer
            };

            // Run with optimizer for parallel processing with rate-limit awareness
            const { errors } = await optimizer.processBatch(filesToAnalyze, processFile);

            // Handle any errors that weren't caught per-file
            for (const { file, error } of errors) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                if (errorMessage.includes('429')) {
                    setShowRateLimitWarning(true);
                }
                dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: file, error: `Failed: ${errorMessage}` } });
            }

            // Batch weather backfill: Fill weather gaps efficiently after bulk analysis
            // Get unique systemIds from newly processed records and trigger backfill for each
            const systemIdsToBackfill = new Set<string>();
            newRecords.forEach((record: AnalysisRecord) => {
                if (record.systemId) systemIdsToBackfill.add(record.systemId);
            });

            for (const systemId of systemIdsToBackfill) {
                try {
                    log('info', 'Starting batch weather backfill for system.', { systemId });
                    await fetch('/.netlify/functions/weather-backfill-gaps', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ systemId })
                    });
                } catch {
                    log('warn', 'Weather backfill failed (non-blocking).', { systemId });
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
            // No need to force refresh - UI updates in real-time via UPDATE_BULK_JOB_COMPLETED dispatches
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
                    // No refresh needed - optimistic UI update already removed the record
                } catch (err) {
                    const error = err instanceof Error ? err.message : "Failed to delete record.";
                    log('error', 'Failed to delete history record.', { recordId, error });
                    dispatch({ type: 'SET_ERROR', payload: error });
                } finally {
                    dispatch({ type: 'ACTION_END', payload: 'deletingRecordId' });
                    setConfirmation({ isOpen: false, message: '', onConfirm: () => { } });
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
                await linkAnalysisToSystem(record.id, systemId, record.hardwareSystemId);
                log('info', 'Link successful.');
                // No refresh needed - optimistic UI update already updated the record
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to link record.";
            log('error', 'Failed to link record.', { recordId: record.id, systemId, error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'linkingRecordId' });
        }
    };

    const handleSaveSystem = async (system: BmsSystem) => {
        const isEdit = !!editingSystem && !isCreatingSystem;
        const systemId = editingSystem?.id;
        log('info', 'Saving system.', { mode: isEdit ? 'edit' : 'create', systemId: systemId || null });
        dispatch({ type: 'ACTION_START', payload: 'isSaving' });
        try {
            if (isEdit && systemId) {
                const updatedData = { ...system };
                delete (updatedData as Partial<BmsSystem>).id;
                await updateBmsSystem(systemId, updatedData);
            } else {
                const createData = { ...system };
                delete (createData as Partial<BmsSystem>).id;
                await registerBmsSystem(createData);
            }

            log('info', 'System saved successfully.');
            setIsCreatingSystem(false);
            dispatch({ type: 'SET_EDITING_SYSTEM', payload: null });
            await fetchData(systemsPage, 'systems');
            await fetchData(1, 'systems');
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to save system.";
            log('error', 'Failed to save system.', { systemId: systemId || null, error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isSaving' });
        }
    };

    const handleDeleteSystem = async (systemId: string) => {
        log('info', 'Deleting system.', { systemId });
        dispatch({ type: 'ACTION_START', payload: 'isSaving' });
        try {
            await deleteBmsSystem(systemId);
            setIsCreatingSystem(false);
            dispatch({ type: 'SET_EDITING_SYSTEM', payload: null });
            await fetchData(1, 'systems');
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Failed to delete system.';
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isSaving' });
        }
    };

    // --- Data Management Handlers ---

    const handleGenericAction = async (
        actionName: keyof typeof state.actionStatus,
        actionFn: () => Promise<unknown>,
        _successMessage: string,
        refreshType: 'systems' | 'history' | 'all' | 'none' = 'none',
        options: { requiresConfirm?: boolean; confirmMessage?: string } = {}
    ) => {
        if (options.requiresConfirm) {
            setConfirmation({
                isOpen: true,
                message: options.confirmMessage || `Are you sure you want to perform the action: ${actionName}?`,
                onConfirm: async () => {
                    setConfirmation({ isOpen: false, message: '', onConfirm: () => { } });
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
                    // CRITICAL FIX: Force refresh after actions to bypass local cache and see server updates immediately
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
        async () => {
            let skip = 0;
            let totalAssociated = 0;
            let totalProcessed = 0;
            let loops = 0;
            const MAX_LOOPS = 50; // Safety brake

            // Initial call
            let result = await autoAssociateRecords(skip);
            totalAssociated += result.associated;
            totalProcessed += result.processed;

            // Simple loop for now - can be enhanced later
            while (result.success && loops < MAX_LOOPS) {
                loops++;

                // INTELLIGENT SKIP LOGIC:
                // If we associated records, they are removed from the 'unlinked' pool (systemId is no longer null),
                // so the "next" records shift down to fill the gap. We should start at 0 again to catch them.
                // If we found NO matches but timed out, we need to skip the ones we just checked to assume progress.
                if (result.associated > 0) {
                    skip = 0;
                } else {
                    skip += result.processed;
                }

                log('info', `Auto-associate timed out. looping...`, { loop: loops, skip, totalAssociated });

                // Recursive call
                result = await autoAssociateRecords(skip);
                totalAssociated += result.associated;
                totalProcessed += result.processed;
            }

            return {
                ...result,
                message: `Completed. Processed ${totalProcessed} records across ${loops + 1} batches. Associated ${totalAssociated} records.`
            };
        },
        'Auto-association process started.',
        'history'
    );

    const handleFixPowerSigns = () => handleGenericAction(
        'isFixingPowerSigns',
        fixPowerSigns,
        'Fix power signs process started.',
        'history'
    );

    const handleNormalizeIds = async () => {
        await handleGenericAction(
            'isNormalizingIds',
            async () => {
                let totalUpdated = 0;
                let totalScanned = 0;

                // Initial call
                const result = await normalizeIds(1000);
                totalUpdated += result.normalized;
                totalScanned += result.normalized;

                // Simple single call for now - can be enhanced later
                log('info', `Normalize-ids completed.`, {
                    totalUpdated,
                    totalScanned
                });

                return {
                    ...result,
                    message: `Completed. Normalized ${totalUpdated} records.`
                };
            },
            'ID normalization process started.',
            'history'
        );
    };

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
            const errorResponse = {
                status: 'error' as const,
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
            <SystemStatusWidget />

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
                            onMergeRequested={async (systemIds: string[], primaryId: string) => {
                                dispatch({ type: 'SET_SELECTED_SYSTEM_IDS', payload: systemIds });
                                dispatch({ type: 'SET_PRIMARY_SYSTEM_ID', payload: primaryId });
                                await handleMergeSystems();
                            }}
                        />
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCreatingSystem(true);
                                    dispatch({ type: 'SET_EDITING_SYSTEM', payload: null });
                                }}
                                className="bg-secondary hover:bg-primary text-white font-bold py-2 px-4 rounded-md transition-colors"
                            >
                                ➕ Create System
                            </button>
                        </div>
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
                        <section id="solar-integration-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">
                                Solar Energy Integration
                            </h2>
                            <SolarIntegrationDashboard
                                bmsRecords={state.historyCache} // Pass full history for best analysis
                                systemConfig={(() => {
                                    const s = systems.find(sys => sys.id === primarySystemId) ||
                                        (systems.length > 0 ? systems[0] : undefined);
                                    if (!s) return undefined;
                                    return {
                                        systemId: s.id,
                                        nominalVoltage: s.voltage || 12,
                                        fullCapacityAh: s.capacity || 100,
                                        location: (s.latitude && s.longitude) ? { latitude: s.latitude, longitude: s.longitude } : undefined
                                    };
                                })()}
                            />
                        </section>

                        <section id="data-reconciliation-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">
                                Orphaned ID Management
                            </h2>
                            <ReconciliationDashboard
                                systems={allSystems.length > 0 ? allSystems : systems}
                                onSystemCreated={async () => {
                                    // Refresh systems list after creating a new system
                                    await fetchData(1, 'systems');
                                }}
                            />
                        </section>
                        <section id="ai-feedback-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">🤖 AI Feedback & Suggestions</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <AIFeedbackDashboard />
                            </div>
                        </section>
                        <section id="diagnostics-guru-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">🔧 Diagnostics Guru</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <DiagnosticsGuru />
                            </div>
                        </section>
                        <section id="ip-management-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">API Security & IP Management</h2>
                            <IpManagement />
                        </section>
                        <DataManagement
                            state={{ ...state, systems: allSystems.length > 0 ? allSystems : state.systems }} // Overlay allSystems for dropdowns
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
                            cleanupProgress={cleanupProgress}
                            onNormalizeIds={handleNormalizeIds}
                        />

                        <section id="cost-dashboard-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">💰 AI Cost Management</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <CostDashboard />
                            </div>
                        </section>
                        <section id="monitoring-dashboard-section">
                            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">AI Feedback Monitoring</h2>
                            <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                                <FeedbackMonitoringDashboard />
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

            {(editingSystem || isCreatingSystem) && (
                <AdminSystemsManager
                    editingSystem={isCreatingSystem ? null : editingSystem}
                    dispatch={dispatch}
                    onClose={() => {
                        setIsCreatingSystem(false);
                        dispatch({ type: 'SET_EDITING_SYSTEM', payload: null });
                    }}
                    onSave={handleSaveSystem}
                    onDelete={handleDeleteSystem}
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
                                onClick={() => setConfirmation({ isOpen: false, message: '', onConfirm: () => { } })}
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
