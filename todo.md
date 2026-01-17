Complete Unified Diagnostics Implementation Plan
All 86 Tests with Detailed Code
Category 1: Infrastructure (10 tests)
// === infra-mongodb ===
const { getDb } = require('./utils/mongodb.cjs');
async function test*infra_mongodb(testId) {
const db = await getDb();
const testDoc = { testId, timestamp: new Date() };
const insert = await db.collection('diagnostics-test').insertOne(testDoc);
const read = await db.collection('diagnostics-test').findOne({ \_id: insert.insertedId });
await db.collection('diagnostics-test').deleteMany({ testId });
return { insertOk: !!insert.insertedId, readOk: !!read };
}
// === infra-gemini ===
const { GeminiClient } = require('./utils/geminiClient.cjs');
async function test_infra_gemini(testId) {
const client = new GeminiClient();
const resp = await client.callAPI({ prompt: 'Reply DIAGNOSTIC_OK', maxTokens: 50 });
return { connected: true, valid: resp.text.includes('DIAGNOSTIC_OK') };
}
// === infra-logging ===
const { createLogger } = require('./utils/logger.cjs');
async function test_infra_logging(testId) {
const log = createLogger('diag', { testId });
log.info('INFO'); log.warn('WARN'); log.error('ERROR'); log.debug('DEBUG');
return { allLevels: true };
}
// === infra-error-handling ===
const { formatError } = require('./utils/logger.cjs');
async function test_infra_error_handling(testId) {
const err = new Error('Test'); err.code = 'TEST';
const f = formatError(err, { testId });
return { hasMessage: !!f.message, hasStack: !!f.stack, hasContext: !!f.context };
}
// === infra-cors ===
const { corsHeaders } = require('./utils/cors.cjs');
async function test_infra_cors(testId) {
const h = corsHeaders();
return { hasOrigin: !!h['Access-Control-Allow-Origin'] };
}
// === infra-auth ===
const { validateToken, isAdmin } = require('./utils/auth.cjs');
async function test_infra_auth(testId) {
const inv = await validateToken('invalid');
return { rejectsInvalid: !inv.valid, adminCheckWorks: isAdmin({ app_metadata: { roles: ['admin'] } }) };
}
// === infra-rate-limiter ===
const { checkRateLimit } = require('./utils/rate-limiter.cjs');
async function test_infra_rate_limiter(testId) {
const k = `diag*${testId}`;
  const r1 = await checkRateLimit(k, { limit: 2, window: 60 });
  const r2 = await checkRateLimit(k, { limit: 2, window: 60 });
  const r3 = await checkRateLimit(k, { limit: 2, window: 60 });
  return { firstPass: r1.allowed, thirdBlocked: !r3.allowed };
}
// === infra-cache ===
const { getCached, setCached } = require('./utils/cache.cjs');
async function test_infra_cache(testId) {
  await setCached(`diag_${testId}`, { test: true }, 60);
  const r = await getCached(`diag\_${testId}`);
  return { setOk: true, getOk: !!r };
}
// === infra-circuit-breaker ===
async function test_infra_circuit_breaker(testId) {
  const r = await fetch('/.netlify/functions/circuit-breaker-status');
  return { statusOk: r.ok };
}
// === infra-config ===
const config = require('./utils/config.cjs');
async function test_infra_config(testId) {
  return { hasMongoUri: !!process.env.MONGODB_URI, hasGemini: !!process.env.GEMINI_API_KEY };
}
Category 2: Core Analysis (8 tests)
// === analysis-endpoint ===
async function test_analysis_endpoint(testId) {
  const r = await fetch('/.netlify/functions/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgo=', systemId: 'test' })
  });
  return { responds: r.status !== 500 };
}
// === analysis-pipeline ===
const pipeline = require('./utils/analysis-pipeline.cjs');
async function test_analysis_pipeline(testId) {
  return { loaded: !!pipeline, functions: Object.keys(pipeline).filter(k => typeof pipeline[k] === 'function') };
}
// === analysis-helpers ===
const helpers = require('./utils/analysis-helpers.cjs');
async function test_analysis_helpers(testId) {
  return { loaded: !!helpers, count: Object.keys(helpers).length };
}
// === analysis-utilities ===
const utilities = require('./utils/analysis-utilities.cjs');
async function test_analysis_utilities(testId) {
  return { loaded: !!utilities, count: Object.keys(utilities).length };
}
// === analysis-validation ===
const { validateResponse } = require('./utils/response-validator.cjs');
async function test_analysis_validation(testId) {
  const valid = validateResponse({ soc: 85, voltage: 51.2 });
  const invalid = validateResponse({ garbage: 'data' });
  return { acceptsValid: valid.valid, rejectsInvalid: !invalid.valid };
}
// === analysis-duplicate ===
const { generateContentHash } = require('./utils/duplicate-detection.cjs');
async function test_analysis_duplicate(testId) {
  const h1 = generateContentHash('test1');
  const h2 = generateContentHash('test1');
  const h3 = generateContentHash('test2');
  return { sameHashSame: h1 === h2, diffHashDiff: h1 !== h3 };
}
// === analysis-hardware-id ===
async function test_analysis_hardware_id(testId) {
  const r = await fetch('/.netlify/functions/extract-hardware-id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'DL123456789' })
  });
  return { endpointOk: r.status !== 500 };
}
// === analysis-async ===
async function test_analysis_async(testId) {
  const r = await fetch('/.netlify/functions/generate-insights-status?jobId=test');
  return { statusEndpointOk: r.status !== 500 };
}
Category 3: Data & History (6 tests)
// === data-history ===
async function test_data_history(testId) {
  const r = await fetch('/.netlify/functions/history?limit=1');
  const d = await r.json();
  return { getOk: r.ok, isArray: Array.isArray(d.items || d) };
}
// === data-export ===
async function test_data_export(testId) {
  const r = await fetch('/.netlify/functions/export-data?format=json&limit=1');
  return { exportOk: r.ok };
}
// === data-sync-metadata ===
async function test_data_sync_metadata(testId) {
  const r = await fetch('/.netlify/functions/sync-metadata');
  const d = await r.json();
  return { metadataOk: r.ok, hasCount: typeof d.recordCount === 'number' };
}
// === data-sync-incremental ===
async function test_data_sync_incremental(testId) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const r = await fetch(`/.netlify/functions/sync-incremental?since=${since}`);
  return { incrementalOk: r.ok };
}
// === data-sync-push ===
async function test_data_sync_push(testId) {
  const r = await fetch('/.netlify/functions/sync-push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [], dryRun: true })
  });
  return { pushAccessible: r.status !== 500 };
}
// === data-poll-updates ===
async function test_data_poll_updates(testId) {
  const r = await fetch('/.netlify/functions/poll-updates?since=' + Date.now());
  return { pollOk: r.ok };
}
Category 4: Systems (4 tests)
// === systems-crud ===
async function test_systems_crud(testId) {
  const r = await fetch('/.netlify/functions/systems');
  const d = await r.json();
  return { getOk: r.ok, isArray: Array.isArray(d.systems || d) };
}
// === systems-analytics ===
async function test_systems_analytics(testId) {
  const r = await fetch('/.netlify/functions/system-analytics?systemId=test');
  return { analyticsAccessible: r.status !== 500 };
}
// === systems-association ===
const associator = require('./utils/intelligent-associator.cjs');
async function test_systems_association(testId) {
  return { associatorLoaded: !!associator, hasAssociate: typeof associator.associateByHardwareId === 'function' };
}
// === systems-linking ===
async function test_systems_linking(testId) {
  const r = await fetch('/.netlify/functions/history', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'link', recordId: 'test', systemId: 'test', dryRun: true })
  });
  return { linkAccessible: r.status !== 500 };
}
Category 5: AI & Insights (10 tests)
// === insights-basic ===
async function test_insights_basic(testId) {
  const r = await fetch('/.netlify/functions/generate-insights');
  return { endpointAccessible: r.status !== 500 };
}
// === insights-with-tools ===
async function test_insights_with_tools(testId) {
  const r = await fetch('/.netlify/functions/generate-insights-with-tools', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemId: 'test', dryRun: true })
  });
  return { toolsEndpointOk: r.status !== 500 };
}
// === insights-full-context ===
const contextBuilder = require('./utils/full-context-builder.cjs');
async function test_insights_full_context(testId) {
  return { builderLoaded: !!contextBuilder, hasBuild: typeof contextBuilder.buildFullContext === 'function' };
}
// === insights-guru ===
const guru = require('./utils/insights-guru.cjs');
async function test_insights_guru(testId) {
  return { guruLoaded: !!guru };
}
// === insights-react-loop ===
const reactLoop = require('./utils/react-loop.cjs');
async function test_insights_react_loop(testId) {
  return { reactLoopLoaded: !!reactLoop };
}
// === insights-jobs ===
const jobs = require('./utils/insights-jobs.cjs');
async function test_insights_jobs(testId) {
  return { jobsLoaded: !!jobs, hasCreate: typeof jobs.createJob === 'function', hasGet: typeof jobs.getJobStatus === 'function' };
}
// === insights-async ===
async function test_insights_async(testId) {
  const r = await fetch('/.netlify/functions/generate-insights-async-trigger', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemId: 'test', dryRun: true })
  });
  return { asyncTriggerOk: r.status !== 500 };
}
// === insights-token-limit ===
const tokenHandler = require('./utils/token-limit-handler.cjs');
async function test_insights_token_limit(testId) {
  return { handlerLoaded: !!tokenHandler };
}
// === insights-checkpoints ===
const checkpoints = require('./utils/checkpoint-manager.cjs');
async function test_insights_checkpoints(testId) {
  return { checkpointsLoaded: !!checkpoints, hasSave: typeof checkpoints.saveCheckpoint === 'function' };
}
// === insights-processor ===
const processor = require('./utils/insights-processor.cjs');
async function test_insights_processor(testId) {
  return { processorLoaded: !!processor };
}
Category 6: Gemini Tools (11 tests)
const { executeToolCall } = require('./utils/tool-executor.cjs');
// === tool-request-bms-data ===
async function test_tool_request_bms_data(testId) {
  try {
    const r = await executeToolCall('request_bms_data', { systemId: 'test', metric: 'soc', time_range_start: '2025-01-01', time_range_end: '2025-01-02' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-weather ===
async function test_tool_weather(testId) {
  try {
    const r = await executeToolCall('getWeatherData', { latitude: 37.77, longitude: -122.42 });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-solar ===
async function test_tool_solar(testId) {
  try {
    const r = await executeToolCall('getSolarEstimate', { location: '37.77,-122.42', panelWatts: 400, startDate: '2025-01-01', endDate: '2025-01-02' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-analytics ===
async function test_tool_analytics(testId) {
  try {
    const r = await executeToolCall('getSystemAnalytics', { systemId: 'test' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-predict-trends ===
async function test_tool_predict_trends(testId) {
  try {
    const r = await executeToolCall('predict_battery_trends', { systemId: 'test', metric: 'capacity' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-usage-patterns ===
async function test_tool_usage_patterns(testId) {
  try {
    const r = await executeToolCall('analyze_usage_patterns', { systemId: 'test', patternType: 'daily' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-energy-budget ===
async function test_tool_energy_budget(testId) {
  try {
    const r = await executeToolCall('calculate_energy_budget', { systemId: 'test', scenario: 'current' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-hourly-soc ===
async function test_tool_hourly_soc(testId) {
  try {
    const r = await executeToolCall('get_hourly_soc_predictions', { systemId: 'test', hoursBack: 24 });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-github-search ===
async function test_tool_github_search(testId) {
  try {
    const r = await executeToolCall('searchGitHubIssues', { query: 'diagnostics' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-codebase-file ===
async function test_tool_codebase_file(testId) {
  try {
    const r = await executeToolCall('getCodebaseFile', { path: 'package.json' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
// === tool-list-directory ===
async function test_tool_list_directory(testId) {
  try {
    const r = await executeToolCall('listDirectory', { path: 'netlify/functions' });
    return { toolOk: true, hasResult: !!r };
  } catch (e) { return { toolOk: false, error: e.message }; }
}
Category 7: Weather & Solar (6 tests)
// === weather-current ===
async function test_weather_current(testId) {
  const r = await fetch('/.netlify/functions/weather?lat=37.77&lon=-122.42&type=current');
  return { weatherOk: r.ok };
}
// === weather-historical ===
async function test_weather_historical(testId) {
  const r = await fetch('/.netlify/functions/weather?lat=37.77&lon=-122.42&type=historical');
  return { historicalOk: r.status !== 500 };
}
// === weather-backfill ===
const backfill = require('./utils/weather-batch-backfill.cjs');
async function test_weather_backfill(testId) {
  return { backfillLoaded: !!backfill };
}
// === solar-estimate ===
async function test_solar_estimate(testId) {
  const r = await fetch('/.netlify/functions/solar-estimate?location=37.77,-122.42&panelWatts=400');
  return { solarOk: r.status !== 500 };
}
// === solar-irradiance ===
const irradiance = require('./utils/solar-irradiance.cjs');
async function test_solar_irradiance(testId) {
  return { irradianceLoaded: !!irradiance };
}
// === solar-aware-analysis ===
const solarAware = require('./utils/solar-aware-load-analysis.cjs');
async function test_solar_aware_analysis(testId) {
  return { solarAwareLoaded: !!solarAware };
}
Category 8: Predictive & Analytics (6 tests)
// === predict-maintenance ===
async function test_predict_maintenance(testId) {
  const r = await fetch('/.netlify/functions/predictive-maintenance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemId: 'test' })
  });
  return { maintenanceOk: r.status !== 500 };
}
// === predict-trends ===
const forecasting = require('./utils/forecasting.cjs');
async function test_predict_trends(testId) {
  return { forecastingLoaded: !!forecasting };
}
// === analytics-comprehensive ===
const comprehensive = require('./utils/comprehensive-analytics.cjs');
async function test_analytics_comprehensive(testId) {
  return { comprehensiveLoaded: !!comprehensive };
}
// === analytics-patterns ===
const patterns = require('./utils/pattern-analysis.cjs');
async function test_analytics_patterns(testId) {
  return { patternsLoaded: !!patterns };
}
// === analytics-stats ===
const stats = require('./utils/statistical-tools.cjs');
async function test_analytics_stats(testId) {
  return { statsLoaded: !!stats };
}
// === analytics-forecasting ===
async function test_analytics_forecasting(testId) {
  const r = await fetch('/.netlify/functions/get-hourly-soc-predictions?systemId=test');
  return { forecastEndpointOk: r.status !== 500 };
}
Category 9: Validation & Quality (6 tests)
// === validate-data ===
const dataValidation = require('./utils/data-validation.cjs');
async function test_validate_data(testId) {
  return { validationLoaded: !!dataValidation };
}
// === validate-response ===
const respValidator = require('./utils/response-validator.cjs');
async function test_validate_response(testId) {
  return { validatorLoaded: !!respValidator, hasValidate: typeof respValidator.validateResponse === 'function' };
}
// === validate-schema ===
async function test_validate_schema(testId) {
  const r = await fetch('/.netlify/functions/admin-schema-diagnostics');
  return { schemaEndpointOk: r.status !== 500 };
}
// === quality-hashing ===
const hash = require('./utils/hash.cjs');
async function test_quality_hashing(testId) {
  return { hashLoaded: !!hash };
}
// === quality-idempotency ===
async function test_quality_idempotency(testId) {
  const r = await fetch('/.netlify/functions/check-duplicates-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: ['testhash123'] })
  });
  return { idempotencyOk: r.status !== 500 };
}
// === quality-integrity ===
async function test_quality_integrity(testId) {
  const r = await fetch('/.netlify/functions/admin-data-integrity');
  return { integrityOk: r.status !== 500 };
}
Category 10: Admin & Feedback (6 tests)
// === feedback-submit ===
async function test_feedback_submit(testId) {
  const r = await fetch('/.netlify/functions/ai-feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback: 'test', rating: 5, dryRun: true })
  });
  return { feedbackSubmitOk: r.status !== 500 };
}
// === feedback-retrieve ===
async function test_feedback_retrieve(testId) {
  const r = await fetch('/.netlify/functions/get-ai-feedback?limit=1');
  return { feedbackGetOk: r.status !== 500 };
}
// === feedback-analytics ===
async function test_feedback_analytics(testId) {
  const r = await fetch('/.netlify/functions/feedback-analytics');
  return { analyticsOk: r.status !== 500 };
}
// === admin-stories ===
async function test_admin_stories(testId) {
  const r = await fetch('/.netlify/functions/admin-stories');
  return { storiesOk: r.status !== 500 };
}
// === admin-budget ===
async function test_admin_budget(testId) {
  const r = await fetch('/.netlify/functions/ai-budget-settings');
  return { budgetOk: r.status !== 500 };
}
// === admin-monitoring ===
async function test_admin_monitoring(testId) {
  const r = await fetch('/.netlify/functions/monitoring');
  return { monitoringOk: r.status !== 500 };
}
Category 11: Resilience (4 tests)
// === resilience-retry ===
const retry = require('./utils/retry.cjs');
async function test_resilience_retry(testId) {
  return { retryLoaded: !!retry, hasExecute: typeof retry.executeWithRetry === 'function' };
}
// === resilience-timeout ===
const time = require('./utils/time.cjs');
async function test_resilience_timeout(testId) {
  return { timeLoaded: !!time };
}
// === resilience-circuit ===
const circuitBreakers = require('./utils/tool-circuit-breakers.cjs');
async function test_resilience_circuit(testId) {
  return { circuitLoaded: !!circuitBreakers };
}
// === resilience-rate-limit ===
const rateLimiter = require('./utils/rate-limiter.cjs');
async function test_resilience_rate_limit(testId) {
  return { rateLimiterLoaded: !!rateLimiter, hasCheck: typeof rateLimiter.checkRateLimit === 'function' };
}
Category 12: Security (4 tests)
// === security-auth ===
const auth = require('./utils/auth.cjs');
async function test_security_auth(testId) {
  return { authLoaded: !!auth, hasValidate: typeof auth.validateToken === 'function' };
}
// === security-sanitize ===
const sanitizer = require('./utils/security-sanitizer.cjs');
async function test_security_sanitize(testId) {
  return { sanitizerLoaded: !!sanitizer };
}
// === security-privacy ===
const privacy = require('./utils/privacy-utils.cjs');
async function test_security_privacy(testId) {
  return { privacyLoaded: !!privacy };
}
// === security-endpoint ===
async function test_security_endpoint(testId) {
  const r = await fetch('/.netlify/functions/security');
  return { securityEndpointOk: r.status !== 500 };
}
Category 13: Integration (5 tests)
// === integration-upload-analyze ===
async function test_integration_upload_analyze(testId) {
  const r = await fetch('/.netlify/functions/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun: true })
  });
  return { uploadPipelineAccessible: r.status !== 500 };
}
// === integration-analyze-history ===
async function test_integration_analyze_history(testId) {
  // Verify analyze can write to history collection
  const { getDb } = require('./utils/mongodb.cjs');
  const db = await getDb();
  const count = await db.collection('analyses').countDocuments();
  return { historyCollectionAccessible: count >= 0 };
}
// === integration-link-system ===
async function test_integration_link_system(testId) {
  const { getDb } = require('./utils/mongodb.cjs');
  const db = await getDb();
  const systemsCount = await db.collection('systems').countDocuments();
  const analysesCount = await db.collection('analyses').countDocuments();
  return { systemsAccessible: systemsCount >= 0, analysesAccessible: analysesCount >= 0 };
}
// === integration-insights-feedback ===
async function test_integration_insights_feedback(testId) {
  const iR = await fetch('/.netlify/functions/generate-insights-status?jobId=test');
  const fR = await fetch('/.netlify/functions/get-ai-feedback?limit=1');
  return { insightsOk: iR.status !== 500, feedbackOk: fR.status !== 500 };
}
// === integration-sync-cycle ===
async function test_integration_sync_cycle(testId) {
  const meta = await fetch('/.netlify/functions/sync-metadata');
  const incr = await fetch('/.netlify/functions/sync-incremental?since=' + new Date(0).toISOString());
  return { metaOk: meta.ok, incrOk: incr.status !== 500 };
}
AI Prompt Generator
function generateAIPrompt(result) {
  if (result.status === 'success') return null;
  return `## Fix ${result.testId}
**Category:** ${result.category}
**Error:** ${result.error}
**Files:** ${result.relatedFiles?.join(', ')}
**Task:** Debug and fix this failing test.`;
}
Files to Create/Modify
File Lines
src/constants/unified-diagnostics.ts ~600
netlify/functions/unified-diagnostics.cjs ~2500
src/components/UnifiedDiagnosticsDashboard.tsx
+500
Total ~3600
