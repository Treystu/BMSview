import type { AlertEventStats, HourlyAverages, SystemAnalytics } from '../../services/clientService';
import type { AnalysisRecord } from '../../types';

/**
 * Port of system-analytics.cjs logic to the frontend for better performance
 * and offline/cache-first reliability.
 */

export function calculateSystemAnalytics(history: AnalysisRecord[]): SystemAnalytics {
    if (history.length === 0) {
        return {
            hourlyAverages: [],
            performanceBaseline: { sunnyDayChargingAmpsByHour: [] },
            alertAnalysis: { events: [], totalEvents: 0, totalDurationMinutes: 0 },
        };
    }

    // --- Hourly Averages ---
    const metricsToAverage = [
        'current', 'power', 'stateOfCharge', 'temperature',
        'mosTemperature', 'cellVoltageDifference', 'overallVoltage', 'clouds'
    ];

    const hourlyStats = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        values: {} as Record<string, { all?: number[], charge?: number[], discharge?: number[] }>
    }));

    hourlyStats.forEach(stat => {
        metricsToAverage.forEach(metric => {
            if (metric === 'current' || metric === 'power') {
                stat.values[metric] = { charge: [], discharge: [] };
            } else {
                stat.values[metric] = { all: [] };
            }
        });
    });

    history.forEach((record) => {
        if (!record.analysis) return;

        try {
            const date = new Date(record.timestamp);
            const hour = date.getUTCHours();
            const { analysis, weather } = record;

            metricsToAverage.forEach(metric => {
                let value: number | null | undefined;
                if (metric === 'clouds') {
                    value = weather?.clouds;
                } else {
                    value = (analysis as any)[metric];
                }

                if (value == null || typeof value !== 'number') return;

                const current = analysis.current ?? 0;
                if (metric === 'current' || metric === 'power') {
                    if (current > 0.5) {
                        stat_push(hourlyStats[hour].values[metric].charge, value);
                    } else if (current < -0.5) {
                        stat_push(hourlyStats[hour].values[metric].discharge, value);
                    }
                } else {
                    stat_push(hourlyStats[hour].values[metric].all, value);
                }
            });
        } catch (e) {
            // ignore invalid records
        }
    });

    const hourlyAverages: HourlyAverages[] = hourlyStats.map((stats) => {
        const hourData: HourlyAverages = { hour: stats.hour, metrics: {} };

        metricsToAverage.forEach(metric => {
            if (metric === 'current' || metric === 'power') {
                const chargeValues = stats.values[metric].charge || [];
                const dischargeValues = stats.values[metric].discharge || [];
                const avgCharge = chargeValues.length > 0 ? average(chargeValues) : 0;
                const avgDischarge = dischargeValues.length > 0 ? average(dischargeValues) : 0;
                if (chargeValues.length > 0 || dischargeValues.length > 0) {
                    (hourData.metrics as any)[metric] = {
                        avgCharge,
                        avgDischarge,
                        chargePoints: chargeValues.length,
                        dischargePoints: dischargeValues.length,
                    };
                }
            } else {
                const allValues = stats.values[metric].all || [];
                const avg = allValues.length > 0 ? average(allValues) : 0;
                if (allValues.length > 0) {
                    (hourData.metrics as any)[metric] = {
                        avg,
                        points: allValues.length,
                    };
                }
            }
        });
        return hourData;
    });

    // --- Performance Baseline ---
    const sunnyDayChargingStatsByHour = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        currents: [] as number[],
    }));

    history.forEach(record => {
        if (record.weather && record.weather.clouds < 30 && record.analysis && (record.analysis.current ?? 0) > 0.5) {
            try {
                const hour = new Date(record.timestamp).getUTCHours();
                sunnyDayChargingStatsByHour[hour].currents.push(record.analysis.current!);
            } catch (e) { }
        }
    });

    const sunnyDayChargingAmpsByHour = sunnyDayChargingStatsByHour
        .map(stats => ({
            hour: stats.hour,
            avgCurrent: stats.currents.length > 0 ? average(stats.currents) : 0,
            dataPoints: stats.currents.length,
        }))
        .filter(d => d.dataPoints > 0);

    // --- Alert Analysis ---
    const sortedHistory = [...history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const GAP_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

    const activeEvents = new Map<string, { startTime: number, lastTime: number }>();
    const finishedEvents: Array<{ alert: string, startTime: string, endTime: string, durationMinutes: number }> = [];
    let lastRecordTime = 0;

    sortedHistory.forEach(record => {
        if (!record.analysis) return;
        const currentTime = new Date(record.timestamp).getTime();

        if (lastRecordTime > 0 && (currentTime - lastRecordTime > GAP_THRESHOLD_MS)) {
            closeAllEvents(activeEvents, finishedEvents);
        }
        lastRecordTime = currentTime;

        const currentAlerts = new Set<string>();
        if (record.analysis.alerts && Array.isArray(record.analysis.alerts)) {
            record.analysis.alerts.forEach(rawAlert => {
                currentAlerts.add(normalizeAlert(rawAlert));
            });
        }

        currentAlerts.forEach(alert => {
            if (activeEvents.has(alert)) {
                activeEvents.get(alert)!.lastTime = currentTime;
            } else {
                activeEvents.set(alert, { startTime: currentTime, lastTime: currentTime });
            }
        });

        for (const [alert, data] of activeEvents.entries()) {
            if (!currentAlerts.has(alert)) {
                const durationMinutes = Math.max(0, (data.lastTime - data.startTime) / 60000);
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
    closeAllEvents(activeEvents, finishedEvents);

    const alertStatsMap = new Map<string, AlertEventStats>();
    finishedEvents.forEach(event => {
        if (!alertStatsMap.has(event.alert)) {
            alertStatsMap.set(event.alert, {
                alert: event.alert,
                count: 0,
                totalDurationMinutes: 0,
                avgDurationMinutes: 0,
                firstSeen: event.startTime,
                lastSeen: event.endTime
            });
        }
        const stats = alertStatsMap.get(event.alert)!;
        stats.count++;
        stats.totalDurationMinutes += event.durationMinutes;
        if (new Date(event.startTime) < new Date(stats.firstSeen)) stats.firstSeen = event.startTime;
        if (new Date(event.endTime) > new Date(stats.lastSeen)) stats.lastSeen = event.endTime;
    });

    const alertAnalysisEvents = Array.from(alertStatsMap.values()).map(stats => ({
        ...stats,
        avgDurationMinutes: stats.count > 0 ? stats.totalDurationMinutes / stats.count : 0
    })).sort((a, b) => b.totalDurationMinutes - a.totalDurationMinutes);

    return {
        hourlyAverages,
        performanceBaseline: { sunnyDayChargingAmpsByHour },
        alertAnalysis: {
            events: alertAnalysisEvents,
            totalEvents: alertAnalysisEvents.reduce((sum, i) => sum + i.count, 0),
            totalDurationMinutes: alertAnalysisEvents.reduce((sum, i) => sum + i.totalDurationMinutes, 0)
        }
    };
}

// Helpers
function stat_push(arr: number[] | undefined, val: number) {
    if (arr) arr.push(val);
}

function average(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function normalizeAlert(alert: string): string {
    if (!alert) return 'Unknown Alert';
    return alert
        .replace(/:\s*\d+(\.\d+)?\s*(mV|°C|%|A|V)$/i, '')
        .replace(/:\s*\d+$/i, '')
        .trim();
}

function closeAllEvents(active: Map<string, { startTime: number, lastTime: number }>, finished: any[]) {
    for (const [alert, data] of active.entries()) {
        const durationMinutes = Math.max(0, (data.lastTime - data.startTime) / 60000);
        finished.push({
            alert,
            startTime: new Date(data.startTime).toISOString(),
            endTime: new Date(data.lastTime).toISOString(),
            durationMinutes
        });
    }
    active.clear();
}
