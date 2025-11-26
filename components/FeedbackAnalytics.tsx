import React, { useState, useEffect } from 'react';

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
  lastUpdated: string;
}

export const FeedbackAnalytics: React.FC = () => {
  const [analytics, setAnalytics] = useState<FeedbackAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/.netlify/functions/feedback-analytics');

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
          <p className="mt-2 text-sm text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800 text-sm">Error: {error}</p>
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

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Total Feedback</div>
          <div className="text-3xl font-bold text-gray-900">{analytics.totalFeedback}</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Acceptance Rate</div>
          <div className="text-3xl font-bold text-green-600">{analytics.acceptanceRate}%</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Implementation Rate</div>
          <div className="text-3xl font-bold text-blue-600">{analytics.implementationRate}%</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-1">Avg. Review Time</div>
          <div className="text-3xl font-bold text-purple-600">
            {analytics.averageTimeToReview !== null ? `${analytics.averageTimeToReview}d` : 'N/A'}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status Distribution */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">By Status</h3>
          <div className="space-y-2">
            {Object.entries(analytics.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="text-sm capitalize text-gray-700">{status}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${(count / analytics.totalFeedback) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-8 text-right">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Distribution */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">By Priority</h3>
          <div className="space-y-2">
            {Object.entries(analytics.byPriority)
              .sort((a, b) => {
                const order = { critical: 0, high: 1, medium: 2, low: 3 };
                return (order[a[0] as keyof typeof order] || 4) - (order[b[0] as keyof typeof order] || 4);
              })
              .map(([priority, count]) => {
                const colors = {
                  critical: 'bg-red-600',
                  high: 'bg-orange-600',
                  medium: 'bg-blue-600',
                  low: 'bg-gray-600'
                };
                return (
                  <div key={priority} className="flex items-center justify-between">
                    <span className="text-sm capitalize text-gray-700">{priority}</span>
                    <div className="flex items-center space-x-2">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div
                          className={`${colors[priority as keyof typeof colors]} h-2 rounded-full`}
                          style={{ width: `${(count / analytics.totalFeedback) * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-medium text-gray-900 w-8 text-right">{count}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Top Categories */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Categories</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {analytics.topCategories.map(({ category, count }) => (
            <div key={category} className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-600 mt-1 capitalize">
                {category.replace('_', ' ')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Trends */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">Last 30 Days</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-blue-700">Total Submissions</div>
            <div className="text-2xl font-bold text-blue-900">{analytics.recentTrends.total}</div>
          </div>
          <div>
            <div className="text-sm text-red-700">Critical Priority</div>
            <div className="text-2xl font-bold text-red-900">{analytics.recentTrends.critical}</div>
          </div>
          <div>
            <div className="text-sm text-orange-700">High Priority</div>
            <div className="text-2xl font-bold text-orange-900">{analytics.recentTrends.high}</div>
          </div>
          <div>
            <div className="text-sm text-green-700">Implemented</div>
            <div className="text-2xl font-bold text-green-900">{analytics.recentTrends.implemented}</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-500 text-center">
        Last updated: {new Date(analytics.lastUpdated).toLocaleString()}
      </div>
    </div>
  );
};
