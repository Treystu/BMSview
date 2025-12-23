/**
 * Weather Batch Backfill Utility
 * 
 * Intelligently fills weather data gaps using minimal API calls.
 * OpenWeather's timemachine API returns 24 hours per call, so
 * filling N days requires only N API calls, not N*24.
 */

const { getCollection } = require('./mongodb.cjs');
const { fetchHourlyWeather } = require('./weather-fetcher.cjs');

/**
 * Get the last weather record timestamp for a system
 * @param {string} systemId - System ID
 * @param {Function} log - Logger
 * @returns {Promise<Date|null>} Last weather record date or null
 */
async function getLastWeatherRecordDate(systemId, log) {
    try {
        const hourlyWeatherCollection = await getCollection('hourly-weather');

        const lastRecord = await hourlyWeatherCollection
            .find({ systemId })
            .sort({ date: -1 })
            .limit(1)
            .toArray();

        if (lastRecord.length > 0 && lastRecord[0].date) {
            const date = new Date(lastRecord[0].date + 'T23:59:59Z');
            log.debug('Found last weather record', { systemId, lastDate: lastRecord[0].date });
            return date;
        }

        log.debug('No existing weather records found', { systemId });
        return null;
    } catch (error) {
        log.error('Error getting last weather record date', { systemId, error: error.message });
        return null;
    }
}

/**
 * Get unique dates from analysis records that need weather data
 * @param {string} systemId - System ID
 * @param {Date|null} sinceDate - Only get dates after this
 * @param {Function} log - Logger
 * @returns {Promise<string[]>} Array of date strings (YYYY-MM-DD)
 */
async function getAnalysisDatesMissingWeather(systemId, sinceDate, log) {
    try {
        const historyCollection = await getCollection('history');
        const hourlyWeatherCollection = await getCollection('hourly-weather');

        // Get all unique dates from analysis records
        const query = {
            systemId,
            timestamp: { $exists: true, $ne: null }
        };

        if (sinceDate) {
            query.timestamp = { $gt: sinceDate.toISOString() };
        }

        const analysisDates = await historyCollection.aggregate([
            { $match: query },
            {
                $project: {
                    date: { $substr: ['$timestamp', 0, 10] } // Extract YYYY-MM-DD
                }
            },
            { $group: { _id: '$date' } },
            { $sort: { _id: 1 } }
        ]).toArray();

        const allDates = analysisDates.map(d => d._id);

        if (allDates.length === 0) {
            log.debug('No analysis dates found', { systemId, sinceDate: sinceDate?.toISOString() });
            return [];
        }

        // Get dates that already have weather data
        const existingWeather = await hourlyWeatherCollection
            .find({ systemId, date: { $in: allDates } }, { projection: { date: 1 } })
            .toArray();

        const existingDates = new Set(existingWeather.map(w => w.date));

        // Return only dates missing weather
        const missingDates = allDates.filter(d => !existingDates.has(d));

        log.info('Identified dates needing weather backfill', {
            systemId,
            totalDates: allDates.length,
            existingDates: existingDates.size,
            missingDates: missingDates.length
        });

        return missingDates;
    } catch (error) {
        log.error('Error getting analysis dates', { systemId, error: error.message });
        return [];
    }
}

/**
 * Backfill weather data gaps for a system
 * Called once at the end of a batch analysis to fill missing hours
 * 
 * @param {string} systemId - System ID to backfill
 * @param {number} lat - System latitude
 * @param {number} lon - System longitude
 * @param {Function} log - Logger instance
 * @returns {Promise<{datesBackfilled: number, apiCalls: number, hoursStored: number, errors: number}>}
 */
async function backfillWeatherGaps(systemId, lat, lon, log) {
    const result = {
        datesBackfilled: 0,
        apiCalls: 0,
        hoursStored: 0,
        errors: 0
    };

    if (!systemId || lat === undefined || lon === undefined) {
        log.warn('Missing required parameters for weather backfill', { systemId, lat, lon });
        return result;
    }

    try {
        const hourlyWeatherCollection = await getCollection('hourly-weather');

        // Get dates that need backfill (analysis records without weather)
        const lastWeatherDate = await getLastWeatherRecordDate(systemId, log);
        const missingDates = await getAnalysisDatesMissingWeather(systemId, lastWeatherDate, log);

        if (missingDates.length === 0) {
            log.info('No weather gaps to backfill', { systemId });
            return result;
        }

        // Limit to reasonable batch size to avoid timeout
        const MAX_DATES_PER_RUN = 10;
        const datesToProcess = missingDates.slice(0, MAX_DATES_PER_RUN);

        log.info('Starting weather gap backfill', {
            systemId,
            totalMissing: missingDates.length,
            processing: datesToProcess.length
        });

        for (const dateStr of datesToProcess) {
            try {
                // Fetch 24 hours of weather in ONE API call
                const hourlyData = await fetchHourlyWeather(lat, lon, dateStr, log);
                result.apiCalls++;

                if (!hourlyData || hourlyData.length === 0) {
                    log.warn('No hourly data returned', { systemId, date: dateStr });
                    result.errors++;
                    continue;
                }

                // Process and store the hourly data
                const processedHourlyData = hourlyData.map(hour => {
                    const hourTimestamp = new Date(hour.dt * 1000);
                    return {
                        hour: hourTimestamp.getUTCHours(),
                        timestamp: hourTimestamp.toISOString(),
                        clouds: hour.clouds,
                        temp: hour.temp,
                        uvi: hour.uvi || null,
                        weather_main: hour.weather?.[0]?.main || 'Unknown',
                        estimated_irradiance_w_m2: hour.uvi ? hour.uvi * 25 : null
                    };
                });

                // Store to hourly-weather collection
                const record = {
                    systemId,
                    date: dateStr,
                    latitude: lat,
                    longitude: lon,
                    hourlyData: processedHourlyData,
                    createdAt: new Date().toISOString(),
                    source: 'batch-backfill'
                };

                await hourlyWeatherCollection.insertOne(record);
                result.datesBackfilled++;
                result.hoursStored += processedHourlyData.length;

                log.debug('Stored weather for date', {
                    systemId,
                    date: dateStr,
                    hours: processedHourlyData.length
                });

                // Small delay to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (dateError) {
                log.error('Error processing date', {
                    systemId,
                    date: dateStr,
                    error: dateError.message
                });
                result.errors++;
            }
        }

        log.info('Weather gap backfill complete', { systemId, ...result });
        return result;

    } catch (error) {
        log.error('Weather backfill failed', { systemId, error: error.message });
        return result;
    }
}

/**
 * Get cached weather data for a specific hour
 * @param {string} systemId - System ID
 * @param {string} timestamp - ISO timestamp
 * @param {Function} log - Logger
 * @returns {Promise<Object|null>} Cached weather data or null
 */
async function getCachedWeatherForHour(systemId, timestamp, log) {
    try {
        if (!systemId || !timestamp) {
            return null;
        }

        const date = timestamp.substring(0, 10); // YYYY-MM-DD
        const targetDate = new Date(timestamp);
        const targetHour = targetDate.getUTCHours();

        const hourlyWeatherCollection = await getCollection('hourly-weather');

        const record = await hourlyWeatherCollection.findOne({
            systemId,
            date
        });

        if (!record || !record.hourlyData) {
            return null;
        }

        // Find the matching hour
        const hourData = record.hourlyData.find(h => h.hour === targetHour);

        if (hourData) {
            log.debug('Cache hit for weather', { systemId, date, hour: targetHour });
            return {
                temp: hourData.temp,
                clouds: hourData.clouds,
                uvi: hourData.uvi,
                weather_main: hourData.weather_main,
                cached: true
            };
        }

        return null;
    } catch (error) {
        log.error('Error checking weather cache', { systemId, timestamp, error: error.message });
        return null;
    }
}

module.exports = {
    backfillWeatherGaps,
    getCachedWeatherForHour,
    getLastWeatherRecordDate,
    getAnalysisDatesMissingWeather
};
