import type { AdminStoriesResponse, AdminStory, AnalysisData, AnalysisRecord, AnalysisStory, BmsSystem, InsightMode, WeatherData } from '../types';
import { InsightMode as InsightModeEnum } from '../types';
import { calculateSystemAnalytics } from '../utils/analytics';

// Type definitions for analytics data
export interface HourlyAverages {
    hour: number;
    metrics: Record<string, {
        avg?: number;
        avgCharge?: number;
        avgDischarge?: number;
        min?: number;
        max?: number;
    }>;
}

export interface PerformanceBaseline {
    sunnyDayChargingAmpsByHour: Array<{
        hour: number;
        avgCurrent: number;
        dataPoints: number;
    }>;
}

export interface AlertEventStats {
    alert: string;              // Normalized alert text
    count: number;              // Number of distinct events
    totalDurationMinutes: number; // Total duration of all events
    avgDurationMinutes: number; // Average duration per event
    firstSeen: string;          // ISO Timestamp
    lastSeen: string;           // ISO Timestamp
}

export interface AlertAnalysis {
    events: AlertEventStats[];
    totalEvents: number;
    totalDurationMinutes: number;
}

export interface SystemAnalytics {
    hourlyAverages: HourlyAverages[];
    performanceBaseline: PerformanceBaseline;
    alertAnalysis: AlertAnalysis;
}

// Import shared type or define compatible shape
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    totalItems?: number;
    count?: number;
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
        ? globalThis.__BMSVIEW_DISABLE_CACHE
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
        } catch {
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
        netlifyIdentity?: {
            currentUser?: () => { jwt?: () => Promise<string> } | null;
        };
    }
    interface GlobalThis {
        __BMSVIEW_DISABLE_CACHE?: boolean;
    }
}

// In-memory short-lived cache and in-flight dedupe map
const _cache = new Map<string, { data: unknown; expires: number }>();
const _inFlight = new Map<string, Promise<unknown>>();

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
        const data = await apiFetch<unknown>(endpoint);
        // Pass through raw data - let caller handle normalization
        _cache.set(key, { data, expires: Date.now() + ttl });
        return data as T;
    })().finally(() => _inFlight.delete(key));

    _inFlight.set(key, p as Promise<unknown>);
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

// Simple in-memory cache for systems/history pages
const _systemsPageCache = new Map<string, PaginatedResponse<BmsSystem>>();
const _historyPageCache = new Map<string, PaginatedResponse<AnalysisRecord>>();

async function getCachedSystemsPage(page: number, limit: number | 'all'): Promise<PaginatedResponse<BmsSystem> | null> {
    if (!isLocalCacheEnabled()) {
        recordCacheDisabledSkip();
        return null;
    }

    const key = `systems:${page}:${limit}`;
    const cached = _systemsPageCache.get(key);
    if (cached) {
        recordCacheHit('systems');
        return cached;
    }
    return null;
}

async function getCachedHistoryPage(page: number, limit: number | 'all'): Promise<PaginatedResponse<AnalysisRecord> | null> {
    if (!isLocalCacheEnabled()) {
        recordCacheDisabledSkip();
        return null;
    }

    const key = `history:${page}:${limit}`;
    const cached = _historyPageCache.get(key);
    if (cached) {
        recordCacheHit('history');
        return cached;
    }
    return null;
}

function setCachedSystemsPage(page: number, limit: number | 'all', data: PaginatedResponse<BmsSystem>): void {
    if (!isLocalCacheEnabled()) return;
    const key = `systems:${page}:${limit}`;
    _systemsPageCache.set(key, data);
}

function setCachedHistoryPage(page: number, limit: number | 'all', data: PaginatedResponse<AnalysisRecord>): void {
    if (!isLocalCacheEnabled()) return;
    const key = `history:${page}:${limit}`;
    _historyPageCache.set(key, data);
}

// Simple logger for client service
const log = (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
        console[level](`[clientService] ${message}`, context);
    }
};

// Optional: expose cache control for debugging
export const setCacheDisabled = (disabled: boolean) => {
    if (typeof window !== 'undefined') {
        try {
            if (disabled) {
                window.localStorage?.setItem('bmsview:disableCache', 'true');
            } else {
                window.localStorage?.removeItem('bmsview:disableCache');
            }
        } catch {
            // Fall back to global override if localStorage not accessible
        }

        if (typeof globalThis !== 'undefined') {
            globalThis.__BMSVIEW_DISABLE_CACHE = disabled;
        }

        metrics.cache.mode = detectCacheMode();
        log('info', 'Updated local cache override.', {
            disabled,
            cacheMode: metrics.cache.mode
        });
    }

    // Expose on window for debugging
    if (typeof window !== 'undefined') {
        window.__BMSVIEW_STATS = getClientServiceMetrics();
        window.__BMSVIEW_GET_STATS = getClientServiceMetrics;
        window.__BMSVIEW_RESET_STATS = resetClientServiceMetrics;
        window.__BMSVIEW_SET_CACHE_DISABLED = setCacheDisabled;
    }

    log('info', 'Client service instrumentation attached to window.', {
        cacheMode: metrics.cache.mode
    });
};

// Default implementation using fetch
async function defaultApiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
        if (typeof window !== 'undefined' && window.netlifyIdentity?.currentUser) {
            const user = window.netlifyIdentity.currentUser();
            if (user?.jwt) {
                const token = await user.jwt();
                if (token) {
                    Object.assign(headers, { 'Authorization': `Bearer ${token}` });
                }
            }
        }

        const response = await fetch(`/.netlify/functions/${endpoint}`, {
            ...options,
            // Add cache control for GET requests to prevent stale data.
            cache: isGet ? 'no-store' : undefined,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorData: unknown;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = {
                    error: errorText || `HTTP ${response.status}`,
                    status: response.status,
                    statusText: response.statusText
                };
            }
            const error = (typeof errorData === 'object' && errorData && 'error' in errorData && typeof errorData.error === 'string')
                ? errorData.error
                : `Server responded with status: ${response.status}`;
            log('error', 'API fetch failed.', { ...logContext, status: response.status, error });
            throw new Error(error);
        }

        // For 204 No Content or other methods that might not return a body
        const contentLength = response.headers?.get?.('content-length') ?? null;
        if (response.status === 204 || contentLength === '0') {
            log('info', 'API fetch successful with no content.', { ...logContext, status: response.status });
            return null as T;
        }

        const data = await response.json();
        log('info', 'API fetch successful.', { ...logContext, status: response.status });
        return data as T;

    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log('error', 'API fetch error.', { ...logContext, error: err.message });
        recordCacheFailure();
        throw err;
    }
}

// Mutable implementation reference used by all helpers
let _apiFetchImpl: <T>(endpoint: string, options?: RequestInit) => Promise<T> = defaultApiFetch;

// Generic fetch helper, exported for use in any client-side component.
export function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    // Preserve exact arity for tests: if only endpoint is provided, do not pass a second arg
    if (arguments.length < 2) {
        return _apiFetchImpl<T>(endpoint);
    }
    return _apiFetchImpl<T>(endpoint, options);
}

export const getRegisteredSystems = async (page = 1, limit: number | 'all' = 100, options: FetchListOptions = {}): Promise<PaginatedResponse<BmsSystem>> => {
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
        ? await apiFetch<PaginatedResponse<BmsSystem>>(`systems?page=${page}&limit=${limit}`)
        : await fetchWithCache<PaginatedResponse<BmsSystem>>(`systems?page=${page}&limit=${limit}`, 10_000);

    let result: PaginatedResponse<BmsSystem> = { items: [], total: 0 };

    if (Array.isArray(response)) {
        result = {
            items: [...response],
            total: response.length
        };
    } else if (response && typeof response === 'object') {
        const totalCandidates = [response.total, response.totalItems, response.count];
        const totalItems = totalCandidates.find(value => typeof value === 'number' && Number.isFinite(value));
        result = {
            items: Array.isArray(response.items) ? response.items : [],
            total: totalItems || 0
        };
    }

    setCachedSystemsPage(page, limit, result);
    return result;
};

export const getAnalysisHistory = async (page = 1, limit: number | 'all' = 100, options: FetchListOptions = {}): Promise<PaginatedResponse<AnalysisRecord>> => {
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
        ? await apiFetch<PaginatedResponse<AnalysisRecord>>(`history?page=${page}&limit=${limit}`)
        : await fetchWithCache<PaginatedResponse<AnalysisRecord>>(`history?page=${page}&limit=${limit}`, 5_000);

    let result: PaginatedResponse<AnalysisRecord> = { items: [], total: 0 };

    if (Array.isArray(response)) {
        result = { items: response, total: response.length };
    } else if (response && typeof response === 'object') {
        const items = Array.isArray(response.items) ? response.items : [];
        const totalCandidates = [response.total, response.totalItems, response.count];
        const totalItems = totalCandidates.find(value => typeof value === 'number' && Number.isFinite(value));
        result = {
            items,
            total: totalItems || 0
        };
    }

    setCachedHistoryPage(page, limit, result);
    return result;
};

// --- Helper functions for insights generation ---

const formatInitialSummary = (summary: unknown): string => {
    if (!summary) return '';
    const obj = typeof summary === 'object' ? summary : null;
    const parts: string[] = ['🤖 Initializing Advanced Insights Generation..\n'];
    if (obj && 'mode' in obj && typeof obj.mode === 'string') {
        parts.push(`📊 Mode: ${obj.mode}`);
    }
    if (obj && 'contextSize' in obj && typeof obj.contextSize === 'number') {
        parts.push(`📚 Context: ${obj.contextSize.toLocaleString()} tokens`);
    }
    if (obj && 'estimatedDuration' in obj && typeof obj.estimatedDuration === 'string') {
        parts.push(`⏱️ ETA: ${obj.estimatedDuration}`);
    }
    if (obj && 'generated' in obj && typeof obj.generated === 'string') {
        parts.push(`\n${obj.generated}`);
    }
    parts.push('\n⏳ Querying historical data and analyzing trends..\n');
    return parts.filter(p => p).join('\n');
};

const formatContextSummary = (summary: unknown): string => {
    if (!summary || typeof summary !== 'object') {
        return '';
    }
    const obj = summary as Record<string, unknown>;
    const lines: string[] = ['🧠 Guru Context Primer:\n'];

    if (obj.systemProfile && typeof obj.systemProfile === 'object') {
        const profile = obj.systemProfile as Record<string, unknown>;
        const profilePieces: string[] = [];
        if (typeof profile.name === 'string') profilePieces.push(profile.name);
        if (typeof profile.chemistry === 'string') profilePieces.push(profile.chemistry);
        if (typeof profile.voltage === 'number') {
            profilePieces.push(`${profile.voltage.toFixed(1)}V`);
        }
        if (profilePieces.length > 0) {
            lines.push(`• System: ${profilePieces.join(' | ')}`);
        }
    }

    if (obj.snapshot && typeof obj.snapshot === 'object') {
        const snapshot = obj.snapshot as Record<string, unknown>;
        const snapshotBits: string[] = [];
        if (typeof snapshot.voltage === 'number') snapshotBits.push(`${snapshot.voltage.toFixed(2)}V`);
        if (typeof snapshot.current === 'number') snapshotBits.push(`${snapshot.current.toFixed(1)}A`);
        if (typeof snapshot.soc === 'number') snapshotBits.push(`${snapshot.soc.toFixed(1)}% SOC`);
        if (snapshotBits.length > 0) {
            lines.push(`• Live snapshot: ${snapshotBits.join(' | ')}`);
        }
    }

    if (obj.energyBudget && typeof obj.energyBudget === 'object') {
        const budget = obj.energyBudget as Record<string, unknown>;
        const budgetParts: string[] = [];
        if (typeof budget.solarSufficiency === 'number') {
            budgetParts.push(`Solar ${budget.solarSufficiency.toFixed(0)}%`);
        }
        if (typeof budget.autonomyDays === 'number') {
            budgetParts.push(`${budget.autonomyDays.toFixed(1)} days autonomy`);
        }
        if (budgetParts.length > 0) {
            lines.push(`• Energy budget: ${budgetParts.join(' | ')}`);
        }
    }

    if (obj.predictions && typeof obj.predictions === 'object') {
        const predictions = obj.predictions as Record<string, unknown>;
        if (predictions.capacity && typeof predictions.capacity === 'object') {
            const capacity = predictions.capacity as Record<string, unknown>;
            const predPieces: string[] = [];
            if (typeof capacity.degradationAhPerDay === 'number') {
                predPieces.push(`${capacity.degradationAhPerDay.toFixed(2)} Ah/day fade`);
            }
            if (typeof capacity.daysToThreshold === 'number') {
                predPieces.push(`${capacity.daysToThreshold} days to threshold`);
            }
            if (predPieces.length > 0) {
                lines.push(`• Forecast: ${predPieces.join(' | ')}`);
            }
        }
        if (typeof predictions.lifetimeMonths === 'number') {
            lines.push(`• Remaining life: ${predictions.lifetimeMonths} months`);
        }
    }

    if (obj.anomalies && typeof obj.anomalies === 'object') {
        const anomalies = obj.anomalies as Record<string, unknown>;
        if (typeof anomalies.total === 'number') {
            const anomalyParts: string[] = [`${anomalies.total} anomalies`];
            if (typeof anomalies.highSeverity === 'number') {
                anomalyParts.push(`${anomalies.highSeverity} high severity`);
            }
            lines.push(`• Anomalies: ${anomalyParts.join(' | ')}`);
        }
    }

    if (obj.weather && typeof obj.weather === 'object') {
        const weather = obj.weather as Record<string, unknown>;
        const weatherBits: string[] = [];
        if (typeof weather.temp === 'number') weatherBits.push(`${weather.temp.toFixed(1)}°C`);
        if (typeof weather.clouds === 'number') weatherBits.push(`${weather.clouds.toFixed(0)}% clouds`);
        if (typeof weather.uvi === 'number') weatherBits.push(`UVI ${weather.uvi.toFixed(1)}`);
        if (weatherBits.length > 0) {
            lines.push(`• Weather: ${weatherBits.join(' | ')}`);
        }
    }

    if (obj.recentSnapshots && typeof obj.recentSnapshots === 'object') {
        const snaps = obj.recentSnapshots as Record<string, unknown>;
        const snapshotMeta: string[] = [];
        if (typeof snaps.count === 'number') {
            snapshotMeta.push(`${snaps.count} samples`);
        }
        if (typeof snaps.netSocDelta === 'number') {
            snapshotMeta.push(`ΔSOC ${snaps.netSocDelta >= 0 ? '+' : ''}${snaps.netSocDelta.toFixed(1)}%`);
        }
        if (typeof snaps.netAhDelta === 'number') {
            snapshotMeta.push(`ΔAh ${snaps.netAhDelta >= 0 ? '+' : ''}${snaps.netAhDelta.toFixed(2)}`);
        }
        if (typeof snaps.alertCount === 'number' && snaps.alertCount > 0) {
            snapshotMeta.push(`${snaps.alertCount} alerts`);
        }
        if (snapshotMeta.length > 0) {
            lines.push(`• Recent logs: ${snapshotMeta.join(' | ')}`);
        }
    }

    if (obj.meta && typeof obj.meta === 'object') {
        const meta = obj.meta as Record<string, unknown>;
        if (typeof meta.contextBuildMs === 'number') {
            lines.push(`• Context build time: ${Math.round(meta.contextBuildMs)} ms${meta.truncated ? ' (truncated)' : ''}`);
        }
    }

    const filtered = lines.filter(Boolean);
    if (filtered.length <= 1) {
        return '';
    }

    return filtered.join('\n') + '\n';
};

const pollInsightsJobCompletion = async (
    jobId: string,
    onChunk: (chunk: string) => void,
    onError: (error: Error) => void,
    maxAttempts: number = 600,
    initialInterval: number = 2000,
    initialContextSummary?: unknown,
    contextWindowDays?: number
): Promise<void> => {
    const attempts = 0;
    let lastProgressCount = 0;
    let currentInterval = initialInterval;
    const maxInterval = 10000;
    const backoffMultiplier = 1.3;
    let contextSummarySent = false;
    const pollingStartTime = Date.now();

    const emitContextSummary = (summary: unknown) => {
        if (!summary || contextSummarySent) {
            return;
        }
        contextSummarySent = true;
        const formatted = formatContextSummary(summary);
        if (formatted) {
            onChunk(formatted);
        }
    };

    emitContextSummary(initialContextSummary);

    return new Promise((resolve, reject) => {
        const poll = async () => {
            try {
                const response = await fetch('/.netlify/functions/generate-insights-status', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ jobId }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Status check failed: ${response.status} ${errorText}`);
                }

                const status = await response.json();

                // Emit context summary if available
                if (status.contextSummary) {
                    emitContextSummary(status.contextSummary);
                }

                // Emit any new progress chunks
                if (status.progress && Array.isArray(status.progress)) {
                    const newChunks = status.progress.slice(lastProgressCount);
                    newChunks.forEach((chunk: unknown) => {
                        if (typeof chunk === 'string') {
                            onChunk(chunk);
                        }
                    });
                    lastProgressCount = status.progress.length;
                }

                if (status.status === 'completed') {
                    onChunk('\n\n✅ Analysis Complete!\n');
                    resolve();
                    return;
                }

                if (status.status === 'failed') {
                    const errorMessage = status.error || 'Analysis failed';
                    onChunk(`\n\n❌ ${errorMessage}\n`);
                    onError(new Error(errorMessage));
                    reject(new Error(errorMessage));
                    return;
                }

                // Continue polling with backoff
                currentInterval = Math.min(currentInterval * backoffMultiplier, maxInterval);
                setTimeout(poll, currentInterval);
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));

                // "Starter Motor" approach: Log network errors but keep polling
                // Only reject on catastrophic errors (404, 403, 401)
                let status: number | undefined = undefined;
                if (error && typeof error === 'object' && 'response' in error) {
                    const resp = (error as { response?: { status?: number } }).response;
                    if (typeof resp?.status === 'number') {
                        status = resp.status;
                    }
                } else if (error && typeof error === 'object' && 'status' in error) {
                    const st = (error as { status?: number }).status;
                    if (typeof st === 'number') {
                        status = st;
                    }
                }

                const isCatastrophic = status === 404 || status === 403 || status === 401;

                if (isCatastrophic) {
                    log('error', 'Catastrophic error polling insights job status', {
                        jobId,
                        error: error.message,
                        status
                    });
                    onError(error);
                    reject(error);
                    return;
                }

                // For network errors, continue polling with exponential backoff
                log('warn', 'Network error polling insights job status, retrying...', {
                    jobId,
                    error: error.message,
                    attempt: attempts + 1
                });

                currentInterval = Math.min(currentInterval * backoffMultiplier, maxInterval);
                setTimeout(poll, currentInterval);
            }
        };

        // Start polling
        poll();
    });
};

const formatProgressEvent = (event: unknown): string => {
    if (!event || typeof event !== 'object') return '';
    const ev = event as Record<string, unknown>;
    switch (ev.type) {
        case 'checkpoint':
            return typeof ev.message === 'string' ? ev.message : '';
        case 'error':
            return typeof ev.message === 'string' ? `❌ ${ev.message}` : '';
        case 'context':
            return typeof ev.message === 'string' ? ev.message : '';
        default:
            return typeof ev.message === 'string' ? ev.message : '';
    }
};

const formatInsightsObject = (insights: unknown): string => {
    if (typeof insights === 'string') return insights;
    if (!insights || typeof insights !== 'object') return '';
    const obj = insights as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.summary === 'string') {
        parts.push(obj.summary);
    }
    if (Array.isArray(obj.recommendations)) {
        obj.recommendations.forEach((r: unknown, i: number) => {
            if (typeof r === 'string') {
                parts.push(`${i + 1}. ${r}`);
            }
        });
    }
    if (typeof obj.nextSteps === 'string') {
        parts.push(`🔧 Next Steps:\n${obj.nextSteps}`);
    }

    return parts.join('\n\n');
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
): Promise<{ jobId: string; initialSummary: unknown; status: string }> => {
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
        const initialSummary = formatInitialSummary(result.initialSummary);

        return {
            jobId: result.jobId,
            initialSummary,
            status: result.status
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
export const getInsightsJobStatus = async (jobId: string): Promise<unknown> => {
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
            const errorText = await response.text();
            throw new Error(`Failed to get job status: ${response.status} ${errorText}`);
        }

        return response.json();
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log('error', 'Failed to get insights job status', { jobId, error: error.message });
        throw error;
    }
};

/**
 * Stream insights generation with real-time updates
 */
export const streamInsights = async (
    payload: {
        analysisData: AnalysisData;
        systemId?: string;
        customPrompt?: string;
        useEnhancedMode?: boolean;
        contextWindowDays?: number;
        maxIterations?: number;
        modelOverride?: string;
        insightMode?: InsightMode;
        consentGranted?: boolean;
        recentHistory?: AnalysisRecord[];
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

    const contextSummarySent = false;

    // Check if we are passing client-side history to bridge the sync gap
    const hasRecentHistory = Array.isArray(payload.recentHistory) && payload.recentHistory.length > 0;

    // CRITICAL: Backend timeout configuration
    const MAX_RESUME_ATTEMPTS = 60;
    let resumeJobId: string | undefined = undefined;
    let attemptCount = 0;
    const lastErrorDetails: { code?: string; message?: string; status?: number } | null = null;

    log('info', 'Streaming insights from server.', {
        systemId: payload.systemId,
        hasCustomPrompt: !!payload.customPrompt,
        useEnhancedMode: payload.useEnhancedMode,
        contextWindowDays: payload.contextWindowDays,
        maxIterations: payload.maxIterations,
        modelOverride: payload.modelOverride,
        insightMode: mode,
        dataStructure: payload.analysisData ? Object.keys(payload.analysisData) : 'none',
        hasRecentHistory,
        recentHistoryCount: hasRecentHistory ? payload.recentHistory!.length : 0
    });

    // Iterative retry loop to avoid stack overflow with many attempts
    const startTime = Date.now();
    try {
        while (attemptCount < MAX_RESUME_ATTEMPTS) {
            attemptCount++;
            const attemptStartTime = Date.now();

            // This is MUCH shorter than the old 90s since each backend attempt is now only ~20s
            const controller = new AbortController();
            const REQUEST_TIMEOUT_MS = 30000;
            const timeoutId = setTimeout(() => {
                controller.abort();
                log('warn', `Insights request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
            }, REQUEST_TIMEOUT_MS);

            try {
                // Build request body with resumeJobId if available
                const requestBody: Record<string, unknown> = {
                    ...payload,
                    insightMode: mode,
                    mode: 'sync'
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

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorData: unknown;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch {
                        errorData = { error: errorText || `HTTP ${response.status}` };
                    }
                    const errorMessage = (typeof errorData === 'object' && errorData && 'error' in errorData && typeof errorData.error === 'string')
                        ? errorData.error
                        : `Server responded with status: ${response.status}`;
                    log('error', 'Insights request failed.', {
                        attempt: attemptCount,
                        status: response.status,
                        error: errorMessage
                    });
                    throw new Error(errorMessage);
                }

                const data = await response.json();
                log('info', 'Insights request successful.', {
                    attempt: attemptCount,
                    duration: Date.now() - attemptStartTime
                });

                // Handle successful response
                if (data.status === 'completed') {
                    onChunk(formatInsightsObject(data.insights));
                    onComplete();
                    return;
                }

                if (data.status === 'failed') {
                    const errorMessage = data.error || 'Analysis failed';
                    onChunk(`\n\n❌ ${errorMessage}\n`);
                    onError(new Error(errorMessage));
                    return;
                }

                // If we get here, we need to resume with the jobId
                if (data.jobId) {
                    resumeJobId = data.jobId;
                    log('info', 'Received resume jobId, continuing...', {
                        attempt: attemptCount,
                        jobId: data.jobId
                    });
                    continue;
                }

                // Unexpected response format
                throw new Error('Unexpected response format from insights service');
            } catch (error) {
                clearTimeout(timeoutId);

                if (error instanceof Error && error.name === 'AbortError') {
                    log('warn', 'Insights request timed out, will resume...', {
                        attempt: attemptCount,
                        elapsed: Date.now() - startTime
                    });
                    continue;
                }

                const err = error instanceof Error ? error : new Error(String(error));
                log('error', 'Insights request error, will retry...', {
                    attempt: attemptCount,
                    error: err.message,
                    elapsed: Date.now() - startTime
                });

                // For network errors, continue with retry
                if (attemptCount >= MAX_RESUME_ATTEMPTS) {
                    throw err;
                }

                // Brief delay before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // If we exhaust all attempts
        throw new Error(`Insights generation failed after ${MAX_RESUME_ATTEMPTS} attempts`);
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log('error', 'Insights generation failed after retries', {
            error: err.message,
            attemptCount
        });
        onError(err);
    }
};

// Helper to select endpoint based on mode
function selectEndpointForMode(mode: InsightMode): string {
    // All modes currently use the with-tools endpoint
    return '/.netlify/functions/generate-insights-with-tools';
}

// --- Additional utility functions ---

export const getRecentHistory = async (systemId?: string, limit = 10): Promise<AnalysisRecord[]> => {
    log('info', 'Fetching recent analysis history.', { systemId, limit });
    try {
        const response = await apiFetch<AnalysisRecord[]>(
            systemId
                ? `history?systemId=${systemId}&limit=${limit}&sortBy=timestamp&sortOrder=desc`
                : `history?limit=${limit}&sortBy=timestamp&sortOrder=desc`
        );

        // Handle both array and paginated response formats
        if (Array.isArray(response)) {
            return response;
        }

        if (response && typeof response === 'object' && 'items' in response) {
            const resp = response as Record<string, unknown>;
            if (Array.isArray(resp.items)) {
                return resp.items as AnalysisRecord[];
            }
        }

        return [];
    } catch (error) {
        log('warn', 'Failed to retrieve recent history from local cache.', { error: String(error) });
        return [];
    }
};

export const getRecentHistoryForSystem = async (systemId: string, limit = 10): Promise<AnalysisRecord[]> => {
    return getRecentHistory(systemId, limit);
};

export const getSystemAnalytics = async (_systemId: string): Promise<SystemAnalytics> => {
    const history = await getAnalysisHistory(1, 'all', { strategy: FetchStrategy.FORCE_FRESH });
    return calculateSystemAnalytics(history.items);
};

export const getJobStatuses = async (jobIds: string[]): Promise<unknown[]> => {
    if (jobIds.length === 0) return [];
    log('info', 'Fetching job statuses.', { count: jobIds.length });
    return apiFetch<unknown[]>(`get-job-status?ids=${jobIds.join(',')}`);
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
    hardware_id: string;
    record_count: number;
    first_seen: string;
    last_seen: string;
    status: 'MATCHED' | 'ORPHAN';
    system_id: string | null;
    system_name: string | null;
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
    return fetchWithCache<DataIntegrityResponse>('admin-data-integrity', 60_000);
};

export const getHourlyWeather = async (lat: number, lon: number, date: string): Promise<unknown[]> => {
    log('info', 'Fetching hourly weather data.', { lat, lon, date });
    return apiFetch<unknown[]>('weather', {
        method: 'POST',
        body: JSON.stringify({ lat, lon, timestamp: date, type: 'hourly' }),
    });
};

export interface DiagnosticTestResult {
    name: string;
    status: 'success' | 'warning' | 'error' | 'partial' | 'running';
    message?: string;
    details?: Record<string, unknown>;
    duration?: number;
}

export interface DiagnosticsResponse {
    summary: {
        total: number;
        passed: number;
        warnings: number;
        errors: number;
        skipped: number;
    };
    tests: DiagnosticTestResult[];
    timestamp: string;
}

export const runDiagnostics = async (selectedTests?: string[]): Promise<DiagnosticsResponse> => {
    log('info', 'Running system diagnostics.', { selectedTests });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
        const headers = {
            'Content-Type': 'application/json',
        } as Record<string, string>;

        if (typeof window !== 'undefined' && window.netlifyIdentity?.currentUser) {
            const user = window.netlifyIdentity.currentUser();
            if (user?.jwt) {
                const token = await user.jwt();
                if (token) {
                    Object.assign(headers, { 'Authorization': `Bearer ${token}` });
                }
            }
        }

        const response = await fetch('/.netlify/functions/admin-diagnostics', {
            method: 'POST',
            headers,
            body: JSON.stringify({ selectedTests }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Diagnostics failed: ${response.status} ${errorText}`);
        }

        return response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        const err = error instanceof Error ? error : new Error(String(error));
        log('error', 'Diagnostics request failed.', { error: err.message });
        throw err;
    }
};

export const getDiagnosticProgress = async (testId: string): Promise<{
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    message?: string;
    result?: unknown;
}> => {
    log('info', 'Fetching diagnostic progress.', { testId });
    return apiFetch(`diagnostic-progress?testId=${testId}`);
};

export interface StoriesResponse {
    stories: AnalysisStory[];
    total: number;
    page: number;
    limit: number;
}

export const getStories = async (page = 1, limit = 20): Promise<StoriesResponse> => {
    log('info', 'Fetching analysis stories.', { page, limit });
    return apiFetch(`stories?page=${page}&limit=${limit}`);
};

export const getStory = async (id: string): Promise<AnalysisStory> => {
    log('info', 'Fetching analysis story.', { id });
    return apiFetch(`stories/${id}`);
};

export const deleteStory = async (id: string): Promise<{ success: boolean; id: string }> => {
    log('info', 'Deleting analysis story.', { id });
    return apiFetch(`stories/${id}`, { method: 'DELETE' });
};

export const getAdminStories = async (page = 1, limit = 20, options: { isActive?: boolean; systemIdentifier?: string; tags?: string } = {}): Promise<AdminStoriesResponse> => {
    log('info', 'Fetching admin stories.', { page, limit, options });
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (options.isActive !== undefined) params.append('isActive', String(options.isActive));
    if (options.systemIdentifier) params.append('systemIdentifier', options.systemIdentifier);
    if (options.tags) params.append('tags', options.tags);
    return apiFetch(`admin/stories?${params}`);
};

export const getAdminStory = async (id: string): Promise<AdminStory> => {
    log('info', 'Fetching admin story.', { id });
    return apiFetch(`admin/stories/${id}`);
};

export const createAdminStory = async (story: Partial<AdminStory>): Promise<AdminStory> => {
    log('info', 'Creating admin story.', { title: story.title });
    return apiFetch('admin/stories', {
        method: 'POST',
        body: JSON.stringify(story),
    });
};

export const updateAdminStory = async (id: string, updates: Partial<AdminStory>): Promise<AdminStory> => {
    log('info', 'Updating admin story.', { id });
    return apiFetch(`admin/stories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
};

export const deleteAdminStory = async (id: string): Promise<{ success: boolean; id: string }> => {
    log('info', 'Deleting admin story.', { id });
    return apiFetch(`admin/stories/${id}`, { method: 'DELETE' });
};

export const addEventToStory = async (storyId: string, event: { analysisId: string; annotation?: string; contextNotes?: { priorEvents?: string; environmentalFactors?: string; maintenanceActions?: string } }): Promise<{ success: boolean; event: unknown }> => {
    log('info', 'Adding event to story.', { storyId });
    return apiFetch(`stories/${storyId}/events`, {
        method: 'POST',
        body: JSON.stringify(event),
    });
};

export const removeEventFromStory = async (storyId: string, eventIndex: number): Promise<{ success: boolean }> => {
    log('info', 'Removing event from story.', { storyId, eventIndex });
    return apiFetch(`stories/${storyId}/events/${eventIndex}`, { method: 'DELETE' });
};

export const checkHashes = async (hashes: string[]): Promise<{ duplicates: { hash: string, data: unknown }[], upgrades: string[] }> => {
    log('info', 'Checking for duplicate hashes.', { count: hashes.length });
    return apiFetch('check-hashes', {
        method: 'POST',
        body: JSON.stringify({ hashes }),
    });
};

export const runSingleDiagnosticTest = async (testScope: string): Promise<DiagnosticTestResult> => {
    log('info', 'Running single diagnostic test.', { testScope });
    return apiFetch('run-diagnostic', {
        method: 'POST',
        body: JSON.stringify({ testScope }),
    });
};

export const getHourlySocPredictions = async (systemId: string, hoursBack: number = 72): Promise<unknown> => {
    log('info', 'Fetching hourly SOC predictions.', { systemId, hoursBack });
    return apiFetch(`predictions/hourly-soc?systemId=${systemId}&hoursBack=${hoursBack}`);
};

export interface MergedTimelineResponse {
    items: MergedDataPoint[];
    total: number;
    systemId: string;
    dateRange: { start: string; end: string };
}

export interface MergedDataPoint {
    timestamp: string;
    type: 'analysis' | 'weather';
    data: AnalysisRecord | WeatherData;
}

export const getMergedTimelineData = async (
    systemId: string,
    options: {
        startDate?: string;
        endDate?: string;
        includeWeather?: boolean;
        page?: number;
        limit?: number;
    } = {}
): Promise<MergedTimelineResponse> => {
    const params = new URLSearchParams();
    if (options.startDate) params.append('startDate', options.startDate);
    if (options.endDate) params.append('endDate', options.endDate);
    if (options.includeWeather !== undefined) params.append('includeWeather', String(options.includeWeather));
    if (options.page) params.append('page', String(options.page));
    if (options.limit) params.append('limit', String(options.limit));

    log('info', 'Fetching merged timeline data.', { systemId, options });
    return apiFetch(`systems/${systemId}/merged-timeline?${params}`);
};

export const syncWeather = async (systemId: string, startDate: string, endDate: string): Promise<void> => {
    log('info', 'Triggering weather sync.', { systemId, startDate, endDate });
    await apiFetch('sync-weather', {
        method: 'POST',
        body: JSON.stringify({ systemId, startDate, endDate }),
    });
};

export interface UnifiedTimelinePoint {
    type: 'analysis' | 'weather';
    timestamp: string;
    data: AnalysisRecord | WeatherData;
}

export const getUnifiedHistory = async (systemId: string): Promise<UnifiedTimelinePoint[]> => {
    log('info', 'Fetching unified history.', { systemId });
    const isAllData = systemId === '__ALL__';
    let historyRecords: AnalysisRecord[] = [];
    let weatherRecords: WeatherData[] = [];

    if (!isAllData) {
        [historyRecords, weatherRecords] = await Promise.all([
            getAnalysisHistory(1, 'all', { strategy: FetchStrategy.FORCE_FRESH }).then(r => r.items),
            // Fallback: use empty array if syncManager method doesn't exist
            Promise.resolve([])
        ]);
    }

    const unified: UnifiedTimelinePoint[] = [
        ...historyRecords.map(r => ({ type: 'analysis' as const, timestamp: r.timestamp, data: r })),
        ...weatherRecords.map(w => ({ type: 'weather' as const, timestamp: (w as { timestamp?: string; time?: string }).timestamp || (w as { timestamp?: string; time?: string }).time || '', data: w }))
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    log('info', `Unified timeline generated.`, {
        total: unified.length,
        history: historyRecords.length,
        weather: weatherRecords.length,
        isAllData
    });

    return unified;
};

// Additional exports needed by AdminDashboard
export const streamAllHistory = async (onData: (records: AnalysisRecord[]) => void, onComplete: () => void): Promise<void> => {
    log('info', 'Starting smart history sync.');
    try {
        const response = await apiFetch<AnalysisRecord[]>('history?limit=all');
        onData(response);
        onComplete();
    } catch (error) {
        log('error', 'Failed to stream history', { error: String(error) });
        onComplete();
    }
};

export const updateBmsSystem = async (systemId: string, updates: Partial<BmsSystem>): Promise<void> => {
    await apiFetch(`systems/${systemId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
};

export const mergeBmsSystems = async (primarySystemId: string, idsToMerge: string[]): Promise<void> => {
    await apiFetch('systems/merge', {
        method: 'POST',
        body: JSON.stringify({ primarySystemId, idsToMerge }),
    });
};

export const findDuplicateAnalysisSets = async (): Promise<AnalysisRecord[][]> => {
    return apiFetch('analysis/find-duplicates');
};

export const deleteAnalysisRecords = async (recordIds: string[]): Promise<void> => {
    await apiFetch('analysis/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ recordIds }),
    });
};

export const deleteUnlinkedAnalysisHistory = async (): Promise<void> => {
    await apiFetch('analysis/cleanup-unlinked', { method: 'POST' });
};

export const deleteAnalysisRecord = async (recordId: string): Promise<void> => {
    await apiFetch(`analysis/${recordId}`, { method: 'DELETE' });
};

export const linkAnalysisToSystem = async (recordId: string, systemId: string, hardwareSystemId?: string | null): Promise<void> => {
    await apiFetch('analysis/link-to-system', {
        method: 'POST',
        body: JSON.stringify({ recordId, systemId, hardwareSystemId }),
    });
};

export const countRecordsNeedingWeather = async (): Promise<{ count: number }> => {
    return apiFetch('analysis/count-needs-weather');
};

export const normalizeIds = async (limit: number = 1000): Promise<{ normalized: number; errors: string[] }> => {
    return apiFetch(`analysis/normalize-ids?limit=${limit}`);
};

export const fixPowerSigns = async (): Promise<{ fixed: number; errors: string[] }> => {
    return apiFetch('analysis/fix-power-signs');
};

export const createAnalysisStory = async (storyData: Partial<AnalysisStory>): Promise<AnalysisStory> => {
    return apiFetch('stories', {
        method: 'POST',
        body: JSON.stringify(storyData),
    });
};

export const clearAllData = async (): Promise<void> => {
    await apiFetch('admin/clear-all-data', { method: 'POST' });
};

export const clearHistoryStore = async (): Promise<{ message: string; details: unknown }> => {
    return apiFetch('admin/clear-history-store', { method: 'POST' });
};

export const registerBmsSystem = async (systemData: Partial<BmsSystem>): Promise<BmsSystem> => {
    return apiFetch('systems', {
        method: 'POST',
        body: JSON.stringify(systemData),
    });
};

export const associateHardwareIdToSystem = async (hardwareId: string, systemId: string): Promise<void> => {
    await apiFetch('systems/associate-hardware', {
        method: 'POST',
        body: JSON.stringify({ hardwareId, systemId }),
    });
};
