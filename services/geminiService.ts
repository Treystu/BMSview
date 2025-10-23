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

export const analyzeBmsScreenshots = async (files: File[], registeredSystems?: BmsSystem[], forceReprocessFileNames: string[] = []): Promise<JobCreationResponse[]> => {
    const analysisContext = { fileCount: files.length, hasSystems: !!registeredSystems, forceCount: forceReprocessFileNames.length };
    log('info', 'Starting analysis job submission.', analysisContext);
    
    try {
        if (files.length === 0) return [];

        const imagePayloads = await Promise.all(files.map(file => 
            fileWithMetadataToBase64(file).then(payload => ({
                ...payload,
                force: forceReprocessFileNames.includes(payload.fileName),
            }))
        ));
        
        const controller = new AbortController();
        // FIX: Increased timeout from 30 seconds to 2 minutes (120,000 ms)
        // This gives large uploads more time to complete before the client aborts the request.
        const timeoutId = setTimeout(() => {
            log('warn', 'Analysis request timed out on client after 2 minutes.');
            controller.abort();
        }, 120000);

        const dataToSend = {
            images: imagePayloads,
            systems: registeredSystems,
        };
        
        const endpoint = files.length === 1 ? 'analyze?sync=true' : 'analyze';
        log('info', `Submitting analysis request to /.netlify/functions/${endpoint}.`, { ...analysisContext, payloadSize: JSON.stringify(dataToSend).length });

        const response = await fetch(`/.netlify/functions/${endpoint}`, {
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
                // Read as text first, then try to parse as JSON
                const errorText = await response.text();
                try {
                    errorBody = JSON.parse(errorText);
                } catch {
                    errorBody = errorText;
                }
            } catch {
                errorBody = 'Failed to read error response';
            }
            const errorMessage = (typeof errorBody === 'object' && errorBody?.error) ? errorBody.error : `Server responded with status ${response.status}: ${errorBody}`;
            throw new Error(errorMessage);
        }
        
        const result: JobCreationResponse[] = await response.json();
        
        const jobIds = result.map(j => j.jobId).filter(Boolean);
        const duplicateCount = result.filter(j => j.status?.includes('duplicate')).length;
        
        log('info', 'Analysis job submission successful.', { 
            resultsCount: result.length, 
            jobsCreated: jobIds.length, 
            duplicatesFound: duplicateCount, 
            jobIds 
        });
        
        return result;

    } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        const errorMessage = isAbort ? 'Request was aborted due to timeout.' : (error instanceof Error ? error.message : 'An unknown client-side error occurred.');
        log('error', 'Analysis job submission failed.', { ...analysisContext, error: errorMessage, isTimeout: isAbort });
        throw new Error(errorMessage);
    }
};
