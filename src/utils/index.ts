
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
    return true;
};

// Export other commonly used utils if needed, but for now just fix the build.
