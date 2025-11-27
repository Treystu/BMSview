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

// Insight generation modes - Added for UI mode selector feature
export enum InsightMode {
  WITH_TOOLS = 'with-tools',      // AI "Battery Guru" with function calling (default, most comprehensive)
  STANDARD = 'standard'           // Legacy endpoint (proxies to WITH_TOOLS for backward compatibility)
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
      'Best for all types of questions and insights'
    ]
  },
  [InsightMode.STANDARD]: {
    label: 'Legacy Endpoint',
    description: 'Legacy endpoint (uses same engine as Battery Guru)',
    features: [
      'Same capabilities as Battery Guru',
      'Maintained for backward compatibility',
      'Recommended to use Battery Guru directly instead'
    ]
  }
};

// AI Feedback System Types
export interface AIFeedbackSuggestion {
  title: string;
  description: string;
  rationale: string;
  implementation: string;
  expectedBenefit: string;
  estimatedEffort: 'hours' | 'days' | 'weeks';
  codeSnippets?: string[];
  affectedComponents?: string[];
}

export interface AIFeedback {
  id: string;
  timestamp: Date;
  systemId: string;
  feedbackType: 'feature_request' | 'api_suggestion' | 'data_format' | 'bug_report' | 'optimization';
  category: 'weather_api' | 'data_structure' | 'ui_ux' | 'performance' | 'integration' | 'analytics';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'reviewed' | 'accepted' | 'implemented' | 'rejected';
  geminiModel: string;
  contextHash: string;
  suggestion: AIFeedbackSuggestion;
  githubIssue?: {
    number: number;
    url: string;
    status: string;
  };
  adminNotes?: string;
  implementationDate?: Date;
  updatedAt?: Date;
  metrics?: {
    viewCount: number;
    lastViewed: Date | null;
    discussionCount: number;
  };
}

// Full Context Data - specific interfaces for type safety
export interface CellDataPoint {
  timestamp: string;
  cellVoltages: number[];
  highestCell?: number | null;
  lowestCell?: number | null;
  difference?: number | null;
}

export interface TemperatureReading {
  timestamp: string;
  temperature?: number | null;
  temperatures?: number[];
  mosTemperature?: number | null;
}

export interface VoltageReading {
  timestamp: string;
  voltage: number | null;
}

export interface CurrentReading {
  timestamp: string;
  current: number | null;
  power?: number | null;
}

export interface AlarmEvent {
  timestamp: string;
  alert: string;
}

export interface StateChange {
  timestamp: string;
  from: string | null;
  to: string;
}

export interface StatisticalAnalysisResult {
  descriptive: {
    mean: number;
    median: number;
    standardDeviation: number;
    variance: number;
    min: number;
    max: number;
    range: number;
    count: number;
  };
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    p99: number;
  };
  outliers: {
    count: number;
    percentage: number;
    values: Array<{ index: number; value: number; deviationFromMean: number }>;
  };
}

export interface TrendAnalysisResult {
  trend: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  intercept: number;
  rSquared: number;
  confidence: 'high' | 'medium' | 'low';
  changePoints: Array<{
    index: number;
    timestamp: number;
    changeMagnitude: number;
    beforeMean: number;
    afterMean: number;
  }>;
}

export interface AnomalyDetectionResult {
  anomalies: Array<{
    index: number;
    value: number;
    anomalyScore: number;
    isAnomaly: boolean;
  }>;
  anomalyRate: number;
  totalAnomalies: number;
  threshold: number;
  mean: number;
  stdDev: number;
}

export interface CorrelationAnalysisResult {
  matrix: Record<string, Record<string, number>>;
  strongCorrelations: Array<{
    var1: string;
    var2: string;
    correlation: number;
    strength: string;
    direction: string;
  }>;
  totalPairs: number;
}

export interface WeatherHistoryPoint {
  timestamp: string;
  temp?: number;
  clouds?: number;
  uvi?: number;
  weather_main?: string;
  weather_icon?: string;
  estimated_irradiance_w_m2?: number;
}

export interface SolarProductionPoint {
  timestamp: string;
  predicted?: number | null;
  actual?: number | null;
}

export interface SystemConfig {
  name: string;
  chemistry: string;
  voltage: number | null;
  capacity: number | null;
  location: {
    latitude: number | null;
    longitude: number | null;
  };
}

export interface BatterySpecs {
  nominalVoltage: number | null;
  capacityAh: number | null;
  chemistry: string;
}

export interface RemainingLifeExpectancy {
  remainingCycles: number;
  remainingYears: number;
  estimatedEndDate: string;
}

export interface PerformanceDegradation {
  totalDegradation: number;
  degradationPerYear: number;
  timeRangeDays: number;
}

export interface FullContextData {
  raw: {
    allAnalyses: AnalysisRecord[];
    allCellData: CellDataPoint[];
    allTemperatureReadings: TemperatureReading[];
    allVoltageReadings: VoltageReading[];
    allCurrentReadings: CurrentReading[];
    allAlarms: AlarmEvent[];
    allStateChanges: StateChange[];
    timeRange: {
      start: string;
      end: string;
      days: number;
    };
    totalDataPoints: number;
  };
  toolOutputs: {
    statisticalAnalysis: StatisticalAnalysisResult | null;
    trendAnalysis: TrendAnalysisResult | null;
    anomalyDetection: AnomalyDetectionResult | null;
    correlationAnalysis: CorrelationAnalysisResult | null;
  };
  external: {
    weatherHistory: WeatherHistoryPoint[];
    solarProduction: SolarProductionPoint[];
  };
  metadata: {
    systemConfig: SystemConfig | null;
    batterySpecs: BatterySpecs | null;
  };
  computed: {
    healthScore: number | null;
    remainingLifeExpectancy: RemainingLifeExpectancy | null;
    performanceDegradation: PerformanceDegradation | null;
  };
  buildTimestamp: string;
  buildDurationMs: number;
  systemId: string;
}
// AI Feedback & Monitoring Types (for observability system)
export interface AIFeedbackMetric {
  id: string;
  timestamp: string;
  systemId?: string;
  metricType: 'accuracy' | 'implementation_rate' | 'performance' | 'cost' | 'anomaly';
  metricName: string;
  value: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}

export interface AIOperationLog {
  id: string;
  timestamp: string;
  operation: 'analysis' | 'insights' | 'feedback_generation';
  systemId?: string;
  duration: number;
  tokensUsed?: number;
  cost?: number;
  success: boolean;
  error?: string;
  model?: string;
  contextWindowDays?: number;
}

export interface CostMetrics {
  period: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  endDate: string;
  totalCost: number;
  totalTokens: number;
  operationBreakdown: {
    analysis: { count: number; cost: number; tokens: number };
    insights: { count: number; cost: number; tokens: number };
    feedbackGeneration: { count: number; cost: number; tokens: number };
  };
  averageCostPerOperation: number;
}

export interface AnomalyAlert {
  id: string;
  timestamp: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'cost_spike' | 'error_rate' | 'latency' | 'accuracy_drop' | 'circuit_breaker';
  message: string;
  metadata?: Record<string, unknown>;
  resolved?: boolean;
  resolvedAt?: string;
}

export interface FeedbackImplementationTracking {
  id: string;
  feedbackId: string;
  suggestedAt: string;
  implementedAt?: string;
  status: 'pending' | 'implemented' | 'rejected' | 'expired';
  implementationType?: string;
  implementationNotes?: string;
  effectiveness?: number; // 0-100 score
}

export interface MonitoringDashboardData {
  realtimeMetrics: {
    currentOperationsPerMinute: number;
    averageLatency: number;
    errorRate: number;
    circuitBreakerStatus: string;
  };
  costMetrics: CostMetrics;
  recentAlerts: AnomalyAlert[];
  performanceTrends: {
    timestamp: string;
    avgDuration: number;
    errorCount: number;
    successCount: number;
  }[];
  feedbackStats: {
    totalSuggestions: number;
    implementationRate: number;
    averageEffectiveness: number;
  };
}
