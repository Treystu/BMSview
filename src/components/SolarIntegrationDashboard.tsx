import React, { useState } from 'react';
import { SolarEstimatePanel } from './SolarEstimatePanel';
import { SolarEfficiencyChart } from './SolarEfficiencyChart';
import type { SolarEstimateResponse, BatterySystemConfig } from '../types/solar';
import type { AnalysisRecord } from '../types';
import { 
  extractBatteryEnergyData, 
  correlateSolarWithBattery, 
  analyzeEfficiency 
} from '../utils/solarCorrelation';

interface SolarIntegrationDashboardProps {
  bmsRecords: AnalysisRecord[];
  systemConfig?: BatterySystemConfig;
}

export const SolarIntegrationDashboard: React.FC<SolarIntegrationDashboardProps> = ({
  bmsRecords,
  systemConfig,
}) => {
  const [solarEstimate, setSolarEstimate] = useState<SolarEstimateResponse | null>(null);
  const [showEfficiency, setShowEfficiency] = useState(false);

  const handleEstimateLoaded = (estimate: SolarEstimateResponse) => {
    setSolarEstimate(estimate);
    setShowEfficiency(true);
  };

  const efficiencyAnalysis = React.useMemo(() => {
    if (!solarEstimate || !systemConfig) return null;

    // Extract battery energy data from BMS records
    const batteryData = extractBatteryEnergyData(
      bmsRecords,
      systemConfig.nominalVoltage
    );

    // Correlate solar estimates with battery charging
    const correlations = correlateSolarWithBattery(
      solarEstimate,
      batteryData,
      70 // 70% efficiency threshold
    );

    // Analyze overall efficiency
    return analyzeEfficiency(correlations);
  }, [solarEstimate, bmsRecords, systemConfig]);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg shadow-lg p-6">
        <h1 className="text-3xl font-bold mb-2">
          ☀️ Solar Integration Dashboard
        </h1>
        <p className="text-blue-100">
          Analyze solar energy potential and correlate with battery charging performance
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SolarEstimatePanel
          systemConfig={{
            panelWatts: 400,
            nominalVoltage: systemConfig?.nominalVoltage || 12,
            maxSolarAmps: 30,
            latitude: systemConfig?.location?.latitude,
            longitude: systemConfig?.location?.longitude,
          }}
          onEstimateLoaded={handleEstimateLoaded}
        />

        {showEfficiency && efficiencyAnalysis && (
          <SolarEfficiencyChart analysis={efficiencyAnalysis} />
        )}
      </div>

      {!showEfficiency && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <p className="text-yellow-800 font-medium">
            👆 Enter your location and panel specifications above to get started with solar analysis
          </p>
        </div>
      )}

      {showEfficiency && !efficiencyAnalysis && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <p className="text-blue-800 font-medium">
            ℹ️ No BMS charging data available for correlation analysis. Upload BMS records to see efficiency metrics.
          </p>
        </div>
      )}
    </div>
  );
};