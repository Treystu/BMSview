// @ts-nocheck
"use strict";

/**
 * Ultimate AI Battery Guru helpers.
 *
 * Provides context gathering and prompt construction utilities so the
 * generate-insights flows can orchestrate rich, data-backed conversations
 * with Gemini.
 */

const { generateInitialSummary } = require("./insights-summary.cjs");
const { getCollection } = require("./mongodb.cjs");
const { toolDefinitions, executeToolCall } = require("./gemini-tools.cjs");

const DEFAULT_LOOKBACK_DAYS = 30;
const RECENT_SNAPSHOT_LIMIT = 24;
const SYNC_CONTEXT_BUDGET_MS = 5000; // Further reduced - sync mode delegates to ReAct loop
const ASYNC_CONTEXT_BUDGET_MS = 45000;

/**
 * Fetch detailed context prior to prompting Gemini.
 * @param {string|undefined} systemId
 * @param {object} analysisData
 * @param {any} log
 * @param {{ maxMs?: number, mode?: "sync"|"background", skipExpensiveOps?: boolean }} options
 */
async function collectAutoInsightsContext(systemId, analysisData, log, options = {}) {
    const start = Date.now();
    const maxMs = options.maxMs || (options.mode === "background" ? ASYNC_CONTEXT_BUDGET_MS : SYNC_CONTEXT_BUDGET_MS);
    
    // In sync mode, skip expensive analytics and rely on ReAct loop instead
    const skipExpensiveOps = options.skipExpensiveOps !== undefined ? options.skipExpensiveOps : (options.mode === "sync");
    
    log.info('Starting context collection', { 
        mode: options.mode, 
        maxMs, 
        skipExpensiveOps,
        hasSystemId: !!systemId
    });

    /** @type {any} */
    const context = {
        systemProfile: null,
        initialSummary: null,
        analytics: null,
        usagePatterns: {
            daily: null,
            anomalies: null
        },
        energyBudgets: {
            current: null,
            worstCase: null
        },
        predictions: {
            capacity: null,
            lifetime: null
        },
        weather: null,
        recentSnapshots: [],
        meta: {
            steps: [],
            durationMs: 0,
            maxMs,
            truncated: false
        }
    };

    const shouldStop = () => Date.now() - start >= maxMs;

    /**
     * @param {string} label
     * @param {() => Promise<any>} fn
     */
    const runStep = async (label, fn) => {
        if (shouldStop()) {
            context.meta.truncated = true;
            log.debug("Context build budget exhausted", { label, elapsedMs: Date.now() - start, maxMs });
            return;
        }

        const stepStart = Date.now();
        try {
            const result = await fn();
            context.meta.steps.push({
                label,
                durationMs: Date.now() - stepStart,
                success: true
            });
            return result;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            context.meta.steps.push({
                label,
                durationMs: Date.now() - stepStart,
                success: false,
                error: err.message
            });
            log.warn("Context step failed", { step: label, error: err.message });
            return null;
        }
    };

    if (systemId) {
        context.systemProfile = await runStep("systemProfile", () => loadSystemProfile(systemId, log));
    }

    context.initialSummary = await runStep("initialSummary", () => generateInitialSummary(analysisData || {}, systemId || "", log));

    if (systemId && !skipExpensiveOps) {
        // These are expensive operations - skip in sync mode, let Gemini request via ReAct loop
        log.info('Loading full context (async mode)', { skipExpensiveOps });
        
        // Load 90-day daily rollup for comprehensive trend analysis
        context.dailyRollup90d = await runStep("dailyRollup90d", () => load90DayDailyRollup(systemId, log));
        
        // NEW: Add comparative periods for week-over-week and month-over-month analysis
        if (context.dailyRollup90d && context.dailyRollup90d.length > 0) {
            context.comparativePeriods = await runStep("comparativePeriods", () => 
                calculateComparativePeriods(context.dailyRollup90d, log)
            );
        }
        
        context.analytics = await runStep("analytics", async () => {
            const result = await executeToolCall("getSystemAnalytics", { systemId }, log);
            return normalizeToolResult(result);
        });

        context.usagePatterns.daily = await runStep("usage.daily", async () => {
            const result = await executeToolCall("analyze_usage_patterns", { systemId, patternType: "daily", timeRange: "30d" }, log);
            return normalizeToolResult(result);
        });

        context.usagePatterns.anomalies = await runStep("usage.anomalies", async () => {
            const result = await executeToolCall("analyze_usage_patterns", { systemId, patternType: "anomalies", timeRange: "60d" }, log);
            return normalizeToolResult(result);
        });

        context.energyBudgets.current = await runStep("energyBudget.current", async () => {
            const result = await executeToolCall("calculate_energy_budget", { systemId, scenario: "current", timeframe: "30d", includeWeather: true }, log);
            return normalizeToolResult(result);
        });

        context.energyBudgets.worstCase = await runStep("energyBudget.worstCase", async () => {
            const result = await executeToolCall("calculate_energy_budget", { systemId, scenario: "worst_case", timeframe: "30d", includeWeather: true }, log);
            return normalizeToolResult(result);
        });

        context.predictions.capacity = await runStep("prediction.capacity", async () => {
            const result = await executeToolCall("predict_battery_trends", { systemId, metric: "capacity", forecastDays: DEFAULT_LOOKBACK_DAYS, confidenceLevel: true }, log);
            return normalizeToolResult(result);
        });

        context.predictions.lifetime = await runStep("prediction.lifetime", async () => {
            const result = await executeToolCall("predict_battery_trends", { systemId, metric: "lifetime", confidenceLevel: true }, log);
            return normalizeToolResult(result);
        });
    } else if (systemId) {
        log.info('Skipping expensive context preload (sync mode) - Gemini will request via tools if needed', { skipExpensiveOps });
    }

    if (systemId) {
        if (context.systemProfile && context.systemProfile.location) {
            const { latitude, longitude } = context.systemProfile.location;
            if (isFiniteNumber(latitude) && isFiniteNumber(longitude)) {
                context.weather = await runStep("weather.current", async () => {
                    const result = await executeToolCall("getWeatherData", { latitude, longitude, type: "current" }, log);
                    return normalizeToolResult(result);
                });
            }
        }

        context.recentSnapshots = await runStep("recentSnapshots", () => loadRecentSnapshots(systemId, log));
    }

    context.batteryFacts = await runStep("batteryFacts", async () =>
        buildBatteryFacts({ analysisData, systemProfile: context.systemProfile })
    );

    const nightDischarge = await runStep("nightDischarge", async () =>
        analyzeNightDischargePatterns({
            snapshots: context.recentSnapshots,
            analysisData,
            systemProfile: context.systemProfile
        })
    );
    context.nightDischarge = nightDischarge;

    context.solarVariance = await runStep("solarVariance", async () =>
        estimateSolarVariance({
            snapshots: context.recentSnapshots,
            analysisData,
            systemProfile: context.systemProfile,
            weather: context.weather,
            nightDischarge
        })
    );

    context.meta.durationMs = Date.now() - start;
    
    log.info('Context collection complete', {
        durationMs: context.meta.durationMs,
        durationSec: (context.meta.durationMs / 1000).toFixed(1),
        maxMs,
        truncated: context.meta.truncated,
        stepsCompleted: context.meta.steps.length,
        stepsSucceeded: context.meta.steps.filter(s => s.success).length,
        stepsFailed: context.meta.steps.filter(s => !s.success).length
    });
    
    return context;
}

/**
 * Build the comprehensive prompt used for Gemini analysis.
 * @param {Object} params
 * @param {Object} params.analysisData
 * @param {string|undefined} params.systemId
 * @param {string|undefined} params.customPrompt
 * @param {*} params.log
 * @param {Object|undefined} params.context
 * @param {"sync"|"background"} [params.mode]
 */
async function buildGuruPrompt({ analysisData, systemId, customPrompt, log, context, mode = "sync" }) {
    const contextData = context || await collectAutoInsightsContext(systemId, analysisData, log, { mode });
    const toolCatalog = buildToolCatalog();
    const { sections } = buildContextSections(contextData, analysisData);

    const executionGuidance = buildExecutionGuidance(mode, contextData);
    const missionStatement = customPrompt ? buildCustomMission(customPrompt) : buildDefaultMission();
    
    // Build data availability summary
    const dataAvailability = await buildDataAvailabilitySummary(systemId, contextData, log);

    let prompt = "You are the Ultimate AI Battery Guru for off-grid energy systems. You ingest structured context, request targeted data through function calls, and deliver deeply analytical recommendations grounded in the evidence provided.\n";
    prompt += "Your goals: preserve battery health, guarantee energy sufficiency, and surface proactive maintenance or expansion actions.\n";

    // Add data availability info FIRST so Gemini knows what it can query
    if (dataAvailability) {
        prompt += `\n${dataAvailability}\n`;
    }

    prompt += `\n${executionGuidance}\n`;
    prompt += `\n**AVAILABLE TOOLS**\n${toolCatalog}\n`;

    if (sections.length > 0) {
        prompt += `\n${sections.join("\n\n")}\n`;
    }

    prompt += `\n${missionStatement}\n`;

    if (contextData?.batteryFacts?.brandNewLikely) {
        prompt += "\n**BATTERY CONDITION NOTE**\n- Pack is recently installed (<50 cycles). Do not declare severe capacity decline unless analytics tools corroborate with recent trend data. Prefer to frame concerns as monitoring items.\n";
    }

    if (contextData?.nightDischarge?.aggregate?.totalAh) {
        prompt += `\n**LOAD BASELINE NOTE**\n- Overnight draw baseline is ${formatNumber(contextData.nightDischarge.aggregate.avgCurrent, " A", 1)} consuming ~${formatNumber(contextData.nightDischarge.aggregate.totalAh, " Ah", 1)} before sunrise. Use this to explain SOC dips and distinguish from battery wear.\n`;
    }

    if (contextData?.solarVariance) {
        if (contextData.solarVariance.withinTolerance) {
            prompt += `\n**SOLAR MODEL NOTE**\n- Solar charging within expected range (±15% tolerance). No significant variance detected. Use baseline expectations for recommendations.\n`;
        } else if (isFiniteNumber(contextData.solarVariance.significantVarianceAh)) {
            const varianceText = contextData.solarVariance.significantVarianceAh > 0
                ? `Charging exceeded expectation by ${formatNumber(contextData.solarVariance.significantVarianceAh, " Ah", 1)} (beyond ±15% tolerance).`
                : `Charging lagged expectation by ${formatNumber(Math.abs(contextData.solarVariance.significantVarianceAh), " Ah", 1)} (beyond ±15% tolerance).`;
            prompt += `\n**SOLAR MODEL NOTE**\n- ${varianceText} Calibrate recommendations based on this significant variance.\n`;
        }
    }

    prompt += "\n**CRITICAL RESPONSE RULES - READ CAREFULLY**\n\n";
    
    prompt += "RESPONSE FORMAT REQUIREMENTS (STRICTLY ENFORCE):\n";
    prompt += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    prompt += "You MUST respond with valid JSON only. NO other text, NO markdown, NO explanations.\n\n";
    prompt += "Option 1 - Request additional data (use tool_call):\n";
    prompt += "{\n";
    prompt += "  \"tool_call\": \"request_bms_data\",\n";
    prompt += "  \"parameters\": {\n";
    prompt += "    \"systemId\": \"<the system ID>\",\n";
    prompt += "    \"metric\": \"voltage\",\n";
    prompt += "    \"time_range_start\": \"2025-11-01T00:00:00Z\",\n";
    prompt += "    \"time_range_end\": \"2025-11-08T00:00:00Z\",\n";
    prompt += "    \"granularity\": \"daily_avg\"\n";
    prompt += "  }\n";
    prompt += "}\n\n";
    prompt += "Option 2 - Provide your final analysis (use final_answer):\n";
    prompt += "{\n";
    prompt += "  \"final_answer\": \"## KEY FINDINGS\\n\\n**Battery Health:** Good condition...\\n\\n## RECOMMENDATIONS\\n\\n1. 🟢 Continue monitoring...\"\n";
    prompt += "}\n\n";
    prompt += "⚠️ CRITICAL: If you respond with anything other than valid JSON in one of these two formats, the system will FAIL.\n";
    prompt += "⚠️ DO NOT wrap JSON in markdown code blocks (no ```json).\n";
    prompt += "⚠️ DO NOT add explanatory text before or after the JSON.\n";
    prompt += "⚠️ DO NOT respond with empty text or whitespace.\n";
    prompt += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
    
    // Mode-specific guidance on tool usage
    if (mode === "background" && contextData?.analytics && !contextData.analytics.error) {
        prompt += "DATA AVAILABILITY: Comprehensive analytics, trends, budgets, and predictions are ALREADY PRELOADED in the context above. Review the preloaded data FIRST. You likely have ALL the data needed already. Only call tools if you need ADDITIONAL specific data not already provided (e.g., hourly breakdown of a specific metric over a custom date range). IMPORTANT: Prefer to analyze with existing data rather than requesting more.\n\n";
    } else {
        prompt += "DATA GATHERING: If you need data beyond what's provided, use tools to gather it. Don't suggest tools - USE them. Keep tool calls focused on the specific data needed to answer the question. Maximum 2-3 tool calls recommended.\n\n";
    }
    
    prompt += "ITERATION BUDGET: You have a MAXIMUM of 8 iterations. Each tool call uses one iteration. Plan carefully:\n";
    prompt += "- With preloaded comprehensive data: Provide final_answer immediately (iteration 1)\n";
    prompt += "- Need 1-2 data points: Request them (iterations 1-2), then final_answer (iteration 3)\n";
    prompt += "- Never use more than 3-4 iterations total\n\n";
    
    prompt += "CONTENT GUIDELINES:\n";
    prompt += "• WRITING STYLE: Terse, highlight-driven bullets. Lead with KEY FINDINGS in bold. Skip verbose explanations.\n";
    prompt += "• STRUCTURE: ## KEY FINDINGS (2-4 critical bullets with **bold labels**) → ## TREND ANALYSIS (statistical patterns) → ## RECOMMENDATIONS (numbered actions with urgency flags 🔴🟡🟢 and SPECIFIC numeric targets)\n";
    prompt += "• DO NOT include OPERATIONAL STATUS section - current voltage/SOC/current/temperature already displayed in UI\n";
    prompt += "• Cite sources inline: 'Solar deficit 15Ah (weather data + BMS logs)' not separate attribution\n";
    prompt += "• TERMINOLOGY: 'Battery autonomy'/'days of autonomy' = RUNTIME until discharge (Energy Budget). 'Service life'/'lifetime' = MONTHS/YEARS until replacement (Predictive Outlook). Never confuse.\n";
    prompt += "• DATA QUALITY: Screenshot-based monitoring has gaps. Use ±10% tolerance for energy deficits, ±15% for solar variance.\n";
    prompt += "• SOLAR VARIANCE: Delta between expected and actual = DAYTIME LOAD CONSUMPTION (not solar underperformance). Only flag solar issues when variance exceeds ±15% AND weather was favorable.\n";
    prompt += "• ALERT EVENTS: Group consecutive alerts into time-based events. Multiple screenshots showing same alert = ONE event until threshold recovery.\n";
    prompt += "\nENHANCED ANALYSIS REQUIREMENTS:\n";
    prompt += "• TREND ANALYSIS: Calculate and report trend directions (improving/degrading), rates of change (per day/week), and statistical confidence\n";
    prompt += "• NUMERIC SPECIFICITY: Every recommendation MUST include specific numbers (e.g., 'Add 200Ah capacity' not 'increase capacity', 'Reduce load by 5A' not 'reduce consumption')\n";
    prompt += "• COMPARATIVE ANALYSIS: Compare current metrics to historical averages/baselines. Report % deviation and whether it's significant\n";
    prompt += "• PREDICTIVE INSIGHTS: Project future states (e.g., 'At current degradation rate, reach 80% retention in 245 days', 'SOC will drop to 20% in 6.5 hours at current load')\n";
    prompt += "• ROOT CAUSE ANALYSIS: When identifying issues, explain the likely causes with evidence (correlate temp spikes with high current, SOC drops with load patterns)\n";
    prompt += "• PRIORITIZATION: Rank recommendations by impact and urgency. Use severity scoring (Critical/High/Medium/Low) with justification\n";
    prompt += "• ACTIONABILITY: Each recommendation should be concrete, measurable, and achievable. Include expected outcomes and validation criteria\n";

    return {
        prompt,
        context: contextData,
        contextSummary: summarizeContextForClient(contextData, analysisData)
    };
}

/**
 * @param {any} context
 * @param {any} analysisData
 */
function buildContextSections(context, analysisData) {
    const sections = [];

    if (context.systemProfile) {
        const systemProfileSection = formatSystemProfile(context.systemProfile);
        if (systemProfileSection) sections.push(systemProfileSection);
    }

    const batteryFactsSection = formatBatteryFactsSection(context.batteryFacts, analysisData);
    if (batteryFactsSection) sections.push(batteryFactsSection);

    const snapshotSection = formatCurrentSnapshot(analysisData);
    if (snapshotSection) sections.push(snapshotSection);

    if (context.initialSummary) {
        const initialSummarySection = formatInitialSummarySection(context.initialSummary);
        if (initialSummarySection) sections.push(initialSummarySection);
    }

    if (context.analytics) {
        const analyticsSection = formatAnalyticsSection(context.analytics);
        if (analyticsSection) sections.push(analyticsSection);
    }

    const usageSection = formatUsagePatternsSection(context.usagePatterns);
    if (usageSection) sections.push(usageSection);

    const budgetSection = formatEnergyBudgetsSection(context.energyBudgets);
    if (budgetSection) sections.push(budgetSection);

    const predictionSection = formatPredictionsSection(context.predictions);
    if (predictionSection) sections.push(predictionSection);

    const weatherSection = formatWeatherSection(context.weather);
    if (weatherSection) sections.push(weatherSection);

    const dailyRollupSection = formatDailyRollupSection(context.dailyRollup90d);
    if (dailyRollupSection) sections.push(dailyRollupSection);
    
    const comparativePeriodsSection = formatComparativePeriodsSection(context.comparativePeriods);
    if (comparativePeriodsSection) sections.push(comparativePeriodsSection);

    const nightDischargeSection = formatNightDischargeSection(context.nightDischarge, context.systemProfile);
    if (nightDischargeSection) sections.push(nightDischargeSection);

    const solarVarianceSection = formatSolarVarianceSection(context.solarVariance);
    if (solarVarianceSection) sections.push(solarVarianceSection);

    const recentSnapshotsSection = formatRecentSnapshotsSection(context.recentSnapshots);
    if (recentSnapshotsSection) sections.push(recentSnapshotsSection);

    return { sections };
}

/**
 * @param {"sync"|"background"} mode
 * @param {any} context
 */
function buildExecutionGuidance(mode, context) {
    const lines = ["**EXECUTION GUIDANCE**"];
    lines.push(`- Current run mode: ${mode === "background" ? "background (async)" : "synchronous"}. Plan tool usage to stay within limits.`);
    lines.push("- Synchronize only the data you need. If more than four tool calls or multi-week raw data seems necessary, recommend a background follow-up.");
    if (context?.meta) {
        lines.push(`- Preloaded context (${Math.round(context.meta.durationMs)} ms budget): ${summarizePreloadedContext(context)}`);
    }
    if (context?.batteryFacts?.brandNewLikely) {
        lines.push("- Pack flagged as low-cycle (<50). Treat capacity decline claims as provisional unless trend data confirms them.");
    }
    if (context?.nightDischarge?.aggregate?.avgCurrent) {
        lines.push(`- Overnight load baseline ≈ ${formatNumber(context.nightDischarge.aggregate.avgCurrent, " A", 1)} (${formatNumber(context.nightDischarge.aggregate.totalAh, " Ah", 1)} consumed) – use this before attributing SOC drops to cell degradation.`);
    }
    if (context?.solarVariance && isFiniteNumber(context.solarVariance.varianceAh)) {
        const variance = context.solarVariance.varianceAh;
        const varianceText = variance > 0
            ? `surplus charging of ${formatNumber(variance, " Ah", 1)}`
            : `deficit of ${formatNumber(Math.abs(variance), " Ah", 1)}`;
        lines.push(`- Solar comparison: ${varianceText} vs irradiance expectation. Adjust recommendations accordingly.`);
    }
    lines.push("- Use predictive, pattern, and budget tools to validate every recommendation against measured trends.");
    return lines.join("\n");
}

/**
 * @param {any} context
 */
function summarizePreloadedContext(context) {
    const highlights = [];
    if (context.analytics && !context.analytics.error) highlights.push("analytics");
    if (context.energyBudgets?.current && !context.energyBudgets.current.error) highlights.push("energy budget");
    if (context.predictions?.capacity && !context.predictions.capacity.error) highlights.push("forecasts");
    if (context.usagePatterns?.anomalies && !context.usagePatterns.anomalies.error) highlights.push("anomaly scan");
    if (highlights.length === 0) return "minimal";
    return highlights.join(", ");
}

function buildDefaultMission() {
    return "**PRIMARY MISSION:** Deliver an insightful, data-driven off-grid energy system analysis with actionable intelligence.\n\n**FORMAT REQUIREMENTS:**\n- Use markdown headers (##) for sections\n- Lead with ## KEY FINDINGS - 2-4 critical insights with **bold labels** and supporting data\n- Follow with ## TREND ANALYSIS - Statistical patterns, rates of change, and trajectory (improving/stable/degrading)\n- Close with ## RECOMMENDATIONS - Prioritized actions with:\n  * Urgency indicators (🔴 Critical / 🟡 Soon / 🟢 Monitor)\n  * SPECIFIC numeric targets (e.g., 'Add 200Ah', 'Reduce load by 5A', 'Replace in 245 days')\n  * Expected outcomes and validation criteria\n  * Cost-benefit rationale where applicable\n- DO NOT include OPERATIONAL STATUS section - current voltage/SOC/current/temperature are already displayed in the UI\n- Cite sources inline: 'metric (source)' not separate attribution sections\n\n**CRITICAL TERMINOLOGY:**\n- 'Battery autonomy' / 'days of autonomy' / 'runtime' = How many DAYS/HOURS the battery will power loads at current discharge rate before complete depletion (found in Energy Budget section).\n- 'Service life' / 'lifetime' / 'replacement timeline' = How many MONTHS/YEARS until the battery reaches end-of-life replacement threshold (70% capacity) based on degradation trends (found in Predictive Outlook section).\n- NEVER confuse these two concepts. They measure completely different things.\n\n**ENHANCED ANALYSIS APPROACH:**\n1. **Compare to Baselines**: Always compare current metrics to historical averages. Report % deviation and significance.\n2. **Calculate Trends**: Determine direction (up/down/stable) and rate of change (per day/week/month).\n3. **Identify Correlations**: Connect patterns (e.g., temp spikes during high current, SOC drops correlated with load increases).\n4. **Project Future States**: Use trends to forecast when thresholds will be reached (replacement, capacity limits, autonomy changes).\n5. **Quantify Everything**: Convert observations into numbers (Ah, W, days, %, etc.).\n6. **Prioritize by Impact**: Rank issues/recommendations by potential impact on system reliability and lifespan.\n\n**SOLAR VARIANCE INTERPRETATION:**\n- Delta between expected and actual solar charge often represents DAYTIME LOAD CONSUMPTION, not solar underperformance\n- Example: 220Ah expected, 58Ah recovered = 162Ah consumed by loads during charging hours (not a solar deficit)\n- Only flag solar issues when variance exceeds ±15% tolerance AND weather conditions were favorable (low clouds, high irradiance)\n- Calculate daytime load consumption and compare to nighttime consumption for load profiling\n\n**ALERT EVENT HANDLING:**\n- Group consecutive alerts showing same threshold into single events with duration estimates\n- Multiple screenshots with same alert ≠ multiple events - count as ONE event until threshold recovery\n- Use time-of-day context to infer when alerts likely cleared (e.g., low battery at night → sun comes up → likely recovered by noon)\n- Correlate alert frequency with environmental factors (temperature, load patterns, SOC levels)\n\n**STATISTICAL RIGOR:**\n- Report confidence levels for predictions (high/medium/low based on data quality and sample size)\n- Flag data gaps that may affect accuracy\n- Use moving averages to smooth noisy data\n- Identify outliers and determine if they're anomalies or emerging patterns";
}

/**
 * @param {string} customPrompt
 */
function buildCustomMission(customPrompt) {
    return `**USER QUESTION:**\n${customPrompt}\n\n**APPROACH:**\n1. Identify what data would definitively answer this question\n2. CALL the necessary tools NOW (don't suggest them)\n3. Analyze results and deliver terse, highlight-driven answer\n4. Format: ## KEY FINDINGS → ## ANALYSIS → ## NEXT STEPS\n5. Use bold labels, cite sources inline, skip fluff`;
}

/**
 * @param {string} systemId
 * @param {any} log
 */
async function loadSystemProfile(systemId, log) {
    try {
        const collection = await getCollection("systems");
        const system = await collection.findOne({ id: systemId }, { projection: { _id: 0 } });
        if (!system) {
            log.warn("System profile not found", { systemId });
            return null;
        }

        return {
            id: system.id,
            name: system.name,
            chemistry: system.chemistry,
            voltage: system.voltage,
            capacityAh: system.capacity,
            associatedDLs: Array.isArray(system.associatedDLs) ? system.associatedDLs : [],
            location: (isFiniteNumber(system.latitude) && isFiniteNumber(system.longitude))
                ? { latitude: system.latitude, longitude: system.longitude }
                : null,
            solar: {
                maxAmps: system.maxAmpsSolarCharging ?? null,
                generatorAmps: system.maxAmpsGeneratorCharging ?? null
            }
        };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.warn("Failed to load system profile", { systemId, error: err.message });
        return null;
    }
}

function formatSystemProfile(profile) {
    if (!profile) return null;
    const lines = ["**SYSTEM PROFILE**"];
    lines.push(`- Name: ${profile.name || profile.id || "unknown"}`);
    if (profile.chemistry) lines.push(`- Chemistry: ${profile.chemistry}`);
    if (isFiniteNumber(profile.voltage)) lines.push(`- Nominal Voltage: ${formatNumber(profile.voltage, " V", 1)}`);
    if (isFiniteNumber(profile.capacityAh)) lines.push(`- Rated Capacity: ${formatNumber(profile.capacityAh, " Ah", 1)}`);
    if (profile.location) {
        lines.push(`- Location: lat ${formatNumber(profile.location.latitude, "", 3)}, lon ${formatNumber(profile.location.longitude, "", 3)}`);
    }
    if (profile.solar && (isFiniteNumber(profile.solar.maxAmps) || isFiniteNumber(profile.solar.generatorAmps))) {
        lines.push(`- Charge Infrastructure: solar max ${formatNumber(profile.solar.maxAmps, " A", 1)}, generator ${formatNumber(profile.solar.generatorAmps, " A", 1)}`);
    }
    if (profile.associatedDLs && profile.associatedDLs.length > 0) {
        lines.push(`- Associated DLs: ${profile.associatedDLs.slice(0, 5).join(", ")}${profile.associatedDLs.length > 5 ? "…" : ""}`);
    }
    return lines.join("\n");
}

function formatBatteryFactsSection(facts, analysisData) {
    if (!facts) return null;
    const lines = ["**BATTERY BASELINE**"];

    if (isFiniteNumber(facts.ratedCapacityAh)) {
        lines.push(`- Rated capacity: ${formatNumber(facts.ratedCapacityAh, " Ah", 1)}.`);
    } else if (isFiniteNumber(analysisData?.fullCapacity)) {
        lines.push(`- Rated capacity (from snapshot): ${formatNumber(analysisData.fullCapacity, " Ah", 1)}.`);
    }

    if (facts.chemistry) {
        lines.push(`- Chemistry: ${facts.chemistry}.`);
    }

    if (isFiniteNumber(facts.cycleCount)) {
        const cycleText = formatNumber(facts.cycleCount, "", 0);
        lines.push(`- Cycle count: ${cycleText}${facts.brandNewLikely ? " (recent install)" : ""}.`);
    }

    if (facts.brandNewLikely && !lines.some(line => line.includes('recent install'))) {
        lines.push("- Cells flagged as recently installed (<50 cycles). Treat degradation estimates cautiously.");
    }

    if (isFiniteNumber(facts.referenceVoltage)) {
        lines.push(`- Reference voltage: ${formatNumber(facts.referenceVoltage, " V", 1)} used for power estimates.`);
    }

    if (isFiniteNumber(facts.cellsInSeries)) {
        lines.push(`- Cells in series: ${formatNumber(facts.cellsInSeries, "", 0)}.`);
    }

    return lines.length > 1 ? lines.join("\n") : null;
}

function formatCurrentSnapshot(analysisData) {
    if (!analysisData) return null;
    const lines = ["**CURRENT SNAPSHOT**"];
    lines.push(`- Voltage: ${formatNumber(analysisData.overallVoltage, " V", 2)}`);
    lines.push(`- Current: ${formatNumber(analysisData.current, " A", 2)} (${analysisData.current > 0.5 ? "charging" : analysisData.current < -0.5 ? "discharging" : "idle"})`);
    lines.push(`- Power: ${formatNumber(analysisData.power, " W", 1)}`);
    lines.push(`- State of Charge: ${formatPercent(analysisData.stateOfCharge, 1)}`);
    if (isFiniteNumber(analysisData.remainingCapacity)) {
        lines.push(`- Remaining Capacity: ${formatNumber(analysisData.remainingCapacity, " Ah", 1)}`);
    }
    if (isFiniteNumber(analysisData.temperature)) {
        lines.push(`- Temperature: ${formatNumber(analysisData.temperature, " °C", 1)}`);
    }
    if (isFiniteNumber(analysisData.cellVoltageDifference)) {
        lines.push(`- Cell Imbalance: ${formatNumber(analysisData.cellVoltageDifference * 1000, " mV", 1)}`);
    }
    if (Array.isArray(analysisData.alerts) && analysisData.alerts.length > 0) {
        lines.push(`- Alerts: ${analysisData.alerts.slice(0, 3).join("; ")}${analysisData.alerts.length > 3 ? "…" : ""}`);
    }
    return lines.join("\n");
}

function formatInitialSummarySection(summary) {
    if (!summary) return null;
    const lines = ["**SEVEN-DAY HIGHLIGHTS**"];
    if (summary.current) {
        const trend = summary.current.isCharging ? "charging" : summary.current.isDischarging ? "discharging" : "stable";
        lines.push(`- Live reading: ${formatPercent(summary.current.soc, 1)} SOC at ${formatNumber(summary.current.voltage, " V", 2)} / ${formatNumber(summary.current.current, " A", 1)} (${trend}).`);
    }
    if (summary.historical?.daily && summary.historical.daily.length > 0) {
        const avgSoc = average(summary.historical.daily.map(d => d.avgSOC));
        const avgCurrent = average(summary.historical.daily.map(d => d.avgCurrent));
        lines.push(`- Avg SOC (7d): ${formatPercent(avgSoc, 1)}; Avg current draw: ${formatNumber(Math.abs(avgCurrent), " A", 1)}.`);
    } else {
        lines.push("- Historical window: insufficient recent data (last 7 days). Consider requesting specific ranges.");
    }
    if (summary.historical?.charging) {
        const charging = summary.historical.charging;
        lines.push(`- Charge vs discharge samples: ${charging.chargingDataPoints}/${charging.dischargingDataPoints}; avg charge ${formatNumber(charging.avgChargingCurrent, " A", 1)}, avg discharge ${formatNumber(charging.avgDischargingCurrent, " A", 1)}.`);
    }
    return lines.join("\n");
}

function formatAnalyticsSection(analytics) {
    if (!analytics || analytics.error) return null;
    const lines = ["**ANALYTICS BASELINE**"];
    if (analytics.hourlyAverages && analytics.hourlyAverages.length > 0) {
        const peakCharge = findPeak(analytics.hourlyAverages, "current", "avgCharge");
        const peakDischarge = findPeak(analytics.hourlyAverages, "current", "avgDischarge", "min");
        if (peakCharge) {
            lines.push(`- Best solar hour: ${peakCharge.hour}:00 with ≈${formatNumber(peakCharge.value, " A", 1)} charging.`);
        }
        if (peakDischarge) {
            lines.push(`- Heaviest load: ${peakDischarge.hour}:00 drawing ≈${formatNumber(Math.abs(peakDischarge.value), " A", 1)}.`);
        }
    }
    if (analytics.performanceBaseline?.sunnyDayChargingAmpsByHour?.length) {
        const sunnyMax = analytics.performanceBaseline.sunnyDayChargingAmpsByHour.reduce((a, b) => (b.avgCurrent || 0) > (a.avgCurrent || 0) ? b : a);
        if (sunnyMax && sunnyMax.avgCurrent) {
            lines.push(`- Sunny-day baseline: ${formatNumber(sunnyMax.avgCurrent, " A", 1)} at ${sunnyMax.hour}:00.`);
        }
    }
    if (analytics.alertAnalysis?.totalEvents) {
        const topAlert = analytics.alertAnalysis.alertCounts?.[0];
        const totalEvents = analytics.alertAnalysis.totalEvents;
        const totalOccurrences = analytics.alertAnalysis.totalAlerts;
        
        if (topAlert) {
            lines.push(`- Alert events: ${totalEvents} distinct events from ${totalOccurrences} screenshot occurrences (top: ${topAlert.alert} - ${topAlert.count} events, ${topAlert.occurrences} occurrences${topAlert.avgDurationHours ? `, avg ${formatNumber(topAlert.avgDurationHours, "h", 1)}` : ""}).`);
        } else {
            lines.push(`- Alert events: ${totalEvents} distinct events from ${totalOccurrences} screenshot occurrences.`);
        }
    } else if (analytics.alertAnalysis?.totalAlerts) {
        // Fallback for old format
        const topAlert = analytics.alertAnalysis.alertCounts?.[0];
        lines.push(`- Alert volume: ${analytics.alertAnalysis.totalAlerts} (top: ${topAlert ? `${topAlert.alert} ×${topAlert.count}` : "none"}).`);
    }
    return lines.join("\n");
}

function formatUsagePatternsSection(usagePatterns) {
    if (!usagePatterns) return null;
    const lines = ["**USAGE PATTERNS**"];
    const daily = usagePatterns.daily;
    if (daily) {
        if (daily.error) {
            lines.push(`- Daily patterns: error – ${daily.message || "unavailable"}.`);
        } else if (daily.insufficient_data) {
            lines.push(`- Daily patterns: insufficient data (${daily.message}).`);
        } else {
            if (daily.peakUsage?.discharge) {
                lines.push(`- Peak consumption: ${daily.peakUsage.discharge.timeOfDay} drawing ${formatNumber(Math.abs(daily.peakUsage.discharge.avgCurrent), " A", 1)}.`);
            }
            if (daily.peakUsage?.charge) {
                lines.push(`- Peak charging: ${daily.peakUsage.charge.timeOfDay} at ${formatNumber(daily.peakUsage.charge.avgCurrent, " A", 1)}.`);
            }
            lines.push(`- Avg daily net balance: ${formatNumber(daily.dailySummary?.netBalance, " A", 1)} (positive means net charge).`);
        }
    }
    const anomalies = usagePatterns.anomalies;
    if (anomalies) {
        if (anomalies.error) {
            lines.push(`- Anomaly scan: error – ${anomalies.message || "unavailable"}.`);
        } else if (anomalies.insufficient_data) {
            lines.push(`- Anomaly scan: insufficient data (${anomalies.message}).`);
        } else {
            lines.push(`- Anomalies last period: ${anomalies.summary?.total || 0} (high severity: ${anomalies.summary?.highSeverity || 0}).`);
            const recent = anomalies.anomalies?.slice(0, 2) || [];
            if (recent.length > 0) {
                lines.push(`- Recent anomaly samples: ${recent.map(a => `${a.type}@${formatTimestampHour(a.timestamp)}`).join(", ")}.`);
            }
        }
    }
    return lines.length > 1 ? lines.join("\n") : null;
}

function formatEnergyBudgetsSection(energyBudgets) {
    if (!energyBudgets) return null;
    const lines = ["**ENERGY BUDGET**"];
    const current = energyBudgets.current;
    if (current) {
        if (current.error) {
            lines.push(`- Current scenario: error – ${current.message || "unavailable"}.`);
        } else if (current.insufficient_data) {
            lines.push(`- Current scenario: insufficient data (${current.message}).`);
        } else {
            // NEW: Show data quality warnings
            if (current.dataQuality && !current.dataQuality.isReliable) {
                lines.push(`- ⚠️ Data quality: ${current.dataQuality.completeness}% coverage (${formatNumber(current.dataQuality.samplesPerDay, " samples/day", 1)}). Sporadic screenshots limit accuracy.`);
            }

            lines.push(`- Daily generation vs consumption: ${formatNumber(current.energyFlow?.dailyGeneration, " Wh", 0)} in / ${formatNumber(current.energyFlow?.dailyConsumption, " Wh", 0)} out.`);

            // NEW: Only show deficit if it's real and data is reliable
            if (current.solarSufficiency?.deficit > 0 && current.dataQuality?.isReliable) {
                lines.push(`- Solar sufficiency: ${formatPercent(current.solarSufficiency?.percentage, 0)} (${formatNumber(current.solarSufficiency.deficit, " Wh/day", 0)} deficit – verified with ${current.dataPoints} measurements).`);
            } else if (current.solarSufficiency?.note) {
                lines.push(`- Solar status: ${current.solarSufficiency.status} (${current.solarSufficiency.note}).`);
            } else {
                lines.push(`- Solar sufficiency: ${formatPercent(current.solarSufficiency?.percentage, 0)} (${current.solarSufficiency?.status || "unknown"}).`);
            }

            if (isFiniteNumber(current.batteryMetrics?.daysOfAutonomy)) {
                lines.push(`- Battery autonomy at current load: ${formatNumber(current.batteryMetrics.daysOfAutonomy, " days", 1)}.`);
            }

            // NEW: Generator runtime recommendation
            if (current.generatorRecommendation) {
                const gen = current.generatorRecommendation;
                lines.push(`- Generator recommendation: Run at ${formatNumber(gen.generatorMaxAmps, " A", 0)} for ${gen.recommendedRuntimeMinutes} min/day to compensate ${formatNumber(gen.dailyDeficitAh, " Ah", 1)} deficit (est. ${formatNumber(gen.estimatedFuelLiters, " L/day", 1)} fuel).`);
            }
        }
    }
    const worstCase = energyBudgets.worstCase;
    if (worstCase && !worstCase.error && !worstCase.insufficient_data) {
        lines.push(`- Worst-case deficit: ${formatNumber(worstCase.worstCaseMetrics?.dailyDeficit, " Wh", 0)} (battery sustains ${formatNumber(worstCase.batteryAutonomy?.daysWithoutSolar, " days", 1)} without sun).`);
    }
    return lines.length > 1 ? lines.join("\n") : null;
}

function formatPredictionsSection(predictions) {
    if (!predictions) return null;
    const lines = ["**PREDICTIVE OUTLOOK**"];
    const capacity = predictions.capacity;
    if (capacity) {
        if (capacity.error) {
            lines.push(`- Capacity trend: error – ${capacity.message || "unavailable"}.`);
        } else if (capacity.insufficient_data) {
            lines.push(`- Capacity trend: insufficient data (${capacity.message}).`);
        } else {
            // Check if this is a new battery with provisional results
            if (capacity.degradationRate?.note) {
                lines.push(`- **New Battery Status**: ${capacity.degradationRate.note}`);
                if (capacity.averageRetention != null) {
                    lines.push(`- Current capacity retention: ${formatNumber(capacity.averageRetention, "%", 1)} (${capacity.cycleCount || 'unknown'} cycles).`);
                }
                if (capacity.recommendation) {
                    lines.push(`- ${capacity.recommendation}`);
                }
            } else {
                // Established degradation trend
                const ahPerDay = capacity.degradationRate?.value || 0;
                const percentPerDay = capacity.degradationRate?.percentPerDay || 0;
                const vsExpected = capacity.degradationRate?.vsExpected;

                lines.push(`- Measured degradation: ${formatNumber(ahPerDay, " Ah/day", 3)} (${formatNumber(percentPerDay * 100, "%/day", 4)})${vsExpected != null ? ` – ${formatNumber(vsExpected, "x expected", 1)}` : ""}.`);

                if (capacity.daysToReplacementThreshold != null && capacity.daysToReplacementThreshold > 0) {
                    lines.push(`- Replacement threshold (80% retention) in ${formatNumber(capacity.daysToReplacementThreshold, " days", 0)}.`);
                }

                if (capacity.confidence?.confidenceLevel) {
                    lines.push(`- Forecast confidence: ${capacity.confidence.confidenceLevel} (R² ${formatNumber(capacity.confidence.rSquared, "", 2)})${capacity.confidence.dataQuality && capacity.confidence.dataQuality !== 'acceptable' ? ` – ${capacity.confidence.dataQuality}` : ""}.`);
                }

                if (capacity.cycleCount != null) {
                    lines.push(`- Analysis based on ${capacity.cycleCount} cycles, ${capacity.historicalDataPoints || 0} high-SOC measurements over ${capacity.timeRange?.days || 0} days.`);
                }
            }
        }
    }
    const lifetime = predictions.lifetime;
    if (lifetime && !lifetime.error && !lifetime.insufficient_data) {
        lines.push(`- Estimated SERVICE LIFE until replacement: ${formatNumber(lifetime.estimatedRemainingLife?.months, " months", 0)} (${formatNumber(lifetime.estimatedRemainingLife?.years, " years", 1)}) based on degradation trends.`);
        lines.push(`- NOTE: For RUNTIME until discharge at current load, see Battery Autonomy in Energy Budget section.`);
    }
    return lines.length > 1 ? lines.join("\n") : null;
}

function formatWeatherSection(weather) {
    if (!weather || weather.error) return null;
    const lines = ["**WEATHER CONTEXT**"];
    if (isFiniteNumber(weather.temp)) lines.push(`- Temperature: ${formatNumber(weather.temp, " °C", 1)}.`);
    if (isFiniteNumber(weather.clouds)) lines.push(`- Cloud cover: ${formatPercent(weather.clouds, 0)}.`);
    if (isFiniteNumber(weather.uvi)) lines.push(`- UV index: ${formatNumber(weather.uvi, "", 1)}.`);
    if (weather.weather_main) lines.push(`- Conditions: ${weather.weather_main}.`);
    return lines.length > 1 ? lines.join("\n") : null;
}

function formatNightDischargeSection(nightDischarge, systemProfile) {
    if (!nightDischarge || !nightDischarge.aggregate) return null;
    const { aggregate, segments } = nightDischarge;
    if (!aggregate.avgCurrent && !aggregate.totalAh) return null;

    const lines = ["**OVERNIGHT LOAD ANALYSIS**"];
    if (isFiniteNumber(aggregate.avgCurrent)) {
        const wattsText = isFiniteNumber(aggregate.avgWatts)
            ? ` (~${formatNumber(aggregate.avgWatts, " W", 0)})`
            : "";
        lines.push(`- Average overnight draw: ${formatNumber(aggregate.avgCurrent, " A", 1)}${wattsText}.`);
    }
    if (isFiniteNumber(aggregate.totalAh) && isFiniteNumber(aggregate.totalHours)) {
        lines.push(`- Consumption window: ${formatNumber(aggregate.totalHours, " h", 1)} totaling ${formatNumber(aggregate.totalAh, " Ah", 1)}.`);
    } else if (isFiniteNumber(aggregate.totalAh)) {
        lines.push(`- Estimated overnight consumption: ${formatNumber(aggregate.totalAh, " Ah", 1)}.`);
    }

    const latestSegment = Array.isArray(segments) && segments.length > 0 ? segments[segments.length - 1] : null;
    if (latestSegment) {
        lines.push(`- Most recent heavy draw lasted ${formatNumber(latestSegment.durationHours, " h", 1)} with peaks at ${formatNumber(latestSegment.peakCurrent, " A", 1)}.`);
    }

    if (!aggregate.isNightDominant) {
        lines.push("- Note: discharge activity spans beyond typical night hours; investigate continuous loads.");
    }

    if (systemProfile?.solar?.maxAmps && isFiniteNumber(systemProfile.voltage)) {
        const replacementAh = systemProfile.solar.maxAmps * Math.max(aggregate.totalHours || 0, 1);
        lines.push(`- To offset this, solar must deliver ≈${formatNumber(replacementAh, " Ah", 1)} at ${formatNumber(systemProfile.voltage, " V", 1)} during daylight.`);
    }

    return lines.join("\n");
}

function formatSolarVarianceSection(variance) {
    if (!variance) return null;
    const lines = ["**SOLAR VARIANCE CHECK**"];

    if (isFiniteNumber(variance.actualSolarAh)) {
        lines.push(`- Actual recovered charge: ${formatNumber(variance.actualSolarAh, " Ah", 1)}${isFiniteNumber(variance.actualSolarWh) ? ` (~${formatNumber(variance.actualSolarWh, " Wh", 0)})` : ""}.`);
    }

    if (isFiniteNumber(variance.expectedSolarAh)) {
        lines.push(`- Modeled expectation (weather-adjusted): ${formatNumber(variance.expectedSolarAh, " Ah", 1)} using ${formatNumber(variance.sunHours, " h", 1)} sun hours${isFiniteNumber(variance.cloudCover) ? ` at ${formatPercent(variance.cloudCover, 0)} clouds` : ""}.`);
    }

    // NEW: Show daytime load consumption (key insight!)
    if (isFiniteNumber(variance.daytimeLoadAh) && variance.daytimeLoadAh > 5) {
        lines.push(`- Estimated daytime load: ${formatNumber(variance.daytimeLoadAh, " Ah", 1)}${isFiniteNumber(variance.daytimeLoadWh) ? ` (~${formatNumber(variance.daytimeLoadWh / 1000, " kWh", 1)})` : ""} consumed during charging hours.`);
    }

    // Show tolerance-aware variance reporting
    if (variance.withinTolerance !== undefined) {
        if (variance.withinTolerance) {
            lines.push(`- Solar variance: Within expected range (±15% tolerance = ±${formatNumber(variance.toleranceAh, " Ah", 1)}).`);
            if (isFiniteNumber(variance.rawVarianceAh)) {
                const direction = variance.rawVarianceAh > 0 ? "above" : "below";
                lines.push(`- Measured difference: ${formatNumber(Math.abs(variance.rawVarianceAh), " Ah", 1)} ${direction} expected (normal variation).`);
            }
        } else if (isFiniteNumber(variance.significantVarianceAh)) {
            const varianceText = variance.significantVarianceAh > 0
                ? `surplus of ${formatNumber(variance.significantVarianceAh, " Ah", 1)}`
                : `deficit of ${formatNumber(Math.abs(variance.significantVarianceAh), " Ah", 1)}`;
            const weatherContext = variance.favorableWeather ? " despite favorable weather" : " (may be weather-related)";
            lines.push(`- Significant solar variance detected: ${varianceText}${weatherContext} (exceeds ±15% tolerance of ±${formatNumber(variance.toleranceAh, " Ah", 1)}).`);
        }
    } else if (isFiniteNumber(variance.varianceAh)) {
        // Fallback for old format (backward compatibility)
        const varianceText = variance.varianceAh > 0
            ? `surplus of ${formatNumber(variance.varianceAh, " Ah", 1)}`
            : `deficit of ${formatNumber(Math.abs(variance.varianceAh), " Ah", 1)}`;
        lines.push(`- Solar variance vs expectation: ${varianceText}.`);
    }

    if (isFiniteNumber(variance.anticipatedNightConsumptionAh)) {
        lines.push(`- Nightly consumption needing replacement: ${formatNumber(variance.anticipatedNightConsumptionAh, " Ah", 1)}.`);
    }

    if (isFiniteNumber(variance.balanceAh)) {
        const balancePositive = variance.balanceAh >= 0;
        lines.push(`- Net balance after night usage: ${balancePositive ? "+" : ""}${formatNumber(variance.balanceAh, " Ah", 1)} (${balancePositive ? "remaining headroom" : "shortfall"}).`);
    }

    if (variance.recommendation) {
        lines.push(`- Insight: ${variance.recommendation}`);
    }

    return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * Format 90-day daily rollup section for AI context
 * Provides comprehensive historical trend data with hourly granularity
 * OPTIMIZED: More aggressive sampling to prevent token overflow
 * ENHANCED: Now includes statistical trend analysis
 */
function formatDailyRollupSection(dailyRollup) {
    if (!Array.isArray(dailyRollup) || dailyRollup.length === 0) return null;
    
    const lines = ["**90-DAY HISTORICAL TREND DATA**"];
    
    // Calculate overall statistics
    const totalDays = dailyRollup.length;
    const totalDataPoints = dailyRollup.reduce((sum, day) => sum + day.dataPoints, 0);
    const avgPointsPerDay = (totalDataPoints / totalDays).toFixed(1);
    
    const startDate = dailyRollup[0].date;
    const endDate = dailyRollup[dailyRollup.length - 1].date;
    
    lines.push(`- Time range: ${startDate} to ${endDate} (${totalDays} days)`);
    lines.push(`- Data coverage: ${totalDataPoints} total readings (avg ${avgPointsPerDay} per day)`);
    
    // Calculate trend statistics
    const allDailySummaries = dailyRollup.map(d => d.dailySummary).filter(Boolean);
    
    if (allDailySummaries.length > 0) {
        const avgSocValues = allDailySummaries.map(d => d.avgSoc).filter(isFiniteNumber);
        const avgVoltageValues = allDailySummaries.map(d => d.avgVoltage).filter(isFiniteNumber);
        const avgCurrentValues = allDailySummaries.map(d => d.avgCurrent).filter(isFiniteNumber);
        const totalAlertsCount = allDailySummaries.reduce((sum, d) => sum + (d.totalAlerts || 0), 0);
        
        if (avgSocValues.length > 0) {
            const overallAvgSoc = average(avgSocValues);
            const minSoc = Math.min(...avgSocValues);
            const maxSoc = Math.max(...avgSocValues);
            const socStdDev = standardDeviation(avgSocValues);
            lines.push(`- SOC range: ${formatPercent(minSoc, 0)} to ${formatPercent(maxSoc, 0)} (avg ${formatPercent(overallAvgSoc, 0)}, σ ${formatPercent(socStdDev, 1)})`);
            
            // Calculate SOC trend (linear regression)
            const socTrend = calculateLinearTrend(avgSocValues);
            if (socTrend) {
                const direction = socTrend.slope > 0.01 ? '📈 Improving' : socTrend.slope < -0.01 ? '📉 Declining' : '➡️ Stable';
                lines.push(`- SOC trend: ${direction} (${formatSigned(socTrend.slope * totalDays, '%', 1)} over period, R²=${formatNumber(socTrend.rSquared, '', 2)})`);
            }
        }
        
        if (avgVoltageValues.length > 0) {
            const overallAvgVoltage = average(avgVoltageValues);
            const voltageStdDev = standardDeviation(avgVoltageValues);
            lines.push(`- Average voltage: ${formatNumber(overallAvgVoltage, " V", 2)} (σ ${formatNumber(voltageStdDev, 'V', 2)})`);
            
            // Calculate voltage trend
            const voltageTrend = calculateLinearTrend(avgVoltageValues);
            if (voltageTrend) {
                const direction = voltageTrend.slope > 0.01 ? '📈 Rising' : voltageTrend.slope < -0.01 ? '📉 Falling' : '➡️ Stable';
                lines.push(`- Voltage trend: ${direction} (${formatSigned(voltageTrend.slope * totalDays, 'V', 2)} over period, R²=${formatNumber(voltageTrend.rSquared, '', 2)})`);
            }
        }
        
        if (avgCurrentValues.length > 0) {
            const overallAvgCurrent = average(avgCurrentValues);
            const chargingDays = avgCurrentValues.filter(c => c > 0.5).length;
            const dischargingDays = avgCurrentValues.filter(c => c < -0.5).length;
            lines.push(`- Average current: ${formatNumber(overallAvgCurrent, " A", 1)} (${chargingDays} charging days, ${dischargingDays} discharging days)`);
            
            // Calculate energy balance trend
            const netEnergyTrend = calculateLinearTrend(avgCurrentValues);
            if (netEnergyTrend) {
                const balanceStatus = netEnergyTrend.slope > 0.01 ? '📈 Improving balance' : netEnergyTrend.slope < -0.01 ? '📉 Worsening deficit' : '➡️ Stable balance';
                lines.push(`- Energy balance trend: ${balanceStatus} (${formatSigned(netEnergyTrend.slope * totalDays, 'A', 2)} over period)`);
            }
        }
        
        if (totalAlertsCount > 0) {
            const alertsPerDay = totalAlertsCount / totalDays;
            lines.push(`- Total alerts across period: ${totalAlertsCount} (avg ${formatNumber(alertsPerDay, '/day', 1)})`);
            
            // Calculate alert frequency trend
            const dailyAlertCounts = allDailySummaries.map(d => d.totalAlerts || 0);
            const alertTrend = calculateLinearTrend(dailyAlertCounts);
            if (alertTrend) {
                const alertDirection = alertTrend.slope > 0.1 ? '⚠️ Increasing' : alertTrend.slope < -0.1 ? '✅ Decreasing' : '➡️ Stable';
                lines.push(`- Alert frequency trend: ${alertDirection} (${formatSigned(alertTrend.slope * totalDays, ' alerts', 0)} over period)`);
            }
        }
    }
    
    // OPTIMIZATION: Only include recent 7 days with SAMPLED hourly detail (not all hours)
    const recentDays = dailyRollup.slice(-7);
    if (recentDays.length > 0) {
        lines.push("\n- **Recent 7-day summary (use request_bms_data for hourly detail):**");
        for (const day of recentDays) {
            const summary = day.dailySummary;
            if (!summary) continue;
            
            const socRange = isFiniteNumber(summary.minSoc) && isFiniteNumber(summary.maxSoc)
                ? `${formatPercent(summary.minSoc, 0)}-${formatPercent(summary.maxSoc, 0)}`
                : 'n/a';
            
            lines.push(`  - ${day.date}: ${day.hours}h coverage (${day.dataPoints} points), SOC ${socRange}, ${summary.totalAlerts || 0} alerts`);
            
            // REMOVED: Hourly compact format - too verbose, causes token overflow
            // AI should use request_bms_data tool if it needs hourly data
        }
    }
    
    lines.push("\n- **Usage notes:** For detailed hourly data, use request_bms_data tool with specific metrics and time ranges. This summary provides high-level context only.");
    
    return lines.join("\n");
}

/**
 * Calculate linear trend using least squares regression
 * Returns slope, intercept, and R² value
 */
function calculateLinearTrend(values) {
    const filtered = values.filter(v => isFiniteNumber(v));
    if (filtered.length < 3) return null; // Need at least 3 points for meaningful trend
    
    const n = filtered.length;
    const indices = Array.from({length: n}, (_, i) => i);
    
    // Calculate means
    const xMean = (n - 1) / 2; // indices are 0, 1, 2, ..., n-1
    const yMean = filtered.reduce((sum, v) => sum + v, 0) / n;
    
    // Calculate slope and intercept
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
        const xDiff = i - xMean;
        const yDiff = filtered[i] - yMean;
        numerator += xDiff * yDiff;
        denominator += xDiff * xDiff;
    }
    
    if (denominator === 0) return null;
    
    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;
    
    // Calculate R² (coefficient of determination)
    let ssTotal = 0;
    let ssResidual = 0;
    
    for (let i = 0; i < n; i++) {
        const predicted = slope * i + intercept;
        ssTotal += Math.pow(filtered[i] - yMean, 2);
        ssResidual += Math.pow(filtered[i] - predicted, 2);
    }
    
    const rSquared = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;
    
    return {
        slope: roundNumber(slope, 4),
        intercept: roundNumber(intercept, 2),
        rSquared: roundNumber(Math.max(0, Math.min(1, rSquared)), 3) // Clamp between 0 and 1
    };
}

function formatRecentSnapshotsSection(recentSnapshots) {
    if (!Array.isArray(recentSnapshots) || recentSnapshots.length === 0) return null;

    const lines = ["**RECENT SNAPSHOT LOGS**"];
    const latest = recentSnapshots[0];
    const earliest = recentSnapshots[recentSnapshots.length - 1];

    if (latest) {
        lines.push(`- Latest reading (${formatTimestampHour(latest.timestamp)}): ${formatNumber(latest.voltage, " V", 2)} @ ${formatNumber(latest.current, " A", 1)} (${latest.current > 0.5 ? "charging" : latest.current < -0.5 ? "discharging" : "idle"}), SOC ${formatPercent(latest.soc, 1)}.`);
    }

    if (earliest && earliest !== latest) {
        const deltaSoc = calculateDelta(latest?.soc, earliest?.soc);
        const deltaCapacity = calculateDelta(latest?.remainingCapacity, earliest?.remainingCapacity);
        const hoursApart = timeDifferenceHours(earliest.timestamp, latest.timestamp);
        lines.push(`- Window: ${recentSnapshots.length} entries across ~${hoursApart.toFixed(1)} hours.`);
        if (deltaSoc != null) {
            lines.push(`- SOC shift across window: ${formatSigned(deltaSoc, "%", 1)}.`);
        }
        if (deltaCapacity != null) {
            lines.push(`- Nominal capacity delta: ${formatSigned(deltaCapacity, " Ah", 2)}.`);
        }
    }

    const avgCurrent = average(recentSnapshots.map(s => s.current));
    const avgSoc = average(recentSnapshots.map(s => s.soc));
    const avgVoltage = average(recentSnapshots.map(s => s.voltage));
    if (avgVoltage != null || avgSoc != null || avgCurrent != null) {
        lines.push(`- Average readings: ${avgVoltage != null ? `${formatNumber(avgVoltage, ' V', 2)}` : 'n/a'} • ${avgCurrent != null ? `${formatNumber(avgCurrent, ' A', 2)}` : 'n/a'} • ${avgSoc != null ? `${formatPercent(avgSoc, 1)}` : 'n/a'} SOC.`);
    }

    const chargingSamples = recentSnapshots.filter(s => isFiniteNumber(s.current) && s.current > 0.5).length;
    const dischargingSamples = recentSnapshots.filter(s => isFiniteNumber(s.current) && s.current < -0.5).length;
    if (chargingSamples || dischargingSamples) {
        lines.push(`- Activity mix: ${chargingSamples} charging / ${dischargingSamples} discharging samples.`);
    }

    const alertSamples = recentSnapshots.flatMap(s => Array.isArray(s.alerts) ? s.alerts : []).filter(Boolean);
    if (alertSamples.length > 0) {
        const critical = alertSamples.filter(a => String(a).toUpperCase().startsWith('CRITICAL')).length;
        const warning = alertSamples.filter(a => String(a).toUpperCase().startsWith('WARNING')).length;
        lines.push(`- Recent alerts: ${alertSamples.length} total (${critical} critical, ${warning} warning).`);
    }

    return lines.join("\n");
}

async function loadRecentSnapshots(systemId, log) {
    try {
        const collection = await getCollection("history");
        const cursor = collection.find({ systemId }, {
            projection: {
                _id: 0,
                timestamp: 1,
                analysis: 1,
                alerts: 1
            }
        }).sort({ timestamp: -1 }).limit(RECENT_SNAPSHOT_LIMIT);

        const documents = await cursor.toArray();
        return documents.map(doc => {
            const analysis = doc.analysis || {};
            const alertsArray = Array.isArray(analysis.alerts) ? analysis.alerts : Array.isArray(doc.alerts) ? doc.alerts : [];
            return {
                timestamp: doc.timestamp,
                voltage: toNullableNumber(analysis.overallVoltage),
                current: toNullableNumber(analysis.current),
                soc: toNullableNumber(analysis.stateOfCharge),
                power: toNullableNumber(analysis.power),
                remainingCapacity: toNullableNumber(analysis.remainingCapacity),
                alerts: alertsArray
            };
        }).filter(entry => entry.timestamp);
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.warn("Failed to load recent snapshots", { systemId, error: err.message });
        return [];
    }
}

/**
 * Load 90-day daily rollup with hourly averages for comprehensive trend analysis
 * This provides Gemini with deep historical context while managing token usage
 * 
 * @param {string} systemId - System ID to query
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} Array of daily rollups, each with hourly averages
 */
async function load90DayDailyRollup(systemId, log) {
    try {
        const collection = await getCollection("history");
        const daysBack = 90;
        
        // Calculate date range
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
        
        log.info('Loading 90-day daily rollup', { systemId, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
        
        // Query database for all records in 90-day window
        const query = {
            systemId,
            timestamp: {
                $gte: startDate.toISOString(),
                $lte: endDate.toISOString()
            }
        };
        
        const records = await collection
            .find(query, {
                projection: {
                    _id: 0,
                    timestamp: 1,
                    analysis: 1,
                    alerts: 1
                }
            })
            .sort({ timestamp: 1 })
            .toArray();
        
        log.info('Records fetched for 90-day rollup', { count: records.length });
        
        if (records.length === 0) {
            return [];
        }
        
        // Group records by day
        const dailyBuckets = new Map();
        
        for (const record of records) {
            if (!record.timestamp || !record.analysis) continue;
            
            const timestamp = new Date(record.timestamp);
            const dayBucket = new Date(timestamp);
            dayBucket.setHours(0, 0, 0, 0);
            const bucketKey = dayBucket.toISOString().split('T')[0]; // YYYY-MM-DD
            
            if (!dailyBuckets.has(bucketKey)) {
                dailyBuckets.set(bucketKey, []);
            }
            dailyBuckets.get(bucketKey).push(record);
        }
        
        log.debug('Records grouped into daily buckets', { dayCount: dailyBuckets.size });
        
        // Process each day: create hourly averages within the day
        const dailyRollups = [];
        
        for (const [dayKey, dayRecords] of dailyBuckets.entries()) {
            // Group this day's records by hour
            const hourlyBuckets = new Map();
            
            for (const record of dayRecords) {
                const timestamp = new Date(record.timestamp);
                const hour = timestamp.getHours();
                const hourKey = `${dayKey}T${hour.toString().padStart(2, '0')}:00:00.000Z`;
                
                if (!hourlyBuckets.has(hourKey)) {
                    hourlyBuckets.set(hourKey, []);
                }
                hourlyBuckets.get(hourKey).push(record);
            }
            
            // Calculate hourly averages for this day
            const hourlyAverages = [];
            for (const [hourKey, hourRecords] of hourlyBuckets.entries()) {
                const hourlyMetrics = computeHourlyMetrics(hourRecords);
                hourlyAverages.push({
                    timestamp: hourKey,
                    dataPoints: hourRecords.length,
                    ...hourlyMetrics
                });
            }
            
            // Sort hourly averages by time
            hourlyAverages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            // Calculate daily summary from hourly data
            const dailySummary = computeDailySummary(hourlyAverages, dayRecords);
            
            dailyRollups.push({
                date: dayKey,
                dataPoints: dayRecords.length,
                hours: hourlyAverages.length,
                hourlyAverages,
                dailySummary
            });
        }
        
        // Sort by date ascending
        dailyRollups.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        log.info('90-day rollup complete', {
            days: dailyRollups.length,
            totalDataPoints: records.length,
            avgPointsPerDay: (records.length / dailyRollups.length).toFixed(1)
        });
        
        return dailyRollups;
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.warn("Failed to load 90-day rollup", { systemId, error: err.message });
        return [];
    }
}

/**
 * Compute metrics for an hour's worth of records
 */
function computeHourlyMetrics(records) {
    const metrics = {
        voltage: [],
        current: [],
        power: [],
        soc: [],
        capacity: [],
        temperature: [],
        alertCount: 0
    };
    
    for (const record of records) {
        const a = record.analysis;
        if (!a) continue;
        
        if (isFiniteNumber(a.overallVoltage)) metrics.voltage.push(a.overallVoltage);
        if (isFiniteNumber(a.current)) metrics.current.push(a.current);
        if (isFiniteNumber(a.power)) metrics.power.push(a.power);
        if (isFiniteNumber(a.stateOfCharge)) metrics.soc.push(a.stateOfCharge);
        if (isFiniteNumber(a.remainingCapacity)) metrics.capacity.push(a.remainingCapacity);
        
        if (Array.isArray(a.temperatures) && a.temperatures.length > 0) {
            const avgTemp = a.temperatures.reduce((sum, t) => sum + t, 0) / a.temperatures.length;
            if (isFiniteNumber(avgTemp)) metrics.temperature.push(avgTemp);
        }
        
        if (Array.isArray(a.alerts) || Array.isArray(record.alerts)) {
            const alerts = a.alerts || record.alerts;
            metrics.alertCount += alerts.filter(Boolean).length;
        }
    }
    
    return {
        voltage: average(metrics.voltage),
        current: average(metrics.current),
        power: average(metrics.power),
        soc: average(metrics.soc),
        capacity: average(metrics.capacity),
        temperature: average(metrics.temperature),
        alertCount: metrics.alertCount,
        // Add statistical measures for better insights
        voltageStdDev: standardDeviation(metrics.voltage),
        currentStdDev: standardDeviation(metrics.current),
        socStdDev: standardDeviation(metrics.soc)
    };
}

/**
 * Calculate standard deviation for a set of values
 */
function standardDeviation(values) {
    const filtered = values.filter(v => isFiniteNumber(v));
    if (filtered.length < 2) return null;
    
    const avg = filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
    const squaredDiffs = filtered.map(v => Math.pow(v - avg, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / filtered.length;
    return Math.sqrt(variance);
}

/**
 * Compute daily summary from hourly averages
 */
function computeDailySummary(hourlyAverages, dayRecords) {
    const allVoltage = hourlyAverages.map(h => h.voltage).filter(isFiniteNumber);
    const allCurrent = hourlyAverages.map(h => h.current).filter(isFiniteNumber);
    const allPower = hourlyAverages.map(h => h.power).filter(isFiniteNumber);
    const allSoc = hourlyAverages.map(h => h.soc).filter(isFiniteNumber);
    const allCapacity = hourlyAverages.map(h => h.capacity).filter(isFiniteNumber);
    const allTemp = hourlyAverages.map(h => h.temperature).filter(isFiniteNumber);
    
    return {
        avgVoltage: average(allVoltage),
        avgCurrent: average(allCurrent),
        avgPower: average(allPower),
        avgSoc: average(allSoc),
        avgCapacity: average(allCapacity),
        avgTemperature: average(allTemp),
        minSoc: allSoc.length > 0 ? Math.min(...allSoc) : null,
        maxSoc: allSoc.length > 0 ? Math.max(...allSoc) : null,
        totalAlerts: hourlyAverages.reduce((sum, h) => sum + (h.alertCount || 0), 0),
        coverage: (hourlyAverages.length / 24 * 100).toFixed(1) + '%' // % of day covered
    };
}

function buildBatteryFacts({ analysisData = {}, systemProfile = null }) {
    const ratedCapacityAh = toNullableNumber(
        systemProfile?.capacityAh ??
        analysisData.fullCapacity ??
        analysisData.nominalCapacity ??
        analysisData.capacityAh ??
        analysisData.capacity ??
        null
    );

    const cycleCount = toNullableNumber(analysisData.cycleCount);
    const chemistry = analysisData.chemistry || systemProfile?.chemistry || null;
    const referenceVoltage = toNullableNumber(systemProfile?.voltage ?? analysisData.overallVoltage);
    const cellsInSeries = toNullableNumber(analysisData.seriesCells ?? analysisData.seriesCount ?? analysisData.cellCount);

    const brandNewLikely = cycleCount != null && cycleCount <= 50;

    return {
        ratedCapacityAh,
        cycleCount,
        chemistry,
        referenceVoltage,
        cellsInSeries,
        brandNewLikely,
        lastMeasurementTimestamp: analysisData.timestamp ?? null
    };
}

function analyzeNightDischargePatterns({ snapshots = [], analysisData = {}, systemProfile = null }) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
        return null;
    }

    const orderedSnapshots = [...snapshots].sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return aTime - bTime;
    });

    const dischargeSequences = extractSequences(orderedSnapshots, snap => isFiniteNumber(snap.current) && snap.current < -0.5);
    if (dischargeSequences.length === 0) {
        return { segments: [], nightSegments: [], aggregate: null };
    }

    const nominalVoltage = toNullableNumber(systemProfile?.voltage ?? analysisData.overallVoltage);

    const segments = dischargeSequences.map(sequence =>
        computeSequenceStats(sequence, { nominalVoltage, treatAsDischarge: true })
    ).filter(Boolean);

    if (segments.length === 0) {
        return { segments: [], nightSegments: [], aggregate: null };
    }

    const nightSegments = segments.filter(segment => segment.isLikelyNight);
    const targetSegments = nightSegments.length > 0 ? nightSegments : segments;

    const totalAh = targetSegments.reduce((sum, segment) => sum + (segment.totalAh || 0), 0);
    const totalHours = targetSegments.reduce((sum, segment) => sum + (segment.durationHours || 0), 0);
    const avgCurrent = totalHours > 0 ? totalAh / totalHours : 0;
    const avgWatts = nominalVoltage != null ? avgCurrent * nominalVoltage : null;

    return {
        segments,
        nightSegments,
        aggregate: {
            totalAh: roundNumber(totalAh, 2),
            totalHours: roundNumber(totalHours, 2),
            avgCurrent: roundNumber(avgCurrent, 2),
            avgWatts: avgWatts != null ? roundNumber(avgWatts, 1) : null,
            sampleCount: targetSegments.reduce((sum, segment) => sum + (segment.sampleCount || 0), 0),
            isNightDominant: nightSegments.length > 0
        }
    };
}

function estimateSolarVariance({ snapshots = [], analysisData = {}, systemProfile = null, weather = null, nightDischarge = null }) {
    const orderedSnapshots = Array.isArray(snapshots)
        ? [...snapshots].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        : [];

    const nominalVoltage = toNullableNumber(systemProfile?.voltage ?? analysisData.overallVoltage);
    const chargeSequences = extractSequences(orderedSnapshots, snap => isFiniteNumber(snap.current) && snap.current > 0.5);
    const chargeSegments = chargeSequences.map(sequence =>
        computeSequenceStats(sequence, { nominalVoltage, treatAsDischarge: false })
    ).filter(Boolean);

    const actualSolarAh = chargeSegments.reduce((sum, segment) => sum + Math.max(0, segment.totalAh || 0), 0);
    const actualSolarWh = nominalVoltage != null ? actualSolarAh * nominalVoltage : null;

    const cloudCover = weather && isFiniteNumber(weather.clouds) ? weather.clouds : null;
    const baselineSunHours = inferSunHours(cloudCover);

    const maxSolarAmps = toNullableNumber(systemProfile?.solar?.maxAmps);
    const fallbackAmps = toNullableNumber(analysisData.maxChargeCurrent ?? analysisData.chargeCurrent ?? null);
    const representativeAmps = maxSolarAmps ?? fallbackAmps;

    const averageChargeDuration = chargeSegments.reduce((sum, segment) => sum + (segment.durationHours || 0), 0);
    const inferredAmpsFromData = averageChargeDuration > 0 ? actualSolarAh / averageChargeDuration : null;

    const expectedChargingAmps = representativeAmps ?? inferredAmpsFromData ?? null;
    const expectedSolarAh = expectedChargingAmps != null ? expectedChargingAmps * baselineSunHours : null;
    const expectedSolarWh = expectedSolarAh != null && nominalVoltage != null ? expectedSolarAh * nominalVoltage : null;

    const anticipatedConsumptionAh = nightDischarge?.aggregate?.totalAh ?? null;
    const balanceAh = anticipatedConsumptionAh != null ? actualSolarAh - anticipatedConsumptionAh : null;
    const expectedBalanceAh = anticipatedConsumptionAh != null && expectedSolarAh != null
        ? expectedSolarAh - anticipatedConsumptionAh
        : null;

    // NEW: Calculate variance with tolerance for sporadic data
    // Sporadic screenshots mean we're estimating from incomplete data
    // Apply ±15% tolerance band before flagging variance
    const rawVarianceAh = expectedSolarAh != null ? actualSolarAh - expectedSolarAh : null;
    const toleranceAh = expectedSolarAh != null ? expectedSolarAh * 0.15 : 0; // 15% tolerance
    const significantVarianceAh = rawVarianceAh != null && Math.abs(rawVarianceAh) > toleranceAh ? rawVarianceAh : null;

    // NEW: Calculate daytime load consumption
    // The key insight: delta between expected and actual often represents loads running during solar charging
    // Example: 220Ah expected, 58Ah recovered = 162Ah consumed by loads during day
    const daytimeLoadAh = expectedSolarAh != null && actualSolarAh != null
        ? expectedSolarAh - actualSolarAh
        : null;
    const daytimeLoadWh = daytimeLoadAh != null && nominalVoltage != null
        ? daytimeLoadAh * nominalVoltage
        : null;

    // Weather-aware recommendation logic
    let recommendation = null;
    const favorableWeather = cloudCover != null && cloudCover < 30; // <30% clouds = favorable

    if (significantVarianceAh != null) {
        if (significantVarianceAh < -5) {
            // Negative variance = actual < expected
            if (favorableWeather) {
                recommendation = `Solar charging below expectations by ${formatNumber(Math.abs(significantVarianceAh), ' Ah', 1)} despite favorable weather (${formatNumber(cloudCover, '% clouds', 0)}). Verify panel output, shading, or connections.`;
            } else {
                recommendation = `Charging deficit of ${formatNumber(Math.abs(significantVarianceAh), ' Ah', 1)} likely due to weather (${formatNumber(cloudCover, '% clouds', 0)}). This may represent normal daytime load consumption of ${formatNumber(Math.abs(daytimeLoadAh || 0), ' Ah', 1)}${daytimeLoadWh != null ? ` (${formatNumber(daytimeLoadWh / 1000, ' kWh', 1)})` : ''} during charging hours.`;
            }
        } else if (significantVarianceAh > 5) {
            recommendation = `Solar charging exceeded modeled expectations by ${formatNumber(significantVarianceAh, ' Ah', 1)}. Review discharge assumptions or recalibrate baseline capacity.`;
        }
    } else if (rawVarianceAh != null) {
        if (daytimeLoadAh != null && daytimeLoadAh > 5) {
            recommendation = `Solar variance within ±15% tolerance. Estimated daytime load consumption: ${formatNumber(daytimeLoadAh, ' Ah', 1)}${daytimeLoadWh != null ? ` (${formatNumber(daytimeLoadWh / 1000, ' kWh', 1)})` : ''} during charging hours.`;
        } else {
            recommendation = `Solar variance within ±15% tolerance (±${formatNumber(toleranceAh, ' Ah', 1)}). System operating as expected given sporadic screenshot data.`;
        }
    }

    return {
        segments: chargeSegments,
        cloudCover,
        sunHours: baselineSunHours,
        expectedSolarAh: expectedSolarAh != null ? roundNumber(expectedSolarAh, 2) : null,
        expectedSolarWh: expectedSolarWh != null ? Math.round(expectedSolarWh) : null,
        actualSolarAh: roundNumber(actualSolarAh, 2),
        actualSolarWh: actualSolarWh != null ? Math.round(actualSolarWh) : null,
        daytimeLoadAh: daytimeLoadAh != null ? roundNumber(daytimeLoadAh, 2) : null,
        daytimeLoadWh: daytimeLoadWh != null ? Math.round(daytimeLoadWh) : null,
        anticipatedNightConsumptionAh: anticipatedConsumptionAh != null ? roundNumber(anticipatedConsumptionAh, 2) : null,
        balanceAh: balanceAh != null ? roundNumber(balanceAh, 2) : null,
        expectedBalanceAh: expectedBalanceAh != null ? roundNumber(expectedBalanceAh, 2) : null,
        varianceAh: significantVarianceAh != null ? roundNumber(significantVarianceAh, 2) : null,
        rawVarianceAh: rawVarianceAh != null ? roundNumber(rawVarianceAh, 2) : null,
        toleranceAh: roundNumber(toleranceAh, 2),
        withinTolerance: significantVarianceAh === null && rawVarianceAh != null,
        favorableWeather,
        recommendation
    };
}

function extractSequences(snapshots, predicate) {
    const sequences = [];
    let current = [];

    for (const snapshot of snapshots) {
        if (predicate(snapshot)) {
            current.push(snapshot);
        } else if (current.length > 0) {
            sequences.push(current);
            current = [];
        }
    }

    if (current.length > 0) {
        sequences.push(current);
    }

    return sequences;
}

function computeSequenceStats(sequence, { nominalVoltage = null, treatAsDischarge = false } = {}) {
    if (!sequence || sequence.length === 0) {
        return null;
    }

    const durations = [];
    for (let i = 0; i < sequence.length - 1; i++) {
        const currentTs = new Date(sequence[i].timestamp).getTime();
        const nextTs = new Date(sequence[i + 1].timestamp).getTime();
        if (Number.isNaN(currentTs) || Number.isNaN(nextTs) || nextTs <= currentTs) {
            continue;
        }
        const hours = (nextTs - currentTs) / (1000 * 60 * 60);
        if (hours <= 0) continue;
        durations.push(Math.min(hours, 6));
    }

    let durationHours = durations.reduce((sum, value) => sum + value, 0);
    if (durationHours <= 0) {
        durationHours = Math.max(0.25, sequence.length * 0.25);
    }

    const currents = sequence
        .map(entry => toNullableNumber(entry.current))
        .filter(current => current != null);

    if (currents.length === 0) {
        return null;
    }

    const avgRaw = currents.reduce((sum, value) => sum + value, 0) / currents.length;
    const avgCurrent = treatAsDischarge ? Math.abs(avgRaw) : avgRaw;
    const peakCurrent = currents.reduce((peak, value) => {
        const candidate = treatAsDischarge ? Math.abs(value) : value;
        return Math.max(peak, candidate);
    }, 0);

    const totalAh = avgCurrent * durationHours;
    const avgWatts = nominalVoltage != null ? avgCurrent * nominalVoltage : null;

    const nightSamples = sequence.filter(entry => isNightHour(entry.timestamp)).length;
    const isLikelyNight = nightSamples >= Math.ceil(sequence.length * 0.5);

    return {
        start: sequence[0].timestamp,
        end: sequence[sequence.length - 1].timestamp,
        durationHours: roundNumber(durationHours, 2),
        avgCurrent: roundNumber(avgCurrent, 2),
        peakCurrent: roundNumber(peakCurrent, 2),
        totalAh: roundNumber(totalAh, 2),
        avgWatts: avgWatts != null ? roundNumber(avgWatts, 1) : null,
        isLikelyNight,
        sampleCount: sequence.length
    };
}

function isNightHour(timestamp) {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return false;
    const hour = date.getHours();
    return hour >= 18 || hour < 6;
}

function inferSunHours(cloudCover) {
    const base = 5;
    if (!isFiniteNumber(cloudCover)) {
        return base;
    }
    const penalty = (cloudCover / 100) * 3; // up to -3 hours at 100% clouds
    return clamp(base - penalty, 2, 6);
}

function roundNumber(value, digits = 2) {
    if (!isFiniteNumber(value)) return null;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
    if (!isFiniteNumber(value)) return value;
    return Math.max(min, Math.min(max, value));
}

function calculateDelta(latest, earliest) {
    const latestNumber = toNullableNumber(latest);
    const earliestNumber = toNullableNumber(earliest);
    if (latestNumber == null || earliestNumber == null) return null;
    return Number((latestNumber - earliestNumber).toFixed(3));
}

function formatSigned(value, unit = "", digits = 1) {
    if (!isFiniteNumber(value)) return "n/a";
    const prefix = value > 0 ? "+" : value < 0 ? "-" : "±";
    return `${prefix}${Math.abs(Number(value)).toFixed(digits)}${unit}`;
}

function timeDifferenceHours(start, end) {
    if (!start || !end) return 0;
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) return 0;
    return (endTime - startTime) / (1000 * 60 * 60);
}

function buildToolCatalog() {
    return toolDefinitions.map(tool => {
        const paramKeys = Object.keys(tool.parameters?.properties || {});
        const params = paramKeys.length > 0 ? ` (params: ${paramKeys.join(", ")})` : "";
        return `- ${tool.name}: ${truncate(tool.description, 160)}${params}`;
    }).join("\n");
}

function normalizeToolResult(result) {
    if (!result) return null;
    if (result.error && !result.insufficient_data) {
        return {
            error: true,
            message: result.message || "Tool execution failed"
        };
    }
    return result;
}

function summarizeContextForClient(context, analysisData) {
    if (!context) return null;
    const recentSnapshots = Array.isArray(context.recentSnapshots) ? context.recentSnapshots : [];
    const latestSnapshot = recentSnapshots[0] || null;
    const earliestSnapshot = recentSnapshots.length > 1 ? recentSnapshots[recentSnapshots.length - 1] : null;

    return {
        snapshot: analysisData ? {
            voltage: toNullableNumber(analysisData.overallVoltage),
            current: toNullableNumber(analysisData.current),
            soc: toNullableNumber(analysisData.stateOfCharge),
            temperature: toNullableNumber(analysisData.temperature),
            cellVoltageDifferenceMv: toNullableNumber(isFiniteNumber(analysisData.cellVoltageDifference) ? analysisData.cellVoltageDifference * 1000 : null),
            alerts: Array.isArray(analysisData.alerts) ? analysisData.alerts.slice(0, 5) : []
        } : null,
        systemProfile: context.systemProfile || null,
        batteryFacts: context.batteryFacts ? {
            ratedCapacityAh: toNullableNumber(context.batteryFacts.ratedCapacityAh),
            cycleCount: toNullableNumber(context.batteryFacts.cycleCount),
            brandNewLikely: !!context.batteryFacts.brandNewLikely,
            referenceVoltage: toNullableNumber(context.batteryFacts.referenceVoltage)
        } : null,
        energyBudget: context.energyBudgets?.current && !context.energyBudgets.current.error ? {
            solarSufficiency: context.energyBudgets.current.solarSufficiency?.percentage ?? null,
            autonomyDays: context.energyBudgets.current.batteryMetrics?.daysOfAutonomy ?? null,
            netDailyWh: context.energyBudgets.current.energyFlow?.netDaily ?? null
        } : null,
        worstCase: context.energyBudgets?.worstCase && !context.energyBudgets.worstCase.error ? {
            deficitWh: context.energyBudgets.worstCase.worstCaseMetrics?.dailyDeficit ?? null,
            autonomyDays: context.energyBudgets.worstCase.batteryAutonomy?.daysWithoutSolar ?? null
        } : null,
        predictions: {
            capacity: context.predictions?.capacity && !context.predictions.capacity.error ? {
                degradationAhPerDay: context.predictions.capacity.degradationRate?.value ?? null,
                daysToThreshold: context.predictions.capacity.daysToReplacementThreshold ?? null
            } : null,
            lifetimeMonths: context.predictions?.lifetime && !context.predictions.lifetime.error ? context.predictions.lifetime.estimatedRemainingLife?.months ?? null : null
        },
        anomalies: context.usagePatterns?.anomalies && !context.usagePatterns.anomalies.error ? {
            total: context.usagePatterns.anomalies.summary?.total ?? null,
            highSeverity: context.usagePatterns.anomalies.summary?.highSeverity ?? null
        } : null,
        nightDischarge: context.nightDischarge?.aggregate ? {
            avgCurrent: toNullableNumber(context.nightDischarge.aggregate.avgCurrent),
            totalAh: toNullableNumber(context.nightDischarge.aggregate.totalAh),
            totalHours: toNullableNumber(context.nightDischarge.aggregate.totalHours),
            isNightDominant: !!context.nightDischarge.aggregate.isNightDominant
        } : null,
        solarVariance: context.solarVariance ? {
            expectedSolarAh: toNullableNumber(context.solarVariance.expectedSolarAh),
            actualSolarAh: toNullableNumber(context.solarVariance.actualSolarAh),
            varianceAh: toNullableNumber(context.solarVariance.varianceAh),
            daytimeLoadAh: toNullableNumber(context.solarVariance.daytimeLoadAh),
            daytimeLoadWh: toNullableNumber(context.solarVariance.daytimeLoadWh),
            sunHours: toNullableNumber(context.solarVariance.sunHours),
            favorableWeather: context.solarVariance.favorableWeather ?? null
        } : null,
        weather: context.weather && !context.weather.error ? {
            temp: context.weather.temp ?? null,
            clouds: context.weather.clouds ?? null,
            uvi: context.weather.uvi ?? null
        } : null,
        recentSnapshots: recentSnapshots.length > 0 ? {
            count: recentSnapshots.length,
            latestTimestamp: latestSnapshot?.timestamp ?? null,
            latestSoc: toNullableNumber(latestSnapshot?.soc),
            latestVoltage: toNullableNumber(latestSnapshot?.voltage),
            netAhDelta: calculateDelta(latestSnapshot?.remainingCapacity, earliestSnapshot?.remainingCapacity),
            netSocDelta: calculateDelta(latestSnapshot?.soc, earliestSnapshot?.soc),
            alertCount: recentSnapshots.reduce((acc, snap) => acc + (Array.isArray(snap.alerts) ? snap.alerts.length : 0), 0)
        } : null,
        meta: {
            contextBuildMs: context.meta?.durationMs ?? null,
            truncated: !!context.meta?.truncated
        }
    };
}

function average(values) {
    const filtered = values.filter(v => isFiniteNumber(v));
    if (filtered.length === 0) return null;
    return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

function findPeak(hourlyAverages, metricKey, valueKey, mode = "max") {
    let candidate = null;
    for (const hour of hourlyAverages) {
        const metrics = hour.metrics?.[metricKey];
        if (!metrics) continue;
        const value = metrics[valueKey];
        if (!isFiniteNumber(value)) continue;
        if (!candidate) {
            candidate = { hour: hour.hour, value };
            continue;
        }
        if (mode === "min") {
            if (value < candidate.value) candidate = { hour: hour.hour, value };
        } else if (value > candidate.value) {
            candidate = { hour: hour.hour, value };
        }
    }
    return candidate;
}

function formatNumber(value, unit = "", digits = 1) {
    if (!isFiniteNumber(value)) return "n/a";
    return `${Number(value).toFixed(digits)}${unit}`;
}

function formatPercent(value, digits = 0) {
    if (!isFiniteNumber(value)) return "n/a";
    return `${Number(value).toFixed(digits)}%`;
}

/**
 * Build a summary of what data is available for Gemini to query
 */
async function buildDataAvailabilitySummary(systemId, contextData, log) {
    if (!systemId) {
        return "**DATA AVAILABILITY**\n- System: No system ID provided - limited data available\n- You can only analyze the current snapshot provided";
    }

    const lines = ["**DATA AVAILABILITY - What You Can Query**"];
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    // Get date range from recent snapshots or dailyRollup
    let minDate = null;
    let maxDate = null;
    let totalRecords = 0;
    
    if (contextData?.recentSnapshots && contextData.recentSnapshots.length > 0) {
        const timestamps = contextData.recentSnapshots
            .map(s => s.timestamp)
            .filter(t => t)
            .sort();
        
        if (timestamps.length > 0) {
            minDate = timestamps[0];
            maxDate = timestamps[timestamps.length - 1];
            totalRecords = timestamps.length;
        }
    }
    
    if (contextData?.dailyRollup90d?.daily && contextData.dailyRollup90d.daily.length > 0) {
        const dailyTimestamps = contextData.dailyRollup90d.daily
            .map(d => d.date)
            .filter(t => t)
            .sort();
        
        if (dailyTimestamps.length > 0 && (!minDate || dailyTimestamps[0] < minDate)) {
            minDate = dailyTimestamps[0];
        }
        if (dailyTimestamps.length > 0 && (!maxDate || dailyTimestamps[dailyTimestamps.length - 1] > maxDate)) {
            maxDate = dailyTimestamps[dailyTimestamps.length - 1];
        }
    }
    
    // System info
    if (contextData?.systemProfile) {
        const profile = contextData.systemProfile;
        lines.push(`\n📋 SYSTEM: ${profile.name || systemId}`);
        if (profile.chemistry) lines.push(`   Chemistry: ${profile.chemistry}`);
        if (profile.nominalVoltage) lines.push(`   Voltage: ${profile.nominalVoltage}V`);
        if (profile.capacity) lines.push(`   Capacity: ${profile.capacity}Ah`);
    } else {
        lines.push(`\n📋 SYSTEM: ${systemId}`);
    }
    
    // Date range
    if (minDate && maxDate) {
        const minDateStr = new Date(minDate).toISOString().split('T')[0];
        const maxDateStr = new Date(maxDate).toISOString().split('T')[0];
        const daysDiff = Math.floor((new Date(maxDate) - new Date(minDate)) / (1000 * 60 * 60 * 24));
        
        lines.push(`\n📅 DATA RANGE: ${minDateStr} to ${maxDateStr} (${daysDiff} days)`);
        lines.push(`   Total Records: ${totalRecords} BMS snapshots`);
        lines.push(`   Use these dates when calling request_bms_data tool`);
    } else {
        lines.push(`\n📅 DATA RANGE: Current snapshot only`);
        lines.push(`   No historical data available for this system`);
    }
    
    // Available metrics
    lines.push(`\n🔍 QUERYABLE METRICS (via request_bms_data):`);
    lines.push(`   • voltage - Battery pack voltage over time`);
    lines.push(`   • current - Charge/discharge current (+ charging, - discharging)`);
    lines.push(`   • power - Instantaneous power (watts)`);
    lines.push(`   • soc - State of charge (0-100%)`);
    lines.push(`   • capacity - Remaining capacity (Ah)`);
    lines.push(`   • temperature - Battery temperature`);
    lines.push(`   • cell_voltage_difference - Cell imbalance (mV)`);
    lines.push(`   • all - All metrics (use sparingly - large dataset)`);
    
    // Available tools
    lines.push(`\n🛠️ ANALYSIS TOOLS AVAILABLE:`);
    lines.push(`   • getSystemAnalytics - Comprehensive stats, trends, degradation`);
    lines.push(`   • analyze_usage_patterns - Daily patterns, anomalies`);
    lines.push(`   • calculate_energy_budget - Solar contribution, autonomy days`);
    lines.push(`   • predict_battery_trends - Capacity forecasts, lifetime estimates`);
    lines.push(`   • getWeatherData - Historical weather correlation`);
    
    // Data that's already pre-loaded
    if (contextData?.analytics && !contextData.analytics.error) {
        lines.push(`\n✓ PRE-LOADED: System analytics (no need to request)`);
    }
    if (contextData?.energyBudgets?.current && !contextData.energyBudgets.current.error) {
        lines.push(`✓ PRE-LOADED: Energy budget analysis`);
    }
    if (contextData?.predictions?.capacity && !contextData.predictions.capacity.error) {
        lines.push(`✓ PRE-LOADED: Capacity predictions`);
    }
    if (contextData?.predictions?.lifetime && !contextData.predictions.lifetime.error) {
        lines.push(`✓ PRE-LOADED: Lifetime predictions`);
    }
    if (contextData?.usagePatterns?.daily && !contextData.usagePatterns.daily.error) {
        lines.push(`✓ PRE-LOADED: Daily usage patterns`);
    }
    if (contextData?.dailyRollup90d?.daily && contextData.dailyRollup90d.daily.length > 0) {
        lines.push(`✓ PRE-LOADED: 90-day daily rollup (${contextData.dailyRollup90d.daily.length} days)`);
    }
    
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    return lines.join("\n");
}

function truncate(text, maxLength) {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
}

function formatTimestampHour(timestamp) {
    if (!timestamp) return "unknown";
    try {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return "unknown";
        return date.toISOString().replace(/T/, " ").replace(/:00\.000Z$/, "Z");
    } catch (_) {
        return "unknown";
    }
}

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function toNullableNumber(value) {
    return isFiniteNumber(value) ? Number(value) : null;
}

/**
 * Calculate comparative periods for week-over-week and month-over-month analysis
 * This enables the AI to provide relative performance insights
 */
function calculateComparativePeriods(dailyRollup, log) {
    if (!Array.isArray(dailyRollup) || dailyRollup.length < 14) {
        log.debug('Insufficient data for comparative periods', { days: dailyRollup?.length });
        return null;
    }
    
    try {
        // Get most recent data points
        const allDays = dailyRollup.map(d => d.dailySummary).filter(Boolean);
        
        // Last 7 days
        const last7Days = allDays.slice(-7);
        // Previous 7 days (8-14 days ago)
        const previous7Days = allDays.slice(-14, -7);
        
        // Last 30 days
        const last30Days = allDays.slice(-30);
        // Previous 30 days (31-60 days ago)
        const previous30Days = allDays.slice(-60, -30);
        
        const comparisons = {};
        
        // Week-over-week comparison
        if (last7Days.length >= 7 && previous7Days.length >= 7) {
            comparisons.weekOverWeek = calculatePeriodComparison(
                previous7Days,
                last7Days,
                'Week-over-Week'
            );
        }
        
        // Month-over-month comparison
        if (last30Days.length >= 28 && previous30Days.length >= 28) {
            comparisons.monthOverMonth = calculatePeriodComparison(
                previous30Days,
                last30Days,
                'Month-over-Month'
            );
        }
        
        return comparisons;
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.warn('Failed to calculate comparative periods', { error: err.message });
        return null;
    }
}

/**
 * Compare two periods and return delta statistics
 */
function calculatePeriodComparison(previousPeriod, currentPeriod, label) {
    const metrics = {
        soc: { previous: [], current: [] },
        voltage: { previous: [], current: [] },
        current: { previous: [], current: [] },
        alerts: { previous: 0, current: 0 }
    };
    
    // Extract metrics from previous period
    for (const day of previousPeriod) {
        if (isFiniteNumber(day.avgSoc)) metrics.soc.previous.push(day.avgSoc);
        if (isFiniteNumber(day.avgVoltage)) metrics.voltage.previous.push(day.avgVoltage);
        if (isFiniteNumber(day.avgCurrent)) metrics.current.previous.push(day.avgCurrent);
        metrics.alerts.previous += day.totalAlerts || 0;
    }
    
    // Extract metrics from current period
    for (const day of currentPeriod) {
        if (isFiniteNumber(day.avgSoc)) metrics.soc.current.push(day.avgSoc);
        if (isFiniteNumber(day.avgVoltage)) metrics.voltage.current.push(day.avgVoltage);
        if (isFiniteNumber(day.avgCurrent)) metrics.current.current.push(day.avgCurrent);
        metrics.alerts.current += day.totalAlerts || 0;
    }
    
    // Calculate averages and deltas
    const result = {
        label,
        periodDays: currentPeriod.length,
        soc: calculateMetricDelta(metrics.soc.previous, metrics.soc.current, '%'),
        voltage: calculateMetricDelta(metrics.voltage.previous, metrics.voltage.current, 'V'),
        current: calculateMetricDelta(metrics.current.previous, metrics.current.current, 'A'),
        alerts: {
            previous: metrics.alerts.previous,
            current: metrics.alerts.current,
            delta: metrics.alerts.current - metrics.alerts.previous,
            percentChange: metrics.alerts.previous > 0 
                ? ((metrics.alerts.current - metrics.alerts.previous) / metrics.alerts.previous) * 100
                : null
        }
    };
    
    return result;
}

/**
 * Calculate metric delta with percent change
 */
function calculateMetricDelta(previousValues, currentValues, unit) {
    const prevAvg = average(previousValues);
    const currAvg = average(currentValues);
    
    if (prevAvg === null || currAvg === null) {
        return null;
    }
    
    const delta = currAvg - prevAvg;
    const percentChange = prevAvg !== 0 ? (delta / prevAvg) * 100 : null;
    
    return {
        previous: roundNumber(prevAvg, 2),
        current: roundNumber(currAvg, 2),
        delta: roundNumber(delta, 2),
        percentChange: percentChange !== null ? roundNumber(percentChange, 1) : null,
        unit,
        improving: delta > 0 && unit === '%' || delta < 0 && unit === 'A', // Higher SOC/voltage is better, lower current draw is better
        significant: percentChange !== null ? Math.abs(percentChange) > 5 : false // >5% change is significant
    };
}

/**
 * Format comparative periods section for AI context
 */
function formatComparativePeriodsSection(comparativePeriods) {
    if (!comparativePeriods) return null;
    
    const lines = ["**COMPARATIVE PERIOD ANALYSIS**"];
    
    const formatComparison = (comparison) => {
        if (!comparison) return [];
        
        const compLines = [`\n- **${comparison.label}** (${comparison.periodDays} days each):`];
        
        // SOC comparison
        if (comparison.soc) {
            const c = comparison.soc;
            const arrow = c.improving ? '📈' : c.delta < 0 ? '📉' : '➡️';
            const significance = c.significant ? ' (SIGNIFICANT)' : '';
            compLines.push(`  - SOC: ${formatNumber(c.previous, c.unit, 1)} → ${formatNumber(c.current, c.unit, 1)} ${arrow} ${formatSigned(c.delta, c.unit, 1)} (${formatSigned(c.percentChange, '%', 1)} change${significance})`);
        }
        
        // Voltage comparison
        if (comparison.voltage) {
            const c = comparison.voltage;
            const arrow = c.improving ? '📈' : c.delta < 0 ? '📉' : '➡️';
            const significance = c.significant ? ' (SIGNIFICANT)' : '';
            compLines.push(`  - Voltage: ${formatNumber(c.previous, c.unit, 2)} → ${formatNumber(c.current, c.unit, 2)} ${arrow} ${formatSigned(c.delta, c.unit, 2)} (${formatSigned(c.percentChange, '%', 1)} change${significance})`);
        }
        
        // Current comparison
        if (comparison.current) {
            const c = comparison.current;
            const arrow = c.improving ? '✅' : c.delta > 0 ? '⚠️' : '➡️';
            const significance = c.significant ? ' (SIGNIFICANT)' : '';
            compLines.push(`  - Avg Current: ${formatNumber(c.previous, c.unit, 1)} → ${formatNumber(c.current, c.unit, 1)} ${arrow} ${formatSigned(c.delta, c.unit, 1)} (${formatSigned(c.percentChange, '%', 1)} change${significance})`);
        }
        
        // Alert comparison
        if (comparison.alerts) {
            const a = comparison.alerts;
            const arrow = a.delta < 0 ? '✅ Improving' : a.delta > 0 ? '⚠️ Worsening' : '➡️ Stable';
            const significance = Math.abs(a.delta) > 5 ? ' (SIGNIFICANT)' : '';
            compLines.push(`  - Alerts: ${a.previous} → ${a.current} ${arrow} ${formatSigned(a.delta, '', 0)} (${formatSigned(a.percentChange, '%', 0)} change${significance})`);
        }
        
        return compLines;
    };
    
    if (comparativePeriods.weekOverWeek) {
        lines.push(...formatComparison(comparativePeriods.weekOverWeek));
    }
    
    if (comparativePeriods.monthOverMonth) {
        lines.push(...formatComparison(comparativePeriods.monthOverMonth));
    }
    
    lines.push("\n- **Analysis Notes:**");
    lines.push("  - Changes >5% are flagged as SIGNIFICANT");
    lines.push("  - For SOC/Voltage: higher is better (📈 improving)");
    lines.push("  - For Current: lower absolute value suggests less load or better charging (✅ improving)");
    lines.push("  - Use these comparisons to identify emerging trends and validate observations");
    
    return lines.join("\n");
}

module.exports = {
    collectAutoInsightsContext,
    buildGuruPrompt,
    summarizeContextForClient
};
