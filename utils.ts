import type { DisplayableAnalysisResult } from './types';

export const sha256Browser = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
};

/**
 * Determines if a DisplayableAnalysisResult represents an actual error
 * (as opposed to a pending/processing status message)
 */
export const getIsActualError = (result: DisplayableAnalysisResult): boolean => {
    if (!result.error) return false;
    
    const lowerError = result.error.toLowerCase();
    
    // These are processing/pending states, not actual errors
    const pendingStates = [
        'extracting',
        'matching',
        'fetching',
        'saving',
        'queued',
        'submitted',
        'processing',
        'checking'
    ];
    
    return !pendingStates.some(state => lowerError.includes(state));
};

/**
 * Formats an error message for display
 */
export const formatError = (error: string | null | undefined): string => {
    if (!error) return 'Unknown error';
    
    // Remove common error prefixes for cleaner display
    return error
        .replace(/^Error:\s*/i, '')
        .replace(/^backend_error:\s*/i, 'Backend Error: ')
        .trim();
};