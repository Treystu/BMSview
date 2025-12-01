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
        // Offload file read + network call to a worker using a blob fallback so it works
        // regardless of bundler. If worker fails or times out, fall back to direct fetch.
        if (typeof Worker !== 'undefined') {
            try {
                const workerScript = `
                                self.onmessage = async function(e) {
                                    const { endpoint, fileName, mimeType } = e.data || {};
                                    const file = e.data.file;
                                    try {
                                        // Read file as data URL
                                        const reader = new FileReader();
                                        reader.onload = async function() {
                                            try {
                                                const dataUrl = reader.result;
                                                const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : null;
                                                if (!base64) throw new Error('Failed to read file in worker');
                                                const payload = { 
                                                    image: {
                                                        image: base64,
                                                        mimeType,
                                                        fileName
                                                    }
                                                };
                                                const resp = await fetch(endpoint, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(payload)
                                                });
                                                const json = await resp.json().catch(() => null);
                                                self.postMessage({ ok: resp.ok, status: resp.status, json });
                                            } catch (err) {
                                                self.postMessage({ error: err.message || String(err) });
                                            }
                                        };
                                        reader.onerror = function(err) {
                                            self.postMessage({ error: err?.message || 'File read error in worker' });
                                        };
                                        reader.readAsDataURL(file);
                                    } catch (err) {
                                        self.postMessage({ error: err?.message || String(err) });
                                    }
                                };
                                `;

                const blob = new Blob([workerScript], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                const worker = new Worker(blobUrl);

                const workerPromise = new Promise<Response>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        worker.terminate();
                        URL.revokeObjectURL(blobUrl);
                        reject(new Error('Worker timed out after 60 seconds'));
                    }, 60000);

                    worker.onmessage = (msg) => {
                        clearTimeout(timeout);
                        const data = msg.data || {};
                        if (data.error) {
                            worker.terminate();
                            URL.revokeObjectURL(blobUrl);
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
                        URL.revokeObjectURL(blobUrl);
                        resolve(fakeResp);
                    };

                    worker.onerror = (e) => {
                        clearTimeout(timeout);
                        worker.terminate();
                        URL.revokeObjectURL(blobUrl);
                        reject(new Error(e?.message || 'Worker error'));
                    };

                    // Post the file, endpoint, and metadata (file is transferable in browsers)
                    try {
                        worker.postMessage({ 
                            file, 
                            endpoint: '/.netlify/functions/analyze?sync=true',
                            fileName: file.name,
                            mimeType: file.type
                        });
                    } catch (postErr) {
                        clearTimeout(timeout);
                        worker.terminate();
                        URL.revokeObjectURL(blobUrl);
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
 * @returns Promise with isDuplicate flag and optional recordId/timestamp of existing record
 */
export const checkFileDuplicate = async (file: File): Promise<{ isDuplicate: boolean; recordId?: string; timestamp?: string }> => {
    const checkContext = { fileName: file.name, fileSize: file.size };
    log('info', 'Checking file for duplicates.', checkContext);

    try {
        const imagePayload = await fileWithMetadataToBase64(file);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            log('warn', 'Duplicate check timed out after 10 seconds.');
            controller.abort();
        }, 10000); // Shorter timeout for duplicate check

        const dataToSend = {
            image: imagePayload,
            checkOnly: true // Signal to backend to only check for duplicates
        };

        const response = await fetch('/.netlify/functions/analyze?sync=true&check=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            // If the check endpoint isn't available, fall back to assuming not duplicate
            log('warn', 'Duplicate check endpoint returned error, assuming not duplicate.', { status: response.status });
            return { isDuplicate: false };
        }

        const result: { isDuplicate?: boolean; recordId?: string; timestamp?: string } = await response.json();
        
        log('info', 'Duplicate check complete.', { fileName: file.name, isDuplicate: !!result.isDuplicate });
        
        return {
            isDuplicate: result.isDuplicate || false,
            recordId: result.recordId,
            timestamp: result.timestamp
        };

    } catch (error) {
        // If duplicate check fails, assume not duplicate and let full analysis handle it
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log('warn', 'Duplicate check failed, assuming not duplicate.', { ...checkContext, error: errorMessage });
        return { isDuplicate: false };
    }
};
