import type { BmsSystem } from '../types';

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

type JobCreationResponse = {
    fileName: string;
    jobId: string;
    status: string;
    error?: string;
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

export const analyzeBmsScreenshots = async (files: File[], registeredSystems?: BmsSystem[]): Promise<JobCreationResponse[]> => {
    log('info', 'analyzeBmsScreenshots called.', { fileCount: files.length, hasSystems: !!registeredSystems });
    try {
        if (files.length === 0) return [];

        const imagePayloads = await Promise.all(files.map(fileWithMetadataToBase64));
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            log('warn', 'Analysis request timed out after 30 seconds.');
            controller.abort();
        }, 30000); // 30-second timeout

        log('info', 'Analyze call start: submitting analysis job request to backend.', { fileCount: imagePayloads.length });
        log('info', 'GeminiService analyze start', { fileCount: files.length, isAdminBulk: files.length > 1, timestamp: new Date().toISOString() });

        const dataToSend = {
            images: imagePayloads,
            systems: registeredSystems,
        };
        console.log('Sending to analyze:', JSON.stringify(dataToSend));

        const response = await fetch('/.netlify/functions/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        
        log('info', 'Analyze API response received.', { status: response.status });
        if (!response.ok) {
            let errorBody;
            try { 
                errorBody = await response.json(); 
            } catch { 
                errorBody = await response.text(); 
            }
            const errorMessage = (typeof errorBody === 'object' && errorBody?.error) ? errorBody.error : `Server responded with status ${response.status}: ${errorBody}`;
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        
        log('info', 'Analysis job submission successful.', { resultsCount: result.length, jobsCreated: result.length });
        log('info', 'GeminiService analyze success', { resultsLength: result.length, timestamp: new Date().toISOString() });
        return result;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown client-side error occurred.';
        if (error instanceof Error && error.name === 'AbortError') {
             log('error', 'Error in analyzeBmsScreenshots: request was aborted due to timeout.', { error: errorMessage });
        } else {
             log('error', 'Error in analyzeBmsScreenshots.', { error: errorMessage });
        }
        log('error', 'GeminiService final catch', { fullError: error.message, timestamp: new Date().toISOString() });
        throw error;
    }
};