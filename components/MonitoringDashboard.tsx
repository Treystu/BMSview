import React, { useState, useEffect } from 'react';
import type { MonitoringDashboardData, AnomalyAlert, CostMetrics } from '../types';

interface MonitoringDashboardProps {
  className?: string;
}

export const MonitoringDashboard: React.FC<MonitoringDashboardProps> = ({ className = '' }) => {
  const [dashboardData, setDashboardData] = useState<MonitoringDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<number>(30000); // 30 seconds default
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchDashboardData = async () => {
    try {
      setError(null);
      const response = await fetch('/.netlify/functions/monitoring?type=dashboard');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch monitoring data: ${response.statusText}`);
      }

      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching monitoring data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();

    if (autoRefresh) {
      const interval = setInterval(fetchDashboardData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refreshInterval]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-100';
      case 'high':
        return 'text-orange-600 bg-orange-100';
      case 'medium':
        return 'text-yellow-600 bg-yellow-100';
      case 'low':
        return 'text-blue-600 bg-blue-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  if (loading && !dashboardData) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading monitoring data...</p>
        </div>
      </div>
    );
  }

  if (error && !dashboardData) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error Loading Monitoring Data</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
            <button
              onClick={fetchDashboardData}
              className="mt-2 text-sm text-red-800 underline hover:text-red-900"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return null;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with Controls */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">AI System Monitoring</h2>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Auto-refresh</span>
          </label>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            disabled={!autoRefresh}
            className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="10000">10s</option>
            <option value="30000">30s</option>
            <option value="60000">1m</option>
            <option value="300000">5m</option>
          </select>
          <button
            onClick={fetchDashboardData}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Realtime Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Operations/min</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {dashboardData.realtimeMetrics.currentOperationsPerMinute}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Latency</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {dashboardData.realtimeMetrics.averageLatency}ms
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Error Rate</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {(dashboardData.realtimeMetrics.errorRate * 100).toFixed(1)}%
              </p>
            </div>
            <div className={`p-3 rounded-full ${
              dashboardData.realtimeMetrics.errorRate > 0.1 ? 'bg-red-100' : 'bg-green-100'
            }`}>
              <svg className={`w-6 h-6 ${
                dashboardData.realtimeMetrics.errorRate > 0.1 ? 'text-red-600' : 'text-green-600'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Circuit Breaker</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {dashboardData.realtimeMetrics.circuitBreakerStatus}
              </p>
            </div>
            <div className={`p-3 rounded-full ${
              dashboardData.realtimeMetrics.circuitBreakerStatus === 'OPEN' ? 'bg-red-100' : 'bg-green-100'
            }`}>
              <svg className={`w-6 h-6 ${
                dashboardData.realtimeMetrics.circuitBreakerStatus === 'OPEN' ? 'text-red-600' : 'text-green-600'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Cost Metrics */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Cost Analysis</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Cost</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {formatCurrency(dashboardData.costMetrics.totalCost)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Total Tokens</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {formatNumber(dashboardData.costMetrics.totalTokens)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Avg Cost/Op</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {formatCurrency(dashboardData.costMetrics.averageCostPerOperation)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Period</p>
            <p className="text-xl font-bold text-gray-900 mt-1 capitalize">
              {dashboardData.costMetrics.period}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border rounded-lg p-4">
            <p className="text-sm font-medium text-gray-600 mb-2">Analysis</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(dashboardData.costMetrics.operationBreakdown.analysis.cost)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {formatNumber(dashboardData.costMetrics.operationBreakdown.analysis.count)} operations
            </p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm font-medium text-gray-600 mb-2">Insights</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(dashboardData.costMetrics.operationBreakdown.insights.cost)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {formatNumber(dashboardData.costMetrics.operationBreakdown.insights.count)} operations
            </p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm font-medium text-gray-600 mb-2">Feedback</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(dashboardData.costMetrics.operationBreakdown.feedbackGeneration.cost)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {formatNumber(dashboardData.costMetrics.operationBreakdown.feedbackGeneration.count)} operations
            </p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {dashboardData.recentAlerts.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Alerts</h3>
          <div className="space-y-3">
            {dashboardData.recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start p-3 rounded-lg ${getSeverityColor(alert.severity)}`}
              >
                <div className="flex-1">
                  <div className="flex items-center">
                    <span className="text-xs font-semibold uppercase mr-2">
                      {alert.severity}
                    </span>
                    <span className="text-xs text-gray-600">
                      {new Date(alert.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium">{alert.message}</p>
                  <p className="text-xs mt-1 opacity-75">{alert.type}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback Statistics */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Feedback Implementation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Suggestions</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {dashboardData.feedbackStats.totalSuggestions}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Implementation Rate</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {(dashboardData.feedbackStats.implementationRate * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Avg Effectiveness</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {dashboardData.feedbackStats.averageEffectiveness.toFixed(1)}/100
            </p>
          </div>
        </div>
      </div>

      {/* Performance Trends Chart */}
      {dashboardData.performanceTrends.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Trends (24h)</h3>
          <div className="h-64 flex items-end space-x-2">
            {dashboardData.performanceTrends.map((trend, idx) => {
              const maxDuration = Math.max(...dashboardData.performanceTrends.map(t => t.avgDuration));
              const height = maxDuration > 0 ? (trend.avgDuration / maxDuration) * 100 : 0;
              const totalOps = trend.successCount + trend.errorCount;
              const errorRate = totalOps > 0 ? (trend.errorCount / totalOps) * 100 : 0;
              
              return (
                <div key={idx} className="flex-1 flex flex-col items-center">
                  <div className="w-full bg-gray-200 rounded-t relative" style={{ height: `${height}%` }}>
                    <div
                      className="absolute bottom-0 w-full bg-blue-500 rounded-t"
                      style={{ height: `${100 - errorRate}%` }}
                    />
                    <div
                      className="absolute bottom-0 w-full bg-red-500 rounded-t"
                      style={{ height: `${errorRate}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate w-full text-center">
                    {new Date(trend.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-center space-x-4 text-sm">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-500 rounded mr-2"></div>
              <span>Success</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded mr-2"></div>
              <span>Error</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitoringDashboard;
