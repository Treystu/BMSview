import { DEFAULT_VISIBLE_COLUMNS, HistoryColumnKey } from 'components/admin/columnDefinitions';
import React, { createContext, Dispatch, useContext, useReducer } from 'react';
import type { AnalysisRecord, BmsSystem, DisplayableAnalysisResult, AnalysisStory } from '../types';

export type HistorySortKey = HistoryColumnKey;

// Diagnostic types
interface DiagnosticTestResult {
  name: string;
  status: 'success' | 'warning' | 'error' | 'partial' | 'running';
  duration: number;
  details?: Record<string, any>;
  error?: string;
}

interface DiagnosticsResponse {
  status: 'success' | 'partial' | 'warning' | 'error';
  timestamp: string;
  duration: number;
  results: DiagnosticTestResult[];
  summary?: {
    total: number;
    success: number;
    partial?: number;
    warnings: number;
    errors: number;
  };
  error?: string;
}

// 1. State Shape
export interface AdminState {
  systems: BmsSystem[]; // Holds the current page of systems
  history: AnalysisRecord[]; // Holds the current page of history records
  historyCache: AnalysisRecord[]; // Holds ALL history records for the chart, built progressively
  loading: boolean;
  error: string | null;

  systemsPage: number;
  historyPage: number;

  totalSystems: number;
  totalHistory: number;

  isCacheBuilding: boolean;

  expandedHistoryId: string | null;
  editingSystem: BmsSystem | null;
  selectedSystemIds: string[];
  primarySystemId: string;
  duplicateSets: AnalysisRecord[][];
  bulkUploadResults: DisplayableAnalysisResult[];
  throttleMessage: string | null;
  actionStatus: {
    isMerging: boolean;
    isDeletingUnlinked: boolean;
    deletingRecordId: string | null;
    isSaving: boolean;
    linkingRecordId: string | null;
    isBackfilling: boolean;
    isBackfillingHourlyCloud: boolean;
    isCleaningLinks: boolean;
    isClearingAll: boolean;
    isScanning: boolean;
    isConfirmingDeletion: boolean;
    isBulkLoading: boolean;
    isCleaningJobs: boolean;
    isAutoAssociating: boolean;
    isClearingHistory: boolean;
    isFixingPowerSigns: boolean;
    isRunningDiagnostics: boolean;
  };
  isConfirmingClearAll: boolean;
  clearAllConfirmationText: string;
  linkSelections: { [recordId: string]: string };
  visibleHistoryColumns: HistoryColumnKey[];
  historySortKey: HistorySortKey;
  historySortDirection: 'asc' | 'desc';
  isDiagnosticsModalOpen: boolean;
  diagnosticResults: DiagnosticsResponse | null;
  selectedDiagnosticTests: string[];
  stories: AnalysisStory[];
}

export const initialState: AdminState = {
  systems: [],
  history: [],
  historyCache: [],
  loading: true,
  error: null,

  systemsPage: 1,
  historyPage: 1,
  totalSystems: 0,
  totalHistory: 0,
  isCacheBuilding: false,

  expandedHistoryId: null,
  editingSystem: null,
  selectedSystemIds: [],
  primarySystemId: '',
  duplicateSets: [],
  bulkUploadResults: [],
  throttleMessage: null,
  actionStatus: {
    isMerging: false, isDeletingUnlinked: false, deletingRecordId: null,
    isSaving: false, linkingRecordId: null, isBackfilling: false,
    isBackfillingHourlyCloud: false,
    isCleaningLinks: false, isClearingAll: false, isScanning: false,
    isConfirmingDeletion: false, isBulkLoading: false, isCleaningJobs: false,
    isAutoAssociating: false, isClearingHistory: false, isFixingPowerSigns: false,
    isRunningDiagnostics: false,
  },
  isConfirmingClearAll: false,
  clearAllConfirmationText: '',
  linkSelections: {},
  visibleHistoryColumns: DEFAULT_VISIBLE_COLUMNS,
  historySortKey: 'timestamp',
  historySortDirection: 'desc',
  isDiagnosticsModalOpen: false,
  diagnosticResults: null,
  // Default to all available diagnostic tests - matches DIAGNOSTIC_TEST_SECTIONS in AdminDashboard
  selectedDiagnosticTests: [
    // Infrastructure
    'database', 'gemini',
    // Core Analysis
    'analyze', 'insightsWithTools', 'asyncAnalysis',
    // Data Management
    'history', 'systems', 'dataExport', 'idempotency',
    // External Services
    'weather', 'backfillWeather', 'backfillHourlyCloud', 'solarEstimate', 'systemAnalytics', 'predictiveMaintenance',
    // System Utilities
    'contentHashing', 'errorHandling', 'logging', 'retryMechanism', 'timeout'
  ],
  stories: [],
};


// 2. Actions
export type AdminAction =
  | { type: 'FETCH_PAGE_DATA_START' }
  | { type: 'FETCH_PAGE_DATA_SUCCESS'; payload: { systems?: { items: BmsSystem[]; totalItems: number }; history?: { items: AnalysisRecord[]; totalItems: number } } }
  | { type: 'START_HISTORY_CACHE_BUILD' }
  | { type: 'APPEND_HISTORY_CACHE'; payload: AnalysisRecord[] }
  | { type: 'FINISH_HISTORY_CACHE_BUILD' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'TOGGLE_HISTORY_DETAIL'; payload: string }
  | { type: 'SET_EDITING_SYSTEM'; payload: BmsSystem | null }
  | { type: 'SET_LINK_SELECTION'; payload: { recordId: string; systemId: string } }
  | { type: 'ACTION_START'; payload: keyof AdminState['actionStatus'] }
  | { type: 'ACTION_END'; payload: keyof AdminState['actionStatus'] }
  | { type: 'MERGE_SYSTEMS_SUCCESS' }
  | { type: 'SCAN_DUPLICATES_SUCCESS'; payload: AnalysisRecord[][] }
  | { type: 'DELETE_DUPLICATES_SUCCESS' }
  | { type: 'CLEAR_DATA_SUCCESS' }
  | { type: 'SET_BULK_UPLOAD_RESULTS'; payload: DisplayableAnalysisResult[] }
  | { type: 'UPDATE_BULK_UPLOAD_RESULT'; payload: Partial<DisplayableAnalysisResult> & { fileName: string } }
  | { type: 'SET_THROTTLE_MESSAGE'; payload: string | null }
  | { type: 'SET_SELECTED_SYSTEM_IDS'; payload: string[] }
  | { type: 'SET_PRIMARY_SYSTEM_ID'; payload: string }
  | { type: 'SET_CONFIRMING_CLEAR_ALL'; payload: boolean }
  | { type: 'SET_CLEAR_ALL_CONFIRMATION_TEXT'; payload: string }
  | { type: 'SET_VISIBLE_HISTORY_COLUMNS'; payload: HistoryColumnKey[] }
  | { type: 'SET_HISTORY_SORT'; payload: { key: HistorySortKey } }
  | { type: 'SET_SYSTEMS_PAGE'; payload: number }
  | { type: 'SET_HISTORY_PAGE'; payload: number }
  | { type: 'UPDATE_BULK_JOB_COMPLETED'; payload: { record: AnalysisRecord, fileName: string } }
  // ***FIX: Add new action type for skipping files***
  | { type: 'UPDATE_BULK_JOB_SKIPPED'; payload: { fileName: string, reason: string } }
  | { type: 'OPEN_DIAGNOSTICS_MODAL' }
  | { type: 'CLOSE_DIAGNOSTICS_MODAL' }
  | { type: 'SET_DIAGNOSTIC_RESULTS'; payload: DiagnosticsResponse | null }
  | { type: 'UPDATE_SINGLE_DIAGNOSTIC_RESULT'; payload: { testId: string; result: DiagnosticTestResult } }
  | { type: 'SET_SELECTED_DIAGNOSTIC_TESTS'; payload: string[] }
  | { type: 'REMOVE_HISTORY_RECORD'; payload: string }
  | { type: 'SET_STORIES'; payload: AnalysisStory[] };

// 3. Reducer
export const adminReducer = (state: AdminState, action: AdminAction): AdminState => {
  switch (action.type) {
    case 'FETCH_PAGE_DATA_START':
      return { ...state, loading: true };
    case 'FETCH_PAGE_DATA_SUCCESS':
      return {
        ...state,
        loading: false,
        systems: action.payload.systems ? action.payload.systems.items : state.systems,
        totalSystems: action.payload.systems ? action.payload.systems.totalItems : state.totalSystems,
        history: action.payload.history ? action.payload.history.items : state.history,
        totalHistory: action.payload.history ? action.payload.history.totalItems : state.totalHistory,
        error: null,
      };
    case 'START_HISTORY_CACHE_BUILD':
      return { ...state, isCacheBuilding: true, historyCache: [] };
    case 'APPEND_HISTORY_CACHE':
      // Append new records, avoiding duplicates by checking IDs
      const newRecords = action.payload.filter(
        p => !state.historyCache.some(existing => existing.id === p.id)
      );
      return { ...state, historyCache: [...state.historyCache, ...newRecords] };
    case 'FINISH_HISTORY_CACHE_BUILD':
      return { ...state, isCacheBuilding: false };

    case 'SET_ERROR':
      return { ...state, loading: false, error: action.payload, actionStatus: initialState.actionStatus };

    case 'SET_SYSTEMS_PAGE':
      return { ...state, systemsPage: action.payload };
    case 'SET_HISTORY_PAGE':
      return { ...state, historyPage: action.payload, expandedHistoryId: null };

    case 'TOGGLE_HISTORY_DETAIL':
      return { ...state, expandedHistoryId: state.expandedHistoryId === action.payload ? null : action.payload };
    case 'SET_EDITING_SYSTEM':
      return { ...state, editingSystem: action.payload };
    case 'SET_LINK_SELECTION':
      return { ...state, linkSelections: { ...state.linkSelections, [action.payload.recordId]: action.payload.systemId } };
    case 'ACTION_START':
      return { ...state, error: null, actionStatus: { ...state.actionStatus, [action.payload]: true } };
    case 'ACTION_END':
      return { ...state, actionStatus: { ...state.actionStatus, [action.payload]: false } };
    case 'MERGE_SYSTEMS_SUCCESS':
      return { ...state, selectedSystemIds: [], primarySystemId: '', systemsPage: 1 };
    case 'SCAN_DUPLICATES_SUCCESS':
      return { ...state, duplicateSets: action.payload };
    case 'DELETE_DUPLICATES_SUCCESS':
      return { ...state, duplicateSets: [], historyPage: 1 };
    case 'CLEAR_DATA_SUCCESS':
      return { ...initialState, loading: false };
    case 'SET_BULK_UPLOAD_RESULTS':
      return { ...state, bulkUploadResults: action.payload };
    case 'UPDATE_BULK_UPLOAD_RESULT':
      return {
        ...state,
        bulkUploadResults: state.bulkUploadResults.map(r =>
          r.fileName === action.payload.fileName ? { ...r, ...action.payload } : r
        )
      };

    case 'UPDATE_BULK_JOB_COMPLETED':
      const { record, fileName } = action.payload;
      return {
        ...state,
        bulkUploadResults: state.bulkUploadResults.map(r =>
          r.fileName === fileName ? { ...r, data: record.analysis, error: null, recordId: record.id, weather: record.weather } : r
        ),
        // Add the new record to the history cache immediately for the chart
        history: [record, ...state.history],
        historyCache: [record, ...state.historyCache],
        totalHistory: state.totalHistory + 1,
      };

    // ***FIX: Handle the new SKIPPED action***
    case 'UPDATE_BULK_JOB_SKIPPED':
      return {
        ...state,
        bulkUploadResults: state.bulkUploadResults.map(r =>
          r.fileName === action.payload.fileName
            ? { ...r, isDuplicate: true, error: action.payload.reason }
            : r
        ),
      };

    case 'SET_THROTTLE_MESSAGE':
      return { ...state, throttleMessage: action.payload };
    case 'SET_SELECTED_SYSTEM_IDS':
      return { ...state, selectedSystemIds: action.payload, primarySystemId: action.payload.includes(state.primarySystemId) ? state.primarySystemId : '' };
    case 'SET_PRIMARY_SYSTEM_ID':
      return { ...state, primarySystemId: action.payload };
    case 'SET_CONFIRMING_CLEAR_ALL':
      return { ...state, isConfirmingClearAll: action.payload, clearAllConfirmationText: '' };
    case 'SET_CLEAR_ALL_CONFIRMATION_TEXT':
      return { ...state, clearAllConfirmationText: action.payload };
    case 'SET_VISIBLE_HISTORY_COLUMNS':
      return { ...state, visibleHistoryColumns: action.payload };
    case 'SET_HISTORY_SORT': {
      const { key } = action.payload;
      const direction = (state.historySortKey === key && state.historySortDirection === 'desc') ? 'asc' : 'desc';
      // When sorting, we must go back to page 1 as the order has changed
      return { ...state, historySortKey: key, historySortDirection: direction, historyPage: 1 };
    }
    case 'OPEN_DIAGNOSTICS_MODAL':
      return { ...state, isDiagnosticsModalOpen: true, diagnosticResults: null };
    case 'CLOSE_DIAGNOSTICS_MODAL':
      return { ...state, isDiagnosticsModalOpen: false, diagnosticResults: null };
    case 'SET_DIAGNOSTIC_RESULTS':
      return { ...state, diagnosticResults: action.payload };
    case 'UPDATE_SINGLE_DIAGNOSTIC_RESULT':
      // Real-time update: replace the specific test result as it completes
      if (!state.diagnosticResults) {
        return state;
      }
      
      // Simple name-based matching - no need for complex test ID lookup
      const updatedResults = state.diagnosticResults.results.map(r => 
        r.name === action.payload.result.name ? action.payload.result : r
      );
      
      // Recalculate summary in real-time
      const newSummary = {
        total: updatedResults.length,
        success: updatedResults.filter(r => r.status === 'success').length,
        partial: updatedResults.filter(r => r.status === 'partial').length,
        warnings: updatedResults.filter(r => r.status === 'warning').length,
        errors: updatedResults.filter(r => r.status === 'error').length
      };
      
      return {
        ...state,
        diagnosticResults: {
          ...state.diagnosticResults,
          results: updatedResults,
          summary: newSummary,
          // Keep status as partial until all tests complete
          status: updatedResults.some(r => r.status === 'running') ? 'partial' : (
            newSummary.errors > 0 || newSummary.warnings > 0 || newSummary.partial > 0 ? 'partial' : 'success'
          )
        }
      };
    case 'REMOVE_HISTORY_RECORD':
      // Remove the record from the current page and the cache immediately to allow optimistic UI updates
      const idToRemove = action.payload;
      return {
        ...state,
        history: state.history.filter(r => r.id !== idToRemove),
        historyCache: state.historyCache.filter(r => r.id !== idToRemove),
        totalHistory: Math.max(0, state.totalHistory - (state.history.some(r => r.id === idToRemove) ? 1 : 0)),
      };
    case 'SET_SELECTED_DIAGNOSTIC_TESTS':
      return { ...state, selectedDiagnosticTests: action.payload };
    case 'SET_STORIES':
      return { ...state, stories: action.payload };
    default:
      return state;
  }
};

const AdminStateContext = createContext<{ state: AdminState; dispatch: Dispatch<AdminAction> } | undefined>(undefined);

export const AdminStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(adminReducer, initialState);
  return <AdminStateContext.Provider value={{ state, dispatch }}>{children}</AdminStateContext.Provider>;
};

export const useAdminState = () => {
  const context = useContext(AdminStateContext);
  if (!context) {
    throw new Error('useAdminState must be used within an AdminStateProvider');
  }
  return context;
};
