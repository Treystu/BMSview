import React, { createContext, useReducer, useContext, Dispatch } from 'react';
import type { BmsSystem, DisplayableAnalysisResult, AnalysisRecord } from '../types';

// ***REMOVED***: JobCreationResponse is no longer needed.

// 1. State Shape
export interface AppState {
  analysisResults: DisplayableAnalysisResult[];
  isLoading: boolean; // This now means "is processing *any* file"
  error: string | null;
  isRegistering: boolean;
  registrationError: string | null;
  registrationSuccess: string | null;
  isRegisterModalOpen: boolean;
  registeredSystems: BmsSystem[]; // This should be PaginatedResponse<BmsSystem>
  analysisHistory: AnalysisRecord[]; // This should be PaginatedResponse<AnalysisRecord>
  registrationContext: {
    dlNumber: string;
  } | null;
}

export const initialState: AppState = {
  analysisResults: [],
  isLoading: false,
  error: null,
  isRegistering: false,
  registrationError: null,
  registrationSuccess: null,
  isRegisterModalOpen: false,
  registeredSystems: [],
  analysisHistory: [],
  registrationContext: null,
};

// 2. Actions
export type AppAction =
  | { type: 'PREPARE_ANALYSIS'; payload: DisplayableAnalysisResult[] }
  // ***MODIFIED***: Simplified actions. No more job IDs.
  | { type: 'UPDATE_ANALYSIS_STATUS'; payload: { fileName: string; status: string } }
  | { type: 'SYNC_ANALYSIS_COMPLETE'; payload: { fileName: string; record: AnalysisRecord } }
  | { type: 'ANALYSIS_COMPLETE' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'FETCH_DATA_SUCCESS'; payload: { systems: BmsSystem[]; history: AnalysisRecord[] } }
  | { type: 'OPEN_REGISTER_MODAL'; payload: { dlNumber: string } }
  | { type: 'CLOSE_REGISTER_MODAL' }
  | { type: 'REGISTER_SYSTEM_START' }
  | { type: 'REGISTER_SYSTEM_SUCCESS'; payload: string }
  | { type: 'REGISTER_SYSTEM_ERROR'; payload: string | null }
  | { type: 'UPDATE_RESULTS_AFTER_LINK' }
  | { type: 'REPROCESS_START'; payload: { fileName: string } }
  | { type: 'ASSIGN_SYSTEM_TO_ANALYSIS'; payload: { fileName: string; systemId: string } };
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
      const { fileName, record } = action.payload;
      return {
        ...state,
        analysisResults: state.analysisResults.map(r => 
          r.fileName === fileName ? {
            ...r,
            data: record.analysis,
            weather: record.weather,
            recordId: record.id,
            error: null, // Clear 'Submitting' or 'Processing' status
          } : r
        ),
        // Add to history so it can be linked immediately
        analysisHistory: {
          ...state.analysisHistory,
          items: [record, ...(state.analysisHistory.items || [])]
        }
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

