import { useState, useCallback, useEffect, useMemo } from 'react';
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

const MAX_LOGGED_FILE_NAMES = 5;

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
    initialFiles?: File[];
}

// Type guard for valid non-Blob BlobPart inputs supported by the Blob constructor in this context.
// Only string, ArrayBuffer, and ArrayBufferView are checked because these are the only forms
// expected from our ingestion pipeline.
const isValidBlobSource = (input: unknown): input is Exclude<BlobPart, Blob> =>
    typeof input === 'string' || input instanceof ArrayBuffer || ArrayBuffer.isView(input);

const ensureFileInstance = (input: unknown): File => {
    if (input instanceof File) {
        return input;
    }
    const rawType = (input as { type?: unknown }).type;
    const rawName = (input as { name?: unknown }).name;
    const fallbackType = typeof rawType === 'string' ? rawType : 'application/octet-stream';
    const fallbackName = typeof rawName === 'string' ? rawName : 'untitled';
    // Always wrap the payload into a File instance while preserving any existing Blob body.
    if (input instanceof Blob) {
        return new File([input], fallbackName, { type: input.type || fallbackType });
    }
    let blobSource: Blob;
    if (isValidBlobSource(input)) {
        blobSource = new Blob([input], { type: fallbackType });
    } else {
        blobSource = new Blob([], { type: fallbackType });
    }
    return new File([blobSource], fallbackName, { type: blobSource.type || fallbackType });
};

const isDuplicateTagged = (file: Blob) => {
    const fileRecord = file as Record<string, unknown>;
    return '_isDuplicate' in fileRecord && fileRecord._isDuplicate === true;
};

const readAsDataUrl = (file: Blob, readers: FileReader[]) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    readers.push(reader);
    reader.onload = () => {
        if (typeof reader.result === 'string') {
            resolve(reader.result);
        } else {
            reject(new Error('Preview result was not a data URL string'));
        }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file preview'));
    reader.readAsDataURL(file);
});

export const useFileUpload = ({ maxFileSizeMb = 4.5, initialFiles = [] }: FileUploadOptions = {}) => {
    const [files, setFiles] = useState<File[]>(initialFiles);
    const [skippedFiles, setSkippedFiles] = useState<Map<string, string>>(new Map());
    const [previews, setPreviews] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);

    const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

    const duplicateCount = useMemo(
        () => files.filter(isDuplicateTagged).length,
        [files]
    );

    useEffect(() => {
        if (duplicateCount === 0) return;

        setFiles(prev => {
            const duplicates: File[] = [];
            const sanitized: File[] = [];

            for (const file of prev) {
                if (isDuplicateTagged(file)) {
                    duplicates.push(file);
                } else {
                    sanitized.push(file);
                }
            }

            log('warn', 'State validation removed duplicate-tagged files before analysis.', {
                removedCount: duplicates.length,
                removedNames: duplicates.slice(0, MAX_LOGGED_FILE_NAMES).map(f => f.name),
                event: 'STATE_VALIDATION'
            });
            return sanitized;
        });
    }, [duplicateCount]);

    useEffect(() => {
        let isCancelled = false;
        const readers: FileReader[] = [];
        const cleanup = () => {
            isCancelled = true;
            readers.forEach(reader => {
                if (reader.readyState === FileReader.LOADING) {
                    reader.abort();
                }
            });
        };

        setFileError(null);
        const validFiles: File[] = [];
        let nonBlobFiltered = 0;
        let duplicateFiltered = 0;

        for (const file of files) {
            if (!(file instanceof Blob)) {
                nonBlobFiltered += 1;
                continue;
            }
            if (isDuplicateTagged(file)) {
                duplicateFiltered += 1;
                continue;
            }
            validFiles.push(file);
        }

        if (nonBlobFiltered > 0) {
            log('warn', 'Filtered non-blob entries from preview generation.', {
                total: files.length,
                filteredOut: nonBlobFiltered
            });
        }

        if (duplicateFiltered > 0) {
            log('info', 'Excluded duplicate-tagged entries from preview generation.', {
                total: files.length - nonBlobFiltered,
                filteredOut: duplicateFiltered,
                event: 'PREVIEW_FILTER'
            });
        }

        if (validFiles.length === 0) {
            setPreviews([]);
            return cleanup;
        }

        // IIFE pattern used because useEffect cannot be async directly. isCancelled guards state updates; cleanup aborts readers.
        (async () => {
            try {
                const newPreviews = await Promise.all(validFiles.map(file => readAsDataUrl(file, readers)));
                if (!isCancelled) {
                    setPreviews(newPreviews);
                }
            } catch (error) {
                log('warn', 'Preview generation failed. Skipping previews to avoid UI crash.', {
                    error: error instanceof Error ? error.message : String(error)
                });
                if (!isCancelled) {
                    setPreviews([]);
                }
            }
        })();

        return cleanup;
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
            fileNames: filesToCheck.slice(0, MAX_LOGGED_FILE_NAMES).map(f => f.name),
            event: 'CHECK_START'
        });
        
        try {
            const { trueDuplicates, needsUpgrade, newFiles } = await checkFilesForDuplicates(filesToCheck, log);

            const duplicateReasons = new Map<string, string>();
            const processedFiles: File[] = [];
            if (trueDuplicates.length > 0) {
                trueDuplicates.forEach(dup => {
                    const baseFile = ensureFileInstance(dup.file);
                    const duplicateKey = `${baseFile.name} (${baseFile.size} bytes @ ${baseFile.lastModified || 'unknown'})`;
                    duplicateReasons.set(duplicateKey, 'Already uploaded');
                });

                log('info', 'UNIFIED_DUPLICATE_CHECK: Skipping duplicate files from queue.', {
                    skippedCount: trueDuplicates.length,
                    skippedNames: Array.from(duplicateReasons.keys()).slice(0, MAX_LOGGED_FILE_NAMES),
                    event: 'DUPLICATE_SKIPPED'
                });
            }

            // Upgrades: create wrapper objects with metadata
            for (const item of needsUpgrade) {
                const baseFile = ensureFileInstance(item.file);
                const upgradeFile = Object.assign(Object.create(Object.getPrototypeOf(baseFile)), baseFile, { 
                    _isUpgrade: true 
                });
                processedFiles.push(upgradeFile);
            }
            
            // New files: add as-is
            for (const item of newFiles) {
                processedFiles.push(ensureFileInstance(item.file));
            }
            
            log('info', 'UNIFIED_DUPLICATE_CHECK: Complete', {
                totalFiles: filesToCheck.length,
                duplicates: trueDuplicates.length,
                upgrades: needsUpgrade.length,
                newFiles: newFiles.length,
                event: 'CHECK_COMPLETE'
            });

            if (duplicateReasons.size > 0) {
                setSkippedFiles(prev => {
                    const next = new Map(prev);
                    duplicateReasons.forEach((reason, name) => next.set(name, reason));
                    return next;
                });
            }

            if (processedFiles.length === 0 && duplicateReasons.size > 0) {
                setFileError('All selected files were previously uploaded and were skipped.');
                return;
            }

            if (processedFiles.length > 0) {
                setFiles(prev => [...prev, ...processedFiles]);
            }

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
