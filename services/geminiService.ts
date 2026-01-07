import type { AnalysisData } from '../types';

const fileWithMetadataToBase64 = (file: File): Promise<{ image: string, mimeType: string, fileName: string }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve({
                    image: reader.result.split(',')[1],
                    mimeType: file.type,
                    fileName: file.name
                });
            } else {
                reject(new Error('Failed to read file.'));
            }
        };
        reader.onerror = error => reject(error);
    });
};

const log = (level: 'info' | 'warn' | 'error' | 'debug', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        service: 'geminiService',
        message,
        context
    }));
};

let analysisWorker: Worker | null = null;
const getAnalysisWorker = (): Worker | null => {
    if (typeof Worker === 'undefined') return null;
    if (analysisWorker) return analysisWorker;

    log('info', 'Initializing singleton analysis worker');
    analysisWorker = new Worker(
        new URL('../src/workers/analysis.worker.ts', import.meta.url),
        { type: 'module' }
    );

    analysisWorker.onerror = (e) => {
        log('error', 'Singleton worker error', { error: e.message });
        // Optionally terminate and null out so it recreates on next call
        analysisWorker?.terminate();
        analysisWorker = null;
    };

    return analysisWorker;
};

/**
 * ***NEW SYNCHRONOUS FUNCTION***
 * Analyzes a single BMS screenshot and returns the data directly.
 * This replaces the old `analyzeBmsScreenshots` job-based function.
 * @param file - The file to analyze
 * @param forceReanalysis - If true, bypasses duplicate detection and forces a new analysis
 */
export const analyzeBmsScreenshot = async (file: File, forceReanalysis: boolean = false, systemId?: string): Promise<AnalysisData> => {
    const analysisContext = { fileName: file.name, fileSize: file.size, forceReanalysis };
    log('info', 'Starting synchronous analysis.', analysisContext);

    const endpoint = forceReanalysis
        ? `/.netlify/functions/analyze?sync=true&force=true${systemId ? `&systemId=${systemId}` : ''}`
        : `/.netlify/functions/analyze?sync=true${systemId ? `&systemId=${systemId}` : ''}`;

    try {
        const responseJson = await performAnalysisRequest(file, endpoint, analysisContext);

        // In sync mode, the server returns the full AnalysisRecord directly.
        // We extract the 'analysis' part and also check for isDuplicate flag
        const result: { analysis: AnalysisData; isDuplicate?: boolean; recordId?: string; timestamp?: string } = responseJson;

        if (!result.analysis) {
            log('error', 'API response was successful but missing analysis data.', result);
            throw new Error('API response was successful but missing analysis data.');
        }

        log('info', 'Synchronous analysis successful.', { fileName: file.name, isDuplicate: !!result.isDuplicate });

        // Attach metadata about duplicate detection to the analysis data
        // This allows the UI to show duplicate status
        const analysisWithMeta = {
            ...result.analysis,
            _isDuplicate: result.isDuplicate || false,
            _recordId: result.recordId,
            _timestamp: result.timestamp
        };

        return analysisWithMeta as AnalysisData;

    } catch (error) {
        log('error', 'Synchronous analysis failed.', { ...analysisContext, error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
};

import { calculateFileHash } from '../utils/clientHash';

/**
 * Check if a file is a duplicate without performing full analysis.
 * This is a lightweight check using the backend's content hash detection.
 * @param file - The file to check
 * @returns Promise with isDuplicate flag, needsUpgrade flag, and optional recordId/timestamp/analysisData of existing record
 */
export const checkFileDuplicate = async (file: File): Promise<{
    isDuplicate: boolean;
    needsUpgrade: boolean;
    recordId?: string;
    timestamp?: string;
    analysisData?: any;
}> => {
    const startTime = Date.now();
    const checkContext = { fileName: file.name, fileSize: file.size };
    log('info', 'DUPLICATE_CHECK: Starting individual file check', { ...checkContext, event: 'FILE_CHECK_START' });

    try {
        // OPTIMIZATION: Use hash-only check to avoid uploading the full image
        // Calculate hash on client side
        const hashStartTime = Date.now();
        const hash = await calculateFileHash(file);

        if (hash) {
            log('debug', 'DUPLICATE_CHECK: Calculated client-side hash', {
                fileName: file.name,
                hashPreview: hash.substring(0, 16) + '...',
                durationMs: Date.now() - hashStartTime
            });

            // Use the batch endpoint for single file hash check
            // This avoids sending the binary data over the network
            const endpoint = '/.netlify/functions/check-duplicates-batch';
            const payload = {
                files: [{
                    fileName: file.name,
                    hash: hash
                }]
            };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                if (data.results && data.results.length > 0) {
                    const result = data.results[0];
                    log('info', 'DUPLICATE_CHECK: Hash-only check complete', {
                        fileName: file.name,
                        isDuplicate: !!result.isDuplicate,
                        needsUpgrade: !!result.needsUpgrade,
                        event: 'HASH_CHECK_SUCCESS'
                    });

                    return {
                        isDuplicate: result.isDuplicate,
                        needsUpgrade: result.needsUpgrade,
                        recordId: result.recordId,
                        timestamp: result.timestamp,
                        analysisData: result.analysisData
                    };
                }
            } else {
                log('warn', 'DUPLICATE_CHECK: Hash check endpoint failed, falling back to legacy', { status: response.status });
            }
        }

        // Fallback or if hash failing: Use worker (without resizing per user feedback) for check
        // This uploads the file, which is slower but reliable
        const endpoint = '/.netlify/functions/analyze?sync=true&check=true';
        const responseJson = await performAnalysisRequest(file, endpoint, checkContext, 25000); // 25s timeout

        const totalDurationMs = Date.now() - startTime;
        const result = responseJson;

        // Enhanced logging with full result details
        log('info', 'DUPLICATE_CHECK: Backend response received (legacy path)', {
            fileName: file.name,
            isDuplicate: !!result.isDuplicate,
            needsUpgrade: !!result.needsUpgrade,
            hasRecordId: !!result.recordId,
            hasTimestamp: !!result.timestamp,
            hasAnalysisData: !!result.analysisData,
            totalDurationMs,     // Total = read + fetch + overhead (JSON parsing, etc.)
            event: 'API_RESPONSE'
        });

        return {
            isDuplicate: result.isDuplicate || false,
            needsUpgrade: result.needsUpgrade || false,
            recordId: result.recordId,
            timestamp: result.timestamp,
            analysisData: result.analysisData
        };

    } catch (error) {
        // Detect timeout errors specifically
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        const totalDurationMs = Date.now() - startTime;

        // Special handling for 404/501 (Endpoint not available) - usually propagated as Error
        if (errorMessage.includes('404') || errorMessage.includes('501')) {
            log('info', 'DUPLICATE_CHECK: Endpoint not available, treating as new file', {
                fileName: file.name,
                event: 'ENDPOINT_NOT_AVAILABLE'
            });
            return { isDuplicate: false, needsUpgrade: false };
        }

        log('warn', 'DUPLICATE_CHECK: File check failed, treating as new file', {
            ...checkContext,
            error: errorMessage,
            isTimeout,
            totalDurationMs,
            event: 'FILE_CHECK_ERROR'
        });
        return { isDuplicate: false, needsUpgrade: false };
    }
};

/**
 * Shared helper to perform analysis requests (analyze or duplicate check)
 * Tries to use Worker (for resizing efficiency) then falls back to main thread.
 */
async function performAnalysisRequest(file: File, relativeEndpoint: string, context: object, timeoutMs: number = 60000): Promise<any> {

    // 1. Try Worker Flow
    if (typeof Worker !== 'undefined') {
        try {
            const worker = getAnalysisWorker();
            if (!worker) throw new Error('Failed to initialize analysis worker');
            const activeWorker = worker;

            // Compute absolute endpoint
            const endpoint = new URL(relativeEndpoint, window.location.origin).toString();

            const messageId = Math.random().toString(36).substring(2) + Date.now().toString(36);

            const workerPromise = new Promise<any>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    activeWorker.removeEventListener('message', handleMessage);
                    reject(new Error(`Worker timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                function handleMessage(msg: MessageEvent) {
                    const data = msg.data || {};
                    // Match by messageId to allow concurrency
                    if (data.messageId !== messageId) return;

                    clearTimeout(timeout);
                    activeWorker.removeEventListener('message', handleMessage);

                    if (data.error) {
                        reject(new Error(data.error));
                        return;
                    }
                    if (!data.ok) {
                        reject(new Error(`Worker request failed with status ${data.status}`));
                        return;
                    }

                    resolve(data.json);
                }

                activeWorker.addEventListener('message', handleMessage);

                try {
                    activeWorker.postMessage({
                        file,
                        endpoint,
                        fileName: file.name,
                        mimeType: file.type,
                        messageId
                    });
                } catch (postErr) {
                    clearTimeout(timeout);
                    activeWorker.removeEventListener('message', handleMessage);
                    reject(postErr);
                }
            });

            const result = await workerPromise;
            return result;

        } catch (workerErr) {
            log('warn', 'Worker request failed; falling back to direct fetch.', { error: workerErr instanceof Error ? workerErr.message : String(workerErr) });
            // Fall through to direct fetch
        }
    }

    // 2. Fallback: Direct Fetch (Main Thread)
    const imagePayload = await fileWithMetadataToBase64(file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        log('warn', `Request timed out on client after ${timeoutMs}ms.`);
        controller.abort();
    }, timeoutMs);

    try {
        log('info', `Submitting request to ${relativeEndpoint} (Basic Fetch)`, context);

        const response = await fetch(relativeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imagePayload }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorText = 'Failed to read error response';
            try {
                errorText = await response.text();
            } catch (e) {
                // ignore
            }
            // Try to parse JSON error if possible
            let errorBody;
            try { errorBody = JSON.parse(errorText); } catch { }

            const errorMessage = (typeof errorBody === 'object' && errorBody?.error) ? errorBody.error : `Server responded with status ${response.status}: ${errorText}`;
            throw new Error(errorMessage);
        }

        const data = await response.json();

        // Attach headers for rate-limit aware processing
        return {
            ...data,
            _meta: {
                headers: response.headers
            }
        };
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}
