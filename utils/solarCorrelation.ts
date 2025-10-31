import type { 
  BatteryEnergyData, 
  SolarCorrelation, 
  EfficiencyAnalysis,
  SolarEstimateResponse,
  HourlyBreakdown
} from '../types/solar';
import type { AnalysisRecord } from '../types';

/**
 * Converts Amp-hours to Watt-hours
 */
export function ahToWh(ah: number, voltage: number): number {
  return ah * voltage;
}

/**
 * Converts Watt-hours to Amp-hours
 */
export function whToAh(wh: number, voltage: number): number {
  if (voltage === 0) return 0;
  return wh / voltage;
}

/**
 * Calculates maximum theoretical solar input in Watts
 */
export function calculateMaxSolarInput(
  nominalVoltage: number,
  maxSolarAmps: number
): number {
  return nominalVoltage * maxSolarAmps;
}

/**
 * Extracts battery energy data from BMS analysis records
 */
export function extractBatteryEnergyData(
  records: AnalysisRecord[],
  nominalVoltage: number
): BatteryEnergyData[] {
  const sortedRecords = [...records].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const energyData: BatteryEnergyData[] = [];

  for (let i = 1; i < sortedRecords.length; i++) {
    const current = sortedRecords[i];
    const previous = sortedRecords[i - 1];

    const currentAh = current.analysis?.remainingCapacity || 0;
    const previousAh = previous.analysis?.remainingCapacity || 0;
    const ahChange = currentAh - previousAh;

    // Only include positive changes (charging)
    if (ahChange > 0) {
      energyData.push({
        timestamp: current.timestamp,
        ahChange,
        nominalVoltage,
        energyWh: ahToWh(ahChange, nominalVoltage),
      });
    }
  }

  return energyData;
}

/**
 * Correlates solar estimates with battery charging data
 */
export function correlateSolarWithBattery(
  solarData: SolarEstimateResponse,
  batteryData: BatteryEnergyData[],
  efficiencyThreshold: number = 70 // Percentage
): SolarCorrelation[] {
  const correlations: SolarCorrelation[] = [];

  // Group battery data by date
  const batteryByDate = new Map<string, number>();
  batteryData.forEach(data => {
    const date = data.timestamp.split('T')[0];
    const existing = batteryByDate.get(date) || 0;
    batteryByDate.set(date, existing + data.energyWh);
  });

  // Correlate with solar daily estimates
  solarData.dailyEstimates.forEach(solarDay => {
    const actualBatteryWh = batteryByDate.get(solarDay.date) || 0;
    const expectedSolarWh = solarDay.estimatedWh;
    
    // Calculate efficiency (avoid division by zero)
    const efficiency = expectedSolarWh > 0 
      ? (actualBatteryWh / expectedSolarWh) * 100 
      : 0;

    correlations.push({
      timestamp: solarDay.date,
      expectedSolarWh,
      actualBatteryWh,
      efficiency: Math.min(efficiency, 100), // Cap at 100%
      isAnomaly: efficiency < efficiencyThreshold && expectedSolarWh > 0,
    });
  });

  return correlations;
}

/**
 * Analyzes efficiency across all correlations
 */
export function analyzeEfficiency(
  correlations: SolarCorrelation[]
): EfficiencyAnalysis {
  if (correlations.length === 0) {
    return {
      averageEfficiency: 0,
      peakEfficiency: 0,
      lowestEfficiency: 0,
      anomalyCount: 0,
      totalExpectedWh: 0,
      totalActualWh: 0,
      correlations: [],
    };
  }

  const efficiencies = correlations.map(c => c.efficiency);
  const totalExpectedWh = correlations.reduce((sum, c) => sum + c.expectedSolarWh, 0);
  const totalActualWh = correlations.reduce((sum, c) => sum + c.actualBatteryWh, 0);
  const anomalyCount = correlations.filter(c => c.isAnomaly).length;

  return {
    averageEfficiency: efficiencies.reduce((sum, e) => sum + e, 0) / efficiencies.length,
    peakEfficiency: Math.max(...efficiencies),
    lowestEfficiency: Math.min(...efficiencies),
    anomalyCount,
    totalExpectedWh,
    totalActualWh,
    correlations,
  };
}

/**
 * Matches hourly solar data with BMS records
 */
export function matchHourlyData(
  hourlyData: HourlyBreakdown[],
  bmsRecords: AnalysisRecord[]
): Array<{
  hour: HourlyBreakdown;
  bmsRecord: AnalysisRecord | null;
}> {
  return hourlyData.map(hour => {
    // Find BMS record closest to this hour
    const hourTime = new Date(hour.timestamp).getTime();
    
    let closestRecord: AnalysisRecord | null = null;
    let minDiff = Infinity;

    bmsRecords.forEach(record => {
      const recordTime = new Date(record.timestamp).getTime();
      const diff = Math.abs(recordTime - hourTime);
      
      // Only match if within 30 minutes
      if (diff < 30 * 60 * 1000 && diff < minDiff) {
        minDiff = diff;
        closestRecord = record;
      }
    });

    return {
      hour,
      bmsRecord: closestRecord,
    };
  });
}

/**
 * Detects charging anomalies based on solar availability
 */
export function detectChargingAnomalies(
  solarData: SolarEstimateResponse,
  bmsRecords: AnalysisRecord[],
  minIrradiance: number = 200 // W/m²
): Array<{
  timestamp: string;
  issue: string;
  expectedIrradiance: number;
  actualCharging: boolean;
}> {
  const anomalies: Array<{
    timestamp: string;
    issue: string;
    expectedIrradiance: number;
    actualCharging: boolean;
  }> = [];

  const matched = matchHourlyData(solarData.hourlyBreakdown, bmsRecords);

  matched.forEach(({ hour, bmsRecord }) => {
    if (!bmsRecord) return;

    const isHighSolar = hour.irradiance_w_m2 >= minIrradiance;
    const isCharging = (bmsRecord.analysis?.current || 0) > 0;

    // Anomaly: High solar but not charging
    if (isHighSolar && !isCharging) {
      anomalies.push({
        timestamp: hour.timestamp,
        issue: 'High solar irradiance but battery not charging',
        expectedIrradiance: hour.irradiance_w_m2,
        actualCharging: false,
      });
    }

    // Anomaly: Low solar but high charging current
    if (!isHighSolar && isCharging && (bmsRecord.analysis?.current || 0) > 5) {
      anomalies.push({
        timestamp: hour.timestamp,
        issue: 'Low solar irradiance but high charging current detected',
        expectedIrradiance: hour.irradiance_w_m2,
        actualCharging: true,
      });
    }
  });

  return anomalies;
}

/**
 * Calculates expected runtime based on solar charging
 */
export function calculateExpectedRuntime(
  dailySolarWh: number,
  averageLoadWatts: number
): number {
  if (averageLoadWatts === 0) return 0;
  return dailySolarWh / averageLoadWatts;
}

/**
 * Estimates days until battery full based on solar input
 */
export function estimateDaysToFullCharge(
  currentCapacityAh: number,
  fullCapacityAh: number,
  dailySolarWh: number,
  nominalVoltage: number
): number {
  const remainingAh = fullCapacityAh - currentCapacityAh;
  const remainingWh = ahToWh(remainingAh, nominalVoltage);
  
  if (dailySolarWh === 0) return Infinity;
  
  return Math.ceil(remainingWh / dailySolarWh);
}

/**
 * Formats efficiency as a percentage string
 */
export function formatEfficiency(efficiency: number): string {
  return `${efficiency.toFixed(1)}%`;
}

/**
 * Determines efficiency status (good, warning, critical)
 */
export function getEfficiencyStatus(efficiency: number): 'good' | 'warning' | 'critical' {
  if (efficiency >= 80) return 'good';
  if (efficiency >= 60) return 'warning';
  return 'critical';
}

/**
 * Generates efficiency recommendations
 */
export function generateEfficiencyRecommendations(
  analysis: EfficiencyAnalysis
): string[] {
  const recommendations: string[] = [];

  if (analysis.averageEfficiency < 70) {
    recommendations.push('Average efficiency is below 70%. Check for shading, panel degradation, or wiring issues.');
  }

  if (analysis.anomalyCount > analysis.correlations.length * 0.3) {
    recommendations.push('High number of anomalies detected. Inspect charge controller and battery connections.');
  }

  if (analysis.peakEfficiency < 85) {
    recommendations.push('Peak efficiency is below 85%. Consider panel cleaning or angle adjustment.');
  }

  const actualVsExpected = (analysis.totalActualWh / analysis.totalExpectedWh) * 100;
  if (actualVsExpected < 60) {
    recommendations.push('Actual charging is significantly below expected. System may be undersized or faulty.');
  }

  if (recommendations.length === 0) {
    recommendations.push('System efficiency is within normal parameters. Continue monitoring.');
  }

  return recommendations;
}