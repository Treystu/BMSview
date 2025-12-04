import React, { useEffect, useState } from 'react';
import { getSystemAnalytics, type SystemAnalytics } from '../../services/clientService';
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
          <p>Hourly Data Points: {analytics.hourlyAverages.length}</p>
          <p>Alert Events: {analytics.alertAnalysis.totalEvents}</p>
          <p>Total Alert Duration: {Math.round(analytics.alertAnalysis.totalDurationMinutes)} min</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Performance Baseline</h2>
          <p>Sunny Day Charging Hours: {analytics.performanceBaseline.sunnyDayChargingAmpsByHour.length}</p>
          {analytics.performanceBaseline.sunnyDayChargingAmpsByHour.length > 0 && (
            <p>Peak Charging Hour: {analytics.performanceBaseline.sunnyDayChargingAmpsByHour.reduce((max, curr) => 
              curr.avgCurrent > max.avgCurrent ? curr : max
            ).hour}:00 UTC</p>
          )}
        </div>
        <div className="bg-gray-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Top Alerts</h2>
          <ul className="space-y-1 text-sm">
            {analytics.alertAnalysis.events.slice(0, 5).map((event) => (
              <li key={event.alert} className="truncate">
                {event.alert}: {event.count} events
              </li>
            ))}
            {analytics.alertAnalysis.events.length === 0 && (
              <li className="text-gray-500">No alerts</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MonitoringDashboard;