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
    
    // Use batch processing for large file sets to avoid overwhelming the backend
    if (files.length > BATCH_CONFIG.MAX_BATCH_SIZE) {
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
        checkResults = batchResults.flat();
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
        checkResults = settledResults.map((result, index) => {
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
