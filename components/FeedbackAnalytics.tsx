/**
 * FeedbackAnalytics Component
 * 
 * Displays comprehensive analytics and metrics for the AI feedback system.
 * Shows implementation rates, ROI calculations, time-to-implementation metrics,
 * effectiveness scores, and user satisfaction tracking.
 * 
 * @component
 * @example
 * ```tsx
 * <FeedbackAnalytics />
 * ```
 * 
 * Features:
 * - Summary cards with key metrics (total, acceptance rate, implementation rate, avg review time)
 * - Implementation metrics by priority, category, and effort
 * - ROI summary with top implementations
 * - Time-to-implementation trends and breakdown
 * - Effectiveness scoring overview
 * - User satisfaction tracking
 * - Monthly breakdown and trends
 * - Auto-refresh capability
 * - Loading and error states
 */
import React, { useState, useEffect } from 'react';

interface FeedbackROIMetrics {
  feedbackId: string;
  feedbackTitle: string;
  category: string;
  estimatedEffort: string;
  actualEffortHours?: number;
  costSavingsEstimate?: number;
  actualBenefitScore?: number;
  implementedAt?: string;
}

interface EffectivenessScore {
  feedbackId: string;
  totalScore: number;
  implementationSpeed?: number | null;
  roiScore?: number | null;
  stabilityScore?: number;
}

interface FeedbackAnalytics {
  totalFeedback: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  acceptanceRate: number;
  implementationRate: number;
  averageTimeToReview: number | null;
  averageTimeToImplementation: number | null;
  topCategories: Array<{ category: string; count: number }>;
  recentTrends: {
    total: number;
    critical: number;
    high: number;
    implemented: number;
  };
  implementationMetrics?: {
    byPriority: Record<string, { total: number; implemented: number; rate: number }>;
    byCategory: Record<string, { total: number; implemented: number; rate: number }>;
    byEffort: Record<string, { total: number; implemented: number; avgDays: number | null }>;
  };
  roiSummary?: {
    totalEstimatedSavings: number;
    averageROIScore: number;
    topROIImplementations: FeedbackROIMetrics[];
  };
  timeToImplementation?: {
    averageDays: number | null;
    medianDays: number | null;
    p90Days: number | null;
    byPriority: Record<string, number | null>;
    trend: Array<{ month: string; avgDays: number | null; count: number }>;
  };
  effectivenessOverview?: {
    averageScore: number | null;
    scoreDistribution: Array<{ range: string; count: number }>;
    topPerformers: EffectivenessScore[];
    bottomPerformers: EffectivenessScore[];
  };
  userSatisfaction?: {
    averageScore: number | null;
    surveyCount: number;
    satisfactionTrend: Array<{ month: string; avgScore: number | null; count: number }>;
    impactRating: number | null;
    recommendations: number;
  };
  monthlyBreakdown?: Array<{
    month: string;
    newSuggestions: number;
    implemented: number;
    avgTimeToImplement: number | null;
    avgEffectiveness: number | null;
  }>;
  lastUpdated: string;
}

export const FeedbackAnalytics: React.FC = () => {
  const [analytics, setAnalytics] = useState<FeedbackAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'implementation' | 'roi' | 'effectiveness' | 'trends'>('overview');

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      // Build headers with Netlify Identity token for authentication
      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };
      
      // Add Netlify Identity token if available (admin-only endpoint)
      if (typeof window !== 'undefined' && (window as any).netlifyIdentity?.currentUser) {
        try {
          const user = (window as any).netlifyIdentity.currentUser();
          if (user) {
            const token = await user.jwt();
            if (token) {
              headers['Authorization'] = `Bearer ${token}`;
            }
          }
        } catch (tokenErr) {
          console.warn('Could not get auth token:', tokenErr);
        }
      }

      const response = await fetch('/.netlify/functions/feedback-analytics', { headers });

      if (response.status === 401) {
        throw new Error('Authentication required. Please ensure you are logged in to the Admin Dashboard.');
      }

      if (!response.ok) {
        throw new Error('Failed to fetch analytics');
      }

      const data = await response.json();
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-sm text-gray-400">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-500 rounded-lg p-4">
        <p className="text-red-300 text-sm">Error: {error}</p>
        <button
          onClick={fetchAnalytics}
          className="mt-2 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const renderTabs = () => (
    <div className="flex space-x-1 border-b border-gray-700 mb-6">
      {[
        { id: 'overview', label: '📊 Overview' },
        { id: 'implementation', label: '🎯 Implementation' },
        { id: 'roi', label: '💰 ROI' },
        { id: 'effectiveness', label: '⭐ Effectiveness' },
        { id: 'trends', label: '📈 Trends' }
      ].map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as typeof activeTab)}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeTab === tab.id
              ? 'bg-gray-700 text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <div className="text-sm text-gray-400 mb-1">Total Feedback</div>
          <div className="text-3xl font-bold text-white">{analytics.totalFeedback}</div>
        </div>

        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <div className="text-sm text-gray-400 mb-1">Acceptance Rate</div>
          <div className="text-3xl font-bold text-green-400">{analytics.acceptanceRate}%</div>
        </div>

        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <div className="text-sm text-gray-400 mb-1">Implementation Rate</div>
          <div className="text-3xl font-bold text-blue-400">{analytics.implementationRate}%</div>
        </div>

        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <div className="text-sm text-gray-400 mb-1">Avg. Time to Implement</div>
          <div className="text-3xl font-bold text-purple-400">
            {analytics.timeToImplementation?.averageDays !== null 
              ? `${analytics.timeToImplementation.averageDays}d` 
              : analytics.averageTimeToImplementation !== null 
                ? `${analytics.averageTimeToImplementation}d`
                : 'N/A'}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status Distribution */}
        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">By Status</h3>
          <div className="space-y-2">
            {Object.entries(analytics.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="text-sm capitalize text-gray-300">{status}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-32 bg-gray-600 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${(count / analytics.totalFeedback) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-white w-8 text-right">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Distribution */}
        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">By Priority</h3>
          <div className="space-y-2">
            {Object.entries(analytics.byPriority)
              .sort((a, b) => {
                const order = { critical: 0, high: 1, medium: 2, low: 3 };
                return (order[a[0] as keyof typeof order] || 4) - (order[b[0] as keyof typeof order] || 4);
              })
              .map(([priority, count]) => {
                const colors: Record<string, string> = {
                  critical: 'bg-red-500',
                  high: 'bg-orange-500',
                  medium: 'bg-blue-500',
                  low: 'bg-gray-500'
                };
                return (
                  <div key={priority} className="flex items-center justify-between">
                    <span className="text-sm capitalize text-gray-300">{priority}</span>
                    <div className="flex items-center space-x-2">
                      <div className="w-32 bg-gray-600 rounded-full h-2">
                        <div
                          className={`${colors[priority]} h-2 rounded-full`}
                          style={{ width: `${(count / analytics.totalFeedback) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium text-white w-8 text-right">{count}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Top Categories */}
      <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Top Categories</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {analytics.topCategories.map(({ category, count }) => (
            <div key={category} className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{count}</div>
              <div className="text-xs text-gray-400 mt-1 capitalize">
                {category.replace('_', ' ')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Trends */}
      <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-blue-300 mb-3">Last 30 Days</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-blue-400">Total Submissions</div>
            <div className="text-2xl font-bold text-blue-200">{analytics.recentTrends.total}</div>
          </div>
          <div>
            <div className="text-sm text-red-400">Critical Priority</div>
            <div className="text-2xl font-bold text-red-300">{analytics.recentTrends.critical}</div>
          </div>
          <div>
            <div className="text-sm text-orange-400">High Priority</div>
            <div className="text-2xl font-bold text-orange-300">{analytics.recentTrends.high}</div>
          </div>
          <div>
            <div className="text-sm text-green-400">Implemented</div>
            <div className="text-2xl font-bold text-green-300">{analytics.recentTrends.implemented}</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderImplementation = () => {
    const impl = analytics.implementationMetrics;
    if (!impl) {
      return <div className="text-gray-400 text-center py-8">Implementation metrics not available</div>;
    }

    return (
      <div className="space-y-6">
        {/* By Priority */}
        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Implementation Rate by Priority</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Object.entries(impl.byPriority).map(([priority, data]) => (
              <div key={priority} className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-sm text-gray-400 capitalize mb-2">{priority}</div>
                <div className="text-3xl font-bold text-white">{data.rate}%</div>
                <div className="text-xs text-gray-500 mt-1">
                  {data.implemented}/{data.total} implemented
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Category */}
        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Implementation Rate by Category</h3>
          <div className="space-y-3">
            {Object.entries(impl.byCategory)
              .sort((a, b) => b[1].rate - a[1].rate)
              .map(([category, data]) => (
                <div key={category} className="flex items-center justify-between">
                  <span className="text-sm text-gray-300 capitalize w-32">{category.replace('_', ' ')}</span>
                  <div className="flex-1 mx-4">
                    <div className="w-full bg-gray-600 rounded-full h-4">
                      <div
                        className="bg-green-500 h-4 rounded-full flex items-center justify-end pr-2"
                        style={{ width: `${Math.max(data.rate, 10)}%` }}
                      >
                        <span className="text-xs text-white font-medium">{data.rate}%</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-sm text-gray-400 w-20 text-right">
                    {data.implemented}/{data.total}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* By Effort */}
        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Implementation by Estimated Effort</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(impl.byEffort).map(([effort, data]) => (
              <div key={effort} className="bg-gray-800 rounded-lg p-4">
                <div className="text-lg font-semibold text-white capitalize mb-2">{effort}</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Total</span>
                    <span className="text-white">{data.total}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Implemented</span>
                    <span className="text-green-400">{data.implemented}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Avg. Time</span>
                    <span className="text-blue-400">{data.avgDays !== null ? `${data.avgDays}d` : 'N/A'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderROI = () => {
    const roi = analytics.roiSummary;
    if (!roi) {
      return <div className="text-gray-400 text-center py-8">ROI metrics not available</div>;
    }

    return (
      <div className="space-y-6">
        {/* ROI Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
            <div className="text-sm text-green-400 mb-1">Total Estimated Savings</div>
            <div className="text-3xl font-bold text-green-300">
              {formatCurrency(roi.totalEstimatedSavings)}
            </div>
            <div className="text-xs text-green-500 mt-1">From implemented suggestions</div>
          </div>

          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
            <div className="text-sm text-blue-400 mb-1">Average ROI Score</div>
            <div className="text-3xl font-bold text-blue-300">{roi.averageROIScore}/100</div>
            <div className="text-xs text-blue-500 mt-1">Based on benefit assessments</div>
          </div>

          <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-4">
            <div className="text-sm text-purple-400 mb-1">Top Implementations</div>
            <div className="text-3xl font-bold text-purple-300">{roi.topROIImplementations.length}</div>
            <div className="text-xs text-purple-500 mt-1">High-value changes delivered</div>
          </div>
        </div>

        {/* Top ROI Implementations Table */}
        <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Top ROI Implementations</h3>
          {roi.topROIImplementations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-600">
                    <th className="pb-2">Title</th>
                    <th className="pb-2">Category</th>
                    <th className="pb-2">Effort</th>
                    <th className="pb-2 text-right">Est. Savings</th>
                    <th className="pb-2 text-right">Benefit Score</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.topROIImplementations.map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-700">
                      <td className="py-2 text-white">{item.feedbackTitle}</td>
                      <td className="py-2 text-gray-300 capitalize">{item.category.replace('_', ' ')}</td>
                      <td className="py-2 text-gray-300 capitalize">{item.estimatedEffort}</td>
                      <td className="py-2 text-green-400 text-right">
                        {formatCurrency(item.costSavingsEstimate || 0)}
                      </td>
                      <td className="py-2 text-blue-400 text-right">
                        {item.actualBenefitScore !== undefined ? `${item.actualBenefitScore}/100` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-400 text-center py-4">No implemented suggestions yet</div>
          )}
        </div>
      </div>
    );
  };

  const renderEffectiveness = () => {
    const eff = analytics.effectivenessOverview;
    const sat = analytics.userSatisfaction;
    
    return (
      <div className="space-y-6">
        {/* Effectiveness Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
            <div className="text-sm text-yellow-400 mb-1">Avg. Effectiveness</div>
            <div className="text-3xl font-bold text-yellow-300">
              {eff?.averageScore !== null ? `${eff.averageScore}/100` : 'N/A'}
            </div>
          </div>

          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
            <div className="text-sm text-blue-400 mb-1">User Satisfaction</div>
            <div className="text-3xl font-bold text-blue-300">
              {sat?.averageScore !== null ? `${sat.averageScore}/5` : 'N/A'}
            </div>
          </div>

          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
            <div className="text-sm text-green-400 mb-1">Survey Responses</div>
            <div className="text-3xl font-bold text-green-300">{sat?.surveyCount || 0}</div>
          </div>

          <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-4">
            <div className="text-sm text-purple-400 mb-1">Would Recommend</div>
            <div className="text-3xl font-bold text-purple-300">{sat?.recommendations || 0}</div>
          </div>
        </div>

        {/* Score Distribution */}
        {eff?.scoreDistribution && (
          <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Effectiveness Score Distribution</h3>
            <div className="flex items-end justify-around h-32">
              {eff.scoreDistribution.map((bucket, idx) => {
                const maxCount = Math.max(...eff.scoreDistribution.map(b => b.count), 1);
                const heightPercent = (bucket.count / maxCount) * 100;
                const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'];
                return (
                  <div key={bucket.range} className="flex flex-col items-center">
                    {bucket.count > 0 ? (
                      <div 
                        className={`w-12 ${colors[idx]} rounded-t`}
                        style={{ height: `${heightPercent}%` }}
                      ></div>
                    ) : (
                      <div 
                        className="w-12 bg-gray-600/40 rounded-t flex items-center justify-center"
                        style={{ height: '8px' }}
                      >
                        {/* Empty bar for zero count */}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-2">{bucket.range}</div>
                    <div className={`text-sm font-medium ${bucket.count > 0 ? 'text-white' : 'text-gray-500'}`}>{bucket.count}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top & Bottom Performers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-green-900/20 border border-green-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-green-300 mb-4">🏆 Top Performers</h3>
            {eff?.topPerformers && eff.topPerformers.length > 0 ? (
              <div className="space-y-2">
                {eff.topPerformers.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-gray-800/50 rounded p-2">
                    <span className="text-sm text-gray-300 truncate flex-1 mr-2">
                      {item.feedbackId.substring(0, 8)}...
                    </span>
                    <span className="text-green-400 font-bold">{item.totalScore}/100</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-400 text-sm">No data available</div>
            )}
          </div>

          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-red-300 mb-4">📉 Needs Improvement</h3>
            {eff?.bottomPerformers && eff.bottomPerformers.length > 0 ? (
              <div className="space-y-2">
                {eff.bottomPerformers.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-gray-800/50 rounded p-2">
                    <span className="text-sm text-gray-300 truncate flex-1 mr-2">
                      {item.feedbackId.substring(0, 8)}...
                    </span>
                    <span className="text-red-400 font-bold">{item.totalScore}/100</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-400 text-sm">No data available</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderTrends = () => {
    const timeImpl = analytics.timeToImplementation;
    const monthly = analytics.monthlyBreakdown;

    return (
      <div className="space-y-6">
        {/* Time to Implementation by Priority */}
        {timeImpl && (
          <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Time to Implementation</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-gray-800 rounded p-3 text-center">
                <div className="text-sm text-gray-400">Average</div>
                <div className="text-2xl font-bold text-blue-400">
                  {timeImpl.averageDays !== null ? `${timeImpl.averageDays}d` : 'N/A'}
                </div>
              </div>
              <div className="bg-gray-800 rounded p-3 text-center">
                <div className="text-sm text-gray-400">Median</div>
                <div className="text-2xl font-bold text-green-400">
                  {timeImpl.medianDays !== null ? `${timeImpl.medianDays}d` : 'N/A'}
                </div>
              </div>
              <div className="bg-gray-800 rounded p-3 text-center">
                <div className="text-sm text-gray-400">P90</div>
                <div className="text-2xl font-bold text-orange-400">
                  {timeImpl.p90Days !== null ? `${timeImpl.p90Days}d` : 'N/A'}
                </div>
              </div>
              <div className="bg-gray-800 rounded p-3 text-center">
                <div className="text-sm text-gray-400">Review Time</div>
                <div className="text-2xl font-bold text-purple-400">
                  {analytics.averageTimeToReview !== null ? `${analytics.averageTimeToReview}d` : 'N/A'}
                </div>
              </div>
            </div>

            {/* By Priority */}
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-400 mb-2">By Priority (avg days)</h4>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(timeImpl.byPriority).map(([priority, days]) => (
                  <div key={priority} className="bg-gray-800 rounded p-2 text-center">
                    <div className="text-xs text-gray-500 capitalize">{priority}</div>
                    <div className="text-lg font-bold text-white">
                      {days !== null ? `${days}d` : 'N/A'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Monthly Trend Chart */}
        {timeImpl?.trend && timeImpl.trend.length > 0 && (
          <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Implementation Time Trend</h3>
            <div className="flex items-end justify-around h-32">
              {timeImpl.trend.map((item) => {
                const maxDays = Math.max(...timeImpl.trend.map(t => t.avgDays || 0), 1);
                const heightPercent = item.avgDays !== null ? (item.avgDays / maxDays) * 100 : 0;
                return (
                  <div key={item.month} className="flex flex-col items-center">
                    <div className="text-xs text-gray-400 mb-1">{item.count}</div>
                    <div 
                      className="w-10 bg-blue-500 rounded-t"
                      style={{ height: `${Math.max(heightPercent, 5)}%` }}
                    ></div>
                    <div className="text-xs text-gray-400 mt-2">{item.month.slice(5)}</div>
                    <div className="text-xs text-white">{item.avgDays !== null ? `${item.avgDays}d` : '-'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly Breakdown Table */}
        {monthly && monthly.length > 0 && (
          <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Monthly Breakdown (Last 12 Months)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-600">
                    <th className="pb-2">Month</th>
                    <th className="pb-2 text-right">New</th>
                    <th className="pb-2 text-right">Implemented</th>
                    <th className="pb-2 text-right">Avg Time</th>
                    <th className="pb-2 text-right">Effectiveness</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.slice(-6).reverse().map((row) => (
                    <tr key={row.month} className="border-b border-gray-700">
                      <td className="py-2 text-white">{row.month}</td>
                      <td className="py-2 text-gray-300 text-right">{row.newSuggestions}</td>
                      <td className="py-2 text-green-400 text-right">{row.implemented}</td>
                      <td className="py-2 text-blue-400 text-right">
                        {row.avgTimeToImplement !== null ? `${row.avgTimeToImplement}d` : '-'}
                      </td>
                      <td className="py-2 text-yellow-400 text-right">
                        {row.avgEffectiveness !== null ? `${row.avgEffectiveness}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {renderTabs()}
      
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'implementation' && renderImplementation()}
      {activeTab === 'roi' && renderROI()}
      {activeTab === 'effectiveness' && renderEffectiveness()}
      {activeTab === 'trends' && renderTrends()}

      {/* Footer */}
      <div className="text-xs text-gray-500 text-center pt-4">
        Last updated: {new Date(analytics.lastUpdated).toLocaleString()}
        <button
          onClick={fetchAnalytics}
          className="ml-4 text-blue-400 hover:text-blue-300"
        >
          🔄 Refresh
        </button>
      </div>
    </div>
  );
};
