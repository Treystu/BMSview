// Helper to get the base name of a file path
export const getBasename = (path: string | undefined): string => {
  if (!path) return '';
  // Handles both forward and back slashes
  return path.split(/[/\\]/).pop() || '';
};
