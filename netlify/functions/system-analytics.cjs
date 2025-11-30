const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");
const { createRetryWrapper } = require("./utils/retry.cjs");

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function (event, context) {
    const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
    const log = createLoggerFromEvent('system-analytics', event, context);
    const timer = createTimer(log, 'system-analytics-handler');
    const withRetry = createRetryWrapper(log);
    const { httpMethod, queryStringParameters } = event;
    
    log.entry({ method: httpMethod, path: event.path, query: queryStringParameters });

    if (httpMethod !== 'GET') {
        log.warn('Method not allowed', { method: httpMethod });
        timer.end();
        log.exit(405);
        return respond(405, { error: 'Method Not Allowed' });
    }

    try {
        const { systemId } = queryStringParameters || {};
        if (!systemId) {
            log.warn('Missing systemId parameter');
            timer.end();
            log.exit(400);
            return respond(400, { error: 'systemId is required.' });
        }

        const requestLogContext = { systemId };
        log.info('Starting system analytics processing.', requestLogContext);

        const historyCollection = await getCollection("history");
        const allHistory = await withRetry(() => historyCollection.find({}).toArray());

        const systemHistory = allHistory.filter(record => record.systemId === systemId && record.analysis);
        log('info', `Found ${systemHistory.length} history records for system.`, requestLogContext);

        if (systemHistory.length === 0) {
            return respond(200, {
                hourlyAverages: [],
                performanceBaseline: { sunnyDayChargingAmpsByHour: [] },
                alertAnalysis: { alertCounts: [], totalAlerts: 0 },
            });
        }

        // --- Refactored Hourly Averages Calculation ---
        const metricsToAverage = [
            'current', 'power', 'stateOfCharge', 'temperature',
            'mosTemperature', 'cellVoltageDifference', 'overallVoltage', 'clouds'
        ];

        const hourlyStats = Array.from({ length: 24 }, (_, i) => {
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

        systemHistory.forEach(record => {
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
                log('warn', 'Skipping record due to invalid timestamp.', { recordId: record.id, timestamp: record.timestamp });
            }
        });

        const hourlyAverages = hourlyStats.map(stats => {
            const hourData = { hour: stats.hour, metrics: {} };

            metricsToAverage.forEach(metric => {
                if (metric === 'current' || metric === 'power') {
                    const chargeValues = stats.values[metric].charge;
                    const dischargeValues = stats.values[metric].discharge;
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
                    const allValues = stats.values[metric].all;
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
        log('debug', 'Calculated unified hourly averages.', requestLogContext);


        // --- Performance Baseline (Sunny Day Charging) ---
        const sunnyDayChargingStatsByHour = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            currents: [],
        }));

        const sunnyDayHistory = systemHistory.filter(r =>
            r.weather && r.weather.clouds < 30 && // Sunny is < 30% cloud cover
            r.analysis.current != null && r.analysis.current > 0.5 // Is charging
        );

        sunnyDayHistory.forEach(record => {
            try {
                const hour = new Date(record.timestamp).getUTCHours();
                sunnyDayChargingStatsByHour[hour].currents.push(record.analysis.current);
            } catch (e) { /* ignore invalid date */ }
        });

        const sunnyDayChargingAmpsByHour = sunnyDayChargingStatsByHour
            .map(stats => ({
                hour: stats.hour,
                avgCurrent: stats.currents.length > 0 ? stats.currents.reduce((a, b) => a + b, 0) / stats.currents.length : 0,
                dataPoints: stats.currents.length,
            }))
            .filter(d => d.dataPoints > 0); // Only return hours with data

        log('debug', 'Calculated performance baseline.', { ...requestLogContext, baselineHoursWithData: sunnyDayChargingAmpsByHour.length });

        // --- Recurring Alert Analysis with Duplicate Detection ---
        const alertCountsMap = new Map();
        let totalAlerts = 0;

        systemHistory.forEach(record => {
            if (record.analysis.alerts && Array.isArray(record.analysis.alerts)) {
                // Deduplicate alerts within each record to avoid counting the same alert multiple times
                const uniqueAlertsInRecord = new Set(record.analysis.alerts);
                uniqueAlertsInRecord.forEach(alert => {
                    alertCountsMap.set(alert, (alertCountsMap.get(alert) || 0) + 1);
                    totalAlerts++;
                });
            }
        });

        const alertCounts = Array.from(alertCountsMap.entries())
            .map(([alert, count]) => ({ alert, count }))
            .sort((a, b) => b.count - a.count);

        log('debug', 'Calculated alert analysis with deduplication.', { ...requestLogContext, uniqueAlerts: alertCounts.length, totalAlerts });

        const analyticsData = {
            hourlyAverages,
            performanceBaseline: { sunnyDayChargingAmpsByHour },
            alertAnalysis: { alertCounts, totalAlerts },
        };

        log.info('Successfully generated system analytics.', requestLogContext);
        timer.end({ success: true });
        log.exit(200, { systemId });
        return respond(200, analyticsData);

    } catch (error) {
        log.error('Critical error in system-analytics function.', { errorMessage: error.message, stack: error.stack });
        timer.end({ success: false, error: error.message });
        log.exit(500);
        return respond(500, { error: "An internal server error occurred." });
    }
};
