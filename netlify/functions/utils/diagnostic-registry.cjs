/**
 * DIAGNOSTIC REGISTRY
 *
 * Replicates metadata from src/constants/unified-diagnostics.ts for backend use.
 */

const TEST_METADATA = {
  // --- Category 1: Infrastructure ---
  "infra-mongodb": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/mongodb.cjs"],
  },
  "infra-gemini": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/geminiClient.cjs"],
  },
  "infra-logging": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/logger.cjs"],
  },
  "infra-error-handling": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/logger.cjs"],
  },
  "infra-cors": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/cors.cjs"],
  },
  "infra-auth": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/auth.cjs"],
  },
  "infra-rate-limiter": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/rate-limiter.cjs"],
  },
  "infra-cache": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/cache.cjs", "src/services/localCache.ts"],
  },
  "infra-circuit-breaker": {
    category: "Infrastructure",
    files: ["netlify/functions/circuit-breaker-status.cjs"],
  },
  "infra-config": {
    category: "Infrastructure",
    files: ["netlify/functions/utils/config.cjs"],
  },

  // --- Category 2: Core Analysis ---
  "analysis-endpoint": {
    category: "Core Analysis",
    files: ["netlify/functions/analyze.cjs"],
  },
  "analysis-pipeline": {
    category: "Core Analysis",
    files: ["netlify/functions/utils/analysis-pipeline.cjs"],
  },
  "analysis-helpers": {
    category: "Core Analysis",
    files: ["netlify/functions/utils/analysis-helpers.cjs"],
  },
  "analysis-utilities": {
    category: "Core Analysis",
    files: ["netlify/functions/utils/analysis-utilities.cjs"],
  },
  "analysis-validation": {
    category: "Core Analysis",
    files: ["netlify/functions/utils/response-validator.cjs"],
  },
  "analysis-duplicate": {
    category: "Core Analysis",
    files: ["netlify/functions/utils/duplicate-detection.cjs"],
  },
  "analysis-hardware-id": {
    category: "Core Analysis",
    files: ["netlify/functions/utils/extract-hardware-id.cjs"],
  },
  "analysis-async": {
    category: "Core Analysis",
    files: ["netlify/functions/utils/analysis-background.mjs"],
  },

  // --- Category 3: Data & History ---
  "data-history": {
    category: "Data & History",
    files: ["netlify/functions/history.cjs"],
  },
  "data-export": {
    category: "Data & History",
    files: ["netlify/functions/export-data.cjs"],
  },
  "data-sync-metadata": {
    category: "Data & History",
    files: ["netlify/functions/sync-metadata.cjs"],
  },
  "data-sync-incremental": {
    category: "Data & History",
    files: ["netlify/functions/sync-incremental.cjs"],
  },
  "data-sync-push": {
    category: "Data & History",
    files: ["netlify/functions/sync-push.cjs"],
  },
  "data-poll-updates": {
    category: "Data & History",
    files: ["netlify/functions/poll-updates.cjs"],
  },

  // --- Category 4: Systems ---
  "systems-crud": {
    category: "Systems",
    files: ["netlify/functions/systems.cjs"],
  },
  "systems-analytics": {
    category: "Systems",
    files: ["netlify/functions/system-analytics.cjs"],
  },
  "systems-association": {
    category: "Systems",
    files: ["netlify/functions/utils/intelligent-associator.cjs"],
  },
  "systems-linking": {
    category: "Systems",
    files: ["netlify/functions/history.cjs"],
  },

  // --- Category 5: AI & Insights ---
  "insights-basic": {
    category: "AI & Insights",
    files: ["netlify/functions/generate-insights.cjs"],
  },
  "insights-with-tools": {
    category: "AI & Insights",
    files: ["netlify/functions/generate-insights-with-tools.cjs"],
  },
  "insights-full-context": {
    category: "AI & Insights",
    files: ["netlify/functions/utils/full-context-builder.cjs"],
  },
  "insights-guru": {
    category: "AI & Insights",
    files: ["netlify/functions/utils/insights-guru.cjs"],
  },
  "insights-react-loop": {
    category: "AI & Insights",
    files: ["netlify/functions/utils/react-loop.cjs"],
  },
  "insights-jobs": {
    category: "AI & Insights",
    files: ["netlify/functions/utils/insights-jobs.cjs"],
  },
  "insights-async": {
    category: "AI & Insights",
    files: ["netlify/functions/generate-insights-async-trigger.cjs"],
  },
  "insights-token-limit": {
    category: "AI & Insights",
    files: ["netlify/functions/utils/token-limit-handler.cjs"],
  },
  "insights-checkpoints": {
    category: "AI & Insights",
    files: ["netlify/functions/utils/checkpoint-manager.cjs"],
  },
  "insights-processor": {
    category: "AI & Insights",
    files: ["netlify/functions/utils/insights-processor.cjs"],
  },

  // --- Category 6: Gemini Tools ---
  "tool-request-bms-data": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-weather": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-solar": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-analytics": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-predict-trends": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-usage-patterns": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-energy-budget": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-hourly-soc": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-github-search": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-codebase-file": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },
  "tool-list-directory": {
    category: "Gemini Tools",
    files: ["netlify/functions/utils/gemini-tools.cjs"],
  },

  // --- Category 7: Weather & Solar ---
  "weather-current": {
    category: "Weather & Solar",
    files: ["netlify/functions/weather.cjs"],
  },
  "weather-historical": {
    category: "Weather & Solar",
    files: ["netlify/functions/utils/weather-fetcher.cjs"],
  },
  "weather-backfill": {
    category: "Weather & Solar",
    files: ["netlify/functions/utils/weather-batch-backfill.cjs"],
  },
  "solar-estimate": {
    category: "Weather & Solar",
    files: ["netlify/functions/solar-estimate.cjs"],
  },
  "solar-irradiance": {
    category: "Weather & Solar",
    files: ["netlify/functions/utils/solar-irradiance.cjs"],
  },
  "solar-aware-analysis": {
    category: "Weather & Solar",
    files: ["netlify/functions/utils/solar-aware-load-analysis.cjs"],
  },

  // --- Category 8: Predictive & Analytics ---
  "predict-maintenance": {
    category: "Predictive & Analytics",
    files: ["netlify/functions/predictive-maintenance.cjs"],
  },
  "predict-trends": {
    category: "Predictive & Analytics",
    files: ["netlify/functions/utils/forecasting.cjs"],
  },
  "analytics-comprehensive": {
    category: "Predictive & Analytics",
    files: ["netlify/functions/utils/comprehensive-analytics.cjs"],
  },
  "analytics-patterns": {
    category: "Predictive & Analytics",
    files: ["netlify/functions/utils/pattern-analysis.cjs"],
  },
  "analytics-stats": {
    category: "Predictive & Analytics",
    files: ["netlify/functions/utils/statistical-tools.cjs"],
  },
  "analytics-forecasting": {
    category: "Predictive & Analytics",
    files: ["netlify/functions/get-hourly-soc-predictions.cjs"],
  },

  // --- Category 9: Validation & Quality ---
  "validate-data": {
    category: "Validation & Quality",
    files: ["netlify/functions/utils/data-validation.cjs"],
  },
  "validate-response": {
    category: "Validation & Quality",
    files: ["netlify/functions/utils/response-validator.cjs"],
  },
  "validate-schema": {
    category: "Validation & Quality",
    files: ["netlify/functions/admin-schema-diagnostics.cjs"],
  },
  "quality-hashing": {
    category: "Validation & Quality",
    files: ["netlify/functions/utils/hash.cjs"],
  },
  "quality-idempotency": {
    category: "Validation & Quality",
    files: ["netlify/functions/check-duplicates-batch.cjs"],
  },
  "quality-integrity": {
    category: "Validation & Quality",
    files: ["netlify/functions/admin-data-integrity.cjs"],
  },

  // --- Category 10: Admin & Feedback ---
  "feedback-submit": {
    category: "Admin & Feedback",
    files: ["netlify/functions/ai-feedback.cjs"],
  },
  "feedback-retrieve": {
    category: "Admin & Feedback",
    files: ["netlify/functions/get-ai-feedback.cjs"],
  },
  "feedback-analytics": {
    category: "Admin & Feedback",
    files: ["netlify/functions/feedback-analytics.cjs"],
  },
  "admin-stories": {
    category: "Admin & Feedback",
    files: ["netlify/functions/admin-stories.cjs"],
  },
  "admin-budget": {
    category: "Admin & Feedback",
    files: ["netlify/functions/ai-budget-settings.cjs"],
  },
  "admin-monitoring": {
    category: "Admin & Feedback",
    files: ["netlify/functions/monitoring.cjs"],
  },

  // --- Category 11: Resilience ---
  "resilience-retry": {
    category: "Resilience",
    files: ["netlify/functions/utils/retry.cjs"],
  },
  "resilience-timeout": {
    category: "Resilience",
    files: ["netlify/functions/utils/time.cjs"],
  },
  "resilience-circuit": {
    category: "Resilience",
    files: ["netlify/functions/utils/tool-circuit-breakers.cjs"],
  },
  "resilience-rate-limit": {
    category: "Resilience",
    files: ["netlify/functions/utils/rate-limiter.cjs"],
  },

  // --- Category 12: Security ---
  "security-auth": {
    category: "Security",
    files: ["netlify/functions/utils/auth.cjs"],
  },
  "security-sanitize": {
    category: "Security",
    files: ["netlify/functions/utils/security-sanitizer.cjs"],
  },
  "security-privacy": {
    category: "Security",
    files: ["netlify/functions/utils/privacy-utils.cjs"],
  },
  "security-endpoint": {
    category: "Security",
    files: ["netlify/functions/security.cjs"],
  },

  // --- Category 13: Integration ---
  "integration-upload-analyze": {
    category: "Integration",
    files: ["netlify/functions/upload.cjs", "netlify/functions/analyze.cjs"],
  },
  "integration-analyze-history": {
    category: "Integration",
    files: ["netlify/functions/analyze.cjs", "netlify/functions/history.cjs"],
  },
  "integration-link-system": {
    category: "Integration",
    files: ["netlify/functions/history.cjs", "netlify/functions/systems.cjs"],
  },
  "integration-insights-feedback": {
    category: "Integration",
    files: [
      "netlify/functions/generate-insights-with-tools.cjs",
      "netlify/functions/ai-feedback.cjs",
    ],
  },
  "integration-sync-cycle": {
    category: "Integration",
    files: [
      "netlify/functions/sync-metadata.cjs",
      "netlify/functions/sync-push.cjs",
    ],
  },
};

module.exports = { TEST_METADATA };
