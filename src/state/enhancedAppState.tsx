import React, { createContext, Dispatch, useContext, useReducer, useMemo, useCallback } from 'react';
import type {
  AnalysisRecord,
  BmsSystem,
  DisplayableAnalysisResult,
  InsightMode,
  AIFeedback,
  MonitoringDashboardData
} from '../types';
import { InsightMode as InsightModeEnum } from '../types';
import { BMSError, ErrorType, ErrorSeverity } from '../utils/asyncErrorHandler';
import { ValidationUtils } from '../utils/validation';

/**
 * Enhanced state management with better type safety, performance optimizations,
 * and comprehensive error handling
 */

// Enhanced state shape with better type safety
export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page?: number;
  readonly pageSize?: number;
  readonly hasNextPage?: boolean;
  readonly hasPreviousPage?: boolean;
}

export interface LoadingState {
  readonly isLoading: boolean;
  readonly operation?: string;
  readonly progress?: number;
  readonly startedAt?: number;
}

export interface ErrorState {
  readonly error: BMSError | null;
  readonly context?: Record<string, unknown>;
  readonly errorId?: string;
  readonly canRetry?: boolean;
}

export interface SyncState {
  readonly isSyncing: boolean;
  readonly lastSyncTime: Record<string, number>;
  readonly syncError: BMSError | null;
  readonly syncProgress?: number;
}

export interface CacheState {
  readonly systemsCount: number;
  readonly historyCount: number;
  readonly cacheSizeBytes: number;
  readonly lastCacheUpdate?: number;
  readonly cacheHitRate?: number;
}

export interface CircuitBreakerState {
  readonly insights: 'closed' | 'open' | 'half-open';
  readonly analysis: 'closed' | 'open' | 'half-open';
  readonly lastTripped?: {
    readonly service: string;
    readonly reason: string;
    readonly at: number;
  };
}

export interface ConsentState {
  readonly insightsConsented: boolean;
  readonly consentedAt?: number;
  readonly consentVersion?: string;
  readonly privacyPolicyAccepted?: boolean;
  readonly dataRetentionConsent?: boolean;
}

export interface PendingResume {
  readonly recordId: string;
  readonly resumeJobId: string;
  readonly attempts: number;
  readonly lastAttempt: number;
  readonly nextAttempt?: number;
}

export interface InsightState {
  readonly isLoading: boolean;
  readonly insights?: string;
  readonly error?: BMSError;
  readonly resumeJobId?: string;
  readonly requestedAt?: number;
  readonly completedAt?: number;
}

export interface RegistrationState {
  readonly isRegistering: boolean;
  readonly error: BMSError | null;
  readonly successMessage: string | null;
  readonly isModalOpen: boolean;
  readonly context: {
    readonly hardwareSystemId: string;
  } | null;
}

export interface AppState {
  readonly analysisResults: readonly DisplayableAnalysisResult[];
  readonly loading: LoadingState;
  readonly error: ErrorState;
  readonly registration: RegistrationState;
  readonly registeredSystems: PaginatedResponse<BmsSystem>;
  readonly analysisHistory: PaginatedResponse<AnalysisRecord>;
  readonly sync: SyncState;
  readonly cache: CacheState;
  readonly circuitBreakers: CircuitBreakerState;
  readonly consent: ConsentState;
  readonly pendingResumes: readonly PendingResume[];
  readonly insightsState: Record<string, InsightState>;
  readonly selectedInsightMode: InsightMode;
  readonly ui: {
    readonly theme: 'light' | 'dark' | 'auto';
    readonly sidebarOpen: boolean;
    readonly notifications: readonly Notification[];
  };
  readonly monitoring: MonitoringDashboardData | null;
  readonly feedback: readonly AIFeedback[];
}

export interface Notification {
  readonly id: string;
  readonly type: 'info' | 'success' | 'warning' | 'error';
  readonly title: string;
  readonly message: string;
  readonly timestamp: number;
  readonly autoClose?: boolean;
  readonly actions?: ReadonlyArray<{
    readonly label: string;
    readonly action: string;
    readonly type?: 'primary' | 'secondary';
  }>;
}

export const initialState: AppState = {
  analysisResults: [],
  loading: { isLoading: false },
  error: { error: null },
  registration: {
    isRegistering: false,
    error: null,
    successMessage: null,
    isModalOpen: false,
    context: null,
  },
  registeredSystems: { items: [], total: 0 },
  analysisHistory: { items: [], total: 0 },
  sync: {
    isSyncing: false,
    lastSyncTime: {},
    syncError: null,
  },
  cache: {
    systemsCount: 0,
    historyCount: 0,
    cacheSizeBytes: 0,
  },
  circuitBreakers: {
    insights: 'closed',
    analysis: 'closed',
  },
  consent: {
    insightsConsented: false,
  },
  pendingResumes: [],
  insightsState: {},
  selectedInsightMode: InsightModeEnum.WITH_TOOLS,
  ui: {
    theme: 'auto',
    sidebarOpen: false,
    notifications: [],
  },
  monitoring: null,
  feedback: [],
} as const;

// Enhanced action types with better type safety
export type AppAction =
  // Analysis actions
  | { type: 'ANALYSIS_PREPARE'; payload: { results: readonly DisplayableAnalysisResult[] } }
  | { type: 'ANALYSIS_UPDATE_STATUS'; payload: { fileName: string; status: string } }
  | { type: 'ANALYSIS_BATCH_UPDATE_STATUS'; payload: ReadonlyArray<{ fileName: string; status: string }> }
  | { type: 'ANALYSIS_COMPLETE_SYNC'; payload: { fileName: string; record: AnalysisRecord; isDuplicate?: boolean } }
  | { type: 'ANALYSIS_COMPLETE_BATCH'; payload: ReadonlyArray<{ fileName: string; record: AnalysisRecord; isDuplicate?: boolean }> }
  | { type: 'ANALYSIS_COMPLETE' }

  // Loading actions
  | { type: 'LOADING_START'; payload: { operation?: string; progress?: number } }
  | { type: 'LOADING_UPDATE'; payload: { progress?: number; operation?: string } }
  | { type: 'LOADING_STOP' }

  // Error actions
  | { type: 'ERROR_SET'; payload: { error: BMSError; context?: Record<string, unknown> } }
  | { type: 'ERROR_CLEAR' }
  | { type: 'ERROR_RETRY'; payload: { errorId: string } }

  // Data actions
  | { type: 'DATA_FETCH_SUCCESS'; payload: { systems: PaginatedResponse<BmsSystem>; history: PaginatedResponse<AnalysisRecord> } }
  | { type: 'DATA_INVALIDATE'; payload: { collections?: readonly string[] } }

  // Registration actions
  | { type: 'REGISTRATION_MODAL_OPEN'; payload: { hardwareSystemId: string } }
  | { type: 'REGISTRATION_MODAL_CLOSE' }
  | { type: 'REGISTRATION_START' }
  | { type: 'REGISTRATION_SUCCESS'; payload: { message: string } }
  | { type: 'REGISTRATION_ERROR'; payload: { error: BMSError } }

  // Sync actions
  | { type: 'SYNC_START'; payload: { progress?: number } }
  | { type: 'SYNC_UPDATE'; payload: { progress: number; lastSyncTime?: Record<string, number> } }
  | { type: 'SYNC_SUCCESS'; payload: { lastSyncTime: Record<string, number> } }
  | { type: 'SYNC_ERROR'; payload: { error: BMSError } }

  // Cache actions
  | { type: 'CACHE_UPDATE'; payload: Partial<CacheState> }
  | { type: 'CACHE_CLEAR'; payload: { collections?: readonly string[] } }

  // Circuit breaker actions
  | { type: 'CIRCUIT_BREAKER_UPDATE'; payload: { service: 'insights' | 'analysis'; state: 'closed' | 'open' | 'half-open'; reason?: string } }
  | { type: 'CIRCUIT_BREAKER_RESET' }

  // Consent actions
  | { type: 'CONSENT_GRANT'; payload: { consentVersion: string; privacyPolicy?: boolean; dataRetention?: boolean } }
  | { type: 'CONSENT_REVOKE' }
  | { type: 'CONSENT_UPDATE'; payload: Partial<ConsentState> }

  // Insights actions
  | { type: 'INSIGHTS_REQUEST'; payload: { recordId: string; mode: InsightMode } }
  | { type: 'INSIGHTS_SUCCESS'; payload: { recordId: string; insights: string; completedAt?: number } }
  | { type: 'INSIGHTS_ERROR'; payload: { recordId: string; error: BMSError } }
  | { type: 'INSIGHTS_RETRY'; payload: { recordId: string; resumeJobId: string } }
  | { type: 'INSIGHTS_TIMEOUT'; payload: { recordId: string; resumeJobId: string } }
  | { type: 'INSIGHTS_MODE_SET'; payload: { mode: InsightMode } }

  // UI actions
  | { type: 'UI_THEME_SET'; payload: { theme: 'light' | 'dark' | 'auto' } }
  | { type: 'UI_SIDEBAR_TOGGLE'; payload: { open?: boolean } }
  | { type: 'UI_NOTIFICATION_ADD'; payload: { notification: Notification } }
  | { type: 'UI_NOTIFICATION_REMOVE'; payload: { id: string } }
  | { type: 'UI_NOTIFICATION_CLEAR' }

  // Monitoring actions
  | { type: 'MONITORING_UPDATE'; payload: { data: MonitoringDashboardData } }

  // Feedback actions
  | { type: 'FEEDBACK_ADD'; payload: { feedback: AIFeedback } }
  | { type: 'FEEDBACK_UPDATE'; payload: { id: string; updates: Partial<AIFeedback> } }
  | { type: 'FEEDBACK_REMOVE'; payload: { id: string } };

// Enhanced reducer with proper immutability and validation
export const appReducer = (state: AppState, action: AppAction): AppState => {
  // Validate action payload in development
  if (process.env.NODE_ENV === 'development') {
    validateAction(action);
  }

  switch (action.type) {
    case 'ANALYSIS_PREPARE': {
      const { results } = action.payload;
      const existingFileNames = new Set(state.analysisResults.map(r => r.fileName));
      const newResults = results.filter(r => !existingFileNames.has(r.fileName));

      return {
        ...state,
        analysisResults: [...state.analysisResults, ...newResults],
        loading: { ...state.loading, isLoading: true, operation: 'Preparing analysis' },
        error: { ...state.error, error: null },
      };
    }

    case 'ANALYSIS_UPDATE_STATUS': {
      const { fileName, status } = action.payload;
      return {
        ...state,
        analysisResults: state.analysisResults.map(r =>
          r.fileName === fileName ? { ...r, error: status } : r
        ),
      };
    }

    case 'ANALYSIS_BATCH_UPDATE_STATUS': {
      const updates = action.payload;
      const updateMap = new Map(updates.map(u => [u.fileName, u.status]));

      return {
        ...state,
        analysisResults: state.analysisResults.map(r => {
          const status = updateMap.get(r.fileName);
          return status ? { ...r, error: status } : r;
        }),
      };
    }

    case 'ANALYSIS_COMPLETE_SYNC': {
      const { fileName, record, isDuplicate = false } = action.payload;

      return {
        ...state,
        analysisResults: state.analysisResults.map(r =>
          r.fileName === fileName
            ? {
                ...r,
                data: record.analysis,
                weather: record.weather,
                solar: record.solar,
                weatherImpact: record.weatherImpact,
                recordId: record.id,
                isDuplicate,
                needsReview: record.needsReview,
                validationWarnings: record.validationWarnings,
                error: null,
              }
            : r
        ),
        analysisHistory: {
          ...state.analysisHistory,
          items: [record, ...state.analysisHistory.items],
          total: state.analysisHistory.total + 1,
        },
      };
    }

    case 'ANALYSIS_COMPLETE_BATCH': {
      const updates = action.payload;
      const updateMap = new Map(updates.map(u => [u.fileName, { record: u.record, isDuplicate: u.isDuplicate }]));
      const newRecords = updates.map(u => u.record);

      return {
        ...state,
        analysisResults: state.analysisResults.map(r => {
          const update = updateMap.get(r.fileName);
          return update
            ? {
                ...r,
                data: update.record.analysis,
                weather: update.record.weather,
                solar: update.record.solar,
                weatherImpact: update.record.weatherImpact,
                recordId: update.record.id,
                isDuplicate: update.isDuplicate || false,
                needsReview: update.record.needsReview,
                validationWarnings: update.record.validationWarnings,
                error: null,
              }
            : r;
        }),
        analysisHistory: {
          ...state.analysisHistory,
          items: [...newRecords, ...state.analysisHistory.items],
          total: state.analysisHistory.total + newRecords.length,
        },
      };
    }

    case 'ANALYSIS_COMPLETE': {
      return {
        ...state,
        loading: { ...state.loading, isLoading: false, operation: undefined },
      };
    }

    case 'LOADING_START': {
      const { operation, progress } = action.payload;
      return {
        ...state,
        loading: {
          isLoading: true,
          operation,
          progress,
          startedAt: Date.now(),
        },
      };
    }

    case 'LOADING_UPDATE': {
      const { progress, operation } = action.payload;
      return {
        ...state,
        loading: {
          ...state.loading,
          progress,
          operation: operation ?? state.loading.operation,
        },
      };
    }

    case 'LOADING_STOP': {
      return {
        ...state,
        loading: {
          isLoading: false,
        },
      };
    }

    case 'ERROR_SET': {
      const { error, context } = action.payload;
      return {
        ...state,
        error: {
          error,
          context,
          errorId: `error_${Date.now()}`,
          canRetry: error.retryable,
        },
        loading: { ...state.loading, isLoading: false },
      };
    }

    case 'ERROR_CLEAR': {
      return {
        ...state,
        error: { error: null },
      };
    }

    case 'DATA_FETCH_SUCCESS': {
      const { systems, history } = action.payload;
      return {
        ...state,
        registeredSystems: systems,
        analysisHistory: history,
        error: { ...state.error, error: null },
      };
    }

    case 'REGISTRATION_MODAL_OPEN': {
      const { hardwareSystemId } = action.payload;
      return {
        ...state,
        registration: {
          ...state.registration,
          isModalOpen: true,
          context: { hardwareSystemId },
        },
      };
    }

    case 'REGISTRATION_MODAL_CLOSE': {
      return {
        ...state,
        registration: {
          ...state.registration,
          isModalOpen: false,
          context: null,
          error: null,
          successMessage: null,
        },
      };
    }

    case 'REGISTRATION_START': {
      return {
        ...state,
        registration: {
          ...state.registration,
          isRegistering: true,
          error: null,
          successMessage: null,
        },
      };
    }

    case 'REGISTRATION_SUCCESS': {
      const { message } = action.payload;
      return {
        ...state,
        registration: {
          ...state.registration,
          isRegistering: false,
          successMessage: message,
        },
      };
    }

    case 'REGISTRATION_ERROR': {
      const { error } = action.payload;
      return {
        ...state,
        registration: {
          ...state.registration,
          isRegistering: false,
          error,
        },
      };
    }

    case 'SYNC_START': {
      const { progress } = action.payload;
      return {
        ...state,
        sync: {
          ...state.sync,
          isSyncing: true,
          syncProgress: progress,
          syncError: null,
        },
      };
    }

    case 'SYNC_UPDATE': {
      const { progress, lastSyncTime } = action.payload;
      return {
        ...state,
        sync: {
          ...state.sync,
          syncProgress: progress,
          lastSyncTime: lastSyncTime ?? state.sync.lastSyncTime,
        },
      };
    }

    case 'SYNC_SUCCESS': {
      const { lastSyncTime } = action.payload;
      return {
        ...state,
        sync: {
          ...state.sync,
          isSyncing: false,
          lastSyncTime,
          syncError: null,
          syncProgress: undefined,
        },
      };
    }

    case 'SYNC_ERROR': {
      const { error } = action.payload;
      return {
        ...state,
        sync: {
          ...state.sync,
          isSyncing: false,
          syncError: error,
          syncProgress: undefined,
        },
      };
    }

    case 'CACHE_UPDATE': {
      return {
        ...state,
        cache: {
          ...state.cache,
          ...action.payload,
          lastCacheUpdate: Date.now(),
        },
      };
    }

    case 'CIRCUIT_BREAKER_UPDATE': {
      const { service, state: cbState, reason } = action.payload;
      return {
        ...state,
        circuitBreakers: {
          ...state.circuitBreakers,
          [service]: cbState,
          lastTripped: reason
            ? {
                service,
                reason,
                at: Date.now(),
              }
            : state.circuitBreakers.lastTripped,
        },
      };
    }

    case 'CIRCUIT_BREAKER_RESET': {
      return {
        ...state,
        circuitBreakers: {
          insights: 'closed',
          analysis: 'closed',
          lastTripped: state.circuitBreakers.lastTripped,
        },
      };
    }

    case 'CONSENT_GRANT': {
      const { consentVersion, privacyPolicy, dataRetention } = action.payload;
      return {
        ...state,
        consent: {
          insightsConsented: true,
          consentedAt: Date.now(),
          consentVersion,
          privacyPolicyAccepted: privacyPolicy ?? state.consent.privacyPolicyAccepted,
          dataRetentionConsent: dataRetention ?? state.consent.dataRetentionConsent,
        },
      };
    }

    case 'CONSENT_REVOKE': {
      return {
        ...state,
        consent: {
          insightsConsented: false,
          consentedAt: undefined,
          consentVersion: undefined,
          privacyPolicyAccepted: undefined,
          dataRetentionConsent: undefined,
        },
      };
    }

    case 'INSIGHTS_REQUEST': {
      const { recordId } = action.payload;
      return {
        ...state,
        insightsState: {
          ...state.insightsState,
          [recordId]: {
            isLoading: true,
            insights: undefined,
            error: undefined,
            requestedAt: Date.now(),
          },
        },
      };
    }

    case 'INSIGHTS_SUCCESS': {
      const { recordId, insights, completedAt } = action.payload;
      return {
        ...state,
        insightsState: {
          ...state.insightsState,
          [recordId]: {
            isLoading: false,
            insights,
            error: undefined,
            completedAt: completedAt ?? Date.now(),
          },
        },
      };
    }

    case 'INSIGHTS_ERROR': {
      const { recordId, error } = action.payload;
      return {
        ...state,
        insightsState: {
          ...state.insightsState,
          [recordId]: {
            isLoading: false,
            insights: undefined,
            error,
          },
        },
      };
    }

    case 'INSIGHTS_MODE_SET': {
      const { mode } = action.payload;
      return {
        ...state,
        selectedInsightMode: mode,
      };
    }

    case 'UI_THEME_SET': {
      const { theme } = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          theme,
        },
      };
    }

    case 'UI_SIDEBAR_TOGGLE': {
      const { open } = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          sidebarOpen: open ?? !state.ui.sidebarOpen,
        },
      };
    }

    case 'UI_NOTIFICATION_ADD': {
      const { notification } = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          notifications: [...state.ui.notifications, notification],
        },
      };
    }

    case 'UI_NOTIFICATION_REMOVE': {
      const { id } = action.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          notifications: state.ui.notifications.filter(n => n.id !== id),
        },
      };
    }

    case 'UI_NOTIFICATION_CLEAR': {
      return {
        ...state,
        ui: {
          ...state.ui,
          notifications: [],
        },
      };
    }

    case 'MONITORING_UPDATE': {
      const { data } = action.payload;
      return {
        ...state,
        monitoring: data,
      };
    }

    case 'FEEDBACK_ADD': {
      const { feedback } = action.payload;
      return {
        ...state,
        feedback: [...state.feedback, feedback],
      };
    }

    case 'FEEDBACK_UPDATE': {
      const { id, updates } = action.payload;
      return {
        ...state,
        feedback: state.feedback.map(f =>
          f.id === id ? { ...f, ...updates, updatedAt: new Date() } : f
        ),
      };
    }

    case 'FEEDBACK_REMOVE': {
      const { id } = action.payload;
      return {
        ...state,
        feedback: state.feedback.filter(f => f.id !== id),
      };
    }

    default:
      return state;
  }
};

function validateAction(action: AppAction): void {
  // Basic payload validation in development
  if (!action.type) {
    console.error('[State] Action missing type:', action);
  }

  // Validate required payload fields for specific actions
  switch (action.type) {
    case 'ERROR_SET':
      if (!action.payload.error) {
        console.error('[State] ERROR_SET action missing error:', action);
      }
      break;
    case 'REGISTRATION_SUCCESS':
      if (!action.payload.message) {
        console.error('[State] REGISTRATION_SUCCESS action missing message:', action);
      }
      break;
    // Add more validations as needed
  }
}

// Context and provider with performance optimizations
const AppStateContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
} | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({ state, dispatch }),
    [state, dispatch]
  );

  return (
    <AppStateContext.Provider value={contextValue}>
      {children}
    </AppStateContext.Provider>
  );
};

// Enhanced hook with better error handling
export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new BMSError('useAppState must be used within an AppStateProvider', {
      type: ErrorType.CLIENT,
      severity: ErrorSeverity.HIGH,
      retryable: false,
    });
  }
  return context;
};

// Selector hooks for performance optimization
export const useAppSelector = <T>(selector: (state: AppState) => T): T => {
  const { state } = useAppState();
  return useMemo(() => selector(state), [state, selector]);
};

// Action creator hooks for better DX
export const useAppActions = () => {
  const { dispatch } = useAppState();

  return useMemo(() => ({
    // Analysis actions
    prepareAnalysis: (results: readonly DisplayableAnalysisResult[]) =>
      dispatch({ type: 'ANALYSIS_PREPARE', payload: { results } }),

    updateAnalysisStatus: (fileName: string, status: string) =>
      dispatch({ type: 'ANALYSIS_UPDATE_STATUS', payload: { fileName, status } }),

    completeAnalysis: (fileName: string, record: AnalysisRecord, isDuplicate?: boolean) =>
      dispatch({ type: 'ANALYSIS_COMPLETE_SYNC', payload: { fileName, record, isDuplicate } }),

    // Loading actions
    startLoading: (operation?: string, progress?: number) =>
      dispatch({ type: 'LOADING_START', payload: { operation, progress } }),

    updateLoading: (progress?: number, operation?: string) =>
      dispatch({ type: 'LOADING_UPDATE', payload: { progress, operation } }),

    stopLoading: () =>
      dispatch({ type: 'LOADING_STOP' }),

    // Error actions
    setError: (error: BMSError, context?: Record<string, unknown>) =>
      dispatch({ type: 'ERROR_SET', payload: { error, context } }),

    clearError: () =>
      dispatch({ type: 'ERROR_CLEAR' }),

    // UI actions
    toggleSidebar: (open?: boolean) =>
      dispatch({ type: 'UI_SIDEBAR_TOGGLE', payload: { open } }),

    addNotification: (notification: Notification) =>
      dispatch({ type: 'UI_NOTIFICATION_ADD', payload: { notification } }),

    removeNotification: (id: string) =>
      dispatch({ type: 'UI_NOTIFICATION_REMOVE', payload: { id } }),

  }), [dispatch]);
};

export default {
  AppStateProvider,
  useAppState,
  useAppSelector,
  useAppActions,
  initialState,
};