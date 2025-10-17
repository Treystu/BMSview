import React, { useEffect, useState } from 'react';
import type { DisplayableAnalysisResult, BmsSystem, WeatherData, AnalysisData } from '../types';
import ThermometerIcon from './icons/ThermometerIcon';
import CloudIcon from './icons/CloudIcon';
import SunIcon from './icons/SunIcon';
import BoltIcon from './icons/BoltIcon';
import { streamInsights } from '../services/clientService';
import SpinnerIcon from './icons/SpinnerIcon';
import { formatError, getIsActualError } from '../utils';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'AnalysisResult',
        message,
        context
    }));
};

interface AnalysisResultProps {
  result: DisplayableAnalysisResult;
  registeredSystems: BmsSystem[];
  onLinkRecord: (recordId: string, systemId: string, dlNumber?: string | null) => void;
  onReprocess: (file: File) => void;
  onRegisterNewSystem: (dlNumber: string) => void;
}

// Status badge component
const StatusBadge: React.FC<{ status: string; isError?: boolean }> = ({ status, isError }) => {
    const getStatusStyles = () => {
        if (isError) return 'bg-red-100 text-red-800 border-red-200';
        if (status === 'completed') return 'bg-green-100 text-green-800 border-green-200';
        if (status === 'processing') return 'bg-blue-100 text-blue-800 border-blue-200';
        if (status === 'queued') return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        if (status === 'submitted') return 'bg-gray-100 text-gray-800 border-gray-200';
        return 'bg-orange-100 text-orange-800 border-orange-200';
    };

    const getStatusIcon = () => {
        if (status === 'processing') {
            return (
                <svg className="animate-spin h-3 w-3 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            );
        }
        if (status === 'queued') {
            return <span className="mr-1">⏳</span>;
        }
        if (status === 'completed') {
            return <span className="mr-1">✅</span>;
        }
        if (isError) {
            return <span className="mr-1">❌</span>;
        }
        return null;
    };

    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusStyles()}`}>
            {getStatusIcon()}
            {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
    );
};

// Progress indicator for long-running jobs
const JobProgress: React.FC<{ status: string; submittedAt?: number }> = ({ status, submittedAt }) => {
    const [elapsedTime, setElapsedTime] = useState(0);

    useEffect(() => {
        if (status === 'queued' || status === 'processing' || status === 'submitted') {
            const interval = setInterval(() => {
                if (submittedAt) {
                    setElapsedTime(Date.now() - submittedAt);
                }
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [status, submittedAt]);

    const formatElapsedTime = (ms: number) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        }
        return `${seconds}s`;
    };

    if (status === 'queued' || status === 'processing' || status === 'submitted') {
        return (
            <div className="mt-2 text-xs text-gray-500">
                {status === 'queued' && 'Waiting for processing...'}
                {status === 'processing' && 'Analyzing image...'}
                {status === 'submitted' && 'Submitted for analysis...'}
                {submittedAt && ` (${formatElapsedTime(elapsedTime)} elapsed)`}
            </div>
        );
    }

    return null;
};

const AnalysisResult: React.FC<AnalysisResultProps> = ({ result, registeredSystems, onLinkRecord, onReprocess, onRegisterNewSystem }) => {
  const { fileName, data, error, weather, isDuplicate, isBatchDuplicate, file, saveError, recordId } = result;

  useEffect(() => {
    const statusContext = { fileName, error, hasData: !!data, isDuplicate, recordId };
    log('info', 'AnalysisResult component rendered/updated.', statusContext);
  }, [result]);

  const isCompleted = error?.toLowerCase() === 'completed';
  const isPending = !!error && !getIsActualError(result);
  const isActualError = error && !isCompleted && !isPending;

  // Determine the actual status for display
  const getDisplayStatus = () => {
    if (data) return 'completed';
    if (error === 'Submitted') return 'submitted';
    if (error === 'Queued') return 'queued';
    if (error === 'Processing') return 'processing';
    if (error?.startsWith('failed_')) return error.replace('failed_', '');
    if (getIsActualError(result)) return 'error';
    return error || 'unknown';
  };

  const displayStatus = getDisplayStatus();

  const handleReprocessClick = () => {
    if (file) {
      log('info', 'Reprocess button clicked.', { fileName });
      onReprocess(file);
    }
  };

  if (isPending) {
    return (
      <div className="bg-neutral-light p-8 rounded-xl shadow-lg max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-neutral-dark mb-2 truncate">{fileName}</h3>
          <div className="flex items-center mb-2">
            <StatusBadge status={displayStatus} />
          </div>
          <JobProgress status={displayStatus} submittedAt={result.submittedAt} />
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-4">
          <div className="flex items-center">
            <svg className="animate-spin h-5 w-5 text-secondary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-neutral ml-2">Processing...</span>
          </div>
        </div>
      </div>
    );
  }

  const dlNumber = data?.dlNumber;
  let associatedSystemName: string | null = null;
  let adoptionNeeded = false;
  let associatedSystem: BmsSystem | undefined;

  if (dlNumber) {
    associatedSystem = registeredSystems.find(system => system.associatedDLs?.includes(dlNumber));
    if (associatedSystem) {
      associatedSystemName = associatedSystem.name;
    } else {
      adoptionNeeded = true;
    }
  }

  return (
    <div className="bg-neutral-light p-8 rounded-xl shadow-lg max-w-4xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <h3 className="text-2xl font-bold text-neutral-dark break-all flex-1">{fileName}</h3>
        <div className="ml-4">
          <StatusBadge status={displayStatus} isError={isActualError} />
        </div>
      </div>

      {isDuplicate && (
        <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-lg">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-blue-400 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-blue-800 font-medium">Duplicate Detection</p>
              <p className="text-blue-700 text-sm mt-1">
                {data
                  ? 'This appears to be a duplicate. Showing existing analysis.'
                  : isBatchDuplicate
                    ? 'Skipped: A file with the same name exists in this upload batch.'
                    : 'Skipped: A file with this name already exists in your history.'}
              </p>
              <button
                onClick={handleReprocessClick}
                className="mt-2 text-blue-600 hover:text-blue-800 font-semibold underline focus:outline-none"
                disabled={!file}
              >
                Process this file anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {saveError && (
        <div className="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded-r-lg">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-yellow-500 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h4 className="text-lg font-semibold text-yellow-800 mb-2">Warning: Not Saved</h4>
              <p className="text-yellow-700">The analysis was successful, but the result could not be saved to your history. The data below is displayed temporarily.</p>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer font-medium text-yellow-800 hover:underline">Show error details</summary>
                <p className="mt-1 text-yellow-600 bg-yellow-100 p-2 rounded-md font-mono text-xs break-all">{saveError}</p>
              </details>
            </div>
          </div>
        </div>
      )}

      {isActualError && !isDuplicate && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-red-500 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="text-lg font-semibold text-red-800 mb-2">Analysis Failed</h4>
              <p className="text-red-700">{formatError(error)}</p>
              {file && (
                <button
                  onClick={handleReprocessClick}
                  className="mt-2 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Rest of the existing AnalysisResult component content */}
          {/* This would include all the existing metric cards, insights, etc. */}
        </>
      )}
    </div>
  );
};

export default AnalysisResult;