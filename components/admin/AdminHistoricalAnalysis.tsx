import React, { useState, useCallback } from 'react';
import type { AnalysisRecord, BmsSystem } from '../../types';
import HistoricalChart from '../HistoricalChart';
import TrendingOverview from './analytics/TrendingOverview';
import ToolsPanel from './analytics/ToolsPanel';
import AlertAnalysis from './AlertAnalysis';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import SpinnerIcon from '../icons/SpinnerIcon';

interface AdminHistoricalAnalysisProps {
    systems: BmsSystem[];
    history: AnalysisRecord[];
    isLoading: boolean;
    isCacheBuilding: boolean;
}

const AdminHistoricalAnalysis: React.FC<AdminHistoricalAnalysisProps> = ({
    systems,
    history,
    isLoading,
    isCacheBuilding
}) => {
    const [selectedSystemId, setSelectedSystemId] = useState<string>('');
    const [visibleTimeRange, setVisibleTimeRange] = useState<{ start: number; end: number } | null>(null);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    // Use analytics hook for data management
    const {
        analyticsData,
        isLoading: analyticsLoading,
        error: analyticsError,
        filteredHistory,
        visibleAlerts,
        refreshAnalytics
    } = useAnalyticsData({
        selectedSystemId,
        history,
        visibleTimeRange
    });

    // Handle zoom domain changes from chart
    const handleZoomDomainChange = useCallback((start: number, end: number) => {
        setVisibleTimeRange({ start, end });
    }, []);

    // Handle quick range selection
    const handleQuickRangeSelect = useCallback((range: 'Last 24h' | '7 Days' | '30 Days') => {
        const now = new Date();
        const end = now.toISOString().slice(0, 16); // Format for datetime-local
        
        let start: Date;
        switch (range) {
            case 'Last 24h':
                start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7 Days':
                start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30 Days':
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
        }
        
        setStartDate(start.toISOString().slice(0, 16));
        setEndDate(end);
    }, []);

    // Handle analyze history action
    const handleAnalyzeHistory = useCallback(() => {
        // TODO: Implement admin-specific insights generation
        // This should trigger generate-insights-with-tools with admin context
        console.log('Analyze History triggered for system:', selectedSystemId);
        alert('AI Analysis feature coming soon! This will generate comprehensive insights for the selected system.');
    }, [selectedSystemId]);

    // Handle predict maintenance action
    const handlePredictMaintenance = useCallback(() => {
        // TODO: Implement predictive maintenance analysis
        console.log('Predict Maintenance triggered for system:', selectedSystemId);
        alert('Predictive Maintenance feature coming soon! This will analyze degradation trends and predict maintenance needs.');
    }, [selectedSystemId]);

    return (
        <section>
            <h2 className="text-2xl font-semibold text-secondary mb-4 border-b border-gray-600 pb-2">
                Historical Analysis
                {isCacheBuilding && (
                    <span className="text-sm font-normal text-gray-400 ml-4">
                        (Building full chart data: {history.length} records loaded...)
                    </span>
                )}
            </h2>

            {/* Trending Overview Section */}
            <div className="mb-6">
                <TrendingOverview
                    systems={systems}
                    selectedSystemId={selectedSystemId}
                    analyticsData={analyticsData}
                    isLoading={analyticsLoading}
                    onQuickRangeSelect={handleQuickRangeSelect}
                />
            </div>

            {/* Main Chart and Tools Grid */}
            <div className="grid lg:grid-cols-4 gap-6 mb-6">
                {/* Chart Section (3 columns) */}
                <div className="lg:col-span-3">
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        {isLoading && history.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 min-h-[600px]">
                                <SpinnerIcon className="w-8 h-8 text-secondary" />
                                <span className="ml-4">Loading Initial Chart Data...</span>
                            </div>
                        ) : history.length > 0 || !isCacheBuilding ? (
                            <HistoricalChart
                                systems={systems}
                                history={history}
                                enableAdminFeatures={true}
                                onZoomDomainChange={handleZoomDomainChange}
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-400 min-h-[600px]">
                                <SpinnerIcon className="w-8 h-8 text-secondary" />
                                <span className="ml-4">Loading historical data for chart...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Tools Panel (1 column) */}
                <div className="lg:col-span-1">
                    <ToolsPanel
                        selectedSystemId={selectedSystemId}
                        onAnalyzeHistory={handleAnalyzeHistory}
                        onPredictMaintenance={handlePredictMaintenance}
                    />
                </div>
            </div>

            {/* Alert Analysis Section - Context Aware */}
            {analyticsData && analyticsData.alertAnalysis && analyticsData.alertAnalysis.totalAlerts > 0 && (
                <div className="mb-6">
                    <div className="bg-gray-800 p-4 rounded-lg shadow-inner">
                        <div className="mb-4">
                            <h3 className="text-lg font-semibold text-white">
                                Context-Aware Alert Analysis
                            </h3>
                            {visibleTimeRange && (
                                <p className="text-sm text-gray-400 mt-1">
                                    Showing alerts within visible time range: {
                                        new Date(visibleTimeRange.start).toLocaleString('en-US', { 
                                            month: 'short', 
                                            day: 'numeric', 
                                            hour: '2-digit', 
                                            minute: '2-digit',
                                            timeZone: 'UTC'
                                        })
                                    } - {
                                        new Date(visibleTimeRange.end).toLocaleString('en-US', { 
                                            month: 'short', 
                                            day: 'numeric', 
                                            hour: '2-digit', 
                                            minute: '2-digit',
                                            timeZone: 'UTC'
                                        })
                                    } UTC
                                </p>
                            )}
                        </div>
                        <AlertAnalysis data={analyticsData.alertAnalysis} />
                        
                        {/* Visible Alerts List */}
                        {visibleAlerts.length > 0 && (
                            <div className="mt-4 border-t border-gray-700 pt-4">
                                <h4 className="text-sm font-semibold text-white mb-2">
                                    Recent Alerts in View ({visibleAlerts.length})
                                </h4>
                                <div className="max-h-60 overflow-y-auto space-y-2">
                                    {visibleAlerts.slice(0, 10).map((alert, idx) => (
                                        <div 
                                            key={idx}
                                            className={`p-2 rounded text-xs ${
                                                alert.type === 'critical' ? 'bg-red-900/30 border border-red-700' :
                                                alert.type === 'warning' ? 'bg-yellow-900/30 border border-yellow-700' :
                                                'bg-blue-900/30 border border-blue-700'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between">
                                                <span className="text-gray-300">{alert.message}</span>
                                                <span className="text-gray-500 text-xs ml-2 whitespace-nowrap">
                                                    {new Date(alert.timestamp).toLocaleTimeString('en-US', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                        timeZone: 'UTC'
                                                    })}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    {visibleAlerts.length > 10 && (
                                        <p className="text-xs text-gray-500 text-center py-2">
                                            ...and {visibleAlerts.length - 10} more alerts
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Error Display */}
            {analyticsError && (
                <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
                    <p className="text-sm text-red-300">
                        <strong>Analytics Error:</strong> {analyticsError}
                    </p>
                </div>
            )}
        </section>
    );
};

export default AdminHistoricalAnalysis;
