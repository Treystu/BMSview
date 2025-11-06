# BMSview State Management Guide

## Overview

BMSview uses **React Context API with Reducers** for state management. The application has **two separate, independent state contexts** that serve different parts of the application.

## Architecture

### Two Independent State Contexts

```
┌─────────────────────────────────────────────────┐
│                    BMSview App                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────┐  ┌──────────────────┐  │
│  │   Public App       │  │  Admin Dashboard │  │
│  │   (index.html)     │  │  (admin.html)    │  │
│  ├────────────────────┤  ├──────────────────┤  │
│  │                    │  │                  │  │
│  │  AppStateProvider  │  │ AdminStateProvider│  │
│  │  ┌──────────────┐  │  │ ┌──────────────┐│  │
│  │  │  AppState    │  │  │ │  AdminState  ││  │
│  │  │  (appState.tsx)│ │  │ │ (adminState.tsx)│
│  │  └──────────────┘  │  │ └──────────────┘│  │
│  │                    │  │                  │  │
│  └────────────────────┘  └──────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Why Two Separate Contexts?

1. **Separation of Concerns**: Public and admin features have different requirements
2. **Performance**: Prevents unnecessary re-renders across different app sections
3. **Security**: Admin state is only available to authenticated users
4. **Maintainability**: Easier to reason about and modify independently

## State Context 1: AppState (Public App)

### Location
- **Definition**: `state/appState.tsx`
- **Provider**: `index.tsx` wraps `<App />` with `<AppStateProvider>`
- **Usage**: Main public-facing BMS analysis interface

### State Shape

```typescript
interface AppState {
  // Analysis Results
  analysisResults: DisplayableAnalysisResult[];  // Current upload/analysis results
  isLoading: boolean;                            // Processing status
  error: string | null;                          // Error messages
  
  // System Registration
  isRegisterModalOpen: boolean;                  // Registration modal state
  isRegistering: boolean;                        // Registration in progress
  registrationError: string | null;              // Registration errors
  registrationSuccess: string | null;            // Registration success message
  registrationContext: { dlNumber: string } | null;
  
  // Data from Backend
  registeredSystems: PaginatedResponse<BmsSystem> | BmsSystem[];
  analysisHistory: PaginatedResponse<AnalysisRecord> | AnalysisRecord[];
}
```

### Key Actions

```typescript
type AppAction =
  | { type: 'PREPARE_ANALYSIS'; payload: DisplayableAnalysisResult[] }
  | { type: 'UPDATE_ANALYSIS_STATUS'; payload: { fileName: string; status: string } }
  | { type: 'SYNC_ANALYSIS_COMPLETE'; payload: { fileName: string; record: AnalysisRecord; isDuplicate?: boolean } }
  | { type: 'ANALYSIS_COMPLETE' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'FETCH_DATA_SUCCESS'; payload: { systems: ...; history: ... } }
  | { type: 'OPEN_REGISTER_MODAL'; payload: { dlNumber: string } }
  | { type: 'CLOSE_REGISTER_MODAL' }
  | { type: 'REGISTER_SYSTEM_START' }
  | { type: 'REGISTER_SYSTEM_SUCCESS'; payload: string }
  | { type: 'REGISTER_SYSTEM_ERROR'; payload: string | null }
  | { type: 'UPDATE_RESULTS_AFTER_LINK' }
  | { type: 'REPROCESS_START'; payload: { fileName: string } }
  | { type: 'ASSIGN_SYSTEM_TO_ANALYSIS'; payload: { fileName: string; systemId: string } }
```

### Usage Example

```typescript
import { useAppState } from './state/appState';

function MyComponent() {
  const { state, dispatch } = useAppState();
  
  // Read state
  const { analysisResults, isLoading, error } = state;
  
  // Dispatch actions
  dispatch({ 
    type: 'PREPARE_ANALYSIS', 
    payload: [...] 
  });
  
  dispatch({ 
    type: 'SET_ERROR', 
    payload: 'Something went wrong' 
  });
}
```

## State Context 2: AdminState (Admin Dashboard)

### Location
- **Definition**: `state/adminState.tsx`
- **Provider**: `admin.tsx` wraps `<AdminApp />` with `<AdminStateProvider>`
- **Usage**: Admin dashboard for system management and diagnostics

### State Shape

```typescript
interface AdminState {
  // Paginated Data
  systems: BmsSystem[];                    // Current page of systems
  history: AnalysisRecord[];               // Current page of history
  historyCache: AnalysisRecord[];          // ALL history for charts
  totalSystems: number;
  totalHistory: number;
  systemsPage: number;
  historyPage: number;
  
  // UI State
  loading: boolean;
  error: string | null;
  isCacheBuilding: boolean;                // Building full history cache
  expandedHistoryId: string | null;        // Expanded detail row
  
  // System Management
  editingSystem: BmsSystem | null;         // System being edited
  selectedSystemIds: string[];             // For bulk operations
  primarySystemId: string;                 // For merge operations
  
  // Data Management
  duplicateSets: AnalysisRecord[][];       // Duplicate detection results
  bulkUploadResults: DisplayableAnalysisResult[];
  throttleMessage: string | null;
  linkSelections: { [recordId: string]: string };
  
  // Table Configuration
  visibleHistoryColumns: HistoryColumnKey[];
  historySortKey: HistorySortKey;
  historySortDirection: 'asc' | 'desc';
  
  // Diagnostics
  isDiagnosticsModalOpen: boolean;
  diagnosticResults: Record<string, { status: string; message: string }>;
  selectedDiagnosticTests: string[];
  
  // Action Status Flags
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
    isFixingPowerSigns: boolean;
    isRunningDiagnostics: boolean;
  };
  
  // Clear All Confirmation
  isConfirmingClearAll: boolean;
  clearAllConfirmationText: string;
}
```

### Key Actions

```typescript
export type AdminAction =
  | { type: 'FETCH_PAGE_DATA_START' }
  | { type: 'FETCH_PAGE_DATA_SUCCESS'; payload: { systems?: ...; history?: ... } }
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
  | { type: 'SET_VISIBLE_HISTORY_COLUMNS'; payload: HistoryColumnKey[] }
  | { type: 'SET_HISTORY_SORT'; payload: { key: HistorySortKey } }
  | { type: 'SET_SYSTEMS_PAGE'; payload: number }
  | { type: 'SET_HISTORY_PAGE'; payload: number }
  | { type: 'UPDATE_BULK_JOB_COMPLETED'; payload: { record: AnalysisRecord, fileName: string } }
  | { type: 'UPDATE_BULK_JOB_SKIPPED'; payload: { fileName: string, reason: string } }
  | { type: 'OPEN_DIAGNOSTICS_MODAL' }
  | { type: 'CLOSE_DIAGNOSTICS_MODAL' }
  | { type: 'SET_DIAGNOSTIC_RESULTS'; payload: Record<string, { status: string; message: string }> }
  | { type: 'SET_SELECTED_DIAGNOSTIC_TESTS'; payload: string[] }
  | { type: 'REMOVE_HISTORY_RECORD'; payload: string }
```

### Usage Example

```typescript
import { useAdminState } from './state/adminState';

function AdminComponent() {
  const { state, dispatch } = useAdminState();
  
  // Read state
  const { systems, history, loading, actionStatus } = state;
  
  // Dispatch actions
  dispatch({ 
    type: 'ACTION_START', 
    payload: 'isMerging' 
  });
  
  dispatch({ 
    type: 'SET_SYSTEMS_PAGE', 
    payload: 2 
  });
  
  dispatch({ 
    type: 'OPEN_DIAGNOSTICS_MODAL' 
  });
}
```

## State Management Patterns

### 1. Action Start/End Pattern (AdminState)

For long-running operations, use the `ACTION_START` and `ACTION_END` pattern:

```typescript
// Start operation
dispatch({ type: 'ACTION_START', payload: 'isMerging' });

try {
  await performMerge();
  // Handle success
} catch (error) {
  dispatch({ type: 'SET_ERROR', payload: error.message });
} finally {
  // Always end operation
  dispatch({ type: 'ACTION_END', payload: 'isMerging' });
}
```

### 2. Optimistic Updates

Some actions update local state immediately for better UX:

```typescript
// Immediately remove from UI
dispatch({ type: 'REMOVE_HISTORY_RECORD', payload: recordId });

// Then sync with backend
try {
  await deleteAnalysisRecord(recordId);
} catch (error) {
  // If fails, refetch to restore accurate state
  await fetchData(historyPage, 'history');
}
```

### 3. Pagination Pattern (AdminState)

State stores current page data + page numbers:

```typescript
// Store current page
systems: BmsSystem[];        // Page 1 systems
systemsPage: 1;              // Current page number
totalSystems: 150;           // Total count

// Change page
dispatch({ type: 'SET_SYSTEMS_PAGE', payload: 2 });
// This triggers useEffect that fetches page 2
```

### 4. Cache Building Pattern (AdminState)

For chart data, progressively build a complete cache:

```typescript
// Start building
dispatch({ type: 'START_HISTORY_CACHE_BUILD' });

// Stream data in chunks
streamAllHistory(
  (records) => dispatch({ type: 'APPEND_HISTORY_CACHE', payload: records }),
  () => dispatch({ type: 'FINISH_HISTORY_CACHE_BUILD' })
);

// State tracks: isCacheBuilding, historyCache
```

## Common Pitfalls & Solutions

### ❌ WRONG: Mixing State Contexts

```typescript
// In AdminDashboard.tsx (wrong!)
import { useAppState } from './state/appState';  // ❌
```

### ✅ CORRECT: Use Appropriate Context

```typescript
// In AdminDashboard.tsx (correct!)
import { useAdminState } from './state/adminState';  // ✅

// In App.tsx (correct!)
import { useAppState } from './state/appState';  // ✅
```

### ❌ WRONG: Direct State Mutation

```typescript
state.systems.push(newSystem);  // ❌ Never mutate directly
```

### ✅ CORRECT: Dispatch Actions

```typescript
dispatch({ 
  type: 'FETCH_PAGE_DATA_SUCCESS', 
  payload: { systems: [...state.systems, newSystem] }  // ✅
});
```

### ❌ WRONG: Accessing Context Outside Provider

```typescript
// Some component NOT wrapped by provider
const { state } = useAdminState();  // ❌ Will throw error
```

### ✅ CORRECT: Ensure Component is in Provider Tree

```typescript
// index.tsx
<AppStateProvider>
  <App />  {/* ✅ Can use useAppState() */}
</AppStateProvider>

// admin.tsx
<AdminStateProvider>
  <AdminApp />  {/* ✅ Can use useAdminState() */}
</AdminStateProvider>
```

## State Flow Diagrams

### Public App (AppState) - Analysis Flow

```
User uploads file
      ↓
PREPARE_ANALYSIS (set loading, add to results with 'Submitting' status)
      ↓
UPDATE_ANALYSIS_STATUS ('Processing')
      ↓
Call analyzeBmsScreenshot() API
      ↓
SYNC_ANALYSIS_COMPLETE (update with data, set recordId)
      ↓
ANALYSIS_COMPLETE (clear loading)
```

### Admin Dashboard (AdminState) - Bulk Upload Flow

```
User selects multiple files
      ↓
SET_BULK_UPLOAD_RESULTS (initialize all with 'Queued' status)
      ↓
ACTION_START('isBulkLoading')
      ↓
For each file:
  ├─ Check if duplicate → UPDATE_BULK_JOB_SKIPPED
  └─ Not duplicate:
      ├─ UPDATE_BULK_UPLOAD_RESULT (status: 'Processing')
      ├─ Call analyzeBmsScreenshot() API
      └─ UPDATE_BULK_JOB_COMPLETED (add to history cache)
      ↓
ACTION_END('isBulkLoading')
```

## Debugging State Issues

### 1. Enable Structured Logging

Both contexts use structured JSON logging:

```typescript
const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
  console.log(JSON.stringify({
    level: level.toUpperCase(),
    timestamp: new Date().toISOString(),
    message,
    context
  }));
};
```

### 2. Check State in DevTools

Use React DevTools to inspect context values:
- Components tab → Find `AppStateProvider` or `AdminStateProvider`
- View hooks → `useReducer` hook shows current state

### 3. Add Debug Actions

Temporarily log state on specific actions:

```typescript
case 'SOME_ACTION':
  console.log('Before:', state);
  const newState = { ...state, /* changes */ };
  console.log('After:', newState);
  return newState;
```

## Best Practices

1. **Keep Actions Simple**: Each action should do one thing
2. **Use TypeScript**: Leverage type safety for actions and state
3. **Immutable Updates**: Always return new objects/arrays
4. **Avoid Side Effects in Reducers**: Keep them pure
5. **Co-locate Related State**: Keep related fields together
6. **Document Complex Flows**: Add comments for multi-step processes
7. **Test Reducers**: They're pure functions - easy to test
8. **Use Action Creators**: For complex action payloads

## Future Considerations

### When to Consider Global State Library?

Consider libraries like Redux/Zustand if:
- Need to share state between many deeply nested components
- Require advanced middleware (e.g., persistence, time-travel)
- Need more sophisticated dev tools
- Team is more familiar with those patterns

### Current Approach is Good Because:
- ✅ Simple and maintainable
- ✅ No additional dependencies
- ✅ Type-safe with TypeScript
- ✅ Clear separation of concerns
- ✅ Standard React patterns
- ✅ Easy to understand for new developers

## Summary

BMSview's state management architecture is **well-designed and intentional**:
- Two separate contexts prevent state pollution
- Reducer pattern provides predictable state updates
- TypeScript ensures type safety
- Clear patterns for common operations
- Appropriate for the application's complexity level

The separation between AppState and AdminState is a **feature, not a bug** - it provides better performance, security, and maintainability.
