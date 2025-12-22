/**
 * Client-side hashing utilities for browser environment
 * Implements SHA-256 hashing using Web Crypto API (SubtleCrypto)
 * 
 * This module provides client-side hashing to reduce network payload size
 * when checking for duplicate images. Instead of sending full base64 images,
 * we can send just the SHA-256 hash (64 chars vs ~360KB per image).
 * 
 * @module utils/clientHash
 */

/**
 * Calculate SHA-256 hash from base64-encoded image using Web Crypto API
 * 
 * This is the browser-compatible version of the server-side calculateImageHash
 * from unified-deduplication.cjs. Uses SubtleCrypto instead of Node's crypto module.
 * 
 * @param base64String - Base64-encoded image data (with or without data URL prefix)
 * @returns Promise resolving to hex-encoded SHA-256 hash (64 chars) or null on error
 * 
 * @example
 * const hash = await calculateImageHashClient(base64ImageData);
 * if (hash) {
 *   console.log('Hash:', hash); // "a1b2c3d4..."
 * }
 */
export async function calculateImageHashClient(base64String: string): Promise<string | null> {
  try {
    if (!base64String || typeof base64String !== 'string') {
      console.warn('Client hash calculation skipped: missing or invalid base64 payload');
      return null;
    }

    // Check for browser environment and Web Crypto API availability
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      console.warn('Web Crypto API not available (non-browser environment or unsupported browser)');
      return null;
    }

    // Normalize payload: trim whitespace and strip data URL prefix if present
    const normalized = base64String.trim();
    const cleaned = normalized.startsWith('data:')
      ? normalized.slice(normalized.indexOf(',') + 1)
      : normalized;

    // Remove whitespace that may be introduced by transport layers
    const sanitized = cleaned.replace(/\s+/g, '');

    // Decode base64 to binary
    let binaryString: string;
    try {
      binaryString = atob(sanitized);
    } catch (decodeError) {
      console.error('Client hash calculation failed: invalid base64 payload', decodeError);
      return null;
    }

    // Convert binary string to Uint8Array
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Calculate SHA-256 hash using SubtleCrypto
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', bytes);

    // Convert ArrayBuffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.debug('Client hash generated', {
      hashPreview: hashHex.substring(0, 16) + '...',
      imageLength: sanitized.length
    });

    return hashHex;
  } catch (error) {
    console.error('Error calculating client-side image hash:', error);
    return null;
  }
}

/**
 * Calculate SHA-256 hashes for multiple base64 images in parallel
 * 
 * @param base64Images - Array of base64-encoded images
 * @returns Promise resolving to array of hashes (same order as input, null for failed hashes)
 * 
 * @example
 * const hashes = await calculateImageHashesBatch(['base64...', 'base64...']);
 * console.log('Hashes:', hashes); // ['a1b2c3...', 'def456...']
 */
export async function calculateImageHashesBatch(base64Images: string[]): Promise<(string | null)[]> {
  const startTime = Date.now();

  console.log('Calculating client-side hashes for batch', {
    count: base64Images.length,
    event: 'BATCH_HASH_START'
  });

  // Calculate all hashes in parallel
  const hashPromises = base64Images.map(image => calculateImageHashClient(image));
  const hashes = await Promise.all(hashPromises);

  const durationMs = Date.now() - startTime;
  const successCount = hashes.filter(h => h !== null).length;

  console.log('Client-side batch hashing complete', {
    totalImages: base64Images.length,
    successfulHashes: successCount,
    failedHashes: base64Images.length - successCount,
    durationMs,
    avgPerImageMs: base64Images.length > 0 ? (durationMs / base64Images.length).toFixed(2) : '0.00',
    event: 'BATCH_HASH_COMPLETE'
  });

  return hashes;
}

/**
 * Calculate SHA-256 hash from a File object
 * 
 * Reads the file, converts to base64, then calculates hash.
 * Convenience wrapper around calculateImageHashClient.
 * 
 * @param file - File object to hash
 * @returns Promise resolving to hex-encoded SHA-256 hash or null on error
 * 
 * @example
 * const hash = await calculateFileHash(imageFile);
 * if (hash) {
 *   console.log('File hash:', hash);
 * }
 */
export async function calculateFileHash(file: File): Promise<string | null> {
  try {
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = async () => {
        if (typeof reader.result === 'string') {
          const base64 = reader.result.split(',')[1]; // Remove data URL prefix
          const hash = await calculateImageHashClient(base64);
          resolve(hash);
        } else {
          reject(new Error('Failed to read file'));
        }
      };

      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsDataURL(file);
    });
  } catch (error) {
    console.error('Error calculating file hash:', error);
    return null;
  }
}

/**
 * Calculate SHA-256 hashes for multiple File objects
 * 
 * @param files - Array of File objects
 * @returns Promise resolving to array of { file, hash } objects where hash is the SHA-256 hash or null if failed
 * 
 * @example
 * const results = await calculateFileHashesBatch([file1, file2]);
 * results.forEach(({ file, hash }) => {
 *   console.log(file.name, hash);
 * });
 */
export async function calculateFileHashesBatch(
  files: File[]
): Promise<Array<{ file: File; hash: string | null }>> {
  const startTime = Date.now();

  console.log('Calculating file hashes for batch', {
    count: files.length,
    fileNames: files.slice(0, 5).map(f => f.name),
    event: 'FILE_HASH_START'
  });

  const CONCURRENCY_LIMIT = 5;
  const results: Array<{ file: File; hash: string | null }> = [];

  for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
    const chunk = files.slice(i, i + CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(
      chunk.map(async (file) => {
        const hash = await calculateFileHash(file);
        return { file, hash };
      })
    );
    results.push(...chunkResults);
  }

  const durationMs = Date.now() - startTime;
  const successCount = results.filter(r => r.hash !== null).length;

  console.log('File hash batch complete', {
    totalFiles: files.length,
    successfulHashes: successCount,
    failedHashes: files.length - successCount,
    durationMs,
    avgPerFileMs: files.length > 0 ? (durationMs / files.length).toFixed(2) : '0.00',
    event: 'FILE_HASH_COMPLETE'
  });

  return results;
}
