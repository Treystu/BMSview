/**
 * Admin Preferences Service
 * 
 * Saves and loads admin preferences to localStorage for persistence.
 * Includes chart configuration, view preferences, and other admin settings.
 */

const PREFERENCES_KEY = 'bmsview_admin_preferences';

export type MetricKey = 'stateOfCharge' | 'overallVoltage' | 'current' | 'temperature' | 'power' | 'cellVoltageDifference' | 'clouds' | 'uvi' | 'temp' | 'soh' | 'mosTemperature' | 'solarPower' | 'irradiance';
export type Axis = 'left' | 'right';
export type ChartView = 'timeline' | 'hourly' | 'predictive';

export interface ChartPreferences {
    metricConfig: Partial<Record<MetricKey, { axis: Axis }>>;
    chartView: ChartView;
    hourlyMetric: MetricKey;
    averagingEnabled: boolean;
    manualBucketSize: string | null;
    bandEnabled: boolean;
    defaultSystemId?: string;
    defaultDateRangeDays?: number;
}

export interface AdminPreferences {
    chart: ChartPreferences;
    dashboard: {
        defaultTab?: string;
        itemsPerPage?: number;
        showReconciliation?: boolean;
        showCostDashboard?: boolean;
    };
    updatedAt: string;
}

const DEFAULT_CHART_PREFERENCES: ChartPreferences = {
    metricConfig: {
        stateOfCharge: { axis: 'left' },
        power: { axis: 'right' },
    },
    chartView: 'timeline',
    hourlyMetric: 'power',
    averagingEnabled: true,
    manualBucketSize: null,
    bandEnabled: false,
    defaultDateRangeDays: 7,
};

const DEFAULT_PREFERENCES: AdminPreferences = {
    chart: DEFAULT_CHART_PREFERENCES,
    dashboard: {
        defaultTab: 'history',
        itemsPerPage: 100,
        showReconciliation: true,
        showCostDashboard: true,
    },
    updatedAt: new Date().toISOString(),
};

/**
 * Load admin preferences from localStorage
 */
export function loadAdminPreferences(): AdminPreferences {
    try {
        const stored = localStorage.getItem(PREFERENCES_KEY);
        if (!stored) {
            return DEFAULT_PREFERENCES;
        }
        const parsed = JSON.parse(stored) as Partial<AdminPreferences>;
        // Merge with defaults to ensure all fields exist
        return {
            ...DEFAULT_PREFERENCES,
            ...parsed,
            chart: {
                ...DEFAULT_CHART_PREFERENCES,
                ...parsed.chart,
            },
            dashboard: {
                ...DEFAULT_PREFERENCES.dashboard,
                ...parsed.dashboard,
            },
        };
    } catch (error) {
        console.warn('[AdminPreferences] Failed to load preferences:', error);
        return DEFAULT_PREFERENCES;
    }
}

/**
 * Save admin preferences to localStorage
 */
export function saveAdminPreferences(preferences: Partial<AdminPreferences>): void {
    try {
        const current = loadAdminPreferences();
        const updated: AdminPreferences = {
            ...current,
            ...preferences,
            chart: {
                ...current.chart,
                ...preferences.chart,
            },
            dashboard: {
                ...current.dashboard,
                ...preferences.dashboard,
            },
            updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated));
        console.log('[AdminPreferences] Preferences saved:', updated);
    } catch (error) {
        console.error('[AdminPreferences] Failed to save preferences:', error);
    }
}

/**
 * Save chart preferences specifically
 */
export function saveChartPreferences(chartPrefs: Partial<ChartPreferences>): void {
    const current = loadAdminPreferences();
    saveAdminPreferences({
        chart: {
            ...current.chart,
            ...chartPrefs,
        },
    });
}

/**
 * Load chart preferences specifically
 */
export function loadChartPreferences(): ChartPreferences {
    return loadAdminPreferences().chart;
}

/**
 * Reset preferences to defaults
 */
export function resetAdminPreferences(): void {
    try {
        localStorage.removeItem(PREFERENCES_KEY);
        console.log('[AdminPreferences] Preferences reset to defaults');
    } catch (error) {
        console.error('[AdminPreferences] Failed to reset preferences:', error);
    }
}

/**
 * Get default chart preferences
 */
export function getDefaultChartPreferences(): ChartPreferences {
    return { ...DEFAULT_CHART_PREFERENCES };
}
