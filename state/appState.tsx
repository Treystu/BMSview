import React, { createContext, useReducer, useContext, Dispatch } from 'react';
import type { BmsSystem, DisplayableAnalysisResult, AnalysisRecord } from '../types';

type JobCreationResponse = {
    fileName: string;
    jobId?: string;
    status: string;
    error?: string;
    duplicateRecordId?: string;
};

// 1. State Shape
export interface AppState {
  analysisResults: DisplayableAnalysisResult[];
  isLoading: boolean;
  error: string | null;
  isRegistering: boolean;
  registrationError: string | null;
  registrationSuccess: string | null;
  isRegisterModalOpen: boolean;
  registeredSystems: BmsSystem[];
  analysisHistory: AnalysisRecord[];
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
  | { type: 'START_ANALYSIS_JOBS'; payload: JobCreationResponse[] }
  | { type: 'UPDATE_JOB_STATUS'; payload: { jobId: string; status: string } }
  | { type: 'UPDATE_JOB_COMPLETED'; payload: { jobId: string; record: AnalysisRecord } }
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
  | { type: 'ASSIGN_SYSTEM_TO_ANALYSIS'; payload: { fileName: string; systemId: string } }
  | { type: 'JOB_TIMED_OUT'; payload: { jobId: string } };

// 3. Reducer
const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'PREPARE_ANALYSIS':
      // Filter out any files that are already present in the results by filename to prevent duplicates from re-uploads.
      const existingFileNames = new Set(state.analysisResults.map(r => r.fileName));
      const newResults = action.payload.filter(p => !existingFileNames.has(p.fileName));
      return { ...state, isLoading: true, error: null, analysisResults: [...state.analysisResults, ...newResults] };

    case 'START_ANALYSIS_JOBS': {
        const jobsMap = new Map<string, JobCreationResponse>();
        action.payload.forEach(job => jobsMap.set(job.fileName, job));
        const historyMap = new Map(state.analysisHistory.map(r => [r.id, r]));

        return {
            ...state,
            isLoading: false, // Stop global loading, individual items show progress.
            analysisResults: state.analysisResults.map(r => {
                const job = jobsMap.get(r.fileName);
                if (!job) return r; // Not part of this job submission batch

                if (job.status === 'duplicate_history' && job.duplicateRecordId) {
                    const originalRecord = historyMap.get(job.duplicateRecordId);
                    return { 
                        ...r, 
                        isDuplicate: true,
                        isBatchDuplicate: false,
                        data: originalRecord?.analysis || null,
                        weather: originalRecord?.weather,
                        recordId: originalRecord?.id,
                        error: null, // Clear 'submitting' status
                    };
                }
                 if (job.status === 'duplicate_batch') {
                    return {
                        ...r,
                        isDuplicate: true,
                        isBatchDuplicate: true,
                        error: null,
                    };
                }
                
                return { ...r, jobId: job.jobId, error: job.status };
            })
        };
    }
    
    case 'UPDATE_JOB_STATUS':
      return {
        ...state,
        analysisResults: state.analysisResults.map(r => 
          r.jobId === action.payload.jobId ? { ...r, error: action.payload.status } : r
        ),
      };

    case 'UPDATE_JOB_COMPLETED':
      const { jobId, record } = action.payload;
      return {
        ...state,
        analysisResults: state.analysisResults.map(r => 
          r.jobId === jobId ? {
            ...r,
            data: record.analysis,
            weather: record.weather,
            recordId: record.id,
            error: 'completed'
          } : r
        ),
      };
      
    case 'JOB_TIMED_OUT':
        return {
            ...state,
            analysisResults: state.analysisResults.map(r =>
                r.jobId === action.payload.jobId ? { ...r, error: 'failed_client_timeout', jobId: undefined } : r
            ),
        };

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
