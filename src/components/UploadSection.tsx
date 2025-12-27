import React, { useCallback, useState } from 'react';
import UploadOptimizer from '../utils/uploadOptimizer';

interface UploadProgress {
  completed: number;
  total: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
}

interface UploadResult {
  results: any[];
  errors: Array<{ file: string; error: string }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  };
}

interface UploadSectionProps {
  onUploadComplete?: (results: UploadResult) => void;
}

const UploadSection: React.FC<UploadSectionProps> = ({ onUploadComplete }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [results, setResults] = useState<UploadResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [optimizer] = useState(() => new UploadOptimizer());
  const [isStoryMode, setIsStoryMode] = useState(false);
  const [sequenceId, setSequenceId] = useState('');


  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    setFiles(selectedFiles);
    setValidationErrors([]);
    setResults(null);

    // Validate files immediately
    const validation = optimizer.validateFiles(selectedFiles);
    if (!validation.allValid) {
      const errors = validation.invalidFiles.map(file =>
        `${file.name}: ${file.errors.join(', ')}`
      );
      setValidationErrors(errors);
    }
  }, [optimizer]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const droppedFiles = Array.from(event.dataTransfer.files);
    setFiles(droppedFiles);
    setValidationErrors([]);
    setResults(null);

    // Validate dropped files
    const validation = optimizer.validateFiles(droppedFiles);
    if (!validation.allValid) {
      const errors = validation.invalidFiles.map(file =>
        `${file.name}: ${file.errors.join(', ')}`
      );
      setValidationErrors(errors);
    }
  }, [optimizer]);

  const handleUpload = async () => {
    if (files.length === 0) return;

    // Re-validate before upload
    const validation = optimizer.validateFiles(files);
    if (!validation.allValid) {
      const errors = validation.invalidFiles.map(file =>
        `${file.name}: ${file.errors.join(', ')}`
      );
      setValidationErrors(errors);
      return;
    }

    setUploading(true);
    setProgress(null);
    setResults(null);

    try {
      // Optimize file order for better performance
      const optimizedFiles = optimizer.optimizeFileOrder(files);

      // Generate a sequence ID for this batch if in Story Mode and none provided
      const batchSequenceId = isStoryMode ? (sequenceId || `seq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`) : null;

      // Define upload function
      const uploadFunction = async (file: File) => {
        // Handle Image Uploads (Analysis)
        if (file.type.startsWith('image/')) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // Remove data URL prefix if present
              const base64Data = result.includes(',') ? result.split(',')[1] : result;
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const payload = {
            image: {
              image: base64,
              fileName: file.name,
              mimeType: file.type,
              sequenceId: batchSequenceId,
              timelinePosition: isStoryMode ? files.indexOf(file) + 1 : null
            }
          };

          // Use sync analysis for immediate feedback, or async if preferred. 
          // For story mode, we might want async if many files. 
          // But let's stick to the standard analysis endpoint.
          // We'll use sync=true for now to get immediate results, or let the backend decide.
          // Actually, for batch uploads, we should probably use the async flow if possible, 
          // but the current architecture might be simpler with sync for now.
          // Let's use the standard /api/analyze endpoint.




          const response = await fetch('/api/analyze?sync=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Analysis failed with status ${response.status}`);
          }

          return await response.json();
        }

        // Handle Data File Uploads (Standard Upload)
        else {
          const formData = new FormData();
          formData.append('file', file);

          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Upload failed with status ${response.status}`);
          }

          return await response.json();
        }
      };

      // Process batch with optimized concurrency
      const uploadResults = await optimizer.processBatch(
        optimizedFiles,
        uploadFunction,
        (progressData: UploadProgress) => {
          setProgress(progressData);
        }
      );

      setResults(uploadResults);
      if (onUploadComplete) {
        onUploadComplete(uploadResults);
      }

    } catch (error) {
      console.error('Upload failed:', error);
      setResults({
        results: [],
        errors: [{ file: 'Multiple', error: error instanceof Error ? error.message : 'Unknown error' }],
        summary: {
          total: files.length,
          successful: 0,
          failed: files.length,
          successRate: 0
        }
      });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const handleClearFiles = () => {
    setFiles([]);
    setValidationErrors([]);
    setResults(null);
    setProgress(null);
  };

  const getUploadStatistics = () => {
    return optimizer.getStatistics();
  };

  const clearStatistics = () => {
    optimizer.clearStatistics();
  };

  const formatFileSize = (bytes: number) => {
    return optimizer.formatBytes(bytes);
  };

  return (
    <div className="upload-section" style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 16px 0', color: '#1f2937' }}>File Upload</h2>
        <p style={{ margin: '0 0 16px 0', color: '#6b7280' }}>
          Upload battery data files for analysis. Supported formats: CSV, JSON, TXT, LOG
        </p>
      </div>

      {/* Story Mode Controls */}
      <div style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <input
            type="checkbox"
            id="story-mode"
            checked={isStoryMode}
            onChange={(e) => setIsStoryMode(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <label htmlFor="story-mode" style={{ fontWeight: 'bold', color: '#1f2937' }}>
            Enable Story Mode (Timeline Analysis)
          </label>
        </div>

        {isStoryMode && (
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#4b5563' }}>
              Sequence ID (Optional - leave blank to auto-generate)
            </label>
            <input
              type="text"
              value={sequenceId}
              onChange={(e) => setSequenceId(e.target.value)}
              placeholder="e.g., maintenance-cycle-2023-10"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px'
              }}
            />
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              Files will be analyzed as a sequence in the order they appear below.
            </p>
          </div>
        )}
      </div>



      {/* Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: '8px',
          padding: '40px',
          textAlign: 'center',
          backgroundColor: '#f9fafb',
          cursor: 'pointer',
          transition: 'border-color 0.2s'
        }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
        <div style={{ fontSize: '16px', color: '#374151', marginBottom: '8px' }}>
          Drag and drop files here, or click to select
        </div>
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          Maximum file size: 50MB per file
        </div>
        <input
          id="file-input"
          type="file"
          multiple
          accept=".csv,.json,.txt,.log,.xml,.jpg,.jpeg,.png,.webp"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '4px'
        }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#dc2626', fontSize: '14px' }}>
            Validation Errors:
          </h4>
          {validationErrors.map((error, index) => (
            <div key={index} style={{ fontSize: '13px', color: '#991b1b', marginBottom: '4px' }}>
              • {error}
            </div>
          ))}
        </div>
      )}

      {/* File List */}
      {files.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <h3 style={{ margin: 0, color: '#1f2937', fontSize: '16px' }}>
              Selected Files ({files.length})
            </h3>
            <button
              onClick={handleClearFiles}
              style={{
                padding: '6px 12px',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Clear All
            </button>
          </div>

          <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '4px',
            backgroundColor: 'white'
          }}>
            {files.map((file, index) => (
              <div key={index} style={{
                padding: '12px',
                borderBottom: index < files.length - 1 ? '1px solid #f3f4f6' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontSize: '14px', color: '#1f2937', fontWeight: 'medium' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    {formatFileSize(file.size)}
                  </div>
                </div>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: file.size > 50 * 1024 * 1024 ? '#ef4444' : '#10b981'
                }} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
            <button
              onClick={handleUpload}
              disabled={uploading || validationErrors.length > 0}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: uploading || validationErrors.length > 0 ? '#9ca3af' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: uploading || validationErrors.length > 0 ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold'
              }}
            >
              {uploading ? 'Uploading...' : 'Upload Files'}
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div style={{ marginTop: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>
            Upload Progress
          </h3>
          <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '4px',
            padding: '12px',
            backgroundColor: '#f9fafb'
          }}>
            <div style={{ marginBottom: '8px' }}>
              <div style={{
                fontSize: '14px',
                color: '#1f2937',
                marginBottom: '4px'
              }}>
                {progress.completed} of {progress.total} files ({progress.percentage}%)
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                Batch {progress.currentBatch} of {progress.totalBatches}
              </div>
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#e5e7eb',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${progress.percentage}%`,
                height: '100%',
                backgroundColor: '#3b82f6',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{ marginTop: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>
            Upload Results
          </h3>

          <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '4px',
            padding: '16px',
            backgroundColor: 'white'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937' }}>
                  {results.summary.total}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Files</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>
                  {results.summary.successful}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Successful</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ef4444' }}>
                  {results.summary.failed}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Failed</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>
                  {results.summary.successRate}%
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>Success Rate</div>
              </div>
            </div>

            {results.errors.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 8px 0', color: '#1f2937', fontSize: '14px' }}>
                  Errors:
                </h4>
                {results.errors.map((error, index) => (
                  <div key={index} style={{
                    padding: '8px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    fontSize: '13px',
                    color: '#991b1b'
                  }}>
                    <strong>{error.file}:</strong> {error.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Statistics */}
      <div style={{ marginTop: '20px' }}>
        <h3 style={{ margin: '0 0 12px 0', color: '#1f2937', fontSize: '16px' }}>
          Upload Statistics
        </h3>
        <button
          onClick={() => {
            const stats = getUploadStatistics();
            alert(JSON.stringify(stats, null, 2));
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            marginRight: '8px'
          }}
        >
          View Statistics
        </button>
        <button
          onClick={clearStatistics}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Clear Statistics
        </button>
      </div>
    </div>
  );
};

export default UploadSection;