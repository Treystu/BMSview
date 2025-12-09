import { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { sha256Browser } from '../utils';
import { checkHashes } from '../services/clientService';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        hook: 'useFileUpload',
        message,
        context
    }));
};

/** Truncate hash for logging (first 16 chars + ...) */
const truncateHash = (hash: string): string => hash.substring(0, 16) + '...';

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
                
                log('info', 'UPFRONT_DUPLICATE_CHECK: Starting hash calculation for files', {
                    fileCount: validImageFiles.length,
                    fileNames: validImageFiles.map(f => f.name),
                    event: 'HASH_CALC_START'
                });
                
                try {
                    const hashStartTime = Date.now();
                    const hashes = await Promise.all(validImageFiles.map(sha256Browser));
                    const hashDurationMs = Date.now() - hashStartTime;
                    
                    log('info', 'UPFRONT_DUPLICATE_CHECK: Hash calculation complete', {
                        fileCount: hashes.length,
                        hashPreviews: hashes.map(truncateHash),
                        hashDurationMs,
                        event: 'HASH_CALC_COMPLETE'
                    });
                    
                    log('info', 'UPFRONT_DUPLICATE_CHECK: Calling checkHashes API', {
                        hashCount: hashes.length,
                        event: 'API_CALL_START'
                    });
                    
                    const apiStartTime = Date.now();
                    const { duplicates, upgrades } = await checkHashes(hashes);
                    const apiDurationMs = Date.now() - apiStartTime;
                    
                    log('info', 'UPFRONT_DUPLICATE_CHECK: checkHashes API response received', {
                        duplicatesFound: duplicates.length,
                        upgradesFound: upgrades.length,
                        duplicateHashes: duplicates.map(d => truncateHash(d.hash)),
                        upgradeHashes: upgrades.map(truncateHash),
                        apiDurationMs,
                        event: 'API_RESPONSE'
                    });
                    
                    const duplicateMap = new Map(duplicates.map(d => [d.hash, d.data]));
                    const upgradeSet = new Set(upgrades);

                    const newFiles: File[] = [];
                    const filesToUpgrade: File[] = [];
                    const newSkipped = new Map(skippedFiles);
                    let duplicateCount = 0;
                    let newFileCount = 0;

                    hashes.forEach((hash, index) => {
                        const file = validImageFiles[index];
                        const duplicateData = duplicateMap.get(hash);

                        if (duplicateData) {
                            log('info', 'UPFRONT_DUPLICATE_CHECK: File identified as duplicate', {
                                fileName: file.name,
                                hash: truncateHash(hash),
                                hasDuplicateData: !!duplicateData,
                                event: 'FILE_DUPLICATE'
                            });
                            // This is a duplicate, add it to the files array with the data
                            const duplicateFile = Object.assign(file, {
                                _isDuplicate: true,
                                _analysisData: duplicateData,
                            });
                            newFiles.push(duplicateFile);
                            duplicateCount++;
                        } else if (upgradeSet.has(hash)) {
                            log('info', 'UPFRONT_DUPLICATE_CHECK: File needs upgrade', {
                                fileName: file.name,
                                hash: truncateHash(hash),
                                event: 'FILE_UPGRADE'
                            });
                            filesToUpgrade.push(file);
                        } else {
                            log('info', 'UPFRONT_DUPLICATE_CHECK: File is new (not found in database)', {
                                fileName: file.name,
                                hash: truncateHash(hash),
                                event: 'FILE_NEW'
                            });
                            newFiles.push(file);
                            newFileCount++;
                        }
                    });
                    
                    log('info', 'UPFRONT_DUPLICATE_CHECK: Categorization complete', {
                        totalFiles: validImageFiles.length,
                        duplicates: duplicateCount,
                        upgrades: filesToUpgrade.length,
                        newFiles: newFileCount,
                        event: 'CATEGORIZE_COMPLETE'
                    });
                    
                    // Add new files and upgrades to the main files list
                    setFiles(prev => [...prev, ...newFiles, ...filesToUpgrade.map(f => Object.assign(f, { _isUpgrade: true }))]);
                    setSkippedFiles(newSkipped);
                } catch (error) {
                    // Duplicate check failed - log error and show user message
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    log('error', 'UPFRONT_DUPLICATE_CHECK: Failed to check for duplicates', {
                        error: errorMessage,
                        fileCount: validImageFiles.length,
                        event: 'CHECK_FAILED'
                    });
                    
                    // Show user-friendly error message
                    setFileError(`Unable to check for duplicate files: ${errorMessage}. Files will be processed, but duplicates may not be detected.`);
                    
                    // Process files anyway (no duplicate detection)
                    // This ensures users can still upload even if duplicate check fails
                    setFiles(prev => [...prev, ...validImageFiles]);
                } finally {
                    setIsProcessing(false);
                }
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
