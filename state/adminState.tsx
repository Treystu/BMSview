import React, { createContext, useReducer, useContext, Dispatch } from 'react';
import type { BmsSystem, AnalysisRecord, DisplayableAnalysisResult } from '../types';
import { HistoryColumnKey, DEFAULT_VISIBLE_COLUMNS } from '../components/admin/columnDefinitions';

export type HistorySortKey = HistoryColumnKey;

// 1. State Shape
export interface AdminState {
  systems: BmsSystem[];
  history: AnalysisRecord[];
  loading: boolean;
  error: string | null;
  
  systemsPage: number;
  historyPage: number;

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
    isCleaningLinks: boolean;
    isClearingAll: boolean;
    isScanning: boolean;
    isConfirmingDeletion: boolean;
    isBulkLoading: boolean;
    isCleaningJobs: boolean;
    isAutoAssociating: boolean;
    isClearingHistory: boolean;
  };
  isConfirmingClearAll: boolean;
  clearAllConfirmationText: string;
  linkSelections: { [recordId: string]: string };
  visibleHistoryColumns: HistoryColumnKey[];
  historySortKey: HistorySortKey;
  historySortDirection: 'asc' | 'desc';
}

export const initialState: AdminState = {
  systems: [],
  history: [],
  loading: true,
  error: null,
  
  systemsPage: 1,
  historyPage: 1,

  expandedHistoryId: null,
  editingSystem: null,
  selectedSystemIds: [],
  primarySystemId: '',
  duplicateSets: [],
  bulkUploadResults: [],
  throttleMessage: null,
  actionStatus: {
    isMerging: false,
    isDeletingUnlinked: false,
    deletingRecordId: null,
    isSaving: false,
    linkingRecordId: null,
    isBackfilling: false,
    isCleaningLinks: false,
    isClearingAll: false,
    isScanning: false,
    isConfirmingDeletion: false,
    isBulkLoading: false,
    isCleaningJobs: false,
    isAutoAssociating: false,
    isClearingHistory: false,
  },
  isConfirmingClearAll: false,
  clearAllConfirmationText: '',
  linkSelections: {},
  visibleHistoryColumns: DEFAULT_VISIBLE_COLUMNS,
  historySortKey: 'timestamp',
  historySortDirection: 'desc',
};


// 2. Actions
export type AdminAction =
  | { type: 'FETCH_DATA_START' }
  | { type: 'FETCH_DATA_SUCCESS'; payload: { systems: BmsSystem[]; history: AnalysisRecord[] } }
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
  | { type: 'UPDATE_BULK_JOB_STATUS'; payload: { jobId: string; status: string } }
  | { type: 'UPDATE_BULK_JOB_COMPLETED'; payload: { jobId: string; record: AnalysisRecord } };

// 3. Reducer
export const adminReducer = (state: AdminState, action: AdminAction): AdminState => {
  switch (action.type) {
    case 'FETCH_DATA_START':
      return { ...state, loading: true };
    case 'FETCH_DATA_SUCCESS':
      return { 
        ...state, 
        loading: false, 
        systems: action.payload.systems, 
        history: action.payload.history, 
        error: null,
      };
    case 'SET_ERROR':
      return { ...state, loading: false, error: action.payload, actionStatus: initialState.actionStatus };
    
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
      return { ...state, selectedSystemIds: [], primarySystemId: '' };
    case 'SCAN_DUPLICATES_SUCCESS':
      return { ...state, duplicateSets: action.payload };
    case 'DELETE_DUPLICATES_SUCCESS':
      return { ...state, duplicateSets: [] };
    case 'CLEAR_DATA_SUCCESS':
      return { ...state, isConfirmingClearAll: false, clearAllConfirmationText: '' };
    case 'SET_BULK_UPLOAD_RESULTS':
      return { ...state, bulkUploadResults: action.payload };
    case 'UPDATE_BULK_UPLOAD_RESULT':
        return { 
            ...state, 
            bulkUploadResults: state.bulkUploadResults.map(r => 
                r.fileName === action.payload.fileName ? { ...r, ...action.payload } : r
            ) 
        };
    case 'UPDATE_BULK_JOB_STATUS':
        return {
            ...state,
            bulkUploadResults: state.bulkUploadResults.map(r => 
                r.jobId === action.payload.jobId ? { ...r, error: action.payload.status } : r
            ),
        };
    case 'UPDATE_BULK_JOB_COMPLETED':
        const { jobId, record } = action.payload;
        return {
            ...state,
            bulkUploadResults: state.bulkUploadResults.map(r =>
                r.jobId === jobId ? { ...r, data: record.analysis, error: 'completed', recordId: record.id, weather: record.weather } : r
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
      return { ...state, historySortKey: key, historySortDirection: direction, historyPage: 1 };
    }
    case 'SET_SYSTEMS_PAGE':
      return { ...state, systemsPage: action.payload };
    case 'SET_HISTORY_PAGE':
      return { ...state, historyPage: action.payload, expandedHistoryId: null };
    default:
      return state;
  }
};

// 4. Context, Provider, Hook
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