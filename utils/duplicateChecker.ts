/**
 * Shared utility for two-phase duplicate checking
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
    
    // Check all files in parallel
    const checkResults = await Promise.all(
        files.map(async (file) => {
            try {
                const result = await checkFileDuplicate(file);
                return { file, ...result };
            } catch (err) {
                log('warn', 'Duplicate check failed for file, will analyze anyway.', { fileName: file.name });
                return { file, isDuplicate: false, needsUpgrade: false };
            }
        })
    );

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
