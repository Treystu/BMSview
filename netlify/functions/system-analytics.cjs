const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger, createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { createRetryWrapper } = require("./utils/retry.cjs");
const {
    createStandardEntryMeta,
    logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * @typedef {{ timestamp: string | number | Date, systemId?: string, analysis?: any, weather?: any, id?: string }} HistoryRecord
 */
/**
 * @typedef {{ hour: number, values: Record<string, any> }} HourlyStat
 */
/**
 * @typedef {{ hour: number, currents: number[] }} SunnyHourStat
 */

/**
 * @param {import('./utils/logger.cjs').LogFunction} log
 */
function validateEnvironment(log) {
    if (!process.env.MONGODB_URI) {
        log.error('Missing MONGODB_URI environment variable');
        return false;
    }
    return true;
}

/**
 * @param {number} statusCode
 * @param {any} body
 */
const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

/**
 * @param {any} event
 * @param {any} context
 */
exports.handler = async function (event, context) {
    /** @type {import('./utils/logger.cjs').LogFunction} */
    const log = createLoggerFromEvent('system-analytics', event, context);
    /** @type {any} */
    const timer = createTimer(log, 'system-analytics-handler');
    const withRetry = createRetryWrapper(log);
    const { httpMethod, queryStringParameters } = event;

    if (typeof log.entry === 'function') {
        log.entry(createStandardEntryMeta(event, { query: queryStringParameters }));
    }
    logDebugRequestSummary(log, event, { label: 'System analytics request', includeBody: false });

    if (httpMethod !== 'GET') {
        log.warn('Method not allowed', { method: httpMethod });
        timer.end();
        if (typeof log.exit === 'function') log.exit(405);
        return respond(405, { error: 'Method Not Allowed' });
    }

    try {
        const { systemId } = queryStringParameters || {};
        if (!systemId) {
            log.warn('Missing systemId parameter');
            timer.end();
            if (typeof log.exit === 'function') log.exit(400);
            return respond(400, { error: 'systemId is required.' });
        }

        const requestLogContext = { systemId };
        log.info('Starting system analytics processing.', requestLogContext);

        // MOCK DATA FOR TEST SYSTEM
        if (systemId === 'test-system') {
            log.info('Returning mock analytics for test-system', requestLogContext);
            return respond(200, {
                hourlyAverages: Array.from({ length: 24 }, (_, i) => ({
                    hour: i,
                    metrics: {
                        current: { avgCharge: 15, avgDischarge: -15, chargePoints: 10, dischargePoints: 10 },
                        stateOfCharge: { avg: 50 + Math.sin(i / 24 * Math.PI * 2) * 40, points: 20 },
                        temperature: { avg: 25, points: 20 },
                        power: { avgCharge: 750, avgDischarge: -750, chargePoints: 10, dischargePoints: 10 }
                    }
                })),
                performanceBaseline: {
                    sunnyDayChargingAmpsByHour: Array.from({ length: 8 }, (_, i) => ({
                        hour: 10 + i,
                        avgCurrent: 20,
                        dataPoints: 50
                    }))
                },
                alertAnalysis: {
                    events: [
                        {
                            alert: 'Cell Over Voltage',
                            count: 2,
                            totalDurationMinutes: 30,
                            avgDurationMinutes: 15,
                            firstSeen: new Date().toISOString(),
                            lastSeen: new Date().toISOString()
                        }
                    ],
                    totalEvents: 2,
                    totalDurationMinutes: 30
                },
            });
        }

        const historyCollection = await getCollection("history");

        // OPTIMIZED: Query only relevant records instead of fetching entire collection
        // This fixes the 100% error rate and high latency by pushing filtering to MongoDB
        /** @type {HistoryRecord[]} */
        const systemHistory = /** @type {HistoryRecord[]} */ (await withRetry(() => historyCollection.find({
            systemId: systemId,
            analysis: { $exists: true }
        }).toArray()));

        log.info(`Found ${systemHistory.length} history records for system.`, requestLogContext); if (systemHistory.length === 0) {
            return respond(200, {
                hourlyAverages: [],
                performanceBaseline: { sunnyDayChargingAmpsByHour: [] },
                alertAnalysis: { events: [], totalEvents: 0, totalDurationMinutes: 0 },
            });
        }

        // --- Refactored Hourly Averages Calculation ---
        const metricsToAverage = [
            'current', 'power', 'stateOfCharge', 'temperature',
            'mosTemperature', 'cellVoltageDifference', 'overallVoltage', 'clouds'
        ];

        /** @type {HourlyStat[]} */
        const hourlyStats = Array.from({ length: 24 }, (_, i) => {
            /** @type {HourlyStat} */
            const stats = { hour: i, values: {} };
            metricsToAverage.forEach(metric => {
                if (metric === 'current' || metric === 'power') {
                    stats.values[metric] = { charge: [], discharge: [] };
                } else {
                    stats.values[metric] = { all: [] };
                }
            });
            return stats;
        });

        systemHistory.forEach((record) => {
            try {
                const hour = new Date(record.timestamp).getUTCHours();
                const { analysis, weather } = record;

                metricsToAverage.forEach(metric => {
                    let value;
                    if (metric === 'clouds') {
                        value = weather?.clouds;
                    } else {
                        value = analysis[metric];
                    }

                    if (value == null) return;

                    if (metric === 'current' || metric === 'power') {
                        if (analysis.current > 0.5) {
                            hourlyStats[hour].values[metric].charge.push(value);
                        } else if (analysis.current < -0.5) {
                            hourlyStats[hour].values[metric].discharge.push(value);
                        }
                    } else {
                        hourlyStats[hour].values[metric].all.push(value);
                    }
                });
            } catch (e) {
                log.warn('Skipping record due to invalid timestamp.', { recordId: record.id, timestamp: record.timestamp });
            }
        });

        const hourlyAverages = hourlyStats.map((stats) => {
            /** @type {{ hour: number, metrics: Record<string, any> }} */
            const hourData = { hour: stats.hour, metrics: {} };

            metricsToAverage.forEach(metric => {
                if (metric === 'current' || metric === 'power') {
                    const chargeValues = /** @type {number[]} */ (stats.values[metric].charge || []);
                    const dischargeValues = /** @type {number[]} */ (stats.values[metric].discharge || []);
                    const avgCharge = chargeValues.length > 0 ? chargeValues.reduce((a, b) => a + b, 0) / chargeValues.length : 0;
                    const avgDischarge = dischargeValues.length > 0 ? dischargeValues.reduce((a, b) => a + b, 0) / dischargeValues.length : 0;
                    if (chargeValues.length > 0 || dischargeValues.length > 0) {
                        hourData.metrics[metric] = {
                            avgCharge,
                            avgDischarge,
                            chargePoints: chargeValues.length,
                            dischargePoints: dischargeValues.length,
                        };
                    }
                } else {
                    const allValues = /** @type {number[]} */ (stats.values[metric].all || []);
                    const avg = allValues.length > 0 ? allValues.reduce((a, b) => a + b, 0) / allValues.length : 0;
                    if (allValues.length > 0) {
                        hourData.metrics[metric] = {
                            avg,
                            points: allValues.length,
                        };
                    }
                }
            });
            return hourData;
        });
        log.debug('Calculated unified hourly averages.', requestLogContext);


        // --- Performance Baseline (Sunny Day Charging) ---
        /** @type {SunnyHourStat[]} */
        const sunnyDayChargingStatsByHour = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            currents: [],
        }));

        const sunnyDayHistory = systemHistory.filter(r =>
            r.weather && r.weather.clouds < 30 && // Sunny is < 30% cloud cover
            r.analysis?.current != null && r.analysis.current > 0.5 // Is charging
        );

        sunnyDayHistory.forEach(record => {
            try {
                const hour = new Date(record.timestamp).getUTCHours();
                const currentValue = Number(record.analysis?.current);
                sunnyDayChargingStatsByHour[hour].currents.push(currentValue);
            } catch (e) { /* ignore invalid date */ }
        });

        const sunnyDayChargingAmpsByHour = sunnyDayChargingStatsByHour
            .map(stats => ({
                hour: stats.hour,
                avgCurrent: stats.currents.length > 0 ? stats.currents.reduce((a, b) => a + b, 0) / stats.currents.length : 0,
                dataPoints: stats.currents.length,
            }))
            .filter(d => d.dataPoints > 0); // Only return hours with data

        log.debug('Calculated performance baseline.', { ...requestLogContext, baselineHoursWithData: sunnyDayChargingAmpsByHour.length });

        // --- Recurring Alert Analysis (Duration-Based) ---

        // 1. Sort Records by timestamp ascending to ensure correct event tracking
        systemHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // 2. Normalization Helper
        /** @param {any} alert */
        const normalizeAlert = (alert) => {
            if (!alert) return 'Unknown Alert';
            return alert
                .replace(/:\s*\d+(\.\d+)?\s*(mV|°C|%|A|V)$/i, '') // Strip value with unit at the end
                .replace(/:\s*\d+$/i, '') // Strip raw numbers at end
                .trim();
        };

        // 3. Event Loop
        const activeEvents = new Map(); // Key -> { startTime, lastTime }
        const finishedEvents = []; // { alert, startTime, endTime, durationMinutes }
        const GAP_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

        let lastRecordTime = 0;

        systemHistory.forEach(record => {
            const currentTime = new Date(record.timestamp).getTime();

            // Check for time gap
            if (lastRecordTime > 0 && (currentTime - lastRecordTime > GAP_THRESHOLD_MS)) {
                // Close all active events due to gap
                for (const [alert, data] of activeEvents.entries()) {
                    const durationMs = data.lastTime - data.startTime;
                    // For single points or very short events, we count them but duration might be 0
                    const durationMinutes = Math.max(0, durationMs / 60000);
                    finishedEvents.push({
                        alert,
                        startTime: new Date(data.startTime).toISOString(),
                        endTime: new Date(data.lastTime).toISOString(),
                        durationMinutes
                    });
                }
                activeEvents.clear();
            }
            lastRecordTime = currentTime;

            const currentAlerts = new Set();
            if (record.analysis.alerts && Array.isArray(record.analysis.alerts)) {
                record.analysis.alerts.forEach((/** @type {any} */ rawAlert) => {
                    const normalized = normalizeAlert(rawAlert);
                    currentAlerts.add(normalized);
                });
            }

            // Process current alerts
            currentAlerts.forEach(alert => {
                if (activeEvents.has(alert)) {
                    // Update existing event
                    const event = activeEvents.get(alert);
                    event.lastTime = currentTime;
                } else {
                    // Start new event
                    activeEvents.set(alert, { startTime: currentTime, lastTime: currentTime });
                }
            });

            // Close ended alerts (in activeEvents but not in currentAlerts)
            for (const [alert, data] of activeEvents.entries()) {
                if (!currentAlerts.has(alert)) {
                    const durationMs = data.lastTime - data.startTime;
                    const durationMinutes = Math.max(0, durationMs / 60000);
                    finishedEvents.push({
                        alert,
                        startTime: new Date(data.startTime).toISOString(),
                        endTime: new Date(data.lastTime).toISOString(),
                        durationMinutes
                    });
                    activeEvents.delete(alert);
                }
            }
        });

        // Close any remaining active events at the end of history
        for (const [alert, data] of activeEvents.entries()) {
            const durationMs = data.lastTime - data.startTime;
            const durationMinutes = Math.max(0, durationMs / 60000);
            finishedEvents.push({
                alert,
                startTime: new Date(data.startTime).toISOString(),
                endTime: new Date(data.lastTime).toISOString(),
                durationMinutes
            });
        }

        // 4. Aggregation
        const alertStatsMap = new Map(); // Alert -> { count, totalDuration, firstSeen, lastSeen }

        finishedEvents.forEach(event => {
            if (!alertStatsMap.has(event.alert)) {
                alertStatsMap.set(event.alert, {
                    alert: event.alert,
                    count: 0,
                    totalDurationMinutes: 0,
                    firstSeen: event.startTime,
                    lastSeen: event.endTime
                });
            }
            const stats = alertStatsMap.get(event.alert);
            stats.count++;
            stats.totalDurationMinutes += event.durationMinutes;

            // Update first/last seen
            if (new Date(event.startTime) < new Date(stats.firstSeen)) stats.firstSeen = event.startTime;
            if (new Date(event.endTime) > new Date(stats.lastSeen)) stats.lastSeen = event.endTime;
        });

        const alertAnalysisEvents = Array.from(alertStatsMap.values()).map(stats => ({
            ...stats,
            avgDurationMinutes: stats.count > 0 ? stats.totalDurationMinutes / stats.count : 0
        })).sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes); // Sort by duration desc

        const totalEvents = alertAnalysisEvents.reduce((sum, item) => sum + item.count, 0);
        const totalDurationMinutes = alertAnalysisEvents.reduce((sum, item) => sum + item.totalDurationMinutes, 0);

        log.debug('Calculated alert analysis with duration.', {
            ...requestLogContext,
            uniqueAlerts: alertAnalysisEvents.length,
            totalEvents,
            totalDurationMinutes
        });

        const analyticsData = {
            hourlyAverages,
            performanceBaseline: { sunnyDayChargingAmpsByHour },
            alertAnalysis: {
                events: alertAnalysisEvents,
                totalEvents,
                totalDurationMinutes
            },
        };

        log.info('Successfully generated system analytics.', requestLogContext);
        timer.end({ success: true });
        if (typeof log.exit === 'function') log.exit(200, { systemId });
        return respond(200, analyticsData);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;
        log.error('Critical error in system-analytics function.', { errorMessage, stack: errorStack });
        timer.end({ success: false, error: errorMessage });
        if (typeof log.exit === 'function') log.exit(500);
        return respond(500, { error: "An internal server error occurred." });
    }
};
