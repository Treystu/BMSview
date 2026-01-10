// Global type definitions for BMSview

export interface BatteryMeasurement {
  timestamp: string;
  voltage: number | null;
  current: number | null;
  temperature: number | null;
  stateOfCharge: number | null;
  capacity: number | null;
}

export interface BatteryAnalysisRequest {
  systemId?: string;
  measurements: BatteryMeasurement[];
  metadata?: {
    source: string;
    timestamp: string;
    [key: string]: unknown;
  };
}

export interface BatteryPerformanceMetrics {
  trend: 'Improving' | 'Stable' | 'Declining' | 'Unknown';
  capacityRetention: number;
  degradationRate: number;
}

export interface BatteryEfficiencyMetrics {
  chargeEfficiency: number;
  dischargeEfficiency: number;
  cyclesAnalyzed: number;
}

export interface BatteryInsights {
  healthStatus: string;
  performance: BatteryPerformanceMetrics;
  recommendations: string[];
  estimatedLifespan: string;
  efficiency: BatteryEfficiencyMetrics;
  rawText: string;
}

export interface NetlifyIdentityWidget {
  open: () => void;
  close: () => void;
  logout: () => void;
  init: () => void;
  currentUser?: () => { jwt?: () => Promise<string> } | null;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
}

export interface AnalysisResponse {
  success: boolean;
  insights: BatteryInsights;
  tokenUsage: {
    prompt: number;
    generated: number;
    total: number;
  };
  timestamp: string;
}

// Service response types
export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// State management types
export interface BatteryState {
  measurements: BatteryMeasurement[];
  lastUpdate: string;
  isAnalyzing: boolean;
  insights: BatteryInsights | null;
  error: string | null;
}

// Component prop types
export interface ChartProps {
  data: BatteryMeasurement[];
  type: 'voltage' | 'current' | 'temperature' | 'stateOfCharge';
  height?: number;
  width?: number;
}

export interface AnalysisResultProps {
  insights: BatteryInsights;
  onReanalyze?: () => void;
}

// Utility types
export type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all';

export interface DataFilter {
  timeRange: TimeRange;
  metrics: Array<'voltage' | 'current' | 'temperature' | 'stateOfCharge'>;
  threshold?: number;
}

// API types
export interface APIResponse {
  statusCode: number;
  body: string; // JSON string of ServiceResponse<T>
}// Fix: Add global type definitions for Vite environment variables
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ImportMetaEnv {
    // VITE_CLIENT_API_KEY was removed to prevent it from being bundled on the client.
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export interface AnalysisData {
  hardwareSystemId?: string | null; // Unified System ID (Physical/Hardware ID). Source of Truth.
  /** @deprecated Use hardwareSystemId instead */
  dlNumber?: string | null; // Legacy support - do not use for new logic
  timestampFromImage?: string | null;
  status?: string | null;
  overallVoltage: number | null;
  /** @deprecated Use overallVoltage instead */
  voltage?: number | null; // Legacy alias
  power?: number | null;
  current: number | null;
  stateOfCharge: number | null;
  /** @deprecated Use stateOfCharge instead */
  soc?: number | null; // Legacy alias
  remainingCapacity?: number | null;
  fullCapacity?: number | null;
  /** @deprecated Use remainingCapacity or fullCapacity instead */
  capacity?: number | null; // Legacy alias
  cycleCount?: number | null;
  /** @deprecated Use cycleCount instead */
  cycles?: number | null; // Legacy alias
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
  /** @deprecated Use cellVoltageDifference instead */
  cellVoltageDelta?: number | null; // Legacy alias
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
  chemistry?: string;
  voltage: number | null;
  capacity: number | null;
  latitude: number | null;
  longitude: number | null;
  associatedHardwareIds: string[]; // List of hardware system IDs (formerly associatedDLs)
  /** @deprecated Use associatedHardwareIds instead */
  associatedDLs?: string[]; // Legacy support
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
  hardwareSystemId?: string | null; // Unified System ID. Source of Truth.
  /** @deprecated Use hardwareSystemId instead */
  dlNumber?: string | null; // Legacy support
  fileName?: string;
  needsReview?: boolean;
  validationWarnings?: string[];
  validationScore?: number;
  extractionAttempts?: number;
  wasUpgraded?: boolean;
  story?: AnalysisStory;
  updatedAt?: string;
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
  FULL_CONTEXT = 'full-context',  // Full Context Mode with AI Feedback capability
  STANDARD = 'standard',
  VISUAL_GURU = 'visual-guru',
  ASYNC_WORKLOAD = 'async-workload'
}

// Human-readable descriptions for each mode
export const InsightModeDescriptions: Record<InsightMode, { label: string; description: string; features: string[] }> = {
  [InsightMode.WITH_TOOLS]: {
    label: 'Battery Guru (Recommended)',
    description: 'Advanced AI with intelligent data querying and feedback capability',
    features: [
      'Can request specific historical data on-demand',
      'Multi-turn conversation with AI reasoning',
      'Comprehensive analysis with 90-day rollups',
      'Can submit app improvement suggestions',
      'Best for all types of questions and insights'
    ]
  },
  [InsightMode.FULL_CONTEXT]: {
    label: 'Full Context Mode',
    description: 'Complete data context with AI app feedback focus',
    features: [
      'Loads ALL historical data upfront (90+ days)',
      'Enhanced AI feedback and suggestions',
      'Best for app improvement recommendations',
      'Slower initial load, deeper analysis',
      'Suggestions appear in Admin AI Feedback panel'
    ]
  },
  [InsightMode.STANDARD]: {
    label: 'Sync Analysis',
    description: 'Synchronous analysis mode',
    features: [
      'Fast, direct response',
      'Best for simple, immediate queries',
      'Standard data context window'
    ]
  },
  [InsightMode.VISUAL_GURU]: {
    label: 'Visual Guru Expert',
    description: 'Infographic-style output with charts for time-based metrics',
    features: [
      'Emphasizes visual representations over prose',
      'Generates chart configurations for time-series data',
      'Structured sections with status blocks and gauges',
      'Short, affirmative phrases about visual clarity',
      'Best for dashboards and visual reports'
    ]
  },
  [InsightMode.ASYNC_WORKLOAD]: {
    label: 'Async Analysis',
    description: 'Durable asynchronous execution',
    features: [
      'Unlimited execution time (no timeout limits)',
      'Automatic retries with intelligent backoff',
      'Multi-step workflow with independent retry per step',
      'State persistence across failures',
      'Best for complex analysis requiring extended processing',
      'Event-driven with priority and scheduling support'
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
  guruSource: 'diagnostics-guru' | 'battery-guru' | 'visual-guru' | 'full-context-guru' | 'quick-guru' | 'manual';
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

// Feedback Loop Metrics & Analytics Types
export interface FeedbackROIMetrics {
  feedbackId: string;
  feedbackTitle: string;
  category: string;
  estimatedEffort: 'hours' | 'days' | 'weeks';
  actualEffortHours?: number;
  estimatedBenefit?: string;
  actualBenefitScore?: number; // 0-100 scale
  costSavingsEstimate?: number;
  performanceImprovementPercent?: number;
  userSatisfactionChange?: number; // -100 to +100
  implementedAt?: string;
}

export interface UserSatisfactionSurvey {
  id: string;
  feedbackId: string;
  userId?: string;
  surveyDate: string;
  satisfactionScore: number; // 1-5 scale
  impactRating: number; // 1-5 scale
  usabilityImprovement: number; // 1-5 scale
  wouldRecommend: boolean;
  freeformFeedback?: string;
}

export interface FeedbackEffectivenessScore {
  feedbackId: string;
  totalScore: number; // 0-100 overall effectiveness
  implementationSpeed: number; // Score based on time-to-implementation
  userSatisfaction: number; // Average satisfaction score
  roiScore: number; // ROI-based score
  adoptionRate: number; // How widely the change was adopted
  stabilityScore: number; // Post-implementation stability
  calculatedAt: string;
}

export interface FeedbackLoopAnalytics {
  overview: {
    totalSuggestions: number;
    implementedCount: number;
    rejectedCount: number;
    pendingCount: number;
    implementationRate: number;
    averageTimeToImplementationDays: number | null;
    averageEffectivenessScore: number | null;
  };
  implementationMetrics: {
    byPriority: Record<string, { total: number; implemented: number; rate: number }>;
    byCategory: Record<string, { total: number; implemented: number; rate: number }>;
    byEffort: Record<string, { total: number; implemented: number; avgDays: number | null }>;
  };
  roiSummary: {
    totalEstimatedSavings: number;
    averageROIScore: number;
    topROIImplementations: FeedbackROIMetrics[];
  };
  timeToImplementation: {
    averageDays: number | null;
    medianDays: number | null;
    p90Days: number | null;
    byPriority: Record<string, number | null>;
    trend: Array<{ month: string; avgDays: number | null; count: number }>;
  };
  effectivenessOverview: {
    averageScore: number | null;
    scoreDistribution: { range: string; count: number }[];
    topPerformers: FeedbackEffectivenessScore[];
    bottomPerformers: FeedbackEffectivenessScore[];
  };
  userSatisfaction: {
    averageScore: number | null;
    surveyCount: number;
    satisfactionTrend: Array<{ month: string; avgScore: number | null; count: number }>;
    impactRating: number | null;
    recommendations: number; // Count of "would recommend"
  };
  monthlyBreakdown: Array<{
    month: string;
    newSuggestions: number;
    implemented: number;
    avgTimeToImplement: number | null;
    avgEffectiveness: number | null;
  }>;
  lastUpdated: string;
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

// Security & Audit Types
export interface SecurityAuditEvent {
  id: string;
  timestamp: string;
  eventType: SecurityEventType;
  clientIp?: string;
  userId?: string;
  systemId?: string;
  endpoint?: string;
  action?: string;
  details?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export type SecurityEventType =
  | 'rate_limit_exceeded'
  | 'rate_limit_warning'
  | 'input_sanitized'
  | 'injection_blocked'
  | 'prompt_injection_detected'
  | 'auth_success'
  | 'auth_failure'
  | 'consent_granted'
  | 'consent_denied'
  | 'data_access'
  | 'data_export'
  | 'admin_action'
  | 'encryption_event';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limit: number;
  error?: string;
}

export interface SanitizationResult {
  sanitized: unknown;
  warnings: string[];
  modified: boolean;
}

export interface EncryptedData {
  encrypted: true;
  data: string;
  iv: string;
  authTag: string;
  algorithm: string;
}

export interface SecurityConfig {
  rateLimiting: {
    insights: RateLimitConfig;
    feedback: RateLimitConfig;
    analysis: RateLimitConfig;
  };
  encryption: {
    enabled: boolean;
    sensitiveFields: string[];
  };
  audit: {
    enabled: boolean;
    retentionDays: number;
  };
}
