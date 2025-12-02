import { useCallback, useEffect } from 'react';
import AnalysisResult from './components/AnalysisResult';
import Footer from './components/Footer';
import Header from './components/Header';
import RegisterBms from './components/RegisterBms';
import UploadSection from './components/UploadSection';
// ***MODIFIED***: Import the new *synchronous* service
import syncManager from '@/services/syncManager';
import {
  associateDlToSystem,
  getAnalysisHistory,
  getRegisteredSystems,
  linkAnalysisToSystem,
  registerBmsSystem
} from './services/clientService';
import { analyzeBmsScreenshot } from './services/geminiService';
import { checkFilesForDuplicates } from './utils/duplicateChecker';
import { useAppState } from './state/appState';
import type { BmsSystem, DisplayableAnalysisResult } from './types';
// ***REMOVED***: No longer need job polling
// import { getIsActualError } from './utils';
// import { useJobPolling } from './hooks/useJobPolling';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
  console.log(JSON.stringify({ level: level.toUpperCase(), timestamp: new Date().toISOString(), message, context }));
};

function App() {
  const { state, dispatch } = useAppState();
  const {
    analysisResults,
    isLoading,
    error,
    isRegistering,
    registrationError,
    registrationSuccess,
    isRegisterModalOpen,
    registrationContext
  } = state;

  // ***REMOVED***: All `useJobPolling` and related callbacks are gone.

  const fetchAppData = useCallback(async () => {
    log('info', 'Fetching initial application data.');
    try {
      // Fetching systems and history remains the same
      const [systems, history] = await Promise.all([
        getRegisteredSystems(1, 1000), // Load all systems for linking
        getAnalysisHistory(1, 25)   // Load first page of history
      ]);
      dispatch({ type: 'FETCH_DATA_SUCCESS', payload: { systems, history } });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      dispatch({ type: 'SET_ERROR', payload: "Could not load initial application data." });
    }
  }, [dispatch]);

  useEffect(() => {
    fetchAppData();
    // Start periodic sync on mount
    syncManager.startPeriodicSync();

    // Cleanup on unmount
    return () => {
      syncManager.stopPeriodicSync();
    };
  }, [fetchAppData]);

  const handleLinkRecordToSystem = async (recordId: string, systemId: string, dlNumber?: string | null) => {
    log('info', 'Linking record to system.', { recordId, systemId });
    try {
      await linkAnalysisToSystem(recordId, systemId, dlNumber);
      await fetchAppData();
      dispatch({ type: 'UPDATE_RESULTS_AFTER_LINK' });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: "Failed to link the record." });
    }
  };

  /**
   * ***MODIFIED***: This is the new, simpler analysis handler with three-category duplicate checking.
   * Phase 1: Check ALL files for duplicates upfront - categorize into true duplicates, upgrades, and new files
   * Phase 2: Analyze only upgrades and new files (skip true duplicates entirely)
   */
  const handleAnalyze = async (files: File[], options?: { forceFileName?: string; forceReanalysis?: boolean }) => {
    log('info', 'Analysis process initiated.', { fileCount: files.length, forceFileName: options?.forceFileName, forceReanalysis: options?.forceReanalysis });

    if (files.length === 0) {
      dispatch({ type: 'ANALYSIS_COMPLETE' });
      return;
    }

    // Prepare the UI by setting all files to "Checking for duplicates..." state
    const initialResults: DisplayableAnalysisResult[] = files.map(f => ({
      fileName: f.name, data: null, error: 'Checking for duplicates...', file: f, submittedAt: Date.now()
    }));

    dispatch({ type: 'PREPARE_ANALYSIS', payload: initialResults });
    setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 100);

    try {
      // ***PHASE 1: Check ALL files for duplicates upfront (unless forcing reanalysis)***
      let filesToAnalyze: { file: File; needsUpgrade?: boolean }[] = [];
      
      if (!options?.forceReanalysis) {
        try {
          const { trueDuplicates, needsUpgrade, newFiles } = await checkFilesForDuplicates(files, log);
          
          // Mark true duplicates as skipped immediately (don't analyze these at all)
          for (const dup of trueDuplicates) {
            dispatch({
              type: 'SYNC_ANALYSIS_COMPLETE',
              payload: {
                fileName: dup.file.name,
                isDuplicate: true,
                record: {
                  id: dup.recordId || `local-duplicate-${Date.now()}`,
                  timestamp: dup.timestamp || new Date().toISOString(),
                  analysis: dup.analysisData || null,
                  fileName: dup.file.name,
                },
              },
            });
          }

          // Update files that need upgrade to "Queued (needs upgrade)" status
          for (const item of needsUpgrade) {
            dispatch({ 
              type: 'UPDATE_ANALYSIS_STATUS', 
              payload: { fileName: item.file.name, status: 'Queued (upgrading)' } 
            });
          }

          // Update new files to "Queued" status
          for (const item of newFiles) {
            dispatch({ 
              type: 'UPDATE_ANALYSIS_STATUS', 
              payload: { fileName: item.file.name, status: 'Queued' } 
            });
          }

          filesToAnalyze = [...needsUpgrade, ...newFiles];
          
          log('info', 'Phase 1 complete: Duplicate check finished.', { 
            count: filesToAnalyze.length,
            upgrades: needsUpgrade.length,
            new: newFiles.length,
            duplicates: trueDuplicates.length
          });
        } catch (duplicateCheckError) {
          // If duplicate check fails entirely, fall back to analyzing all files
          const errorMessage = duplicateCheckError instanceof Error 
            ? duplicateCheckError.message 
            : 'Unknown error during duplicate check';
          
          log('warn', 'Phase 1 failed: Duplicate check error, will analyze all files.', { 
            error: errorMessage,
            fileCount: files.length
          });
          
          // Reset all files to "Queued" status (clear any "Checking for duplicates..." errors)
          for (const file of files) {
            dispatch({ 
              type: 'UPDATE_ANALYSIS_STATUS', 
              payload: { fileName: file.name, status: 'Queued' } 
            });
          }
          
          // Treat all files as new files that need analysis
          filesToAnalyze = files.map(file => ({ file }));
        }

        // ***PHASE 2: Analyze only upgrades and new files (true duplicates already handled)***
        log('info', 'Phase 2: Starting analysis of non-duplicate files.', { 
          count: filesToAnalyze.length
        });
        
        for (const item of filesToAnalyze) {
          const file = item.file;
          try {
            // 1. Mark this specific file as "Processing"
            dispatch({ type: 'UPDATE_ANALYSIS_STATUS', payload: { fileName: file.name, status: 'Processing' } });

            // 2. Call the synchronous service
            const analysisData = await analyzeBmsScreenshot(file, false);

            // 3. Got data! Update the state for this one file.
            log('info', 'Processing synchronous analysis result.', { fileName: file.name });
            dispatch({
              type: 'SYNC_ANALYSIS_COMPLETE',
              payload: {
                fileName: file.name,
                isDuplicate: false,
                record: {
                  id: analysisData._recordId || `local-${Date.now()}`,
                  timestamp: analysisData._timestamp || new Date().toISOString(),
                  analysis: analysisData,
                  fileName: file.name
                }
              }
            });

          } catch (err) {
            // 4. Handle error for this specific file
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            log('error', 'Analysis request failed for one file.', { error: errorMessage, fileName: file.name });

            if (errorMessage.toLowerCase().includes('duplicate')) {
              dispatch({
                type: 'SYNC_ANALYSIS_COMPLETE',
                payload: {
                  fileName: file.name,
                  isDuplicate: true,
                  record: {
                    id: `local-duplicate-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    analysis: null,
                    fileName: file.name,
                  },
                },
              });
            } else {
              dispatch({ type: 'UPDATE_ANALYSIS_STATUS', payload: { fileName: file.name, status: `Failed: ${errorMessage}` } });
            }
          }
        }
      } else {
        // When forcing reanalysis, skip duplicate check and analyze all files
        log('info', 'Force reanalysis mode - skipping duplicate check.', { fileCount: files.length });
        
        for (const file of files) {
          try {
            dispatch({ type: 'UPDATE_ANALYSIS_STATUS', payload: { fileName: file.name, status: 'Processing' } });
            const analysisData = await analyzeBmsScreenshot(file, true);
            
            log('info', 'Processing synchronous analysis result.', { fileName: file.name });
            dispatch({
              type: 'SYNC_ANALYSIS_COMPLETE',
              payload: {
                fileName: file.name,
                isDuplicate: false,
                record: {
                  id: analysisData._recordId || `local-${Date.now()}`,
                  timestamp: analysisData._timestamp || new Date().toISOString(),
                  analysis: analysisData,
                  fileName: file.name
                }
              }
            });
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            log('error', 'Analysis request failed for one file.', { error: errorMessage, fileName: file.name });
            dispatch({ type: 'UPDATE_ANALYSIS_STATUS', payload: { fileName: file.name, status: `Failed: ${errorMessage}` } });
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error during analysis.';
      log('error', 'Analysis process failed.', { error: errorMessage });
      dispatch({ type: 'SET_ERROR', payload: errorMessage });
    }

    // All files are processed
    dispatch({ type: 'ANALYSIS_COMPLETE' });
  };

  const handleReprocess = async (fileToReprocess: File) => {
    log('info', 'Reprocess initiated.', { fileName: fileToReprocess.name });
    // Reprocessing is now just a normal analysis call with forceReanalysis=true
    await handleAnalyze([fileToReprocess], { forceFileName: fileToReprocess.name, forceReanalysis: true });
  };

  // --- Registration logic remains unchanged ---
  const handleRegisterSystem = async (systemData: Omit<BmsSystem, 'id' | 'associatedDLs'>) => {
    dispatch({ type: 'REGISTER_SYSTEM_START' });
    try {
      const newSystem = await registerBmsSystem(systemData);
      if (registrationContext?.dlNumber) {
        await associateDlToSystem(registrationContext.dlNumber, newSystem.id);
      }
      dispatch({ type: 'REGISTER_SYSTEM_SUCCESS', payload: `System "${newSystem.name}" registered!` });
      await fetchAppData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown registration error";
      dispatch({ type: 'REGISTER_SYSTEM_ERROR', payload: errorMessage });
    }
  };

  const handleInitiateRegistration = (dlNumber: string) => {
    dispatch({ type: 'OPEN_REGISTER_MODAL', payload: { dlNumber } });
  };

  const handleCloseRegisterModal = () => {
    dispatch({ type: 'CLOSE_REGISTER_MODAL' });
  };
  // --- End of registration logic ---


  return (
    <div className="flex flex-col min-h-screen bg-neutral-light">
      <Header />
      <main className="flex-grow">
        <UploadSection
          onAnalyze={handleAnalyze}
          isLoading={isLoading}
          error={error}
          hasResults={analysisResults.length > 0}
        />
        {analysisResults.length > 0 && (
          <section id="results-section" className="py-20 bg-white">
            <div className="container mx-auto px-6 space-y-8">
              <h2 className="text-3xl font-bold text-center text-neutral-dark">Analysis Results</h2>
              {analysisResults.map((result) => (
                <AnalysisResult
                  key={result.fileName}
                  result={result}
                  registeredSystems={state.registeredSystems.items || []}
                  onLinkRecord={handleLinkRecordToSystem}
                  onReprocess={handleReprocess}
                  onRegisterNewSystem={handleInitiateRegistration}
                />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
      <RegisterBms
        onRegister={handleRegisterSystem}
        isRegistering={isRegistering}
        error={registrationError}
        successMessage={registrationSuccess}
        isOpen={isRegisterModalOpen}
        onClose={handleCloseRegisterModal}
      />
    </div>
  );
}

export default App;

