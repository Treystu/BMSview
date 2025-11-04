import type { BmsSystem, AnalysisData, AnalysisRecord, WeatherData } from '../types';

interface PaginatedResponse<T> {
    items: T[];
    totalItems: number;
}

// In-memory short-lived cache and in-flight dedupe map
const _cache = new Map<string, { data: any; expires: number }>();
const _inFlight = new Map<string, Promise<any>>();

async function fetchWithCache<T>(endpoint: string, ttl = 5000): Promise<T> {
    const key = endpoint;
    const now = Date.now();

    const cached = _cache.get(key);
    if (cached && cached.expires > now) {
        return cached.data as T;
    }

    if (_inFlight.has(key)) {
        return _inFlight.get(key)! as Promise<T>;
    }

    const p = (async () => {
        const data = await apiFetch<any>(endpoint);
        // Pass through raw data - let caller handle normalization
        _cache.set(key, { data, expires: Date.now() + ttl });
        return data as T;
    })().finally(() => _inFlight.delete(key));

    _inFlight.set(key, p as Promise<any>);
    return p as Promise<T>;
}

// Export internals for testing/diagnostics (non-production API)
export const __internals = {
    fetchWithCache,
    clearCache: () => {
        _cache.clear();
        _inFlight.clear();
    }
};
 
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
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };

        // Add Netlify Identity token if available
        if (window.netlifyIdentity?.currentUser) {
            const token = await window.netlifyIdentity.currentUser()?.jwt();
            if (token) {
                Object.assign(headers, { 'Authorization': `Bearer ${token}` });
            }
        }

        const response = await fetch(`/.netlify/functions/${endpoint}`, {
            ...options,
            // Add cache control for GET requests to prevent stale data.
            cache: isGet ? 'no-store' : undefined,
            headers,
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

export const getRegisteredSystems = async (page = 1, limit = 25): Promise<PaginatedResponse<BmsSystem>> => {
    log('info', 'Fetching paginated registered BMS systems.', { page, limit });
    const response = await fetchWithCache<any>(`systems?page=${page}&limit=${limit}`, 10_000);
    
    // Case 1: Array response (including empty arrays)
    if (Array.isArray(response)) {
        return {
            items: [...response], // Create a new array to ensure immutability
            totalItems: response.length // For array responses, always use array length
        };
    }
    
    // Case 2: Object response
    if (response && typeof response === 'object') {
        // Get total items from any source that might provide it
        const totalItems = typeof response.total === 'number' ? response.total :
                        typeof response.totalItems === 'number' ? response.totalItems :
                        undefined;
        
        // Case 2a: Has an items array
        if (Array.isArray(response.items)) {
            return {
                items: response.items,
                totalItems: totalItems ?? response.items.length
            };
        }
        
        // Case 2b: Has a total field but no items array
        if (totalItems !== undefined) {
            return {
                items: Array.isArray(response.items) ? response.items : [],
                totalItems
            };
        }
        
        // Case 2c: Treat it as a single item if it's an object with content
        if (Object.keys(response).length > 0) {
            return {
                items: [response],
                totalItems: 1
            };
        }
    }
    
    // Case 3: Empty/invalid response
    return {
        items: [],
        totalItems: 0
    };
};

export const getAnalysisHistory = async (page = 1, limit = 25): Promise<PaginatedResponse<AnalysisRecord>> => {
    log('info', 'Fetching paginated analysis history.', { page, limit });
    const resp = await fetchWithCache<{ items: AnalysisRecord[]; total: number }>(`history?page=${page}&limit=${limit}`, 5_000);
    return { items: resp.items, totalItems: resp.total };
};

export const streamAllHistory = async (onData: (records: AnalysisRecord[]) => void, onComplete: () => void): Promise<void> => {
    log('info', 'Starting to stream all history records.');
    const limit = 200; // Fetch in chunks of 200
    let page = 1;
    let hasMore = true;

    while(hasMore) {
        try {
            log('info', 'Fetching history page for streaming.', { page, limit });
            const response = await getAnalysisHistory(page, limit);
            if (response.items.length > 0) {
                onData(response.items);
            }
            if (page * limit >= response.totalItems) {
                hasMore = false;
            } else {
                page++;
            }
        } catch (error) {
            log('error', 'Error while streaming history data. Stopping stream.', { error: error instanceof Error ? error.message : String(error) });
            hasMore = false; // Stop on error
        }
    }
    log('info', 'Finished streaming all history records.');
    onComplete();
};

export const streamInsights = async (
  payload: {
    analysisData: AnalysisData;
    systemId?: string;
    customPrompt?: string;
  },
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) => {
    log('info', 'Streaming insights from server.', { systemId: payload.systemId, hasCustomPrompt: !!payload.customPrompt });
    try {
        const response = await fetch('/.netlify/functions/generate-insights', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `Server responded with status: ${response.status}` }));
            throw new Error(errorData.error || 'An unexpected error occurred.');
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Could not get readable stream from response.');
        }

        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                log('info', 'Insight stream completed.');
                onComplete();
                break;
            }
            onChunk(decoder.decode(value));
        }
    } catch (err) {
        const error = err instanceof Error ? err : new Error('An unknown error occurred during streaming.');
        log('error', 'Error streaming insights.', { error: error.message });
        onError(error);
    }
};


export const registerBmsSystem = async (
  systemData: Omit<BmsSystem, 'id' | 'associatedDLs'>
): Promise<BmsSystem> => {
    log('info', 'Registering new BMS system.', { name: systemData.name });
    return apiFetch<BmsSystem>('systems', {
        method: 'POST',
        body: JSON.stringify(systemData),
    });
};

export const getSystemById = async (systemId: string): Promise<BmsSystem> => {
    log('info', 'Fetching system by ID.', { systemId });
    return apiFetch<BmsSystem>(`systems?systemId=${systemId}`);
};

export const associateDlToSystem = async (dlNumber: string, systemId: string): Promise<void> => {
    log('info', 'Associating DL number to system.', { dlNumber, systemId });
    const systemToUpdate = await getSystemById(systemId);

    if (!systemToUpdate) {
        throw new Error("System to associate not found.");
    }
    
    if (!systemToUpdate.associatedDLs) {
        systemToUpdate.associatedDLs = [];
    }

    if (!systemToUpdate.associatedDLs.includes(dlNumber)) {
        log('info', 'DL number not found in system, adding it.', { dlNumber, systemId });
        systemToUpdate.associatedDLs.push(dlNumber);
        const { id, ...dataToUpdate } = systemToUpdate;
        await updateBmsSystem(id, dataToUpdate);
    } else {
        log('info', 'DL number already associated with system, no update needed.', { dlNumber, systemId });
    }
};

export const updateBmsSystem = async (
  systemId: string,
  updatedData: Omit<BmsSystem, 'id'>
): Promise<BmsSystem> => {
    log('info', 'Updating BMS system.', { systemId, systemName: updatedData.name });
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
    log('info', 'Saving analysis result to history.', { fileName, systemId, dlNumber: analysisData.dlNumber });
    const recordToSave = {
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

export const getAnalysisRecordById = async (recordId: string): Promise<AnalysisRecord> => {
    log('info', 'Fetching single analysis record by ID.', { recordId });
    return apiFetch<AnalysisRecord>(`history?id=${recordId}`);
};

// --- New Analytics Service ---
interface UnidirectionalMetric {
    avg: number;
    points: number;
}
interface BidirectionalMetric {
    avgCharge: number;
    avgDischarge: number;
    chargePoints: number;
    dischargePoints: number;
}

export interface HourlyAverages {
    hour: number;
    metrics: {
        current?: BidirectionalMetric;
        power?: BidirectionalMetric;
        stateOfCharge?: UnidirectionalMetric;
        temperature?: UnidirectionalMetric;
        mosTemperature?: UnidirectionalMetric;
        cellVoltageDifference?: UnidirectionalMetric;
        overallVoltage?: UnidirectionalMetric;
    };
}

export interface PerformanceBaseline {
    sunnyDayChargingAmpsByHour: {
        hour: number;
        avgCurrent: number;
        dataPoints: number;
    }[];
}

export interface AlertCount {
    alert: string;
    count: number;
}

export interface AlertAnalysis {
    alertCounts: AlertCount[];
    totalAlerts: number;
}

export interface SystemAnalytics {
    hourlyAverages: HourlyAverages[];
    performanceBaseline: PerformanceBaseline;
    alertAnalysis: AlertAnalysis;
}

export const getSystemAnalytics = async (systemId: string): Promise<SystemAnalytics> => {
    if (!systemId) {
        throw new Error("A system ID must be provided to fetch analytics.");
    }
    log('info', 'Fetching system analytics.', { systemId });
    return apiFetch<SystemAnalytics>(`system-analytics?systemId=${systemId}`);
};


export const mergeBmsSystems = async (primarySystemId: string, idsToMerge: string[]): Promise<void> => {
    log('info', 'Merging BMS systems.', { primarySystemId, idsToMerge });
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
    log('info', 'Finding duplicate analysis sets.');
    const allHistory = await apiFetch<AnalysisRecord[]>('history?all=true');
    const recordsByKey = new Map<string, AnalysisRecord[]>();

    for (const record of allHistory) {
        if (!record.analysis) continue;
        const key = generateAnalysisKey(record.analysis);
        if (!recordsByKey.has(key)) {
            recordsByKey.set(key, []);
        }
        recordsByKey.get(key)!.push(record);
    }

    const finalSets: AnalysisRecord[][] = [];
    const TIME_WINDOW_MS = 5 * 60 * 1000; 

    for (const group of recordsByKey.values()) {
        if (group.length < 2) continue;

        const sortedGroup = group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        let i = 0;
        while (i < sortedGroup.length) {
            const currentSet = [sortedGroup[i]];
            const startTime = new Date(sortedGroup[i].timestamp).getTime();
            let j = i + 1;
            
            while (j < sortedGroup.length && (new Date(sortedGroup[j].timestamp).getTime() - startTime <= TIME_WINDOW_MS)) {
                currentSet.push(sortedGroup[j]);
                j++;
            }

            if (currentSet.length > 1) {
                finalSets.push(currentSet);
            }
            
            i = j;
        }
    }
    log('info', 'Duplicate scan complete on client.', { foundSets: finalSets.length });
    return finalSets;
};

export const deleteAnalysisRecords = async (recordIds: string[]): Promise<void> => {
    if (recordIds.length === 0) return;
    log('info', 'Deleting batch of analysis records.', { count: recordIds.length });
    await apiFetch('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'deleteBatch',
            recordIds,
        }),
    });
};

export const deleteUnlinkedAnalysisHistory = async (): Promise<void> => {
    log('info', 'Deleting all unlinked analysis history.');
    await apiFetch('history?unlinked=true', {
        method: 'DELETE',
    });
};

export const deleteAnalysisRecord = async (recordId: string): Promise<void> => {
    log('info', 'Deleting single analysis record.', { recordId });
    await apiFetch(`history?id=${recordId}`, {
        method: 'DELETE',
    });
};

export const linkAnalysisToSystem = async (recordId: string, systemId: string, dlNumber?: string | null): Promise<void> => {
    log('info', 'Linking analysis record to system.', { recordId, systemId, dlNumber });
    await apiFetch('history', {
        method: 'PUT',
        body: JSON.stringify({ recordId, systemId, dlNumber }),
    });
};

export const clearAllData = async (): Promise<void> => {
    log('warn', 'Sending request to clear ALL application data.');
    await apiFetch<void>('data', {
        method: 'DELETE',
    });
};

export const clearHistoryStore = async (): Promise<{ message: string; details: any }> => {
    log('warn', 'Sending request to clear ONLY the history store.');
    return apiFetch<{ message: string; details: any }>('data?store=bms-history', {
        method: 'DELETE',
    });
};

export const backfillWeatherData = async (): Promise<{ success: boolean; updatedCount: number }> => {
    log('info', 'Sending request to backfill weather data.');
    return apiFetch<{ success: boolean; updatedCount: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'backfill-weather',
        }),
    });
};

export const countRecordsNeedingWeather = async (): Promise<{ count: number }> => {
    log('info', 'Sending request to count records needing weather backfill.');
    return apiFetch<{ count: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'count-records-needing-weather',
        }),
    });
};

export const cleanupLinks = async (): Promise<{ success: boolean; updatedCount: number }> => {
    log('info', 'Sending request to clean up system links.');
    return apiFetch<{ success: boolean; updatedCount: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'cleanup-links',
        }),
    });
};

export const autoAssociateRecords = async (): Promise<{ associatedCount: number }> => {
    log('info', 'Sending request to auto-associate unlinked records.');
    return apiFetch<{ associatedCount: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'auto-associate',
        }),
    });
};

export const fixPowerSigns = async (): Promise<{ success: boolean; updatedCount: number }> => {
    log('info', 'Sending request to fix power signs.');
    return apiFetch<{ success: boolean; updatedCount: number }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'fix-power-signs',
        }),
    });
};



export const getJobStatuses = async (jobIds: string[]): Promise<any[]> => {
    if (jobIds.length === 0) return [];
    log('info', 'Fetching job statuses.', { count: jobIds.length });
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
    log('info', 'Fetching current user IP.');
    return apiFetch<{ ip: string }>('get-ip');
};

export const getIpData = async (): Promise<IpData> => {
    log('info', 'Fetching IP management data.');
    return apiFetch<IpData>('ip-admin');
};

export const addVerifiedRange = async (range: string): Promise<{ verifiedRanges: string[] }> => {
    log('info', 'Adding verified IP range.', { range });
    return apiFetch<{ verifiedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'add', range }),
    });
};

export const removeVerifiedRange = async (range: string): Promise<{ verifiedRanges: string[] }> => {
    log('info', 'Removing verified IP range.', { range });
    return apiFetch<{ verifiedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'remove', range }),
    });
};

export const addBlockedRange = async (range: string): Promise<{ blockedRanges: string[] }> => {
    log('warn', 'Adding BLOCKED IP range.', { range });
    return apiFetch<{ blockedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'block', range }),
    });
};

export const removeBlockedRange = async (range: string): Promise<{ blockedRanges: string[] }> => {
    log('info', 'Removing blocked IP range (unblocking).', { range });
    return apiFetch<{ blockedRanges: string[] }>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'unblock', range }),
    });
};


export const deleteIpRecord = async (key: string): Promise<void> => {
    log('info', 'Deleting IP activity record.', { key });
    await apiFetch<void>('ip-admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete-ip', key }),
    });
};

export const getHourlyWeather = async (lat: number, lon: number, date: string): Promise<any[]> => {
    log('info', 'Fetching hourly weather data.', { lat, lon, date });
    return apiFetch<any[]>('weather', {
        method: 'POST',
        body: JSON.stringify({ lat, lon, timestamp: date, type: 'hourly' }),
    });
};

export const runDiagnostics = async (): Promise<Record<string, { status: string; message: string }>> => {
    log('info', 'Running system diagnostics.');
    return apiFetch<Record<string, { status: string; message: string }>>('admin-diagnostics');
};

