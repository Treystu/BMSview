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
import { getBasename } from './utils';

// Centralized client-side logger for consistency and verbosity
const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        message,
        context
    }));
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
    registrationContext,
    registeredSystems,
    analysisHistory,
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

  useEffect(() => {
    fetchAppData();
  }, [fetchAppData]);
  
  const pollJobStatuses = useCallback(async () => {
      const pendingJobs = state.analysisResults.filter(r => r.jobId && !['completed', 'failed'].includes(r.error?.toLowerCase() ?? ''));
      if (pendingJobs.length === 0) {
          if (pollingIntervalRef.current) {
              log('info', 'No pending jobs. Stopping status poller.');
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
          }
          return;
      }
      
      const jobIds = pendingJobs.map(j => j.jobId!);
      log('info', 'Polling job statuses.', { jobCount: jobIds.length, jobIds });
      try {
          const statuses = await getJobStatuses(jobIds);
          let needsHistoryRefresh = false;
          log('info', 'Received job statuses from server.', { statuses });

          for (const status of statuses) {
              if (status.status === 'completed' && status.recordId) {
                  log('info', 'Job completed, fetching full record.', { jobId: status.jobId, recordId: status.recordId });
                  const record = await getAnalysisRecordById(status.recordId);
                  if (record) {
                      dispatch({ type: 'UPDATE_JOB_COMPLETED', payload: { jobId: status.jobId, record } });
                      needsHistoryRefresh = true;
                  } else {
                     log('warn', 'Job completed but could not fetch the final record.', { jobId: status.jobId, recordId: status.recordId });
                  }
              } else if (status.status === 'failed' || status.status === 'not_found') {
                  log('warn', `Job ${status.status}.`, { jobId: status.jobId, error: status.error });
                  dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId: status.jobId, status: status.error || 'Failed' } });
              } else {
                  log('info', 'Job status updated.', { jobId: status.jobId, status: status.status });
                  dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId: status.jobId, status: status.status } });
              }
          }
          if (needsHistoryRefresh) {
              log('info', 'A job completed, refreshing all app data.');
              fetchAppData(); // Full refresh to keep history consistent
          }
      } catch (err) {
          log('warn', 'Failed to poll job statuses.', { error: err instanceof Error ? err.message : 'Unknown error' });
      }
  }, [state.analysisResults, dispatch, fetchAppData]);

  useEffect(() => {
    const pendingJobs = analysisResults.filter(r => r.jobId && !['completed', 'failed'].includes(r.error?.toLowerCase() ?? ''));
    if (pendingJobs.length > 0 && !pollingIntervalRef.current) {
        log('info', 'Pending jobs found. Starting status poller.');
        pollingIntervalRef.current = window.setInterval(pollJobStatuses, 5000);
    } else if (pendingJobs.length === 0 && pollingIntervalRef.current) {
        log('info', 'No more pending jobs. Clearing poller interval.');
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
    }

    return () => {
        if (pollingIntervalRef.current) {
            log('info', 'Component unmounting. Clearing poller interval.');
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    };
}, [analysisResults, pollJobStatuses]);

  const handleLinkRecordToSystem = async (recordId: string, systemId: string, dlNumber?: string | null) => {
    if (!recordId || !systemId) return;
    log('info', 'Attempting to link record to system.', { recordId, systemId, dlNumber });
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

  const handleAnalyze = async (files: File[]) => {
    log('info', 'Main analyze trigger', { fileCount: files.length });
    const existingFilenameMap = new Map(analysisHistory.filter(r => r.fileName).map(r => [getBasename(r.fileName!), r]));
    const initialResults: DisplayableAnalysisResult[] = [];
    const batchBasenames = new Set<string>();
    const filesToAnalyze: File[] = [];

    for (const file of files) {
        const basename = getBasename(file.name);
        if (batchBasenames.has(basename)) {
            log('info', 'Skipping file: duplicate in current batch.', { fileName: file.name });
            initialResults.push({ fileName: file.name, data: null, error: null, isDuplicate: true, isBatchDuplicate: true, file });
        } else if (existingFilenameMap.has(basename)) {
            log('info', 'Skipping file: duplicate in history.', { fileName: file.name });
            const originalRecord = existingFilenameMap.get(basename)!;
            initialResults.push({ fileName: file.name, data: originalRecord.analysis, error: null, isDuplicate: true, file, recordId: originalRecord.id, weather: originalRecord.weather });
        } else {
            batchBasenames.add(basename);
            filesToAnalyze.push(file);
            initialResults.push({ fileName: file.name, data: null, error: 'Queued', file });
        }
    }
    
    log('info', 'Preparing analysis with initial results.', { results: initialResults.map(r => ({fileName: r.fileName, isDuplicate: r.isDuplicate})) });
    dispatch({ type: 'PREPARE_ANALYSIS', payload: initialResults });
    setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 100);

    if (filesToAnalyze.length === 0) {
      log('info', 'No new files to analyze.');
      dispatch({ type: 'ANALYSIS_COMPLETE' }); // Reset loading state
      return;
    }

    try {
        log('info', 'App handleAnalyze trigger', { fileCount: filesToAnalyze.length, state: 'main', timestamp: new Date().toISOString() });
        const jobCreationResults = await analyzeBmsScreenshots(filesToAnalyze, registeredSystems);
        dispatch({ type: 'START_ANALYSIS_JOBS', payload: jobCreationResults });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during analysis.';
        log('error', 'Analysis request failed.', { error: errorMessage });
        dispatch({ type: 'SET_ERROR', payload: errorMessage });
    }
  };
  
  const handleReprocess = async (fileToReprocess: File) => {
    log('info', 'Reprocessing file.', { fileName: fileToReprocess.name });
    dispatch({ type: 'REPROCESS_START', payload: { fileName: fileToReprocess.name }});
    await handleAnalyze([fileToReprocess]);
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
