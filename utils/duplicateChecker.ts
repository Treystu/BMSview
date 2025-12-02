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
    log('info', 'Phase 1: Checking all files for duplicates upfront.', { fileCount: files.length });
    
    // Check all files in parallel using allSettled to prevent entire operation from failing
    // if some checks fail (e.g., network errors, timeouts)
    const settledResults = await Promise.allSettled(
        files.map(async (file, index) => {
            try {
                const result = await checkFileDuplicate(file);
                return { file, index, ...result };
            } catch (err) {
                log('warn', 'Duplicate check failed for file, will analyze anyway.', { 
                    fileName: file.name,
                    error: err instanceof Error ? err.message : String(err)
                });
                return { file, index, isDuplicate: false, needsUpgrade: false };
            }
        })
    );

    // Extract values from settled promises, handling both fulfilled and rejected cases
    const checkResults = settledResults.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            // Fallback for unexpected rejections (shouldn't happen due to try-catch above)
            const file = files[index];
            log('error', 'Unexpected rejection in duplicate check', { 
                fileName: file?.name,
                error: result.reason instanceof Error ? result.reason.message : String(result.reason)
            });
            // Return a safe default - treat as a new file that needs analysis
            return { file, index, isDuplicate: false, needsUpgrade: false };
        }
    });

    // Categorize results into three groups
    const trueDuplicates = checkResults.filter(r => r.isDuplicate && !r.needsUpgrade);
    const needsUpgrade = checkResults.filter(r => r.isDuplicate && r.needsUpgrade);
    const newFiles = checkResults.filter(r => !r.isDuplicate);

    log('info', 'Duplicate check complete.', {
        totalFiles: files.length,
        trueDuplicates: trueDuplicates.length,
        needsUpgrade: needsUpgrade.length,
        newFiles: newFiles.length
    });

    return { trueDuplicates, needsUpgrade, newFiles };
}
