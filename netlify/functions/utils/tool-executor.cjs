/**
 * Tool Executor - Implements all Gemini tool calls
 * Routes tool requests from Gemini to actual implementation logic
 * Handles MongoDB aggregations, data transformations, and error handling
 */

const { getCollection } = require('./mongodb.cjs');
const { createLogger } = require('./logger.cjs');

/**
 * Main dispatcher for tool execution
 * Routes to appropriate handler based on tool name
 */
async function executeToolCall(toolName, parameters, log) {
    const startTime = Date.now();

    if (!log) {
        log = createLogger('tool-executor');
    }

    log.info('Executing tool call', { toolName, paramKeys: Object.keys(parameters || {}) });

    try {
        let result;

        switch (toolName) {
            case 'request_bms_data':
                result = await requestBmsData(parameters, log);
                break;

            case 'getSystemHistory':
                result = await getSystemHistory(parameters, log);
                break;

            case 'getWeatherData':
                result = await getWeatherData(parameters, log);
                break;

            case 'getSolarEstimate':
                result = await getSolarEstimate(parameters, log);
                break;

            case 'getSystemAnalytics':
                result = await getSystemAnalytics(parameters, log);
                break;

            case 'predict_battery_trends':
                result = await predictBatteryTrends(parameters, log);
                break;

            case 'analyze_usage_patterns':
                result = await analyzeUsagePatterns(parameters, log);
                break;

            case 'calculate_energy_budget':
                result = await calculateEnergyBudget(parameters, log);
                break;

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }

        const duration = Date.now() - startTime;
        log.info('Tool execution completed', {
            toolName,
            duration: `${duration}ms`,
            resultSize: result ? JSON.stringify(result).length : 0
        });

        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Tool execution failed', {
            toolName,
            error: error.message,
            duration: `${duration}ms`,
            stack: error.stack
        });

        return {
            error: true,
            tool: toolName,
            message: `Tool execution failed: ${error.message}`
        };
    }
}

/**
 * Request specific BMS metrics with time filtering and aggregation
 * Primary data access tool for the ReAct loop
 */
async function requestBmsData(params, log) {
    const {
        systemId,
        metric = 'all',
        time_range_start,
        time_range_end,
        granularity = 'hourly_avg'
    } = params;

    if (!systemId) {
        throw new Error('systemId is required');
    }

    if (!time_range_start || !time_range_end) {
        throw new Error('time_range_start and time_range_end are required');
    }

    const startDate = new Date(time_range_start);
    const endDate = new Date(time_range_end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format. Use ISO 8601 (e.g., "2025-11-01T00:00:00Z")');
    }

    if (startDate >= endDate) {
        throw new Error('time_range_start must be before time_range_end');
    }

    const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
    log.debug('BMS data request parameters', {
        systemId,
        metric,
        daysDiff,
        granularity,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
    });

    try {
        const collection = await getCollection('history');

        // Build base query
        const query = {
            systemId,
            timestamp: {
                $gte: startDate.toISOString(),
                $lte: endDate.toISOString()
            }
        };

        // Fetch records
        const records = await collection
            .find(query, { projection: { _id: 0, timestamp: 1, analysis: 1 } })
            .sort({ timestamp: 1 })
            .toArray();

        log.info('Records fetched from database', {
            count: records.length,
            query
        });

        if (records.length === 0) {
            return {
                systemId,
                metric,
                time_range: { start: time_range_start, end: time_range_end },
                granularity,
                dataPoints: 0,
                message: 'No data found for the specified time range and system',
                data: []
            };
        }

        // Process based on granularity
        let processedData;

        if (granularity === 'raw') {
            // Return raw records (apply sampling for large datasets)
            const maxRawPoints = 500;
            let sampledRecords = records;

            if (records.length > maxRawPoints) {
                const step = Math.ceil(records.length / maxRawPoints);
                sampledRecords = records.filter((_, idx) => idx % step === 0);

                // Always include last record
                if (sampledRecords[sampledRecords.length - 1] !== records[records.length - 1]) {
                    sampledRecords.push(records[records.length - 1]);
                }

                log.warn('Raw data sampling applied', {
                    original: records.length,
                    sampled: sampledRecords.length
                });
            }

            processedData = sampledRecords.map(r => ({
                timestamp: r.timestamp,
                ...extractMetrics(r.analysis, metric)
            }));
        } else if (granularity === 'hourly_avg') {
            processedData = aggregateByHour(records, metric, log);
        } else if (granularity === 'daily_avg') {
            processedData = aggregateByDay(records, metric, log);
        } else {
            throw new Error(`Unknown granularity: ${granularity}`);
        }

        // Add explanatory note based on granularity
        let note = null;
        if (records.length > processedData.length) {
            note = `Data aggregated from ${records.length} raw records to ${processedData.length} ${granularity === 'daily_avg' ? 'daily' : 'hourly'} points`;
        }
        if (granularity === 'daily_avg') {
            note = note 
                ? `${note}. Each day includes hourly breakdown (up to 24 hours) for detailed analysis.`
                : 'Each daily record includes hourly breakdown data (up to 24 hours) for detailed analysis.';
        }

        return {
            systemId,
            metric,
            time_range: { start: time_range_start, end: time_range_end },
            granularity,
            dataPoints: processedData.length,
            data: processedData,
            ...(note && { note })
        };
    } catch (error) {
        log.error('requestBmsData failed', { error: error.message, params });
        throw error;
    }
}

/**
 * Extract specific metrics from analysis record
 */
function extractMetrics(analysis, metric) {
    if (!analysis) return {};

    const metricMap = {
        voltage: { voltage: analysis.overallVoltage },
        current: { current: analysis.current },
        power: { power: analysis.power },
        soc: { soc: analysis.stateOfCharge },
        capacity: { capacity: analysis.remainingCapacity },
        temperature: {
            temperature: analysis.temperature,
            mosTemperature: analysis.mosTemperature
        },
        cell_voltage_difference: { cellVoltageDiff: analysis.cellVoltageDifference }
    };

    if (metric === 'all') {
        return {
            voltage: analysis.overallVoltage,
            current: analysis.current,
            power: analysis.power,
            soc: analysis.stateOfCharge,
            capacity: analysis.remainingCapacity,
            temperature: analysis.temperature,
            cellVoltageDiff: analysis.cellVoltageDifference
        };
    }

    return metricMap[metric] || {};
}

/**
 * Aggregate records by hour
 */
function aggregateByHour(records, metric, log) {
    const buckets = new Map();

    for (const record of records) {
        if (!record.timestamp || !record.analysis) continue;

        const date = new Date(record.timestamp);
        const bucket = new Date(date);
        bucket.setMinutes(0, 0, 0);
        const bucketKey = bucket.toISOString();

        if (!buckets.has(bucketKey)) {
            buckets.set(bucketKey, []);
        }
        buckets.get(bucketKey).push(record);
    }

    log.debug('Records grouped by hour', { bucketCount: buckets.size });

    const hourlyData = Array.from(buckets.entries()).map(([bucket, recs]) => {
        const metrics = computeAggregateMetrics(recs, metric);
        return {
            timestamp: bucket,
            dataPoints: recs.length,
            ...metrics
        };
    });

    return hourlyData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Aggregate records by day with optional hourly breakdown
 * Provides 90-day rollups with up to 24 hourly events per day
 */
function aggregateByDay(records, metric, log) {
    const dayBuckets = new Map();

    // First, group all records by day
    for (const record of records) {
        if (!record.timestamp || !record.analysis) continue;

        const date = new Date(record.timestamp);
        const dayKey = date.toISOString().split('T')[0];

        if (!dayBuckets.has(dayKey)) {
            dayBuckets.set(dayKey, []);
        }
        dayBuckets.get(dayKey).push(record);
    }

    log.debug('Records grouped by day', { bucketCount: dayBuckets.size });

    const dailyData = Array.from(dayBuckets.entries()).map(([dayKey, dayRecords]) => {
        // Calculate daily aggregates
        const dailyMetrics = computeAggregateMetrics(dayRecords, metric);

        // Also create hourly breakdown for this day
        const hourBuckets = new Map();
        for (const record of dayRecords) {
            const date = new Date(record.timestamp);
            const hour = date.getHours();

            if (!hourBuckets.has(hour)) {
                hourBuckets.set(hour, []);
            }
            hourBuckets.get(hour).push(record);
        }

        const hourlyBreakdown = Array.from(hourBuckets.entries())
            .map(([hour, hourRecords]) => {
                const hourMetrics = computeAggregateMetrics(hourRecords, metric);
                return {
                    hour,
                    dataPoints: hourRecords.length,
                    ...hourMetrics
                };
            })
            .sort((a, b) => a.hour - b.hour);

        return {
            date: dayKey,
            dataPoints: dayRecords.length,
            ...dailyMetrics,
            hourlyData: hourlyBreakdown
        };
    });

    return dailyData.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compute average/min/max/count for aggregated metrics
 */
function computeAggregateMetrics(records, metric) {
    const metricsToCompute = metric === 'all'
        ? ['voltage', 'current', 'power', 'soc', 'capacity', 'temperature', 'cell_voltage_difference']
        : [metric];

    const result = {};

    for (const met of metricsToCompute) {
        const values = records
            .map(r => extractMetrics(r.analysis, met)[getFieldName(met)])
            .filter(v => typeof v === 'number' && isFinite(v));

        if (values.length === 0) continue;

        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);

        const fieldName = getFieldName(met);
        result[`avg${capitalize(fieldName)}`] = Number(avg.toFixed(2));
        result[`min${capitalize(fieldName)}`] = Number(min.toFixed(2));
        result[`max${capitalize(fieldName)}`] = Number(max.toFixed(2));
    }

    return result;
}

function getFieldName(metric) {
    const map = {
        voltage: 'voltage',
        current: 'current',
        power: 'power',
        soc: 'soc',
        capacity: 'capacity',
        temperature: 'temperature',
        cell_voltage_difference: 'cellVoltageDiff'
    };
    return map[metric] || metric;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Get historical battery measurements for a system
 */
/**
 * Legacy function - DEPRECATED
 * Use request_bms_data instead for better performance and aggregation
 * This function is kept for backward compatibility but redirects to request_bms_data
 */
async function getSystemHistory(params, log) {
    const { systemId, limit = 100, startDate, endDate } = params;

    if (!systemId) {
        throw new Error('systemId is required');
    }

    log.warn('getSystemHistory is deprecated - redirecting to request_bms_data', { systemId });

    // Calculate time range
    let time_range_start, time_range_end;
    
    if (endDate) {
        time_range_end = new Date(endDate).toISOString();
    } else {
        time_range_end = new Date().toISOString();
    }
    
    if (startDate) {
        time_range_start = new Date(startDate).toISOString();
    } else {
        // Default to 30 days before end date
        const start = new Date(time_range_end);
        start.setDate(start.getDate() - 30);
        time_range_start = start.toISOString();
    }

    // Redirect to the new request_bms_data function
    const result = await requestBmsData({
        systemId,
        metric: 'all',
        time_range_start,
        time_range_end,
        granularity: 'raw'
    }, log);

    // Transform to legacy format
    return {
        systemId,
        recordCount: result.dataPoints,
        records: result.data.map(d => ({
            timestamp: d.timestamp,
            analysis: {
                stateOfCharge: d.soc,
                overallVoltage: d.voltage,
                current: d.current,
                power: d.power,
                temperature: d.temperature
            }
        })),
        note: 'DEPRECATED: This function redirects to request_bms_data. Please use request_bms_data directly.'
    };
}

/**
 * Get weather data for a location (placeholder - calls external service)
 */
async function getWeatherData(params, log) {
    const { latitude, longitude, timestamp, type = 'historical' } = params;

    if (!latitude || !longitude) {
        throw new Error('latitude and longitude are required');
    }

    // In actual implementation, would call weather service
    log.info('Weather data requested', { latitude, longitude, timestamp, type });

    // Placeholder return
    return {
        latitude,
        longitude,
        timestamp: timestamp || new Date().toISOString(),
        type,
        temp: null,
        clouds: null,
        uvi: null,
        note: 'Weather service integration pending'
    };
}

/**
 * Get solar energy estimates (placeholder - calls external service)
 */
async function getSolarEstimate(params, log) {
    const { location, panelWatts, startDate, endDate } = params;

    if (!location || !panelWatts || !startDate || !endDate) {
        throw new Error('location, panelWatts, startDate, and endDate are required');
    }

    log.info('Solar estimate requested', { location, panelWatts, startDate, endDate });

    // Placeholder return
    return {
        location,
        panelWatts,
        startDate,
        endDate,
        estimatedWh: null,
        note: 'Solar service integration pending'
    };
}

/**
 * Calculate hourly averages from records
 * Groups data by hour of day and calculates mean values
 */
function calculateHourlyAverages(records) {
    if (!records || records.length === 0) {
        return null;
    }

    const hourlyBuckets = Array.from({ length: 24 }, () => ({
        soc: [],
        voltage: [],
        current: [],
        power: [],
        temperature: []
    }));

    // Group records by hour
    for (const record of records) {
        if (!record.timestamp || !record.analysis) continue;
        
        const hour = new Date(record.timestamp).getHours();
        const analysis = record.analysis;

        if (analysis.stateOfCharge != null) hourlyBuckets[hour].soc.push(analysis.stateOfCharge);
        if (analysis.voltage != null) hourlyBuckets[hour].voltage.push(analysis.voltage);
        if (analysis.current != null) hourlyBuckets[hour].current.push(analysis.current);
        if (analysis.power != null) hourlyBuckets[hour].power.push(analysis.power);
        if (analysis.temperature != null) hourlyBuckets[hour].temperature.push(analysis.temperature);
    }

    // Calculate averages for each hour
    const averages = hourlyBuckets.map((bucket, hour) => {
        const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        
        return {
            hour,
            avgSOC: avg(bucket.soc),
            avgVoltage: avg(bucket.voltage),
            avgCurrent: avg(bucket.current),
            avgPower: avg(bucket.power),
            avgTemperature: avg(bucket.temperature),
            sampleCount: Math.max(
                bucket.soc.length,
                bucket.voltage.length,
                bucket.current.length,
                bucket.power.length,
                bucket.temperature.length
            )
        };
    });

    return averages;
}

/**
 * Calculate performance baseline (median values from recent data)
 * Used as reference point for detecting anomalies
 */
function calculatePerformanceBaseline(records) {
    if (!records || records.length === 0) {
        return null;
    }

    const values = {
        soc: [],
        voltage: [],
        current: [],
        power: [],
        temperature: []
    };

    // Collect all values
    for (const record of records) {
        if (!record.analysis) continue;
        
        const analysis = record.analysis;
        if (analysis.stateOfCharge != null) values.soc.push(analysis.stateOfCharge);
        if (analysis.voltage != null) values.voltage.push(analysis.voltage);
        if (analysis.current != null) values.current.push(Math.abs(analysis.current));
        if (analysis.power != null) values.power.push(Math.abs(analysis.power));
        if (analysis.temperature != null) values.temperature.push(analysis.temperature);
    }

    // Calculate median for each metric
    const median = (arr) => {
        if (arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
    };

    return {
        medianSOC: median(values.soc),
        medianVoltage: median(values.voltage),
        medianCurrent: median(values.current),
        medianPower: median(values.power),
        medianTemperature: median(values.temperature),
        sampleCount: records.length,
        note: 'Baseline calculated from median values to be robust against outliers'
    };
}

/**
 * Get system analytics with intelligent alert event grouping
 */
async function getSystemAnalytics(params, log) {
    const { systemId, lookbackDays = 60 } = params;

    if (!systemId) {
        throw new Error('systemId is required');
    }

    log.info('System analytics requested', { systemId, lookbackDays });

    try {
        const collection = await getCollection('history');
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - lookbackDays);

        // Fetch records for alert analysis with limit to prevent timeout
        const MAX_RECORDS = 1000; // Limit to prevent timeout on huge datasets
        const records = await collection
            .find({
                systemId,
                timestamp: { $gte: startDate.toISOString() }
            }, {
                projection: {
                    _id: 0,
                    timestamp: 1,
                    'analysis.alerts': 1,
                    'analysis.stateOfCharge': 1,
                    'analysis.voltage': 1,
                    'analysis.current': 1,
                    'analysis.power': 1,
                    'analysis.temperature': 1
                }
            })
            .sort({ timestamp: -1 }) // Most recent first
            .limit(MAX_RECORDS)
            .toArray();

        log.debug('Fetched records for analytics', { count: records.length, limit: MAX_RECORDS });

        // Reverse to chronological order for event grouping
        records.reverse();

        // Transform to snapshots format for alert grouping
        const snapshots = records.map(r => ({
            timestamp: r.timestamp,
            alerts: r.analysis?.alerts || [],
            soc: r.analysis?.stateOfCharge
        }));

        // Use new groupAlertEvents function
        const { groupAlertEvents } = require('./analysis-utilities.cjs');
        const alertAnalysis = groupAlertEvents(snapshots);

        // Calculate total occurrences across all events
        const totalAlerts = alertAnalysis.totalAlertOccurrences;

        // Format for compatibility with existing code
        const alertCounts = alertAnalysis.summary.map(group => ({
            alert: group.alert,
            count: group.eventCount, // Number of EVENTS, not occurrences
            occurrences: group.totalOccurrences, // Total screenshot count
            avgDurationHours: group.avgDurationHours,
            avgSOC: group.avgSOC
        }));

        // Calculate hourly averages
        const hourlyAverages = calculateHourlyAverages(records);
        
        // Calculate performance baseline (median values from recent data)
        const performanceBaseline = calculatePerformanceBaseline(records);

        return {
            systemId,
            lookbackDays,
            recordCount: records.length,
            wasLimited: records.length >= MAX_RECORDS,
            hourlyAverages,
            performanceBaseline,
            alertAnalysis: {
                totalAlerts,
                totalEvents: alertAnalysis.totalEvents,
                alertCounts,
                events: alertAnalysis.events.slice(-20), // Last 20 events for detail
                note: `Grouped ${totalAlerts} alert occurrences into ${alertAnalysis.totalEvents} distinct events using intelligent time-based consolidation`
            }
        };
    } catch (error) {
        log.error('Failed to get system analytics', {
            systemId,
            error: error.message,
            stack: error.stack
        });

        return {
            error: true,
            systemId,
            message: `Analytics failed: ${error.message}`
        };
    }
}

/**
 * Predict battery trends using forecasting models (placeholder)
 */
async function predictBatteryTrends(params, log) {
    const { systemId, metric, forecastDays = 30, confidenceLevel = true } = params;

    if (!systemId || !metric) {
        throw new Error('systemId and metric are required');
    }

    log.info('Battery trend prediction requested', { systemId, metric, forecastDays });

    // Placeholder return
    return {
        systemId,
        metric,
        forecastDays,
        prediction: null,
        confidence: null,
        note: 'Forecasting module integration pending'
    };
}

/**
 * Analyze usage patterns (placeholder)
 */
async function analyzeUsagePatterns(params, log) {
    const { systemId, patternType = 'daily', timeRange = '30d' } = params;

    if (!systemId) {
        throw new Error('systemId is required');
    }

    log.info('Usage pattern analysis requested', { systemId, patternType, timeRange });

    // Placeholder return
    return {
        systemId,
        patternType,
        timeRange,
        patterns: null,
        note: 'Pattern analysis integration pending'
    };
}

/**
 * Calculate energy budget for scenarios (placeholder)
 */
async function calculateEnergyBudget(params, log) {
    const { systemId, scenario, includeWeather = true, timeframe = '30d' } = params;

    if (!systemId || !scenario) {
        throw new Error('systemId and scenario are required');
    }

    log.info('Energy budget calculation requested', { systemId, scenario, timeframe });

    // Placeholder return
    return {
        systemId,
        scenario,
        timeframe,
        budget: null,
        note: 'Energy budget calculation integration pending'
    };
}

module.exports = {
    executeToolCall,
    requestBmsData,
    getSystemHistory
};
