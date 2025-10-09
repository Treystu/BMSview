
import React from 'react';
import { useFileUpload } from '../hooks/useFileUpload';
import SpinnerIcon from './icons/SpinnerIcon';

interface UploadSectionProps {
  onAnalyze: (files: File[]) => void;
  isLoading: boolean;
  error: string | null;
  hasResults: boolean;
}

const UploadSection: React.FC<UploadSectionProps> = ({ onAnalyze, isLoading, error, hasResults }) => {
  const {
    files,
    previews,
    isProcessing,
    fileError,
    handleFileChange,
    handleDrop,
    clearFiles,
  } = useFileUpload({ maxFileSizeMb: 4.5 });

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

  return (
    <section id="upload-section" className={`${hasResults ? 'py-8' : 'py-20'} bg-neutral-light transition-all duration-500 ease-in-out`}>
      <div className="container mx-auto px-6 text-center">
        {hasResults ? (
            <h2 className="text-3xl font-bold text-neutral-dark mb-6">Analyze More Screenshots</h2>
        ) : (
            <>
                <h2 className="text-3xl font-bold text-neutral-dark mb-4">Upload Your BMS Screenshots</h2>
                <p className="text-neutral mb-8 max-w-2xl mx-auto">
                Select one or more images, or a ZIP file containing images. For best results, ensure images are clear and values are readable.
                </p>
            </>
        )}
        <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-lg">
          <div 
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-secondary transition-colors"
          >
            <input
              type="file"
              id="file-upload"
              className="hidden"
              accept="image/*,.zip"
              onChange={handleFileChange}
              multiple
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              {previews.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {previews.map((src, index) => (
                         <img key={index} src={src} alt={`Preview ${index + 1}`} className="w-full h-auto object-cover rounded-md" />
                    ))}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-4-4V6a4 4 0 014-4h10a4 4 0 014 4v6a4 4 0 01-4 4H7z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16v4m0 0l-2-2m2 2l2-2"></path></svg>
                    <p className="mt-2 text-sm text-gray-600">
                        <span className="font-semibold text-secondary">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-gray-500">Images or a ZIP file</p>
                </div>
              )}
            </label>
          </div>
          {files.length > 0 && 
            <div className="mt-4 text-sm text-neutral flex justify-between items-center">
                <span>{files.length} file(s) selected.</span>
                <button onClick={clearFiles} className="text-red-500 hover:text-red-700 text-xs font-semibold">CLEAR</button>
            </div>
          }
          {isProcessing && <p className="mt-2 text-sm text-secondary">Processing files...</p>}
          {fileError && <p className="mt-4 text-sm text-red-600">{fileError}</p>}

          <button
            onClick={handleAnalyzeClick}
            disabled={files.length === 0 || isLoading || isProcessing || !!fileError}
            className="mt-8 w-full bg-secondary hover:bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <SpinnerIcon className="-ml-1 mr-3 h-5 w-5 text-white" />
                Analyzing...
              </>
            ) : (
              `Analyze ${files.length > 0 ? files.length : ''} Screenshot(s)`
            )}
          </button>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </section>
  );
};

export default UploadSection;
