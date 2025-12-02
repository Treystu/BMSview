import React, { createContext, Dispatch, useContext, useReducer } from 'react';
import type { AnalysisRecord, BmsSystem, DisplayableAnalysisResult, InsightMode } from '../types';
import { InsightMode as InsightModeEnum } from '../types';

// ***REMOVED***: JobCreationResponse is no longer needed.

// 1. State Shape
export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
};

export interface AppState {
  analysisResults: DisplayableAnalysisResult[];
  isLoading: boolean; // This now means "is processing *any* file"
  error: string | null;
  isRegistering: boolean;
  registrationError: string | null;
  registrationSuccess: string | null;
  isRegisterModalOpen: boolean;
  // Can be the new paginated response shape or legacy array while we migrate
  registeredSystems: PaginatedResponse<BmsSystem> | BmsSystem[];
  analysisHistory: PaginatedResponse<AnalysisRecord> | AnalysisRecord[];
  registrationContext: {
    dlNumber: string;
  } | null;
  // Local-first sync status fields
  isSyncing: boolean;
  lastSyncTime: Record<string, number>; // e.g., { systems: 1699..., history: 1699... }
  syncError: string | null;
  cacheStats: {
    systemsCount: number;
    historyCount: number;
    cacheSizeBytes: number;
  };
  // Circuit breaker state for error recovery UI
  circuitBreakers: {
    insights: 'closed' | 'open' | 'half-open';
    analysis: 'closed' | 'open' | 'half-open';
    lastTripped?: { service: string; reason: string; at: number };
  };
  // Consent tracking for insights/AI features
  consentStatus: {
    insightsConsented: boolean;
    consentedAt?: number;
    consentVersion?: string;
  };
  // Pending resume jobs for timeout recovery
  pendingResumes: Array<{
    recordId: string;
    resumeJobId: string;
    attempts: number;
    lastAttempt: number;
  }>;
  // Per-record insights state tracking
  insightsState: Record<string, {
    isLoading: boolean;
    insights?: string;
    error?: string;
    resumeJobId?: string;
  }>;
  // Selected insight generation mode
  selectedInsightMode: InsightMode;
}

export const initialState: AppState = {
  analysisResults: [],
  isLoading: false,
  error: null,
  isRegistering: false,
  registrationError: null,
  registrationSuccess: null,
  isRegisterModalOpen: false,
  // Start with paginated empty shapes to avoid checks elsewhere
  registeredSystems: { items: [], total: 0 },
  analysisHistory: { items: [], total: 0 },
  registrationContext: null,
  // Local-first sync status
  isSyncing: false,
  lastSyncTime: {},
  syncError: null,
  cacheStats: {
    systemsCount: 0,
    historyCount: 0,
    cacheSizeBytes: 0,
  },
  // Default to WITH_TOOLS mode (Battery Guru - most comprehensive)
  selectedInsightMode: InsightModeEnum.WITH_TOOLS,
  // Circuit breaker initial state
  circuitBreakers: {
    insights: 'closed',
    analysis: 'closed',
  },
  // Consent not granted by default
  consentStatus: {
    insightsConsented: false,
  },
  // No pending resumes initially
  pendingResumes: [],
  // Empty insights state initially
  insightsState: {},
};

// 2. Actions
export type AppAction =
  | { type: 'PREPARE_ANALYSIS'; payload: DisplayableAnalysisResult[] }
  // ***MODIFIED***: Simplified actions. No more job IDs.
  | { type: 'UPDATE_ANALYSIS_STATUS'; payload: { fileName: string; status: string } }
  | { type: 'SYNC_ANALYSIS_COMPLETE'; payload: { fileName: string; record: AnalysisRecord; isDuplicate?: boolean } }
  | { type: 'ANALYSIS_COMPLETE' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'FETCH_DATA_SUCCESS'; payload: { systems: PaginatedResponse<BmsSystem> | BmsSystem[]; history: PaginatedResponse<AnalysisRecord> | AnalysisRecord[] } }
  | { type: 'OPEN_REGISTER_MODAL'; payload: { dlNumber: string } }
  | { type: 'CLOSE_REGISTER_MODAL' }
  | { type: 'REGISTER_SYSTEM_START' }
  | { type: 'REGISTER_SYSTEM_SUCCESS'; payload: string }
  | { type: 'REGISTER_SYSTEM_ERROR'; payload: string | null }
  | { type: 'UPDATE_RESULTS_AFTER_LINK' }
  | { type: 'REPROCESS_START'; payload: { fileName: string } }
  | { type: 'ASSIGN_SYSTEM_TO_ANALYSIS'; payload: { fileName: string; systemId: string } }
  // Sync status actions
  | { type: 'UPDATE_SYNC_STATUS'; payload: { isSyncing: boolean; lastSyncTime?: Record<string, number> } }
  | { type: 'SET_CACHE_STATS'; payload: { systemsCount: number; historyCount: number; cacheSizeBytes: number } }
  | { type: 'SYNC_ERROR'; payload: string | null }
  // Insight mode selection
  | { type: 'SET_INSIGHT_MODE'; payload: InsightMode }
  // Insights lifecycle actions
  | { type: 'INSIGHTS_LOADING'; payload: { recordId: string } }
  | { type: 'INSIGHTS_SUCCESS'; payload: { recordId: string; insights: string } }
  | { type: 'INSIGHTS_ERROR'; payload: { recordId: string; error: string } }
  | { type: 'INSIGHTS_RETRY'; payload: { recordId: string; resumeJobId: string } }
  | { type: 'INSIGHTS_TIMEOUT'; payload: { recordId: string; resumeJobId: string } }
  // Consent flow actions
  | { type: 'CONSENT_GRANTED'; payload: { consentVersion: string } }
  | { type: 'CONSENT_REVOKED' }
  // Circuit breaker actions
  | { type: 'UPDATE_CIRCUIT_BREAKER'; payload: { service: 'insights' | 'analysis'; state: 'closed' | 'open' | 'half-open'; reason?: string } }
  | { type: 'RESET_CIRCUIT_BREAKERS' };
// ***REMOVED***: All job-polling actions are gone.

// 3. Reducer
const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'PREPARE_ANALYSIS':
      // Filter out any files that are already present in the results by filename to prevent duplicates from re-uploads.
      const existingFileNames = new Set(state.analysisResults.map(r => r.fileName));
      const newResults = action.payload.filter(p => !existingFileNames.has(p.fileName));
      return { ...state, isLoading: true, error: null, analysisResults: [...state.analysisResults, ...newResults] };

    // ***REMOVED***: START_ANALYSIS_JOBS is gone.

    case 'UPDATE_ANALYSIS_STATUS':
      return {
        ...state,
        analysisResults: state.analysisResults.map(r =>
          r.fileName === action.payload.fileName ? { ...r, error: action.payload.status } : r
        ),
      };

    case 'SYNC_ANALYSIS_COMPLETE': {
      const { fileName, record, isDuplicate } = action.payload;
      // Update analysisResults
      const updatedResults = state.analysisResults.map(r =>
        r.fileName === fileName ? {
          ...r,
          data: record.analysis,
          weather: record.weather,
          recordId: record.id,
          isDuplicate: isDuplicate || false,
          needsReview: record.needsReview,
          validationWarnings: record.validationWarnings,
          error: null,
        } : r
      );

      // Safely prepend to analysisHistory whether it's an array or paginated object
      let newHistory: AppState['analysisHistory'];
      if (Array.isArray(state.analysisHistory)) {
        newHistory = [record, ...state.analysisHistory];
      } else {
        newHistory = {
          ...state.analysisHistory,
          items: [record, ...(state.analysisHistory.items || [])],
          total: (state.analysisHistory.total || 0) + 1,
        };
      }

      return {
        ...state,
        analysisResults: updatedResults,
        analysisHistory: newHistory,
      };
    }

    // ***REMOVED***: UPDATE_JOB_STATUS and UPDATE_JOB_COMPLETED are gone.

    case 'ANALYSIS_COMPLETE':
      return { ...state, isLoading: false };

    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };

    case 'FETCH_DATA_SUCCESS':
      return {
        ...state,
        registeredSystems: action.payload.systems,
        analysisHistory: action.payload.history,
        error: null,
      };

    case 'OPEN_REGISTER_MODAL':
      return {
        ...state,
        isRegisterModalOpen: true,
        registrationContext: action.payload,
      };

    case 'CLOSE_REGISTER_MODAL':
      return {
        ...state,
        isRegisterModalOpen: false,
        registrationContext: null,
        registrationError: null,
        registrationSuccess: null,
      };

    case 'REGISTER_SYSTEM_START':
      return { ...state, isRegistering: true, registrationError: null, registrationSuccess: null };

    case 'REGISTER_SYSTEM_SUCCESS':
      return { ...state, isRegistering: false, registrationSuccess: action.payload };

    case 'REGISTER_SYSTEM_ERROR':
      return { ...state, isRegistering: false, registrationError: action.payload };

    case 'UPDATE_RESULTS_AFTER_LINK':
      // This just forces a re-render of components listening to results
      return { ...state, analysisResults: [...state.analysisResults] };

    case 'REPROCESS_START':
      return {
        ...state,
        isLoading: true,
        analysisResults: state.analysisResults.map(r =>
          r.fileName === action.payload.fileName
            ? { ...r, data: null, error: 'Submitted', isDuplicate: false, saveError: null, recordId: undefined, jobId: undefined, forcedSystemId: undefined, submittedAt: Date.now() }
            : r
        )
      };

    case 'ASSIGN_SYSTEM_TO_ANALYSIS':
      return {
        ...state,
        analysisResults: state.analysisResults.map(r =>
          r.fileName === action.payload.fileName
            ? { ...r, forcedSystemId: action.payload.systemId }
            : r
        )
      };

    case 'UPDATE_SYNC_STATUS':
      return {
        ...state,
        isSyncing: action.payload.isSyncing,
        lastSyncTime: action.payload.lastSyncTime ?? state.lastSyncTime,
        syncError: null,
      };

    case 'SET_CACHE_STATS':
      return {
        ...state,
        cacheStats: action.payload,
      };

    case 'SYNC_ERROR':
      return {
        ...state,
        syncError: action.payload,
        isSyncing: false,
      };

    case 'SET_INSIGHT_MODE':
      return {
        ...state,
        selectedInsightMode: action.payload,
      };

    case 'INSIGHTS_LOADING':
      return {
        ...state,
        insightsState: {
          ...state.insightsState,
          [action.payload.recordId]: {
            isLoading: true,
            insights: undefined,
            error: undefined,
          },
        },
      };

    case 'INSIGHTS_SUCCESS':
      return {
        ...state,
        insightsState: {
          ...state.insightsState,
          [action.payload.recordId]: {
            isLoading: false,
            insights: action.payload.insights,
            error: undefined,
          },
        },
      };

    case 'INSIGHTS_ERROR':
      return {
        ...state,
        insightsState: {
          ...state.insightsState,
          [action.payload.recordId]: {
            isLoading: false,
            insights: undefined,
            error: action.payload.error,
          },
        },
      };

    case 'INSIGHTS_RETRY':
      return {
        ...state,
        insightsState: {
          ...state.insightsState,
          [action.payload.recordId]: {
            isLoading: true,
            insights: undefined,
            error: undefined,
            resumeJobId: action.payload.resumeJobId,
          },
        },
      };

    case 'INSIGHTS_TIMEOUT':
      // Add to pending resumes for potential retry
      return {
        ...state,
        pendingResumes: [
          ...state.pendingResumes,
          {
            recordId: action.payload.recordId,
            resumeJobId: action.payload.resumeJobId,
            attempts: 1,
            lastAttempt: Date.now(),
          },
        ],
        insightsState: {
          ...state.insightsState,
          [action.payload.recordId]: {
            isLoading: false,
            insights: undefined,
            error: 'Request timed out. Resume job created.',
            resumeJobId: action.payload.resumeJobId,
          },
        },
      };

    case 'CONSENT_GRANTED':
      return {
        ...state,
        consentStatus: {
          insightsConsented: true,
          consentedAt: Date.now(),
          consentVersion: action.payload.consentVersion,
        },
      };

    case 'CONSENT_REVOKED':
      return {
        ...state,
        consentStatus: {
          insightsConsented: false,
          consentedAt: undefined,
          consentVersion: undefined,
        },
      };

    case 'UPDATE_CIRCUIT_BREAKER':
      return {
        ...state,
        circuitBreakers: {
          ...state.circuitBreakers,
          [action.payload.service]: action.payload.state,
          lastTripped: action.payload.reason
            ? {
                service: action.payload.service,
                reason: action.payload.reason,
                at: Date.now(),
              }
            : state.circuitBreakers.lastTripped,
        },
      };

    case 'RESET_CIRCUIT_BREAKERS':
      return {
        ...state,
        circuitBreakers: {
          insights: 'closed',
          analysis: 'closed',
        },
      };

    default:
      return state;
  }
};

// 4. Context and Provider
const AppStateContext = createContext<{ state: AppState; dispatch: Dispatch<AppAction> } | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      {children}
    </AppStateContext.Provider>
  );
};

// 5. Custom Hook
export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (context === undefined) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
};

