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
  
  const pollingTimeoutRef = useRef<number | null>(null);
  const isPollingRef = useRef(false);

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
  
  const pollJobStatuses = useCallback(async () => {
      if (isPollingRef.current) {
          log('info', 'Polling is already in progress. Skipping this cycle.');
          return;
      }

      const pendingJobs = state.analysisResults.filter(r => r.jobId && !['completed', 'failed'].includes(r.error?.toLowerCase() ?? ''));
      const jobsToPoll = [];
      const now = Date.now();

      for (const job of pendingJobs) {
          if (job.submittedAt && (now - job.submittedAt > CLIENT_JOB_TIMEOUT_MS)) {
              log('warn', 'Job timed out on client-side.', { jobId: job.jobId, fileName: job.fileName });
              dispatch({ type: 'JOB_TIMED_OUT', payload: { jobId: job.jobId! } });
          } else {
              jobsToPoll.push(job);
          }
      }

      if (jobsToPoll.length === 0) {
          log('info', 'No active jobs to poll.');
          if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
          pollingTimeoutRef.current = null; // Ensure polling stops
          return;
      }
      
      isPollingRef.current = true;
      const jobIds = jobsToPoll.map(j => j.jobId!);
      log('info', 'Polling job statuses.', { jobCount: jobIds.length, jobIds });
      
      let statuses: any[] = [];
      try {
          statuses = await getJobStatuses(jobIds);
          let needsHistoryRefresh = false;
          log('info', 'Received job statuses from server.', { statuses });

          for (const status of statuses) {
              if (status.status === 'completed' && status.recordId) {
                  log('info', 'Job completed, fetching full record.', { jobId: status.id, recordId: status.recordId });
                  const record = await getAnalysisRecordById(status.recordId);
                  if (record) {
                      dispatch({ type: 'UPDATE_JOB_COMPLETED', payload: { jobId: status.id, record } });
                      needsHistoryRefresh = true;
                  } else {
                     log('warn', 'Job completed but could not fetch the final record.', { jobId: status.id, recordId: status.recordId });
                     // Mark as failed if record can't be fetched, to unblock the UI
                     dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId: status.id, status: 'failed_record_fetch' } });
                  }
              } else if (status.status.startsWith('failed') || status.status === 'not_found') {
                  log('warn', `Job ${status.status}.`, { jobId: status.id, error: status.error });
                  dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId: status.id, status: status.error || 'Failed' } });
              } else {
                  log('info', 'Job status updated.', { jobId: status.id, status: status.status });
                  dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId: status.id, status: status.status } });
              }
          }
          if (needsHistoryRefresh) {
              log('info', 'A job completed. The history list will update on the next full refresh.');
          }
      } catch (err) {
          log('warn', 'Failed to poll job statuses.', { error: err instanceof Error ? err.message : 'Unknown error' });
      } finally {
          isPollingRef.current = false;
          // Schedule the next poll ONLY if there are still jobs to poll for
          const stillPendingJobs = jobsToPoll.filter(job => {
                // FIX: `statuses` was defined in the `try` block and not accessible here.
            const stillPendingJobs = jobsToPoll.filter(job => {
                const updatedStatus = statuses.find(s => s.id === job.jobId);
                return !(updatedStatus && (updatedStatus.status === 'completed' || updatedStatus.status.startsWith('failed') || updatedStatus.status === 'not_found'));
            });
              if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
              pollingTimeoutRef.current = null;
          }
      }
  }, [state.analysisResults, dispatch]);

  useEffect(() => {
    const pendingJobs = analysisResults.some(r => r.jobId && !['completed', 'failed'].includes(r.error?.toLowerCase() ?? '') && !r.error?.startsWith('failed_'));
    
    if (pendingJobs && !pollingTimeoutRef.current && !isPollingRef.current) {
        log('info', 'Pending jobs found. Starting status poller.');
        // Initial call starts the recursive polling chain
        pollingTimeoutRef.current = window.setTimeout(pollJobStatuses, POLLING_INTERVAL_MS);
    }
    
    return () => {
        if (pollingTimeoutRef.current) {
            log('info', 'Component unmounting or dependencies changed. Clearing poller timeout.');
            clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
        }
    };
}, [analysisResults, pollJobStatuses]);

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
    
    // The client no longer checks for duplicates. It just prepares all files for submission.
    const initialResults: DisplayableAnalysisResult[] = files.map(f => ({ 
        fileName: f.name, 
        data: null, 
        error: 'Submitted', 
        file: f,
        submittedAt: Date.now()
    }));
    
    // For new uploads, PREPARE_ANALYSIS adds the skeleton UI.
    // For reprocess, it does nothing since the item is already there, which is fine.
    // REPROCESS_START has already updated the item's state to 'Submitting'.
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
              <h2 className="text-3xl font-bold text-center text-neutral-dark">Analysis Results</h2>
              {analysisResults.map((result) => (
                <AnalysisResult 
                  key={result.fileName} 
                  result={result}
                  registeredSystems={registeredSystems}
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
