
import axios from 'axios';

export interface UploadResult {
  success: boolean;
  fileId?: string;
  filename?: string;
  message?: string;
  error?: string;
  processingResult?: any;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * Upload a file to the optimized upload endpoint
 * @param file File to upload
 * @param onProgress Optional callback for upload progress
 * @returns Upload result
 */
export async function uploadFile(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await axios.post('/.netlify/functions/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress({
            loaded: progressEvent.loaded,
            total: progressEvent.total,
          });
        }
      },
    });

    return response.data;
  } catch (error: any) {
    if (error.response) {
      // Server responded with error
      return {
        success: false,
        error: error.response.data.error || 'Upload failed',
        message: error.response.data.message
      };
    } else if (error.request) {
      // Request made but no response
      return {
        success: false,
        error: 'Network error',
        message: 'No response from server'
      };
    } else {
      // Setup error
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }
}

/**
 * Upload multiple files in parallel
 * @param files Array of files to upload
 * @param onProgress Optional callback for aggregate progress
 * @returns Array of upload results
 */
export async function uploadFiles(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<UploadResult[]> {
  let completed = 0;
  const totalFiles = files.length;

  const promises = files.map(file => 
    uploadFile(file).then(result => {
      completed++;
      if (onProgress) {
        onProgress((completed / totalFiles) * 100);
      }
      return result;
    })
  );

  return Promise.all(promises);
}
