/**
 * Shared utility for three-category duplicate checking
 * Used by both App.tsx and AdminDashboard.tsx
 */

import { checkFileDuplicate } from 'services/geminiService';
import { processBatches, BATCH_CONFIG } from './batchProcessor';

export interface DuplicateCheckResult {
    file: File;
    isDuplicate: boolean;
    needsUpgrade: boolean;
    recordId?: string;
    timestamp?: string;
    analysisData?: any;
}

export interface CategorizedFiles {
    trueDuplicates: DuplicateCheckResult[];
    needsUpgrade: DuplicateCheckResult[];
    newFiles: DuplicateCheckResult[];
}

/**
 * Check a single file for duplicates
 * @param file - File to check
 * @param log - Logging function
 * @returns Promise with duplicate check result
 */
async function checkSingleFile(
    file: File,
    log: (level: string, message: string, context?: any) => void
): Promise<DuplicateCheckResult> {
    const fileStartTime = Date.now();
    try {
        const result = await checkFileDuplicate(file);
        const fileDuration = Date.now() - fileStartTime;
        
        // Log per-file timing for debugging
        log('debug', 'File duplicate check complete', {
            fileName: file.name,
            isDuplicate: result.isDuplicate,
            needsUpgrade: result.needsUpgrade,
            durationMs: fileDuration,
            event: 'FILE_CHECK_COMPLETE'
        });
        
        return { file, ...result };
    } catch (err) {
        const fileDuration = Date.now() - fileStartTime;
        log('warn', 'Duplicate check failed for file, will analyze anyway.', { 
            fileName: file.name,
            durationMs: fileDuration,
            error: err instanceof Error ? err.message : String(err),
            event: 'FILE_CHECK_ERROR'
        });
        return { file, isDuplicate: false, needsUpgrade: false };
    }
}

/**
 * Check files using batch API endpoint (more efficient for multiple files)
 * @param files - Array of files to check
 * @param log - Logging function
 * @returns Promise with check results
 */
async function checkFilesUsingBatchAPI(
    files: File[],
    log: (level: string, message: string, context?: any) => void
): Promise<DuplicateCheckResult[]> {
    const startTime = Date.now();
    
    log('info', 'Using batch API for duplicate checking', {
        fileCount: files.length,
        event: 'BATCH_API_START'
    });
    
    try {
        // Read all files as base64
        const readStartTime = Date.now();
        const fileReads = await Promise.allSettled(
            files.map(async (file) => {
                const reader = new FileReader();
                return new Promise<{ file: File; image: string; mimeType: string; fileName: string }>((resolve, reject) => {
                    reader.onload = () => {
                        if (typeof reader.result === 'string') {
                            resolve({
                                file,
                                image: reader.result.split(',')[1], // Remove data:image/... prefix
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
            })
        );
        const readDurationMs = Date.now() - readStartTime;
        
        const filesData = fileReads
            .filter(result => result.status === 'fulfilled')
            .map(result => (result as PromiseFulfilledResult<any>).value);
        
        if (filesData.length !== files.length) {
            throw new Error(`Failed to read ${files.length - filesData.length} files`);
        }

        log('info', 'Files read complete', {
            totalFiles: files.length,
            successfulReads: filesData.length,
            readDurationMs,
            event: 'FILES_READ'
        });
        
        // Call batch API
        const apiStartTime = Date.now();
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
        const apiDurationMs = Date.now() - apiStartTime;
        
        if (!response.ok) {
            throw new Error(`Batch API failed with status ${response.status}`);
        }
        
        const result = await response.json();
        const totalDurationMs = Date.now() - startTime;
        
        log('info', 'Batch API check complete', {
            totalFiles: files.length,
            duplicates: result.summary?.duplicates || 0,
            upgrades: result.summary?.upgrades || 0,
            new: result.summary?.new || 0,
            readDurationMs,
            apiDurationMs,
            totalDurationMs,
            avgPerFileMs: (totalDurationMs / files.length).toFixed(2),
            event: 'BATCH_API_COMPLETE'
        });
        
        // Map results back to DuplicateCheckResult format
        return result.results.map((apiResult: any) => {
            const file = files.find(f => f.name === apiResult.fileName);
            return {
                file: file!,
                isDuplicate: apiResult.isDuplicate,
                needsUpgrade: apiResult.needsUpgrade,
                recordId: apiResult.recordId,
                timestamp: apiResult.timestamp,
                analysisData: apiResult.analysisData
            };
        });
        
    } catch (error) {
        const totalDurationMs = Date.now() - startTime;
        log('warn', 'Batch API failed, falling back to individual checks', {
            error: error instanceof Error ? error.message : String(error),
            totalDurationMs,
            event: 'BATCH_API_FALLBACK'
        });
        // Return empty array to trigger fallback
        return [];
    }
}

/**
 * Check all files for duplicates upfront
 * For large batches (>50 files), processes in chunks to avoid overwhelming backend
 * @param files - Array of files to check
 * @param log - Logging function
 * @returns Promise with categorized results
 */
export async function checkFilesForDuplicates(
    files: File[],
    log: (level: string, message: string, context?: any) => void
): Promise<CategorizedFiles> {
    const startTime = Date.now();
    log('info', 'Phase 1: Checking all files for duplicates upfront.', { 
        fileCount: files.length,
        willUseBatching: files.length > BATCH_CONFIG.MAX_BATCH_SIZE,
        batchSize: BATCH_CONFIG.MAX_BATCH_SIZE,
        event: 'START'
    });
    
    let checkResults: DuplicateCheckResult[];
    
    // Try batch API first for efficiency (works for any number of files up to 100)
    if (files.length > 1 && files.length <= 100) {
        const batchResults = await checkFilesUsingBatchAPI(files, log);
        if (batchResults.length > 0) {
            checkResults = batchResults;
        } else {
            // Batch API failed, fall back to individual checks
            log('info', 'Falling back to individual file checks', { fileCount: files.length });
            checkResults = await checkFilesIndividually(files, log);
        }
    } else if (files.length > 100) {
        // Too many files for batch API, use chunked approach
        log('info', 'Using chunked batch processing for large file set', { 
            fileCount: files.length,
            event: 'CHUNKED_BATCH'
        });
        checkResults = await checkFilesIndividually(files, log);
    } else {
        // Single file or very small batch - use individual check
        checkResults = await checkFilesIndividually(files, log);
    }

    // Categorize results into three groups
    const trueDuplicates = checkResults.filter(r => r.isDuplicate && !r.needsUpgrade);
    const needsUpgrade = checkResults.filter(r => r.isDuplicate && r.needsUpgrade);
    const newFiles = checkResults.filter(r => !r.isDuplicate);

    const totalDurationMs = Date.now() - startTime;
    const avgPerFile = files.length > 0 ? (totalDurationMs / files.length).toFixed(2) : 'N/A';

    log('info', 'Duplicate check complete.', {
        totalFiles: files.length,
        trueDuplicates: trueDuplicates.length,
        needsUpgrade: needsUpgrade.length,
        newFiles: newFiles.length,
        totalDurationMs,
        avgPerFileMs: avgPerFile,
        event: 'COMPLETE'
    });

    return { trueDuplicates, needsUpgrade, newFiles };
}

/**
 * Check files individually (fallback method)
 * @param files - Array of files to check
 * @param log - Logging function
 * @returns Promise with check results
 */
async function checkFilesIndividually(
    files: File[],
    log: (level: string, message: string, context?: any) => void
): Promise<DuplicateCheckResult[]> {
    // Use batch processing for large file sets to avoid overwhelming the backend
    // (unless batching is disabled via config)
    if (files.length > BATCH_CONFIG.MAX_BATCH_SIZE && !BATCH_CONFIG.DISABLE_BATCHING) {
        log('info', 'Using batch processing for large file set', {
            totalFiles: files.length,
            batchSize: BATCH_CONFIG.MAX_BATCH_SIZE,
            estimatedBatches: Math.ceil(files.length / BATCH_CONFIG.MAX_BATCH_SIZE),
            event: 'BATCH_MODE'
        });
        
        const batchResults = await processBatches(
            files,
            BATCH_CONFIG.MAX_BATCH_SIZE,
            async (batch: File[], batchIndex: number) => {
                log('debug', 'Processing batch', {
                    batchIndex,
                    batchSize: batch.length,
                    event: 'BATCH_START'
                });
                
                // Check all files in batch in parallel using allSettled
                const settledResults = await Promise.allSettled(
                    batch.map(file => checkSingleFile(file, log))
                );
                
                // Extract results
                return settledResults.map((result, localIndex) => {
                    if (result.status === 'fulfilled') {
                        return result.value;
                    } else {
                        const file = batch[localIndex];
                        log('error', 'Unexpected rejection in duplicate check', { 
                            fileName: file?.name,
                            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                            event: 'UNEXPECTED_REJECTION'
                        });
                        return { file, isDuplicate: false, needsUpgrade: false };
                    }
                });
            },
            {
                maxConcurrent: BATCH_CONFIG.MAX_CONCURRENT_BATCHES,
                delayMs: BATCH_CONFIG.BATCH_DELAY_MS,
                log,
                onProgress: (completed, total) => {
                    log('info', 'Batch progress', {
                        completed,
                        total,
                        percentComplete: Math.round((completed / total) * 100),
                        event: 'BATCH_PROGRESS'
                    });
                }
            }
        );
        
        // Flatten batch results
        return batchResults.flat();
    } else {
        // For small file sets, check all in parallel as before
        const checkStartTime = Date.now();
        const settledResults = await Promise.allSettled(
            files.map(file => checkSingleFile(file, log))
        );
        
        const checkDurationMs = Date.now() - checkStartTime;
        log('debug', 'Parallel check complete', {
            fileCount: files.length,
            checkDurationMs,
            event: 'PARALLEL_COMPLETE'
        });

        // Extract values from settled promises
        return settledResults.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                const file = files[index];
                log('error', 'Unexpected rejection in duplicate check', { 
                    fileName: file?.name,
                    fileIndex: index,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                    event: 'UNEXPECTED_REJECTION'
                });
                return { file, isDuplicate: false, needsUpgrade: false };
            }
        });
    }
}
