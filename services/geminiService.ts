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

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        service: 'geminiService',
        message,
        context
    }));
};

/**
 * ***NEW SYNCHRONOUS FUNCTION***
 * Analyzes a single BMS screenshot and returns the data directly.
 * This replaces the old `analyzeBmsScreenshots` job-based function.
 * @param file - The file to analyze
 * @param forceReanalysis - If true, bypasses duplicate detection and forces a new analysis
 */
export const analyzeBmsScreenshot = async (file: File, forceReanalysis: boolean = false): Promise<AnalysisData> => {
    const analysisContext = { fileName: file.name, fileSize: file.size, forceReanalysis };
    log('info', 'Starting synchronous analysis.', analysisContext);

    try {
        // Offload file read + network call to a worker. If worker fails or times out, fall back to direct fetch.
        if (typeof Worker !== 'undefined') {
            try {
                // Use the dedicated worker file bundled by Vite
                const worker = new Worker(
                    new URL('../src/workers/analysis.worker.ts', import.meta.url),
                    { type: 'module' }
                );

                // Compute an absolute endpoint URL to ensure it works in WorkerGlobalScope
                const endpoint = new URL(
                    forceReanalysis
                        ? '/.netlify/functions/analyze?sync=true&force=true'
                        : '/.netlify/functions/analyze?sync=true',
                    window.location.origin
                ).toString();

                const workerPromise = new Promise<Response>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        worker.terminate();
                        reject(new Error('Worker timed out after 60 seconds'));
                    }, 60000);

                    worker.onmessage = (msg) => {
                        clearTimeout(timeout);
                        const data = msg.data || {};
                        if (data.error) {
                            worker.terminate();
                            reject(new Error(data.error));
                            return;
                        }

                        // Build a fake Response-like object
                        const fakeResp = {
                            ok: !!data.ok,
                            status: data.status || 200,
                            json: async () => data.json,
                        } as unknown as Response;

                        worker.terminate();
                        resolve(fakeResp);
                    };

                    worker.onerror = (e) => {
                        clearTimeout(timeout);
                        worker.terminate();
                        reject(new Error(e?.message || 'Worker error'));
                    };

                    // Post the file, endpoint, and metadata
                    try {
                        worker.postMessage({ 
                            file, 
                            endpoint,
                            fileName: file.name,
                            mimeType: file.type
                        });
                    } catch (postErr) {
                        clearTimeout(timeout);
                        worker.terminate();
                        reject(postErr);
                    }
                });

                const response = await workerPromise;
                const result: { analysis: AnalysisData } = await response.json();
                if (!result || !result.analysis) {
                    log('error', 'API response was successful but missing analysis data (worker).', result);
                    throw new Error('API response was successful but missing analysis data.');
                }
                log('info', 'Synchronous analysis successful (worker).', { fileName: file.name });
                return result.analysis;
            } catch (workerErr) {
                log('warn', 'Worker analysis failed; falling back to direct fetch.', { error: workerErr instanceof Error ? workerErr.message : String(workerErr) });
                // Fall through to direct fetch
            }
        }

        const imagePayload = await fileWithMetadataToBase64(file);

        const controller = new AbortController();
        // Give it a 60-second timeout.
        const timeoutId = setTimeout(() => {
            log('warn', 'Synchronous analysis request timed out on client after 60 seconds.');
            controller.abort();
        }, 60000);

        const dataToSend = {
            image: imagePayload,
            // We pass sync=true to tell the backend to process immediately
        };

        const endpoint = forceReanalysis
            ? '/.netlify/functions/analyze?sync=true&force=true'
            : '/.netlify/functions/analyze?sync=true';

        log('info', `Submitting analysis request to ${endpoint}`, analysisContext);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        log('info', 'Analyze API response received.', { status: response.status });
        if (!response.ok) {
            let errorBody;
            // ***FIX: Declare errorText here to make it available in the outer scope.***
            let errorText = 'Failed to read error response';
            try {
                // Read as text first, then try to parse as JSON
                errorText = await response.text();
                try {
                    errorBody = JSON.parse(errorText);
                } catch {
                    errorBody = errorText;
                }
            } catch (e) {
                // If response.text() fails, errorText will retain its default value
                errorBody = errorText;
                log('warn', 'Failed to read response body during error handling.', { e: e instanceof Error ? e.message : 'Unknown error' });
            }
            // ***FIX: errorText is now correctly scoped and will be included in the message.***
            const errorMessage = (typeof errorBody === 'object' && errorBody?.error) ? errorBody.error : `Server responded with status ${response.status}: ${errorText}`;
            throw new Error(errorMessage);
        }

        // In sync mode, the server returns the full AnalysisRecord directly.
        // We extract the 'analysis' part and also check for isDuplicate flag
        const result: { analysis: AnalysisData; isDuplicate?: boolean; recordId?: string; timestamp?: string } = await response.json();

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
        const isAbort = error instanceof Error && error.name === 'AbortError';
        const errorMessage = isAbort ? 'Request was aborted due to timeout.' : (error instanceof Error ? error.message : 'An unknown client-side error occurred.');
        log('error', 'Synchronous analysis failed.', { ...analysisContext, error: errorMessage, isTimeout: isAbort });
        throw new Error(errorMessage);
    }
};

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
        const readStartTime = Date.now();
        const imagePayload = await fileWithMetadataToBase64(file);
        const readDurationMs = Date.now() - readStartTime;
        
        log('debug', 'DUPLICATE_CHECK: File read complete', {
            fileName: file.name,
            readDurationMs,
            imageSize: imagePayload.image?.length || 0,
            event: 'FILE_READ_COMPLETE'
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            log('warn', 'DUPLICATE_CHECK: Request timed out after 20 seconds', { 
                fileName: file.name,
                event: 'TIMEOUT'
            });
            controller.abort();
        }, 20000); // 20-second timeout for duplicate check (increased from 10s to handle batch checks better)

        const dataToSend = {
            image: imagePayload
        };

        const fetchStartTime = Date.now();
        log('debug', 'DUPLICATE_CHECK: Calling backend API', {
            fileName: file.name,
            endpoint: '/.netlify/functions/analyze?sync=true&check=true',
            event: 'API_CALL_START'
        });
        
        const response = await fetch('/.netlify/functions/analyze?sync=true&check=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        
        const fetchDurationMs = Date.now() - fetchStartTime;
        const totalDurationMs = Date.now() - startTime;

        if (!response.ok) {
            // Differentiate between expected and unexpected failures
            if (response.status === 404 || response.status === 501) {
                // Endpoint not implemented - expected, fall back gracefully
                log('info', 'DUPLICATE_CHECK: Endpoint not available, treating as new file', { 
                    status: response.status,
                    fileName: file.name,
                    event: 'ENDPOINT_NOT_AVAILABLE'
                });
            } else {
                // Unexpected error - log as warning
                log('warn', 'DUPLICATE_CHECK: API error, treating as new file', { 
                    status: response.status,
                    fileName: file.name,
                    totalDurationMs,
                    event: 'API_ERROR'
                });
            }
            return { isDuplicate: false, needsUpgrade: false };
        }

        const result: { 
            isDuplicate?: boolean; 
            needsUpgrade?: boolean;
            recordId?: string; 
            timestamp?: string;
            analysisData?: any;
        } = await response.json();
        
        // Enhanced logging with full result details
        log('info', 'DUPLICATE_CHECK: Backend response received', { 
            fileName: file.name, 
            isDuplicate: !!result.isDuplicate,
            needsUpgrade: !!result.needsUpgrade,
            hasRecordId: !!result.recordId,
            hasTimestamp: !!result.timestamp,
            hasAnalysisData: !!result.analysisData,
            readDurationMs,      // Time to read file and convert to base64
            fetchDurationMs,     // Time for HTTP request to backend (includes network latency)
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
