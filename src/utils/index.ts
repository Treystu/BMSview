
export const formatError = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return 'An unknown error occurred';
    }
};

export const getIsActualError = (error: unknown): boolean => {
    if (!error) return false;
    if (error instanceof Error && error.name === 'AbortError') return false;

    // Treat known status messages as non-errors to prevent "Analysis Failed" UI during processing
    if (typeof error === 'string') {
        const lower = error.toLowerCase();
        if (lower.startsWith('processing') ||
            lower.includes('checking for duplicates') ||
            lower.includes('extracting') ||
            lower.includes('fetching') ||
            lower.includes('saving') ||
            lower.includes('detecting duplicates') ||
            lower.includes('queued') ||
            lower.includes('submitted')) {
            return false;
        }
    }

    return true;
};

// Export other commonly used utils if needed, but for now just fix the build.
