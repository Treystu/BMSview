import React, { useState, useEffect } from 'react';
import type { SolarEstimateResponse, SolarSystemConfig } from '../types/solar';
import { 
  fetchSolarEstimate, 
  calculateTotalEstimatedEnergy,
  separateHistoricalAndForecast,
  getPeakSolarHour,
  getDateRangeForLastDays,
  validateLocation
} from '../services/solarService';

interface SolarEstimatePanelProps {
  systemConfig?: SolarSystemConfig;
  onEstimateLoaded?: (estimate: SolarEstimateResponse) => void;
}

export const SolarEstimatePanel: React.FC<SolarEstimatePanelProps> = ({ 
  systemConfig,
  onEstimateLoaded 
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<SolarEstimateResponse | null>(null);
  
  // Form state
  const [location, setLocation] = useState(systemConfig?.zipCode || '');
  const [panelWatts, setPanelWatts] = useState(systemConfig?.panelWatts || 400);
  const [days, setDays] = useState(7);

  useEffect(() => {
    // Auto-populate location from system config
    if (systemConfig?.latitude && systemConfig?.longitude) {
      setLocation(`${systemConfig.latitude},${systemConfig.longitude}`);
    } else if (systemConfig?.zipCode) {
      setLocation(systemConfig.zipCode);
    }
  }, [systemConfig]);

  const handleFetchEstimate = async () => {
    if (!location) {
      setError('Please enter a location (zip code or coordinates)');
      return;
    }

    if (!validateLocation(location)) {
      setError('Invalid location format. Use 5-digit zip code or "lat,lon" format');
      return;
    }

    if (panelWatts <= 0) {
      setError('Panel wattage must be greater than 0');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { startDate, endDate } = getDateRangeForLastDays(days);
      
      const result = await fetchSolarEstimate({
        location,
        panelWatts,
        startDate,
        endDate,
      });

      setEstimate(result);
      onEstimateLoaded?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch solar estimate');
    } finally {
      setLoading(false);
    }
  };

  const renderEstimateResults = () => {
    if (!estimate) return null;

    const totalEnergy = calculateTotalEstimatedEnergy(estimate);
    const { historical, forecast } = separateHistoricalAndForecast(estimate);
    const peakHour = getPeakSolarHour(estimate.hourlyBreakdown);

    return (
      <div className="mt-6 space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            Solar Estimate Summary
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Location</p>
              <p className="font-medium">{estimate.locationName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Panel Rating</p>
              <p className="font-medium">{estimate.panelWatts} Wp</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Estimated Energy</p>
              <p className="font-medium">{(totalEnergy / 1000).toFixed(2)} kWh</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Days Analyzed</p>
              <p className="font-medium">{estimate.dailyEstimates.length}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-green-900 mb-2">
              Historical Data
            </h4>
            <p className="text-2xl font-bold text-green-700">
              {historical.length}
            </p>
            <p className="text-xs text-gray-600">days of past data</p>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-purple-900 mb-2">
              Forecast Data
            </h4>
            <p className="text-2xl font-bold text-purple-700">
              {forecast.length}
            </p>
            <p className="text-xs text-gray-600">days of forecast</p>
          </div>
        </div>

        {peakHour && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-yellow-900 mb-2">
              Peak Solar Generation
            </h4>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-lg font-bold text-yellow-700">
                  {peakHour.estimated_wh.toFixed(0)} Wh
                </p>
                <p className="text-xs text-gray-600">
                  {new Date(peakHour.timestamp).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">Irradiance</p>
                <p className="font-medium">{peakHour.irradiance_w_m2.toFixed(0)} W/m²</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">
            Daily Breakdown
          </h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {estimate.dailyEstimates.map((day) => (
              <div 
                key={day.date} 
                className="flex justify-between items-center py-2 border-b border-gray-200 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{day.date}</span>
                  {day.isForecast && (
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                      Forecast
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold">
                  {(day.estimatedWh / 1000).toFixed(2)} kWh
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        ☀️ Solar Energy Estimate
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Location (Zip Code or Coordinates)
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., 80942 or 19.44,-154.94"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter a 5-digit US zip code or GPS coordinates as latitude,longitude
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Panel Wattage (Wp)
          </label>
          <input
            type="number"
            value={panelWatts}
            onChange={(e) => setPanelWatts(Number(e.target.value))}
            min="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Days to Analyze
          </label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <button
          onClick={handleFetchEstimate}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Fetching Estimate...' : 'Get Solar Estimate'}
        </button>
      </div>

      {renderEstimateResults()}
    </div>
  );
};