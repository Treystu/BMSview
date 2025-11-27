import React, { useEffect, useState } from 'react';
import { getSystemAnalytics } from '../../services/clientService';
import type { SystemAnalytics } from '../../types';
import SpinnerIcon from '../icons/SpinnerIcon';

const MonitoringDashboard = () => {
  const [analytics, setAnalytics] = useState<SystemAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        // Assuming you have a way to get the current systemId.
        // For now, I'll use a placeholder.
        const systemId = 'default-system';
        const data = await getSystemAnalytics(systemId);
        setAnalytics(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch analytics.');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <SpinnerIcon className="w-8 h-8 text-secondary" />
        <span className="ml-4">Loading Analytics...</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  if (!analytics) {
    return <div>No analytics data available.</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">AI Feedback Monitoring</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gray-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">System Health</h2>
          <p>Total Records: {analytics.recordCount}</p>
          <p>Alerts: {analytics.alertAnalysis.totalAlerts}</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Performance Baseline</h2>
          <p>Median SOC: {analytics.performanceBaseline?.medianSOC?.toFixed(2)}%</p>
          <p>Median Voltage: {analytics.performanceBaseline?.medianVoltage?.toFixed(2)}V</p>
          <p>Median Current: {analytics.performanceBaseline?.medianCurrent?.toFixed(2)}A</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Alerts</h2>
          <ul>
            {analytics.alertAnalysis.alertCounts.map((alert) => (
              <li key={alert.alert}>
                {alert.alert}: {alert.count}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MonitoringDashboard;