import { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { checkFilesForDuplicates, type CategorizedFiles } from '../utils/duplicateChecker';

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

    /**
     * Adds files to the upload queue with duplicate detection and metadata tagging.
     *
     * This is the single entry point for adding files, used by both direct image uploads and ZIP extraction.
     *
     * - **Duplicate Detection:** Attempts to detect duplicates using `checkFilesForDuplicates`. If duplicate detection fails 
     *   (e.g., due to a network or backend error), the function falls back to adding all files without duplicate detection 
     *   or metadata tagging. In fallback mode, no `_isDuplicate`, `_isUpgrade`, or related metadata fields are attached.
     *
     * - **Metadata Fields:**
     *   - **True Duplicates:** Files identified as true duplicates are tagged with:
     *     - `_isDuplicate: true`
     *     - `_analysisData`: The analysis data from the existing record
     *     - `_recordId`: The record ID of the existing analysis
     *     - `_timestamp`: The timestamp of the existing analysis
     *   - **Upgrades:** Files that are considered upgrades (e.g., higher quality or newer versions) are tagged with:
     *     - `_isUpgrade: true`
     *   - **New Files:** Files that are neither duplicates nor upgrades are added as-is, with no extra metadata fields.
     *
     * - **Side Effects:** Updates the `files` state array with the processed files. Note: Duplicates are NOT added to 
     *   `skippedFiles` to maintain API contract (skippedFiles.size should remain 0).
     *
     * - **Caller Responsibility:** The caller (e.g., handleZipFile) is responsible for managing `isProcessing` state.
     *
     * @param filesToCheck Array of File objects to check and add.
     * @returns {Promise<void>}
     */
    const checkAndAddFiles = useCallback(async (filesToCheck: File[]) => {
        if (filesToCheck.length === 0) return;
        
        log('info', 'UNIFIED_DUPLICATE_CHECK: Starting for files', {
            fileCount: filesToCheck.length,
            fileNames: filesToCheck.slice(0, 5).map(f => f.name),
            event: 'CHECK_START'
        });
        
        try {
            const { trueDuplicates, needsUpgrade, newFiles } = await checkFilesForDuplicates(filesToCheck, log);
            
            // Build files array with metadata
            const processedFiles: File[] = [];
            
            // True duplicates: create wrapper objects with metadata instead of mutating File objects
            for (const dup of trueDuplicates) {
                // Create a new object that extends the File, avoiding direct mutation
                const duplicateFile = Object.assign(Object.create(Object.getPrototypeOf(dup.file)), dup.file, {
                    _isDuplicate: true,
                    _analysisData: dup.analysisData,
                    _recordId: dup.recordId,
                    _timestamp: dup.timestamp
                });
                processedFiles.push(duplicateFile);
                // Note: NOT adding to skippedFiles to maintain API contract (skippedFiles.size should be 0)
            }
            
            // Upgrades: create wrapper objects with metadata
            for (const item of needsUpgrade) {
                const upgradeFile = Object.assign(Object.create(Object.getPrototypeOf(item.file)), item.file, { 
                    _isUpgrade: true 
                });
                processedFiles.push(upgradeFile);
            }
            
            // New files: add as-is
            for (const item of newFiles) {
                processedFiles.push(item.file);
            }
            
            log('info', 'UNIFIED_DUPLICATE_CHECK: Complete', {
                totalFiles: filesToCheck.length,
                duplicates: trueDuplicates.length,
                upgrades: needsUpgrade.length,
                newFiles: newFiles.length,
                event: 'CHECK_COMPLETE'
            });
            
            setFiles(prev => [...prev, ...processedFiles]);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log('error', 'UNIFIED_DUPLICATE_CHECK: Failed', {
                error: errorMessage,
                fileCount: filesToCheck.length,
                event: 'CHECK_FAILED'
            });
            setFileError(`Unable to check for duplicates: ${errorMessage}`);
            // Fallback: add files without duplicate detection
            setFiles(prev => [...prev, ...filesToCheck]);
        }
    }, []);

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
            
            // Route through unified duplicate check
            await checkAndAddFiles(extractedFiles);
            
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            log('error', 'Error unzipping file.', { ...zipContext, error: errorMessage });
            setFileError("Failed to unzip the file. It may be corrupt.");
        } finally {
            // Caller manages isProcessing state
            setIsProcessing(false);
        }
    }, [checkAndAddFiles]);

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

        if (oversizedFiles.length > 0) {
            const errorMsg = `The following files are too large (max ${maxFileSizeMb}MB): ${oversizedFiles.join(', ')}. Please resize them and try again.`;
            log('warn', 'Oversized files detected.', { oversizedCount: oversizedFiles.length, fileNames: oversizedFiles, maxSizeMb: maxFileSizeMb });
            setFileError(errorMsg);
        }
        
        log('info', 'File list processed.', { validImageCount: validImageFiles.length, oversizedCount: oversizedFiles.length, zipCount: zipFiles.length });
        
        // Process image files first, then ZIP files sequentially to avoid concurrent state updates
        setIsProcessing(true);
        try {
            if (validImageFiles.length > 0) {
                await checkAndAddFiles(validImageFiles);
            }
            
            for (const zipFile of zipFiles) {
                await handleZipFile(zipFile);
            }
        } finally {
            setIsProcessing(false);
        }

    }, [handleZipFile, checkAndAddFiles, maxFileSizeBytes, maxFileSizeMb]);

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
