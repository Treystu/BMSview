const { GoogleGenAI } = require("@google/genai");
const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");
const { createRetryWrapper } = require("./utils/retry.js");
const { Readable } = require("stream");

/**
 * Creates a concise, human-readable summary of system analytics for the AI prompt.
 * @param {object} analytics - The full analytics object.
 * @param {function} log - The logger function.
 * @returns {string} A text summary of key historical trends.
 */
function summarizeAnalyticsForPrompt(analytics, log) {
    log('debug', 'summarizeAnalyticsForPrompt started.');
    if (!analytics || (!analytics.hourlyAverages?.length && !analytics.alertAnalysis?.totalAlerts)) {
        log('debug', 'summarizeAnalyticsForPrompt: No historical data provided.');
        return "No historical data available for this system.";
    }
    
    let summary = "Below is a summary of key historical trends for this system:\n";

    try {
        const nightHours = [22, 23, 0, 1, 2, 3, 4];
        const nightDischarge = analytics.hourlyAverages
            .filter(h => nightHours.includes(h.hour) && h.metrics.power?.avgDischarge < -10)
            .map(h => h.metrics.power.avgDischarge);
        if (nightDischarge.length > 0) {
            const avgNightPower = nightDischarge.reduce((a, b) => a + b, 0) / nightDischarge.length;
            summary += `- The average nighttime power draw is approximately ${avgNightPower.toFixed(0)}W.\n`;
            log('debug', 'summarizeAnalyticsForPrompt: Added night power summary.', { avgNightPower });
        }
    } catch (e) { log('warn', 'summarizeAnalyticsForPrompt: Could not summarize nighttime power.', { error: e.message }); }

    try {
        if (analytics.performanceBaseline?.sunnyDayChargingAmpsByHour?.length > 0) {
            const peakCharging = [...analytics.performanceBaseline.sunnyDayChargingAmpsByHour].sort((a,b) => b.avgCurrent - a.avgCurrent)[0];
            if (peakCharging) {
                summary += `- On sunny days, the system has shown peak charging currents around ${peakCharging.avgCurrent.toFixed(1)}A.\n`;
                log('debug', 'summarizeAnalyticsForPrompt: Added charging summary.', { peakCharging });
            }
        }
    } catch(e) { log('warn', 'summarizeAnalyticsForPrompt: Could not summarize charging performance.', { error: e.message }); }

    try {
        if (analytics.alertAnalysis?.alertCounts?.length > 0) {
            const topAlert = analytics.alertAnalysis.alertCounts[0];
            summary += `- The most frequent alert is "${topAlert.alert.replace(/^(CRITICAL:|WARNING:)\s*/i, '')}" (occurred ${topAlert.count} times).\n`;
            log('debug', 'summarizeAnalyticsForPrompt: Added alert summary.', { topAlert });
        }
    } catch (e) { log('warn', 'summarizeAnalyticsForPrompt: Could not summarize alert data.', { error: e.message }); }

    log('info', 'Generated concise summary of historical analytics for prompt.', { summaryLength: summary.length });
    log('debug', 'summarizeAnalyticsForPrompt: final summary.', { summary });
    return summary;
}

async function getWeatherForecast(latitude, longitude, log) {
    log('debug', 'getWeatherForecast started.', { latitude, longitude });
    const apiKey = process.env.WEATHER_API_KEY;
    if (!latitude || !longitude || !apiKey) {
        log('warn', 'getWeatherForecast: Location information or API key is missing.');
        return { error: 'Location information or API key is missing.' };
    }
    try {
        const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${latitude}&lon=${longitude}&units=metric&exclude=current,minutely,hourly,alerts&appid=${apiKey}`;
        log('debug', 'getWeatherForecast: Fetching URL.', { url });
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API failed with status ${response.status}`);
        const data = await response.json();
        const forecast = data.daily.slice(0, 7).map(d => ({ date: new Date(d.dt*1000).toISOString().split('T')[0], temp_max: d.temp.max, temp_min: d.temp.min, summary: d.summary, clouds: d.clouds, uvi: d.uvi }));
        log('info', 'Successfully fetched weather forecast.', { days: forecast.length });
        log('debug', 'getWeatherForecast: returning forecast.', { forecast });
        return { forecast };
    } catch (e) {
        log('error', 'Failed to fetch weather forecast.', { error: e.message });
        return { error: `Failed to fetch weather forecast: ${e.message}` };
    }
}

async function getSystemAnalytics(systemId, log, withRetry) {
    console.time('getSystemAnalytics');
    log('debug', 'getSystemAnalytics started.', { systemId });
    if (!systemId) {
        log('warn', 'getSystemAnalytics: No systemId provided.');
        return null;
    }
    const historyCollection = await getCollection("history");
    const allHistory = await withRetry(() => historyCollection.find({}).toArray());
    log('debug', `getSystemAnalytics: Fetched ${allHistory.length} total history records from DB.`);
    const systemHistory = allHistory.filter(r => r.systemId === systemId && r.analysis);
    if (systemHistory.length === 0) {
        log('warn', 'getSystemAnalytics: No history found for system.', { systemId });
        return null;
    }
    log('debug', `getSystemAnalytics: Found ${systemHistory.length} records for this system.`);

    const metricsToAverage = ['current', 'power', 'stateOfCharge', 'temperature', 'mosTemperature', 'cellVoltageDifference', 'overallVoltage'];
    const hourlyStats = Array.from({ length: 24 }, (_, i) => {
        const stats = { hour: i, values: {} };
        metricsToAverage.forEach(metric => {
            stats.values[metric] = (metric === 'current' || metric === 'power') ? { charge: [], discharge: [] } : { all: [] };
        });
        return stats;
    });
    systemHistory.forEach(r => {
        try {
            const hour = new Date(r.timestamp).getUTCHours();
            metricsToAverage.forEach(metric => {
                const value = r.analysis[metric];
                if (value == null) return;
                if (metric === 'current' || metric === 'power') {
                    if (r.analysis.current > 0.5) hourlyStats[hour].values[metric].charge.push(value);
                    else if (r.analysis.current < -0.5) hourlyStats[hour].values[metric].discharge.push(value);
                } else {
                    hourlyStats[hour].values[metric].all.push(value);
                }
            });
        } catch (e) {}
    });
    const hourlyAverages = hourlyStats.map(s => {
        const hourData = { hour: s.hour, metrics: {} };
        metricsToAverage.forEach(metric => {
            if (metric === 'current' || metric === 'power') {
                const chargeValues = s.values[metric].charge, dischargeValues = s.values[metric].discharge;
                if (chargeValues.length > 0 || dischargeValues.length > 0) {
                    hourData.metrics[metric] = {
                        avgCharge: chargeValues.length > 0 ? chargeValues.reduce((a,b)=>a+b,0)/chargeValues.length : 0,
                        avgDischarge: dischargeValues.length > 0 ? dischargeValues.reduce((a,b)=>a+b,0)/dischargeValues.length : 0,
                    };
                }
            } else {
                const allValues = s.values[metric].all;
                if (allValues.length > 0) hourData.metrics[metric] = { avg: allValues.reduce((a,b)=>a+b,0)/allValues.length };
            }
        });
        return hourData;
    });
    log('debug', 'getSystemAnalytics: Calculated hourly averages.', { count: hourlyAverages.length });

    const sunnyDayHistory = systemHistory.filter(r => r.weather?.clouds < 30 && r.analysis.current > 0.5);
    const sunnyDayChargingAmpsByHour = Array.from({length: 24}, (_, hour) => {
        const currents = sunnyDayHistory.filter(r => new Date(r.timestamp).getUTCHours() === hour).map(r => r.analysis.current);
        return { hour, avgCurrent: currents.length > 0 ? currents.reduce((a,b)=>a+b,0)/currents.length : 0, dataPoints: currents.length };
    }).filter(d => d.dataPoints > 0);
    log('debug', 'getSystemAnalytics: Calculated sunny day baseline.', { hoursWithData: sunnyDayChargingAmpsByHour.length });

    const alertCountsMap = new Map();
    const totalAlerts = systemHistory.flatMap(r => r.analysis.alerts || []).length;
    systemHistory.forEach(r => r.analysis.alerts?.forEach(alert => alertCountsMap.set(alert, (alertCountsMap.get(alert) || 0) + 1)));
    const alertCounts = Array.from(alertCountsMap.entries()).map(([alert, count]) => ({ alert, count })).sort((a,b) => b.count-a.count);
    log('debug', 'getSystemAnalytics: Calculated alert analysis.', { uniqueAlerts: alertCounts.length, totalAlerts });

    const analytics = { hourlyAverages, performanceBaseline: { sunnyDayChargingAmpsByHour }, alertAnalysis: { alertCounts, totalAlerts } };
    log('debug', 'getSystemAnalytics finished.', { systemId });
    console.timeEnd('getSystemAnalytics');
    return analytics;
}

exports.handler = function(event, context) {
    const log = createLogger('generate-insights', context);
    const withRetry = createRetryWrapper(log);
    const handlerStartTime = Date.now();
    const logWithTiming = (level, message, extra = {}) => log(level, message, { durationMs: Date.now() - handlerStartTime, ...extra });

    logWithTiming('debug', 'Function invoked.', { httpMethod: event.httpMethod, path: event.path, bodyLength: event.body?.length });

    if (event.httpMethod !== 'POST') {
        logWithTiming('warn', 'Method not allowed', { httpMethod: event.httpMethod });
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    let parsedBody;
    try {
        parsedBody = JSON.parse(event.body);
        logWithTiming('debug', 'Request body parsed successfully.');
    } catch (e) {
        log('error', 'Failed to parse request body.', { error: e.message });
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
    }

    const { analysisData, systemId, customPrompt } = parsedBody;

    if (!analysisData) {
        log('error', 'Request validation failed: analysisData is required.');
        return { statusCode: 400, body: JSON.stringify({ error: 'analysisData is required.' }) };
    }

    const stream = new Readable({ read() {} });

    (async () => {
        try {
            logWithTiming('info', 'Stream initialized. Beginning data processing.');
            const requestContext = { systemId, hasCustomPrompt: !!customPrompt };

            let system = null;
            let analyticsSummary = "No historical data available.";
            let weatherForecastSummary = "Weather forecast is not available.";

            if (systemId) {
                logWithTiming('debug', 'System ID provided. Looking up system and fetching data concurrently.', requestContext);
                
                const systemsCollection = await getCollection("systems");
                const allSystems = await withRetry(() => systemsCollection.find({}).toArray());
                system = allSystems.find(s => s.id === systemId);

                if (system) {
                    const [analyticsResult, weatherResult] = await Promise.all([
                        getSystemAnalytics(systemId, (l,m,e) => logWithTiming(l, `[getSystemAnalytics] ${m}`, e), withRetry),
                        (system.latitude && system.longitude) 
                            ? getWeatherForecast(system.latitude, system.longitude, (l,m,e) => logWithTiming(l, `[getWeatherForecast] ${m}`, e))
                            : Promise.resolve({ forecast: null, error: "No location data." })
                    ]);
                    
                    if (analyticsResult) {
                        analyticsSummary = summarizeAnalyticsForPrompt(analyticsResult, (l,m,e) => logWithTiming(l, `[summarize] ${m}`, e));
                    }
                    if (weatherResult && !weatherResult.error) {
                        weatherForecastSummary = `This is the 7-day weather forecast for the system's location:\n\`\`\`json\n${JSON.stringify(weatherResult.forecast, null, 2)}\n\`\`\``;
                    }
                } else {
                    logWithTiming('warn', 'System ID provided but system not found in cache.', requestContext);
                }
            }
            logWithTiming('info', 'Finished pre-fetching and summarizing data.', requestContext);

            const prompt = `You are an expert BMS (Battery Management System) AI analyst. Your task is to provide a clear, actionable answer to the user's request using all the context provided. Format your entire final response in Markdown.

**System Context:**
- System Name: ${system?.name || 'N/A'}
- Chemistry: ${system?.chemistry || 'N/A'}
- Nominal Capacity: ${system?.capacity || 'N/A'} Ah

**Current System Snapshot Data:**
\`\`\`json
${JSON.stringify(analysisData, null, 2)}
\`\`\`

**Historical Data Summary:**
${analyticsSummary}

**Weather Forecast Context:**
${weatherForecastSummary}

**User's Request:**
"${customPrompt || 'Provide a standard analysis including a summary of the current data, runtime estimates based on historical trends, and a generator recommendation if applicable.'}"`;

            logWithTiming('debug', 'Generated master prompt for Gemini.', { ...requestContext, promptLength: prompt.length });

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            // ***UPDATED***: Changed model to gemini-flash-latest
            const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';
            logWithTiming('info', `Making single streaming Gemini call to ${modelName}.`, { ...requestContext, model: modelName });
            
            const geminiStream = await ai.models.generateContentStream({ model: modelName, contents: prompt });
            
            let chunkCount = 0;
            for await (const chunk of geminiStream) {
                chunkCount++;
                const text = chunk.text;
                logWithTiming('debug', `Received chunk ${chunkCount} from Gemini.`, { ...requestContext, chunkLength: text.length });
                stream.push(text);
            }
            logWithTiming('info', `Gemini stream finished. Total chunks: ${chunkCount}. Closing stream.`, requestContext);
            stream.push(null);
        } catch (error) {
            logWithTiming('error', 'Error occurred during stream processing.', { errorMessage: error.message, stack: error.stack });
            stream.emit('error', error);
        }
    })();

    logWithTiming('info', 'Returning response with stream body.');
    return {
        statusCode: 200,
        headers: { 
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked'
        },
        body: stream,
    };
};
