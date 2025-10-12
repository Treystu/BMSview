import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { apiFetch, getRegisteredSystems, getAnalysisHistory, mergeBmsSystems, deleteUnlinkedAnalysisHistory, findDuplicateAnalysisSets, deleteAnalysisRecords, deleteAnalysisRecord, updateBmsSystem, linkAnalysisToSystem, clearAllData, registerBmsSystem, backfillWeatherData, cleanupLinks, cleanupCompletedJobs, clearHistoryStore, autoAssociateRecords, getJobStatuses, getAnalysisRecordById, fixPowerSigns } from '../services/clientService';
import { analyzeBmsScreenshots } from '../services/geminiService';
import type { BmsSystem, AnalysisRecord, DisplayableAnalysisResult } from '../types';
import EditSystemModal from './EditSystemModal';
import BulkUpload from './BulkUpload';
import HistoricalChart from './HistoricalChart';
import IpManagement from './IpManagement';
import { useAdminState, HistorySortKey } from '../state/adminState';
import { getBasename } from '../utils';

import AdminHeader from './admin/AdminHeader';
import SystemsTable from './admin/SystemsTable';
import HistoryTable from './admin/HistoryTable';
import DataManagement from './admin/DataManagement';
import { ALL_HISTORY_COLUMNS, getNestedValue } from './admin/columnDefinitions';

type JobCreationResponse = {
    fileName: string;
    jobId: string;
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
        systems, history, loading,
        editingSystem, selectedSystemIds, primarySystemId,
        bulkUploadResults, actionStatus,
        systemsPage,
        historyPage,
    } = state;

    const [cleanupProgress, setCleanupProgress] = useState<string | null>(null);
    const [showRateLimitWarning, setShowRateLimitWarning] = useState(false);
    
    const pollingIntervalRef = useRef<number | null>(null);
    const registeredSystemsRef = useRef(systems);
    registeredSystemsRef.current = systems;

    const fetchData = useCallback(async () => {
        log('info', 'Fetching admin data: systems and history.');
        dispatch({ type: 'FETCH_DATA_START' });
        try {
            const [systemsResponse, historyResponse] = await Promise.all([
                getRegisteredSystems(),
                getAnalysisHistory()
            ]);
            log('info', 'Successfully fetched admin data.', { systemCount: systemsResponse.length, historyCount: historyResponse.length });
            dispatch({
                type: 'FETCH_DATA_SUCCESS',
                payload: {
                    systems: systemsResponse,
                    history: historyResponse,
                }
            });
        } catch (err) {
            const error = err instanceof Error ? err.message : "Failed to load dashboard data.";
            log('error', 'Failed to fetch admin data.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        }
    }, [dispatch]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const pollJobStatuses = useCallback(async () => {
        const pendingJobs = state.bulkUploadResults.filter(r => r.jobId && !['completed', 'failed'].includes(r.error?.toLowerCase() ?? ''));
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
            log('info', 'Received bulk job statuses.', { statuses });
            let needsHistoryRefresh = false;

            for (const status of statuses) {
                 if (status.status === 'completed' && status.recordId) {
                    log('info', 'Bulk job completed, fetching record.', { jobId: status.jobId, recordId: status.recordId });
                    const record = await getAnalysisRecordById(status.recordId);
                    if (record) {
                        dispatch({ type: 'UPDATE_BULK_JOB_COMPLETED', payload: { jobId: status.jobId, record } });
                        needsHistoryRefresh = true;
                    } else {
                        log('warn', 'Bulk job completed but record could not be fetched.', { jobId: status.jobId, recordId: status.recordId });
                        dispatch({ type: 'UPDATE_BULK_JOB_STATUS', payload: { jobId: status.jobId, status: 'Completed (record fetch failed)' } });
                    }
                } else if (status.status === 'failed' || status.status === 'not_found') {
                    log('warn', `Bulk job ${status.status}.`, { jobId: status.jobId, error: status.error });
                    dispatch({ type: 'UPDATE_BULK_JOB_STATUS', payload: { jobId: status.jobId, status: status.error || 'Failed' } });
                } else {
                    log('info', 'Bulk job status updated.', { jobId: status.jobId, status: status.status });
                    dispatch({ type: 'UPDATE_BULK_JOB_STATUS', payload: { jobId: status.jobId, status: status.status } });
                }
            }
            if (needsHistoryRefresh) {
                log('info', 'Bulk job(s) completed, refreshing main data.');
                fetchData();
            }
        } catch (err) {
            log('warn', 'Failed to poll bulk job statuses.', { error: err instanceof Error ? err.message : 'Unknown error' });
        }
    }, [state.bulkUploadResults, dispatch, fetchData]);

    useEffect(() => {
        const pendingJobs = bulkUploadResults.filter(r => r.jobId && !['completed', 'failed'].includes(r.error?.toLowerCase() ?? ''));
        if (pendingJobs.length > 0 && !pollingIntervalRef.current) {
            log('info', 'Pending bulk jobs detected, starting poller.');
            pollingIntervalRef.current = window.setInterval(pollJobStatuses, 5000);
        } else if (pendingJobs.length === 0 && pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };
    }, [bulkUploadResults, pollJobStatuses]);

    const sortedHistory = useMemo(() => {
        const { historySortKey, historySortDirection } = state;
        if (!history) return [];

        const getSortableValue = (record: AnalysisRecord, key: HistorySortKey) => {
            const definition = ALL_HISTORY_COLUMNS[key];
            if (!definition || !definition.sortable) return null;

            let value = getNestedValue(record, key);
            
            if (typeof value === 'boolean') return value ? 1 : 0;
            if (key === 'analysis.cellVoltageDifference' && typeof value === 'number') return value * 1000;
            if (typeof value === 'string') return value.toLowerCase();
            if (typeof value === 'number') return value;

            return null;
        };
    
        return [...history].sort((a, b) => {
            const valA = getSortableValue(a, historySortKey);
            const valB = getSortableValue(b, historySortKey);

            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
    
            if (typeof valA === 'string' && typeof valB === 'string') {
                const comparison = valA.localeCompare(valB);
                return historySortDirection === 'asc' ? comparison : -comparison;
            }

            if (valA < valB) return historySortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return historySortDirection === 'asc' ? 1 : -1;
            
            return 0;
        });
    }, [history, state.historySortKey, state.historySortDirection]);
    
    const paginatedSystems = useMemo(() => {
        return systems.slice((systemsPage - 1) * ITEMS_PER_PAGE, systemsPage * ITEMS_PER_PAGE);
    }, [systems, systemsPage]);

    const paginatedHistory = useMemo(() => {
        return sortedHistory.slice((historyPage - 1) * ITEMS_PER_PAGE, historyPage * ITEMS_PER_PAGE);
    }, [sortedHistory, historyPage]);


    const handleBulkAnalyze = async (files: File[]) => {
        log('info', 'Admin bulk trigger started.', { initialFileCount: files.length });
        setShowRateLimitWarning(false);
        dispatch({ type: 'ACTION_START', payload: 'isBulkLoading' });
        dispatch({ type: 'SET_ERROR', payload: null });
        dispatch({ type: 'SET_THROTTLE_MESSAGE', payload: null });
    
        const allHistory = await apiFetch<AnalysisRecord[]>('history?all=true');
        const existingFilenameMap = new Map<string, AnalysisRecord>(
            allHistory.filter(r => r.fileName).map(r => [getBasename(r.fileName!), r])
        );
    
        const initialResults: DisplayableAnalysisResult[] = [];
        const batchBasenames = new Set<string>();
        const filesToAnalyze: File[] = [];
    
        for (const file of files) {
            const basename = getBasename(file.name);
            const isBatchDuplicate = batchBasenames.has(basename);
            const isHistoryDuplicate = existingFilenameMap.has(basename);

            if (isHistoryDuplicate || isBatchDuplicate) {
                initialResults.push({ fileName: file.name, data: null, error: 'Skipped: Duplicate.', file: file, isDuplicate: true });
            } else {
                initialResults.push({ fileName: file.name, data: null, error: 'Queued', file: file });
                batchBasenames.add(basename);
                filesToAnalyze.push(file);
            }
        }
        dispatch({ type: 'SET_BULK_UPLOAD_RESULTS', payload: initialResults });
        log('info', 'Admin bulk trigger: pre-processing complete.', { toAnalyze: filesToAnalyze.length, duplicates: initialResults.length - filesToAnalyze.length });

        if (filesToAnalyze.length === 0) {
            dispatch({ type: 'ACTION_END', payload: 'isBulkLoading' });
            return;
        }
        
        log('info', 'AdminDashboard bulk trigger', { toAnalyzeCount: filesToAnalyze.length, state: 'admin', timestamp: new Date().toISOString() });
        
        const processJobCreationResults = (results: JobCreationResponse[]) => {
            results.forEach(job => {
                if (job.error) {
                   log('warn', 'Job creation failed for a file.', { fileName: job.fileName, error: job.error });
                   dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: job.fileName, error: job.error } });
                   if (job.error.includes('429') || job.error.toLowerCase().includes('rate limit')) {
                       log('warn', 'Rate limit warning triggered.');
                       setShowRateLimitWarning(true);
                   }
               } else {
                   dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: job.fileName, jobId: job.jobId, error: job.status } });
               }
            });
        };
    
        try {
            const BATCH_SIZE = 10;
            const BATCH_DELAY_MS = 10000; // 10 seconds delay between batches
            
            for (let i = 0; i < filesToAnalyze.length; i += BATCH_SIZE) {
                const batch = filesToAnalyze.slice(i, i + BATCH_SIZE);
                log('info', `Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(filesToAnalyze.length / BATCH_SIZE)}.`, { batchSize: batch.length });
                
                try {
                    const batchResults = await analyzeBmsScreenshots(batch, registeredSystemsRef.current);
                    processJobCreationResults(batchResults);
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : 'A critical error occurred during a batch.';
                    log('error', `Batch ${i / BATCH_SIZE + 1} failed.`, { error: errorMessage });
                    batch.forEach(file => {
                        dispatch({ type: 'UPDATE_BULK_UPLOAD_RESULT', payload: { fileName: file.name, error: errorMessage } });
                    });
                }
    
                if (i + BATCH_SIZE < filesToAnalyze.length) {
                    log('info', `Waiting ${BATCH_DELAY_MS / 1000}s before next batch.`);
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
                }
            }
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isBulkLoading' });
        }
    };

    const handleMergeSystems = async () => {
        if (selectedSystemIds.length < 2 || !primarySystemId) {
            const error = "Please select at least two systems and a primary system to merge into.";
            log('warn', 'Merge attempt failed validation.', { error, selectedCount: selectedSystemIds.length, primarySystemId });
            dispatch({ type: 'SET_ERROR', payload: error });
            return;
        }
        if (!window.confirm("Are you sure you want to merge these systems? This action cannot be undone.")) {
            log('info', 'User cancelled merge operation.');
            return;
        }
        
        log('info', 'Starting system merge.', { primarySystemId, systemsToMerge: selectedSystemIds });
        dispatch({ type: 'ACTION_START', payload: 'isMerging' });
        try {
            await mergeBmsSystems(primarySystemId, selectedSystemIds);
            log('info', 'System merge successful.');
            dispatch({ type: 'MERGE_SYSTEMS_SUCCESS' });
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during merge.";
            log('error', 'System merge failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isMerging' });
        }
    };
    
    const handleScanForDuplicates = async () => {
        log('info', 'Scanning for duplicate analysis records.');
        dispatch({ type: 'ACTION_START', payload: 'isScanning' });
        try {
            const sets = await findDuplicateAnalysisSets();
            sets.forEach(set => set.sort((a, b) => {
                const aIsLinked = !!a.systemId, bIsLinked = !!b.systemId;
                if (aIsLinked !== bIsLinked) return aIsLinked ? -1 : 1;
                const aHasWeather = !!a.weather, bHasWeather = !!b.weather;
                if (aHasWeather !== bHasWeather) return aHasWeather ? -1 : 1;
                return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            }));
            log('info', 'Duplicate scan complete.', { foundSets: sets.length });
            dispatch({ type: 'SCAN_DUPLICATES_SUCCESS', payload: sets });
            if (sets.length === 0) window.alert("No duplicate records found.");
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred while scanning.";
            log('error', 'Duplicate scan failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isScanning' });
        }
    };

    const handleConfirmDeletion = async () => {
        const idsToDelete = state.duplicateSets.flatMap(set => set.slice(1).map(record => record.id));
        if (idsToDelete.length === 0) {
            log('info', 'No duplicates to delete.');
            return;
        }
        if (!window.confirm(`Are you sure you want to permanently delete ${idsToDelete.length} duplicate records? This action cannot be undone.`)) {
            log('info', 'User cancelled duplicate deletion.');
            return;
        }

        log('info', 'Confirming deletion of duplicate records.', { count: idsToDelete.length, ids: idsToDelete });
        dispatch({ type: 'ACTION_START', payload: 'isConfirmingDeletion' });
        try {
            await deleteAnalysisRecords(idsToDelete);
            log('info', 'Duplicate records deleted successfully.');
            dispatch({ type: 'DELETE_DUPLICATES_SUCCESS' });
            await fetchData();
            window.alert(`Successfully deleted ${idsToDelete.length} duplicate records.`);
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during deletion.";
            log('error', 'Duplicate deletion failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isConfirmingDeletion' });
        }
    };

    const handleDeleteUnlinked = async () => {
        if (!window.confirm("Are you sure you want to delete all unlinked analysis records? This action cannot be undone.")) {
             log('info', 'User cancelled deletion of unlinked records.');
            return;
        }
        log('info', 'Starting deletion of unlinked records.');
        dispatch({ type: 'ACTION_START', payload: 'isDeletingUnlinked' });
        try {
            await deleteUnlinkedAnalysisHistory();
            log('info', 'Deletion of unlinked records successful.');
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during deletion.";
            log('error', 'Deletion of unlinked records failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isDeletingUnlinked' });
        }
    };

    const handleDeleteRecord = async (recordId: string) => {
        if (!window.confirm("Are you sure you want to permanently delete this analysis record? This action cannot be undone.")) {
            log('info', 'User cancelled single record deletion.', { recordId });
            return;
        }
        log('info', 'Deleting single record.', { recordId });
        dispatch({ type: 'ACTION_START', payload: 'deletingRecordId' });
        try {
            await deleteAnalysisRecord(recordId);
            log('info', 'Single record deleted successfully.', { recordId });
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during deletion.";
            log('error', 'Single record deletion failed.', { recordId, error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'deletingRecordId' });
        }
    };

    const handleSaveSystem = async (updatedData: Omit<BmsSystem, 'id'>) => {
        if (!editingSystem) return;
        log('info', 'Saving system data.', { systemId: editingSystem.id, name: updatedData.name });
        dispatch({ type: 'ACTION_START', payload: 'isSaving' });
        try {
            await updateBmsSystem(editingSystem.id, updatedData);
            log('info', 'System saved successfully.', { systemId: editingSystem.id });
            dispatch({ type: 'SET_EDITING_SYSTEM', payload: null });
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred while saving.";
            log('error', 'System save failed.', { systemId: editingSystem.id, error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isSaving' });
        }
    };

    const handleLinkRecord = async (record: AnalysisRecord) => {
        const systemId = state.linkSelections[record.id];
        if (!systemId) {
            log('warn', 'Link record attempt with no system selected.', { recordId: record.id });
            dispatch({ type: 'SET_ERROR', payload: "Please select a system to link to." });
            return;
        }

        log('info', 'Linking record to system.', { recordId: record.id, targetSystemId: systemId });
        dispatch({ type: 'ACTION_START', payload: 'linkingRecordId' });
        try {
            if (systemId === '--create-new--') {
                if (!record.dlNumber) throw new Error("Cannot create a new system for a record without a DL Number.");
                const newSystemName = window.prompt(`Enter a name for the new system to be associated with DL Number: ${record.dlNumber}`);
                
                if (newSystemName && newSystemName.trim() !== '') {
                    log('info', 'Creating and linking to a new system.', { dlNumber: record.dlNumber, newSystemName });
                    const newSystem = await registerBmsSystem({ name: newSystemName.trim(), chemistry: '', voltage: null, capacity: null, latitude: null, longitude: null, maxAmpsSolarCharging: null, maxAmpsGeneratorCharging: null });
                    await linkAnalysisToSystem(record.id, newSystem.id, record.dlNumber);
                } else {
                    log('info', 'User cancelled creation of new system.');
                    dispatch({ type: 'ACTION_END', payload: 'linkingRecordId' });
                    return;
                }
            } else {
                await linkAnalysisToSystem(record.id, systemId, record.dlNumber);
            }
            log('info', 'Record linked successfully.', { recordId: record.id });
            dispatch({ type: 'SET_LINK_SELECTION', payload: { recordId: record.id, systemId: '' }});
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred while linking.";
            log('error', 'Failed to link record.', { recordId: record.id, error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'linkingRecordId' });
        }
    };

    const handleClearAllData = async () => {
        if (state.clearAllConfirmationText !== 'delete') {
            log('warn', 'Clear all data confirmation text did not match.');
            dispatch({ type: 'SET_ERROR', payload: "Confirmation text does not match." });
            return;
        }
    
        log('warn', 'Starting deletion of ALL application data.');
        dispatch({ type: 'ACTION_START', payload: 'isClearingAll' });
        try {
            await clearAllData();
            log('warn', 'ALL application data has been deleted.');
            dispatch({ type: 'CLEAR_DATA_SUCCESS' });
            await fetchData();
            window.alert("All data has been successfully cleared.");
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred while clearing data.";
            log('error', 'Failed to clear all data.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isClearingAll' });
        }
    };

    const handleClearHistory = async () => {
        if (!window.confirm("Are you absolutely sure you want to clear ALL analysis history? This is a destructive operation and cannot be undone.")) {
            log('info', 'User cancelled clearing history store.');
            return;
        }
    
        log('warn', 'Starting deletion of history store.');
        dispatch({ type: 'ACTION_START', payload: 'isClearingHistory' });
        try {
            await clearHistoryStore();
            log('warn', 'History store has been cleared.');
            window.alert("Analysis history store has been cleared successfully.");
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred while clearing history.";
            log('error', 'Failed to clear history store.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isClearingHistory' });
        }
    };

    const handleBackfillWeather = async () => {
        const allHistory = await apiFetch<AnalysisRecord[]>('history?all=true');
        const recordsMissingWeather = allHistory.filter(r => !r.weather && r.systemId).length;
        if (recordsMissingWeather === 0) {
            window.alert("No records require weather backfilling.");
            log('info', 'Weather backfill skipped: no records require it.');
            return;
        }
        if (!window.confirm(`Found ${recordsMissingWeather} records missing weather data. This may take some time and will consume API credits. Continue?`)) {
            log('info', 'User cancelled weather backfill.');
            return;
        }

        log('info', 'Starting weather data backfill.', { recordCount: recordsMissingWeather });
        dispatch({ type: 'ACTION_START', payload: 'isBackfilling' });
        try {
            await backfillWeatherData();
            log('info', 'Weather data backfill completed.');
            await fetchData();
            window.alert("Weather data backfill completed successfully.");
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during backfill.";
            log('error', 'Weather data backfill failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isBackfilling' });
        }
    };

    const handleCleanupLinks = async () => {
        if (!window.confirm("This will scan all history records to fix orphaned links and stale data. This action is safe but may take a moment. Continue?")) {
            log('info', 'User cancelled link cleanup.');
            return;
        }

        log('info', 'Starting link cleanup.');
        dispatch({ type: 'ACTION_START', payload: 'isCleaningLinks' });
        try {
            await cleanupLinks();
            log('info', 'Link cleanup successful.');
            await fetchData();
            window.alert("Link cleanup and verification completed successfully.");
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during link cleanup.";
            log('error', 'Link cleanup failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isCleaningLinks' });
        }
    };
    
    const handleFixPowerSigns = async () => {
        if (!window.confirm("This will scan all history records and correct the sign of the 'Power' value where it is positive but 'Current' is negative. This action is safe but may take a moment. Continue?")) {
            log('info', 'User cancelled power sign fix.');
            return;
        }
        log('info', 'Starting power sign fix.');
        dispatch({ type: 'ACTION_START', payload: 'isFixingPowerSigns' });
        try {
            const result = await fixPowerSigns();
            log('info', 'Power sign fix completed.', { updatedCount: result.updatedCount });
            window.alert(`Power sign fix complete. ${result.updatedCount} records were updated.`);
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during power sign fix.";
            log('error', 'Power sign fix failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isFixingPowerSigns' });
        }
    };

    const handleAutoAssociateRecords = async () => {
        if (!window.confirm("This will scan all unlinked records and associate them with systems based on matching DL Numbers. This may take a moment and cannot be undone. Continue?")) {
            log('info', 'User cancelled auto-association.');
            return;
        }
        log('info', 'Starting auto-association of unlinked records.');
        dispatch({ type: 'ACTION_START', payload: 'isAutoAssociating' });
        try {
            const result = await autoAssociateRecords();
            log('info', 'Auto-association complete.', { associatedCount: result.associatedCount });
            window.alert(`Association complete. ${result.associatedCount} records were linked to systems.`);
            await fetchData();
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during auto-association.";
            log('error', 'Auto-association failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isAutoAssociating' });
        }
    };

    const handleCleanupCompletedJobs = async () => {
        if (!window.confirm("This will scan all completed analysis jobs and remove large image data. This can free up significant storage. Continue?")) {
            log('info', 'User cancelled job cleanup.');
            return;
        }

        log('info', 'Starting completed jobs cleanup.');
        dispatch({ type: 'ACTION_START', payload: 'isCleaningJobs' });
        setCleanupProgress("Starting cleanup...");
        try {
            let cursor: string | null | undefined = undefined;
            let totalCleaned = 0;
            do {
                const result = await cleanupCompletedJobs(cursor);
                totalCleaned += result.cleanedCount;
                cursor = result.nextCursor;
                const progressMessage = `Cleaned ${totalCleaned} jobs...`;
                log('info', progressMessage, { cursor: cursor || 'end' });
                setCleanupProgress(progressMessage);
            } while (cursor);
            
            setCleanupProgress(null);
            log('info', 'Job cleanup complete.', { totalCleaned });
            window.alert(`Cleanup complete! Successfully cleaned up ${totalCleaned} job records.`);
        } catch (err) {
            const error = err instanceof Error ? err.message : "An unknown error occurred during cleanup.";
            log('error', 'Job cleanup failed.', { error });
            dispatch({ type: 'SET_ERROR', payload: error });
        } finally {
            dispatch({ type: 'ACTION_END', payload: 'isCleaningJobs' });
        }
    };

    return (
        <div className="bg-neutral-dark min-h-screen text-neutral-light p-4 sm:p-6 md:p-8">
            <AdminHeader user={user} onLogout={onLogout} />

            <main className="space-y-12">
                <section>
                    <BulkUpload 
                        onAnalyze={handleBulkAnalyze}
                        results={bulkUploadResults}
                        isLoading={actionStatus.isBulkLoading}
                        showRateLimitWarning={showRateLimitWarning}
                    />
                </section>
                
                {!loading && (
                    <section>
                        <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">Historical Analysis</h2>
                        <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                            <HistoricalChart systems={systems} history={history} />
                        </div>
                    </section>
                )}

                {loading ? (
                    <div className="text-center text-lg">Loading data...</div>
                ) : (
                    <>
                        <SystemsTable 
                            systems={paginatedSystems} 
                            dispatch={dispatch} 
                            pagination={{
                                currentPage: systemsPage,
                                totalItems: systems.length,
                                itemsPerPage: ITEMS_PER_PAGE,
                            }}
                        />
                         <HistoryTable 
                            history={paginatedHistory} 
                            systems={systems} 
                            state={state} 
                            dispatch={dispatch}
                            onLinkRecord={handleLinkRecord}
                            onDeleteRecord={handleDeleteRecord}
                            pagination={{
                                currentPage: historyPage,
                                totalItems: sortedHistory.length,
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
                            // FIX: Corrected prop name from onScanForDuplicates to handleScanForDuplicates to match the function defined in this component.
                            onScanForDuplicates={handleScanForDuplicates}
                            // FIX: Corrected prop name from onConfirmDeletion to handleConfirmDeletion to match the function defined in this component.
                            onConfirmDeletion={handleConfirmDeletion}
                            onDeleteUnlinked={handleDeleteUnlinked}
                            onClearAllData={handleClearAllData}
                            onClearHistory={handleClearHistory}
                            onBackfillWeather={handleBackfillWeather}
                            onCleanupLinks={handleCleanupLinks}
                            onAutoAssociate={handleAutoAssociateRecords}
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