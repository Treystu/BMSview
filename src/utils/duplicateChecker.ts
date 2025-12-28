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
import type { AnalysisData, AnalysisRecord } from '../types';
import { BATCH_CONFIG, processBatches } from './batchProcessor';
import { calculateFileHashesBatch } from './clientHash';

// Shared exports for cache fast-path (PR #341)
export const generateLocalId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
export const EMPTY_CATEGORIZATION: CategorizedFiles = {
    trueDuplicates: [],
    needsUpgrade: [],
    newFiles: []
};

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

export type FileWithMeta = File & {
    _isDuplicate?: boolean;
    _analysisData?: AnalysisData | null;
    _isUpgrade?: boolean;
    _recordId?: string;
    _timestamp?: string;
    _isChecked?: boolean; // Flag to indicate this file has already passed a duplicate check
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
    alreadyCheckedNewFiles: File[];
    remainingFiles: File[];
} {
    const cachedDuplicates: CachedDuplicateResult[] = [];
    const cachedUpgrades: File[] = [];
    const alreadyCheckedNewFiles: File[] = [];
    const remainingFiles: File[] = [];

    for (const file of files) {
        const meta = file as FileWithMeta;

        // CASE A: Cached/Known Duplicate
        if (meta?._isDuplicate && meta?._analysisData) {

            // RETROACTIVE FIX: If the cached record is missing a System ID, force an upgrade.
            // This ensures we re-run the improved extraction logic on "Skipped" files.
            const data = meta._analysisData as any;
            const hasSystemId = !!(data.systemId || data.hardwareSystemId);
            if (!hasSystemId) {
                cachedUpgrades.push(file);
                continue;
            }

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

        // CASE B: Explicitly Marked Upgrade
        if (meta?._isUpgrade) {
            cachedUpgrades.push(file);
            continue;
        }

        // CASE C: Already Checked New File (e.g. from useFileUpload)
        // If it's tagged as checked but isn't a duplicate or upgrade, it must be new.
        if (meta?._isChecked) {
            alreadyCheckedNewFiles.push(file);
            continue;
        }

        // CASE D: Completely Unknown / Unchecked
        remainingFiles.push(file);
    }

    return { cachedDuplicates, cachedUpgrades, alreadyCheckedNewFiles, remainingFiles };
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
 * Check all files for duplicates upfront
 * For large batches (>50 files), processes in chunks to avoid overwhelming backend
 * @param files - Array of files to check
 * @param log - Logging function
 * @returns Promise with categorized results
 */
const BATCH_API_LIMIT = 1000;

export async function checkFilesForDuplicates(
    files: File[],
    log: (level: string, message: string, context?: any) => void
): Promise<CategorizedFiles> {
    const startTime = Date.now();
    log('info', 'DUPLICATE_CHECK: Phase 1 starting - checking all files for duplicates', {
        fileCount: files.length,
        BATCH_API_LIMIT,
        event: 'PHASE1_START'
    });

    if (files.length === 0) return { ...EMPTY_CATEGORIZATION };

    // 1. Calculate all hashes upfront (Layer 2)
    const hashStartTime = Date.now();
    const hashResults = await calculateFileHashesBatch(files);
    const hashDurationMs = Date.now() - hashStartTime;
    log('info', 'DUPLICATE_CHECK: Upfront hashing complete', {
        fileCount: files.length,
        durationMs: hashDurationMs,
        event: 'HASHING_COMPLETE'
    });

    // 2. Prepare chunks for Batch API (Layer 3)
    const chunks: { files: File[], hashes: { file: File, hash: string }[] }[] = [];
    for (let i = 0; i < files.length; i += BATCH_API_LIMIT) {
        const chunkFiles = files.slice(i, i + BATCH_API_LIMIT);
        const chunkHashes = hashResults
            .filter(r => r.hash !== null)
            .filter(r => chunkFiles.some(f => f.name === r.file.name)) as { file: File, hash: string }[];

        chunks.push({ files: chunkFiles, hashes: chunkHashes });
    }

    // 3. Process all chunks in parallel
    const allResults: DuplicateCheckResult[] = [];

    log('info', 'DUPLICATE_CHECK: Processing chunks in parallel', {
        numChunks: chunks.length,
        chunkSize: BATCH_API_LIMIT,
        event: 'PARALLEL_BATCH_START'
    });

    const chunkPromises = chunks.map(async (chunk, index) => {
        if (chunk.hashes.length === 0) {
            log('warn', 'Chunk has no valid hashes, falling back to individual', { index });
            return await checkFilesIndividually(chunk.files, log);
        }

        // Call Batch API specifically for this chunk's hashes
        // We bypass checkFilesUsingBatchAPI to use our pre-calculated hashes directly
        try {
            const payload = JSON.stringify({
                files: chunk.hashes.map(h => ({ hash: h.hash, fileName: h.file.name }))
            });

            const response = await fetch('/.netlify/functions/check-duplicates-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });

            if (!response.ok) throw new Error(`Batch API failed: ${response.status}`);

            const data = await response.json();

            // Map results back to original files
            return data.results.map((r: any) => {
                const h = chunk.hashes.find(ch => ch.file.name === r.fileName);
                return {
                    file: h?.file || chunk.files.find(f => f.name === r.fileName),
                    isDuplicate: r.isDuplicate,
                    needsUpgrade: r.needsUpgrade,
                    recordId: r.recordId,
                    timestamp: r.timestamp,
                    analysisData: r.analysisData
                };
            });
        } catch (err) {
            log('warn', 'Parallel chunk failed, falling back to individual', {
                index,
                error: err instanceof Error ? err.message : String(err)
            });
            return await checkFilesIndividually(chunk.files, log);
        }
    });

    const settledChunks = await Promise.all(chunkPromises);
    settledChunks.forEach(res => allResults.push(...res));

    // 4. Categorize results
    const trueDuplicates = allResults.filter(r => r.isDuplicate && !r.needsUpgrade);
    const needsUpgrade = allResults.filter(r => r.isDuplicate && r.needsUpgrade);
    const newFiles = allResults.filter(r => !r.isDuplicate);

    const totalDurationMs = Date.now() - startTime;
    log('info', 'DUPLICATE_CHECK: Phase 1 complete', {
        totalFiles: files.length,
        trueDuplicates: trueDuplicates.length,
        needsUpgrade: needsUpgrade.length,
        newFiles: newFiles.length,
        durationMs: totalDurationMs,
        avgPerFileMs: (totalDurationMs / files.length).toFixed(2),
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
