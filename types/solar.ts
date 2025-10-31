// Solar API Types and Interfaces

export interface SolarEstimateRequest {
  location: string; // US Zip Code or "lat,lon" format
  panelWatts: number; // Panel's maximum power rating in Peak Watts
  startDate: string; // YYYY-MM-DD format
  endDate: string; // YYYY-MM-DD format
}

export interface DailyEstimate {
  date: string; // YYYY-MM-DD format
  estimatedWh: number; // Total Watt-hours for the day
  isForecast: boolean; // true if forecast, false if historical
}

export interface HourlyBreakdown {
  timestamp: string; // ISO 8601 format (e.g., "2025-10-29T12:00")
  irradiance_w_m2: number; // Solar irradiance in W/m²
  estimated_wh: number; // Estimated Watt-hours for this hour
  is_daylight: boolean; // true if between sunrise and sunset
}

export interface SolarEstimateResponse {
  locationName: string; // Human-readable location name
  panelWatts: string; // Echo of the input panelWatts
  dailyEstimates: DailyEstimate[];
  hourlyBreakdown: HourlyBreakdown[];
}

export interface SolarAPIError {
  error: string;
}

// Battery-Solar Correlation Types

export interface BatteryEnergyData {
  timestamp: string;
  ahChange: number; // Change in Amp-hours
  nominalVoltage: number; // Battery nominal voltage
  energyWh: number; // Calculated Watt-hours (ahChange × nominalVoltage)
}

export interface SolarCorrelation {
  timestamp: string;
  expectedSolarWh: number; // From Solar API
  actualBatteryWh: number; // From BMS logs
  efficiency: number; // Percentage (0-100)
  isAnomaly: boolean; // true if efficiency is below threshold
}

export interface EfficiencyAnalysis {
  averageEfficiency: number;
  peakEfficiency: number;
  lowestEfficiency: number;
  anomalyCount: number;
  totalExpectedWh: number;
  totalActualWh: number;
  correlations: SolarCorrelation[];
}

// System Configuration Types

export interface SolarSystemConfig {
  panelWatts: number;
  nominalVoltage: number;
  maxSolarAmps: number;
  latitude?: number;
  longitude?: number;
  zipCode?: string;
}

export interface BatterySystemConfig {
  nominalVoltage: number;
  fullCapacityAh: number;
  systemId: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}