import React, { useEffect, useState, useCallback } from 'react';
import SpinnerIcon from './icons/SpinnerIcon';

interface DailyBreakdown {
    date: string;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    operationCount: number;
    successCount: number;
    errorCount: number;
    avgDuration: number;
    successRate: number;
    breakdown: {
        analysis: number;
        insights: number;
        feedback: number;
    };
}

interface BudgetInfo {
    monthly: number;
    current: number;
    remaining: number;
    usagePercent: number;
    alertThreshold: number;
    inputTokens?: number;
    outputTokens?: number;
}

interface TokenBudgetInfo extends BudgetInfo {
    inputTokens: number;
    outputTokens: number;
}

interface CostBudgetInfo {
    monthly: number;
    current: number;
    remaining: number;
    usagePercent: number;
}

interface UsageStats {
    period: string;
    dateRange: {
        start: string;
        end: string;
    };
    summary: {
        totalCost: number;
        totalTokens: number;
        averageCostPerOperation: number;
        operationBreakdown: {
            analysis: { count: number; cost: number; tokens: number };
            insights: { count: number; cost: number; tokens: number };
            feedbackGeneration: { count: number; cost: number; tokens: number };
        };
    };
    dailyBreakdown: DailyBreakdown[];
    realtime: {
        currentOperationsPerMinute: number;
        averageLatency: number;
        errorRate: number;
        circuitBreakerStatus: string;
    };
    // Token budget (primary)
    tokenBudget?: TokenBudgetInfo;
    // Cost budget (secondary)
    costBudget?: CostBudgetInfo;
    // Operation breakdown
    operationBreakdown?: {
        analysis: number;
        insights: number;
        total: number;
    };
    // Legacy budget field (backwards compatibility)
    budget: {
        budget: BudgetInfo;
        status: 'healthy' | 'warning' | 'exceeded';
        recentAlerts: Array<{
            id: string;
            type: string;
            severity: string;
            message: string;
            timestamp: string;
        }>;
    };
}

type Period = 'daily' | 'weekly' | 'monthly';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'CostDashboard',
        message,
        context
    }));
};

const fetchUsageStats = async (period: Period): Promise<UsageStats> => {
    const response = await fetch(`/.netlify/functions/usage-stats?period=${period}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch usage stats: ${response.status}`);
    }
    return await response.json();
};

// Simple bar chart component using div elements
const BarChart: React.FC<{
    data: DailyBreakdown[];
    maxValue: number;
}> = ({ data, maxValue }) => {
    if (data.length === 0) {
        return <div className="text-gray-500 text-center py-8">No data available</div>;
    }
    
    return (
        <div className="flex items-end gap-1 h-48 px-2">
            {data.map((day, index) => {
                const height = maxValue > 0 ? (day.totalCost / maxValue) * 100 : 0;
                const date = new Date(day.date);
                const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                
                return (
                    <div key={day.date} className="flex-1 flex flex-col items-center group relative">
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                            <div>{label}</div>
                            <div>${day.totalCost.toFixed(4)}</div>
                            <div>{day.operationCount} ops</div>
                        </div>
                        
                        {/* Bar */}
                        <div 
                            className="w-full bg-blue-500 hover:bg-blue-400 rounded-t transition-all cursor-pointer"
                            style={{ 
                                height: `${Math.max(height, 2)}%`,
                                minHeight: height > 0 ? '4px' : '0'
                            }}
                        />
                        
                        {/* Label */}
                        {data.length <= 14 && (
                            <span className="text-xs text-gray-500 mt-1 transform -rotate-45 origin-top-left">
                                {label}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// Budget gauge component - now shows TOKENS as primary metric
const BudgetGauge: React.FC<{
    budget: BudgetInfo;
    status: 'healthy' | 'warning' | 'exceeded';
    isTokenBased?: boolean;
}> = ({ budget, status, isTokenBased = true }) => {
    const getStatusColor = () => {
        switch (status) {
            case 'exceeded': return 'text-red-500';
            case 'warning': return 'text-yellow-500';
            default: return 'text-green-500';
        }
    };
    
    const getBarColor = () => {
        switch (status) {
            case 'exceeded': return 'bg-red-500';
            case 'warning': return 'bg-yellow-500';
            default: return 'bg-green-500';
        }
    };
    
    // Format large numbers (tokens)
    const formatNumber = (num: number): string => {
        if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
        if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
        return num.toLocaleString();
    };
    
    const unit = isTokenBased ? 'tokens' : '';
    const currentDisplay = isTokenBased ? formatNumber(budget.current) : `$${budget.current.toFixed(4)}`;
    const remainingDisplay = isTokenBased ? formatNumber(budget.remaining) : `$${budget.remaining.toFixed(4)}`;
    const monthlyDisplay = isTokenBased ? formatNumber(budget.monthly) : `$${budget.monthly.toFixed(2)}`;
    
    return (
        <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold">
                    Monthly {isTokenBased ? 'Token' : 'Cost'} Budget
                </h3>
                <span className={`font-bold ${getStatusColor()}`}>
                    {status === 'exceeded' ? '⚠️ Exceeded' : status === 'warning' ? '⚠️ Warning' : '✓ Healthy'}
                </span>
            </div>
            
            <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden mb-2">
                <div 
                    className={`h-full ${getBarColor()} transition-all`}
                    style={{ width: `${Math.min(budget.usagePercent, 100)}%` }}
                />
                {/* Alert threshold marker */}
                <div 
                    className="absolute top-0 h-full w-0.5 bg-yellow-300"
                    style={{ left: `${budget.alertThreshold}%` }}
                />
            </div>
            
            <div className="flex justify-between text-sm text-gray-400">
                <span>{currentDisplay} {unit} used</span>
                <span>{remainingDisplay} {unit} remaining</span>
            </div>
            
            <div className="text-center mt-2">
                <span className="text-2xl font-bold">{budget.usagePercent.toFixed(1)}%</span>
                <span className="text-gray-500 ml-2">of {monthlyDisplay} {unit}</span>
            </div>
            
            {/* Show input/output breakdown for token budgets */}
            {isTokenBased && budget.inputTokens !== undefined && budget.outputTokens !== undefined && (
                <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
                    <span>Input: {formatNumber(budget.inputTokens)}</span>
                    <span>Output: {formatNumber(budget.outputTokens)}</span>
                </div>
            )}
        </div>
    );
};

const CostDashboard: React.FC = () => {
    const [stats, setStats] = useState<UsageStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [period, setPeriod] = useState<Period>('weekly');
    
    const loadStats = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            log('info', 'Fetching usage stats', { period });
            const data = await fetchUsageStats(period);
            setStats(data);
            log('info', 'Usage stats loaded', { 
                totalCost: data.summary?.totalCost,
                days: data.dailyBreakdown?.length 
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load usage stats';
            log('error', 'Failed to load usage stats', { error: message });
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [period]);
    
    useEffect(() => {
        loadStats();
    }, [loadStats]);
    
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <SpinnerIcon className="w-8 h-8 text-secondary" />
                <span className="ml-4">Loading cost data...</span>
            </div>
        );
    }
    
    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-500 rounded-lg p-4">
                <h3 className="font-bold text-red-400">Error Loading Cost Data</h3>
                <p className="text-red-300">{error}</p>
                <button 
                    onClick={loadStats}
                    className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white"
                >
                    Retry
                </button>
            </div>
        );
    }
    
    if (!stats) {
        return <div className="text-gray-500">No data available</div>;
    }
    
    const maxCost = Math.max(...stats.dailyBreakdown.map(d => d.totalCost), 0.001);
    
    return (
        <div className="space-y-6">
            {/* Header with period selector */}
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold">AI Cost Dashboard</h2>
                <div className="flex gap-2">
                    {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-3 py-1 rounded text-sm font-medium transition ${
                                period === p 
                                    ? 'bg-blue-600 text-white' 
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                        </button>
                    ))}
                    <button
                        onClick={loadStats}
                        className="px-3 py-1 rounded text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600"
                    >
                        ↻ Refresh
                    </button>
                </div>
            </div>
            
            {/* Budget Status - Token Budget (Primary) and Cost Budget (Secondary) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Token Budget - Primary */}
                {stats.tokenBudget ? (
                    <BudgetGauge 
                        budget={stats.tokenBudget} 
                        status={stats.budget?.status || 'healthy'} 
                        isTokenBased={true}
                    />
                ) : stats.budget && (
                    <BudgetGauge 
                        budget={stats.budget.budget} 
                        status={stats.budget.status} 
                        isTokenBased={true}
                    />
                )}
                
                {/* Cost Budget - Secondary */}
                {stats.costBudget && (
                    <BudgetGauge 
                        budget={{
                            ...stats.costBudget,
                            alertThreshold: 80 // Default threshold for cost
                        }} 
                        status={stats.costBudget.usagePercent >= 100 ? 'exceeded' : 
                                stats.costBudget.usagePercent >= 80 ? 'warning' : 'healthy'} 
                        isTokenBased={false}
                    />
                )}
            </div>
            
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm">Total Cost</div>
                    <div className="text-2xl font-bold text-green-400">
                        ${stats.summary?.totalCost?.toFixed(4) || '0.0000'}
                    </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm">Total Tokens</div>
                    <div className="text-2xl font-bold text-blue-400">
                        {(stats.summary?.totalTokens || 0).toLocaleString()}
                    </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm">Avg Cost/Op</div>
                    <div className="text-2xl font-bold text-yellow-400">
                        ${stats.summary?.averageCostPerOperation?.toFixed(6) || '0.000000'}
                    </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                    <div className="text-gray-400 text-sm">Operations</div>
                    <div className="text-2xl font-bold text-purple-400">
                        {stats.operationBreakdown?.total || stats.dailyBreakdown.reduce((sum, d) => sum + d.operationCount, 0)}
                    </div>
                    {stats.operationBreakdown && (
                        <div className="text-xs text-gray-500 mt-1">
                            {stats.operationBreakdown.analysis} analysis, {stats.operationBreakdown.insights} insights
                        </div>
                    )}
                </div>
            </div>
            
            {/* Daily Cost Chart */}
            <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Daily AI Costs</h3>
                <BarChart data={stats.dailyBreakdown} maxValue={maxCost} />
            </div>
            
            {/* Operation Breakdown */}
            <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Operation Breakdown</h3>
                <div className="grid grid-cols-3 gap-4">
                    {stats.summary?.operationBreakdown && Object.entries(stats.summary.operationBreakdown).map(([op, data]) => (
                        <div key={op} className="bg-gray-700 rounded p-3">
                            <div className="text-gray-400 text-sm capitalize">{op.replace(/([A-Z])/g, ' $1').trim()}</div>
                            <div className="text-xl font-bold">{data.count}</div>
                            <div className="text-xs text-gray-500">
                                ${data.cost?.toFixed(4) || '0.0000'} • {(data.tokens || 0).toLocaleString()} tokens
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            
            {/* Realtime Metrics */}
            {stats.realtime && (
                <div className="bg-gray-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold mb-4">Realtime Metrics</h3>
                    <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                            <div className="text-2xl font-bold">{stats.realtime.currentOperationsPerMinute}</div>
                            <div className="text-gray-500 text-sm">Ops/min</div>
                        </div>
                        <div>
                            <div className="text-2xl font-bold">{stats.realtime.averageLatency}ms</div>
                            <div className="text-gray-500 text-sm">Avg Latency</div>
                        </div>
                        <div>
                            <div className="text-2xl font-bold">{(stats.realtime.errorRate * 100).toFixed(1)}%</div>
                            <div className="text-gray-500 text-sm">Error Rate</div>
                        </div>
                        <div>
                            <div className={`text-2xl font-bold ${
                                stats.realtime.circuitBreakerStatus === 'CLOSED' ? 'text-green-400' : 'text-red-400'
                            }`}>
                                {stats.realtime.circuitBreakerStatus}
                            </div>
                            <div className="text-gray-500 text-sm">Circuit Breaker</div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Recent Alerts */}
            {stats.budget?.recentAlerts && stats.budget.recentAlerts.length > 0 && (
                <div className="bg-gray-800 rounded-lg p-4">
                    <h3 className="text-lg font-semibold mb-4">Recent Alerts</h3>
                    <div className="space-y-2">
                        {stats.budget.recentAlerts.map(alert => (
                            <div 
                                key={alert.id} 
                                className={`p-3 rounded border-l-4 ${
                                    alert.severity === 'critical' ? 'bg-red-900/20 border-red-500' :
                                    alert.severity === 'high' ? 'bg-orange-900/20 border-orange-500' :
                                    'bg-yellow-900/20 border-yellow-500'
                                }`}
                            >
                                <div className="flex justify-between">
                                    <span className="font-medium">{alert.type}</span>
                                    <span className="text-gray-500 text-sm">
                                        {new Date(alert.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-400">{alert.message}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            {/* Date Range Info */}
            <div className="text-center text-gray-500 text-sm">
                Data from {new Date(stats.dateRange.start).toLocaleDateString()} to {new Date(stats.dateRange.end).toLocaleDateString()}
            </div>
        </div>
    );
};

export default CostDashboard;
