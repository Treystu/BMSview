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

  // Duplicate detection metadata (prefixed with _ to indicate internal use)
  _isDuplicate?: boolean;
  _recordId?: string;
  _timestamp?: string;

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
  estimated_irradiance_w_m2?: number;
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
  needsReview?: boolean;
  validationWarnings?: string[];
  validationScore?: number;
  extractionAttempts?: number;
  wasUpgraded?: boolean;
  story?: AnalysisStory;
}

export interface StoryPhoto {
  url: string;
  caption?: string;
  timestamp: string;
}

export interface StoryAiInterpretation {
  summary: string;
  trendAnalysis?: string;
  events?: string[];
  recommendations?: string[];
  generatedAt: string;
}

export interface StoryContextNotes {
  priorEvents?: string;
  environmentalFactors?: string;
  maintenanceActions?: string;
}

export interface StoryEvent {
  analysisId: string;
  timestamp: string;
  annotation?: string;
  contextNotes?: StoryContextNotes;
  addedAt?: string;
}

export interface AnalysisStory {
  id: string;
  title: string;
  summary: string;
  userContext?: string;
  timeline: AnalysisRecord[];
  photos: StoryPhoto[];
  aiInterpretation?: StoryAiInterpretation;
  createdAt: string;
}

export interface AdminStory {
  id: string;
  adminId?: string;
  title: string;
  description: string;
  systemIdentifier?: string;
  events: StoryEvent[];
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    totalEvents: number;
    dateRange: {
      start: string | null;
      end: string | null;
    };
  };
}

export interface AdminStoriesResponse {
  items: AdminStory[];
  totalItems: number;
  page: number;
  limit: number;
  totalPages: number;
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
  submittedAt?: number;
  needsReview?: boolean;
  validationWarnings?: string[];
}

// Context window configuration for insights generation
export type ContextWindowUnit = 'hours' | 'days' | 'months' | 'years';

export interface ContextWindowConfig {
  value: number;
  unit: ContextWindowUnit;
  label: string; // Display label for UI (e.g., "1 Month", "3 Days")
}

export interface InsightsRequestConfig {
  contextWindow?: ContextWindowConfig;
  maxIterations?: number; // Max ReAct loop iterations (10 for standard, 20 for custom queries)
  isCustomQuery?: boolean; // Whether this is a custom user query
}

// Insight generation modes
export enum InsightMode {
  WITH_TOOLS = 'with-tools',      // AI "Battery Guru" with function calling (default, most comprehensive)
  BACKGROUND = 'background',      // Long-running insights jobs (>60s timeout)
  STANDARD = 'standard'           // Legacy standard insights generation
}

// Human-readable descriptions for each mode
export const InsightModeDescriptions: Record<InsightMode, { label: string; description: string; features: string[] }> = {
  [InsightMode.WITH_TOOLS]: {
    label: 'Battery Guru (Recommended)',
    description: 'Advanced AI with intelligent data querying',
    features: [
      'Can request specific historical data on-demand',
      'Multi-turn conversation with AI reasoning',
      'Comprehensive analysis with 90-day rollups',
      'Best for complex questions and deep insights'
    ]
  },
  [InsightMode.BACKGROUND]: {
    label: 'Background Processing',
    description: 'For very complex queries that need more time',
    features: [
      'Allows unlimited processing time',
      'Best for queries analyzing large datasets',
      'Continues processing in background',
      'Polls for status updates'
    ]
  },
  [InsightMode.STANDARD]: {
    label: 'Quick Insights',
    description: 'Fast, simple insights generation',
    features: [
      'Faster processing time',
      'Basic analysis without tool calling',
      'Good for quick checks',
      'Limited to standard patterns'
    ]
  }
};