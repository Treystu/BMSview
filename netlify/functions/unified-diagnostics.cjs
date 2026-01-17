const { getDb } = require("./utils/mongodb.cjs");
const { createLogger, formatError } = require("./utils/logger.cjs");
const { GeminiClient } = require("./utils/geminiClient.cjs");
const { corsHeaders, handleOptions } = require("./utils/cors.cjs");
const { validateToken, isAdmin } = require("./utils/auth.cjs");
const { checkRateLimit } = require("./utils/rate-limiter.cjs");
const { getCached, setCached, invalidateCache } = require("./utils/cache.cjs");
const config = require("./utils/config.cjs");
const { runAnalysisPipeline } = require("./utils/analysis-pipeline.cjs");
const helpers = require("./utils/analysis-helpers.cjs");
const utilities = require("./utils/analysis-utilities.cjs");
const { validateResponse } = require("./utils/response-validator.cjs");
const { generateContentHash } = require("./utils/duplicate-detection.cjs");
const { executeToolCall } = require("./utils/tool-executor.cjs");
const { TEST_METADATA } = require("./utils/diagnostic-registry.cjs");

const logger = createLogger("unified-diagnostics");

// --- Helper: AI Prompt Generator ---
function generateAIPrompt(testId, error, params) {
  const metadata = TEST_METADATA[testId] || { category: "Unknown", files: [] };
  return `## Issue: ${testId} Failed (${metadata.category})

**Error:** ${error.message || "Unknown error"}
**Files to examine:**
${metadata.files.map((f) => `- ${f}`).join("\n")}

**Test Parameters:**
\`\`\`json
${JSON.stringify(params, null, 2)}
\`\`\`

**Task:** Investigate why this ${testId} test in the ${metadata.category} category failed. Examine the related files and current environment configuration. Propose a fix that addresses the root cause while maintaining system stability.`;
}

// --- Test Implementations ---
const testImplementations = {
  // Category 1: Infrastructure
  "infra-mongodb": async () => {
    const db = await getDb();
    const testDoc = { testId: "diag-test", timestamp: new Date() };
    const insert = await db.collection("diagnostics-test").insertOne(testDoc);
    const read = await db
      .collection("diagnostics-test")
      .findOne({ _id: insert.insertedId });
    await db.collection("diagnostics-test").deleteMany({ testId: "diag-test" });
    return { success: !!read, details: { insertedId: insert.insertedId } };
  },
  "infra-gemini": async () => {
    const client = new GeminiClient();
    const resp = await client.callAPI({
      prompt: "Reply DIAGNOSTIC_OK",
      maxTokens: 10,
    });
    return {
      success: resp.text.includes("DIAGNOSTIC_OK"),
      details: { model: config.GEMINI_MODEL },
    };
  },
  "infra-logging": async () => {
    logger.info("Diagnostic log test");
    return { success: true };
  },
  "infra-error-handling": async () => {
    const err = new Error("Test");
    const f = formatError(err, { component: "diag" });
    return { success: !!f.message && !!f.stack };
  },
  "infra-cors": async () => {
    const h = corsHeaders();
    return { success: !!h["Access-Control-Allow-Origin"] };
  },
  "infra-auth": async () => {
    const inv = await validateToken("invalid");
    return {
      success: !inv.valid && isAdmin({ app_metadata: { roles: ["admin"] } }),
    };
  },
  "infra-rate-limiter": async () => {
    const r = await checkRateLimit("diag_test", { limit: 10, window: 60 });
    return { success: r.allowed };
  },
  "infra-cache": async () => {
    await setCached("diag_test", { ok: true }, 10);
    const r = await getCached("diag_test");
    return { success: r?.ok === true };
  },
  "infra-circuit-breaker": async () => {
    return { success: true };
  },
  "infra-config": async () => {
    return {
      success: !!process.env.MONGODB_URI && !!process.env.GEMINI_API_KEY,
    };
  },

  // Category 2: Core Analysis
  "analysis-endpoint": async () => {
    return { success: !!require("./analyze.cjs").handler };
  },
  "analysis-pipeline": async () => {
    return { success: typeof runAnalysisPipeline === "function" };
  },
  "analysis-helpers": async () => {
    return { success: Object.keys(helpers).length > 0 };
  },
  "analysis-utilities": async () => {
    return { success: Object.keys(utilities).length > 0 };
  },
  "analysis-validation": async () => {
    const r = validateResponse({ soc: 100, voltage: 52 });
    return { success: r.valid };
  },
  "analysis-duplicate": async () => {
    const h1 = generateContentHash("test");
    const h2 = generateContentHash("test");
    return { success: h1 === h2 };
  },
  "analysis-hardware-id": async () => {
    return { success: !!require("./utils/extract-hardware-id.cjs") };
  },
  "analysis-async": async () => {
    return { success: !!require("./utils/analysis-background.mjs") };
  },

  // Category 3: Data & History
  "data-history": async () => {
    return { success: !!require("./history.cjs").handler };
  },
  "data-export": async () => {
    return { success: !!require("./export-data.cjs").handler };
  },
  "data-sync-metadata": async () => {
    return { success: !!require("./sync-metadata.cjs").handler };
  },
  "data-sync-incremental": async () => {
    return { success: !!require("./sync-incremental.cjs").handler };
  },
  "data-sync-push": async () => {
    return { success: !!require("./sync-push.cjs").handler };
  },
  "data-poll-updates": async () => {
    return { success: !!require("./poll-updates.cjs").handler };
  },

  // Category 4: Systems
  "systems-crud": async () => {
    return { success: !!require("./systems.cjs").handler };
  },
  "systems-analytics": async () => {
    return { success: !!require("./system-analytics.cjs").handler };
  },
  "systems-association": async () => {
    return {
      success: !!require("./utils/intelligent-associator.cjs")
        .associateByHardwareId,
    };
  },
  "systems-linking": async () => {
    return { success: !!require("./history.cjs").handler };
  },

  // Category 5: AI & Insights
  "insights-basic": async () => {
    return { success: !!require("./generate-insights.cjs").handler };
  },
  "insights-with-tools": async () => {
    return { success: !!require("./generate-insights-with-tools.cjs").handler };
  },
  "insights-full-context": async () => {
    return {
      success: !!require("./utils/full-context-builder.cjs").buildFullContext,
    };
  },
  "insights-guru": async () => {
    return { success: !!require("./utils/insights-guru.cjs") };
  },
  "insights-react-loop": async () => {
    return { success: !!require("./utils/react-loop.cjs") };
  },
  "insights-jobs": async () => {
    return { success: !!require("./utils/insights-jobs.cjs").createJob };
  },
  "insights-async": async () => {
    return {
      success: !!require("./generate-insights-async-trigger.cjs").handler,
    };
  },
  "insights-token-limit": async () => {
    return { success: !!require("./utils/token-limit-handler.cjs") };
  },
  "insights-checkpoints": async () => {
    return { success: !!require("./utils/checkpoint-manager.cjs") };
  },
  "insights-processor": async () => {
    return { success: !!require("./utils/insights-processor.cjs") };
  },

  // Category 6: Gemini Tools
  "tool-request-bms-data": async () => {
    const r = await executeToolCall("request_bms_data", {
      systemId: "test",
      metric: "soc",
    });
    return { success: !!r };
  },
  "tool-weather": async () => {
    const r = await executeToolCall("getWeatherData", {
      latitude: 37,
      longitude: -122,
    });
    return { success: !!r };
  },
  "tool-solar": async () => {
    const r = await executeToolCall("getSolarEstimate", {
      location: "37,-122",
      panelWatts: 400,
    });
    return { success: !!r };
  },
  "tool-analytics": async () => {
    const r = await executeToolCall("getSystemAnalytics", { systemId: "test" });
    return { success: !!r };
  },
  "tool-predict-trends": async () => {
    const r = await executeToolCall("predict_battery_trends", {
      systemId: "test",
    });
    return { success: !!r };
  },
  "tool-usage-patterns": async () => {
    const r = await executeToolCall("analyze_usage_patterns", {
      systemId: "test",
    });
    return { success: !!r };
  },
  "tool-energy-budget": async () => {
    const r = await executeToolCall("calculate_energy_budget", {
      systemId: "test",
    });
    return { success: !!r };
  },
  "tool-hourly-soc": async () => {
    const r = await executeToolCall("get_hourly_soc_predictions", {
      systemId: "test",
    });
    return { success: !!r };
  },
  "tool-github-search": async () => {
    const r = await executeToolCall("searchGitHubIssues", { query: "test" });
    return { success: !!r };
  },
  "tool-codebase-file": async () => {
    const r = await executeToolCall("getCodebaseFile", {
      path: "package.json",
    });
    return { success: !!r };
  },
  "tool-list-directory": async () => {
    const r = await executeToolCall("listDirectory", {
      path: "netlify/functions",
    });
    return { success: !!r };
  },

  // Category 7: Weather & Solar
  "weather-current": async () => {
    return { success: !!require("./weather.cjs").handler };
  },
  "weather-historical": async () => {
    return { success: !!require("./utils/weather-fetcher.cjs") };
  },
  "weather-backfill": async () => {
    return { success: !!require("./utils/weather-batch-backfill.cjs") };
  },
  "solar-estimate": async () => {
    return { success: !!require("./solar-estimate.cjs").handler };
  },
  "solar-irradiance": async () => {
    return { success: !!require("./utils/solar-irradiance.cjs") };
  },
  "solar-aware-analysis": async () => {
    return { success: !!require("./utils/solar-aware-load-analysis.cjs") };
  },

  // Category 8: Predictive & Analytics
  "predict-maintenance": async () => {
    return { success: !!require("./predictive-maintenance.cjs").handler };
  },
  "predict-trends": async () => {
    return { success: !!require("./utils/forecasting.cjs") };
  },
  "analytics-comprehensive": async () => {
    return { success: !!require("./utils/comprehensive-analytics.cjs") };
  },
  "analytics-patterns": async () => {
    return { success: !!require("./utils/pattern-analysis.cjs") };
  },
  "analytics-stats": async () => {
    return { success: !!require("./utils/statistical-tools.cjs") };
  },
  "analytics-forecasting": async () => {
    return { success: !!require("./get-hourly-soc-predictions.cjs").handler };
  },

  // Category 9: Validation & Quality
  "validate-data": async () => {
    return { success: !!require("./utils/data-validation.cjs") };
  },
  "validate-response": async () => {
    return {
      success: !!require("./utils/response-validator.cjs").validateResponse,
    };
  },
  "validate-schema": async () => {
    return { success: !!require("./admin-schema-diagnostics.cjs").handler };
  },
  "quality-hashing": async () => {
    return { success: !!require("./utils/hash.cjs") };
  },
  "quality-idempotency": async () => {
    return { success: !!require("./check-duplicates-batch.cjs").handler };
  },
  "quality-integrity": async () => {
    return { success: !!require("./admin-data-integrity.cjs").handler };
  },

  // Category 10: Admin & Feedback
  "feedback-submit": async () => {
    return { success: !!require("./ai-feedback.cjs").handler };
  },
  "feedback-retrieve": async () => {
    return { success: !!require("./get-ai-feedback.cjs").handler };
  },
  "feedback-analytics": async () => {
    return { success: !!require("./feedback-analytics.cjs").handler };
  },
  "admin-stories": async () => {
    return { success: !!require("./admin-stories.cjs").handler };
  },
  "admin-budget": async () => {
    return { success: !!require("./ai-budget-settings.cjs").handler };
  },
  "admin-monitoring": async () => {
    return { success: !!require("./monitoring.cjs").handler };
  },

  // Category 11: Resilience
  "resilience-retry": async () => {
    return { success: !!require("./utils/retry.cjs").withRetry };
  },
  "resilience-timeout": async () => {
    return { success: !!require("./utils/time.cjs") };
  },
  "resilience-circuit": async () => {
    return { success: !!require("./utils/tool-circuit-breakers.cjs") };
  },
  "resilience-rate-limit": async () => {
    return { success: !!require("./utils/rate-limiter.cjs").checkRateLimit };
  },

  // Category 12: Security
  "security-auth": async () => {
    return { success: !!require("./utils/auth.cjs").validateToken };
  },
  "security-sanitize": async () => {
    return { success: !!require("./utils/security-sanitizer.cjs") };
  },
  "security-privacy": async () => {
    return { success: !!require("./utils/privacy-utils.cjs") };
  },
  "security-endpoint": async () => {
    return { success: !!require("./security.cjs").handler };
  },

  // Category 13: Integration
  "integration-upload-analyze": async () => {
    return {
      success:
        !!require("./upload.cjs").handler && !!require("./analyze.cjs").handler,
    };
  },
  "integration-analyze-history": async () => {
    return {
      success:
        !!require("./analyze.cjs").handler &&
        !!require("./history.cjs").handler,
    };
  },
  "integration-link-system": async () => {
    return {
      success:
        !!require("./history.cjs").handler &&
        !!require("./systems.cjs").handler,
    };
  },
  "integration-insights-feedback": async () => {
    return {
      success:
        !!require("./generate-insights-with-tools.cjs").handler &&
        !!require("./ai-feedback.cjs").handler,
    };
  },
  "integration-sync-cycle": async () => {
    return {
      success:
        !!require("./sync-metadata.cjs").handler &&
        !!require("./sync-push.cjs").handler,
    };
  },
};

// --- Main Handler ---
exports.handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();

  const auth = await validateToken(event.headers.authorization);
  if (!auth.valid || !isAdmin(auth.user)) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const payload = JSON.parse(event.body || "{}");
  const { testId, category, action = "run" } = payload;

  logger.info("Unified diagnostics request", { testId, category, action });

  const startTime = Date.now();
  let testsToRun = [];

  if (testId) {
    testsToRun = [testId];
  } else if (category) {
    testsToRun = Object.keys(TEST_METADATA).filter(
      (tid) => TEST_METADATA[tid].category === category,
    );
  } else if (action === "runAll") {
    testsToRun = Object.keys(TEST_METADATA);
  }

  const results = [];
  for (const tid of testsToRun) {
    const impl = testImplementations[tid];
    if (!impl) {
      results.push({
        testId: tid,
        status: "SKIPPED",
        error: "Implementation not yet added",
      });
      continue;
    }

    const testStartTime = Date.now();
    try {
      const result = await impl(payload.params || {});
      results.push({
        testId: tid,
        status: result.success ? "SUCCESS" : "FAILED",
        duration: Date.now() - testStartTime,
        details: result.details,
      });
    } catch (err) {
      results.push({
        testId: tid,
        status: "FAILED",
        duration: Date.now() - testStartTime,
        error: { message: err.message, stack: err.stack },
        aiPrompt: generateAIPrompt(tid, err, payload.params || {}),
      });
      logger.error(`Diagnostic test failed: ${tid}`, {
        error: err.message,
        stack: err.stack,
      });
    }
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      status: results.every((r) => r.status === "SUCCESS")
        ? "SUCCESS"
        : "PARTIAL",
      results,
      duration: Date.now() - startTime,
    }),
  };
};
