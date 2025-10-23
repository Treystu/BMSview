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
      log('info', 'Successfully fetched application data.', { systemCount: systems.items.length, historyCount: history.items.length });
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
      const pendingJobs = state.analysisResults.filter(r => r.jobId && !r.data && !getIsActualError(r));
      const now = Date.now();

      const jobsToPoll = pendingJobs.filter(job => {
          if (job.submittedAt && (now - job.submittedAt > CLIENT_JOB_TIMEOUT_MS)) {
              log('warn', 'Job timed out on client-side.', { jobId: job.jobId, fileName: job.fileName });
              dispatch({ type: 'JOB_TIMED_OUT', payload: { jobId: job.jobId! } });
              return false;
          }
          return true;
      });

      if (jobsToPoll.length === 0) {
          return;
      }
      
      const jobIds = jobsToPoll.map(j => j.jobId!);
      log('info', 'Polling job statuses.', { jobCount: jobIds.length, jobIds });
      
      try {
          const statuses = await getJobStatuses(jobIds);
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
          const errorMessage = err instanceof Error ? err.message : 'Unknown polling error';
          log('warn', 'Failed to poll job statuses.', { error: errorMessage });
          
          // Check if this is a network/server error that might indicate backend issues
          if (errorMessage.includes('500') || errorMessage.includes('504') || errorMessage.includes('timeout')) {
              log('error', 'Backend service error detected during polling', { error: errorMessage });
              
              // Update all pending jobs with a backend error status
              jobIds.forEach(jobId => {
                  dispatch({ type: 'UPDATE_JOB_STATUS', payload: { 
                      jobId, 
                      status: 'failed_backend_error' 
                  }});
              });
          }
      }
  }, [state.analysisResults, dispatch]);

  useEffect(() => {
    const pendingJobs = analysisResults.some(r => r.jobId && !r.data && !getIsActualError(r));
    
    if (pendingJobs) {
      if (!pollingIntervalRef.current) {
        log('info', 'Pending jobs found. Starting status poller.');
        pollingIntervalRef.current = window.setInterval(pollJobStatuses, POLLING_INTERVAL_MS);
      }
    } else {
      if (pollingIntervalRef.current) {
        log('info', 'No pending jobs. Stopping poller.');
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
    
    return () => {
        if (pollingIntervalRef.current) {
            log('info', 'Component unmounting or dependencies changed. Clearing poller timeout.');
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
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
        const jobCreationResults = await analyzeBmsScreenshots(files, state.registeredSystems, forceReprocessFileNames);
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
                  registeredSystems={state.registeredSystems}
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
