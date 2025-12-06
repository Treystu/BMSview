import React, { useEffect, useState } from 'react';
import type { AnalysisRecord } from '../../types';

interface BatteryHealthTrendsProps {
    systemId?: string;
    records: AnalysisRecord[];
    timeRange?: '7d' | '30d' | '90d' | 'all';
}

interface HealthMetrics {
    soh: number; // State of Health (0-100%)
    capacityFade: number; // Percentage of capacity lost
    avgCellDelta: number; // Average cell voltage imbalance
    cycleCount: number;
    avgTemp: number;
    degradationRate: number; // % per month
}

interface TrendDataPoint {
    timestamp: string;
    soh: number;
    capacityFade: number;
    cellDelta: number;
    temperature: number;
    cycles: number;
}

/**
 * BatteryHealthTrends - Visual representation of battery health over time
 * 
 * Features:
 * - State of Health (SOH) tracking
 * - Capacity fade visualization
 * - Cell balance trends
 * - Temperature correlation
 * - Cycle count tracking
 * - Degradation rate calculation
 * - Health alerts and thresholds
 */
const BatteryHealthTrends: React.FC<BatteryHealthTrendsProps> = ({
    systemId,
    records,
    timeRange = '30d'
}) => {
    const [healthMetrics, setHealthMetrics] = useState<HealthMetrics | null>(null);
    const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
    const [alerts, setAlerts] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!records || records.length === 0) {
            setLoading(false);
            return;
        }

        calculateHealthMetrics();
    }, [records, timeRange]);

    const filterRecordsByTimeRange = (records: AnalysisRecord[]): AnalysisRecord[] => {
        if (timeRange === 'all') return records;

        const now = new Date();
        const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[timeRange];
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        return records.filter(r => new Date(r.timestamp) >= cutoff);
    };

    const calculateHealthMetrics = () => {
        setLoading(true);

        try {
            const filteredRecords = filterRecordsByTimeRange(records);
            if (filteredRecords.length === 0) {
                setLoading(false);
                return;
            }

            // Sort by timestamp
            const sortedRecords = [...filteredRecords].sort((a, b) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            // Get first and last records for comparison
            const firstRecord = sortedRecords[0];
            const lastRecord = sortedRecords[sortedRecords.length - 1];

            // Calculate capacity fade
            const initialCapacity = firstRecord.analysis?.capacity || 100;
            const currentCapacity = lastRecord.analysis?.capacity || initialCapacity;
            const capacityFade = ((initialCapacity - currentCapacity) / initialCapacity) * 100;

            // Calculate State of Health
            const soh = Math.max(0, Math.min(100, 100 - capacityFade));

            // Calculate average cell delta
            const cellDeltas = sortedRecords
                .map(r => r.analysis?.cellVoltageDelta)
                .filter((d): d is number => d !== undefined);
            const avgCellDelta = cellDeltas.length > 0
                ? cellDeltas.reduce((sum, d) => sum + d, 0) / cellDeltas.length
                : 0;

            // Get cycle count
            const cycleCount = lastRecord.analysis?.cycles || 0;

            // Calculate average temperature
            const temps = sortedRecords
                .map(r => r.analysis?.temperature)
                .filter((t): t is number => t !== undefined);
            const avgTemp = temps.length > 0
                ? temps.reduce((sum, t) => sum + t, 0) / temps.length
                : 0;

            // Calculate degradation rate (% per month)
            const timeSpanMs = new Date(lastRecord.timestamp).getTime() - new Date(firstRecord.timestamp).getTime();
            const timeSpanMonths = timeSpanMs / (30 * 24 * 60 * 60 * 1000);
            const degradationRate = timeSpanMonths > 0 ? capacityFade / timeSpanMonths : 0;

            setHealthMetrics({
                soh,
                capacityFade,
                avgCellDelta,
                cycleCount,
                avgTemp,
                degradationRate
            });

            // Generate trend data points
            const trends: TrendDataPoint[] = sortedRecords.map((record, index) => {
                const recordCapacity = record.analysis?.capacity || initialCapacity;
                const recordCapacityFade = ((initialCapacity - recordCapacity) / initialCapacity) * 100;
                const recordSOH = Math.max(0, Math.min(100, 100 - recordCapacityFade));

                return {
                    timestamp: record.timestamp,
                    soh: recordSOH,
                    capacityFade: recordCapacityFade,
                    cellDelta: record.analysis?.cellVoltageDelta || 0,
                    temperature: record.analysis?.temperature || 0,
                    cycles: record.analysis?.cycles || 0
                };
            });

            setTrendData(trends);

            // Generate health alerts
            const newAlerts: string[] = [];
            if (soh < 80) {
                newAlerts.push(`⚠️ State of Health below 80% (${soh.toFixed(1)}%)`);
            }
            if (avgCellDelta > 0.2) {
                newAlerts.push(`⚠️ High cell imbalance detected (${(avgCellDelta * 1000).toFixed(0)}mV avg)`);
            }
            if (degradationRate > 1) {
                newAlerts.push(`⚠️ High degradation rate (${degradationRate.toFixed(2)}% per month)`);
            }
            if (avgTemp > 45) {
                newAlerts.push(`⚠️ Average temperature high (${avgTemp.toFixed(1)}°C)`);
            }
            if (cycleCount > 3000) {
                newAlerts.push(`ℹ️ Approaching cycle life limit (${cycleCount} cycles)`);
            }

            setAlerts(newAlerts);
        } catch (error) {
            console.error('Failed to calculate health metrics:', error);
        } finally {
            setLoading(false);
        }
    };

    const getSOHColor = (soh: number): string => {
        if (soh >= 90) return 'text-green-400';
        if (soh >= 80) return 'text-yellow-400';
        if (soh >= 70) return 'text-orange-400';
        return 'text-red-400';
    };

    const getDegradationColor = (rate: number): string => {
        if (rate < 0.5) return 'text-green-400';
        if (rate < 1) return 'text-yellow-400';
        return 'text-red-400';
    };

    if (loading) {
        return (
            <div className="bg-neutral-dark rounded-lg p-6 shadow-lg">
                <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-secondary"></div>
                    <span className="ml-3">Calculating health metrics...</span>
                </div>
            </div>
        );
    }

    if (!healthMetrics || trendData.length === 0) {
        return (
            <div className="bg-neutral-dark rounded-lg p-6 shadow-lg">
                <p className="text-gray-400 text-center">No health data available for selected time range.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Health Alerts */}
            {alerts.length > 0 && (
                <div className="bg-yellow-900 bg-opacity-20 border border-yellow-600 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-yellow-400 mb-2">Health Alerts</h3>
                    <ul className="space-y-1">
                        {alerts.map((alert, index) => (
                            <li key={index} className="text-yellow-200 text-sm">{alert}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Health Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {/* State of Health */}
                <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                    <h3 className="text-sm text-gray-400 mb-1">State of Health</h3>
                    <p className={`text-3xl font-bold ${getSOHColor(healthMetrics.soh)}`}>
                        {healthMetrics.soh.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        {healthMetrics.soh >= 90 ? 'Excellent' :
                         healthMetrics.soh >= 80 ? 'Good' :
                         healthMetrics.soh >= 70 ? 'Fair' : 'Poor'}
                    </p>
                </div>

                {/* Capacity Fade */}
                <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                    <h3 className="text-sm text-gray-400 mb-1">Capacity Fade</h3>
                    <p className="text-3xl font-bold text-orange-400">
                        {healthMetrics.capacityFade.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Total degradation</p>
                </div>

                {/* Degradation Rate */}
                <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                    <h3 className="text-sm text-gray-400 mb-1">Degradation Rate</h3>
                    <p className={`text-3xl font-bold ${getDegradationColor(healthMetrics.degradationRate)}`}>
                        {healthMetrics.degradationRate.toFixed(2)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Per month</p>
                </div>

                {/* Cell Balance */}
                <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                    <h3 className="text-sm text-gray-400 mb-1">Avg Cell Delta</h3>
                    <p className="text-3xl font-bold text-blue-400">
                        {(healthMetrics.avgCellDelta * 1000).toFixed(0)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">mV imbalance</p>
                </div>

                {/* Cycle Count */}
                <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                    <h3 className="text-sm text-gray-400 mb-1">Cycle Count</h3>
                    <p className="text-3xl font-bold text-purple-400">
                        {healthMetrics.cycleCount}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        {healthMetrics.cycleCount > 0 ? 
                            `${((healthMetrics.cycleCount / 5000) * 100).toFixed(0)}% of typical life` :
                            'Not available'}
                    </p>
                </div>

                {/* Average Temperature */}
                <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                    <h3 className="text-sm text-gray-400 mb-1">Avg Temperature</h3>
                    <p className="text-3xl font-bold text-cyan-400">
                        {healthMetrics.avgTemp.toFixed(1)}°C
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        {healthMetrics.avgTemp < 30 ? 'Optimal' :
                         healthMetrics.avgTemp < 40 ? 'Normal' : 'High'}
                    </p>
                </div>
            </div>

            {/* Trend Chart Placeholder */}
            <div className="bg-neutral-dark rounded-lg p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-secondary mb-4">Health Trends Over Time</h3>
                <div className="space-y-4">
                    {/* Simple ASCII-style chart for now */}
                    <div>
                        <p className="text-sm text-gray-400 mb-2">State of Health Progress</p>
                        <div className="bg-gray-800 rounded p-3">
                            <div className="flex items-end justify-between h-32 gap-1">
                                {trendData.slice(-20).map((point, index) => {
                                    const height = (point.soh / 100) * 100;
                                    return (
                                        <div key={index} className="flex-1 flex flex-col justify-end">
                                            <div
                                                className={`w-full rounded-t transition-all ${
                                                    point.soh >= 90 ? 'bg-green-500' :
                                                    point.soh >= 80 ? 'bg-yellow-500' :
                                                    point.soh >= 70 ? 'bg-orange-500' : 'bg-red-500'
                                                }`}
                                                style={{ height: `${height}%` }}
                                                title={`${new Date(point.timestamp).toLocaleDateString()}: ${point.soh.toFixed(1)}%`}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex justify-between text-xs text-gray-500 mt-2">
                                <span>{trendData.length > 0 ? new Date(trendData[0].timestamp).toLocaleDateString() : ''}</span>
                                <span>{trendData.length > 0 ? new Date(trendData[trendData.length - 1].timestamp).toLocaleDateString() : ''}</span>
                            </div>
                        </div>
                    </div>

                    <div className="text-sm text-gray-400">
                        <p>📊 Showing {trendData.length} data points over {timeRange === 'all' ? 'all time' : timeRange}</p>
                        <p className="mt-1">💡 For detailed charting, integrate with Chart.js or similar library</p>
                    </div>
                </div>
            </div>

            {/* Recommendations */}
            <div className="bg-neutral-dark rounded-lg p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-secondary mb-3">Recommendations</h3>
                <ul className="space-y-2 text-sm">
                    {healthMetrics.soh < 80 && (
                        <li className="flex items-start gap-2">
                            <span className="text-yellow-400">⚠️</span>
                            <span>Consider battery replacement when SOH drops below 70%</span>
                        </li>
                    )}
                    {healthMetrics.avgCellDelta > 0.15 && (
                        <li className="flex items-start gap-2">
                            <span className="text-yellow-400">⚠️</span>
                            <span>Cell imbalance detected. Consider manual balancing or BMS calibration</span>
                        </li>
                    )}
                    {healthMetrics.degradationRate > 1 && (
                        <li className="flex items-start gap-2">
                            <span className="text-red-400">⛔</span>
                            <span>High degradation rate. Check for over-temperature, deep cycling, or high charge/discharge rates</span>
                        </li>
                    )}
                    {healthMetrics.avgTemp > 40 && (
                        <li className="flex items-start gap-2">
                            <span className="text-orange-400">🌡️</span>
                            <span>Average temperature is high. Improve cooling or reduce charge/discharge rates</span>
                        </li>
                    )}
                    {alerts.length === 0 && (
                        <li className="flex items-start gap-2">
                            <span className="text-green-400">✓</span>
                            <span>Battery health is good. Continue monitoring regularly</span>
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
};

export default BatteryHealthTrends;
