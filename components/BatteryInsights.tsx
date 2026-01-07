import React, { useState, useEffect } from 'react';
import type { AnalysisRecord } from '../types';
import BatteryHealthTrends from './BatteryHealthTrends';

interface BatteryInsightsProps {
    systemId?: string;
    records: AnalysisRecord[];
    currentAnalysis?: AnalysisRecord;
}

interface InsightCategory {
    title: string;
    insights: string[];
    severity: 'info' | 'warning' | 'critical';
}

interface PerformanceMetrics {
    avgSOC: number;
    avgVoltage: number;
    avgCurrent: number;
    avgPower: number;
    totalEnergy: number;
    cyclesSinceStart: number;
}

/**
 * BatteryInsights - Comprehensive insights visualization dashboard
 * 
 * Features:
 * - AI-generated insights display
 * - Performance trend visualization
 * - Predictive analytics
 * - Comparison views
 * - Export functionality
 * - Health status overview
 * - Energy flow analysis
 */
const BatteryInsights: React.FC<BatteryInsightsProps> = ({
    systemId,
    records,
    currentAnalysis
}) => {
    const [selectedTimeRange, setSelectedTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
    const [insightCategories, setInsightCategories] = useState<InsightCategory[]>([]);
    const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [showHealthTrends, setShowHealthTrends] = useState(false);

    useEffect(() => {
        if (records && records.length > 0) {
            generateInsights();
            calculatePerformanceMetrics();
        }
        setLoading(false);
    }, [records, selectedTimeRange]);

    const filterRecordsByTimeRange = (records: AnalysisRecord[]): AnalysisRecord[] => {
        if (selectedTimeRange === 'all') return records;

        const now = new Date();
        const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[selectedTimeRange];
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        return records.filter(r => new Date(r.timestamp) >= cutoff);
    };

    const generateInsights = () => {
        const filteredRecords = filterRecordsByTimeRange(records);
        if (filteredRecords.length === 0) return;

        const categories: InsightCategory[] = [];

        // Energy Management Insights
        const energyInsights: string[] = [];
        const avgSOC = filteredRecords.reduce((sum, r) => sum + (r.analysis?.soc || 0), 0) / filteredRecords.length;
        
        if (avgSOC < 40) {
            energyInsights.push(`Average SOC is low (${avgSOC.toFixed(1)}%). Consider increasing solar capacity or reducing load.`);
        } else if (avgSOC > 80) {
            energyInsights.push(`Excellent energy reserves maintained (avg ${avgSOC.toFixed(1)}% SOC).`);
        }

        const powers = filteredRecords.map(r => r.analysis?.power || 0);
        const avgPower = powers.reduce((sum, p) => sum + p, 0) / powers.length;
        const maxDischarge = Math.abs(Math.min(...powers));
        const maxCharge = Math.max(...powers);

        energyInsights.push(`Peak discharge: ${maxDischarge.toFixed(0)}W, Peak charge: ${maxCharge.toFixed(0)}W`);

        if (avgPower < 0) {
            energyInsights.push(`System is net discharging (${Math.abs(avgPower).toFixed(0)}W avg). Solar may be insufficient.`);
        }

        categories.push({
            title: 'Energy Management',
            insights: energyInsights,
            severity: avgSOC < 30 ? 'critical' : avgSOC < 50 ? 'warning' : 'info'
        });

        // Temperature Insights
        const tempInsights: string[] = [];
        const temps = filteredRecords.map(r => r.analysis?.temperature || 0).filter(t => t > 0);
        if (temps.length > 0) {
            const avgTemp = temps.reduce((sum, t) => sum + t, 0) / temps.length;
            const maxTemp = Math.max(...temps);
            const minTemp = Math.min(...temps);

            tempInsights.push(`Temperature range: ${minTemp.toFixed(1)}°C - ${maxTemp.toFixed(1)}°C (avg ${avgTemp.toFixed(1)}°C)`);

            if (avgTemp > 40) {
                tempInsights.push(`⚠️ Average temperature is high. Consider improving ventilation.`);
            } else if (avgTemp < 15) {
                tempInsights.push(`Low temperatures may reduce performance. Consider heating in winter.`);
            } else {
                tempInsights.push(`Temperature is within optimal range for battery chemistry.`);
            }

            categories.push({
                title: 'Temperature Management',
                insights: tempInsights,
                severity: avgTemp > 45 ? 'critical' : avgTemp > 35 ? 'warning' : 'info'
            });
        }

        // Cell Balance Insights
        const cellInsights: string[] = [];
        const deltas = filteredRecords
            .map(r => r.analysis?.cellVoltageDelta)
            .filter((d): d is number => d !== undefined);

        if (deltas.length > 0) {
            const avgDelta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
            const maxDelta = Math.max(...deltas);

            cellInsights.push(`Cell imbalance: ${(avgDelta * 1000).toFixed(0)}mV avg, ${(maxDelta * 1000).toFixed(0)}mV max`);

            if (avgDelta > 0.2) {
                cellInsights.push(`⚠️ High cell imbalance detected. BMS balancing may be needed.`);
            } else if (avgDelta < 0.05) {
                cellInsights.push(`✓ Excellent cell balance. BMS is working well.`);
            }

            categories.push({
                title: 'Cell Balance',
                insights: cellInsights,
                severity: avgDelta > 0.3 ? 'critical' : avgDelta > 0.15 ? 'warning' : 'info'
            });
        }

        // Usage Pattern Insights
        const usageInsights: string[] = [];
        const chargingRecords = filteredRecords.filter(r => (r.analysis?.power || 0) > 0);
        const dischargingRecords = filteredRecords.filter(r => (r.analysis?.power || 0) < 0);

        const chargingPercent = (chargingRecords.length / filteredRecords.length) * 100;
        const dischargingPercent = (dischargingRecords.length / filteredRecords.length) * 100;
        
        usageInsights.push(`Charging ${chargingPercent.toFixed(0)}% of the time, discharging ${dischargingPercent.toFixed(0)}%`);

        if (chargingPercent < 40) {
            usageInsights.push(`Low charging time. Consider adding solar panels or reducing load.`);
        }

        // Analyze discharge patterns
        if (dischargingRecords.length > 0) {
            const avgDischargePower = Math.abs(
                dischargingRecords.reduce((sum, r) => sum + (r.analysis?.power || 0), 0) / dischargingRecords.length
            );
            usageInsights.push(`Average discharge power: ${avgDischargePower.toFixed(0)}W`);
            
            if (avgDischargePower > 1000) {
                usageInsights.push(`High discharge rate detected. Consider load management or battery upgrade.`);
            }
        }

        categories.push({
            title: 'Usage Patterns',
            insights: usageInsights,
            severity: chargingPercent < 30 ? 'warning' : 'info'
        });

        setInsightCategories(categories);
    };

    const calculatePerformanceMetrics = () => {
        const filteredRecords = filterRecordsByTimeRange(records);
        if (filteredRecords.length === 0) return;

        const avgSOC = filteredRecords.reduce((sum, r) => sum + (r.analysis?.soc || 0), 0) / filteredRecords.length;
        const avgVoltage = filteredRecords.reduce((sum, r) => sum + (r.analysis?.voltage || 0), 0) / filteredRecords.length;
        const avgCurrent = filteredRecords.reduce((sum, r) => sum + Math.abs(r.analysis?.current || 0), 0) / filteredRecords.length;
        const avgPower = filteredRecords.reduce((sum, r) => sum + Math.abs(r.analysis?.power || 0), 0) / filteredRecords.length;

        // Calculate total energy (very rough estimate)
        const totalEnergy = filteredRecords.reduce((sum, r, index) => {
            if (index === 0) return sum;
            const prevRecord = filteredRecords[index - 1];
            const timeDiffHours = (new Date(r.timestamp).getTime() - new Date(prevRecord.timestamp).getTime()) / (1000 * 60 * 60);
            const avgPowerKW = ((r.analysis?.power || 0) + (prevRecord.analysis?.power || 0)) / 2 / 1000;
            return sum + (Math.abs(avgPowerKW) * timeDiffHours);
        }, 0);

        const cyclesSinceStart = Math.max(...filteredRecords.map(r => r.analysis?.cycles || 0)) - 
                                 Math.min(...filteredRecords.map(r => r.analysis?.cycles || 0));

        setPerformanceMetrics({
            avgSOC,
            avgVoltage,
            avgCurrent,
            avgPower,
            totalEnergy,
            cyclesSinceStart
        });
    };

    const handleExport = () => {
        const exportData = {
            systemId,
            timeRange: selectedTimeRange,
            generatedAt: new Date().toISOString(),
            insights: insightCategories,
            metrics: performanceMetrics,
            recordCount: records.length
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `battery-insights-${systemId || 'all'}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div className="bg-neutral-dark rounded-lg p-8 shadow-lg">
                <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-secondary"></div>
                    <span className="ml-4 text-lg">Loading insights...</span>
                </div>
            </div>
        );
    }

    if (!records || records.length === 0) {
        return (
            <div className="bg-neutral-dark rounded-lg p-8 shadow-lg text-center">
                <p className="text-gray-400 text-lg">No data available. Upload BMS screenshots to see insights.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header with Controls */}
            <div className="bg-neutral-dark rounded-lg p-6 shadow-lg">
                <div className="flex justify-between items-center">
                    <h2 className="text-3xl font-bold text-secondary">Battery Insights Dashboard</h2>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setShowHealthTrends(!showHealthTrends)}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                            {showHealthTrends ? 'Hide' : 'Show'} Health Trends
                        </button>
                        <button
                            onClick={handleExport}
                            className="px-4 py-2 bg-secondary text-white rounded hover:bg-opacity-90 transition-colors"
                        >
                            Export Insights
                        </button>
                    </div>
                </div>

                {/* Time Range Selector */}
                <div className="flex gap-2 mt-4">
                    {(['7d', '30d', '90d', 'all'] as const).map(range => (
                        <button
                            key={range}
                            onClick={() => setSelectedTimeRange(range)}
                            className={`px-4 py-2 rounded transition-colors ${
                                selectedTimeRange === range
                                    ? 'bg-secondary text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {range === 'all' ? 'All Time' : range.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Performance Metrics */}
            {performanceMetrics && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                        <h3 className="text-xs text-gray-400 mb-1">Avg SOC</h3>
                        <p className="text-2xl font-bold text-green-400">
                            {performanceMetrics.avgSOC.toFixed(1)}%
                        </p>
                    </div>
                    <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                        <h3 className="text-xs text-gray-400 mb-1">Avg Voltage</h3>
                        <p className="text-2xl font-bold text-blue-400">
                            {performanceMetrics.avgVoltage.toFixed(1)}V
                        </p>
                    </div>
                    <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                        <h3 className="text-xs text-gray-400 mb-1">Avg Current</h3>
                        <p className="text-2xl font-bold text-yellow-400">
                            {performanceMetrics.avgCurrent.toFixed(1)}A
                        </p>
                    </div>
                    <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                        <h3 className="text-xs text-gray-400 mb-1">Avg Power</h3>
                        <p className="text-2xl font-bold text-purple-400">
                            {performanceMetrics.avgPower.toFixed(0)}W
                        </p>
                    </div>
                    <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                        <h3 className="text-xs text-gray-400 mb-1">Total Energy</h3>
                        <p className="text-2xl font-bold text-cyan-400">
                            {performanceMetrics.totalEnergy.toFixed(1)} kWh
                        </p>
                    </div>
                    <div className="bg-neutral-dark rounded-lg p-4 shadow-lg">
                        <h3 className="text-xs text-gray-400 mb-1">Cycles</h3>
                        <p className="text-2xl font-bold text-orange-400">
                            {performanceMetrics.cyclesSinceStart}
                        </p>
                    </div>
                </div>
            )}

            {/* Health Trends (conditional) */}
            {showHealthTrends && (
                <BatteryHealthTrends 
                    systemId={systemId}
                    records={records}
                    timeRange={selectedTimeRange}
                />
            )}

            {/* Insight Categories */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {insightCategories.map((category, index) => (
                    <div 
                        key={index}
                        className={`bg-neutral-dark rounded-lg p-6 shadow-lg border-l-4 ${
                            category.severity === 'critical' ? 'border-red-500' :
                            category.severity === 'warning' ? 'border-yellow-500' :
                            'border-blue-500'
                        }`}
                    >
                        <h3 className={`text-xl font-semibold mb-4 ${
                            category.severity === 'critical' ? 'text-red-400' :
                            category.severity === 'warning' ? 'text-yellow-400' :
                            'text-blue-400'
                        }`}>
                            {category.title}
                        </h3>
                        <ul className="space-y-2">
                            {category.insights.map((insight, idx) => (
                                <li key={idx} className="text-gray-300 text-sm flex items-start gap-2">
                                    <span className="text-secondary mt-1">•</span>
                                    <span>{insight}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            {/* Summary */}
            <div className="bg-neutral-dark rounded-lg p-6 shadow-lg">
                <h3 className="text-xl font-semibold text-secondary mb-3">Summary</h3>
                <p className="text-gray-300">
                    Analyzed {filterRecordsByTimeRange(records).length} records over the selected time range.
                    {insightCategories.some(c => c.severity === 'critical') && (
                        <span className="text-red-400 font-semibold"> Critical issues detected - immediate attention recommended.</span>
                    )}
                    {insightCategories.some(c => c.severity === 'warning') && !insightCategories.some(c => c.severity === 'critical') && (
                        <span className="text-yellow-400 font-semibold"> Some warnings detected - monitor closely.</span>
                    )}
                    {!insightCategories.some(c => c.severity !== 'info') && (
                        <span className="text-green-400 font-semibold"> System is operating normally.</span>
                    )}
                </p>
            </div>
        </div>
    );
};

export default BatteryInsights;
