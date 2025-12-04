/**
 * Shared utility for three-category duplicate checking
 * Used by both App.tsx and AdminDashboard.tsx
 */

import { checkFileDuplicate } from 'services/geminiService';

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
 * Check all files for duplicates upfront
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
        event: 'START'
    });
    
    // Check all files in parallel using allSettled to prevent entire operation from failing
    // if some checks fail (e.g., network errors, timeouts)
    const checkStartTime = Date.now();
    const settledResults = await Promise.allSettled(
        files.map(async (file, index) => {
            const fileStartTime = Date.now();
            try {
                const result = await checkFileDuplicate(file);
                const fileDuration = Date.now() - fileStartTime;
                
                // Log per-file timing for debugging
                log('debug', 'File duplicate check complete', {
                    fileName: file.name,
                    fileIndex: index,
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
                    fileIndex: index,
                    durationMs: fileDuration,
                    error: err instanceof Error ? err.message : String(err),
                    event: 'FILE_CHECK_ERROR'
                });
                return { file, isDuplicate: false, needsUpgrade: false };
            }
        })
    );
    
    const checkDurationMs = Date.now() - checkStartTime;

    // Extract values from settled promises, handling both fulfilled and rejected cases
    const checkResults = settledResults.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            // Fallback for unexpected rejections (shouldn't happen due to try-catch above)
            const file = files[index];
            log('error', 'Unexpected rejection in duplicate check', { 
                fileName: file?.name,
                fileIndex: index,
                error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                event: 'UNEXPECTED_REJECTION'
            });
            // Return a safe default - treat as a new file that needs analysis
            return { file, isDuplicate: false, needsUpgrade: false };
        }
    });

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
        checkDurationMs,
        totalDurationMs,
        avgPerFileMs: avgPerFile,
        event: 'COMPLETE'
    });

    return { trueDuplicates, needsUpgrade, newFiles };
}
