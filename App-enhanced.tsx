import React, { useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import UploadSection from './components/UploadSection';
import AnalysisResult from './components/AnalysisResult';
import RegisterBms from './components/RegisterBms';
import { analyzeBmsScreenshots } from './services/geminiService';
import { registerBmsSystem, getRegisteredSystems, getAnalysisHistory, linkAnalysisToSystem, associateDlToSystem, getJobStatuses, getAnalysisRecordById } from './services/clientService';
import type { BmsSystem, DisplayableAnalysisResult } from './types';
import { useAppState } from './state/appState';
import { getIsActualError } from './utils';
import { useJobPolling } from './hooks/useJobPolling';

// Centralized client-side logger for consistency and verbosity
const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        message,
        context
    }));
};

const POLLING_INTERVAL_MS = 5000;
const CLIENT_JOB_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

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
    registrationContext,
    registeredSystems,
  } = state;
  
  const pollingIntervalRef = useRef<number | null>(null);

  const fetchAppData = useCallback(async () => {
    log('info', 'Fetching initial application data (systems and history).');
    try {
      const [systems, history] = await Promise.all([
        getRegisteredSystems(),
        getAnalysisHistory()
      ]);
      dispatch({ type: 'FETCH_DATA_SUCCESS', payload: { systems, history } });
      log('info', 'Successfully fetched application data.', { systemCount: systems.length, historyCount: history.length });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      log('error', "Failed to fetch app data.", { error: errorMessage });
      dispatch({ type: 'SET_ERROR', payload: "Could not load initial application data. Please refresh the page." });
    }
  }, [dispatch]);

  const fetchAppData = useCallback(async () => {
    log('info', 'Fetching initial application data (systems and history).');
    try {
      const [systems, history] = await Promise.all([
        getRegisteredSystems(),
        getAnalysisHistory()
      ]);
      dispatch({ type: 'FETCH_DATA_SUCCESS', payload: { systems, history } });
      log('info', 'Successfully fetched application data.', { systemCount: systems.length, historyCount: history.length });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      log('error', "Failed to fetch app data.", { error: errorMessage });
      dispatch({ type: 'SET_ERROR', payload: "Could not load initial application data. Please refresh the page." });
    }
  }, [dispatch]);

  useEffect(() => {
    fetchAppData();
  }, [fetchAppData]);
  
  // Extract pending job IDs for polling
  const pendingJobIds = analysisResults
    .filter(r => r.jobId && !r.data && !getIsActualError(r))
    .map(r => r.jobId!);

  // Use the enhanced job polling hook
  const { isPolling, errorCount, consecutiveErrors, stopPolling } = useJobPolling({
    jobIds: pendingJobIds,
    onJobCompleted: useCallback((jobId: string, record: AnalysisRecord) => {
      log('info', 'Job completed, updating state', { jobId, recordId: record.id });
      dispatch({ type: 'UPDATE_JOB_COMPLETED', payload: { jobId, record } });
    }, [dispatch]),
    onJobStatusUpdate: useCallback((jobId: string, status: string) => {
      log('info', 'Job status updated', { jobId, status });
      dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId, status } });
    }, [dispatch]),
    onJobFailed: useCallback((jobId: string, error: string) => {
      log('warn', 'Job failed', { jobId, error });
      dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId, status: error } });
    }, [dispatch]),
    onPollingError: useCallback((error: string) => {
      log('warn', 'Polling error', { error });
      // Could dispatch a global error or show user notification
    }, [])
  });

  // Handle job timeout logic
  useEffect(() => {
    if (consecutiveErrors >= 3) {
      log('warn', 'Multiple polling errors detected, may indicate backend issues', { 
        consecutiveErrors,
        pendingJobs: pendingJobIds.length 
      });
    }
  }, [consecutiveErrors, pendingJobIds]);

  // Legacy polling cleanup
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  const handleLinkRecordToSystem = async (recordId: string, systemId: string, dlNumber?: string | null) => {
    if (!recordId || !systemId) return;
    log('info', 'Attempting to link record to system from UI.', { recordId, systemId, dlNumber });
    try {
        await linkAnalysisToSystem(recordId, systemId, dlNumber);
        log('info', 'Link successful. Refreshing app data.');
        await fetchAppData(); 
        dispatch({ type: 'UPDATE_RESULTS_AFTER_LINK' });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        log('error', "Failed to link record to system", { recordId, systemId, error: errorMessage });
        dispatch({ type: 'SET_ERROR', payload: "Failed to link the record. Please try again." });
    }
  };

  const handleAnalyze = async (files: File[], options?: { forceFileName?: string }) => {
    log('info', 'Analysis process initiated from UI.', { fileCount: files.length, forceFileName: options?.forceFileName });
    
    const initialResults: DisplayableAnalysisResult[] = files.map(f => ({ 
        fileName: f.name, 
        data: null, 
        error: 'Submitted', 
        file: f,
        submittedAt: Date.now()
    }));
    
    dispatch({ type: 'PREPARE_ANALYSIS', payload: initialResults });

    setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 100);

    if (files.length === 0) {
      log('info', 'No new files to analyze, aborting.', { initialFileCount: files.length });
      dispatch({ type: 'ANALYSIS_COMPLETE' });
      return;
    }

    try {
        const forceReprocessFileNames = options?.forceFileName ? [options.forceFileName] : [];
        const jobCreationResults = await analyzeBmsScreenshots(files, registeredSystems, forceReprocessFileNames);
        log('info', 'Received job creation results from service.', { results: jobCreationResults });
        dispatch({ type: 'START_ANALYSIS_JOBS', payload: jobCreationResults });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during analysis.';
        log('error', 'Analysis request failed.', { error: errorMessage });
        dispatch({ type: 'SET_ERROR', payload: errorMessage });
    }
  };
  
  const handleReprocess = async (fileToReprocess: File) => {
    log('info', 'Reprocess initiated from UI.', { fileName: fileToReprocess.name });
    dispatch({ type: 'REPROCESS_START', payload: { fileName: fileToReprocess.name }});
    await handleAnalyze([fileToReprocess], { forceFileName: fileToReprocess.name });
  };

  const handleRegisterSystem = async (systemData: Omit<BmsSystem, 'id' | 'associatedDLs'>) => {
    log('info', 'Registering new system.', { name: systemData.name, context: registrationContext });
    dispatch({ type: 'REGISTER_SYSTEM_START' });
    try {
      const newSystem = await registerBmsSystem(systemData);
      if (registrationContext?.dlNumber) {
        log('info', 'Associating DL number to new system.', { dlNumber: registrationContext.dlNumber, newSystemId: newSystem.id });
        await associateDlToSystem(registrationContext.dlNumber, newSystem.id);
      }
      log('info', 'System registration successful.', { newSystem });
      dispatch({ type: 'REGISTER_SYSTEM_SUCCESS', payload: `System "${newSystem.name}" registered!` });
      await fetchAppData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown registration error";
      log('error', 'System registration failed.', { error: errorMessage });
      dispatch({ type: 'REGISTER_SYSTEM_ERROR', payload: errorMessage });
    }
  };

  const handleInitiateRegistration = (dlNumber: string) => {
    log('info', 'User initiated new system registration from analysis result.', { dlNumber });
    dispatch({ type: 'OPEN_REGISTER_MODAL', payload: { dlNumber } });
  };

  const handleCloseRegisterModal = () => {
    log('info', 'Closing registration modal.');
    dispatch({ type: 'CLOSE_REGISTER_MODAL' });
  };

  // Add user-friendly status display
  const getStatusDisplay = (result: DisplayableAnalysisResult) => {
    if (result.data) return 'Completed';
    if (result.error === 'Submitted') return 'Submitted';
    if (result.error === 'Queued') return 'Queued';
    if (result.error === 'Processing') return 'Processing';
    if (result.error?.startsWith('failed_')) return 'Failed';
    if (getIsActualError(result)) return 'Error';
    return result.error || 'Unknown';
  };

  return (
    <div className="flex flex-col min-h-screen bg-neutral-light">
      <Header />
      <main className="flex-grow">
        <UploadSection 
          onAnalyze={(files) => handleAnalyze(files)} 
          isLoading={isLoading} 
          error={error}
          hasResults={analysisResults.length > 0}
        />
        
        {analysisResults.length > 0 && (
          <section id="results-section" className="py-20 bg-white">
            <div className="container mx-auto px-6 space-y-8">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-neutral-dark">Analysis Results</h2>
                {isPolling && (
                  <div className="mt-4 flex items-center justify-center text-sm text-neutral">
                    <svg className="animate-spin h-4 w-4 mr-2 text-secondary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing jobs... {errorCount > 0 && `(Errors: ${errorCount})`}
                  </div>
                )}
                {consecutiveErrors >= 3 && (
                  <div className="mt-4 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded-r-lg">
                    <p className="text-yellow-800">
                      <strong>Notice:</strong> Experiencing connection issues. Jobs may take longer to process.
                    </p>
                  </div>
                )}
              </div>
              
              {analysisResults.map((result) => (
                <div key={result.fileName} className="relative">
                  <div className="absolute top-0 right-0 mt-4 mr-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      result.data ? 'bg-green-100 text-green-800' :
                      result.error === 'Queued' || result.error === 'Processing' ? 'bg-blue-100 text-blue-800' :
                      result.error === 'Submitted' ? 'bg-gray-100 text-gray-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {getStatusDisplay(result)}
                    </span>
                  </div>
                  <AnalysisResult 
                    result={result}
                    registeredSystems={registeredSystems}
                    onLinkRecord={handleLinkRecordToSystem}
                    onReprocess={handleReprocess}
                    onRegisterNewSystem={handleInitiateRegistration}
                  />
                </div>
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