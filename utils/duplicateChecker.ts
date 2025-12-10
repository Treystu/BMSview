/**
 * Shared utility for three-category duplicate checking
 * Used by both App.tsx and AdminDashboard.tsx
 * 
 * Implements 4-layer duplicate detection architecture:
 * 1. Client-side cache fast-path (instant for cached duplicates)
 * 2. Client-side SHA-256 hashing (reduces payload 99.9%)
 * 3. Batch API with hash-only mode (efficient backend lookup)
 * 4. Individual fallback (when batch fails)
 */

import { checkFileDuplicate } from 'services/geminiService';
import { processBatches, BATCH_CONFIG } from './batchProcessor';
import { calculateFileHashesBatch } from './clientHash';
import type { AnalysisData, AnalysisRecord } from '../types';

// Shared exports for cache fast-path (PR #341)
export const generateLocalId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
export const EMPTY_CATEGORIZATION = {
    trueDuplicates: [],
    needsUpgrade: [],
    newFiles: []
} as const;

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

// Types for cache fast-path (PR #341)
export interface CachedDuplicateResult {
    file: File;
    analysisData: AnalysisData | null | undefined;
    recordId?: string;
    timestamp?: string;
}

type FileWithMeta = File & {
    _isDuplicate?: boolean;
    _analysisData?: AnalysisData | null;
    _isUpgrade?: boolean;
    _recordId?: string;
    _timestamp?: string;
};

/**
 * Partition files that already have duplicate metadata (from hash cache)
 * into cached duplicates, cached upgrades, and remaining files.
 * 
 * Layer 1 of duplicate detection: Client-side cache fast-path (PR #341)
 */
export function partitionCachedFiles(
    files: File[]
): {
    cachedDuplicates: CachedDuplicateResult[];
    cachedUpgrades: File[];
    remainingFiles: File[];
} {
    const cachedDuplicates: CachedDuplicateResult[] = [];
    const cachedUpgrades: File[] = [];
    const remainingFiles: File[] = [];

    for (const file of files) {
        const meta = file as FileWithMeta;
        // Treat as cached duplicate only when we also have full analysis data available
        if (meta?._isDuplicate && meta?._analysisData) {
            // Prefer metadata attached to analysis data; legacy file-level fields remain only for backward compatibility
            // with pre-cache uploads that attached identifiers directly on the File object.
            const recordId = (meta._analysisData?._recordId ?? meta._recordId) || undefined;
            const timestamp = (meta._analysisData?._timestamp ?? meta._timestamp) || undefined;
            cachedDuplicates.push({
                file,
                analysisData: meta._analysisData,
                recordId,
                timestamp
            });
            continue;
        }

        if (meta?._isUpgrade) {
            cachedUpgrades.push(file);
            continue;
        }

        remainingFiles.push(file);
    }

    return { cachedDuplicates, cachedUpgrades, remainingFiles };
}

/**
 * Build an AnalysisRecord from cached duplicate metadata
 */
export function buildRecordFromCachedDuplicate(
    dup: CachedDuplicateResult,
    prefix: string
): AnalysisRecord {
    return {
        id: dup.recordId || generateLocalId(prefix),
        timestamp: dup.timestamp || new Date().toISOString(),
        analysis: dup.analysisData || null,
        fileName: dup.file.name
    };
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
 * Check files using batch API endpoint with client-side hashing (more efficient for multiple files)
 * 
 * Layer 2 & 3 of duplicate detection:
 * - Layer 2: Client-side SHA-256 hashing using Web Crypto API (PR #339)
 * - Layer 3: Batch API with hash-only mode for efficient MongoDB lookup (PR #339)
 * 
 * **Optimized workflow:**
 * 1. Calculate SHA-256 hashes client-side using Web Crypto API
 * 2. Send only hashes to batch API (22 files: ~2KB vs ~8MB)
 * 3. Batch API looks up hashes in MongoDB
 * 4. Return results with duplicate status
 * 5. Files with failed client-side hashing fall back to server-side duplicate checking
 * 
 * @param files - Array of files to check
 * @param log - Logging function
 * @returns Promise with check results, or empty array if batch API fails (triggers fallback to individual checks)
 */
async function checkFilesUsingBatchAPI(
    files: File[],
    log: (level: string, message: string, context?: any) => void
): Promise<DuplicateCheckResult[]> {
    const startTime = Date.now();
    
    log('info', 'Using batch API for duplicate checking with client-side hashing', {
        fileCount: files.length,
        event: 'BATCH_API_START'
    });
    
    try {
        // Calculate hashes client-side using Web Crypto API (PR #339)
        const hashStartTime = Date.now();
        const hashResults = await calculateFileHashesBatch(files);
        const hashDurationMs = Date.now() - hashStartTime;
        
        // Filter out files that failed to hash
        const filesWithHashes = hashResults.filter(r => r.hash !== null);
        const failedHashes = hashResults.filter(r => r.hash === null);
        
        if (failedHashes.length > 0) {
            log('warn', 'Some files failed client-side hashing, will use server-side fallback', {
                failedCount: failedHashes.length,
                failedNames: failedHashes.slice(0, 5).map(r => r.file.name),
                event: 'HASH_FAILURES'
            });
        }
        
        if (filesWithHashes.length === 0) {
            throw new Error('All files failed client-side hashing');
        }

        log('info', 'Client-side hashing complete', {
            totalFiles: files.length,
            successfulHashes: filesWithHashes.length,
            failedHashes: failedHashes.length,
            hashDurationMs,
            avgPerFileMs: files.length > 0 ? (hashDurationMs / files.length).toFixed(2) : '0.00',
            event: 'CLIENT_HASH_COMPLETE'
        });
        
        // Prepare hash-only payload (minimal size) (PR #339)
        const hashOnlyPayload = filesWithHashes.map(({ file, hash }) => ({
            hash,
            fileName: file.name
        }));
        
        // Calculate payload size for comparison
        const payloadString = JSON.stringify({ files: hashOnlyPayload });
        const payloadSizeKB = (payloadString.length / 1024).toFixed(2);
        
        log('info', 'Sending hash-only batch request', {
            fileCount: hashOnlyPayload.length,
            payloadSizeKB,
            event: 'HASH_PAYLOAD_READY'
        });
        
        // Call batch API with hash-only payload (PR #339)
        const apiStartTime = Date.now();
        const response = await fetch('/.netlify/functions/check-duplicates-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadString
        });
        const apiDurationMs = Date.now() - apiStartTime;
        
        if (!response.ok) {
            // Sanitized error message to avoid exposing sensitive server details (PR #339)
            let errorMessage = `Batch API failed with status ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData?.error?.message) {
                    errorMessage = errorData.error.message;
                } else if (typeof errorData === 'string') {
                    errorMessage = errorData;
                }
            } catch (parseError) {
                // If JSON parsing fails, use generic error message
                errorMessage = `Batch API returned ${response.status} status`;
            }
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        const totalDurationMs = Date.now() - startTime;
        
        log('info', 'Batch API check complete', {
            totalFiles: files.length,
            duplicates: result.summary?.duplicates || 0,
            upgrades: result.summary?.upgrades || 0,
            new: result.summary?.new || 0,
            hashDurationMs,
            apiDurationMs,
            totalDurationMs,
            payloadSizeKB,
            avgPerFileMs: files.length > 0 ? (totalDurationMs / files.length).toFixed(2) : '0.00',
            event: 'BATCH_API_COMPLETE'
        });
        
        // Map results back to DuplicateCheckResult format
        const results: DuplicateCheckResult[] = result.results
            .map((apiResult: any) => {
                const fileWithHash = filesWithHashes.find(r => r.file.name === apiResult.fileName);
                if (!fileWithHash) {
                    log('warn', 'File not found in original array', { 
                        fileName: apiResult.fileName,
                        event: 'FILE_MISMATCH'
                    });
                    return null;
                }
                return {
                    file: fileWithHash.file,
                    isDuplicate: apiResult.isDuplicate,
                    needsUpgrade: apiResult.needsUpgrade,
                    recordId: apiResult.recordId,
                    timestamp: apiResult.timestamp,
                    analysisData: apiResult.analysisData
                };
            })
            .filter((r): r is DuplicateCheckResult => r !== null);
        
        // Server-side fallback for files that failed client-side hashing (PR #339)
        for (const failedResult of failedHashes) {
            try {
                log('info', 'Falling back to server-side duplicate check for file with failed client-side hash', {
                    fileName: failedResult.file.name,
                    event: 'SERVER_FALLBACK_START'
                });
                
                const serverResult = await checkFileDuplicate(failedResult.file);
                results.push({
                    file: failedResult.file,
                    isDuplicate: serverResult.isDuplicate,
                    needsUpgrade: serverResult.needsUpgrade,
                    recordId: serverResult.recordId,
                    timestamp: serverResult.timestamp,
                    analysisData: serverResult.analysisData
                });
                
                log('info', 'Server-side duplicate check complete', {
                    fileName: failedResult.file.name,
                    isDuplicate: serverResult.isDuplicate,
                    event: 'SERVER_FALLBACK_COMPLETE'
                });
            } catch (err) {
                log('warn', 'Failed server-side duplicate check for file that failed client-side hashing', {
                    fileName: failedResult.file.name,
                    error: err instanceof Error ? err.message : String(err),
                    event: 'SERVER_FALLBACK_ERROR'
                });
                // Treat as non-duplicate only after server-side check also fails
                results.push({
                    file: failedResult.file,
                    isDuplicate: false,
                    needsUpgrade: false
                });
            }
        }
        
        return results;
        
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
    log('info', 'DUPLICATE_CHECK: Phase 1 starting - checking all files for duplicates', { 
        fileCount: files.length,
        willUseBatching: files.length > BATCH_CONFIG.MAX_BATCH_SIZE,
        batchSize: BATCH_CONFIG.MAX_BATCH_SIZE,
        fileNames: files.slice(0, 5).map(f => f.name), // Log first 5 file names
        event: 'PHASE1_START'
    });
    
    let checkResults: DuplicateCheckResult[];
    
    // Try batch API first for efficiency (works for any number of files up to 100)
    if (files.length > 1 && files.length <= 100) {
        log('info', 'DUPLICATE_CHECK: Using batch API endpoint', { 
            fileCount: files.length,
            event: 'BATCH_API_SELECTED'
        });
        const batchResults = await checkFilesUsingBatchAPI(files, log);
        if (batchResults.length > 0) {
            log('info', 'DUPLICATE_CHECK: Batch API returned results', { 
                resultCount: batchResults.length,
                event: 'BATCH_API_SUCCESS'
            });
            checkResults = batchResults;
        } else {
            // Batch API failed, fall back to individual checks
            log('warn', 'DUPLICATE_CHECK: Batch API failed, falling back to individual checks', { 
                fileCount: files.length,
                event: 'BATCH_API_FALLBACK'
            });
            checkResults = await checkFilesIndividually(files, log);
        }
    } else if (files.length > 100) {
        // Too many files for batch API, use chunked approach
        log('info', 'DUPLICATE_CHECK: Too many files for batch API, using chunked processing', { 
            fileCount: files.length,
            event: 'CHUNKED_SELECTED'
        });
        checkResults = await checkFilesIndividually(files, log);
    } else {
        // Single file or very small batch - use individual check
        log('info', 'DUPLICATE_CHECK: Single file check', { 
            fileCount: files.length,
            event: 'INDIVIDUAL_SELECTED'
        });
        checkResults = await checkFilesIndividually(files, log);
    }

    // Categorize results into three groups
    const trueDuplicates = checkResults.filter(r => r.isDuplicate && !r.needsUpgrade);
    const needsUpgrade = checkResults.filter(r => r.isDuplicate && r.needsUpgrade);
    const newFiles = checkResults.filter(r => !r.isDuplicate);

    const totalDurationMs = Date.now() - startTime;
    const avgPerFile = files.length > 0 ? (totalDurationMs / files.length).toFixed(2) : 'N/A';

    // Enhanced logging with individual file results
    log('info', 'DUPLICATE_CHECK: Phase 1 complete - categorization finished', {
        totalFiles: files.length,
        trueDuplicates: trueDuplicates.length,
        trueDuplicateNames: trueDuplicates.slice(0, 5).map(r => r.file.name),
        needsUpgrade: needsUpgrade.length,
        upgradeNames: needsUpgrade.slice(0, 5).map(r => r.file.name),
        newFiles: newFiles.length,
        newFileNames: newFiles.slice(0, 5).map(r => r.file.name),
        totalDurationMs,
        avgPerFileMs: avgPerFile,
        event: 'PHASE1_COMPLETE'
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
