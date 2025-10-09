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
        
        if (!response.ok) {
            let errorMsg = `Server responded with status ${response.status}`;
            try {
                // Try to parse error response as JSON, but handle failures gracefully.
                const result = await response.json();
                errorMsg = result.error || errorMsg;
            } catch (e) {
                // If the response is not JSON, use the raw text, but avoid showing HTML.
                const text = await response.text();
                if (text && !text.trim().startsWith('<')) {
                    errorMsg = text;
                }
            }
            log('error', 'Analysis job submission failed.', { status: response.status, error: errorMsg });
            return files.map(file => ({
                fileName: file.name,
                jobId: '',
                status: 'failed',
                error: errorMsg,
            }));
        }
        
        const result = await response.json();
        
        log('info', 'Analysis job submission successful.', { jobsCreated: result.length });
        return result;

    } catch (error) {
        log('error', 'Error in analyzeBmsScreenshots.', { error: error instanceof Error ? error.message : 'An unknown client-side error occurred.' });
        const errorMsg = error instanceof Error ? error.message : 'An unknown client-side error occurred.';
        return files.map(file => ({
            fileName: file.name,
            jobId: '',
            status: 'failed',
            error: errorMsg,
        }));
    }
};