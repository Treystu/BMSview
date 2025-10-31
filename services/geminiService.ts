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
 */
export const analyzeBmsScreenshot = async (file: File): Promise<AnalysisData> => {
    const analysisContext = { fileName: file.name, fileSize: file.size };
    log('info', 'Starting synchronous analysis.', analysisContext);
    
    try {
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
        
        log('info', 'Submitting analysis request to /.netlify/functions/analyze?sync=true', analysisContext);

        const response = await fetch('/.netlify/functions/analyze?sync=true', {
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
        // We just want the 'analysis' part.
        const result: { analysis: AnalysisData } = await response.json();
        
        if (!result.analysis) {
            log('error', 'API response was successful but missing analysis data.', result);
            throw new Error('API response was successful but missing analysis data.');
        }

        log('info', 'Synchronous analysis successful.', { fileName: file.name });
        return result.analysis;

    } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        const errorMessage = isAbort ? 'Request was aborted due to timeout.' : (error instanceof Error ? error.message : 'An unknown client-side error occurred.');
        log('error', 'Synchronous analysis failed.', { ...analysisContext, error: errorMessage, isTimeout: isAbort });
        throw new Error(errorMessage);
    }
};
