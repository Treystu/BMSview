import React, { useEffect, useCallback } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import UploadSection from './components/UploadSection';
import AnalysisResult from './components/AnalysisResult';
import RegisterBms from './components/RegisterBms';
// ***MODIFIED***: Import the new *synchronous* service
import { analyzeBmsScreenshot } from './services/geminiService';
import { 
    registerBmsSystem, 
    getRegisteredSystems, 
    getAnalysisHistory, 
    linkAnalysisToSystem, 
    associateDlToSystem 
} from './services/clientService';
import type { BmsSystem, DisplayableAnalysisResult, AnalysisRecord } from './types';
import { useAppState } from './state/appState';
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
   * ***MODIFIED***: This is the new, simpler analysis handler.
   * It processes files one by one and gets results immediately.
   */
  const handleAnalyze = async (files: File[], options?: { forceFileName?: string }) => {
    log('info', 'Analysis process initiated.', { fileCount: files.length, forceFileName: options?.forceFileName });
    
    // Prepare the UI by setting all files to a "Submitting" state
    const initialResults: DisplayableAnalysisResult[] = files.map(f => ({ 
        fileName: f.name, data: null, error: 'Submitting', file: f, submittedAt: Date.now()
    }));
    
    dispatch({ type: 'PREPARE_ANALYSIS', payload: initialResults });
    setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 100);

    if (files.length === 0) {
      dispatch({ type: 'ANALYSIS_COMPLETE' });
      return;
    }

    // Process each file one by one
    for (const file of files) {
        try {
            // 1. Mark this specific file as "Processing"
            dispatch({ type: 'UPDATE_ANALYSIS_STATUS', payload: { fileName: file.name, status: 'Processing' } });
            
            // 2. Call the *new* synchronous service
            const analysisData = await analyzeBmsScreenshot(file);
            
            // 3. Got data! Update the state for this one file.
            log('info', 'Processing synchronous analysis result.', { fileName: file.name });
            dispatch({ 
                type: 'SYNC_ANALYSIS_COMPLETE', 
                payload: { 
                    fileName: file.name, 
                    // This creates a minimal record for display.
                    // The full record saving is now handled by a *different* process
                    // (or could be added to the 'analyze' function).
                    record: {
                      id: `local-${Date.now()}`,
                      timestamp: new Date().toISOString(),
                      analysis: analysisData,
                      fileName: file.name
                    }
                } 
            });

        } catch (err) {
            // 4. Handle error for this specific file
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            log('error', 'Analysis request failed for one file.', { error: errorMessage, fileName: file.name });
            dispatch({ type: 'UPDATE_ANALYSIS_STATUS', payload: { fileName: file.name, status: `Failed: ${errorMessage}` } });
        }
    }
    
    // All files are processed
    dispatch({ type: 'ANALYSIS_COMPLETE' });
  };
  
  const handleReprocess = async (fileToReprocess: File) => {
    log('info', 'Reprocess initiated.', { fileName: fileToReprocess.name });
    // Reprocessing is now just a normal analysis call
    await handleAnalyze([fileToReprocess], { forceFileName: fileToReprocess.name });
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

