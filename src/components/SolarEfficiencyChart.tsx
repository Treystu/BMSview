import React, { useMemo } from 'react';
import type { EfficiencyAnalysis } from '../types/solar';
import { formatEfficiency, getEfficiencyStatus } from '../utils/solarCorrelation';

interface SolarEfficiencyChartProps {
  analysis: EfficiencyAnalysis;
}

export const SolarEfficiencyChart: React.FC<SolarEfficiencyChartProps> = ({ analysis }) => {
  const recommendations = useMemo(() => {
    const recs: string[] = [];

    if (analysis.averageEfficiency < 70) {
      recs.push('⚠️ Average efficiency is below 70%. Check for shading, panel degradation, or wiring issues.');
    }

    if (analysis.anomalyCount > analysis.correlations.length * 0.3) {
      recs.push('🔧 High number of anomalies detected. Inspect charge controller and battery connections.');
    }

    if (analysis.peakEfficiency < 85) {
      recs.push('🧹 Peak efficiency is below 85%. Consider panel cleaning or angle adjustment.');
    }

    const actualVsExpected = (analysis.totalActualWh / analysis.totalExpectedWh) * 100;
    if (actualVsExpected < 60) {
      recs.push('⚡ Actual charging is significantly below expected. System may be undersized or faulty.');
    }

    if (recs.length === 0) {
      recs.push('✅ System efficiency is within normal parameters. Continue monitoring.');
    }

    return recs;
  }, [analysis]);

  const getStatusColor = (status: 'good' | 'warning' | 'critical') => {
    switch (status) {
      case 'good': return 'text-green-700 bg-green-100';
      case 'warning': return 'text-yellow-700 bg-yellow-100';
      case 'critical': return 'text-red-700 bg-red-100';
    }
  };

  const avgStatus = getEfficiencyStatus(analysis.averageEfficiency);
  const peakStatus = getEfficiencyStatus(analysis.peakEfficiency);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        ⚡ Solar-Battery Efficiency Analysis
      </h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            Average Efficiency
          </h3>
          <p className={`text-3xl font-bold ${getStatusColor(avgStatus)}`}>
            {formatEfficiency(analysis.averageEfficiency)}
          </p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-green-900 mb-2">
            Peak Efficiency
          </h3>
          <p className={`text-3xl font-bold ${getStatusColor(peakStatus)}`}>
            {formatEfficiency(analysis.peakEfficiency)}
          </p>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-red-900 mb-2">
            Anomalies Detected
          </h3>
          <p className="text-3xl font-bold text-red-700">
            {analysis.anomalyCount}
          </p>
          <p className="text-xs text-gray-600">
            out of {analysis.correlations.length} days
          </p>
        </div>
      </div>

      {/* Energy Comparison */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          Energy Comparison
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Expected Solar Input</p>
            <p className="text-2xl font-bold text-blue-700">
              {(analysis.totalExpectedWh / 1000).toFixed(2)} kWh
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Actual Battery Gain</p>
            <p className="text-2xl font-bold text-green-700">
              {(analysis.totalActualWh / 1000).toFixed(2)} kWh
            </p>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Charging Efficiency</span>
            <span className="font-semibold">
              {((analysis.totalActualWh / analysis.totalExpectedWh) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all"
              style={{ 
                width: `${Math.min((analysis.totalActualWh / analysis.totalExpectedWh) * 100, 100)}%` 
              }}
            />
          </div>
        </div>
      </div>

      {/* Daily Correlations */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          Daily Performance
        </h3>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {analysis.correlations.map((correlation, index) => {
            const status = getEfficiencyStatus(correlation.efficiency);
            return (
              <div 
                key={index}
                className={`flex justify-between items-center p-3 rounded-lg ${
                  correlation.isAnomaly ? 'bg-red-50 border border-red-200' : 'bg-white border border-gray-200'
                }`}
              >
                <div className="flex-1">
                  <p className="font-medium text-sm">{correlation.timestamp}</p>
                  <div className="flex gap-4 text-xs text-gray-600 mt-1">
                    <span>Expected: {(correlation.expectedSolarWh / 1000).toFixed(2)} kWh</span>
                    <span>Actual: {(correlation.actualBatteryWh / 1000).toFixed(2)} kWh</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(status)}`}>
                    {formatEfficiency(correlation.efficiency)}
                  </span>
                  {correlation.isAnomaly && (
                    <p className="text-xs text-red-600 mt-1">⚠️ Anomaly</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">
          💡 Recommendations
        </h3>
        <ul className="space-y-2">
          {recommendations.map((rec, index) => (
            <li key={index} className="text-sm text-gray-700 flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span>{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};