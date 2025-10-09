import React from 'react';
import type { DisplayableAnalysisResult } from '../types';
import { useFileUpload } from '../hooks/useFileUpload';

interface BulkUploadProps {
  onAnalyze: (files: File[]) => void;
  results: DisplayableAnalysisResult[];
  isLoading: boolean;
  showRateLimitWarning: boolean;
}

const PENDING_STATUSES = [
    'analyzing...', 'analyzing (api throttled)...', 'pending...', 'queued',
    'pre-analyzing...', 'starting analysis...', 'submitting...', 'saving...',
    'ready for analysis', 'processing'
];

// Helper to determine if a status string represents a final, non-successful state.
const getIsActualError = (error: string | null | undefined): boolean => {
    if (!error) return false;
    const lowerError = error.toLowerCase();
    const isPending = PENDING_STATUSES.some(status => status === lowerError);
    const isCompleted = lowerError === 'completed';
    return !isPending && !isCompleted;
};

// A more robust rendering function for the status of each upload.
const renderStatus = (result: DisplayableAnalysisResult) => {
    const status = result.error || 'Queued';
    const lowerStatus = status.toLowerCase();

    if (lowerStatus === 'completed' || (result.data && !result.error && !result.isDuplicate)) {
        return <span className="font-semibold text-green-400">Success</span>;
    }
    if (result.isDuplicate) {
        return <span title="Duplicate file name in batch or history" className="font-semibold text-yellow-400 cursor-help">Skipped</span>;
    }
    if (result.saveError) {
        return <span title={result.saveError} className="font-semibold text-yellow-400 cursor-help">Save Error</span>;
    }
    if (getIsActualError(result.error)) {
         return <span title={result.error || 'Failed'} className="font-semibold text-red-400 cursor-help">Error</span>;
    }
    
    // Any other status is considered in-progress.
    return <span className="font-semibold text-blue-400 capitalize">{status}</span>;
};


const BulkUpload: React.FC<BulkUploadProps> = ({ onAnalyze, results, isLoading, showRateLimitWarning }) => {
  const {
    files,
    isProcessing,
    fileError,
    handleFileChange,
    handleDrop,
    clearFiles,
  } = useFileUpload({});

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  
  const handleAnalyzeClick = () => {
    if (files.length > 0) {
      onAnalyze(files);
      clearFiles();
    }
  };

  // Calculate progress and summary with the new robust logic.
  const totalFiles = results.length;
  const isProcessed = (result: DisplayableAnalysisResult): boolean => {
    if (result.isDuplicate) return true;
    const status = result.error?.toLowerCase();
    if (status === 'completed') return true;
    return getIsActualError(status);
  };

  const processedFiles = results.filter(isProcessed).length;
  const successCount = results.filter(r => (r.error?.toLowerCase() === 'completed' || (r.data && !r.error)) && !r.isDuplicate).length;
  const duplicateCount = results.filter(r => r.isDuplicate).length;
  const errorCount = results.filter(r => getIsActualError(r.error)).length;
  const progress = totalFiles > 0 ? (processedFiles / totalFiles) * 100 : 0;

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-inner">
      <h3 className="font-semibold text-lg text-white mb-2">Supercharged Ingestion Portal</h3>
      <p className="text-sm text-gray-400 mb-4">Optimized for bulk uploads. Drop hundreds of screenshots or ZIP files at once.</p>

      <div 
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="border-2 border-dashed border-gray-600 rounded-lg p-10 text-center cursor-pointer hover:border-secondary transition-colors bg-gray-900/50"
      >
        <input
          type="file"
          id="bulk-file-upload"
          className="hidden"
          accept="image/*,.zip"
          onChange={handleFileChange}
          multiple
        />
        <label htmlFor="bulk-file-upload" className="cursor-pointer">
            <div className="flex flex-col items-center">
                <svg className="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-4-4V6a4 4 0 014-4h10a4 4 0 014 4v6a4 4 0 01-4 4H7z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16v4m0 0l-2-2m2 2l2-2"></path></svg>
                <p className="mt-2 text-sm text-gray-400">
                    <span className="font-semibold text-secondary">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-gray-500">Images or a ZIP file</p>
            </div>
        </label>
      </div>

      {files.length > 0 && 
        <div className="mt-4 text-sm text-gray-300 flex justify-between items-center">
            <span>{files.length} file(s) selected.</span>
            <button onClick={clearFiles} className="text-red-500 hover:text-red-400 text-xs font-semibold">CLEAR SELECTION</button>
        </div>
      }
      {isProcessing && <p className="mt-2 text-sm text-secondary">Processing files...</p>}
      {fileError && <p className="mt-4 text-sm text-red-600">{fileError}</p>}


      <button
        onClick={handleAnalyzeClick}
        disabled={files.length === 0 || isLoading || isProcessing}
        className="mt-6 w-full bg-secondary hover:bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center"
      >
        {isLoading ? 'Queueing Jobs...' : `Analyze ${files.length} File(s)`}
      </button>

      {showRateLimitWarning && (
        <div className="mt-4 text-center text-yellow-300 font-semibold p-4 bg-yellow-900/50 border border-yellow-600 rounded-md">
            <div className="flex items-center justify-center mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <h4 className="text-lg font-bold">Analysis Paused: Rate Limit Detected</h4>
            </div>
            <p className="text-sm text-yellow-400 mb-4 font-normal">
                This can happen if your IP address is not recognized by the system. Verifying your IP increases the analysis limit and should resolve this issue.
            </p>
            <button 
                onClick={() => document.getElementById('ip-management-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-md text-sm transition-colors"
            >
                Go to IP Verification
            </button>
        </div>
      )}

      {results.length > 0 && (
          <div className="mt-6">
              <h4 className="font-semibold text-white mb-2">Ingestion Progress</h4>
              <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div className="bg-secondary h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
              </div>
              <div className="text-xs text-gray-400 flex justify-between mt-2">
                  <span>Completed: {processedFiles} / {totalFiles}</span>
                  <div className="flex space-x-3">
                      <span className="text-green-400 font-medium">Success: {successCount}</span>
                      <span className="text-yellow-400 font-medium">Skipped: {duplicateCount}</span>
                      <span className="text-red-400 font-medium">Failed: {errorCount}</span>
                  </div>
              </div>

              <div className="mt-4 max-h-96 overflow-y-auto pr-2 space-y-2 border-t border-gray-700 pt-4">
                  {results.map((result) => (
                      <div key={result.fileName} className="bg-gray-900 p-3 rounded-md flex justify-between items-center text-sm">
                          <span className="truncate pr-4 text-gray-300 flex-1">{result.fileName}</span>
                          <div className="w-24 text-right">
                            {renderStatus(result)}
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};

export default BulkUpload;
