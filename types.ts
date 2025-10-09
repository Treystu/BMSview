// Fix: Add global type definitions for Vite environment variables
declare global {
  interface ImportMetaEnv {
    // VITE_CLIENT_API_KEY was removed to prevent it from being bundled on the client.
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export interface AnalysisData {
  dlNumber?: string | null;
  timestampFromImage?: string | null;
  status?: string | null;
  overallVoltage: number | null;
  power?: number | null;
  current: number | null;
  stateOfCharge: number | null;
  remainingCapacity?: number | null;
  fullCapacity?: number | null;
  cycleCount?: number | null;
  temperature: number | null; // Main battery temperature (e.g., T1)
  
  // New fields for richer data extraction
  temperatures?: number[]; // For all temp sensors, e.g., T1, T2
  mosTemperature?: number | null;
  chargeMosOn?: boolean | null;
  dischargeMosOn?: boolean | null;
  balanceOn?: boolean | null;
  serialNumber?: string | null;
  softwareVersion?: string | null;
  hardwareVersion?: string | null;
  snCode?: string | null;
  numTempSensors?: number | null;


  cellVoltages: number[];
  highestCellVoltage?: number | null;
  lowestCellVoltage?: number | null;
  cellVoltageDifference?: number | null;
  averageCellVoltage?: number | null;
  alerts: string[];
  summary: string;

  // Actionable Insights
  averageCurrentDaylight?: number | null;
  averageCurrentNight?: number | null;
  runtimeEstimateConservativeHours?: number | null;
  runtimeEstimateMiddleHours?: number | null;
  runtimeEstimateAggressiveHours?: number | null;
  sufficientChargeUntilDaylight?: boolean | null;
  daylightHoursRemaining?: number | null;
  nightHoursRemaining?: number | null;
  predictedSolarChargeAmphours?: number | null;
  generatorRecommendation?: {
    run: boolean;
    durationHours?: number | null;
    reason: string;
  } | null;
}

export interface WeatherData {
  temp: number;
  clouds: number;
  uvi: number;
  weather_main: string;
  weather_icon: string;
}

export interface BmsSystem {
  id: string;
  name: string;
  chemistry: string;
  voltage: number | null;
  capacity: number | null;
  latitude: number | null;
  longitude: number | null;
  associatedDLs: string[];
  maxAmpsSolarCharging?: number | null;
  maxAmpsGeneratorCharging?: number | null;
}

export interface AnalysisRecord {
  id: string;
  timestamp: string;
  systemId?: string;
  systemName?: string;
  analysis: AnalysisData | null;
  weather?: WeatherData;
  dlNumber?: string | null;
  fileName?: string;
}

export interface DisplayableAnalysisResult {
  fileName: string;
  data: AnalysisData | null;
  error?: string | null;
  saveError?: string | null;
  weather?: WeatherData;
  isDuplicate?: boolean;
  isBatchDuplicate?: boolean;
  file?: File;
  recordId?: string;
  jobId?: string;
  forcedSystemId?: string;
}