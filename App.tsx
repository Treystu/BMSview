import React, { useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import UploadSection from './components/UploadSection';
import AnalysisResult from './components/AnalysisResult';
import RegisterBms from './components/RegisterBms';
import { analyzeBmsScreenshots } from './services/geminiService';
import { registerBmsSystem, getRegisteredSystems, getAnalysisHistory, linkAnalysisToSystem, associateDlToSystem } from './services/clientService';
import type { BmsSystem, DisplayableAnalysisResult, AnalysisRecord } from './types';
import { useAppState } from './state/appState';
import { getIsActualError } from './utils';
import { useJobPolling } from './hooks/useJobPolling';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({ level: level.toUpperCase(), timestamp: new Date().toISOString(), message, context }));
};

// Type guard to check if the response is a full AnalysisRecord
const isAnalysisRecord = (response: any): response is AnalysisRecord => {
    return response && typeof response === 'object' && 'analysisKey' in response && 'fileName' in response;
};

function App() {
  const { state, dispatch } = useAppState();
  const { analysisResults, isLoading, error, isRegistering, registrationError, registrationSuccess, isRegisterModalOpen, registrationContext } = state;
  
  const jobIds = React.useMemo(() => 
    state.analysisResults
      .filter(r => r.jobId && !r.data && !getIsActualError(r))
      .map(r => r.jobId!),
    [state.analysisResults]
  );

  const handleJobCompleted = useCallback((jobId: string, record: AnalysisRecord) => {
    dispatch({ type: 'UPDATE_JOB_COMPLETED', payload: { jobId, record } });
  }, [dispatch]);

  const handleJobStatusUpdate = useCallback((jobId: string, status: string) => {
    dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId, status } });
  }, [dispatch]);

  const handleJobFailed = useCallback((jobId: string, error: string) => {
    dispatch({ type: 'UPDATE_JOB_STATUS', payload: { jobId, status: error } });
  }, [dispatch]);

  useJobPolling({
    jobIds,
    onJobCompleted: handleJobCompleted,
    onJobStatusUpdate: handleJobStatusUpdate,
    onJobFailed: handleJobFailed,
    interval: jobIds.length === 1 ? 2000 : 5000,
  });

  const fetchAppData = useCallback(async () => {
    log('info', 'Fetching initial application data.');
    try {
      const [systems, history] = await Promise.all([getRegisteredSystems(), getAnalysisHistory()]);
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

  const handleAnalyze = async (files: File[], options?: { forceFileName?: string }) => {
    log('info', 'Analysis process initiated.', { fileCount: files.length, forceFileName: options?.forceFileName });
    
    const initialResults: DisplayableAnalysisResult[] = files.map(f => ({ 
        fileName: f.name, data: null, error: 'Submitted', file: f, submittedAt: Date.now()
    }));
    
    dispatch({ type: 'PREPARE_ANALYSIS', payload: initialResults });
    setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 100);

    if (files.length === 0) {
      dispatch({ type: 'ANALYSIS_COMPLETE' });
      return;
    }

    try {
        const forceReprocessFileNames = options?.forceFileName ? [options.forceFileName] : [];
        const results = await analyzeBmsScreenshots(files, state.registeredSystems, forceReprocessFileNames);
        log('info', 'Received analysis results from service.', { resultCount: results.length });

        const asyncJobs = [];
        for (const result of results) {
            if (isAnalysisRecord(result)) {
                // Handle synchronous result directly
                log('info', 'Processing synchronous analysis result.', { fileName: result.fileName });
                dispatch({ type: 'SYNC_ANALYSIS_COMPLETE', payload: { fileName: result.fileName, record: result } });
            } else {
                // Collect async jobs to be processed together
                asyncJobs.push(result);
            }
        }

        if (asyncJobs.length > 0) {
            log('info', 'Starting asynchronous analysis jobs.', { jobCount: asyncJobs.length });
            dispatch({ type: 'START_ANALYSIS_JOBS', payload: asyncJobs });
        }

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during analysis.';
        log('error', 'Analysis request failed.', { error: errorMessage });
        dispatch({ type: 'SET_ERROR', payload: errorMessage });
    }
  };
  
  const handleReprocess = async (fileToReprocess: File) => {
    log('info', 'Reprocess initiated.', { fileName: fileToReprocess.name });
    dispatch({ type: 'REPROCESS_START', payload: { fileName: fileToReprocess.name }});
    await handleAnalyze([fileToReprocess], { forceFileName: fileToReprocess.name });
  };

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
