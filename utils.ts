// Helper to get the base name of a file path
export const getBasename = (path: string | undefined): string => {
  if (!path) return '';
  // Handles both forward and back slashes
  return path.split(/[/\\]/).pop() || '';
};

export const formatError = (error: string): string => {
    if (error.startsWith('failed_')) {
        const reason = error.replace('failed_', '');
        // Capitalize first letter of the reason
        const formattedReason = reason.charAt(0).toUpperCase() + reason.slice(1);
        return `Failed: ${formattedReason}`;
    }
    // Handle cases where it might already be formatted
    if (error.toLowerCase().startsWith('failed:')) {
        return error;
    }
    return error;
};
