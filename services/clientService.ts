import type { BmsSystem, AnalysisData, AnalysisRecord, WeatherData } from '../types';

// This key generation logic is now only used on the client-side for finding duplicates
// among already-fetched data.
const generateAnalysisKey = (data: AnalysisData): string => {
    if (!data) return Math.random().toString();
    const voltage = data.overallVoltage ? (Math.round(data.overallVoltage * 10) / 10).toFixed(1) : 'N/A';
    const current = data.current ? (Math.round(data.current * 10) / 10).toFixed(1) : 'N/A';
    const soc = data.stateOfCharge ? Math.round(data.stateOfCharge) : 'N/A';
    const cellVoltagesKey = data.cellVoltages && data.cellVoltages.length > 0 ? data.cellVoltages.map(v => (Math.round(v * 1000) / 1000).toFixed(3)).join(',') : 'nocells';
    return `${data.dlNumber || 'none'}|${voltage}|${current}|${soc}|${cellVoltagesKey}`;
};

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        service: 'clientService',
        message,
        context
    }));
};


// Generic fetch helper, exported for use in any client-side component.
export const apiFetch = async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    const logContext = { endpoint, method: options.method || 'GET' };
    log('info', 'API fetch started.', logContext);
    
    try {
        const response = await fetch(`/.netlify/functions/${endpoint}`, {
            ...options,
            // Add cache control for GET requests to prevent stale data.
            cache: isGet ? 'no-store' : undefined,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'An unexpected error occurred.' }));
            const error = errorData.error || `Server responded with status: ${response.status}`;
            log('error', 'API fetch failed.', { ...logContext, status: response.status, error });
            throw new Error(error);
        }

        // For 204 No Content or other methods that might not return a body
        if (response.status === 204 || response.headers.get('content-length') === '0') {
            log('info', 'API fetch successful with no content.', { ...logContext, status: response.status });
            return null as T;
        }

        const data = await response.json();
        log('info', 'API fetch successful.', { ...logContext, status: response.status });
        return data;

    } catch (error) {
        // This will catch network errors or errors from the !response.ok block
        if (!(error instanceof Error && error.message.includes('Server responded with status'))) {
           log('error', 'API fetch encountered a network or parsing error.', { ...logContext, error: error instanceof Error ? error.message : String(error) });
        }
        throw error;
    }
};


export const registerBmsSystem = async (
  systemData: Omit<BmsSystem, 'id' | 'associatedDLs'>
): Promise<BmsSystem> => {
    return apiFetch<BmsSystem>('systems', {
        method: 'POST',
        body: JSON.stringify(systemData),
    });
};

export const getRegisteredSystems = async (): Promise<BmsSystem[]> => {
    return apiFetch<BmsSystem[]>(`systems`);
};

export const getSystemById = async (systemId: string): Promise<BmsSystem> => {
    return apiFetch<BmsSystem>(`systems?systemId=${systemId}`);
};

export const associateDlToSystem = async (dlNumber: string, systemId: string): Promise<void> => {
    const systemToUpdate = await getSystemById(systemId);

    if (!systemToUpdate) {
        throw new Error("System to associate not found.");
    }
    
    if (!systemToUpdate.associatedDLs) {
        systemToUpdate.associatedDLs = [];
    }

    if (!systemToUpdate.associatedDLs.includes(dlNumber)) {
        systemToUpdate.associatedDLs.push(dlNumber);
        const { id, ...dataToUpdate } = systemToUpdate;
        await updateBmsSystem(id, dataToUpdate);
    }
};

export const updateBmsSystem = async (
  systemId: string,
  updatedData: Omit<BmsSystem, 'id'>
): Promise<BmsSystem> => {
    return apiFetch<BmsSystem>(`systems?systemId=${systemId}`, {
        method: 'PUT',
        body: JSON.stringify(updatedData),
    });
};

export const saveAnalysisResult = async (
  analysisData: AnalysisData,
  fileName: string,
  systemId?: string,
  weatherData?: WeatherData
): Promise<AnalysisRecord> => {
    // The logic to find systemName and generate the final timestamp is now handled efficiently on the backend.
    
    const recordToSave = {
      // The `timestamp` field is now omitted. The backend will generate it based on
      // the `timestampFromImage` and the upload time.
      systemId,
      analysis: analysisData,
      weather: weatherData,
      dlNumber: analysisData.dlNumber,
      fileName: fileName,
    };
    
    return apiFetch<AnalysisRecord>('history', {
        method: 'POST',
        body: JSON.stringify(recordToSave),
    });
};

export const getAnalysisHistory = async (): Promise<AnalysisRecord[]> => {
    return apiFetch<AnalysisRecord[]>(`history`);
};

export const getAnalysisRecordById = async (recordId: string): Promise<AnalysisRecord> => {
    return apiFetch<AnalysisRecord>(`history?id=${recordId}`);
};

export const mergeBmsSystems = async (primarySystemId: string, idsToMerge: string[]): Promise<void> => {
    await apiFetch('systems', {
        method: 'POST',
        body: JSON.stringify({
            action: 'merge',
            primarySystemId,
            idsToMerge,
        }),
    });
};

export const findDuplicateAnalysisSets = async (): Promise<AnalysisRecord[][]> => {
    const allHistory = await apiFetch<AnalysisRecord[]>('history?all=true');
    const recordsByKey = new Map<string, AnalysisRecord[]>();

    for (const record of allHistory) {
        // Ensure record has analysis data before processing
        if (!record.analysis) continue;
        const key = generateAnalysisKey(record.analysis);
        if (!recordsByKey.has(key)) {
            recordsByKey.set(key, []);
        }
        recordsByKey.get(key)!.push(record);
    }

    const finalSets: AnalysisRecord[][] = [];
    // Set a 5-minute window. Records with identical metrics within this window are duplicates.
    const TIME_WINDOW_MS = 5 * 60 * 1000; 

    for (const group of recordsByKey.values()) {
        if (group.length < 2) continue;

        // Sort records by timestamp to cluster them chronologically
        const sortedGroup = group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        let i = 0;
        while (i < sortedGroup.length) {
            const currentSet = [sortedGroup[i]];
            const startTime = new Date(sortedGroup[i].timestamp).getTime();
            let j = i + 1;
            
            // Expand the cluster as long as subsequent records are within the time window
            while (j < sortedGroup.length && (new Date(sortedGroup[j].timestamp).getTime() - startTime <= TIME_WINDOW_MS)) {
                currentSet.push(sortedGroup[j]);
                j++;
            }

            // If the cluster has more than one record, it's a duplicate set
            if (currentSet.length > 1) {
                finalSets.push(currentSet);
            }
            
            // Move to the next record outside the processed cluster
            i = j;
        }
    }
    
    return finalSets;
};

export const deleteAnalysisRecords = async (recordIds: string[]): Promise<void> => {
    if (recordIds.length === 0) return;
    await apiFetch('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'deleteBatch',
            recordIds,
        }),
    });
};

export const deleteUnlinkedAnalysisHistory = async (): Promise<void> => {
    await apiFetch('history?unlinked=true', {
        method: 'DELETE',
    });
};

export const deleteAnalysisRecord = async (recordId: string): Promise<void> => {
    await apiFetch(`history?id=${recordId}`, {
        method: 'DELETE',
    });
};

export const linkAnalysisToSystem = async (recordId: string, systemId: string, dlNumber?: string | null): Promise<void> => {
    await apiFetch('history', {
        method: 'PUT',
        body: JSON.stringify({ recordId, systemId, dlNumber }),
    });
};

export const clearAllData = async (): Promise<void> => {
    await apiFetch<void>('data', {
        method: 'DELETE',
    });
};

export const clearHistoryStore = async (): Promise<{ message: string; details: any }> => {
    return apiFetch<{ message: string; details: any }>('data?store=bms-history', {
        method: 'DELETE',
    });
};

export const backfillWeatherData = async (): Promise<{ success: boolean; updatedCount: number }> => {
    return apiFetch<{ success: boolean; updatedCount: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'backfill-weather',
        }),
    });
};

export const cleanupLinks = async (): Promise<{ success: boolean; updatedCount: number }> => {
    return apiFetch<{ success: boolean; updatedCount: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'cleanup-links',
        }),
    });
};

export const autoAssociateRecords = async (): Promise<{ associatedCount: number }> => {
    return apiFetch<{ associatedCount: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'auto-associate',
        }),
    });
};

export const cleanupCompletedJobs = async (cursor?: string): Promise<{ success: boolean; cleanedCount: number, nextCursor: string | null }> => {
    return apiFetch<{ success: boolean; cleanedCount: number, nextCursor: string | null }>('jobs-cleanup', {
        method: 'POST',
        body: JSON.stringify({ cursor }),
    });
};

export const getJobStatuses = async (jobIds: string[]): Promise<any[]> => {
    if (jobIds.length === 0) return [];
    return apiFetch<any[]>(`get-job-status?ids=${jobIds.join(',')}`);
};

// --- IP Management ---
interface TrackedIp {
    ip: string;
    key: string;
    count: number;
    lastSeen: string;
    isVerified: boolean;
    isBlocked: boolean;
}

interface IpData {
    trackedIps: TrackedIp[];
    verifiedRanges: string[];
    blockedRanges: string[];
}

export const getCurrentIp = async (): Promise<{ ip: string }> => {
    return apiFetch<{ ip: string }>('get-ip');
};

export const getIpData = async (): Promise<IpData> => {
    return apiFetch<IpData>('ip-admin');
};

export const addVerifiedRange = async (range: string): Promise<{ verifiedRanges: string[] }> => {
    return apiFetch<{ verifiedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'add', range }),
    });
};

export const removeVerifiedRange = async (range: string): Promise<{ verifiedRanges: string[] }> => {
    return apiFetch<{ verifiedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'remove', range }),
    });
};

export const addBlockedRange = async (range: string): Promise<{ blockedRanges: string[] }> => {
    return apiFetch<{ blockedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'block', range }),
    });
};

export const removeBlockedRange = async (range: string): Promise<{ blockedRanges: string[] }> => {
    return apiFetch<{ blockedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'unblock', range }),
    });
};


export const deleteIpRecord = async (key: string): Promise<void> => {
    await apiFetch<void>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete-ip', key }),
    });
};
