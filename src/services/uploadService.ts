
import axios from 'axios';
import type { AnalysisData } from '../../types';

export interface UploadResult {
  success: boolean;
  fileId?: string;
  filename?: string;
  message?: string;
  error?: string;
  processingResult?: AnalysisData;
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
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { data?: { error?: string; message?: string } } };
      // Server responded with error
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Upload failed',
        message: axiosError.response?.data?.message
      };
    } else if (error && typeof error === 'object' && 'request' in error) {
      // Request made but no response
      return {
        success: false,
        error: 'Network error',
        message: 'No response from server'
      };
    } else {
      // Setup error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage
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
