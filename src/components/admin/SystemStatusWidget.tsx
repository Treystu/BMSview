
import React from 'react';
import { useAdaptivePolling } from '../../hooks/useAdaptivePolling';

export const SystemStatusWidget: React.FC = () => {
  const { data, loading, error, isIdle } = useAdaptivePolling();

  if (!data && loading) return <div className="text-gray-400 text-sm">Loading system status...</div>;
  if (error) return <div className="text-red-400 text-sm">Status Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-inner mb-6 border border-gray-700">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          System Status
        </h3>
        <span className="text-xs text-gray-500">
          {isIdle ? 'Idle Mode (30s)' : 'Active Mode (5s)'}
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        {/* Health */}
        <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
          <div className="text-xs text-gray-400 mb-1">Database</div>
          <div className={`font-mono font-bold ${data.health.mongodb === 'healthy' ? 'text-green-400' : 'text-red-400'}`}>
            {data.health.mongodb.toUpperCase()}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {data.health.recentAnalyses} analyses (1h)
          </div>
        </div>

        {/* Analysis Queue */}
        <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
          <div className="text-xs text-gray-400 mb-1">Recent Activity</div>
          <div className="font-mono font-bold text-blue-400">
            {data.analysis.count} Events
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Last 5 mins
          </div>
        </div>

        {/* Insights Jobs */}
        <div className="bg-gray-700/50 p-3 rounded border border-gray-600">
          <div className="text-xs text-gray-400 mb-1">Active AI Jobs</div>
          <div className="font-mono font-bold text-purple-400">
            {data.insights.count} Running
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {data.insights.activeJobs?.length ? 'Processing...' : 'Queue Clear'}
          </div>
        </div>
      </div>
    </div>
  );
};
