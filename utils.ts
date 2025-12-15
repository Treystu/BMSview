import type { DisplayableAnalysisResult } from './types';

/**
 * Calculate SHA-256 hash for a file in a way that matches the backend
 * 
 * CRITICAL: This must match the backend's calculateImageHash() in unified-deduplication.cjs
 * 
 * Backend algorithm (unified-deduplication.cjs):
 * 1. Receives base64 string of image
 * 2. Decodes to binary: Buffer.from(base64String, 'base64')
 * 3. Hashes the binary: crypto.createHash('sha256').update(buffer).digest('hex')
 * 
 * Frontend must do the same:
 * 1. Read file as binary ArrayBuffer
 * 2. Hash the binary directly (same as backend after base64 decode)
 * 
 * This ensures hashes match MongoDB's contentHash field for duplicate detection.
 * 
 * @param file - File object to hash
 * @returns Promise<string> - Hex-encoded SHA-256 hash (64 chars)
 */
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