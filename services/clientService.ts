import type { AdminStoriesResponse, AdminStory, AnalysisData, AnalysisRecord, AnalysisStory, BmsSystem, InsightMode, StoryPhoto, WeatherData } from '../types';
import { InsightMode as InsightModeEnum } from '../types';

interface PaginatedResponse<T> {
    items: T[];
    totalItems: number;
}

interface FetchListOptions {
    forceRefresh?: boolean;
    strategy?: FetchStrategy;
}

/**
 * FetchStrategy enum for controlling cache behavior
 * - CACHE_FIRST: Try cache first, fall back to network (default for reads)
 * - CACHE_AND_SYNC: Use cache immediately, sync in background
 * - FORCE_FRESH: Always fetch from server, skip cache
 */
export enum FetchStrategy {
    CACHE_FIRST = 'cache-first',
    CACHE_AND_SYNC = 'cache-and-sync',
    FORCE_FRESH = 'force-fresh'
}

type CacheMode = 'enabled' | 'disabled-via-override' | 'unavailable';

interface ClientServiceMetrics {
    cache: {
        mode: CacheMode;
        systemsHits: number;
        historyHits: number;
        disabledSkips: number;
        loadFailures: number;
    };
    memoryCache: {
        hits: number;
        misses: number;
    };
    network: {
        total: number;
        byEndpoint: Record<string, number>;
    };
}

const metrics: ClientServiceMetrics = {
    cache: {
        mode: 'unavailable',
        systemsHits: 0,
        historyHits: 0,
        disabledSkips: 0,
        loadFailures: 0
    },
    memoryCache: {
        hits: 0,
        misses: 0
    },
    network: {
        total: 0,
        byEndpoint: {}
    }
};

function detectCacheMode(): CacheMode {
    if (typeof indexedDB === 'undefined') {
        return 'unavailable';
    }

    const globalOverride = typeof globalThis !== 'undefined'
        ? (globalThis as any).__BMSVIEW_DISABLE_CACHE
        : undefined;

    if (globalOverride === true) {
        return 'disabled-via-override';
    }
    if (globalOverride === false) {
        return 'enabled';
    }

    if (typeof window !== 'undefined') {
        try {
            const override = window.localStorage?.getItem('bmsview:disableCache');
            if (override === 'true') {
                return 'disabled-via-override';
            }
            if (override === 'force') {
                return 'enabled';
            }
        } catch (_err) {
            // Ignore storage access errors (Safari private mode, etc.)
        }
    }

    return 'enabled';
}

metrics.cache.mode = detectCacheMode();

function isLocalCacheEnabled(): boolean {
    const mode = detectCacheMode();
    metrics.cache.mode = mode;
    return mode === 'enabled';
}

function recordCacheHit(target: 'systems' | 'history'): void {
    if (target === 'systems') {
        metrics.cache.systemsHits += 1;
    } else {
        metrics.cache.historyHits += 1;
    }
}

function recordCacheDisabledSkip(): void {
    metrics.cache.disabledSkips += 1;
}

function recordCacheFailure(): void {
    metrics.cache.loadFailures += 1;
}

function recordMemoryCacheHit(): void {
    metrics.memoryCache.hits += 1;
}

function recordMemoryCacheMiss(): void {
    metrics.memoryCache.misses += 1;
}

function networkKey(endpoint: string, method?: string): string {
    const base = endpoint.split('?')[0] || endpoint;
    const verb = (method || 'GET').toUpperCase();
    return `${verb} ${base}`;
}

function recordNetworkRequest(endpoint: string, method?: string): void {
    const key = networkKey(endpoint, method);
    metrics.network.total += 1;
    metrics.network.byEndpoint[key] = (metrics.network.byEndpoint[key] || 0) + 1;
}

function getClientServiceMetrics(): ClientServiceMetrics {
    return {
        cache: { ...metrics.cache },
        memoryCache: { ...metrics.memoryCache },
        network: {
            total: metrics.network.total,
            byEndpoint: { ...metrics.network.byEndpoint }
        }
    };
}

function resetClientServiceMetrics(): void {
    metrics.cache.systemsHits = 0;
    metrics.cache.historyHits = 0;
    metrics.cache.disabledSkips = 0;
    metrics.cache.loadFailures = 0;
    metrics.memoryCache.hits = 0;
    metrics.memoryCache.misses = 0;
    metrics.network.total = 0;
    metrics.network.byEndpoint = {};
    metrics.cache.mode = detectCacheMode();
}

export { getClientServiceMetrics, resetClientServiceMetrics };

declare global {
    interface Window {
        __BMSVIEW_STATS?: ClientServiceMetrics;
        __BMSVIEW_GET_STATS?: () => ClientServiceMetrics;
        __BMSVIEW_RESET_STATS?: () => void;
        __BMSVIEW_SET_CACHE_DISABLED?: (disabled: boolean) => void;
    }
}

// In-memory short-lived cache and in-flight dedupe map
const _cache = new Map<string, { data: any; expires: number }>();
const _inFlight = new Map<string, Promise<any>>();

async function fetchWithCache<T>(endpoint: string, ttl = 5000): Promise<T> {
    const key = endpoint;
    const now = Date.now();

    const cached = _cache.get(key);
    if (cached && cached.expires > now) {
        recordMemoryCacheHit();
        return cached.data as T;
    }

    if (_inFlight.has(key)) {
        return _inFlight.get(key)! as Promise<T>;
    }

    recordMemoryCacheMiss();

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
    },
    setApiFetch: (fn: typeof _apiFetchImpl) => { _apiFetchImpl = fn; },
    resetApiFetch: () => { _apiFetchImpl = defaultApiFetch; },
    getMetrics: () => getClientServiceMetrics(),
    resetMetrics: () => resetClientServiceMetrics()
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

if (typeof window !== 'undefined') {
    const globalWindow = window as Window;
    if (!globalWindow.__BMSVIEW_STATS) {
        globalWindow.__BMSVIEW_STATS = metrics;
        globalWindow.__BMSVIEW_GET_STATS = () => getClientServiceMetrics();
        globalWindow.__BMSVIEW_RESET_STATS = () => {
            resetClientServiceMetrics();
            log('info', 'Client service metrics reset via window helper.', {
                cacheMode: metrics.cache.mode
            });
        };
        globalWindow.__BMSVIEW_SET_CACHE_DISABLED = (disabled: boolean) => {
            try {
                if (disabled) {
                    window.localStorage?.setItem('bmsview:disableCache', 'true');
                } else {
                    window.localStorage?.removeItem('bmsview:disableCache');
                }
            } catch (_err) {
                // Fall back to global override if localStorage not accessible
            }

            if (typeof globalThis !== 'undefined') {
                (globalThis as any).__BMSVIEW_DISABLE_CACHE = disabled;
            }

            metrics.cache.mode = detectCacheMode();
            log('info', 'Updated local cache override.', {
                disabled,
                cacheMode: metrics.cache.mode
            });
        };

        log('info', 'Client service instrumentation attached to window.', {
            cacheMode: metrics.cache.mode
        });
    }
}

type LocalCacheModule = typeof import('@/services/localCache');
let localCacheModulePromise: Promise<LocalCacheModule> | null = null;

// Lazy-load the Dexie-backed cache so tests or SSR environments without IndexedDB succeed.
async function loadLocalCacheModule(): Promise<LocalCacheModule | null> {
    if (!isLocalCacheEnabled()) {
        return null;
    }

    if (!localCacheModulePromise) {
        localCacheModulePromise = import('@/services/localCache');
    }

    try {
        return await localCacheModulePromise;
    } catch (error) {
        recordCacheFailure();
        log('warn', 'Failed to load local cache module.', {
            error: error instanceof Error ? error.message : String(error)
        });
        localCacheModulePromise = null;
        return null;
    }
}

type CacheAugmented<T> = T & { _syncStatus?: string; updatedAt?: string };

function stripCacheMetadata<T>(record: CacheAugmented<T>): T {
    const { _syncStatus, updatedAt, ...rest } = record as Record<string, unknown>;
    return { ...rest } as T;
}

async function getCachedSystemsPage(page: number, limit: number): Promise<PaginatedResponse<BmsSystem> | null> {
    if (!isLocalCacheEnabled()) {
        recordCacheDisabledSkip();
        return null;
    }

    try {
        const cacheModule = await loadLocalCacheModule();
        if (!cacheModule) {
            return null;
        }

        const allSystems = await cacheModule.systemsCache.getAll();
        if (!allSystems.length) {
            return null;
        }

        recordCacheHit('systems');

        const start = Math.max(0, (page - 1) * limit);
        const end = start + limit;
        const items = allSystems
            .slice(start, end)
            .map((system: typeof allSystems[number]) => stripCacheMetadata<BmsSystem>(system));

        log('info', 'Serving systems from local cache.', {
            page,
            limit,
            returned: items.length,
            total: allSystems.length
        });

        return {
            items,
            totalItems: allSystems.length
        };
    } catch (error) {
        recordCacheFailure();
        log('warn', 'Failed to read systems cache.', {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}

async function getCachedHistoryPage(page: number, limit: number): Promise<PaginatedResponse<AnalysisRecord> | null> {
    if (!isLocalCacheEnabled()) {
        recordCacheDisabledSkip();
        return null;
    }

    try {
        const cacheModule = await loadLocalCacheModule();
        if (!cacheModule) {
            return null;
        }

        const allHistory = await cacheModule.historyCache.getAll();
        if (!allHistory.length) {
            return null;
        }

        recordCacheHit('history');

        const start = Math.max(0, (page - 1) * limit);
        const end = start + limit;
        const items = allHistory
            .slice(start, end)
            .map((record: typeof allHistory[number]) => stripCacheMetadata<AnalysisRecord>(record));

        log('info', 'Serving analysis history from local cache.', {
            page,
            limit,
            returned: items.length,
            total: allHistory.length
        });

        return {
            items,
            totalItems: allHistory.length
        };
    } catch (error) {
        recordCacheFailure();
        log('warn', 'Failed to read history cache.', {
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}


// Internal default implementation for API fetch
const defaultApiFetch = async <T>(endpoint: string, options: RequestInit = {}): Promise<T> => {
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    const logContext = { endpoint, method: options.method || 'GET' };
    recordNetworkRequest(endpoint, options.method);
    log('info', 'API fetch started.', logContext);

    try {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        } as Record<string, string>;

        // Add Netlify Identity token if available (guard for non-browser envs)
        if (typeof window !== 'undefined' && (window as any).netlifyIdentity?.currentUser) {
            const token = await (window as any).netlifyIdentity.currentUser()?.jwt();
            if (token) {
                Object.assign(headers, { 'Authorization': `Bearer ${token}` });
            }
        }

        const response = await fetch(`/.netlify/functions/${endpoint}`, {
            ...options,
            // Add cache control for GET requests to prevent stale data.
            cache: isGet ? 'no-store' : undefined,
            headers,
        } as RequestInit);

        if (!response.ok) {
            const errorText = await response.text();
            let errorData: any;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                // If JSON parse fails, use the text or a detailed error message
                errorData = {
                    error: errorText || `HTTP ${response.status} ${response.statusText}`,
                    statusCode: response.status,
                    statusText: response.statusText
                };
            }
            const error = (errorData as any).error || `Server responded with status: ${response.status}`;
            log('error', 'API fetch failed.', { ...logContext, status: response.status, error });
            throw new Error(error);
        }

        // For 204 No Content or other methods that might not return a body
        const contentLength = (response as any).headers?.get ? (response as any).headers.get('content-length') : null;
        if (response.status === 204 || contentLength === '0') {
            log('info', 'API fetch successful with no content.', { ...logContext, status: response.status });
            return null as T;
        }

        const data = await response.json();
        log('info', 'API fetch successful.', { ...logContext, status: response.status });
        return data as T;

    } catch (error) {
        // This will catch network errors or errors from the !response.ok block
        if (!(error instanceof Error && error.message.includes('Server responded with status'))) {
            log('error', 'API fetch encountered a network or parsing error.', { ...logContext, error: error instanceof Error ? error.message : String(error) });
        }
        throw error as Error;
    }
};

// Mutable implementation reference used by all helpers
let _apiFetchImpl: <T>(endpoint: string, options?: RequestInit) => Promise<T> = defaultApiFetch;

// Generic fetch helper, exported for use in any client-side component.
export function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    // Preserve exact arity for tests: if only endpoint is provided, do not pass a second arg
    if (arguments.length < 2) {
        return (_apiFetchImpl as any)(endpoint);
    }
    return _apiFetchImpl<T>(endpoint, options);
}

export const getRegisteredSystems = async (page = 1, limit = 25, options: FetchListOptions = {}): Promise<PaginatedResponse<BmsSystem>> => {
    const { forceRefresh = false, strategy = FetchStrategy.CACHE_FIRST } = options;
    const isForceRefresh = forceRefresh || strategy === FetchStrategy.FORCE_FRESH;
    log('info', 'Fetching paginated registered BMS systems.', { page, limit, strategy });

    if (!isForceRefresh) {
        const cached = await getCachedSystemsPage(page, limit);
        if (cached) {
            return cached;
        }
    }

    const response = isForceRefresh
        ? await apiFetch<any>(`systems?page=${page}&limit=${limit}`)
        : await fetchWithCache<any>(`systems?page=${page}&limit=${limit}`, 10_000);

    let result: PaginatedResponse<BmsSystem> = { items: [], totalItems: 0 };

    if (Array.isArray(response)) {
        result = {
            items: [...response],
            totalItems: response.length
        };
    } else if (response && typeof response === 'object') {
        const totalCandidates = [response.total, response.totalItems, response.count];
        const totalItems = totalCandidates.find(value => typeof value === 'number' && Number.isFinite(value));

        if (Array.isArray(response.items)) {
            result = {
                items: response.items,
                totalItems: typeof totalItems === 'number' ? totalItems : response.items.length
            };
        } else if (totalItems !== undefined) {
            result = {
                items: Array.isArray(response.items) ? response.items : [],
                totalItems
            };
        } else if (Object.keys(response).length > 0) {
            result = {
                items: [response],
                totalItems: 1
            };
        }
    }

    if (isLocalCacheEnabled() && result.items.length) {
        const cacheModule = await loadLocalCacheModule();
        if (cacheModule) {
            try {
                await cacheModule.systemsCache.bulkPut(result.items, 'synced');
            } catch (error) {
                recordCacheFailure();
                log('warn', 'Failed to update systems cache.', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    return result;
};

export const getAnalysisHistory = async (page = 1, limit = 25, options: FetchListOptions = {}): Promise<PaginatedResponse<AnalysisRecord>> => {
    const { forceRefresh = false, strategy = FetchStrategy.CACHE_FIRST } = options;
    const isForceRefresh = forceRefresh || strategy === FetchStrategy.FORCE_FRESH;
    log('info', 'Fetching paginated analysis history.', { page, limit, strategy });

    if (!isForceRefresh) {
        const cached = await getCachedHistoryPage(page, limit);
        if (cached) {
            return cached;
        }
    }

    const response = isForceRefresh
        ? await apiFetch<any>(`history?page=${page}&limit=${limit}`)
        : await fetchWithCache<any>(`history?page=${page}&limit=${limit}`, 5_000);

    let result: PaginatedResponse<AnalysisRecord> = { items: [], totalItems: 0 };

    if (Array.isArray(response)) {
        result = { items: response, totalItems: response.length };
    } else if (response && typeof response === 'object') {
        const items = Array.isArray(response.items) ? response.items : [];
        const totalCandidates = [response.total, response.totalItems, response.count];
        const totalItems = totalCandidates.find(value => typeof value === 'number' && Number.isFinite(value));
        result = {
            items,
            totalItems: typeof totalItems === 'number' ? totalItems : items.length
        };
    }

    if (isLocalCacheEnabled() && result.items.length) {
        const cacheModule = await loadLocalCacheModule();
        if (cacheModule) {
            try {
                await cacheModule.historyCache.bulkPut(result.items, 'synced');
            } catch (error) {
                recordCacheFailure();
                log('warn', 'Failed to update history cache.', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    return result;
};

export const streamAllHistory = async (onData: (records: AnalysisRecord[]) => void, onComplete: () => void): Promise<void> => {
    log('info', 'Starting to stream all history records.');
    const limit = 200; // Fetch in chunks of 200
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        try {
            log('info', 'Fetching history page for streaming.', { page, limit });
            const response = await getAnalysisHistory(page, limit, { forceRefresh: true });
            if (response.items.length === 0) {
                log('info', 'History stream hit empty page, stopping.', { page });
                hasMore = false;
                continue;
            }

            onData(response.items);

            const totalItems = response.totalItems;
            if (typeof totalItems === 'number' && Number.isFinite(totalItems)) {
                if (page * limit >= totalItems) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else if (response.items.length < limit) {
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

/**
 * Select the appropriate insights endpoint based on the chosen mode
 * Exported for testing purposes
 */
export function selectEndpointForMode(mode: InsightMode): string {
    switch (mode) {
        case InsightModeEnum.STANDARD:
            return '/.netlify/functions/generate-insights';
        case InsightModeEnum.FULL_CONTEXT:
            // Consolidated: Use the robust tools-based endpoint for full context too
            return '/.netlify/functions/generate-insights-with-tools';
        case InsightModeEnum.VISUAL_GURU:
            // Visual Guru uses the same endpoint but with different prompt behavior
            return '/.netlify/functions/generate-insights-with-tools';
        case InsightModeEnum.WITH_TOOLS:
        default:
            return '/.netlify/functions/generate-insights-with-tools';
    }
}

export const streamInsights = async (
    payload: {
        analysisData: AnalysisData;
        systemId?: string;
        customPrompt?: string;
        useEnhancedMode?: boolean;
        contextWindowDays?: number; // Days of historical data to retrieve
        maxIterations?: number; // Max ReAct loop iterations
        modelOverride?: string; // Optional Gemini model override
        insightMode?: InsightMode; // Selected insight generation mode
        consentGranted?: boolean; // User consent for AI analysis
    },
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
    onStart?: () => void
) => {
    onStart?.();

    // Determine endpoint based on selected mode
    const mode = payload.insightMode || InsightModeEnum.WITH_TOOLS;
    const endpoint = selectEndpointForMode(mode);

    let contextSummarySent = false;

    // CRITICAL: Backend timeout configuration
    // Default is 20s for Pro/Business, but can be configured via NETLIFY_FUNCTION_TIMEOUT_MS
    // Since we can't read env vars directly in the browser, we use the default
    const BACKEND_FUNCTION_TIMEOUT_S = 20; // 20 seconds (configurable on backend)

    // CRITICAL: With Netlify's configurable timeout, each attempt is shorter
    // Allow 15 attempts (15 * 20s default = 300s = 5 minutes total processing time)
    const MAX_RESUME_ATTEMPTS = 60; // Maximum 60 attempts for complex queries (20-30 mins)
    let resumeJobId: string | undefined = undefined;
    let attemptCount = 0;
    let lastErrorDetails: { code?: string; message?: string; status?: number } | null = null;

    log('info', 'Streaming insights from server.', {
        systemId: payload.systemId,
        hasCustomPrompt: !!payload.customPrompt,
        useEnhancedMode: payload.useEnhancedMode,
        contextWindowDays: payload.contextWindowDays,
        maxIterations: payload.maxIterations,
        modelOverride: payload.modelOverride,
        insightMode: mode, // Mode determines endpoint (see switch above)
        dataStructure: payload.analysisData ? Object.keys(payload.analysisData) : 'none'
    });

    // Iterative retry loop to avoid stack overflow with many attempts
    // Using while loop instead of recursion for safety and performance
    try {
        while (attemptCount < MAX_RESUME_ATTEMPTS) {
            attemptCount++;

            // Show retry progress to user - CALM UI approach
            // Only show initial message, hide retry spam from user
            if (attemptCount > 1) {
                // Log retry for debugging, but don't spam user with attempt counts
                log('info', 'Resuming insights generation silently', { attemptCount, resumeJobId });
                // No visible message to user - the processing indicator continues smoothly
            } else {
                // First attempt - log, but don't send an init message via onChunk
                log('info', 'Starting initial insights generation', { attemptCount });
            }

            // Timeout for insights request: 30 seconds (allows for Netlify 20s + network overhead)
            // This is MUCH shorter than the old 90s since each backend attempt is now only ~20s
            const controller = new AbortController();
            const REQUEST_TIMEOUT_MS = 30000; // 30 seconds per attempt
            const timeoutId = setTimeout(() => {
                controller.abort();
                log('warn', `Insights request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
            }, REQUEST_TIMEOUT_MS);

            try {
                // Build request body with resumeJobId if available
                const requestBody: any = {
                    ...payload,
                    insightMode: mode, // Include for logging consistency
                    mode: 'sync' // Explicitly use sync mode for checkpoint/resume
                };

                if (resumeJobId) {
                    requestBody.resumeJobId = resumeJobId;
                }

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                // Handle 408 timeout response with resumeJobId
                if (response.status === 408) {
                    try {
                        const errorData = await response.json();

                        // Track error details for dynamic error messages
                        lastErrorDetails = {
                            code: errorData.error || 'insights_timeout',
                            message: errorData.message || 'Request timed out',
                            status: 408
                        };

                        log('info', 'Received 408 timeout response', {
                            hasJobId: !!errorData.details?.jobId,
                            canResume: errorData.details?.canResume,
                            attemptCount
                        });

                        // Check if we can resume
                        if (errorData.details?.canResume && errorData.details?.jobId) {
                            // Save jobId and continue loop for retry
                            resumeJobId = errorData.details.jobId;
                            log('info', 'Automatic retry scheduled', {
                                attemptCount,
                                maxAttempts: MAX_RESUME_ATTEMPTS,
                                jobId: resumeJobId
                            });

                            // Continue to next iteration
                            continue;
                        } else {
                            // Can't resume - throw original error
                            throw new Error(errorData.message || 'Insights generation timed out and cannot be resumed');
                        }
                    } catch (parseError) {
                        lastErrorDetails = { code: 'parse_error', message: 'Failed to parse timeout response', status: 408 };
                        log('error', 'Failed to parse 408 response', { error: parseError });
                        throw new Error('Insights generation timed out');
                    }
                }

                if (!response.ok) {
                    let errorMessage = `Request failed: ${response.status}`;
                    let errorCode = `http_${response.status}`;

                    // Provide user-friendly error messages for common status codes
                    if (response.status === 504) {
                        errorMessage = 'Request timed out. The AI took too long to process your query. Try:\n' +
                            '• Asking a simpler question\n' +
                            '• Requesting a smaller time range\n' +
                            '• Breaking complex queries into multiple questions';
                        errorCode = 'gateway_timeout';
                    } else if (response.status === 503) {
                        errorMessage = 'Service temporarily unavailable. Please try again in a few moments.';
                        errorCode = 'service_unavailable';
                    } else if (response.status === 500) {
                        try {
                            const errorData = await response.json();
                            if (errorData.message) {
                                errorMessage = errorData.message;
                            }
                            if (errorData.error) {
                                errorCode = errorData.error;
                            }
                        } catch {
                            errorMessage = 'Internal server error. Please try again.';
                        }
                    } else if (response.status === 404) {
                        errorCode = 'not_found';
                        errorMessage = 'AI model or endpoint not found. This may be a configuration issue.';
                    } else if (response.status === 429) {
                        errorCode = 'rate_limited';
                        errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
                    } else {
                        try {
                            const errorText = await response.text();
                            errorMessage = errorText || errorMessage;
                        } catch {
                            // Use default error message
                        }
                    }

                    // Track error details for dynamic error messages
                    lastErrorDetails = {
                        code: errorCode,
                        message: errorMessage,
                        status: response.status
                    };

                    log('error', 'Insights request failed', {
                        status: response.status,
                        statusText: response.statusText,
                        errorMessage,
                        errorCode
                    });

                    throw new Error(errorMessage);
                }

                const result = await response.json();

                // Log response structure for debugging
                log('info', 'Insights response received', {
                    hasJobId: !!result.jobId,
                    hasInsights: !!result.insights,
                    hasSuccess: !!result.success,
                    hasStatus: !!result.status,
                    responseKeys: Object.keys(result),
                    jobId: result.jobId?.substring?.(0, 20) || 'none',
                    status: result.status,
                    mode: result.metadata?.mode,
                    wasResumed: result.metadata?.wasResumed,
                    attemptCount
                });

                if (result.contextSummary && !contextSummarySent) {
                    const summaryText = formatContextSummary(result.contextSummary);
                    if (summaryText) {
                        onChunk(summaryText);
                        contextSummarySent = true;
                    }
                }

                // Handle BACKGROUND MODE: Response contains jobId (async processing)
                if (result.jobId && !result.insights) {
                    log('info', 'Background insights job started', {
                        jobId: result.jobId,
                        status: result.status
                    });

                    // Stream initial summary if available
                    if (result.initialSummary) {
                        const summaryText = formatInitialSummary(result.initialSummary);
                        if (summaryText) {
                            onChunk(summaryText);
                        }
                    }

                    // Start polling for job completion
                    await pollInsightsJobCompletion(
                        result.jobId,
                        onChunk,
                        onError,
                        600,
                        2000,
                        contextSummarySent ? undefined : result.contextSummary,
                        payload.contextWindowDays
                    );
                    onComplete();
                    return;
                }

                // Handle SYNC MODE: Response contains insights directly
                if (result.success && result.insights) {
                    // Check for warnings (e.g., max iterations reached)
                    if (result.warning) {
                        log('warn', 'Insights generation warning', { warning: result.warning });
                    }

                    if (!contextSummarySent && result.insights.contextSummary) {
                        const summaryText = formatContextSummary(result.insights.contextSummary);
                        if (summaryText) {
                            onChunk(summaryText);
                            contextSummarySent = true;
                        }
                    }

                    onChunk(result.insights.formattedText || result.insights.rawText || 'Analysis completed');

                    // Log performance metrics if available
                    if (result.metadata) {
                        log('info', 'Insights generation metrics', {
                            iterations: result.metadata.turns,
                            toolCallsUsed: result.metadata.toolCalls,
                            durationMs: result.metadata.durationMs,
                            wasResumed: result.metadata.wasResumed,
                            totalAttempts: attemptCount
                        });
                    }
                    onComplete();
                    return;
                }

                if (result.error && result.insights) {
                    // Handle error case where insights contains error message
                    log('warn', 'Insights generated with error', { result });
                    onChunk(result.insights.formattedText || result.insights.rawText || 'Analysis failed');
                    onComplete();
                    return;
                }

                // Unknown response format - provide detailed error message for debugging
                log('warn', 'Unexpected insights response format', {
                    result,
                    detail: {
                        hasJobId: !!result.jobId,
                        hasInsights: !!result.insights,
                        hasSuccess: !!result.success,
                        hasStatus: !!result.status,
                        allKeys: Object.keys(result),
                        responseJSON: JSON.stringify(result)
                    }
                });

                // Fallback: Try to detect mode even with unexpected structure
                if (result.jobId && result.status === 'processing') {
                    log('info', 'Detected background mode from status field', { jobId: result.jobId });
                    if (result.initialSummary) {
                        const summaryText = formatInitialSummary(result.initialSummary);
                        if (summaryText) {
                            onChunk(summaryText);
                        }
                    }
                    await pollInsightsJobCompletion(
                        result.jobId,
                        onChunk,
                        onError,
                        600,
                        2000,
                        contextSummarySent ? undefined : result.contextSummary,
                        payload.contextWindowDays
                    );
                    onComplete();
                    return;
                }

                throw new Error('Server returned unexpected response format');
            } catch (err) {
                clearTimeout(timeoutId);

                const error = err instanceof Error ? err : new Error(String(err));

                // CRITICAL FIX: Treat AbortError as a retry signal, not a fatal error
                // This is the "Starter Motor" approach - keep trying instead of showing error
                if (error.name === 'AbortError') {
                    // Client-side timeout - the function took too long to respond
                    // Instead of showing error, treat this like a 408 and retry
                    lastErrorDetails = {
                        code: 'client_timeout',
                        message: 'Request timed out on client side',
                        status: 408
                    };

                    log('warn', 'Client-side timeout occurred, treating as retry signal', {
                        attemptCount,
                        maxAttempts: MAX_RESUME_ATTEMPTS,
                        timeoutMs: REQUEST_TIMEOUT_MS
                    });

                    // Continue to next iteration if we haven't hit max attempts
                    // The while loop will handle the retry
                    continue;
                } else {
                    // Non-timeout error - track details and throw immediately
                    lastErrorDetails = {
                        code: 'unknown_error',
                        message: error.message,
                        status: undefined
                    };
                    throw error;
                }
            }
        }

        // If we exit the loop, we've exceeded max attempts
        // Build DYNAMIC error message based on actual error context
        const totalTimeMinutes = Math.round((MAX_RESUME_ATTEMPTS * BACKEND_FUNCTION_TIMEOUT_S) / 60);
        const contextWindowDays = payload.contextWindowDays || 30;

        // Build contextual error message based on last error
        let errorReason = 'The analysis server is experiencing high load.';
        let suggestions: string[] = [];

        if (lastErrorDetails) {
            switch (lastErrorDetails.code) {
                case 'not_found':
                case 'http_404':
                    errorReason = `AI model configuration error (${lastErrorDetails.code}): ${lastErrorDetails.message || 'Model not found'}`;
                    suggestions = [
                        'This appears to be a server configuration issue',
                        'Please contact support if this persists'
                    ];
                    break;
                case 'rate_limited':
                case 'http_429':
                    errorReason = `API rate limit reached after ${attemptCount} attempts`;
                    suggestions = [
                        'Wait a few minutes before trying again',
                        'Consider reducing query frequency'
                    ];
                    break;
                case 'service_unavailable':
                case 'http_503':
                    errorReason = 'The AI service is temporarily unavailable';
                    suggestions = [
                        'The service may be undergoing maintenance',
                        'Try again in a few minutes'
                    ];
                    break;
                case 'gateway_timeout':
                case 'http_504':
                case 'client_timeout':
                case 'insights_timeout':
                    errorReason = `Analysis hit the maximum retry limit of ${attemptCount} attempts (approx. ${totalTimeMinutes} minutes elapsed).`;
                    suggestions = [
                        `Reduce the time range (currently: ${contextWindowDays} days)`,
                        'Ask a more specific question',
                        'Break your query into multiple smaller questions',
                        'Use the background analysis mode for very large datasets'
                    ];
                    break;
                default:
                    if (lastErrorDetails.message) {
                        errorReason = `Last error: ${lastErrorDetails.message}`;
                    }
                    suggestions = [
                        `Reduce the time range (currently: ${contextWindowDays} days)`,
                        'Ask a more specific question',
                        'Try again in a few moments'
                    ];
            }
        } else {
            // Default suggestions if no error details available
            suggestions = [
                `Reduce the time range (currently: ${contextWindowDays} days)`,
                'Ask a more specific question',
                'Break your query into multiple smaller questions'
            ];
        }

        const suggestionList = suggestions.map(s => `• ${s}`).join('\n');
        const maxRetriesError = new Error(
            `Analysis could not complete after ${attemptCount} attempts.\n\n` +
            `${errorReason}\n\n` +
            `Suggestions:\n${suggestionList}`
        );
        throw maxRetriesError;
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log('error', 'Insights generation failed after retries', {
            error: err.message,
            attemptCount
        });
        onError(err);
    }
};

/**
 * Format initial summary for display
 */
const formatInitialSummary = (summary: any): string => {
    if (!summary) return '';

    const parts: string[] = ['🤖 Initializing Advanced Insights Generation..\n'];

    // Describe what data is being packaged for Gemini
    parts.push('📦 Packaging the data from this analysis (now)');

    if (summary.generated) {
        parts.push(`\n${summary.generated}`);
    }

    parts.push('\n⏳ Querying historical data and analyzing trends...\n');

    return parts.filter(p => p).join('\n');
};

const formatContextSummary = (summary: any): string => {
    if (!summary || typeof summary !== 'object') {
        return '';
    }

    const lines: string[] = ['🧠 Guru Context Primer:\n'];

    if (summary.systemProfile?.name || summary.systemProfile?.chemistry) {
        const profilePieces: string[] = [];
        if (summary.systemProfile.name) profilePieces.push(summary.systemProfile.name);
        if (summary.systemProfile.chemistry) profilePieces.push(summary.systemProfile.chemistry);
        if (typeof summary.systemProfile.voltage === 'number') {
            profilePieces.push(`${summary.systemProfile.voltage.toFixed(1)}V`);
        }
        if (profilePieces.length > 0) {
            lines.push(`• System: ${profilePieces.join(' | ')}`);
        }
    }

    if (summary.snapshot) {
        const snapshotBits: string[] = [];
        if (typeof summary.snapshot.voltage === 'number') snapshotBits.push(`${summary.snapshot.voltage.toFixed(2)}V`);
        if (typeof summary.snapshot.current === 'number') snapshotBits.push(`${summary.snapshot.current.toFixed(1)}A`);
        if (typeof summary.snapshot.soc === 'number') snapshotBits.push(`${summary.snapshot.soc.toFixed(1)}% SOC`);
        if (snapshotBits.length > 0) {
            lines.push(`• Live snapshot: ${snapshotBits.join(' | ')}`);
        }
    }

    if (summary.energyBudget) {
        const budgetParts: string[] = [];
        if (typeof summary.energyBudget.solarSufficiency === 'number') {
            budgetParts.push(`Solar ${summary.energyBudget.solarSufficiency.toFixed(0)}%`);
        }
        if (typeof summary.energyBudget.autonomyDays === 'number') {
            budgetParts.push(`${summary.energyBudget.autonomyDays.toFixed(1)} days autonomy`);
        }
        if (budgetParts.length > 0) {
            lines.push(`• Energy budget: ${budgetParts.join(' | ')}`);
        }
    }

    if (summary.predictions?.capacity) {
        const predPieces: string[] = [];
        if (typeof summary.predictions.capacity.degradationAhPerDay === 'number') {
            predPieces.push(`${summary.predictions.capacity.degradationAhPerDay.toFixed(2)} Ah/day fade`);
        }
        if (typeof summary.predictions.capacity.daysToThreshold === 'number') {
            predPieces.push(`${summary.predictions.capacity.daysToThreshold} days to threshold`);
        }
        if (predPieces.length > 0) {
            lines.push(`• Forecast: ${predPieces.join(' | ')}`);
        }
    }

    if (typeof summary.predictions?.lifetimeMonths === 'number') {
        lines.push(`• Remaining life: ${summary.predictions.lifetimeMonths} months`);
    }

    if (summary.anomalies && typeof summary.anomalies.total === 'number') {
        const anomalyParts: string[] = [`${summary.anomalies.total} anomalies`];
        if (typeof summary.anomalies.highSeverity === 'number') {
            anomalyParts.push(`${summary.anomalies.highSeverity} high severity`);
        }
        lines.push(`• Anomalies: ${anomalyParts.join(' | ')}`);
    }

    if (summary.weather) {
        const weatherBits: string[] = [];
        if (typeof summary.weather.temp === 'number') weatherBits.push(`${summary.weather.temp.toFixed(1)}°C`);
        if (typeof summary.weather.clouds === 'number') weatherBits.push(`${summary.weather.clouds.toFixed(0)}% clouds`);
        if (typeof summary.weather.uvi === 'number') weatherBits.push(`UVI ${summary.weather.uvi.toFixed(1)}`);
        if (weatherBits.length > 0) {
            lines.push(`• Weather: ${weatherBits.join(' | ')}`);
        }
    }

    if (summary.recentSnapshots) {
        const snapshotMeta: string[] = [];
        if (typeof summary.recentSnapshots.count === 'number') {
            snapshotMeta.push(`${summary.recentSnapshots.count} samples`);
        }
        if (typeof summary.recentSnapshots.netSocDelta === 'number') {
            snapshotMeta.push(`ΔSOC ${summary.recentSnapshots.netSocDelta >= 0 ? '+' : ''}${summary.recentSnapshots.netSocDelta.toFixed(1)}%`);
        }
        if (typeof summary.recentSnapshots.netAhDelta === 'number') {
            snapshotMeta.push(`ΔAh ${summary.recentSnapshots.netAhDelta >= 0 ? '+' : ''}${summary.recentSnapshots.netAhDelta.toFixed(2)}`);
        }
        if (typeof summary.recentSnapshots.alertCount === 'number' && summary.recentSnapshots.alertCount > 0) {
            snapshotMeta.push(`${summary.recentSnapshots.alertCount} alerts`);
        }
        if (snapshotMeta.length > 0) {
            lines.push(`• Recent logs: ${snapshotMeta.join(' | ')}`);
        }
    }

    if (summary.meta?.contextBuildMs) {
        lines.push(`• Context build time: ${Math.round(summary.meta.contextBuildMs)} ms${summary.meta.truncated ? ' (truncated)' : ''}`);
    }

    const filtered = lines.filter(Boolean);
    if (filtered.length <= 1) {
        return '';
    }

    return filtered.join('\n') + '\n';
};

// Error backoff multiplier for transient failures
const ERROR_BACKOFF_MULTIPLIER = 1.5;

/**
 * Poll for background job completion with streaming updates
 * "Starter Motor" approach: Infinite polling until definitive result
 */
const pollInsightsJobCompletion = async (
    jobId: string,
    onChunk: (chunk: string) => void,
    onError: (error: Error) => void,
    maxAttempts: number = 600,  // Increased from 120 (~4 min) to 600 (~20 min) to allow for longer AI processing
    initialInterval: number = 2000,
    initialContextSummary?: any,
    contextWindowDays?: number // Add parameter to track context window for logging
): Promise<void> => {
    let attempts = 0;
    let lastProgressCount = 0;
    let currentInterval = initialInterval;
    const maxInterval = 10000;
    const backoffMultiplier = 1.3;
    let contextSummarySent = false;
    const pollingStartTime = Date.now(); // Track actual elapsed time

    const emitContextSummary = (summary: any) => {
        if (!summary || contextSummarySent) {
            return;
        }
        const formatted = formatContextSummary(summary);
        if (formatted) {
            onChunk(formatted);
            contextSummarySent = true;
        }
    };

    emitContextSummary(initialContextSummary);

    return new Promise((resolve, reject) => {
        const poll = async () => {
            try {
                const response = await fetch('/.netlify/functions/generate-insights-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobId })
                });

                if (!response.ok) {
                    throw new Error(`Status check failed: ${response.status}`);
                }

                const status = await response.json();

                emitContextSummary(status.contextSummary || status.partialInsights?.contextSummary || status.finalInsights?.contextSummary);

                // Stream new progress events
                if (status.progress && status.progress.length > lastProgressCount) {
                    const newEvents = status.progress.slice(lastProgressCount);
                    for (const event of newEvents) {
                        const message = formatProgressEvent(event);
                        if (message) {
                            onChunk(message);
                        }
                    }
                    lastProgressCount = status.progress.length;
                }

                // Stream partial insights (only if job is not yet completed to avoid duplicate output)
                if (status.partialInsights && status.status !== 'completed') {
                    if (typeof status.partialInsights === 'string') {
                        onChunk(status.partialInsights);
                    } else if (status.partialInsights.formattedText) {
                        onChunk(status.partialInsights.formattedText);
                    } else if (status.partialInsights.rawText) {
                        onChunk(status.partialInsights.rawText);
                    }
                }

                // Check if completed
                if (status.status === 'completed' && status.finalInsights) {
                    emitContextSummary(status.finalInsights.contextSummary);
                    const finalText = status.finalInsights.formattedText ||
                        status.finalInsights.rawText ||
                        formatInsightsObject(status.finalInsights);
                    if (finalText) {
                        onChunk(`\n✅ Analysis Complete:\n${finalText}`);
                    }
                    log('info', 'Background insights job completed', { jobId });
                    resolve();
                    return;
                }

                // Check if failed
                if (status.status === 'failed') {
                    // Issue 236: Use enhanced error context from backend
                    let errorMessage = status.error || 'Background job failed';

                    // Build detailed error message from backend's enhanced fields
                    if (status.failureReason) {
                        errorMessage = `❌ Analysis Failed\n\n`;
                        // Sanitize backend fields to prevent any potential injection
                        const sanitize = (text: string): string =>
                            String(text || '').replace(/[<>]/g, '').substring(0, 500);

                        errorMessage += `**Reason:** ${sanitize(status.failureReason)}\n\n`;

                        if (status.failureCategory) {
                            errorMessage += `**Category:** ${sanitize(status.failureCategory)}\n\n`;
                        }

                        if (status.suggestions && Array.isArray(status.suggestions) && status.suggestions.length > 0) {
                            errorMessage += `**Suggestions:**\n`;
                            // Limit to 5 suggestions max, sanitize each
                            const safeSuggestions = status.suggestions
                                .slice(0, 5)
                                .map((s: unknown) => sanitize(String(s)));
                            for (const suggestion of safeSuggestions) {
                                errorMessage += `• ${suggestion}\n`;
                            }
                            errorMessage += '\n';
                        }

                        if (status.lastProgressEvent) {
                            const lastEvent = status.lastProgressEvent;
                            const eventDesc = formatProgressEvent(lastEvent);
                            if (eventDesc) {
                                errorMessage += `**Last Activity:** ${sanitize(eventDesc)}\n`;
                            }
                        }

                        if (typeof status.progressCount === 'number' && status.progressCount > 0) {
                            errorMessage += `\n_Completed ${Math.min(status.progressCount, 999)} steps before failure_`;
                        }
                    }

                    const error = new Error(errorMessage);
                    log('error', 'Background insights job failed', {
                        jobId,
                        error: status.error,
                        failureReason: status.failureReason,
                        failureCategory: status.failureCategory
                    });
                    reject(error);
                    return;
                }

                // Continue polling
                attempts++;

                // "Starter Motor" approach: After many attempts, show informative message
                // but don't reject - the background job may still be running
                if (attempts >= maxAttempts) {
                    // Calculate actual elapsed time
                    const actualElapsedMs = Date.now() - pollingStartTime;
                    const actualMinutes = Math.round(actualElapsedMs / 60000);

                    const warning = `\n\n⚠️ **Analysis taking longer than expected (${actualMinutes} minutes elapsed)**\n\n` +
                        `Your analysis is still processing in the background. This typically means:\n` +
                        `• Very large dataset being analyzed (${contextWindowDays || 30}+ days)\n` +
                        `• Complex query requiring extensive AI processing\n` +
                        `• High system load\n\n` +
                        `The analysis will continue. You can:\n` +
                        `• Wait for completion (recommended)\n` +
                        `• Reduce the time window and try again\n` +
                        `• Refresh the page to check status later\n`;

                    log('warn', 'Background insights polling exceeded expected time', {
                        jobId,
                        attempts,
                        actualElapsedMs,
                        actualMinutes,
                        contextWindowDays
                    });

                    // Show warning but continue polling (don't reject)
                    onChunk(warning);
                }

                // Always continue polling with backoff
                currentInterval = Math.min(currentInterval * backoffMultiplier, maxInterval);
                setTimeout(poll, currentInterval);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));

                // "Starter Motor" approach: Log network errors but keep polling
                // Only reject on catastrophic errors (404, 403, 401)
                // For HTTP errors, check if response was attached with status
                let status: number | undefined = undefined;
                if ((error as any).response && typeof (error as any).response.status === 'number') {
                    status = (error as any).response.status;
                } else if (typeof (error as any).status === 'number') {
                    status = (error as any).status;
                }

                const isCatastrophic = status === 404 || status === 403 || status === 401;

                if (isCatastrophic) {
                    log('error', 'Catastrophic error polling insights job status', {
                        jobId,
                        error: error.message,
                        status
                    });
                    reject(error);
                    return;
                }

                // For transient errors (network issues, 500s, timeouts), just log and retry
                log('warn', 'Transient error polling insights job status, retrying', {
                    jobId,
                    error: error.message,
                    status,
                    attempt: attempts
                });

                // Increase backoff and continue
                attempts++;
                currentInterval = Math.min(currentInterval * backoffMultiplier * ERROR_BACKOFF_MULTIPLIER, maxInterval);
                setTimeout(poll, currentInterval);
            }
        };

        // Start polling
        poll();
    });
};

/**
 * Format progress event for display
 */
const formatProgressEvent = (event: any): string => {
    if (!event) return '';

    switch (event.type) {
        case 'tool_call':
            return `🔧 Calling tool: ${event.data?.toolName || 'unknown'}...`;
        case 'tool_response':
            return `✓ Tool response received`;
        case 'ai_response':
            return `🤖 AI analyzing...`;
        case 'iteration':
            return `📈 Iteration ${event.data?.iteration || '?'} of ${event.data?.maxIterations || '?'}`;
        case 'status':
            return `ℹ️ ${event.data?.message || 'Processing...'}`;
        case 'error':
            return `⚠️ ${event.data?.message || 'Error during processing'}`;
        default:
            return '';
    }
};

/**
 * Format insights object to string
 */
const formatInsightsObject = (insights: any): string => {
    if (typeof insights === 'string') return insights;

    const parts: string[] = [];

    if (insights.currentHealthStatus) {
        parts.push(`Health Status: ${insights.currentHealthStatus}`);
    }

    if (Array.isArray(insights.keyFindings)) {
        parts.push(`\nKey Findings:\n${insights.keyFindings.map((f: string) => `• ${f}`).join('\n')}`);
    }

    if (insights.recommendations) {
        if (Array.isArray(insights.recommendations)) {
            parts.push(`\nRecommendations:\n${insights.recommendations.map((r: string) => `• ${r}`).join('\n')}`);
        } else if (typeof insights.recommendations === 'string') {
            parts.push(`\nRecommendations:\n${insights.recommendations}`);
        }
    }

    if (insights.summary) {
        parts.push(`\n${insights.summary}`);
    }

    return parts.join('\n');
};

/**
 * Generate insights using background processing (default mode)
 * Returns jobId immediately for polling status updates
 */
export const generateInsightsBackground = async (
    payload: {
        analysisData: AnalysisData;
        systemId?: string;
        customPrompt?: string;
        useEnhancedMode?: boolean;
    }
): Promise<{ jobId: string; initialSummary: any; status: string }> => {
    // Always use the fully-featured ReAct loop implementation
    const endpoint = '/.netlify/functions/generate-insights-with-tools';

    log('info', 'Starting background insights generation.', {
        systemId: payload.systemId,
        hasCustomPrompt: !!payload.customPrompt,
        useEnhancedMode: payload.useEnhancedMode
    });

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(errorData.error || errorData.message || `Request failed: ${response.status}`);
        }

        const result = await response.json();

        if (!result.success || !result.jobId) {
            throw new Error(result.error || 'Failed to start background processing');
        }

        log('info', 'Background insights job created', {
            jobId: result.jobId,
            status: result.status
        });

        return {
            jobId: result.jobId,
            initialSummary: result.initialSummary || null,
            status: result.status || 'processing'
        };
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log('error', 'Failed to start background insights', { error: error.message });
        throw error;
    }
};

/**
 * Get status of an insights generation job
 */
export const getInsightsJobStatus = async (jobId: string): Promise<any> => {
    log('info', 'Fetching insights job status', { jobId });

    try {
        const response = await fetch('/.netlify/functions/generate-insights-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ jobId }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(errorData.error || errorData.message || `Request failed: ${response.status}`);
        }

        const status = await response.json();

        log('info', 'Insights job status retrieved', {
            jobId,
            status: status.status,
            hasProgress: !!status.progress,
            progressCount: status.progressCount || 0
        });

        return status;
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log('error', 'Failed to get insights job status', { error: error.message, jobId });
        throw error;
    }
};

// ============================================
// Dual-Write Helpers with Timer Reset
// ============================================

/**
 * Helper to perform dual-write (server + local cache) + timer reset
 * This is used for critical actions that should persist locally and trigger sync
 */
async function dualWriteWithTimerReset<T>(
    operation: 'create' | 'update' | 'link',
    serverFn: () => Promise<T>,
    localCacheFn?: () => Promise<void>,
    context?: Record<string, any>
): Promise<T> {
    const startTime = Date.now();

    try {
        // 1. Call server function
        log('info', `Dual-write: server write (${operation})`, context);
        const result = await serverFn();

        // 2. Write to local cache (non-blocking, fire-and-forget)
        if (localCacheFn && isLocalCacheEnabled()) {
            (async () => {
                try {
                    await localCacheFn();
                    log('info', `Dual-write: local cache write (${operation}) completed`, context);
                } catch (cacheErr) {
                    log('warn', `Dual-write: local cache write (${operation}) failed`, {
                        ...context,
                        error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
                    });
                }
            })();
        }

        // 3. Reset sync timer to trigger periodic sync
        try {
            const sm = await import('@/services/syncManager');
            if (sm.default && sm.default.resetPeriodicTimer) {
                sm.default.resetPeriodicTimer();
                log('info', `Dual-write: sync timer reset (${operation})`, context);
            }
        } catch (timerErr) {
            log('warn', `Dual-write: failed to reset sync timer`, {
                ...context,
                error: timerErr instanceof Error ? timerErr.message : String(timerErr)
            });
        }

        // 4. Log performance
        const duration = Date.now() - startTime;
        log('info', `Dual-write completed (${operation})`, { ...context, durationMs: duration });

        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);
        log('error', `Dual-write failed (${operation})`, { ...context, error: errorMsg, durationMs: duration });
        throw error;
    }
}

export const registerBmsSystem = async (
    systemData: Omit<BmsSystem, 'id'>
): Promise<BmsSystem> => {
    return dualWriteWithTimerReset(
        'create',
        async () => {
            log('info', 'Registering new BMS system.', { name: systemData.name });
            // Ensure associatedDLs is always an array (default to empty if not provided)
            const dataToSend = {
                ...systemData,
                associatedDLs: systemData.associatedDLs || []
            };
            return apiFetch<BmsSystem>('systems', {
                method: 'POST',
                body: JSON.stringify(dataToSend),
            });
        },
        async () => {
            // Write to local BMS systems cache
            try {
                const localCache = await loadLocalCacheModule();
                if (localCache && localCache.systemsCache) {
                    const newSystem: BmsSystem = {
                        id: `temp-${Date.now()}`,
                        ...systemData,
                        associatedDLs: systemData.associatedDLs || []
                    };
                    await localCache.systemsCache.put(newSystem, 'pending');
                }
            } catch (err) {
                // Non-fatal: cache write is best-effort
                log('warn', 'Failed to cache new BMS system locally', {
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        },
        { operationType: 'registerBmsSystem', name: systemData.name }
    );
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
    return dualWriteWithTimerReset(
        'create',
        async () => {
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
        },
        async () => {
            // Cache the analysis record locally
            try {
                const localCache = await loadLocalCacheModule();
                if (localCache && localCache.historyCache) {
                    // Create a temporary record with the analysis data
                    const tempRecord: AnalysisRecord = {
                        id: `temp-${Date.now()}`,
                        systemId,
                        analysis: analysisData,
                        weather: weatherData,
                        dlNumber: analysisData.dlNumber,
                        fileName: fileName,
                        timestamp: new Date().toISOString()
                    };
                    await localCache.historyCache.put(tempRecord, 'pending');
                }
            } catch (err) {
                // Non-fatal: cache write is best-effort
                log('warn', 'Failed to cache analysis result locally', {
                    error: err instanceof Error ? err.message : String(err),
                    fileName
                });
            }
        },
        { operationType: 'saveAnalysisResult', fileName, systemId }
    );
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
    return dualWriteWithTimerReset(
        'link',
        async () => {
            log('info', 'Linking analysis record to system.', { recordId, systemId, dlNumber });
            await apiFetch('history', {
                method: 'PUT',
                body: JSON.stringify({ recordId, systemId, dlNumber }),
            });
        },
        undefined, // Link operation doesn't need local cache update, just server sync
        { operationType: 'linkAnalysisToSystem', recordId, systemId }
    );
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

export const backfillWeatherData = async (): Promise<{
    success: boolean;
    updatedCount: number;
    errorCount?: number;
    processedCount?: number;
    completed?: boolean;
    message?: string;
}> => {
    log('info', 'Sending request to backfill weather data.');
    return apiFetch<{
        success: boolean;
        updatedCount: number;
        errorCount?: number;
        processedCount?: number;
        completed?: boolean;
        message?: string;
    }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'backfill-weather',
            maxRecords: 50 // Process 50 records per run to avoid timeout
        }),
    });
};

export const backfillHourlyCloudData = async (): Promise<{
    success: boolean;
    processedDays: number;
    hoursInserted: number;
    errors: number;
    systemsProcessed: number;
    completed?: boolean;
    message?: string;
}> => {
    log('info', 'Sending request to backfill hourly cloud data.');
    return apiFetch<{
        success: boolean;
        processedDays: number;
        hoursInserted: number;
        errors: number;
        systemsProcessed: number;
        completed?: boolean;
        message?: string;
    }>('history', {
        method: 'POST',
        body: JSON.stringify({
            action: 'hourly-cloud-backfill',
            maxDays: 10 // Process 10 days per run to avoid timeout
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

/**
 * Data Reconciliation: Fetch comprehensive data integrity audit
 * Returns all DL-# sources categorized as MATCHED or ORPHAN
 */
export interface DataIntegrityItem {
    dl_id: string;
    record_count: number;
    status: 'MATCHED' | 'ORPHAN';
    system_id: string | null;
    system_name: string | null;
    first_seen: string;
    last_seen: string;
    system_chemistry?: string;
    system_voltage?: number;
    system_capacity?: number;
    previously_linked_system_id?: string | null;
    previously_linked_system_name?: string | null;
}

export interface DataIntegrityResponse {
    summary: {
        total_dl_sources: number;
        matched: number;
        orphaned: number;
        total_records: number;
        orphaned_records: number;
    };
    data: DataIntegrityItem[];
    timestamp: string;
}

export const getDataIntegrity = async (): Promise<DataIntegrityResponse> => {
    log('info', 'Fetching data integrity audit from admin endpoint.');
    return apiFetch<DataIntegrityResponse>('admin-data-integrity');
};

export const getHourlyWeather = async (lat: number, lon: number, date: string): Promise<any[]> => {
    log('info', 'Fetching hourly weather data.', { lat, lon, date });
    return apiFetch<any[]>('weather', {
        method: 'POST',
        body: JSON.stringify({ lat, lon, timestamp: date, type: 'hourly' }),
    });
};

export interface DiagnosticTestResult {
    name: string;
    status: 'success' | 'warning' | 'error' | 'partial' | 'running';
    duration: number;
    details?: Record<string, any>;
    error?: string;
}

export interface DiagnosticsResponse {
    status: 'success' | 'partial' | 'warning' | 'error';
    timestamp: string;
    duration: number;
    results: DiagnosticTestResult[];
    summary?: {
        total: number;
        success: number;
        partial?: number;
        warnings: number;
        errors: number;
    };
    error?: string;
    testId?: string;
    cleanup?: {
        success: string[];
        failed: string[];
    };
    metadata?: {
        environment?: string;
        requestId?: string;
    };
    details?: Record<string, any>;
}

export const runDiagnostics = async (selectedTests?: string[]): Promise<DiagnosticsResponse> => {
    log('info', 'Running system diagnostics.', { selectedTests });

    // Netlify Functions have a hard timeout of 26 seconds (10s free tier, 26s paid)
    // Set client timeout to 25 seconds to allow for response handling before Netlify cuts off
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
        const headers = {
            'Content-Type': 'application/json',
        } as Record<string, string>;

        // Add Netlify Identity token if available (consistent with apiFetch pattern)
        if (typeof window !== 'undefined' && (window as any).netlifyIdentity?.currentUser) {
            const token = await (window as any).netlifyIdentity.currentUser()?.jwt();
            if (token) {
                Object.assign(headers, { 'Authorization': `Bearer ${token}` });
            }
        }

        const response = await fetch(`/.netlify/functions/admin-diagnostics`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ selectedTests }),
            signal: controller.signal,
        } as RequestInit);

        // Log response details for debugging
        log('info', 'Diagnostics response received.', {
            status: response.status,
            ok: response.ok,
            statusText: response.statusText,
            contentType: response.headers.get('content-type')
        });

        if (!response.ok) {
            // Clone response before reading so we can try multiple parse methods
            const errorText = await response.text();
            log('error', 'Diagnostics API returned error status.', {
                status: response.status,
                statusText: response.statusText,
                bodyPreview: errorText.substring(0, 500)
            });

            let errorData: any;
            try {
                errorData = JSON.parse(errorText);
            } catch (parseError) {
                log('error', 'Failed to parse error response as JSON.', {
                    text: errorText.substring(0, 500)
                });
                // Even if parse fails, create a detailed error message
                const detailedError = `HTTP ${response.status} ${response.statusText}${errorText ? '\n\n' + errorText.substring(0, 500) : ''}`;
                errorData = {
                    error: detailedError,
                    statusCode: response.status,
                    statusText: response.statusText
                };
            }

            // If the error response includes results, use them!
            // The backend may return 200 with error status and results
            if (errorData.results && Array.isArray(errorData.results) && errorData.results.length > 0) {
                log('info', 'Error response includes results, returning them.', {
                    resultsCount: errorData.results.length
                });
                return errorData as DiagnosticsResponse;
            }

            const error = (errorData as any).error ? String((errorData as any).error) : `Server responded with HTTP ${response.status}: ${response.statusText}`;
            log('error', 'Diagnostics API fetch failed.', { status: response.status, error, errorData });

            // Create a detailed error result instead of empty array
            const errorResult = {
                name: 'HTTP Request',
                status: 'error',
                error: error,
                duration: 0,
                details: {
                    httpStatus: response.status,
                    httpStatusText: response.statusText,
                    errorData: errorData
                }
            };

            // Return structured error response WITH a result entry
            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                duration: 0,
                results: [errorResult],  // ALWAYS include at least one result
                summary: {
                    total: 1,
                    success: 0,
                    warnings: 0,
                    errors: 1
                },
                error
            };
        }

        let data;
        try {
            data = await response.json();
            log('info', 'Diagnostics response parsed successfully.', {
                status: response.status,
                hasResults: !!data.results,
                resultsCount: data.results?.length,
                dataStatus: data.status
            });
        } catch (parseError) {
            const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown JSON parse error';
            log('error', 'Failed to parse diagnostics response as JSON.', { error: errorMessage });

            // Create a detailed error result instead of empty array
            const errorResult = {
                name: 'Response Parsing',
                status: 'error',
                error: `Failed to parse response as JSON: ${errorMessage}`,
                duration: 0,
                details: {
                    parseError: errorMessage
                }
            };

            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                duration: 0,
                results: [errorResult],  // ALWAYS include at least one result
                summary: {
                    total: 1,
                    success: 0,
                    warnings: 0,
                    errors: 1
                },
                error: `Failed to parse response: ${errorMessage}`
            };
        }

        return data as DiagnosticsResponse;
    } catch (error) {
        // Provide a more helpful error message for timeout
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                const timeoutError = 'Diagnostics request timed out after 120 seconds. This may indicate the tests are taking too long or the server is unresponsive.';
                log('error', 'Diagnostics timed out.', { error: timeoutError });

                // Create a detailed error result instead of empty array
                const errorResult = {
                    name: 'Request Timeout',
                    status: 'error',
                    error: timeoutError,
                    duration: 120000,
                    details: {
                        timeoutMs: 120000,
                        note: 'The request exceeded the maximum allowed time. Tests may still be running on the server.'
                    }
                };

                return {
                    status: 'error',
                    timestamp: new Date().toISOString(),
                    duration: 120000,
                    results: [errorResult],  // ALWAYS include at least one result
                    summary: {
                        total: 1,
                        success: 0,
                        warnings: 0,
                        errors: 1
                    },
                    error: timeoutError
                };
            }

            log('error', 'Diagnostics encountered an error.', { error: error.message, stack: error.stack });

            // Create a detailed error result instead of empty array
            const errorResult = {
                name: 'Client Error',
                status: 'error',
                error: `${error.message}\n\nError Type: ${error.constructor.name}${error.stack ? '\n\nStack:\n' + error.stack.substring(0, 500) : ''}`,
                duration: 0,
                details: {
                    errorType: error.constructor.name,
                    errorMessage: error.message,
                    stack: error.stack
                }
            };

            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                duration: 0,
                results: [errorResult],  // ALWAYS include at least one result
                summary: {
                    total: 1,
                    success: 0,
                    warnings: 0,
                    errors: 1
                },
                error: error.message
            };
        }
        throw error as Error;
    } finally {
        // Always clear timeout regardless of execution path
        clearTimeout(timeoutId);
    }
};

/**
 * Poll for diagnostic test progress
 * Used for real-time updates while tests are running in parallel
 */
export const getDiagnosticProgress = async (testId: string): Promise<{
    testId: string;
    status: string;
    timestamp: string;
    lastUpdate?: string;
    completedAt?: string;
    progress: {
        total: number;
        completed: number;
        percentage: number;
    };
    results: Array<{
        name: string;
        status: 'success' | 'warning' | 'error' | 'partial' | 'running';
        duration: number;
        details?: Record<string, any>;
        error?: string;
        steps?: any[];
        tests?: any[];
        stages?: any[];
        jobLifecycle?: any[];
    }>;
    completedTests: string[];
    isComplete: boolean;
}> => {
    log('info', 'Polling diagnostic progress.', { testId });

    const response = await fetch(`/.netlify/functions/diagnostics-progress?testId=${encodeURIComponent(testId)}`);

    if (!response.ok) {
        const errorText = await response.text();
        log('error', 'Diagnostic progress poll failed.', {
            status: response.status,
            statusText: response.statusText,
            error: errorText
        });
        throw new Error(`Failed to get diagnostic progress: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    log('info', 'Diagnostic progress received.', {
        testId,
        completed: data.progress?.completed,
        total: data.progress?.total,
        isComplete: data.isComplete
    });

    return data;
};

export const createAnalysisStory = async (title: string, summary: string, timeline: File[], userContext?: string): Promise<AnalysisStory> => {
    log('info', 'Creating analysis story.', { title, summary, timelineCount: timeline.length, hasUserContext: !!userContext });

    const timelinePayload = await Promise.all(timeline.map(async (file) => {
        const image = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });

        return {
            image: image.split(','),
            mimeType: file.type,
            fileName: file.name,
        };
    }));

    return apiFetch<AnalysisStory>('analyze', {
        method: 'POST',
        body: JSON.stringify({
            storyMode: true,
            isAdmin: true, // Story mode is admin-only
            title,
            summary,
            userContext,
            timeline: timelinePayload,
        }),
    });
};

export const uploadStoryPhoto = async (storyId: string, photo: File, caption: string, timestamp: string): Promise<StoryPhoto> => {
    log('info', 'Uploading story photo.', { storyId, caption, timestamp });

    const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(photo);
    });

    return apiFetch<StoryPhoto>(`upload-story-photo?storyId=${storyId}&caption=${caption}&timestamp=${timestamp}`, {
        method: 'POST',
        body: JSON.stringify({ image: image.split(',') }),
    });
};

export interface StoriesResponse {
    items: AnalysisStory[];
    totalItems: number;
    page: number;
    limit: number;
    totalPages: number;
}

export const getStories = async (page = 1, limit = 20): Promise<StoriesResponse> => {
    log('info', 'Fetching stories.', { page, limit });
    return apiFetch<StoriesResponse>(`stories?page=${page}&limit=${limit}`);
};

export const getStory = async (id: string): Promise<AnalysisStory> => {
    log('info', 'Fetching story by ID.', { id });
    return apiFetch<AnalysisStory>(`stories?id=${id}`);
};

export const deleteStory = async (id: string): Promise<{ success: boolean; id: string }> => {
    log('info', 'Deleting story.', { id });
    return apiFetch<{ success: boolean; id: string }>(`stories?id=${id}`, {
        method: 'DELETE',
    });
};

// Admin Stories API Functions
export const getAdminStories = async (page = 1, limit = 20, options: { isActive?: boolean; systemIdentifier?: string; tags?: string } = {}): Promise<AdminStoriesResponse> => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (options.isActive !== undefined) params.append('isActive', String(options.isActive));
    if (options.systemIdentifier) params.append('systemIdentifier', options.systemIdentifier);
    if (options.tags) params.append('tags', options.tags);

    log('info', 'Fetching admin stories.', { page, limit, ...options });
    return apiFetch<AdminStoriesResponse>(`admin-stories?${params.toString()}`);
};

export const getAdminStory = async (id: string): Promise<AdminStory> => {
    log('info', 'Fetching admin story by ID.', { id });
    return apiFetch<AdminStory>(`admin-stories?id=${id}`);
};

export const createAdminStory = async (story: Partial<AdminStory>): Promise<AdminStory> => {
    log('info', 'Creating admin story.', { title: story.title });
    return apiFetch<AdminStory>('admin-stories', {
        method: 'POST',
        body: JSON.stringify(story),
    });
};

export const updateAdminStory = async (id: string, updates: Partial<AdminStory>): Promise<AdminStory> => {
    log('info', 'Updating admin story.', { id });
    return apiFetch<AdminStory>(`admin-stories?id=${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
};

export const deleteAdminStory = async (id: string): Promise<{ success: boolean; id: string }> => {
    log('info', 'Deleting admin story.', { id });
    return apiFetch<{ success: boolean; id: string }>(`admin-stories?id=${id}`, {
        method: 'DELETE',
    });
};

export const addEventToStory = async (storyId: string, event: { analysisId: string; annotation?: string; contextNotes?: { priorEvents?: string; environmentalFactors?: string; maintenanceActions?: string } }): Promise<{ success: boolean; event: any }> => {
    log('info', 'Adding event to story.', { storyId, analysisId: event.analysisId });
    return apiFetch<{ success: boolean; event: any }>(`admin-stories?id=${storyId}&action=add-event`, {
        method: 'POST',
        body: JSON.stringify(event),
    });
};

export const removeEventFromStory = async (storyId: string, eventIndex: number): Promise<{ success: boolean }> => {
    log('info', 'Removing event from story.', { storyId, eventIndex });
    return apiFetch<{ success: boolean }>(`admin-stories?id=${storyId}&action=remove-event&eventIndex=${eventIndex}`, {
        method: 'DELETE',
    });
};

export const checkHashes = async (hashes: string[]): Promise<{ duplicates: { hash: string, data: any }[], upgrades: string[] }> => {
    if (hashes.length === 0) {
        return { duplicates: [], upgrades: [] };
    }
    log('info', 'Checking file hashes against the backend for duplicates and upgrades.', { count: hashes.length });
    try {
        const response = await apiFetch<{ duplicates: { hash: string, data: any }[], upgrades: string[] }>('check-hashes', {
            method: 'POST',
            body: JSON.stringify({ hashes }),
        });
        return {
            duplicates: response.duplicates || [],
            upgrades: response.upgrades || [],
        };
    } catch (error) {
        log('error', 'Failed to check hashes.', { error: error instanceof Error ? error.message : String(error) });
        // In case of error, assume no hashes exist to avoid blocking uploads
        return { duplicates: [], upgrades: [] };
    }
};

/**
 * Run a single diagnostic test using the scope parameter for granular execution
 * This enables real-time updates as individual tests complete
 * 
 * @param testScope - The test name to run (e.g., 'database', 'gemini', 'analyze')
 * @returns Promise with the test result
 */
export const runSingleDiagnosticTest = async (testScope: string): Promise<DiagnosticTestResult> => {
    log('info', 'Running single diagnostic test.', { testScope });

    // Each test can take up to 120 seconds for complex ones like 'analyze' or 'asyncAnalysis'
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 second timeout

    try {
        const headers = {
            'Content-Type': 'application/json',
        } as Record<string, string>;

        // Add Netlify Identity token if available
        if (typeof window !== 'undefined' && (window as any).netlifyIdentity?.currentUser) {
            const token = await (window as any).netlifyIdentity.currentUser()?.jwt();
            if (token) {
                Object.assign(headers, { 'Authorization': `Bearer ${token}` });
            }
        }

        // Use query parameter scope for granular single-test execution
        const response = await fetch(`/.netlify/functions/admin-diagnostics?scope=${encodeURIComponent(testScope)}`, {
            method: 'GET',
            headers,
            signal: controller.signal,
        } as RequestInit);

        log('info', 'Single diagnostic test response received.', {
            testScope,
            status: response.status,
            ok: response.ok
        });

        if (!response.ok) {
            const errorText = await response.text();
            log('error', 'Single diagnostic test API error.', {
                testScope,
                status: response.status,
                errorText: errorText.substring(0, 500)
            });

            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
        }

        const data = await response.json() as DiagnosticsResponse;

        // Extract the single test result from the response
        if (data.results && data.results.length > 0) {
            return data.results[0];
        }

        // If no results, return error
        return {
            name: testScope,
            status: 'error',
            error: 'No result returned from server',
            duration: 0
        };
    } catch (error) {
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                log('error', 'Single diagnostic test timed out.', { testScope });
                return {
                    name: testScope,
                    status: 'error',
                    error: 'Test timed out after 120 seconds',
                    duration: 120000
                };
            }

            log('error', 'Single diagnostic test failed.', {
                testScope,
                error: error.message
            });

            return {
                name: testScope,
                status: 'error',
                error: error.message,
                duration: 0
            };
        }

        return {
            name: testScope,
            status: 'error',
            error: 'Unknown error occurred',
            duration: 0
        };
    } finally {
        clearTimeout(timeoutId);
    }
};

/**
 * Get hourly SOC predictions for a battery system
 * 
 * @param systemId - The ID of the battery system
 * @param hoursBack - Number of hours to predict (default: 72)
 * @returns Promise with hourly SOC predictions
 */
export const getHourlySocPredictions = async (systemId: string, hoursBack: number = 72): Promise<any> => {
    const response = await fetch('/.netlify/functions/get-hourly-soc-predictions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ systemId, hoursBack })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get hourly SOC predictions: ${response.status} ${errorText}`);
    }

    return await response.json();
};

/**
 * Fetch merged timeline data (BMS + Cloud hourly data)
 * Combines BMS screenshot data with hourly cloud data for unified visualization
 */
export interface MergedTimelineResponse {
    systemId: string;
    startDate: string;
    endDate: string;
    totalPoints: number;
    downsampled: boolean;
    data: MergedDataPoint[];
}

export interface MergedDataPoint {
    timestamp: string;
    source: 'bms' | 'cloud' | 'estimated';
    data: {
        stateOfCharge?: number | null;
        overallVoltage?: number | null;
        current?: number | null;
        power?: number | null;
        temperature?: number | null;
        mosTemperature?: number | null;
        cellVoltageDifference?: number | null;
        clouds?: number | null;
        uvi?: number | null;
        temp?: number | null;
        remainingCapacity?: number | null;
        fullCapacity?: number | null;
        // Min/max/avg when downsampled
        stateOfCharge_min?: number;
        stateOfCharge_max?: number;
        stateOfCharge_avg?: number;
        overallVoltage_min?: number;
        overallVoltage_max?: number;
        overallVoltage_avg?: number;
        current_min?: number;
        current_max?: number;
        current_avg?: number;
        power_min?: number;
        power_max?: number;
        power_avg?: number;
        temperature_min?: number;
        temperature_max?: number;
        temperature_avg?: number;
        [key: string]: number | string | null | undefined;
    };
    recordId?: string;
    fileName?: string;
    dataPoints?: number; // Number of points in bucket when downsampled
    timestampLast?: string; // Last timestamp in bucket when downsampled
}

export const getMergedTimelineData = async (
    systemId: string,
    startDate: string,
    endDate: string,
    downsample: boolean = false,
    maxPoints: number = 2000
): Promise<MergedTimelineResponse> => {
    log('info', 'Fetching merged timeline data', { systemId, startDate, endDate, downsample });

    const params = new URLSearchParams({
        merged: 'true',
        systemId,
        startDate,
        endDate,
        downsample: downsample ? 'true' : 'false',
        maxPoints: maxPoints.toString()
    });

    const response = await fetch(`/.netlify/functions/history?${params}`, {
        method: 'GET'
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch merged timeline data: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    log('info', 'Merged timeline data received', {
        totalPoints: data.totalPoints,
        downsampled: data.downsampled
    });

    return data;
};

