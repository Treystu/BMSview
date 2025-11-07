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
const SYNC_CONTEXT_BUDGET_MS = 22000;
const ASYNC_CONTEXT_BUDGET_MS = 45000;

/**
 * Fetch detailed context prior to prompting Gemini.
 * @param {string|undefined} systemId
 * @param {object} analysisData
 * @param {ReturnType<typeof require('./logger.cjs').createLogger>} log
 * @param {{ maxMs?: number }} options
 */
async function collectAutoInsightsContext(systemId, analysisData, log, options = {}) {
    const start = Date.now();
    const maxMs = options.maxMs || (options.mode === "background" ? ASYNC_CONTEXT_BUDGET_MS : SYNC_CONTEXT_BUDGET_MS);

    const context = {
        systemProfile: null,
        initialSummary: null,
        analytics: null,
        usagePatterns: {},
        energyBudgets: {},
        predictions: {},
        weather: null,
        meta: {
            steps: [],
            durationMs: 0,
            maxMs,
            truncated: false
        }
    };

    const shouldStop = () => Date.now() - start >= maxMs;

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

    context.initialSummary = await runStep("initialSummary", () => generateInitialSummary(analysisData || {}, systemId, log));

    if (systemId) {
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

        if (context.systemProfile && context.systemProfile.location) {
            const { latitude, longitude } = context.systemProfile.location;
            if (isFiniteNumber(latitude) && isFiniteNumber(longitude)) {
                context.weather = await runStep("weather.current", async () => {
                    const result = await executeToolCall("getWeatherData", { latitude, longitude, type: "current" }, log);
                    return normalizeToolResult(result);
                });
            }
        }
    }

    context.meta.durationMs = Date.now() - start;
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

    let prompt = "You are the Ultimate AI Battery Guru for off-grid energy systems. You ingest structured context, request targeted data through function calls, and deliver deeply analytical recommendations grounded in the evidence provided.\n";
    prompt += "Your goals: preserve battery health, guarantee energy sufficiency, and surface proactive maintenance or expansion actions.\n";

    prompt += `\n${executionGuidance}\n`;
    prompt += `\n**AVAILABLE TOOLS**\n${toolCatalog}\n`;

    if (sections.length > 0) {
        prompt += `\n${sections.join("\n\n")}\n`;
    }

    prompt += `\n${missionStatement}\n`;

    prompt += "\n**CRITICAL RESPONSE RULES**\n";
    prompt += "1. If you can answer with the provided context, respond with JSON: {\n   \"final_answer\": \"detailed analysis...\"\n}.\n";
    prompt += "2. If you need more information, respond ONLY with JSON describing a tool call: {\n   \"tool_call\": \"tool_name\",\n   \"parameters\": { ... }\n}. Never include explanatory text with tool calls.\n";
    prompt += "3. Keep tool requests scoped (specific metric + precise window). Prefer hourly or daily granularity unless raw samples are essential.\n";
    prompt += "4. When giving the final answer, cite the data sources you used (tools, summaries, forecasts) and include confidence, risks, and next actions.\n";
    prompt += "5. Always use bullet structure or sections so operators can act quickly. Tie every recommendation to a quantitative observation.\n";

    return {
        prompt,
        context: contextData,
        contextSummary: summarizeContextForClient(contextData, analysisData)
    };
}

/** @param {Object} context */
function buildContextSections(context, analysisData) {
    const sections = [];

    if (context.systemProfile) {
        const systemProfileSection = formatSystemProfile(context.systemProfile);
        if (systemProfileSection) sections.push(systemProfileSection);
    }

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

    return { sections };
}

function buildExecutionGuidance(mode, context) {
    const lines = ["**EXECUTION GUIDANCE**"];
    lines.push(`- Current run mode: ${mode === "background" ? "background (async)" : "synchronous"}. Plan tool usage to stay within limits.`);
    lines.push("- Synchronize only the data you need. If more than four tool calls or multi-week raw data seems necessary, recommend a background follow-up.");
    if (context?.meta) {
        lines.push(`- Preloaded context (${Math.round(context.meta.durationMs)} ms budget): ${summarizePreloadedContext(context)}`);
    }
    lines.push("- Use predictive, pattern, and budget tools to validate every recommendation against measured trends.");
    return lines.join("\n");
}

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
    return "**PRIMARY MISSION:** Produce an off-grid readiness briefing covering battery health, solar sufficiency, demand patterns, anomalies, forecasts, and action items. Benchmark everything against the provided baselines before advising.";
}

function buildCustomMission(customPrompt) {
    return `**USER QUESTION:**\n${customPrompt}\n\n**APPROACH:** Break the request into sub-goals, pull only the data you need, and deliver a tailored answer with explicit numbers, risks, and next steps.`;
}

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
    if (analytics.alertAnalysis?.totalAlerts) {
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
            lines.push(`- Daily generation vs consumption: ${formatNumber(current.energyFlow?.dailyGeneration, " Wh", 0)} in / ${formatNumber(current.energyFlow?.dailyConsumption, " Wh", 0)} out.`);
            lines.push(`- Solar sufficiency: ${formatPercent(current.solarSufficiency?.percentage, 0)} (${current.solarSufficiency?.status || "unknown"}).`);
            if (isFiniteNumber(current.batteryMetrics?.daysOfAutonomy)) {
                lines.push(`- Battery autonomy at current load: ${formatNumber(current.batteryMetrics.daysOfAutonomy, " days", 1)}.`);
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
            lines.push(`- Capacity decline: ${formatNumber(capacity.degradationRate?.value, " Ah/day", 2)}; replacement threshold in ${formatNumber(capacity.daysToReplacementThreshold, " days", 0)}.`);
            if (capacity.confidence?.confidenceLevel) {
                lines.push(`- Forecast confidence: ${capacity.confidence.confidenceLevel} (R² ${formatNumber(capacity.confidence.rSquared, "", 2)}).`);
            }
        }
    }
    const lifetime = predictions.lifetime;
    if (lifetime && !lifetime.error && !lifetime.insufficient_data) {
        lines.push(`- Estimated remaining life: ${formatNumber(lifetime.estimatedRemainingLife?.months, " months", 0)} (${formatNumber(lifetime.estimatedRemainingLife?.years, " years", 1)}).`);
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
        weather: context.weather && !context.weather.error ? {
            temp: context.weather.temp ?? null,
            clouds: context.weather.clouds ?? null,
            uvi: context.weather.uvi ?? null
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

module.exports = {
    collectAutoInsightsContext,
    buildGuruPrompt,
    summarizeContextForClient
};
