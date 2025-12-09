import { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
// Unified duplicate detection - use backend hashing via check-duplicates-batch endpoint
// This ensures consistent hash calculation with analyze.cjs (see unified-deduplication.cjs)

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        hook: 'useFileUpload',
        message,
        context
    }));
};

const getMimeTypeFromFileName = (fileName: string): string => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'gif':
            return 'image/gif';
        case 'webp':
            return 'image/webp';
        default:
            return 'application/octet-stream';
    }
};

interface FileUploadOptions {
    maxFileSizeMb?: number;
}

export const useFileUpload = ({ maxFileSizeMb = 4.5 }: FileUploadOptions = {}) => {
    const [files, setFiles] = useState<File[]>([]);
    const [skippedFiles, setSkippedFiles] = useState<Map<string, string>>(new Map());
    const [previews, setPreviews] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);

    const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

    useEffect(() => {
        const newPreviews = files.map(file => URL.createObjectURL(file));
        setPreviews(newPreviews);
        
        return () => {
            newPreviews.forEach(url => URL.revokeObjectURL(url));
        };
    }, [files]);

    const handleZipFile = useCallback(async (zipFile: File) => {
        setIsProcessing(true);
        setFileError(null);
        const zipContext = { fileName: zipFile.name, size: zipFile.size };
        log('info', 'Starting to process ZIP file.', zipContext);
        try {
            const zip = await JSZip.loadAsync(zipFile);
            const imagePromises: Promise<File>[] = [];
            zip.forEach((_, zipEntry) => {
                if (!zipEntry.dir && /\.(jpe?g|png|gif|webp)$/i.test(zipEntry.name)) {
                    const promise = zipEntry.async('blob').then(blob => {
                        const mimeType = blob.type || getMimeTypeFromFileName(zipEntry.name);
                        return new File([blob], zipEntry.name, { type: mimeType });
                    });
                    imagePromises.push(promise);
                }
            });
            const extractedFiles = await Promise.all(imagePromises);
            log('info', 'Successfully extracted files from ZIP.', { ...zipContext, extractedCount: extractedFiles.length });
            setFiles(prevFiles => [...prevFiles, ...extractedFiles]);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            log('error', 'Error unzipping file.', { ...zipContext, error: errorMessage });
            setFileError("Failed to unzip the file. It may be corrupt.");
        } finally {
            setIsProcessing(false);
        }
    }, []);

    const processFileList = useCallback(async (fileList: FileList) => {
        log('info', 'Processing new file list.', { count: fileList.length });
        setFileError(null);
        const fileArray = Array.from(fileList);

        const validImageFiles: File[] = [];
        const oversizedFiles: string[] = [];
        const imageFiles = fileArray.filter(f => f.type.startsWith('image/'));
        
        for (const f of imageFiles) {
            if (f.size > maxFileSizeBytes) {
                oversizedFiles.push(f.name);
            } else {
                validImageFiles.push(f);
            }
        }

        const zipFiles = fileArray.filter(f => f.name.endsWith('.zip') || f.type === 'application/zip' || f.type === 'application/x-zip-compressed');

        const imageProcessingPromise = (async () => {
            if (validImageFiles.length > 0) {
                setIsProcessing(true);
                
                log('info', 'Starting unified duplicate detection via backend', {
                    fileCount: validImageFiles.length,
                    event: 'UNIFIED_DEDUP_START'
                });
                
                try {
                    // Read all files as base64 (matching backend's calculateImageHash input format)
                    const fileReadPromises = validImageFiles.map(file => {
                        return new Promise<{ file: File; image: string; mimeType: string; fileName: string }>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                if (typeof reader.result === 'string') {
                                    // Validate data URL format (must contain comma separator)
                                    const commaIndex = reader.result.indexOf(',');
                                    if (commaIndex === -1) {
                                        reject(new Error(`Invalid data URL format for ${file.name}`));
                                        return;
                                    }
                                    const base64Data = reader.result.substring(commaIndex + 1);
                                    if (!base64Data) {
                                        reject(new Error(`Empty base64 data for ${file.name}`));
                                        return;
                                    }
                                    resolve({
                                        file,
                                        image: base64Data,
                                        mimeType: file.type,
                                        fileName: file.name
                                    });
                                } else {
                                    reject(new Error('Failed to read file'));
                                }
                            };
                            reader.onerror = () => reject(new Error('File read error'));
                            reader.readAsDataURL(file);
                        });
                    });
                    
                    const filesData = await Promise.all(fileReadPromises);
                    
                    // Call unified batch API (uses calculateImageHash on backend for consistent hashing)
                    const response = await fetch('/.netlify/functions/check-duplicates-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            files: filesData.map(f => ({
                                image: f.image,
                                mimeType: f.mimeType,
                                fileName: f.fileName
                            }))
                        })
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Batch API failed with status ${response.status}`);
                    }
                    
                    const result = await response.json();
                    
                    log('info', 'Unified duplicate detection complete', {
                        totalFiles: validImageFiles.length,
                        duplicates: result.summary?.duplicates || 0,
                        upgrades: result.summary?.upgrades || 0,
                        new: result.summary?.new || 0,
                        event: 'UNIFIED_DEDUP_COMPLETE'
                    });
                    
                    const newFiles: File[] = [];
                    const filesToUpgrade: File[] = [];
                    const newSkipped = new Map(skippedFiles);
                    
                    // Process results from batch API
                    result.results.forEach((apiResult: { 
                        fileName: string; 
                        isDuplicate: boolean; 
                        needsUpgrade: boolean; 
                        recordId?: string;
                        timestamp?: string;
                    }) => {
                        const fileData = filesData.find(f => f.fileName === apiResult.fileName);
                        if (!fileData) {
                            log('warn', 'File not found in original array', { fileName: apiResult.fileName });
                            return;
                        }
                        
                        if (apiResult.isDuplicate && !apiResult.needsUpgrade) {
                            // True duplicate - mark with analysis data
                            const duplicateFile = Object.assign(fileData.file, {
                                _isDuplicate: true,
                                _recordId: apiResult.recordId,
                                _timestamp: apiResult.timestamp
                            });
                            newFiles.push(duplicateFile);
                        } else if (apiResult.needsUpgrade) {
                            // Needs upgrade - mark for re-analysis
                            filesToUpgrade.push(fileData.file);
                        } else {
                            // New file - no duplicate found
                            newFiles.push(fileData.file);
                        }
                    });
                    
                    // Add new files and upgrades to the main files list
                    setFiles(prev => [...prev, ...newFiles, ...filesToUpgrade.map(f => Object.assign(f, { _isUpgrade: true }))]);
                    setSkippedFiles(newSkipped);
                    
                } catch (error) {
                    // On error, allow all files through (will be processed by analyze endpoint)
                    log('error', 'Unified duplicate detection failed, allowing all files', {
                        error: error instanceof Error ? error.message : String(error),
                        fileCount: validImageFiles.length,
                        event: 'UNIFIED_DEDUP_ERROR'
                    });
                    setFiles(prev => [...prev, ...validImageFiles]);
                }
                
                setIsProcessing(false);
            }
        })();

        if (oversizedFiles.length > 0) {
            const errorMsg = `The following files are too large (max ${maxFileSizeMb}MB): ${oversizedFiles.join(', ')}. Please resize them and try again.`;
            log('warn', 'Oversized files detected.', { oversizedCount: oversizedFiles.length, fileNames: oversizedFiles, maxSizeMb: maxFileSizeMb });
            setFileError(errorMsg);
        }
        
        log('info', 'File list processed.', { validImageCount: validImageFiles.length, oversizedCount: oversizedFiles.length, zipCount: zipFiles.length });
        
        const zipProcessingPromises = zipFiles.map(handleZipFile);

        await Promise.all([imageProcessingPromise, ...zipProcessingPromises]);

    }, [handleZipFile, maxFileSizeBytes, maxFileSizeMb, skippedFiles]);

    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            processFileList(event.target.files);
        }
    }, [processFileList]);
    
    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer.files) {
            processFileList(event.dataTransfer.files);
        }
    }, [processFileList]);

    const clearFiles = () => {
        log('info', 'Clearing all selected files.');
        setFiles([]);
        setSkippedFiles(new Map());
        setPreviews([]);
        setFileError(null);
    };

    return {
        files,
        skippedFiles,
        previews,
        isProcessing,
        fileError,
        handleFileChange,
        handleDrop,
        clearFiles,
        processFileList,
    };
};
