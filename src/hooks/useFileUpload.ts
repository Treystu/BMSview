import JSZip from 'jszip';
import { useCallback, useEffect, useState } from 'react';
import { checkFilesForDuplicates } from '../utils/duplicateChecker';

const log = (level: string, message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        hook: 'useFileUpload',
        message,
        context
    }));
};

// Limit log spam while still giving enough context for large batches (10 names max).
const MAX_LOGGED_FILE_NAMES = 10;

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
    const fileRecord = file as unknown as Record<string, unknown>;
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

export const useFileUpload = ({ maxFileSizeMb = 4.5, initialFiles = [], propagateDuplicates = false }: FileUploadOptions & { propagateDuplicates?: boolean } = {}) => {
    const [files, setFiles] = useState<File[]>(initialFiles);
    const [skippedFiles, setSkippedFiles] = useState<Map<string, string>>(new Map());
    const [previews, setPreviews] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);

    const maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

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
        const { validFiles, nonBlobFiltered, duplicateFiltered } = files.reduce((acc, file) => {
            if (!(file instanceof Blob)) {
                acc.nonBlobFiltered += 1;
                return acc;
            }
            if (isDuplicateTagged(file)) {
                acc.duplicateFiltered += 1;
                return acc;
            }
            acc.validFiles.push(file);
            return acc;
        }, { validFiles: [] as File[], nonBlobFiltered: 0, duplicateFiltered: 0 });

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
            for (const dup of trueDuplicates) {
                const baseFile = ensureFileInstance(dup.file);
                const duplicateDescription = `${baseFile.name} (${baseFile.size} bytes @ ${baseFile.lastModified || 'unknown'})`;

                if (propagateDuplicates) {
                    // Propagate duplicates as files with metadata for consumers (e.g. AdminDashboard restoration)
                    (baseFile as any)._isDuplicate = true;
                    (baseFile as any)._analysisData = dup.analysisData;
                    (baseFile as any)._recordId = dup.recordId;
                    (baseFile as any)._timestamp = dup.timestamp;
                    processedFiles.push(baseFile);
                } else {
                    duplicateReasons.set(duplicateDescription, 'Already uploaded');
                }
            }

            // Upgrades: create wrapper objects with metadata
            for (const item of needsUpgrade) {
                const baseFile = ensureFileInstance(item.file);
                // Preserve the native File/Blob brand by mutating the real File instance instead of cloning.
                // Cloning via Object.assign/Object.create strips internal slots and breaks FileReader in Safari/Chromium.
                (baseFile as any)._isUpgrade = true;
                processedFiles.push(baseFile);
            }

            // New files: add as-is
            for (const item of newFiles) {
                processedFiles.push(ensureFileInstance(item.file));
            }

            if (duplicateReasons.size > 0) {
                log('info', 'UNIFIED_DUPLICATE_CHECK: Skipping duplicate files from queue.', {
                    skippedCount: trueDuplicates.length,
                    skippedNames: Array.from(duplicateReasons.keys()).slice(0, MAX_LOGGED_FILE_NAMES),
                    event: 'DUPLICATE_SKIPPED'
                });
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
                setFileError('All selected files are duplicates of previously uploaded files and were skipped. Please choose different files or review the skipped list.');
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
            const CHUNK_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
            let currentChunk: Promise<File>[] = [];
            let currentChunkSize = 0;
            let totalExtracted = 0;

            const entries = Object.values(zip.files);

            for (const zipEntry of entries) {
                const fileName = zipEntry.name;
                const baseName = fileName.split('/').pop() || fileName;

                // Filter out directories, non-images, and macOS metadata files (__MACOSX folder or ._ files)
                if (
                    zipEntry.dir ||
                    !/\.(jpe?g|png|gif|webp)$/i.test(fileName) ||
                    fileName.includes('__MACOSX/') ||
                    baseName.startsWith('._')
                ) continue;

                const promise = zipEntry.async('blob').then(blob => {
                    const mimeType = blob.type || getMimeTypeFromFileName(zipEntry.name);
                    return new File([blob], zipEntry.name, { type: mimeType });
                });

                currentChunk.push(promise);
                // Use uncompressed size estimate (or fallback to 500KB average)
                const entrySize = (zipEntry as any)._data?.uncompressedSize || 500 * 1024;
                currentChunkSize += entrySize;

                if (currentChunkSize >= CHUNK_SIZE_BYTES) {
                    const extractedFiles = await Promise.all(currentChunk);
                    totalExtracted += extractedFiles.length;
                    log('info', 'ZIP chunk extracted.', { chunkFiles: extractedFiles.length, totalSoFar: totalExtracted });
                    await checkAndAddFiles(extractedFiles);

                    // Reset chunk
                    currentChunk = [];
                    currentChunkSize = 0;

                    // Yield to UI
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // Flush remaining files
            if (currentChunk.length > 0) {
                const extractedFiles = await Promise.all(currentChunk);
                totalExtracted += extractedFiles.length;
                await checkAndAddFiles(extractedFiles);
            }

            log('info', 'Successfully extracted all files from ZIP.', { ...zipContext, extractedCount: totalExtracted });

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
        const imageFiles = fileArray.filter(f =>
            f.type.startsWith('image/') && !f.name.startsWith('._')
        );

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
