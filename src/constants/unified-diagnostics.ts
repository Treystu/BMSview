/**
 * UNIFIED DIAGNOSTICS CONSTANTS
 *
 * This file defines all 86 diagnostic tests across 13 categories.
 * Each test corresponds to a specific backend check in unified-diagnostics.cjs.
 */

export interface DiagnosticTest {
  id: string;
  label: string;
  description: string;
  category: string;
  relatedFiles: string[];
}

export const UNIFIED_DIAGNOSTIC_CATEGORIES = [
  "Infrastructure",
  "Core Analysis",
  "Data & History",
  "Systems",
  "AI & Insights",
  "Gemini Tools",
  "Weather & Solar",
  "Predictive & Analytics",
  "Validation & Quality",
  "Admin & Feedback",
  "Resilience",
  "Security",
  "Integration",
] as const;

export type DiagnosticCategory = (typeof UNIFIED_DIAGNOSTIC_CATEGORIES)[number];

export const ALL_UNIFIED_TESTS: DiagnosticTest[] = [
  // --- Category 1: Infrastructure ---
  {
    id: "infra-mongodb",
    label: "MongoDB Connection",
    description:
      "Verify database connectivity, CRUD operations, and index health.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/mongodb.cjs"],
  },
  {
    id: "infra-gemini",
    label: "Gemini API Connectivity",
    description: "Test communication with Google Gemini AI models.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/geminiClient.cjs"],
  },
  {
    id: "infra-logging",
    label: "Logging System",
    description:
      "Verify structured logger creation and all log resonance levels.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/logger.cjs"],
  },
  {
    id: "infra-error-handling",
    label: "Error Handling",
    description:
      "Test centralized error formatting and stack trace preservation.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/logger.cjs"],
  },
  {
    id: "infra-cors",
    label: "CORS Configuration",
    description: "Verify security headers and allowed origin policies.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/cors.cjs"],
  },
  {
    id: "infra-auth",
    label: "Authentication",
    description:
      "Test token validation, admin authorization, and security gates.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/auth.cjs"],
  },
  {
    id: "infra-rate-limiter",
    label: "Rate Limiter",
    description: "Verify request throttling and abuse prevention mechanisms.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/rate-limiter.cjs"],
  },
  {
    id: "infra-cache",
    label: "Cache Management",
    description: "Test memory caching and IndexedDB local-first storage.",
    category: "Infrastructure",
    relatedFiles: [
      "netlify/functions/utils/cache.cjs",
      "src/services/localCache.ts",
    ],
  },
  {
    id: "infra-circuit-breaker",
    label: "Circuit Breakers",
    description:
      "Check status of backend circuit breakers and failover states.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/circuit-breaker-status.cjs"],
  },
  {
    id: "infra-config",
    label: "Configuration",
    description:
      "Verify environment variables and runtime configuration loading.",
    category: "Infrastructure",
    relatedFiles: ["netlify/functions/utils/config.cjs"],
  },

  // --- Category 2: Core Analysis ---
  {
    id: "analysis-endpoint",
    label: "Analysis Endpoint",
    description: "Test POST /analyze responsiveness and base validation.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/analyze.cjs"],
  },
  {
    id: "analysis-pipeline",
    label: "Pipeline Orchestrator",
    description: "Verify the multi-stage analysis data pipeline.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/utils/analysis-pipeline.cjs"],
  },
  {
    id: "analysis-helpers",
    label: "Analysis Helpers",
    description: "Test data extraction and transformation helper functions.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/utils/analysis-helpers.cjs"],
  },
  {
    id: "analysis-utilities",
    label: "Analysis Utilities",
    description: "Verify core mathematical and formatting utility functions.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/utils/analysis-utilities.cjs"],
  },
  {
    id: "analysis-validation",
    label: "Response Validation",
    description: "Check AI response schema enforcement and truth-checking.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/utils/response-validator.cjs"],
  },
  {
    id: "analysis-duplicate",
    label: "Duplicate Detection",
    description: "Verify content hashing and deduplication logic.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/utils/duplicate-detection.cjs"],
  },
  {
    id: "analysis-hardware-id",
    label: "Hardware ID Extraction",
    description: "Test DL number / hardware system ID pattern matching.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/extract-hardware-id.cjs"],
  },
  {
    id: "analysis-async",
    label: "Async Processing",
    description: "Verify background job queuing and status polling.",
    category: "Core Analysis",
    relatedFiles: ["netlify/functions/analysis-background.mjs"],
  },

  // --- Category 3: Data & History ---
  {
    id: "data-history",
    label: "History Management",
    description: "Test analysis history retrieval and storage operations.",
    category: "Data & History",
    relatedFiles: ["netlify/functions/history.cjs"],
  },
  {
    id: "data-export",
    label: "Data Export",
    description: "Verify JSON/CSV export formatting and data integrity.",
    category: "Data & History",
    relatedFiles: ["netlify/functions/export-data.cjs"],
  },
  {
    id: "data-sync-metadata",
    label: "Sync Metadata",
    description: "Test server-side metadata generation for local-first sync.",
    category: "Data & History",
    relatedFiles: ["netlify/functions/sync-metadata.cjs"],
  },
  {
    id: "data-sync-incremental",
    label: "Incremental Sync",
    description: "Verify delta fetching since last sync timestamp.",
    category: "Data & History",
    relatedFiles: ["netlify/functions/sync-incremental.cjs"],
  },
  {
    id: "data-sync-push",
    label: "Sync Push",
    description: "Test client-to-server data push/update cycles.",
    category: "Data & History",
    relatedFiles: ["netlify/functions/sync-push.cjs"],
  },
  {
    id: "data-poll-updates",
    label: "Update Polling",
    description: "Verify real-time status update polling mechanism.",
    category: "Data & History",
    relatedFiles: ["netlify/functions/poll-updates.cjs"],
  },

  // --- Category 4: Systems ---
  {
    id: "systems-crud",
    label: "Systems CRUD",
    description: "Test battery system registration and management.",
    category: "Systems",
    relatedFiles: ["netlify/functions/systems.cjs"],
  },
  {
    id: "systems-analytics",
    label: "System Analytics",
    description: "Verify aggregated analytics for specific hardware systems.",
    category: "Systems",
    relatedFiles: ["netlify/functions/system-analytics.cjs"],
  },
  {
    id: "systems-association",
    label: "Intelligent Associator",
    description: "Test automatic linking of records to registered systems.",
    category: "Systems",
    relatedFiles: ["netlify/functions/utils/intelligent-associator.cjs"],
  },
  {
    id: "systems-linking",
    label: "Manual Linking",
    description: "Verify manual override for system associations.",
    category: "Systems",
    relatedFiles: ["netlify/functions/history.cjs"],
  },

  // --- Category 5: AI & Insights ---
  {
    id: "insights-basic",
    label: "Basic Insights",
    description: "Test generic AI battery health insight generation.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/generate-insights.cjs"],
  },
  {
    id: "insights-with-tools",
    label: "Insights with Tools",
    description: "Verify tool-calling capabilities during AI generation.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/generate-insights-with-tools.cjs"],
  },
  {
    id: "insights-full-context",
    label: "Context Builder",
    description:
      "Verify assembly of historical and weather data for AI context.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/utils/full-context-builder.cjs"],
  },
  {
    id: "insights-guru",
    label: "Diagnostics Guru",
    description: "Test the high-level diagnostic reasoning agent.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/utils/insights-guru.cjs"],
  },
  {
    id: "insights-react-loop",
    label: "ReAct Reasoning Loop",
    description: "Verify multi-turn tool-calling and self-correction loop.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/utils/react-loop.cjs"],
  },
  {
    id: "insights-jobs",
    label: "Insight Job Management",
    description: "Test long-running AI job orchestration.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/utils/insights-jobs.cjs"],
  },
  {
    id: "insights-async",
    label: "Async Insight Triggers",
    description: "Verify asynchronous triggering of complex insights.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/generate-insights-async-trigger.cjs"],
  },
  {
    id: "insights-token-limit",
    label: "Token Management",
    description: "Test handling of window limits and context truncation.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/utils/token-limit-handler.cjs"],
  },
  {
    id: "insights-checkpoints",
    label: "Job Checkpointing",
    description: "Verify saving and resuming state for interrupted AI tasks.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/utils/checkpoint-manager.cjs"],
  },
  {
    id: "insights-processor",
    label: "Result Processor",
    description: "Test formatting and summarization of AI raw outputs.",
    category: "AI & Insights",
    relatedFiles: ["netlify/functions/utils/insights-processor.cjs"],
  },

  // --- Category 6: Gemini Tools ---
  {
    id: "tool-request-bms-data",
    label: "Tool: BMS Data",
    description: "Verify retrieval of historical battery metrics.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-weather",
    label: "Tool: Weather Data",
    description: "Test real-time and historical weather tool calls.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-solar",
    label: "Tool: Solar Estimation",
    description: "Verify energy generation tool calculations.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-analytics",
    label: "Tool: System Analytics",
    description: "Test tool access to aggregated hardware stats.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-predict-trends",
    label: "Tool: Battery Trends",
    description: "Verify predictive forecasting tool outputs.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-usage-patterns",
    label: "Tool: Usage Patterns",
    description: "Test pattern recognition tool for system anomalies.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-energy-budget",
    label: "Tool: Energy Budget",
    description: "Verify load/generation balancing tool calculations.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-hourly-soc",
    label: "Tool: Hourly Prediction",
    description: "Test short-term state-of-charge forecasting tool.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-github-search",
    label: "Tool: GitHub Search",
    description: "Verify documentation and issue search tool integration.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-codebase-file",
    label: "Tool: File Access",
    description: "Test codebase awareness and file reading capabilities.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  {
    id: "tool-list-directory",
    label: "Tool: Dir Listing",
    description: "Verify system structure exploration tool calls.",
    category: "Gemini Tools",
    relatedFiles: ["netlify/functions/utils/gemini-tools.cjs"],
  },

  // --- Category 7: Weather & Solar ---
  {
    id: "weather-current",
    label: "Weather API",
    description: "Test current data fetch from OpenWeatherMap.",
    category: "Weather & Solar",
    relatedFiles: ["netlify/functions/weather.cjs"],
  },
  {
    id: "weather-historical",
    label: "Past Weather",
    description: "Verify historical weather retrieval for analytics.",
    category: "Weather & Solar",
    relatedFiles: ["netlify/functions/utils/weather-fetcher.cjs"],
  },
  {
    id: "weather-backfill",
    label: "Batch Backfill",
    description: "Test multi-day weather gap filling orchestration.",
    category: "Weather & Solar",
    relatedFiles: ["netlify/functions/utils/weather-batch-backfill.cjs"],
  },
  {
    id: "solar-estimate",
    label: "Generation Est.",
    description: "Verify irradiation-based energy generation math.",
    category: "Weather & Solar",
    relatedFiles: ["netlify/functions/solar-estimate.cjs"],
  },
  {
    id: "solar-irradiance",
    label: "Irradiance API",
    description: "Test retrieval of cloud coverage and UV index data.",
    category: "Weather & Solar",
    relatedFiles: ["netlify/functions/utils/solar-irradiance.cjs"],
  },
  {
    id: "solar-aware-analysis",
    label: "Solar Analysis",
    description: "Verify energy-aware battery health evaluations.",
    category: "Weather & Solar",
    relatedFiles: ["netlify/functions/utils/solar-aware-load-analysis.cjs"],
  },

  // --- Category 8: Predictive & Analytics ---
  {
    id: "predict-maintenance",
    label: "Maintenance Forecaster",
    description: "Test predictive algorithms for battery component life.",
    category: "Predictive & Analytics",
    relatedFiles: ["netlify/functions/predictive-maintenance.cjs"],
  },
  {
    id: "predict-trends",
    label: "Capacity Trends",
    description: "Verify long-term capacity degradation modeling.",
    category: "Predictive & Analytics",
    relatedFiles: ["netlify/functions/utils/forecasting.cjs"],
  },
  {
    id: "analytics-comprehensive",
    label: "Full Analytics",
    description: "Verify comprehensive system-wide performance reports.",
    category: "Predictive & Analytics",
    relatedFiles: ["netlify/functions/utils/comprehensive-analytics.cjs"],
  },
  {
    id: "analytics-patterns",
    label: "Pattern Analysis",
    description: "Test recognition of cyclical usage and charge behaviors.",
    category: "Predictive & Analytics",
    relatedFiles: ["netlify/functions/utils/pattern-analysis.cjs"],
  },
  {
    id: "analytics-stats",
    label: "Statistical Library",
    description: "Verify low-level math and statistical aggregation tools.",
    category: "Predictive & Analytics",
    relatedFiles: ["netlify/functions/utils/statistical-tools.cjs"],
  },
  {
    id: "analytics-forecasting",
    label: "Short-term Forecast",
    description: "Test 24h-48h SOC and voltage projections.",
    category: "Predictive & Analytics",
    relatedFiles: ["netlify/functions/get-hourly-soc-predictions.cjs"],
  },

  // --- Category 9: Validation & Quality ---
  {
    id: "validate-data",
    label: "Field Integrity",
    description: "Test schema validation for individual metric records.",
    category: "Validation & Quality",
    relatedFiles: ["netlify/functions/utils/data-validation.cjs"],
  },
  {
    id: "validate-response",
    label: "AI Trust Score",
    description: "Verify correctness scoring for AI-human interactions.",
    category: "Validation & Quality",
    relatedFiles: ["netlify/functions/utils/response-validator.cjs"],
  },
  {
    id: "validate-schema",
    label: "Database Schema",
    description: "Verify MongoDB collection mappings and validators.",
    category: "Validation & Quality",
    relatedFiles: ["netlify/functions/admin-schema-diagnostics.cjs"],
  },
  {
    id: "quality-hashing",
    label: "Content Hashing",
    description: "Test hash consistency for large data payloads.",
    category: "Validation & Quality",
    relatedFiles: ["netlify/functions/utils/hash.cjs"],
  },
  {
    id: "quality-idempotency",
    label: "Batch Idempotency",
    description: "Verify prevention of duplicate batch uploads.",
    category: "Validation & Quality",
    relatedFiles: ["netlify/functions/check-duplicates-batch.cjs"],
  },
  {
    id: "quality-integrity",
    label: "Relation Integrity",
    description: "Test cross-collection data consistency (orphan checks).",
    category: "Validation & Quality",
    relatedFiles: ["netlify/functions/admin-data-integrity.cjs"],
  },

  // --- Category 10: Admin & Feedback ---
  {
    id: "feedback-submit",
    label: "AI Feedback Loop",
    description: "Verify submission of user corrections to AI results.",
    category: "Admin & Feedback",
    relatedFiles: ["netlify/functions/ai-feedback.cjs"],
  },
  {
    id: "feedback-retrieve",
    label: "Feedback Store",
    description: "Test retrieval of historical feedback for fine-tuning.",
    category: "Admin & Feedback",
    relatedFiles: ["netlify/functions/get-ai-feedback.cjs"],
  },
  {
    id: "feedback-analytics",
    label: "Feedback Metrics",
    description: "Verify evaluation scores of AI performance over time.",
    category: "Admin & Feedback",
    relatedFiles: ["netlify/functions/feedback-analytics.cjs"],
  },
  {
    id: "admin-stories",
    label: "System Stories",
    description: "Test management of hardware system narrative events.",
    category: "Admin & Feedback",
    relatedFiles: ["netlify/functions/admin-stories.cjs"],
  },
  {
    id: "admin-budget",
    label: "AI Cost Control",
    description: "Verify token usage budget monitoring and alerts.",
    category: "Admin & Feedback",
    relatedFiles: ["netlify/functions/ai-budget-settings.cjs"],
  },
  {
    id: "admin-monitoring",
    label: "System Health",
    description: "Test backend monitoring and metrics collection.",
    category: "Admin & Feedback",
    relatedFiles: ["netlify/functions/monitoring.cjs"],
  },

  // --- Category 11: Resilience ---
  {
    id: "resilience-retry",
    label: "Retry Engine",
    description: "Verify exponential backoff and max retry enforcement.",
    category: "Resilience",
    relatedFiles: ["netlify/functions/utils/retry.cjs"],
  },
  {
    id: "resilience-timeout",
    label: "Timeout Guard",
    description: "Verify client/server request timeout enforcement.",
    category: "Resilience",
    relatedFiles: ["netlify/functions/utils/time.cjs"],
  },
  {
    id: "resilience-circuit",
    label: "Tool Fault Gates",
    description: "Verify isolation of failing external API tools.",
    category: "Resilience",
    relatedFiles: ["netlify/functions/utils/tool-circuit-breakers.cjs"],
  },
  {
    id: "resilience-rate-limit",
    label: "Stress Resilience",
    description: "Test system behavior under simulated heavy load.",
    category: "Resilience",
    relatedFiles: ["netlify/functions/utils/rate-limiter.cjs"],
  },

  // --- Category 12: Security ---
  {
    id: "security-auth",
    label: "Auth Integrity",
    description: "Verify token signing and expiration logic.",
    category: "Security",
    relatedFiles: ["netlify/functions/utils/auth.cjs"],
  },
  {
    id: "security-sanitize",
    label: "XSS/Injec Sanitizer",
    description: "Test input cleaning for malicious script injection.",
    category: "Security",
    relatedFiles: ["netlify/functions/utils/security-sanitizer.cjs"],
  },
  {
    id: "security-privacy",
    label: "Data Privacy",
    description: "Verify PII removal and anonymization utility behavior.",
    category: "Security",
    relatedFiles: ["netlify/functions/utils/privacy-utils.cjs"],
  },
  {
    id: "security-endpoint",
    label: "Security Scans",
    description: "Verify automated security check endpoint accessibility.",
    category: "Security",
    relatedFiles: ["netlify/functions/security.cjs"],
  },

  // --- Category 13: Integration ---
  {
    id: "integration-upload-analyze",
    label: "End-to-End Analysis",
    description: "Complete flow: File upload → AI extraction → storage.",
    category: "Integration",
    relatedFiles: [
      "netlify/functions/upload.cjs",
      "netlify/functions/analyze.cjs",
    ],
  },
  {
    id: "integration-analyze-history",
    label: "Persistence Link",
    description: "Verify post-analysis handoff to historical database.",
    category: "Integration",
    relatedFiles: [
      "netlify/functions/analyze.cjs",
      "netlify/functions/history.cjs",
    ],
  },
  {
    id: "integration-link-system",
    label: "Hardware Binding",
    description: "Verify linkage between analysis records and hardware.",
    category: "Integration",
    relatedFiles: [
      "netlify/functions/history.cjs",
      "netlify/functions/systems.cjs",
    ],
  },
  {
    id: "integration-insights-feedback",
    label: "Insight Handoff",
    description: "Complete flow: UI query → AI tool loop → User feedback.",
    category: "Integration",
    relatedFiles: [
      "netlify/functions/generate-insights-with-tools.cjs",
      "netlify/functions/ai-feedback.cjs",
    ],
  },
  {
    id: "integration-sync-cycle",
    label: "Full Sync Loop",
    description: "Complete flow: Local change → Meta compare → Push → Verify.",
    category: "Integration",
    relatedFiles: [
      "netlify/functions/sync-metadata.cjs",
      "netlify/functions/sync-push.cjs",
    ],
  },
];
