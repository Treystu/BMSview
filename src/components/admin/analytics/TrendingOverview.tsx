import React, { useState, useEffect } from 'react';
import type { SystemAnalytics } from '../../../services/clientService';
import type { BmsSystem } from '../../../types';
import SpinnerIcon from '../../icons/SpinnerIcon';

interface TrendingOverviewProps {
    systems: BmsSystem[];
    selectedSystemId: string;
    analyticsData: SystemAnalytics | null;
    isLoading: boolean;
    onQuickRangeSelect?: (range: 'Last 24h' | '7 Days' | '30 Days') => void;
}

const TrendingOverview: React.FC<TrendingOverviewProps> = ({
    systems,
    selectedSystemId,
    analyticsData,
    isLoading,
    onQuickRangeSelect
}) => {
    const selectedSystem = systems.find(s => s.id === selectedSystemId);
    
    // Calculate aggregate metrics from analytics data
    const calculateMetrics = () => {
        if (!analyticsData) return null;

        const { hourlyAverages, alertAnalysis } = analyticsData;

        // Calculate average daily efficiency (based on charge/discharge balance)
        let totalChargeHours = 0;
        let totalDischargeHours = 0;
        let avgChargingCurrent = 0;
        let avgDischargingCurrent = 0;

        hourlyAverages.forEach(({ metrics }) => {
            if (metrics.current) {
                if (metrics.current.chargePoints > 0) {
                    totalChargeHours++;
                    avgChargingCurrent += metrics.current.avgCharge;
                }
                if (metrics.current.dischargePoints > 0) {
                    totalDischargeHours++;
                    avgDischargingCurrent += Math.abs(metrics.current.avgDischarge);
                }
            }
        });

        const chargeDischargeRatio = totalDischargeHours > 0 
            ? (avgChargingCurrent / totalChargeHours) / (avgDischargingCurrent / totalDischargeHours)
            : 0;

        // Calculate daily energy throughput estimate
        const avgDailyCharge = (avgChargingCurrent / totalChargeHours) * totalChargeHours || 0;
        const avgDailyDischarge = (avgDischargingCurrent / totalDischargeHours) * totalDischargeHours || 0;

        return {
            avgChargingCurrent: totalChargeHours > 0 ? avgChargingCurrent / totalChargeHours : 0,
            avgDischargingCurrent: totalDischargeHours > 0 ? avgDischargingCurrent / totalDischargeHours : 0,
            chargeDischargeRatio,
            avgDailyCharge,
            avgDailyDischarge,
            totalAlerts: alertAnalysis.totalEvents,
            uniqueAlertTypes: alertAnalysis.events.length
        };
    };

    const metrics = calculateMetrics();

    if (isLoading) {
        return (
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="flex items-center justify-center h-48">
                    <SpinnerIcon className="w-8 h-8 text-secondary" />
                    <span className="ml-4 text-gray-400">Loading analytics...</span>
                </div>
            </div>
        );
    }

    if (!analyticsData || !metrics) {
        return (
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="text-center text-gray-400 py-8">
                    <p className="text-lg mb-2">No analytics data available</p>
                    <p className="text-sm">Select a system and date range to view trending insights</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-gray-700 pb-4">
                <div>
                    <h2 className="text-2xl font-bold text-white">Trending Intelligence</h2>
                    <p className="text-sm text-gray-400 mt-1">
                        {selectedSystem?.name || 'Unknown System'} • Performance Overview
                    </p>
                </div>
                
                {/* Quick Range Toggles */}
                {onQuickRangeSelect && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => onQuickRangeSelect('Last 24h')}
                            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                        >
                            Last 24h
                        </button>
                        <button
                            onClick={() => onQuickRangeSelect('7 Days')}
                            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                        >
                            7 Days
                        </button>
                        <button
                            onClick={() => onQuickRangeSelect('30 Days')}
                            className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                        >
                            30 Days
                        </button>
                    </div>
                )}
            </div>

            {/* Metric Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Avg Charging Current */}
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wide text-gray-400">Avg Charge Rate</span>
                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {metrics.avgChargingCurrent.toFixed(1)} <span className="text-sm text-gray-400">A</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Typical charging current</p>
                </div>

                {/* Avg Discharging Current */}
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wide text-gray-400">Avg Load Current</span>
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {metrics.avgDischargingCurrent.toFixed(1)} <span className="text-sm text-gray-400">A</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Typical discharge rate</p>
                </div>

                {/* Daily Efficiency Estimate */}
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wide text-gray-400">Charge/Discharge Ratio</span>
                        <div className={`w-2 h-2 rounded-full ${
                            metrics.chargeDischargeRatio >= 1 ? 'bg-green-500' : 
                            metrics.chargeDischargeRatio >= 0.8 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}></div>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {metrics.chargeDischargeRatio.toFixed(2)}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        {metrics.chargeDischargeRatio >= 1 ? 'Surplus' : 
                         metrics.chargeDischargeRatio >= 0.8 ? 'Balanced' : 'Deficit'}
                    </p>
                </div>

                {/* Total Alerts */}
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wide text-gray-400">Total Alerts</span>
                        <div className={`w-2 h-2 rounded-full ${
                            metrics.totalAlerts === 0 ? 'bg-green-500' : 
                            metrics.totalAlerts < 10 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}></div>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {metrics.totalAlerts}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        {metrics.uniqueAlertTypes} unique type{metrics.uniqueAlertTypes !== 1 ? 's' : ''}
                    </p>
                </div>
            </div>

            {/* Additional Summary Info */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                <h3 className="text-sm font-semibold text-white mb-3">System Profile</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Chemistry:</span>
                        <span className="ml-2 text-white font-medium">{selectedSystem?.chemistry || 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Voltage:</span>
                        <span className="ml-2 text-white font-medium">{selectedSystem?.voltage || 'N/A'}V</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Capacity:</span>
                        <span className="ml-2 text-white font-medium">{selectedSystem?.capacity || 'N/A'}Ah</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Location:</span>
                        <span className="ml-2 text-white font-medium">
                            {selectedSystem?.latitude != null && selectedSystem?.longitude != null
                                ? `${selectedSystem.latitude.toFixed(4)}, ${selectedSystem.longitude.toFixed(4)}`
                                : 'N/A'
                            }
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TrendingOverview;
