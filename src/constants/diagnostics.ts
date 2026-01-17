export const DIAGNOSTIC_TEST_SECTIONS = [
  // Infrastructure
  { id: 'database', label: 'Database Connection' },
  { id: 'gemini', label: 'Gemini API' },
  // Core Analysis
  { id: 'analyze', label: 'Analyze Endpoint' },
  { id: 'insightsWithTools', label: 'Insights with Tools' },
  { id: 'asyncAnalysis', label: 'Async Analysis' },
  // Data Management
  { id: 'history', label: 'History' },
  { id: 'systems', label: 'Systems' },
  { id: 'dataExport', label: 'Data Export' },
  { id: 'idempotency', label: 'Idempotency' },
  // External Services
  { id: 'weather', label: 'Weather Service' },
  { id: 'backfillWeather', label: 'Backfill Weather' },
  { id: 'backfillHourlyCloud', label: 'Backfill Hourly Cloud' },
  { id: 'solarEstimate', label: 'Solar Estimate' },
  { id: 'systemAnalytics', label: 'System Analytics' },
  { id: 'predictiveMaintenance', label: 'Predictive Maintenance' },
  // System Utilities
  { id: 'contentHashing', label: 'Content Hashing' },
  { id: 'errorHandling', label: 'Error Handling' },
  { id: 'logging', label: 'Logging System' },
  { id: 'retryMechanism', label: 'Retry Mechanism' },
  { id: 'timeout', label: 'Timeout Handling' },
] as const;

export const ALL_DIAGNOSTIC_TESTS = DIAGNOSTIC_TEST_SECTIONS.map(test => test.id);
