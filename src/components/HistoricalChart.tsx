import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadChartPreferences, saveChartPreferences } from '../services/adminPreferences';
import { getHourlySocPredictions, getSystemAnalytics, getUnifiedHistory, syncWeather, SystemAnalytics, type UnifiedTimelinePoint } from '../services/clientService';
import type { AnalysisRecord, BmsSystem } from '../types';
import { calculateSystemAnalytics } from '../utils/analytics';
import AlertAnalysis from './admin/AlertAnalysis';
import SpinnerIcon from './icons/SpinnerIcon';

// Error Boundary to prevent chart crashes from breaking the entire page
interface ChartErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ChartErrorBoundary extends Component<{ children: React.ReactNode; onRetry?: () => void }, ChartErrorBoundaryState> {
    constructor(props: { children: React.ReactNode; onRetry?: () => void }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[HistoricalChart] Error caught by boundary:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
        this.props.onRetry?.();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center h-96 bg-gray-900/50 rounded-lg p-8 text-center">
                    <div className="text-red-400 text-lg font-medium mb-2">Chart Error</div>
                    <p className="text-gray-400 mb-4 max-w-md">
                        An error occurred while rendering the chart. This may be due to data processing issues.
                    </p>
                    <p className="text-gray-500 text-sm mb-4 font-mono">
                        {this.state.error?.message || 'Unknown error'}
                    </p>
                    <button
                        onClick={this.handleRetry}
                        className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-white rounded-md transition-colors"
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

type MetricKey = 'stateOfCharge' | 'overallVoltage' | 'current' | 'temperature' | 'power' | 'cellVoltageDifference' | 'clouds' | 'uvi' | 'temp' | 'soh' | 'mosTemperature' | 'solarPower' | 'irradiance';
type Axis = 'left' | 'right';
type ChartView = 'timeline' | 'hourly' | 'predictive';

// Annotation interface for alert markers
export interface ChartAnnotation {
    timestamp: string;
    type: 'critical' | 'warning' | 'info';
    message: string;
}

type ChartAnomaly = {
    type: 'critical' | 'warning';
    message: string;
    key: MetricKey;
};

type ChartPoint = {
    timestamp: string;
    recordCount: number;
    anomalies: ChartAnomaly[];
    source: 'bms' | 'weather' | 'cloud' | 'estimated' | 'interpolated';
    [key: string]: unknown;
};

type TimeLabel = {
    x: number;
    label: string;
    hour: number;
};

interface PredictiveSocMetadata {
    actualHours?: number;
    predictedHours?: number;
    coveragePercent?: number;
    avgDischargeRatePerHour?: number;
    avgChargeRatePerHour?: number;
    actualDataPoints?: number;
    timeRange?: {
        start?: string;
        end?: string;
    };
}

type PredictiveSocData = {
    predictions: Array<{
        timestamp: string;
        predicted: number;
        actual?: number;
    }>;
    metadata?: PredictiveSocMetadata;
};

type ChartDimensions = {
    WIDTH: number;
    CHART_HEIGHT: number;
    BRUSH_HEIGHT: number;
    MARGIN: { top: number; right: number; bottom: number; left: number };
    chartWidth: number;
    chartHeight: number;
    totalHeight: number;
};

type TimelineData = {
    dataLODs: Record<string, ChartPoint[]>;
    xScale: ((time: string | number) => number) & { invert: (px: number) => number };
    xMin: number;
    xMax: number;
    averagingConfig: {
        enabled: boolean;
        manualBucketSize: string | null;
        autoBucketKey: string;
    };
};

type YAxisTick = { value: number; y: number };

type PathSegment = { d: string; source: string; color: string };

type MetricPath = { key: MetricKey; segments: PathSegment[]; color: string };

type BandSegment = {
    x: number;
    min: number;
    max: number;
    yScale: (val: number) => number;
    bandwidth: number;
    timestamp: string;
};

type MetricBand = { key: MetricKey; segments: BandSegment[]; color: string };

type RenderedAnomaly = ChartAnomaly & { timestamp: string; y: number };

type SvgComputed = {
    paths: MetricPath[];
    anomalies: RenderedAnomaly[];
    bands: MetricBand[];
    cloudAreaPath: string;
    yScaleLeft: (val: number) => number;
    yTicksLeft: YAxisTick[];
    yAxisLabelLeft: string;
    yScaleRight: (val: number) => number;
    yTicksRight: YAxisTick[];
    yAxisLabelRight: string;
};

const getPointNumber = (point: ChartPoint, key: string): number | null => {
    const value = point[key];
    return typeof value === 'number' ? value : null;
};

// Optional props for admin features
export interface HistoricalChartProps {
    systems: BmsSystem[];
    history: AnalysisRecord[];
    enableAdminFeatures?: boolean; // Enable admin-specific functionality
    showSolarOverlay?: boolean; // Show solar data overlay
    annotations?: ChartAnnotation[]; // Alert annotations
    onZoomDomainChange?: (startTime: number, endTime: number) => void; // Callback when zoom/pan changes visible domain
}

const METRICS: Record<MetricKey, {
    label: string;
    unit: string;
    color: string;
    multiplier?: number;
    source: 'analysis' | 'weather';
    group: 'Battery' | 'Weather' | 'Health' | 'Solar';
    anomaly?: (value: number) => { type: 'critical' | 'warning', message: string } | null;
}> = {
    stateOfCharge: { label: 'SOC', unit: '%', color: '#34d399', source: 'analysis', group: 'Battery', anomaly: (val) => val < 20 ? { type: 'warning', message: `Warning: SOC is low (${val.toFixed(1)}%)` } : null },
    overallVoltage: { label: 'Voltage', unit: 'V', color: '#fbbf24', source: 'analysis', group: 'Battery' },
    current: { label: 'Current', unit: 'A', color: '#60a5fa', source: 'analysis', group: 'Battery' },
    power: { label: 'Power', unit: 'W', color: '#c084fc', source: 'analysis', group: 'Battery' },
    temperature: { label: 'Batt Temp', unit: '°C', color: '#f87171', source: 'analysis', group: 'Battery', anomaly: (val) => val > 45 ? { type: 'critical', message: `CRITICAL: Battery temp is high (${val.toFixed(1)}°C)` } : null },
    mosTemperature: { label: 'MOS Temp', unit: '°C', color: '#fca5a5', source: 'analysis', group: 'Battery', anomaly: (val) => val > 80 ? { type: 'critical', message: `CRITICAL: MOS temp is high (${val.toFixed(1)}°C)` } : null },
    cellVoltageDifference: { label: 'Cell Diff', unit: 'mV', color: '#a3a3a3', multiplier: 1000, source: 'analysis', group: 'Battery', anomaly: (val) => val > 0.1 ? { type: 'critical', message: `CRITICAL: Cell difference is high (${(val * 1000).toFixed(0)}mV)` } : null },
    clouds: { label: 'Clouds', unit: '%', color: '#94a3b8', source: 'weather', group: 'Weather' },
    uvi: { label: 'UV Index', unit: '', color: '#fde047', source: 'weather', group: 'Weather' },
    temp: { label: 'Air Temp', unit: '°C', color: '#a78bfa', source: 'weather', group: 'Weather' },
    irradiance: { label: 'Irradiance', unit: 'W/m²', color: '#fbbf24', source: 'weather', group: 'Weather' },
    soh: { label: 'SOH', unit: '%', color: '#ec4899', source: 'analysis', group: 'Health', anomaly: (val) => val < 80 ? { type: 'critical', message: `CRITICAL: State of Health is low (${val.toFixed(1)}%)` } : null },
    solarPower: { label: 'Solar', unit: 'W', color: '#fbbf24', source: 'analysis', group: 'Solar' },
};

const METRIC_COLOR_CLASSES: Record<MetricKey, { text: string; bg: string; accent: string }> = {
    stateOfCharge: { text: 'text-[#34d399]', bg: 'bg-[#34d399]', accent: 'accent-[#34d399]' },
    overallVoltage: { text: 'text-[#fbbf24]', bg: 'bg-[#fbbf24]', accent: 'accent-[#fbbf24]' },
    current: { text: 'text-[#60a5fa]', bg: 'bg-[#60a5fa]', accent: 'accent-[#60a5fa]' },
    temperature: { text: 'text-[#f87171]', bg: 'bg-[#f87171]', accent: 'accent-[#f87171]' },
    power: { text: 'text-[#c084fc]', bg: 'bg-[#c084fc]', accent: 'accent-[#c084fc]' },
    cellVoltageDifference: { text: 'text-[#a3a3a3]', bg: 'bg-[#a3a3a3]', accent: 'accent-[#a3a3a3]' },
    clouds: { text: 'text-[#94a3b8]', bg: 'bg-[#94a3b8]', accent: 'accent-[#94a3b8]' },
    uvi: { text: 'text-[#fde047]', bg: 'bg-[#fde047]', accent: 'accent-[#fde047]' },
    temp: { text: 'text-[#a78bfa]', bg: 'bg-[#a78bfa]', accent: 'accent-[#a78bfa]' },
    irradiance: { text: 'text-[#fbbf24]', bg: 'bg-[#fbbf24]', accent: 'accent-[#fbbf24]' },
    soh: { text: 'text-[#ec4899]', bg: 'bg-[#ec4899]', accent: 'accent-[#ec4899]' },
    mosTemperature: { text: 'text-[#fca5a5]', bg: 'bg-[#fca5a5]', accent: 'accent-[#fca5a5]' },
    solarPower: { text: 'text-[#fbbf24]', bg: 'bg-[#fbbf24]', accent: 'accent-[#fbbf24]' },
};

const HOURLY_METRICS: MetricKey[] = ['power', 'current', 'stateOfCharge', 'temperature', 'mosTemperature', 'cellVoltageDifference', 'overallVoltage', 'clouds', 'irradiance', 'soh', 'solarPower'];


const METRIC_GROUPS = Object.entries(METRICS).reduce((acc, [key, metric]) => {
    if (!acc[metric.group]) acc[metric.group] = [];
    acc[metric.group].push(key as MetricKey);
    return acc;
}, {} as Record<string, MetricKey[]>);

const mapRecordToPoint = (r: AnalysisRecord, ratedCapacity?: number | null) => {
    const point: ChartPoint = { timestamp: r.timestamp, recordCount: 1, anomalies: [], source: 'bms' };
    Object.keys(METRICS).forEach(m => {
        const metric = m as MetricKey;
        const { source, multiplier = 1, anomaly } = METRICS[metric];
        let value: unknown;

        // Special handling for metrics with different names or derived values
        if (metric === 'irradiance') {
            value = r.weather?.estimated_irradiance_w_m2 ?? null;
        } else if (metric === 'solarPower') {
            value = r.analysis?.power ?? null; // Map solarPower UI metric to BMS power field
        } else if (metric === 'soh') {
            // SOH (State of Health) calculation
            const fullCap = r.analysis?.fullCapacity;
            if (ratedCapacity && ratedCapacity > 0 && typeof fullCap === 'number' && fullCap > 0) {
                value = (fullCap / ratedCapacity) * 100;
            } else {
                value = null;
            }
        } else {
            if (source === 'analysis') {
                const analysisObj = r.analysis as unknown as Record<string, unknown> | null | undefined;
                value = analysisObj?.[metric];
            } else {
                const weatherObj = r.weather as unknown as Record<string, unknown> | undefined;
                value = weatherObj?.[metric];
            }
        }

        if (value != null && typeof value === 'number') {
            const finalValue = value * multiplier;
            point[metric] = finalValue;
            if (anomaly) {
                const anomalyResult = anomaly(value); // Anomaly check on original value
                if (anomalyResult) point.anomalies.push({ ...anomalyResult, key: metric });
            }
        } else {
            point[metric] = null;
        }
    });
    return point;
};

/**
 * Convert merged data point to chart point format
 */
/**
 * Convert unified point to chart point format
 */
const mapUnifiedPointToChartPoint = (p: UnifiedTimelinePoint, ratedCapacity?: number | null) => {
    // If it's already an analysis record, map it normally
    if (p.type === 'analysis') {
        return mapRecordToPoint(p.data as AnalysisRecord, ratedCapacity);
    }

    // It is a weather point
    const weather = p.data;
    const point: ChartPoint = {
        timestamp: p.timestamp,
        recordCount: 1,
        anomalies: [],
        source: 'weather'
    };

    Object.keys(METRICS).forEach(m => {
        const metric = m as MetricKey;
        const { source, multiplier = 1 } = METRICS[metric];

        let value;
        // Weather points only provide weather metrics (and estimated irradiance)
        if (metric === 'irradiance') {
            const weatherObj = weather as unknown as Record<string, unknown>;
            value = weatherObj.estimated_irradiance_w_m2 ?? null;
        } else if (source === 'weather') {
            const weatherObj = weather as unknown as Record<string, unknown>;
            value = weatherObj[metric];
        } else {
            value = null; // Battery metrics are null for weather-only points
        }

        if (value != null && typeof value === 'number') {
            point[metric] = value * multiplier;
        } else {
            point[metric] = null;
        }
    });

    return point;
};

const aggregateData = (data: ChartPoint[], bucketMinutes: number): ChartPoint[] => {
    if (bucketMinutes <= 0) return data;

    const bucketMillis = bucketMinutes * 60 * 1000;
    const buckets = new Map<number, ChartPoint[]>();
    data.forEach(r => {
        const timestamp = r.timestamp;
        const key = Math.floor(new Date(timestamp).getTime() / bucketMillis) * bucketMillis;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(r);
    });

    return Array.from(buckets.entries()).map(([key, bucket]) => {
        const avgPoint: ChartPoint = {
            timestamp: new Date(key).toISOString(),
            recordCount: bucket.length,
            anomalies: [],
            source: bucket[0].source || 'bms' // Preserve source from first point in bucket
        };
        Object.keys(METRICS).forEach(m => {
            const metric = m as MetricKey;
            const { multiplier = 1, anomaly } = METRICS[metric];

            // Get values from bucket, handling both old (analysis/weather) and new (data) formats
            const values = bucket.map(r => {
                // Chart points already have multiplier applied
                const rawValue = getPointNumber(r, metric);
                return rawValue != null ? rawValue : null;
            }).filter((v): v is number => v != null);

            if (values.length > 0) {
                const avgValue = values.reduce((a, v) => a + v, 0) / values.length;
                avgPoint[metric] = avgValue; // Already has multiplier applied

                // Calculate min/max for bands
                avgPoint[`${metric}_min`] = Math.min(...values);
                avgPoint[`${metric}_max`] = Math.max(...values);

                if (anomaly) {
                    // Reverse multiplier for anomaly check since avgValue already has it applied
                    const anomalyResult = anomaly(avgValue / multiplier);
                    if (anomalyResult) avgPoint.anomalies.push({ ...anomalyResult, key: metric });
                }
            } else {
                avgPoint[metric] = null;
            }
        });
        return avgPoint;
    });
};

const ChartControls: React.FC<{
    systems: BmsSystem[];
    selectedSystemId: string;
    setSelectedSystemId: (id: string) => void;
    startDate: string;
    setStartDate: (date: string) => void;
    endDate: string;
    setEndDate: (date: string) => void;
    metricConfig: Partial<Record<MetricKey, { axis: Axis }>>;
    setMetricConfig: React.Dispatch<React.SetStateAction<Partial<Record<MetricKey, { axis: Axis }>>>>;
    onResetView: () => void;
    hasChartData: boolean;
    zoomPercentage: number;
    setZoomPercentage: (zoom: number) => void;
    chartView: ChartView;
    setChartView: (view: ChartView) => void;
    hourlyMetric: MetricKey;
    setHourlyMetric: (metric: MetricKey) => void;
    averagingEnabled: boolean;
    setAveragingEnabled: (enabled: boolean) => void;
    manualBucketSize: string | null;
    setManualBucketSize: (size: string | null) => void;
    bandEnabled: boolean;
    setBandEnabled: (enabled: boolean) => void;
    onSavePreferences?: () => void;
    preferencesSaved?: boolean;
}> = ({ systems, selectedSystemId, setSelectedSystemId, startDate, setStartDate, endDate, setEndDate, metricConfig, setMetricConfig, onResetView, hasChartData, zoomPercentage, setZoomPercentage, chartView, setChartView, hourlyMetric, setHourlyMetric, averagingEnabled, setAveragingEnabled, manualBucketSize, setManualBucketSize, bandEnabled, setBandEnabled, onSavePreferences, preferencesSaved }) => {
    const [isMetricConfigOpen, setIsMetricConfigOpen] = useState(false);
    const metricConfigRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (metricConfigRef.current && !metricConfigRef.current.contains(event.target as Node)) {
                setIsMetricConfigOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleMetricConfigChange = (metric: MetricKey, config?: { axis: Axis }) => {
        setMetricConfig(prev => {
            const next = { ...prev };
            if (config) next[metric] = config;
            else delete next[metric];
            return next;
        });
    };

    return (
        <div className="flex flex-col gap-4 mb-6 p-4 bg-gray-900/50 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                {/* System Select */}
                <div className="lg:col-span-1">
                    <label htmlFor="system-select-chart" className="block text-sm font-medium text-gray-300 mb-1">System</label>
                    <select id="system-select-chart" value={selectedSystemId} onChange={(e) => setSelectedSystemId(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary">
                        <option value="">-- Select a System --</option>
                        <option value="__ALL__">📊 All Data (Combined)</option>
                        {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </div>
                {/* View Select */}
                <div className="lg:col-span-1">
                    <label htmlFor="view-select-chart" className="block text-sm font-medium text-gray-300 mb-1">Chart View</label>
                    <select id="view-select-chart" value={chartView} onChange={(e) => setChartView(e.target.value as ChartView)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary">
                        <option value="timeline">Timeline</option>
                        <option value="hourly">Hourly Averages</option>
                        <option value="predictive">Predictive SOC Model (72hr)</option>
                    </select>
                </div>
                {/* Hourly Metric Select */}
                {chartView === 'hourly' && (
                    <div className="lg:col-span-1">
                        <label htmlFor="hourly-metric-select" className="block text-sm font-medium text-gray-300 mb-1">Metric</label>
                        <select id="hourly-metric-select" value={hourlyMetric} onChange={(e) => setHourlyMetric(e.target.value as MetricKey)}
                            className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary">
                            {HOURLY_METRICS.map(key => (
                                <option key={key} value={key}>{METRICS[key].label}</option>
                            ))}
                        </select>
                    </div>
                )}
                {/* Date Pickers */}
                <div className="lg:col-span-1">
                    <label htmlFor="start-date" className="block text-sm font-medium text-gray-300 mb-1">Start Time</label>
                    <input type="datetime-local" id="start-date" value={startDate} onChange={e => setStartDate(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary" />
                </div>
                <div className="lg:col-span-1">
                    <label htmlFor="end-date" className="block text-sm font-medium text-gray-300 mb-1">End Time</label>
                    <input type="datetime-local" id="end-date" value={endDate} onChange={e => setEndDate(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-secondary focus:border-secondary" />
                </div>
                {/* Zoom Control */}
                {chartView === 'timeline' && (
                    <div className="lg:col-span-1">
                        <label htmlFor="zoom-percentage" className="block text-sm font-medium text-gray-300 mb-1">Zoom (%)</label>
                        <div className="flex items-center">
                            <button type="button" onClick={() => setZoomPercentage(zoomPercentage / 1.2)} className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-l-md transition-colors">-</button>
                            <input
                                type="number"
                                id="zoom-percentage"
                                value={zoomPercentage.toFixed(1)}
                                onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val) && val >= 0.1) {
                                        setZoomPercentage(val);
                                    }
                                }}
                                onBlur={e => {
                                    if (e.target.value === '' || parseFloat(e.target.value) < 0.1) setZoomPercentage(100);
                                }}
                                min="0.1"
                                step="10"
                                className="w-full text-center bg-gray-700 border-y border-gray-600 p-2 text-white focus:ring-secondary focus:border-secondary [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button type="button" onClick={() => setZoomPercentage(zoomPercentage * 1.2)} className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-r-md transition-colors">+</button>
                        </div>
                    </div>
                )}
            </div>
            <div className="flex justify-end items-center gap-4 mt-4">
                {hasChartData && <button onClick={onResetView} className="text-sm text-secondary hover:underline">Reset View</button>}
                {chartView === 'timeline' && (
                    <>
                        {/* Data Averaging Controls */}
                        <div className="flex items-center gap-3 border-r border-gray-600 pr-4">
                            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={averagingEnabled}
                                    onChange={(e) => {
                                        setAveragingEnabled(e.target.checked);
                                        if (!e.target.checked) setManualBucketSize(null);
                                    }}
                                    className="form-checkbox h-4 w-4 bg-gray-700 border-gray-600 text-secondary focus:ring-secondary"
                                />
                                <span>Data Averaging</span>
                            </label>
                            {averagingEnabled && (
                                <select
                                    value={manualBucketSize || 'auto'}
                                    onChange={(e) => setManualBucketSize(e.target.value === 'auto' ? null : e.target.value)}
                                    aria-label="Averaging interval"
                                    title="Averaging interval"
                                    className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-secondary focus:border-secondary"
                                >
                                    <option value="auto">Auto (Zoom-based)</option>
                                    <option value="raw">No Averaging</option>
                                    <option value="5">5 Minutes</option>
                                    <option value="15">15 Minutes</option>
                                    <option value="60">1 Hour</option>
                                    <option value="240">4 Hours</option>
                                    <option value="1440">1 Day</option>
                                </select>
                            )}
                        </div>
                        {/* Bands Toggle */}
                        <div className="flex items-center gap-3 border-r border-gray-600 pr-4">
                            <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={bandEnabled}
                                    onChange={(e) => setBandEnabled(e.target.checked)}
                                    className="form-checkbox h-4 w-4 bg-gray-700 border-gray-600 text-secondary focus:ring-secondary"
                                />
                                <span>Min/Max Bands</span>
                            </label>
                        </div>

                        {/* Save Preferences Button */}
                        {onSavePreferences && (
                            <button
                                onClick={onSavePreferences}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${preferencesSaved
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-600 hover:bg-gray-500 text-white'
                                    }`}
                                title="Save current chart configuration as default"
                            >
                                {preferencesSaved ? '✓ Saved' : '💾 Save as Default'}
                            </button>
                        )}

                        <div className="relative" ref={metricConfigRef}>
                            <button onClick={() => setIsMetricConfigOpen(o => !o)} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition-colors">Configure Metrics</button>
                            {isMetricConfigOpen && (
                                <div className="absolute top-full right-0 mt-2 w-96 rounded-md shadow-lg bg-gray-800 ring-1 ring-black ring-opacity-5 z-20 p-4 max-h-96 overflow-y-auto">
                                    <div className="space-y-3">
                                        {Object.entries(METRIC_GROUPS).map(([groupName, metrics]) => (
                                            <div key={groupName}>
                                                <h4 className="font-semibold text-gray-300 text-sm mb-2">{groupName}</h4>
                                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                                    {metrics.map(key => {
                                                        const config = metricConfig[key];
                                                        return (
                                                            <div key={key}>
                                                                <label className="flex items-center space-x-2 text-sm text-white cursor-pointer select-none">
                                                                    <input type="checkbox" checked={!!config} onChange={(e) => handleMetricConfigChange(key, e.target.checked ? { axis: 'left' } : undefined)}
                                                                        className={`form-checkbox h-4 w-4 bg-gray-800 border-gray-600 text-secondary focus:ring-secondary focus:ring-offset-gray-800 ${METRIC_COLOR_CLASSES[key].accent}`} />
                                                                    <span className={METRIC_COLOR_CLASSES[key].text}>{METRICS[key].label}</span>
                                                                </label>
                                                                {config && (
                                                                    <div className="text-xs flex items-center space-x-3 mt-1 pl-6">
                                                                        <label className="flex items-center space-x-1 cursor-pointer text-gray-400"><input type="radio" name={`${key}-axis`} value="left" checked={config.axis === 'left'} onChange={() => handleMetricConfigChange(key, { axis: 'left' })} className="form-radio h-3 w-3 bg-gray-900 border-gray-600 text-secondary focus:ring-secondary" /><span>Left</span></label>
                                                                        <label className="flex items-center space-x-1 cursor-pointer text-gray-400"><input type="radio" name={`${key}-axis`} value="right" checked={config.axis === 'right'} onChange={() => handleMetricConfigChange(key, { axis: 'right' })} className="form-radio h-3 w-3 bg-gray-900 border-gray-600 text-secondary focus:ring-secondary" /><span>Right</span></label>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const SvgChart: React.FC<{
    chartData: TimelineData;
    metricConfig: Partial<Record<MetricKey, { axis: Axis }>>;
    hiddenMetrics: Set<MetricKey>;
    viewBox: { x: number; width: number };
    setViewBox: React.Dispatch<React.SetStateAction<{ x: number, width: number }>>;
    chartDimensions: ChartDimensions;
    bandEnabled?: boolean;
    annotations?: ChartAnnotation[];
    showSolarOverlay?: boolean;
}> = ({ chartData, metricConfig, hiddenMetrics, viewBox, setViewBox, chartDimensions, bandEnabled = false, annotations = [], showSolarOverlay = false }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; point: ChartPoint } | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);

    const interactionState = useRef({
        isPanning: false,
        isBrushPanning: false,
        isBrushResizing: null as 'left' | 'right' | null,
        panStart: { x: 0, y: 0 },
        viewBoxStart: { x: 0, width: 0 }
    }).current;

    const {
        dataLODs, xScale, xMin, xMax, averagingConfig
    } = chartData;
    const {
        WIDTH, CHART_HEIGHT, BRUSH_HEIGHT, MARGIN, chartWidth, chartHeight, totalHeight
    } = chartDimensions;

    const dataToRender = useMemo<ChartPoint[]>(() => {
        if (!dataLODs || !dataLODs['raw']) return [];
        if (!averagingConfig.enabled) return dataLODs['raw'];
        const bucketKey = averagingConfig.manualBucketSize ? String(averagingConfig.manualBucketSize) : averagingConfig.autoBucketKey;
        if (bucketKey === 'raw') return dataLODs['raw'];
        return dataLODs[bucketKey] || dataLODs['raw'] || [];
    }, [dataLODs, averagingConfig]);

    const zoomRatio = chartWidth / viewBox.width;
    const showDataPoints = zoomRatio > 100; // Show points when very zoomed in

    useEffect(() => {
        if (!tooltip || !tooltipRef.current) return;
        const el = tooltipRef.current;
        el.style.left = `${tooltip.x + MARGIN.left}px`;
        el.style.top = `${tooltip.y}px`;
        el.style.transform = tooltip.x > chartWidth * 0.6
            ? 'translate(calc(-100% - 15px), 15px)'
            : 'translate(15px, 15px)';
    }, [tooltip, chartWidth, MARGIN.left]);

    // Define standard gradients for metrics


    const {
        paths, anomalies, bands, cloudAreaPath,
        yScaleLeft, yTicksLeft, yAxisLabelLeft,
        yScaleRight, yTicksRight, yAxisLabelRight
    } = useMemo<SvgComputed>(() => {
        const activeMetrics = Object.entries(metricConfig).map(([key, config]) => ({ key: key as MetricKey, axis: config!.axis }));
        const leftMetrics = activeMetrics.filter(m => m.axis === 'left').map(m => m.key);
        const rightMetrics = activeMetrics.filter(m => m.axis === 'right').map(m => m.key);

        const calculateYAxis = (keys: MetricKey[]) => {
            if (keys.length === 0 || !dataToRender || dataToRender.length === 0) return { scale: () => 0, ticks: [], label: '' };
            let yMin = Infinity, yMax = -Infinity;
            keys.forEach(key => dataToRender.forEach((d) => {
                const value = getPointNumber(d, key);
                if (value != null) {
                    yMin = Math.min(yMin, value);
                    yMax = Math.max(yMax, value);
                }
            }));
            if (yMin === Infinity) return { scale: () => 0, ticks: [], label: '' };
            const buffer = (yMax - yMin) * 0.1 || 1;
            const scaleMin = yMin - buffer, scaleMax = yMax + buffer;
            const scale = (val: number) => chartHeight - (((val - scaleMin) / (scaleMax - scaleMin)) * chartHeight);
            const ticks = Array.from({ length: 6 }, (_, i) => scaleMin + i * (scaleMax - scaleMin) / 5).map(v => ({ value: v, y: scale(v) }));
            return { scale, ticks, label: [...new Set(keys.map(k => METRICS[k].unit))].join(' / ') };
        };

        const { scale: yScaleLeft, ticks: yTicksLeft, label: yAxisLabelLeft } = calculateYAxis(leftMetrics);
        const { scale: yScaleRight, ticks: yTicksRight, label: yAxisLabelRight } = calculateYAxis(rightMetrics);

        const paths = activeMetrics.map(({ key, axis }): MetricPath | null => {
            const yScale = axis === 'left' ? yScaleLeft : yScaleRight;
            if (!yScale) return null;

            const pointAtKey = (p: ChartPoint) => getPointNumber(p, key) ?? 0;

            // Group consecutive points by source type to create path segments
            const segments: PathSegment[] = [];
            let currentSegment: ChartPoint[] = [];
            let currentSource = '';
            let lastPointOfPrevSegment: ChartPoint | null = null; // Track last point to stitch segments

            // Filter nulls first
            const validData = dataToRender.filter((d) => getPointNumber(d, key) != null);

            validData.forEach((d) => {
                const pointSource = d.source || 'bms';

                if (currentSource !== pointSource && currentSegment.length > 0) {
                    // Source changed, finish current segment
                    const pathData = currentSegment.map((p, pIdx) =>
                        `${pIdx === 0 ? 'M' : 'L'} ${xScale(p.timestamp).toFixed(2)} ${yScale(pointAtKey(p)).toFixed(2)}`
                    ).join(' ');
                    segments.push({ d: pathData, source: currentSource, color: METRICS[key].color });

                    // Capture last point for stitching
                    lastPointOfPrevSegment = currentSegment[currentSegment.length - 1];
                    currentSegment = [];
                }

                // If starting a new segment and we have a previous point, add it as anchor
                // This ensures visual continuity (no gaps) between different sources
                if (currentSegment.length === 0 && lastPointOfPrevSegment) {
                    currentSegment.push(lastPointOfPrevSegment);
                }

                currentSegment.push(d);
                currentSource = pointSource;
            });

            // Add final segment
            if (currentSegment.length > 0) {
                const pathData = currentSegment.map((p, pIdx) =>
                    `${pIdx === 0 ? 'M' : 'L'} ${xScale(p.timestamp).toFixed(2)} ${yScale(pointAtKey(p)).toFixed(2)}`
                ).join(' ');
                segments.push({ d: pathData, source: currentSource, color: METRICS[key].color });
            }

            return { key, segments, color: METRICS[key].color };
        }).filter((p): p is MetricPath => p !== null);

        // Calculate min/max bands for each metric using bucket-local min/max
        const bands: MetricBand[] = bandEnabled ? activeMetrics.map(({ key, axis }): MetricBand | null => {
            const yScale = axis === 'left' ? yScaleLeft : yScaleRight;
            if (!yScale) return null;

            const filteredData = dataToRender.filter((d) => getPointNumber(d, key) != null);
            if (filteredData.length === 0) return null;

            // Create band segments using localized min/max from the bucket
            const segments = filteredData
                .map((d): Omit<BandSegment, 'min' | 'max'> & { min: number | null; max: number | null } => {
                    // Use bucket-local min/max if available, fallback to point value
                    const minCandidate = d[`${key}_min`];
                    const maxCandidate = d[`${key}_max`];
                    const pointValue = getPointNumber(d, key);
                    const min = typeof minCandidate === 'number' ? minCandidate : pointValue;
                    const max = typeof maxCandidate === 'number' ? maxCandidate : pointValue;
                    const x = xScale(d.timestamp);
                    const bandwidth = Math.max(2, (chartWidth / filteredData.length) * 0.8);

                    return { x, min, max, yScale, bandwidth, timestamp: d.timestamp };
                })
                .filter((seg): seg is BandSegment => typeof seg.min === 'number' && typeof seg.max === 'number' && seg.min !== seg.max); // Only show bands where there's variance

            if (segments.length === 0) return null;
            return { key, segments, color: METRICS[key].color };
        }).filter((b): b is MetricBand => b !== null) : [];

        // Deduplicate anomalies using Set of composite keys
        const anomalySet = new Set<string>();
        const anomalies = dataToRender.flatMap((d) => d.anomalies.map((a): RenderedAnomaly | null => {
            const metricConf = metricConfig[a.key as MetricKey];
            if (!metricConf) return null;

            // Create unique key: timestamp + type + message
            const uniqueKey = `${d.timestamp}-${a.type}-${a.message}`;
            if (anomalySet.has(uniqueKey)) return null; // Skip duplicates
            anomalySet.add(uniqueKey);

            const yScale = metricConf.axis === 'left' ? yScaleLeft : yScaleRight;
            const valueAtKey = getPointNumber(d, a.key);
            if (valueAtKey == null) return null;
            return { ...a, timestamp: d.timestamp, y: yScale(valueAtKey) };
        })).filter((a): a is RenderedAnomaly => a !== null);

        // Generate area path for cloud cover (if enabled)
        let cloudAreaPath = '';
        const cloudMetricConfig = metricConfig['clouds'];
        if (cloudMetricConfig && !hiddenMetrics.has('clouds')) {
            const cloudYScale = cloudMetricConfig.axis === 'left' ? yScaleLeft : yScaleRight;
            if (cloudYScale) {
                const cloudPoints = dataToRender.filter((d) => getPointNumber(d, 'clouds') != null);
                if (cloudPoints.length > 0) {
                    // Create area path (from baseline to cloud value)
                    const baselineY = cloudYScale(0);
                    const pathParts: string[] = [];

                    // Start at first point
                    pathParts.push(`M ${xScale(cloudPoints[0].timestamp).toFixed(2)} ${baselineY}`);
                    pathParts.push(`L ${xScale(cloudPoints[0].timestamp).toFixed(2)} ${cloudYScale(getPointNumber(cloudPoints[0], 'clouds') ?? 0).toFixed(2)}`);

                    // Add all cloud points
                    for (let i = 1; i < cloudPoints.length; i++) {
                        pathParts.push(`L ${xScale(cloudPoints[i].timestamp).toFixed(2)} ${cloudYScale(getPointNumber(cloudPoints[i], 'clouds') ?? 0).toFixed(2)}`);
                    }

                    // Close path back to baseline
                    pathParts.push(`L ${xScale(cloudPoints[cloudPoints.length - 1].timestamp).toFixed(2)} ${baselineY}`);
                    pathParts.push('Z');

                    cloudAreaPath = pathParts.join(' ');
                }
            }
        }

        return { paths, anomalies, bands, cloudAreaPath, yScaleLeft, yTicksLeft, yAxisLabelLeft, yScaleRight, yTicksRight, yAxisLabelRight };

    }, [dataToRender, metricConfig, chartHeight, xScale, bandEnabled, hiddenMetrics]);

    const activeMetrics = useMemo(() => Object.entries(metricConfig).map(([key, config]) => ({ key: key as MetricKey, axis: config!.axis })), [metricConfig]);

    const { xTicks } = useMemo(() => {
        const visibleTimeSpan = (xMax - xMin) * (viewBox.width / chartWidth);
        const numTicks = 10;

        const xTicks = Array.from({ length: numTicks }, (_, i) => i * chartWidth / (numTicks - 1)).map(px => {
            const time = xScale.invert(px * (viewBox.width / chartWidth) + viewBox.x);
            const date = new Date(time);

            const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            let label: string;

            if (visibleTimeSpan < 2000) { // < 2 seconds span, show millis
                label = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + date.getMilliseconds().toString().padStart(3, '0');
            } else if (visibleTimeSpan < 60 * 1000 * 2) { // < 2 minutes span, show seconds
                label = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            } else { // Standard HH:MM
                label = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            }

            return { x: px, label, dateLabel };
        });
        return { xTicks };
    }, [viewBox.width, viewBox.x, chartWidth, xScale, xMax, xMin]);

    const getSvgCoords = (e: MouseEvent) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const pt = svgRef.current.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        return pt.matrixTransform(svgRef.current.getScreenCTM()?.inverse());
    };

    const handleWindowMouseMove = useCallback((e: MouseEvent) => {
        const { isPanning, isBrushPanning, isBrushResizing, panStart, viewBoxStart } = interactionState;
        if (!isPanning && !isBrushPanning && !isBrushResizing) return;

        const svgPoint = getSvgCoords(e);
        const dx = svgPoint.x - panStart.x;

        if (isPanning) {
            let newX = viewBoxStart.x - dx * (viewBoxStart.width / chartWidth);
            if (newX < 0) newX = 0;
            if (newX + viewBoxStart.width > chartWidth) newX = chartWidth - viewBoxStart.width;
            setViewBox(vb => ({ ...vb, x: newX }));
        }
        if (isBrushPanning) {
            let newX = viewBoxStart.x + dx;
            if (newX < 0) newX = 0;
            if (newX + viewBoxStart.width > chartWidth) newX = chartWidth - viewBoxStart.width;
            setViewBox(vb => ({ ...vb, x: newX }));
        }
        if (isBrushResizing) {
            if (isBrushResizing === 'left') {
                let newX = viewBoxStart.x + dx;
                let newWidth = viewBoxStart.width - dx;
                if (newX < 0) { newWidth += newX; newX = 0; }
                if (newWidth < 10) { newX -= (10 - newWidth); newWidth = 10; }
                setViewBox({ x: newX, width: newWidth });
            } else if (isBrushResizing === 'right') {
                let newWidth = viewBoxStart.width + dx;
                if (viewBoxStart.x + newWidth > chartWidth) newWidth = chartWidth - viewBoxStart.x;
                if (newWidth < 10) newWidth = 10;
                setViewBox(vb => ({ ...vb, width: newWidth }));
            }
        }
    }, [chartWidth, setViewBox, interactionState]);

    const handleWindowMouseUp = useCallback(() => {
        interactionState.isPanning = false;
        interactionState.isBrushPanning = false;
        interactionState.isBrushResizing = null;
    }, [interactionState]);

    useEffect(() => {
        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [handleWindowMouseMove, handleWindowMouseUp]);

    const handleMouseDown = (e: React.MouseEvent) => {
        const svgPoint = getSvgCoords(e.nativeEvent);
        interactionState.isPanning = true;
        interactionState.panStart = svgPoint;
        interactionState.viewBoxStart = { ...viewBox };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (interactionState.isPanning || interactionState.isBrushPanning || interactionState.isBrushResizing || !dataToRender || dataToRender.length === 0) {
            setTooltip(null);
            return;
        }
        const svgPoint = getSvgCoords(e.nativeEvent);
        const chartMouseX = svgPoint.x - MARGIN.left;
        const timeValue = xScale.invert(chartMouseX * (viewBox.width / chartWidth) + viewBox.x);

        const closestPoint = dataToRender.reduce((prev: ChartPoint, curr: ChartPoint) =>
            Math.abs(new Date(curr.timestamp).getTime() - timeValue) < Math.abs(new Date(prev.timestamp).getTime() - timeValue)
                ? curr
                : prev
        );

        const timeDiff = Math.abs(new Date(closestPoint.timestamp).getTime() - timeValue);
        const visibleTimeSpan = (xMax - xMin) * (viewBox.width / chartWidth);
        const threshold = visibleTimeSpan * 0.05; // 5% of visible time span

        if (timeDiff < threshold) {
            setTooltip({
                x: (xScale(closestPoint.timestamp) - viewBox.x) * (chartWidth / viewBox.width),
                y: svgPoint.y,
                point: closestPoint
            });
        } else {
            setTooltip(null);
        }
    };

    const handleBrushPanStart = (e: React.MouseEvent) => {
        e.stopPropagation();
        const svgPoint = getSvgCoords(e.nativeEvent);
        interactionState.isBrushPanning = true;
        interactionState.panStart = { x: svgPoint.x - MARGIN.left, y: 0 };
        interactionState.viewBoxStart = { ...viewBox };
    };

    const handleBrushResizeStart = (e: React.MouseEvent, handle: 'left' | 'right') => {
        e.stopPropagation();
        const svgPoint = getSvgCoords(e.nativeEvent);
        interactionState.isBrushResizing = handle;
        interactionState.panStart = { x: svgPoint.x - MARGIN.left, y: 0 };
        interactionState.viewBoxStart = { ...viewBox };
    };

    return (
        <div className="relative select-none w-full h-[600px] bg-gray-900 rounded-lg overflow-hidden border border-gray-800 shadow-xl">
            {/* Show Solar Data Overlay Toggle */}
            {showSolarOverlay && (
                <div className="absolute top-4 right-4 z-10 flex items-center space-x-2 bg-gray-800/80 backdrop-blur rounded px-3 py-1 border border-gray-700 pointer-events-none">
                    <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-sm shadow-yellow-500/50"></div>
                    <span className="text-xs text-yellow-500 font-medium">Solar Overlay Active</span>
                </div>
            )}

            <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${totalHeight}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <clipPath id="chart-area"><rect x="0" y="0" width={chartWidth} height={chartHeight} /></clipPath>
                    {/* Metrics Gradients */}
                    <linearGradient id="grad-soc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity="0.4" /><stop offset="100%" stopColor="#34d399" stopOpacity="0.1" /></linearGradient>
                    <linearGradient id="grad-power" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c084fc" stopOpacity="0.4" /><stop offset="100%" stopColor="#c084fc" stopOpacity="0.1" /></linearGradient>
                    <linearGradient id="grad-solar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fbbf24" stopOpacity="0.4" /><stop offset="100%" stopColor="#fbbf24" stopOpacity="0.1" /></linearGradient>
                    <filter id="glow-line" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.5" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter>
                </defs>

                {/* Main Chart Area */}
                <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
                    {/* Grid Lines (Styled) */}
                    {yTicksLeft.map((tick, i: number) => <line key={`gl-l-${i}`} x1="0" y1={tick.y} x2={chartWidth} y2={tick.y} stroke="#374151" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />)}
                    {xTicks.map((tick, i: number) => <line key={`gl-x-${i}`} x1={tick.x} y1="0" x2={tick.x} y2={chartHeight} stroke="#374151" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />)}

                    <g clipPath="url(#chart-area)">
                        <g transform={`translate(${-viewBox.x * (chartWidth / viewBox.width)}, 0) scale(${chartWidth / viewBox.width}, 1)`}>
                            {/* Min/Max Bands - lighter and narrower using std dev */}
                            {bands.map((band) => band && !hiddenMetrics.has(band.key) && (
                                <g key={`band-${band.key}`}>
                                    {band.segments.map((seg, i: number) => (
                                        <rect
                                            key={`band-${band.key}-${i}`}
                                            x={seg.x - seg.bandwidth / 2}
                                            y={Math.min(seg.yScale(seg.min), seg.yScale(seg.max))}
                                            width={seg.bandwidth}
                                            height={Math.abs(seg.yScale(seg.min) - seg.yScale(seg.max))}
                                            fill={band.color}
                                            fillOpacity="0.2"
                                            pointerEvents="none"
                                        />
                                    ))}
                                </g>
                            ))}

                            {/* Cloud Cover Area Chart - subtle background overlay */}
                            {cloudAreaPath && (
                                <path
                                    d={cloudAreaPath}
                                    fill="#94a3b8"
                                    fillOpacity="0.1"
                                    stroke="none"
                                    pointerEvents="none"
                                />
                            )}

                            {paths.map((p) => p && !hiddenMetrics.has(p.key) && p.segments.map((seg, segIdx: number) => {
                                const isIrradiance = p.key === 'irradiance';
                                return (
                                    <path
                                        key={`${p.key}-seg-${segIdx}`}
                                        d={seg.d}
                                        fill="none"
                                        stroke={seg.color}
                                        strokeWidth={isIrradiance ? "2" : "2.5"}
                                        vectorEffect="non-scaling-stroke"
                                        strokeDasharray={isIrradiance || seg.source === 'estimated' || seg.source === 'cloud' ? '8 4' : undefined}
                                        opacity={seg.source === 'estimated' ? 0.6 : (seg.source === 'cloud' || isIrradiance) ? 0.8 : 1.0}
                                    />
                                );
                            }))}

                            {showDataPoints && activeMetrics.flatMap(({ key, axis }) => {
                                if (hiddenMetrics.has(key)) return [];
                                const yScale = axis === 'left' ? yScaleLeft : yScaleRight;
                                if (!yScale) return [];
                                return dataToRender
                                    .filter((d) => getPointNumber(d, key) != null)
                                    .map((d) => (
                                        <ellipse
                                            key={`${key}-${d.timestamp}`}
                                            cx={xScale(d.timestamp).toFixed(2)}
                                            cy={yScale(getPointNumber(d, key) ?? 0).toFixed(2)}
                                            rx={3 / zoomRatio}
                                            ry={3}
                                            fill={METRICS[key].color}
                                            stroke="white"
                                            strokeWidth="1"
                                            vectorEffect="non-scaling-stroke"
                                        />
                                    ));
                            })}

                            {anomalies.map((a, i: number) => !hiddenMetrics.has(a.key) &&
                                <ellipse
                                    key={`anomaly-${i}`}
                                    cx={xScale(a.timestamp).toFixed(2)}
                                    cy={a.y.toFixed(2)}
                                    rx={5 / zoomRatio}
                                    ry={5}
                                    fill={a.type === 'critical' ? '#ef4444' : '#f97316'}
                                    stroke="white"
                                    strokeWidth="1.5"
                                    vectorEffect="non-scaling-stroke"
                                />
                            )}

                            {/* Alert Annotations (Admin Feature) */}
                            {annotations.length > 0 && annotations.map((annotation, idx) => {
                                const annotationX = xScale(annotation.timestamp);

                                // Only render if within visible domain
                                if (annotationX < viewBox.x || annotationX > viewBox.x + viewBox.width) {
                                    return null;
                                }

                                return (
                                    <g key={`annotation-${idx}`}>
                                        <line
                                            x1={annotationX}
                                            y1={0}
                                            x2={annotationX}
                                            y2={chartHeight}
                                            stroke={annotation.type === 'critical' ? '#ef4444' : annotation.type === 'warning' ? '#f59e0b' : '#3b82f6'}
                                            strokeWidth="2"
                                            strokeDasharray="4 4"
                                            vectorEffect="non-scaling-stroke"
                                            opacity="0.6"
                                        />
                                        <circle
                                            cx={annotationX}
                                            cy={10}
                                            r={6 / zoomRatio}
                                            fill={annotation.type === 'critical' ? '#ef4444' : annotation.type === 'warning' ? '#f59e0b' : '#3b82f6'}
                                            stroke="white"
                                            strokeWidth="1.5"
                                            vectorEffect="non-scaling-stroke"
                                        />
                                    </g>
                                );
                            })}
                        </g>
                    </g>
                    <g>{yTicksLeft.map((tick, i: number) => <text key={`tl-l-${i}`} x={-8} y={tick.y} textAnchor='end' dy="0.32em" fill="#d1d5db" fontSize="12">{tick.value.toFixed(1)}</text>)}<text transform={`translate(-55, ${chartHeight / 2}) rotate(-90)`} textAnchor="middle" fill="#d1d5db" fontSize="14" fontWeight="bold">{yAxisLabelLeft}</text></g>
                    <g transform={`translate(${chartWidth}, 0)`}>{yTicksRight.map((tick, i: number) => <text key={`tl-r-${i}`} x={8} y={tick.y} textAnchor='start' dy="0.32em" fill="#d1d5db" fontSize="12">{tick.value.toFixed(1)}</text>)}<text transform={`translate(55, ${chartHeight / 2}) rotate(-90)`} textAnchor="middle" fill="#d1d5db" fontSize="14" fontWeight="bold">{yAxisLabelRight}</text></g>
                    <g transform={`translate(0, ${chartHeight})`}>{xTicks.map((tick, i: number) => <g key={`tx-${i}`} transform={`translate(${tick.x}, 0)`}><text y="20" textAnchor="middle" fill="#d1d5db" fontSize="12">{tick.label}<tspan x={0} dy="1.2em">{tick.dateLabel}</tspan></text></g>)}</g>
                    <rect width={chartWidth} height={chartHeight} fill="transparent" cursor="grab" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)} />
                    {tooltip && <line x1={tooltip.x} y1="0" x2={tooltip.x} y2={chartHeight} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="4 4" pointerEvents="none" />}
                </g>

                {/* Brush/Minimap Area */}
                <g transform={`translate(${MARGIN.left}, ${CHART_HEIGHT + MARGIN.bottom})`}>
                    <rect width={chartWidth} height={BRUSH_HEIGHT} fill="#27272a" />
                    {dataLODs['240']?.map((p, i: number) => <rect key={i} x={xScale(p.timestamp)} y={0} width="1" height={BRUSH_HEIGHT} fill="#404040" />)}
                    <rect x={viewBox.x} y="0" width={viewBox.width} height={BRUSH_HEIGHT} fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.5" cursor="move" onMouseDown={handleBrushPanStart} />
                    <rect x={viewBox.x - 4} y={0} width="8" height={BRUSH_HEIGHT} fill="white" fillOpacity={0.3} cursor="ew-resize" onMouseDown={(e) => handleBrushResizeStart(e, 'left')} />
                    <rect x={viewBox.x + viewBox.width - 4} y={0} width="8" height={BRUSH_HEIGHT} fill="white" fillOpacity={0.3} cursor="ew-resize" onMouseDown={(e) => handleBrushResizeStart(e, 'right')} />
                </g>
            </svg>

            {tooltip && (
                <div ref={tooltipRef} className="absolute p-3 bg-gray-900 border border-gray-600 rounded-lg shadow-lg text-sm text-white pointer-events-none z-50">
                    <p className="font-bold mb-2">{new Date(tooltip.point.timestamp).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                        fractionalSecondDigits: 3,
                        hour12: false,
                        timeZone: 'UTC'
                    })} UTC</p>
                    {tooltip.point.source && (
                        <p className="text-xs mb-2">
                            <span className={`px-2 py-0.5 rounded ${tooltip.point.source === 'bms' ? 'bg-green-900/50 text-green-300' :
                                tooltip.point.source === 'cloud' || tooltip.point.source === 'weather' ? 'bg-blue-900/50 text-blue-300' :
                                    'bg-purple-900/50 text-purple-300'
                                }`}>
                                {tooltip.point.source === 'bms' ? '📸 BMS Screenshot' :
                                    tooltip.point.source === 'cloud' || tooltip.point.source === 'weather' ? '☁️ Hourly Weather' :
                                        '🔮 Interpolated'}
                            </span>
                        </p>
                    )}
                    {tooltip.point.recordCount > 1 && <p className="text-xs text-gray-400 mb-2 italic">Averaged over {tooltip.point.recordCount} records</p>}
                    <table className="min-w-full text-left"><tbody>
                        {Object.keys(METRICS).filter(k => metricConfig[k as MetricKey] && !hiddenMetrics.has(k as MetricKey)).map(key => {
                            const value = getPointNumber(tooltip.point, key);
                            return (
                                <tr key={key}>
                                    <td className="pr-4 py-1 flex items-center">
                                        <div className={`w-3 h-3 rounded-full mr-2 ${METRIC_COLOR_CLASSES[key as MetricKey].bg}`} />
                                        {METRICS[key as MetricKey].label}
                                    </td>
                                    <td className="font-mono text-right">{value != null ? value.toFixed(2) : 'N/A'} {METRICS[key as MetricKey].unit}</td>
                                </tr>
                            );
                        })}
                    </tbody></table>
                    {tooltip.point.anomalies.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
                            {tooltip.point.anomalies.map((a) => <p key={a.message} className={`text-xs ${a.type === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>{a.message}</p>)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const HourlyAverageChart: React.FC<{
    analyticsData: SystemAnalytics;
    metricKey: MetricKey;
}> = ({ analyticsData, metricKey }) => {
    const { hourlyAverages, performanceBaseline } = analyticsData;
    const metricInfo = METRICS[metricKey];
    const isBidirectional = metricKey === 'current' || metricKey === 'power';

    const chartDimensions = { WIDTH: 1200, HEIGHT: 500, MARGIN: { top: 40, right: 50, bottom: 60, left: 50 } };
    const { WIDTH, HEIGHT, MARGIN } = chartDimensions;
    const chartWidth = WIDTH - MARGIN.left - MARGIN.right;
    const chartHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

    const { yScale, yTicks, yDomainMin, xBandwidth } = useMemo(() => {
        const allValues = [0]; // Include 0 in the domain
        hourlyAverages.forEach(d => {
            const metricData = d.metrics[metricKey];
            if (metricData) {
                if (metricData.avg !== undefined) allValues.push(metricData.avg);
                if (metricData.avgCharge !== undefined) allValues.push(metricData.avgCharge);
                if (metricData.avgDischarge !== undefined) allValues.push(metricData.avgDischarge);
            }
        });
        if (metricKey === 'current') {
            allValues.push(...performanceBaseline.sunnyDayChargingAmpsByHour.map(d => d.avgCurrent));
        }

        const yMin = Math.min(...allValues);
        const yMax = Math.max(...allValues);

        let yDomainMin = yMin;
        let yDomainMax = yMax;

        if (isBidirectional) {
            const absMax = Math.max(Math.abs(yMin), Math.abs(yMax));
            yDomainMin = -absMax;
            yDomainMax = absMax;
        } else {
            yDomainMin = Math.min(0, yMin); // Ensure y-axis starts at 0 for unidirectional
        }

        // Add buffer
        const buffer = (yDomainMax - yDomainMin) * 0.1 || 1;
        yDomainMin -= buffer;
        yDomainMax += buffer;
        if (yDomainMin > 0 && !isBidirectional) yDomainMin = 0; // Don't let buffer push positive-only axis below 0

        const yScale = (v: number) => chartHeight - ((v - yDomainMin) / (yDomainMax - yDomainMin)) * chartHeight;

        const numTicks = 11;
        const yTicks = Array.from({ length: numTicks }, (_, i) => {
            const value = yDomainMax - (i * (yDomainMax - yDomainMin)) / (numTicks - 1);
            return { value, y: yScale(value) };
        });

        const xBandwidth = chartWidth / 24;
        return { yScale, yTicks, yDomainMin, xBandwidth };
    }, [hourlyAverages, performanceBaseline, metricKey, isBidirectional, chartHeight, chartWidth]);

    const barWidth = xBandwidth * (isBidirectional ? 0.4 : 0.6);

    return (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto bg-gray-900 rounded-md">
            <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
                {/* Y-Axis and Grid Lines */}
                {yTicks.map(tick => (
                    <g key={tick.value}>
                        <line x1={0} y1={tick.y} x2={chartWidth} y2={tick.y} stroke={Math.abs(tick.value) < 1e-9 ? "#a3a3a3" : "#4b5563"} strokeWidth="1" strokeDasharray={Math.abs(tick.value) < 1e-9 ? undefined : "3 3"} />
                        <text x={-8} y={tick.y} dy="0.32em" textAnchor="end" fill="#d1d5db" fontSize="12">{tick.value.toFixed(0)}</text>
                    </g>
                ))}
                <text transform={`translate(${-MARGIN.left + 15}, ${chartHeight / 2}) rotate(-90)`} textAnchor="middle" fill="#d1d5db" fontSize="14" fontWeight="bold">
                    {`${metricInfo.label} (${metricInfo.unit})`}
                </text>

                {/* X-Axis */}
                {hourlyAverages.map(({ hour }) => (
                    <text key={hour} x={hour * xBandwidth + xBandwidth / 2} y={chartHeight + 20} textAnchor="middle" fill="#d1d5db" fontSize="12">{hour.toString().padStart(2, '0')}</text>
                ))}
                <text x={chartWidth / 2} y={chartHeight + 45} textAnchor="middle" fill="#d1d5db" fontSize="14" fontWeight="bold">Hour of Day (UTC)</text>

                {/* Bars */}
                {hourlyAverages.map(d => {
                    const metricData = d.metrics[metricKey];
                    if (!metricData) return null;

                    return (
                        <g key={d.hour} transform={`translate(${d.hour * xBandwidth}, 0)`}>
                            {isBidirectional && metricData.avgCharge !== undefined && metricData.avgCharge > 0 ? (
                                <rect x={xBandwidth / 2 - barWidth - 1} y={yScale(metricData.avgCharge)} width={barWidth} height={yScale(0) - yScale(metricData.avgCharge)} fill="#10b981" />
                            ) : null}
                            {isBidirectional && metricData.avgDischarge !== undefined && metricData.avgDischarge < 0 ? (
                                <rect x={xBandwidth / 2 + 1} y={yScale(0)} width={barWidth} height={yScale(metricData.avgDischarge) - yScale(0)} fill="#3b82f6" />
                            ) : null}
                            {!isBidirectional && metricData.avg !== undefined ? (
                                <rect x={xBandwidth / 2 - barWidth / 2} y={yScale(metricData.avg)} width={barWidth} height={yScale(yDomainMin > 0 ? yDomainMin : 0) - yScale(metricData.avg)} fill={metricInfo.color} />
                            ) : null}
                        </g>
                    );
                })}

                {/* Baseline for Current */}
                {metricKey === 'current' && performanceBaseline.sunnyDayChargingAmpsByHour.map(d => (
                    <line key={`bl-${d.hour}`} x1={(d.hour * xBandwidth) + (xBandwidth / 2 - barWidth - 1)} y1={yScale(d.avgCurrent)} x2={(d.hour * xBandwidth) + (xBandwidth / 2 - 1)} y2={yScale(d.avgCurrent)} stroke="#facc15" strokeWidth="3" />
                ))}
            </g>
            {/* Legend */}
            <g transform={`translate(${WIDTH - MARGIN.right - 300}, ${-5})`}>
                {isBidirectional ? (
                    <>
                        <rect x={0} y={0} width={10} height={10} fill="#10b981" />
                        <text x={15} y={9} fill="#d1d5db" fontSize="12">Avg. Charge</text>
                        <rect x={100} y={0} width={10} height={10} fill="#3b82f6" />
                        <text x={115} y={9} fill="#d1d5db" fontSize="12">Avg. Discharge</text>
                    </>
                ) : (
                    <>
                        <rect x={0} y={0} width={10} height={10} fill={metricInfo.color} />
                        <text x={15} y={9} fill="#d1d5db" fontSize="12">{`Avg. ${metricInfo.label}`}</text>
                    </>
                )}
                {metricKey === 'current' ? (
                    <>
                        <line x1={220} y1={5} x2={230} y2={5} stroke="#facc15" strokeWidth="3" />
                        <text x={235} y={9} fill="#d1d5db" fontSize="12">Sunny Day Baseline</text>
                    </>
                ) : null}
            </g>
        </svg>
    );
};

/**
 * Predictive SOC Chart Component
 * Displays hourly SOC predictions with actual vs predicted values
 */
const PredictiveSocChart: React.FC<{ data: PredictiveSocData }> = ({ data }) => {
    if (!data || !data.predictions || data.predictions.length === 0) {
        return (
            <div className="text-center text-gray-400 p-8">
                No prediction data available
            </div>
        );
    }

    const { predictions, metadata } = data;

    // Prepare chart data
    const chartWidth = 1200;
    const chartHeight = 400;
    const margin = { top: 40, right: 80, bottom: 60, left: 80 };
    const innerWidth = chartWidth - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;

    // Find SOC range
    const socValues = predictions.map(p => p.predicted).filter(v => v != null);
    const minSoc = Math.max(0, Math.min(...socValues) - 5);
    const maxSoc = Math.min(100, Math.max(...socValues) + 5);

    // Scale functions
    const xScale = (index: number) => (index / (predictions.length - 1)) * innerWidth;
    const yScale = (soc: number) => innerHeight - ((soc - minSoc) / (maxSoc - minSoc)) * innerHeight;

    // Generate path for actual and predicted data
    const actualPoints: { x: number; y: number }[] = [];
    const predictedPath: string[] = [];

    predictions.forEach((p, i: number) => {
        const x = xScale(i);
        const y = yScale(p.predicted);

        if (!p.predicted) {
            actualPoints.push({ x, y });
        }
    });

    // Generate predicted line as dashed segments
    predictions.forEach((p, i: number) => {
        if (p.predicted) {
            const x = xScale(i);
            const y = yScale(p.predicted);
            if (predictedPath.length === 0) {
                predictedPath.push(`M ${x} ${y}`);
            } else {
                predictedPath.push(`L ${x} ${y}`);
            }
        } else if (predictedPath.length > 0) {
            predictedPath.length = 0; // Reset for next segment
        }
    });

    // Time labels - show every 12 hours
    const timeLabels = predictions
        .filter((_, i: number) => i % 12 === 0)
        .map((p, labelIndex: number) => {
            const index = labelIndex * 12;
            const date = new Date(p.timestamp);
            return {
                x: xScale(index),
                label: `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`,
                hour: date.getHours()
            };
        });

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-xl font-semibold text-white mb-2">Hourly SOC Predictions (72 Hours)</h3>
                    <p className="text-sm text-gray-400">
                        {metadata?.actualHours || 0} actual data points, {metadata?.predictedHours || 0} predicted values
                    </p>
                </div>
                <div className="bg-gray-800 p-3 rounded text-sm space-y-1">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                        <span className="text-gray-300">Actual Data</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <svg width="16" height="4" className="mt-1">
                            <line x1="0" y1="2" x2="16" y2="2" stroke="rgb(96, 165, 250)" strokeWidth="2" strokeDasharray="4,4" />
                        </svg>
                        <span className="text-gray-300">Predicted</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                        Coverage: {metadata?.coveragePercent?.toFixed(1) || 'N/A'}%
                    </div>
                </div>
            </div>

            <svg width={chartWidth} height={chartHeight} className="bg-gray-900 rounded">
                <g transform={`translate(${margin.left},${margin.top})`}>
                    {/* Grid lines */}
                    {[0, 25, 50, 75, 100].map(soc => (
                        <line
                            key={soc}
                            x1={0}
                            y1={yScale(soc)}
                            x2={innerWidth}
                            y2={yScale(soc)}
                            stroke="#374151"
                            strokeWidth={1}
                            strokeDasharray={soc % 50 === 0 ? '0' : '2,2'}
                        />
                    ))}

                    {/* Y-axis labels */}
                    {[0, 25, 50, 75, 100].map(soc => (
                        <text
                            key={soc}
                            x={-10}
                            y={yScale(soc)}
                            textAnchor="end"
                            dominantBaseline="middle"
                            fill="#9ca3af"
                            fontSize="12"
                        >
                            {soc}%
                        </text>
                    ))}

                    {/* X-axis labels */}
                    {timeLabels.map((label: TimeLabel, i: number) => (
                        <text
                            key={i}
                            x={label.x}
                            y={innerHeight + 20}
                            textAnchor="middle"
                            fill="#9ca3af"
                            fontSize="10"
                            transform={`rotate(-45, ${label.x}, ${innerHeight + 20})`}
                        >
                            {label.label}
                        </text>
                    ))}

                    {/* Predicted line - connect all points as continuous line */}
                    <path
                        d={predictions.map((p, i: number) => {
                            const x = xScale(i);
                            const y = yScale(p.predicted);
                            return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
                        }).join(' ')}
                        fill="none"
                        stroke="#60a5fa"
                        strokeWidth={2}
                        strokeDasharray="4,4"
                        opacity={0.6}
                    />

                    {/* Actual data points */}
                    {actualPoints.map((point, i) => (
                        <circle
                            key={i}
                            cx={point.x}
                            cy={point.y}
                            r={4}
                            fill="#34d399"
                            stroke="#fff"
                            strokeWidth={1}
                        />
                    ))}

                    {/* Axis labels */}
                    <text
                        x={innerWidth / 2}
                        y={innerHeight + 50}
                        textAnchor="middle"
                        fill="#d1d5db"
                        fontSize="14"
                        fontWeight="bold"
                    >
                        Time
                    </text>
                    <text
                        x={-innerHeight / 2}
                        y={-60}
                        textAnchor="middle"
                        fill="#d1d5db"
                        fontSize="14"
                        fontWeight="bold"
                        transform={`rotate(-90, -${innerHeight / 2}, -60)`}
                    >
                        State of Charge (%)
                    </text>
                </g>
            </svg>

            {/* Additional info */}
            {metadata && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="bg-gray-800 p-3 rounded">
                        <div className="text-gray-400">Avg Discharge Rate</div>
                        <div className="text-white font-semibold">{metadata?.avgDischargeRatePerHour?.toFixed(2) || 'N/A'}% /hr</div>
                    </div>
                    <div className="bg-gray-800 p-3 rounded">
                        <div className="text-gray-400">Avg Charge Rate</div>
                        <div className="text-white font-semibold">{metadata?.avgChargeRatePerHour?.toFixed(2) || 'N/A'}% /hr</div>
                    </div>
                    <div className="bg-gray-800 p-3 rounded">
                        <div className="text-gray-400">Data Points</div>
                        <div className="text-white font-semibold">{metadata?.actualDataPoints || 'N/A'}</div>
                    </div>
                    <div className="bg-gray-800 p-3 rounded">
                        <div className="text-gray-400">Time Range</div>
                        <div className="text-white font-semibold text-xs">
                            {metadata?.timeRange?.start ? new Date(metadata.timeRange.start).toLocaleDateString() : 'N/A'} -<br />
                            {metadata?.timeRange?.end ? new Date(metadata.timeRange.end).toLocaleDateString() : 'N/A'}
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-blue-900/20 border border-blue-700/50 p-3 rounded text-sm text-blue-200">
                <strong>Note:</strong> Predictions use historical charge/discharge patterns, time-of-day solar availability, and weather data.
                Actual values shown as green dots, predicted values as dashed blue line. Confidence varies based on data coverage.
            </div>
        </div>
    );
};


const HistoricalChart: React.FC<HistoricalChartProps> = ({
    systems,
    history,
    enableAdminFeatures: _enableAdminFeatures = false,
    showSolarOverlay = false,
    annotations = [],
    onZoomDomainChange
}) => {
    // Load saved preferences on mount
    const savedPrefs = useMemo(() => loadChartPreferences(), []);

    const [selectedSystemId, setSelectedSystemId] = useState<string>(savedPrefs.defaultSystemId || '');
    const [metricConfig, setMetricConfig] = useState<Partial<Record<MetricKey, { axis: Axis }>>>(
        savedPrefs.metricConfig || {
            stateOfCharge: { axis: 'left' },
            current: { axis: 'right' },
            power: { axis: 'right' }
        }
    );
    const [hiddenMetrics] = useState<Set<MetricKey>>(new Set());

    // Helper to get local time string for inputs (YYYY-MM-DDTHH:mm)
    const toLocalISOString = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date.getTime() - offset);
        return localDate.toISOString().slice(0, 16);
    };

    // Initialize with default 30-day range so charts load immediately
    // Use local time for input fields
    const [startDate, setStartDate] = useState<string>(() =>
        toLocalISOString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
    );
    const [endDate, setEndDate] = useState<string>(''); // Empty defaults to "Now"

    const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
    const [bandEnabled, setBandEnabled] = useState<boolean>(savedPrefs.bandEnabled ?? false);

    const [analyticsData, setAnalyticsData] = useState<SystemAnalytics | null>(null);
    const [chartView, setChartView] = useState<ChartView>(savedPrefs.chartView || 'timeline');
    const [hourlyMetric, setHourlyMetric] = useState<MetricKey>(savedPrefs.hourlyMetric || 'power');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [averagingEnabled, setAveragingEnabled] = useState(savedPrefs.averagingEnabled ?? true);
    const [manualBucketSize, setManualBucketSize] = useState<string | null>(savedPrefs.manualBucketSize ?? null);
    const [preferencesSaved, setPreferencesSaved] = useState(false);
    const [predictiveData, setPredictiveData] = useState<PredictiveSocData | null>(null);
    const [predictiveLoading, setPredictiveLoading] = useState(false);
    const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false); // New: separate analytics loading

    // FIX: Race condition protection - track current request to prevent stale updates
    const requestIdRef = useRef(0);

    const [zoomPercentage, setZoomPercentage] = useState<number>(100);

    const chartDimensions = useMemo(() => ({
        WIDTH: 1200, CHART_HEIGHT: 450, BRUSH_HEIGHT: 80,
        // FIX: Increased margins to prevent cropping at borders (was top:20, right:80, bottom:80, left:80)
        MARGIN: { top: 30, right: 100, bottom: 90, left: 90 },
        get chartWidth() { return this.WIDTH - this.MARGIN.left - this.MARGIN.right },
        get chartHeight() { return this.CHART_HEIGHT - this.MARGIN.top - this.MARGIN.bottom },
        get totalHeight() { return this.CHART_HEIGHT + this.BRUSH_HEIGHT + this.MARGIN.bottom },
    }), []);

    const [viewBox, setViewBox] = useState({ x: 0, width: chartDimensions.chartWidth });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
            if (e.ctrlKey) {
                if (e.key === '-') { e.preventDefault(); setZoomPercentage(z => Math.max(0.1, z / 1.2)); }
                if (e.shiftKey && e.key === '+') { e.preventDefault(); setZoomPercentage(z => z * 1.2); }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const stableSetViewBox = useCallback(setViewBox, []);

    // Load predictive data when chartView changes to predictive
    useEffect(() => {
        if (chartView === 'predictive' && selectedSystemId) {
            loadPredictiveData();
        }
    }, [chartView, selectedSystemId]);

    const loadPredictiveData = async () => {
        if (!selectedSystemId) return;

        setPredictiveLoading(true);
        setError(null);

        try {
            const predictions = await getHourlySocPredictions(selectedSystemId, 72);
            setPredictiveData(predictions as PredictiveSocData);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to load predictive data';
            setError(errorMsg);
            console.error('Error loading predictive data:', err);
        } finally {
            setPredictiveLoading(false);
        }
    };

    useEffect(() => {
        if (!timelineData) return;

        const newWidth = chartDimensions.chartWidth / (zoomPercentage / 100);

        stableSetViewBox(currentViewBox => {
            const viewCenter = currentViewBox.x + currentViewBox.width / 2;
            let newX = viewCenter - newWidth / 2;

            if (newWidth >= chartDimensions.chartWidth) {
                return { x: 0, width: chartDimensions.chartWidth };
            }
            if (newX < 0) newX = 0;
            if (newX + newWidth > chartDimensions.chartWidth) newX = chartDimensions.chartWidth - newWidth;

            return { x: newX, width: newWidth };
        });
    }, [zoomPercentage, timelineData, chartDimensions.chartWidth, stableSetViewBox]);

    // FIX: Notify parent component of visible time domain when viewBox or timelineData changes
    useEffect(() => {
        if (timelineData && onZoomDomainChange) {
            const { xScale } = timelineData;
            const visibleStartTime = xScale.invert(viewBox.x);
            const visibleEndTime = xScale.invert(viewBox.x + viewBox.width);
            onZoomDomainChange(visibleStartTime, visibleEndTime);
        }
    }, [viewBox.x, viewBox.width, timelineData, onZoomDomainChange]);

    // FIX: This effect updates averagingConfig when averaging or manual bucket size changes
    // Ensures immediate updates when user toggles data averaging or selects a bucket size
    useEffect(() => {
        if (timelineData) {
            setTimelineData((prev) => {
                if (!prev) return null;
                return {
                    ...prev,
                    averagingConfig: {
                        ...prev.averagingConfig,
                        enabled: averagingEnabled,
                        manualBucketSize: manualBucketSize
                    }
                };
            });
        }
    }, [averagingEnabled, manualBucketSize]);

    // This effect updates the auto-bucket key when the zoom/viewBox changes, without re-running the entire data prep.
    useEffect(() => {
        if (timelineData) {
            const zoomRatio = chartDimensions.chartWidth / viewBox.width;
            let autoBucketKey = 'raw';
            if (zoomRatio < 2) autoBucketKey = '1440';
            else if (zoomRatio < 5) autoBucketKey = '240';
            else if (zoomRatio < 15) autoBucketKey = '60';
            else if (zoomRatio < 50) autoBucketKey = '15';
            else if (zoomRatio < 100) autoBucketKey = '5';

            setTimelineData((prev) => {
                if (!prev) return null; // Guard against race condition
                return {
                    ...prev,
                    averagingConfig: {
                        ...prev.averagingConfig,
                        autoBucketKey: autoBucketKey
                    }
                };
            });
        }
    }, [viewBox.width, chartDimensions.chartWidth, timelineData]);

    const prepareChartData = useCallback(async () => {
        if (!selectedSystemId) {
            console.log('[HistoricalChart] No system selected, skipping chart data preparation');
            return;
        }

        // FIX: Track this request to prevent race conditions
        const currentRequestId = ++requestIdRef.current;
        console.log('[HistoricalChart] Starting chart data preparation', {
            requestId: currentRequestId,
            selectedSystemId,
            historyCount: history.length
        });

        // Prepare UTC ISO strings for API calls to prevent timezone drift
        const chartStartDate = startDate || toLocalISOString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
        const chartEndDate = endDate || toLocalISOString(new Date());

        const apiStartDate = new Date(chartStartDate).toISOString();
        const apiEndDate = new Date(chartEndDate).toISOString();
        console.log('[HistoricalChart] Date range', { chartStartDate, chartEndDate, apiStartDate, apiEndDate });

        setIsGenerating(true);
        setError(null);
        // FIX: Don't clear timeline data immediately - this causes "disappearing data" flicker
        // Only clear analytics which will be repopulated
        setAnalyticsData(null);

        try {
            const isAllData = selectedSystemId === '__ALL__';

            // OPTIMIZATION: Calculate analytics locally if we have history records.
            // This is MUCH faster than hitting the /system-analytics backend for 2k-4k records.
            const systemHistory = isAllData
                ? history // All records for "All Data" view
                : history.filter(r => r.systemId === selectedSystemId);

            // Filter by timeframe to ensure "Recurring Alert Analysis" is accurate
            const filteredForAnalytics = systemHistory.filter(r =>
                (!chartStartDate || new Date(r.timestamp) >= new Date(chartStartDate)) &&
                (!chartEndDate || new Date(r.timestamp) <= new Date(chartEndDate))
            );

            if (filteredForAnalytics.length > 5) { // Lowered threshold since we are filtering by timeframe
                // If we have local data for this timeframe, calculate analytics instantly
                setIsAnalyticsLoading(true);
                try {
                    const localAnalytics = calculateSystemAnalytics(filteredForAnalytics);
                    // FIX: Check if this request is still current before updating state
                    if (currentRequestId !== requestIdRef.current) return;
                    setAnalyticsData(localAnalytics);
                    setIsAnalyticsLoading(false);
                } catch (err) {
                    console.error('Local analytics calculation failed:', err);
                    // Fallback to server if local fails (skip for __ALL__ since it's not a real system)
                    if (!isAllData) {
                        const analytics = await getSystemAnalytics(selectedSystemId);
                        if (currentRequestId !== requestIdRef.current) return;
                        setAnalyticsData(analytics);
                    }
                }
            } else if (!isAllData) {
                // Not enough records locally or first time load, use server (skip for __ALL__)
                const analytics = await getSystemAnalytics(selectedSystemId);
                if (currentRequestId !== requestIdRef.current) return;
                setAnalyticsData(analytics);
            }

            const system = isAllData ? null : systems.find(s => s.id === selectedSystemId);
            const ratedCapacity = system?.capacity;

            let chartDataPoints: ChartPoint[] = [];

            // 1. Sync Weather Data (Local vs Server check) - skip for __ALL__
            if (!isAllData) {
                // Fire and forget - will update cache
                console.log('[HistoricalChart] Syncing weather data', { systemId: selectedSystemId, apiStartDate, apiEndDate });
                await syncWeather(selectedSystemId, apiStartDate, apiEndDate);
                console.log('[HistoricalChart] Weather sync complete');
            }

            // FIX: Check if this request is still current after async operation
            if (currentRequestId !== requestIdRef.current) {
                console.log('[HistoricalChart] Request cancelled (stale after weather sync)', { currentRequestId, activeRequestId: requestIdRef.current });
                return;
            }

            // 2. Get Unified History (Memory join of History + Weather from Cache)
            console.log('[HistoricalChart] Fetching unified history', { systemId: selectedSystemId });
            const unifiedTimeline = await getUnifiedHistory(selectedSystemId);
            console.log('[HistoricalChart] Unified history received', { count: unifiedTimeline.length });

            // FIX: Check again after async
            if (currentRequestId !== requestIdRef.current) {
                console.log('[HistoricalChart] Request cancelled (stale after unified history)', { currentRequestId, activeRequestId: requestIdRef.current });
                return;
            }

            // Filter by date range (client-side filter on unified stream)
            const startLimit = new Date(chartStartDate).getTime();
            const endLimit = new Date(chartEndDate).getTime();

            const filteredData = unifiedTimeline.filter(p => {
                const t = new Date(p.timestamp).getTime();
                return t >= startLimit && t <= endLimit;
            });
            console.log('[HistoricalChart] Filtered data by date range', {
                originalCount: unifiedTimeline.length,
                filteredCount: filteredData.length,
                startLimit: new Date(startLimit).toISOString(),
                endLimit: new Date(endLimit).toISOString()
            });

            if (filteredData.length === 0) {
                console.log('[HistoricalChart] No data in date range, clearing chart');
                setTimelineData(null);
                setIsGenerating(false);
                return;
            }

            // 3. Process into Chart Points
            chartDataPoints = filteredData.map(p => mapUnifiedPointToChartPoint(p, ratedCapacity));
            console.log('[HistoricalChart] Processed chart points', { count: chartDataPoints.length });

            if (chartDataPoints.length < 2) {
                console.log('[HistoricalChart] Not enough chart points (< 2), clearing chart');
                // FIX: Only clear if this is still the current request
                if (currentRequestId === requestIdRef.current) {
                    setTimelineData(null);
                }
            } else {
                // Create LODs for zoom levels
                const dataLODs: Record<string, ChartPoint[]> = {
                    'raw': chartDataPoints,
                    '5': aggregateData(chartDataPoints, 5),
                    '15': aggregateData(chartDataPoints, 15),
                    '60': aggregateData(chartDataPoints, 60),
                    '240': aggregateData(chartDataPoints, 240),
                    '1440': aggregateData(chartDataPoints, 1440),
                };

                const xMin = new Date(chartDataPoints[0].timestamp).getTime();
                const xMax = new Date(chartDataPoints[chartDataPoints.length - 1].timestamp).getTime();
                const xScale = (time: string | number) => ((new Date(time).getTime() - xMin) / (xMax - xMin || 1)) * chartDimensions.chartWidth;
                xScale.invert = (px: number) => xMin + (px / chartDimensions.chartWidth) * (xMax - xMin || 1);

                // FIX: Only update if this is still the current request
                if (currentRequestId === requestIdRef.current) {
                    setTimelineData({
                        dataLODs,
                        xScale,
                        xMin,
                        xMax,
                        averagingConfig: {
                            enabled: averagingEnabled,
                            manualBucketSize: manualBucketSize,
                            autoBucketKey: 'raw', // Initial value, will be updated by useEffect
                        }
                    });
                    setZoomPercentage(100);
                    setViewBox({ x: 0, width: chartDimensions.chartWidth });
                }
            }
        } catch (err) {
            console.error('[HistoricalChart] Error preparing chart data', { error: err, message: err instanceof Error ? err.message : String(err) });
            // FIX: Only set error if this is still the current request
            if (currentRequestId === requestIdRef.current) {
                setError(err instanceof Error ? err.message : "Failed to generate chart data.");
            }
        } finally {
            console.log('[HistoricalChart] Chart data preparation complete', { requestId: currentRequestId });
            // FIX: Only update loading state if this is still the current request
            if (currentRequestId === requestIdRef.current) {
                setIsGenerating(false);
                setIsAnalyticsLoading(false);
            }
        }
    }, [selectedSystemId, history, systems, startDate, endDate, chartDimensions, averagingEnabled, manualBucketSize]);

    // Auto-generate chart when system is selected or date range changes
    useEffect(() => {
        if (selectedSystemId) {
            prepareChartData();
        }
    }, [selectedSystemId, prepareChartData]);

    const handleResetView = () => {
        setZoomPercentage(100);
        setViewBox({ x: 0, width: chartDimensions.chartWidth });
    };

    const handleSavePreferences = useCallback(() => {
        saveChartPreferences({
            metricConfig,
            chartView,
            hourlyMetric,
            averagingEnabled,
            manualBucketSize,
            bandEnabled,
            defaultSystemId: selectedSystemId || undefined,
        });
        setPreferencesSaved(true);
        // Reset the saved indicator after 2 seconds
        setTimeout(() => setPreferencesSaved(false), 2000);
    }, [metricConfig, chartView, hourlyMetric, averagingEnabled, manualBucketSize, bandEnabled, selectedSystemId]);

    const hasChartData = timelineData || (analyticsData?.hourlyAverages?.length ?? 0) > 0;

    return (
        <div>
            <ChartControls
                systems={systems} selectedSystemId={selectedSystemId} setSelectedSystemId={setSelectedSystemId}
                startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}
                metricConfig={metricConfig} setMetricConfig={setMetricConfig}
                onResetView={handleResetView} hasChartData={!!hasChartData}
                zoomPercentage={zoomPercentage} setZoomPercentage={setZoomPercentage}
                chartView={chartView} setChartView={setChartView}
                hourlyMetric={hourlyMetric} setHourlyMetric={setHourlyMetric}
                averagingEnabled={averagingEnabled}
                setAveragingEnabled={setAveragingEnabled}
                manualBucketSize={manualBucketSize}
                setManualBucketSize={setManualBucketSize}
                bandEnabled={bandEnabled}
                setBandEnabled={setBandEnabled}
                onSavePreferences={handleSavePreferences}
                preferencesSaved={preferencesSaved}
            />
            <div className="mt-4 min-h-[600px] relative">
                {isGenerating && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-50 rounded-lg">
                        <div className="flex flex-col items-center">
                            <SpinnerIcon className="w-12 h-12 text-secondary animate-spin" />
                            <span className="mt-4 text-gray-300 font-medium">Preparing Timeline...</span>
                        </div>
                    </div>
                )}
                {error && <div className="text-red-400 p-4 bg-red-900/50 rounded-lg text-center">{error}</div>}
                {!error && (
                    <>
                        {!hasChartData ? (
                            <div className="flex items-center justify-center h-full text-gray-400 bg-gray-900/50 rounded-lg p-8 min-h-[600px]">Select a system to view historical data.</div>
                        ) : (
                            <div className="grid lg:grid-cols-3 gap-8 items-start">
                                <div className="lg:col-span-2">
                                    {chartView === 'timeline' && timelineData && (
                                        <ChartErrorBoundary onRetry={prepareChartData}>
                                            <SvgChart
                                                chartData={timelineData}
                                                metricConfig={metricConfig}
                                                hiddenMetrics={hiddenMetrics}
                                                viewBox={viewBox}
                                                setViewBox={setViewBox}
                                                chartDimensions={chartDimensions}
                                                bandEnabled={bandEnabled}
                                                annotations={annotations}
                                                showSolarOverlay={showSolarOverlay}
                                            />
                                        </ChartErrorBoundary>
                                    )}
                                    {chartView === 'hourly' && (
                                        isAnalyticsLoading ? (
                                            <div className="flex items-center justify-center h-96 bg-gray-900/50 rounded-lg">
                                                <SpinnerIcon className="w-8 h-8 text-secondary" />
                                                <span className="ml-4 text-gray-400">Loading Hourly Averages...</span>
                                            </div>
                                        ) : analyticsData ? (
                                            <ChartErrorBoundary onRetry={prepareChartData}>
                                                <HourlyAverageChart analyticsData={analyticsData} metricKey={hourlyMetric} />
                                            </ChartErrorBoundary>
                                        ) : (
                                            <div className="flex items-center justify-center h-96 text-gray-400">No analytics data available for selected period.</div>
                                        )
                                    )}
                                    {chartView === 'predictive' && (
                                        <div className="bg-gray-900 p-4 rounded-lg">
                                            {predictiveLoading ? (
                                                <div className="flex items-center justify-center h-96">
                                                    <SpinnerIcon className="w-8 h-8 text-secondary" />
                                                    <span className="ml-4 text-gray-400">Loading predictions...</span>
                                                </div>
                                            ) : predictiveData ? (
                                                <ChartErrorBoundary onRetry={prepareChartData}>
                                                    <PredictiveSocChart data={predictiveData} />
                                                </ChartErrorBoundary>
                                            ) : (
                                                <div className="flex items-center justify-center h-96 text-gray-400">
                                                    Select a system to view hourly SOC predictions
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="lg:col-span-1">
                                    {isAnalyticsLoading ? (
                                        <div className="bg-gray-800 p-4 rounded-lg animate-pulse h-64 flex items-center justify-center">
                                            <span className="text-gray-500">Analyzing alerts...</span>
                                        </div>
                                    ) : analyticsData?.alertAnalysis && analyticsData.alertAnalysis.totalEvents > 0 && (
                                        <AlertAnalysis data={analyticsData.alertAnalysis} />
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default HistoricalChart;

