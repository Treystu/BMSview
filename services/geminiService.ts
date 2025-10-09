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
        log('info', 'Submitting analysis job request.', { fileCount: imagePayloads.length });

        const response = await fetch('/.netlify/functions/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                images: imagePayloads,
                systems: registeredSystems,
            }),
        });
        
        log('info', 'Analyze API response', { status: response.status });
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
        
        log('info', 'Analysis job submission successful.', { jobsCreated: result.length });
        return result;

    } catch (error) {
        log('error', 'Error in analyzeBmsScreenshots.', { error: error instanceof Error ? error.message : 'An unknown client-side error occurred.' });
        throw error; // Re-throw the caught error
    }
};