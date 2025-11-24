const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}
const { ObjectId } = require('mongodb'); // Needed for BulkWrite operations
const { fetchHistoricalWeather, fetchHourlyWeather, getDaylightHours } = require("./utils/weather-fetcher.cjs");
const { mergeBmsAndCloudData, downsampleMergedData } = require('./utils/data-merge.cjs');

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});


exports.handler = async function(event, context) {
    const log = createLogger('history', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, queryStringParameters, body } = event;
    const logContext = { clientIp, httpMethod };
    log('debug', 'Function invoked.', { ...logContext, queryStringParameters, headers: event.headers });

    try {
        const historyCollection = await getCollection("history");
        const systemsCollection = await getCollection("systems");

        // --- GET Request Handler ---
        if (httpMethod === 'GET') {
            const { id, systemId, all, page = '1', limit = '25', merged, startDate, endDate, downsample } = queryStringParameters || {};

            if (id) {
                // Fetch single record by ID
                const record = await historyCollection.findOne({ id }, { projection: { _id: 0 } });
                return record ? respond(200, record) : respond(404, { error: "Record not found." });
            }

            // Merged timeline data (BMS + Cloud)
            if (merged === 'true' && systemId && startDate && endDate) {
                log('info', 'Fetching merged timeline data.', { ...logContext, systemId, startDate, endDate });
                
                try {
                    let mergedData = await mergeBmsAndCloudData(systemId, startDate, endDate, log);
                    
                    // Apply downsampling if requested
                    if (downsample === 'true') {
                        const maxPoints = parseInt(queryStringParameters.maxPoints) || 2000;
                        mergedData = downsampleMergedData(mergedData, maxPoints, log);
                    }
                    
                    return respond(200, {
                        systemId,
                        startDate,
                        endDate,
                        totalPoints: mergedData.length,
                        downsampled: downsample === 'true',
                        data: mergedData
                    });
                } catch (err) {
                    log('error', 'Failed to merge timeline data.', { error: err.message, stack: err.stack });
                    return respond(500, { error: 'Failed to merge timeline data: ' + err.message });
                }
            }

            if (systemId) {
                // Fetch all history for a specific system (used for charting)
                log('info', 'Fetching full history for a single system.', { ...logContext, systemId });
                const historyForSystem = await historyCollection.find({ systemId }, { projection: { _id: 0 } }).sort({ timestamp: 1 }).toArray();
                return respond(200, historyForSystem);
            }

            if (all === 'true') {
                 // Fetch ALL history records (used for cache building, potentially large)
                 log('info', 'Fetching ALL history records.', { ...logContext });
                 const allHistory = await historyCollection.find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).toArray();
                 return respond(200, allHistory);
            }

            // Fetch paginated history (default)
            log('debug', 'Fetching paginated history.', { ...logContext, page, limit });
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            const skip = (pageNum - 1) * limitNum;

            const [history, totalItems] = await Promise.all([
                historyCollection.find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).skip(skip).limit(limitNum).toArray(),
                historyCollection.countDocuments({})
            ]);

            log('info', `Returning page ${pageNum} of history.`, { ...logContext, returned: history.length, total: totalItems });
            return respond(200, { items: history, totalItems });
        }

        // --- POST Request Handler ---
        if (httpMethod === 'POST') {
            const parsedBody = JSON.parse(body);
            log('debug', 'Parsed POST body.', { ...logContext, bodyPreview: JSON.stringify(parsedBody).substring(0, 100) });
            const { action } = parsedBody;
            const postLogContext = { ...logContext, action };
            log('info', 'Processing POST request.', postLogContext);

            // --- Batch Delete Action ---
            if (action === 'deleteBatch') {
                const { recordIds } = parsedBody;
                if (!recordIds || !Array.isArray(recordIds)) return respond(400, { error: 'recordIds array is required.' });
                log('warn', 'Deleting batch of history records.', { ...postLogContext, count: recordIds.length });
                const { deletedCount } = await historyCollection.deleteMany({ id: { $in: recordIds } });
                return respond(200, { success: true, deletedCount });
            }

            // --- Fix Power Signs Action ---
            if (action === 'fix-power-signs') {
                log('info', 'Starting fix-power-signs task.', postLogContext);
                const filter = {
                    'analysis.current': { $lt: 0 }, // Current is negative (discharge)
                    'analysis.power': { $gt: 0 }    // Power is positive (incorrect)
                };
                const updatePipeline = [
                    { $set: { 'analysis.power': { $multiply: ['$analysis.power', -1] } } }
                ];
                const { modifiedCount } = await historyCollection.updateMany(filter, updatePipeline);
                log('info', 'Fix-power-signs task complete.', { ...postLogContext, updatedCount: modifiedCount });
                return respond(200, { success: true, updatedCount: modifiedCount });
            }

            // --- Auto-Associate Action ---
            if (action === 'auto-associate') {
                log('info', 'Starting auto-association task.', postLogContext);
                const systems = await systemsCollection.find({}, { projection: { _id: 0, id: 1, name: 1, associatedDLs: 1 } }).toArray();
                const dlMap = new Map(); // Map DL number -> array of system IDs
                systems.forEach(s => {
                    (s.associatedDLs || []).forEach(dl => {
                        if (dl) { // Ensure dl is not null or empty
                            if (!dlMap.has(dl)) dlMap.set(dl, []);
                            dlMap.get(dl).push({ id: s.id, name: s.name });
                        }
                    });
                });

                const unlinkedCursor = historyCollection.find({ systemId: null, dlNumber: { $exists: true, $ne: null, $ne: '' } });
                let associatedCount = 0;
                const bulkOps = [];

                for await (const record of unlinkedCursor) {
                    const potentialSystems = dlMap.get(record.dlNumber);
                    // Only associate if exactly one system matches the DL number
                    if (potentialSystems && potentialSystems.length === 1) {
                        const system = potentialSystems[0];
                        bulkOps.push({
                            updateOne: {
                                filter: { _id: record._id }, // Use _id for bulk ops
                                update: { $set: { systemId: system.id, systemName: system.name } }
                            }
                        });
                        associatedCount++;
                        if (bulkOps.length >= 500) { // Process in batches
                            await historyCollection.bulkWrite(bulkOps, { ordered: false });
                            bulkOps.length = 0; // Clear the array
                            log('debug', 'Processed auto-associate batch.', { ...postLogContext, count: 500 });
                        }
                    }
                }

                if (bulkOps.length > 0) {
                    await historyCollection.bulkWrite(bulkOps, { ordered: false });
                }
                log('info', 'Auto-association task complete.', { ...postLogContext, associatedCount });
                return respond(200, { success: true, associatedCount });
            }

            // --- Cleanup Links Action ---
            if (action === 'cleanup-links') {
                log('info', 'Starting cleanup-links task.', postLogContext);
                const allSystemIds = new Set(await systemsCollection.distinct('id'));
                const linkedCursor = historyCollection.find({ systemId: { $exists: true, $ne: null } });
                let updatedCount = 0;
                const bulkOps = [];

                for await (const record of linkedCursor) {
                    if (!allSystemIds.has(record.systemId)) {
                        bulkOps.push({
                            updateOne: {
                                filter: { _id: record._id },
                                update: { $set: { systemId: null, systemName: null } }
                            }
                        });
                        updatedCount++;
                         if (bulkOps.length >= 500) {
                            await historyCollection.bulkWrite(bulkOps, { ordered: false });
                            bulkOps.length = 0;
                            log('debug', 'Processed cleanup-links batch.', { ...postLogContext, count: 500 });
                        }
                    }
                }
                 if (bulkOps.length > 0) {
                    await historyCollection.bulkWrite(bulkOps, { ordered: false });
                }
                log('info', 'Cleanup-links task complete.', { ...postLogContext, updatedCount });
                return respond(200, { success: true, updatedCount });
            }

            if (action === 'count-records-needing-weather') {
                log('info', 'Counting records needing weather backfill.', postLogContext);
                const count = await historyCollection.countDocuments({ systemId: { $ne: null }, $or: [{ weather: null }, { 'weather.clouds': { $exists: false } }] });
                return respond(200, { count });
            }

            // --- Backfill Weather Action ---
             if (action === 'backfill-weather') {
                log('info', 'Starting backfill-weather task.', postLogContext);
                
                const maxRecords = parseInt(parsedBody.maxRecords) || 50; // Default to 50 records per run
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 20000; // 20 seconds (leave 6 seconds buffer)
                
                const systemsWithLocation = await systemsCollection.find({ latitude: { $ne: null }, longitude: { $ne: null } }).toArray();
                const systemLocationMap = new Map(systemsWithLocation.map(s => [s.id, { lat: s.latitude, lon: s.longitude }]));

                const recordsNeedingWeatherCursor = historyCollection.find({ 
                    systemId: { $ne: null }, 
                    $or: [{ weather: null }, { 'weather.clouds': { $exists: false } }] 
                }).limit(maxRecords); // Limit number of records to process
                
                let updatedCount = 0;
                let errorCount = 0;
                let processedCount = 0;
                const bulkOps = [];
                const BATCH_SIZE = 25; // Smaller batch for safer processing
                const THROTTLE_DELAY_MS = 200; // Reduced delay for faster processing
                const RETRY_DELAY_MS = 500; // Reduced delay after error
                let timeoutReached = false;

                for await (const record of recordsNeedingWeatherCursor) {
                    // Check if we're approaching timeout
                    const elapsedTime = Date.now() - startTime;
                    if (elapsedTime > MAX_EXECUTION_TIME) {
                        log('warn', 'Approaching timeout limit, stopping early.', {
                            ...postLogContext,
                            elapsedTime,
                            processedCount,
                            updatedCount
                        });
                        timeoutReached = true;
                        break;
                    }
                    
                    processedCount++;
                    log('debug', `Processing weather backfill for record: ${record.id}`, { processedCount, maxRecords });
                    const location = systemLocationMap.get(record.systemId);
                    if (location && record.timestamp) {
                        try {
                            const weatherData = await fetchHistoricalWeather(location.lat, location.lon, record.timestamp, log);
                            if (weatherData) {
                                bulkOps.push({
                                    updateOne: {
                                        filter: { _id: record._id },
                                        update: { $set: { weather: weatherData } }
                                    }
                                });
                                updatedCount++;
                            }
                        } catch (weatherError) {
                            errorCount++;
                            log('warn', 'Failed to fetch weather during backfill.', { recordId: record.id, error: weatherError.message });
                            // Add delay after error to avoid rate limiting
                            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        }

                        if (bulkOps.length >= BATCH_SIZE) {
                            try {
                                const result = await historyCollection.bulkWrite(bulkOps, { ordered: false });
                                log('info', 'Processed backfill-weather batch.', { 
                                    ...postLogContext, 
                                    batchSize: bulkOps.length, 
                                    modified: result.modifiedCount,
                                    totalProcessed: updatedCount 
                                });
                            } catch (e) {
                                log('error', 'Error during bulkWrite.', { error: e.message, batchSize: bulkOps.length });
                            }
                            bulkOps.length = 0;
                            // Throttle to avoid hitting rate limits
                            await new Promise(resolve => setTimeout(resolve, THROTTLE_DELAY_MS));
                        }
                    }
                }
                
                if (bulkOps.length > 0) {
                    try {
                        const result = await historyCollection.bulkWrite(bulkOps, { ordered: false });
                        log('info', 'Processed final backfill-weather batch.', { 
                            ...postLogContext, 
                            batchSize: bulkOps.length,
                            modified: result.modifiedCount 
                        });
                    } catch (e) {
                        log('error', 'Error during final bulkWrite.', { error: e.message, batchSize: bulkOps.length });
                    }
                }
                
                const completed = !timeoutReached && processedCount < maxRecords;
                const message = completed 
                    ? 'Weather backfill completed successfully.'
                    : `Processed ${processedCount} records before ${timeoutReached ? 'timeout' : 'limit'}. Run again to continue.`;
                
                log('info', 'Backfill-weather task finished.', { 
                    ...postLogContext, 
                    updatedCount, 
                    errorCount,
                    processedCount,
                    completed,
                    message
                });
                
                return respond(200, { 
                    success: true, 
                    updatedCount, 
                    errorCount,
                    processedCount,
                    completed,
                    message
                });
            }

            // --- Hourly Cloud Backfill Action ---
            if (action === 'hourly-cloud-backfill') {
                log('info', 'Starting hourly-cloud-backfill task.', postLogContext);
                
                // Get maxDays parameter (default to 10 days per run to avoid timeout)
                const maxDaysPerRun = parseInt(parsedBody.maxDays) || 10;
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 20000; // 20 seconds (leave 6 seconds buffer for Netlify's 26s limit)
                
                // Get systems with location data
                const systemsWithLocation = await systemsCollection.find({ 
                    latitude: { $ne: null }, 
                    longitude: { $ne: null } 
                }).toArray();
                
                if (systemsWithLocation.length === 0) {
                    log('warn', 'No systems with location data found.', postLogContext);
                    return respond(200, { 
                        success: true, 
                        message: 'No systems with location data.', 
                        processedDays: 0,
                        completed: true
                    });
                }
                
                const hourlyWeatherCollection = await getCollection("hourly-weather");
                let totalProcessedDays = 0;
                let totalHoursInserted = 0;
                let totalErrors = 0;
                let timeoutReached = false;
                
                // Process each system
                systemLoop: for (const system of systemsWithLocation) {
                    const systemLogContext = { 
                        ...postLogContext, 
                        systemId: system.id, 
                        systemName: system.name 
                    };
                    log('info', 'Processing hourly cloud backfill for system.', systemLogContext);
                    
                    // Get min and max dates for this system's analysis records
                    const dateRange = await historyCollection.aggregate([
                        { $match: { systemId: system.id, timestamp: { $exists: true, $ne: null } } },
                        { 
                            $group: {
                                _id: null,
                                minDate: { $min: '$timestamp' },
                                maxDate: { $max: '$timestamp' }
                            }
                        }
                    ]).toArray();
                    
                    if (dateRange.length === 0 || !dateRange[0].minDate) {
                        log('info', 'No analysis records with timestamps for system, skipping.', systemLogContext);
                        continue;
                    }
                    
                    const minDate = new Date(dateRange[0].minDate);
                    const maxDate = new Date(dateRange[0].maxDate);
                    log('info', 'Date range for system.', { 
                        ...systemLogContext, 
                        minDate: minDate.toISOString(), 
                        maxDate: maxDate.toISOString() 
                    });
                    
                    // Iterate through each date in the range
                    const currentDate = new Date(minDate);
                    currentDate.setHours(0, 0, 0, 0); // Start at beginning of day
                    
                    while (currentDate <= maxDate) {
                        // Check if we're approaching timeout
                        const elapsedTime = Date.now() - startTime;
                        if (elapsedTime > MAX_EXECUTION_TIME) {
                            log('warn', 'Approaching timeout limit, stopping early.', {
                                ...postLogContext,
                                elapsedTime,
                                processedDays: totalProcessedDays,
                                maxDaysPerRun
                            });
                            timeoutReached = true;
                            break systemLoop;
                        }
                        
                        // Check if we've hit the max days limit for this run
                        if (totalProcessedDays >= maxDaysPerRun) {
                            log('info', 'Reached max days limit for this run.', {
                                ...postLogContext,
                                processedDays: totalProcessedDays,
                                maxDaysPerRun
                            });
                            timeoutReached = true;
                            break systemLoop;
                        }
                        
                        const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
                        const dateLogContext = { ...systemLogContext, date: dateStr };
                        
                        // Check if we already have hourly data for this date/system
                        const existingRecord = await hourlyWeatherCollection.findOne({
                            systemId: system.id,
                            date: dateStr
                        });
                        
                        if (existingRecord) {
                            log('debug', 'Hourly weather data already exists for date, skipping.', dateLogContext);
                            currentDate.setDate(currentDate.getDate() + 1);
                            continue;
                        }
                        
                        try {
                            // Get daylight hours for this date/location
                            const daylightHours = getDaylightHours(system.latitude, system.longitude, currentDate);
                            
                            if (daylightHours.length === 0) {
                                log('debug', 'No daylight hours for date (polar night?), skipping.', dateLogContext);
                                currentDate.setDate(currentDate.getDate() + 1);
                                continue;
                            }
                            
                            // Fetch hourly weather data for the day
                            const hourlyData = await fetchHourlyWeather(
                                system.latitude, 
                                system.longitude, 
                                dateStr, 
                                log
                            );
                            
                            if (!hourlyData || hourlyData.length === 0) {
                                log('warn', 'No hourly weather data returned.', dateLogContext);
                                totalErrors++;
                                currentDate.setDate(currentDate.getDate() + 1);
                                await new Promise(resolve => setTimeout(resolve, 200)); // Small delay
                                continue;
                            }
                            
                            // Filter to daylight hours and extract relevant data
                            const daylightHourSet = new Set(daylightHours);
                            const processedHourlyData = hourlyData
                                .map(hour => {
                                    const hourTimestamp = new Date(hour.dt * 1000);
                                    return {
                                        hour: hourTimestamp.getHours(),
                                        timestamp: hourTimestamp.toISOString(),
                                        clouds: hour.clouds,
                                        temp: hour.temp,
                                        uvi: hour.uvi || null,
                                        weather_main: hour.weather?.[0]?.main || 'Unknown',
                                        // Include solar irradiance if available from the API
                                        // Note: OpenWeather doesn't provide direct irradiance, but we can estimate from UVI
                                        estimated_irradiance_w_m2: hour.uvi ? hour.uvi * 25 : null // Rough estimate
                                    };
                                })
                                .filter(hour => daylightHourSet.has(hour.hour));
                            
                            // Store the hourly data
                            const recordToInsert = {
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                latitude: system.latitude,
                                longitude: system.longitude,
                                daylightHours: daylightHours,
                                hourlyData: processedHourlyData,
                                createdAt: new Date().toISOString()
                            };
                            
                            await hourlyWeatherCollection.insertOne(recordToInsert);
                            totalHoursInserted += processedHourlyData.length;
                            totalProcessedDays++;
                            
                            log('info', 'Stored hourly weather data for date.', {
                                ...dateLogContext,
                                hoursStored: processedHourlyData.length,
                                daylightHoursCount: daylightHours.length
                            });
                            
                            // Reduced throttle delay for faster processing (still respects API limits)
                            await new Promise(resolve => setTimeout(resolve, 200));
                            
                        } catch (error) {
                            totalErrors++;
                            log('error', 'Error processing hourly weather for date.', {
                                ...dateLogContext,
                                error: error.message,
                                stack: error.stack
                            });
                            await new Promise(resolve => setTimeout(resolve, 500)); // Delay after error
                        }
                        
                        // Move to next day
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
                
                const completed = !timeoutReached;
                const message = completed 
                    ? 'Hourly cloud backfill completed successfully.'
                    : `Processed ${totalProcessedDays} days before timeout. Run again to continue.`;
                
                log('info', 'Hourly cloud backfill task finished.', { 
                    ...postLogContext, 
                    totalProcessedDays, 
                    totalHoursInserted,
                    totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                });
                
                return respond(200, { 
                    success: true, 
                    processedDays: totalProcessedDays,
                    hoursInserted: totalHoursInserted,
                    errors: totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                });
            }

            // --- Hourly Solar Irradiance Backfill Action ---
            if (action === 'hourly-solar-irradiance-backfill') {
                log('info', 'Starting hourly-solar-irradiance-backfill task.', postLogContext);
                
                const { calculateSolarIrradiance } = require('./utils/solar-irradiance.cjs');
                
                // Get maxDays parameter (default to 10 days per run to avoid timeout)
                const maxDaysPerRun = parseInt(parsedBody.maxDays) || 10;
                const startTime = Date.now();
                const MAX_EXECUTION_TIME = 20000; // 20 seconds
                
                // Get systems with location data
                const systemsWithLocation = await systemsCollection.find({ 
                    latitude: { $ne: null }, 
                    longitude: { $ne: null } 
                }).toArray();
                
                if (systemsWithLocation.length === 0) {
                    log('warn', 'No systems with location data found.', postLogContext);
                    return respond(200, { 
                        success: true, 
                        message: 'No systems with location data.', 
                        processedDays: 0,
                        completed: true
                    });
                }
                
                const hourlyIrradianceCollection = await getCollection("hourly-solar-irradiance");
                const hourlyWeatherCollection = await getCollection("hourly-weather");
                let totalProcessedDays = 0;
                let totalHoursCalculated = 0;
                let totalErrors = 0;
                let timeoutReached = false;
                
                // Process each system
                systemLoop: for (const system of systemsWithLocation) {
                    const systemLogContext = { 
                        ...postLogContext, 
                        systemId: system.id, 
                        systemName: system.name 
                    };
                    log('info', 'Processing hourly solar irradiance backfill for system.', systemLogContext);
                    
                    // Get min and max dates for this system's analysis records
                    const dateRange = await historyCollection.aggregate([
                        { $match: { systemId: system.id, timestamp: { $exists: true, $ne: null } } },
                        { 
                            $group: {
                                _id: null,
                                minDate: { $min: '$timestamp' },
                                maxDate: { $max: '$timestamp' }
                            }
                        }
                    ]).toArray();
                    
                    if (dateRange.length === 0 || !dateRange[0].minDate) {
                        log('info', 'No analysis records with timestamps for system, skipping.', systemLogContext);
                        continue;
                    }
                    
                    const minDate = new Date(dateRange[0].minDate);
                    const maxDate = new Date(dateRange[0].maxDate);
                    log('info', 'Date range for system.', { 
                        ...systemLogContext, 
                        minDate: minDate.toISOString(), 
                        maxDate: maxDate.toISOString() 
                    });
                    
                    // Iterate through each date in the range
                    const currentDate = new Date(minDate);
                    currentDate.setHours(0, 0, 0, 0);
                    
                    while (currentDate <= maxDate) {
                        // Check timeout and limits
                        const elapsedTime = Date.now() - startTime;
                        if (elapsedTime > MAX_EXECUTION_TIME || totalProcessedDays >= maxDaysPerRun) {
                            log('warn', 'Approaching timeout or max days limit, stopping early.', {
                                ...postLogContext,
                                elapsedTime,
                                processedDays: totalProcessedDays,
                                maxDaysPerRun
                            });
                            timeoutReached = true;
                            break systemLoop;
                        }
                        
                        const dateStr = currentDate.toISOString().split('T')[0];
                        const dateLogContext = { ...systemLogContext, date: dateStr };
                        
                        // Check if we already have irradiance data for this date/system
                        const existingRecord = await hourlyIrradianceCollection.findOne({
                            systemId: system.id,
                            date: dateStr
                        });
                        
                        if (existingRecord) {
                            log('debug', 'Hourly irradiance data already exists for date, skipping.', dateLogContext);
                            currentDate.setDate(currentDate.getDate() + 1);
                            continue;
                        }
                        
                        try {
                            // Get cloud data from hourly-weather collection if available
                            const weatherRecord = await hourlyWeatherCollection.findOne({
                                systemId: system.id,
                                date: dateStr
                            });
                            
                            // Calculate solar irradiance for each hour of the day
                            const hourlyIrradianceData = [];
                            
                            for (let hour = 0; hour < 24; hour++) {
                                const hourTimestamp = new Date(currentDate);
                                hourTimestamp.setHours(hour, 0, 0, 0);
                                
                                // Get cloud cover for this hour if available
                                let cloudCover = null;
                                if (weatherRecord && weatherRecord.hourlyData) {
                                    const weatherHour = weatherRecord.hourlyData.find(h => h.hour === hour);
                                    if (weatherHour) {
                                        cloudCover = weatherHour.clouds;
                                    }
                                }
                                
                                // Calculate irradiance with or without cloud data
                                const irradianceData = calculateSolarIrradiance(
                                    hourTimestamp,
                                    system.latitude,
                                    system.longitude,
                                    cloudCover,
                                    system.altitude || 0
                                );
                                
                                // Only store hours when sun is up
                                if (irradianceData.isSunUp) {
                                    hourlyIrradianceData.push({
                                        hour,
                                        timestamp: irradianceData.timestamp,
                                        solarAltitude: irradianceData.solarAltitude,
                                        solarAzimuth: irradianceData.solarPosition.azimuth,
                                        clearSkyGlobalIrradiance: irradianceData.clearSkyIrradiance.global,
                                        clearSkyDirectIrradiance: irradianceData.clearSkyIrradiance.directHorizontal,
                                        clearSkyDiffuseIrradiance: irradianceData.clearSkyIrradiance.diffuse,
                                        actualGlobalIrradiance: irradianceData.actualIrradiance.global,
                                        actualDirectIrradiance: irradianceData.actualIrradiance.directHorizontal,
                                        actualDiffuseIrradiance: irradianceData.actualIrradiance.diffuse,
                                        cloudCoverPercent: cloudCover,
                                        cloudFactor: irradianceData.actualIrradiance.cloudFactor,
                                        airMass: irradianceData.clearSkyIrradiance.airMass
                                    });
                                }
                            }
                            
                            if (hourlyIrradianceData.length === 0) {
                                log('debug', 'No daylight hours for date (polar night?), skipping.', dateLogContext);
                                currentDate.setDate(currentDate.getDate() + 1);
                                continue;
                            }
                            
                            // Store the hourly irradiance data
                            const recordToInsert = {
                                systemId: system.id,
                                systemName: system.name,
                                date: dateStr,
                                latitude: system.latitude,
                                longitude: system.longitude,
                                altitude: system.altitude || 0,
                                hourlyIrradianceData,
                                hasCloudData: weatherRecord !== null,
                                createdAt: new Date().toISOString()
                            };
                            
                            await hourlyIrradianceCollection.insertOne(recordToInsert);
                            totalHoursCalculated += hourlyIrradianceData.length;
                            totalProcessedDays++;
                            
                            log('info', 'Stored hourly irradiance data for date.', {
                                ...dateLogContext,
                                hoursStored: hourlyIrradianceData.length,
                                hasCloudData: recordToInsert.hasCloudData
                            });
                            
                            // Small delay to avoid overwhelming the system
                            await new Promise(resolve => setTimeout(resolve, 50));
                            
                        } catch (error) {
                            totalErrors++;
                            log('error', 'Error processing hourly irradiance for date.', {
                                ...dateLogContext,
                                error: error.message,
                                stack: error.stack
                            });
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                        
                        // Move to next day
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
                
                const completed = !timeoutReached;
                const message = completed 
                    ? 'Hourly solar irradiance backfill completed successfully.'
                    : `Processed ${totalProcessedDays} days before timeout. Run again to continue.`;
                
                log('info', 'Hourly solar irradiance backfill task finished.', { 
                    ...postLogContext, 
                    totalProcessedDays, 
                    totalHoursCalculated,
                    totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                });
                
                return respond(200, { 
                    success: true, 
                    processedDays: totalProcessedDays,
                    hoursCalculated: totalHoursCalculated,
                    errors: totalErrors,
                    systemsProcessed: systemsWithLocation.length,
                    completed,
                    message
                });
            }


            // --- Default Action: Create New History Record ---
            log('info', 'Creating new history record.', logContext);
            // Basic validation for new record
            if (!parsedBody.analysis || !parsedBody.fileName) {
                return respond(400, { error: "Missing 'analysis' or 'fileName' for new record." });
            }
            const newRecord = {
                _id: new ObjectId(), // Use ObjectId for internal _id
                id: uuidv4(),
                timestamp: parsedBody.timestamp || new Date().toISOString(), // Allow timestamp override or default to now
                systemId: parsedBody.systemId || null,
                systemName: parsedBody.systemName || null,
                analysis: parsedBody.analysis,
                weather: parsedBody.weather || null,
                dlNumber: parsedBody.dlNumber || parsedBody.analysis?.dlNumber || null,
                fileName: parsedBody.fileName,
                // Add analysisKey for potential future duplicate checks on insert
                analysisKey: parsedBody.analysisKey || null, // Assuming analysisKey is generated client-side or during process-analysis
            };
            await historyCollection.insertOne(newRecord);
             // Return record without the internal _id
            const { _id, ...recordToReturn } = newRecord;
            return respond(201, recordToReturn);
        }

        // --- PUT Request Handler (Link Record) ---
        if (httpMethod === 'PUT') {
            const parsedBody = JSON.parse(body);
            log('debug', 'Parsed PUT body.', { ...logContext, bodyPreview: JSON.stringify(parsedBody).substring(0, 100) });
            const { recordId, systemId, dlNumber } = parsedBody;
            if (!recordId || !systemId) return respond(400, { error: "recordId and systemId are required." });

            const system = await systemsCollection.findOne({ id: systemId });
            if (!system) return respond(404, { error: "Target system not found." });

            const updateResult = await historyCollection.updateOne(
                { id: recordId },
                { $set: { systemId, systemName: system.name } }
            );
            if (updateResult.matchedCount === 0) return respond(404, { error: "Record not found." });

            // Ensure DL number is associated with the system
            if (dlNumber && (!system.associatedDLs || !system.associatedDLs.includes(dlNumber))) {
                log('info', 'Adding DL number to system during link.', { ...logContext, recordId, systemId, dlNumber });
                await systemsCollection.updateOne({ id: systemId }, { $addToSet: { associatedDLs: dlNumber } });
            }

            log('info', 'Successfully linked history record to system.', { ...logContext, recordId, systemId });
            return respond(200, { success: true });
        }

        // --- DELETE Request Handler ---
        if (httpMethod === 'DELETE') {
            const { id, unlinked } = queryStringParameters || {};
            const deleteLogContext = { ...logContext, recordId: id, deleteUnlinked: unlinked };

            if (unlinked === 'true') {
                // Delete all records not linked to any system
                log('warn', 'Deleting ALL unlinked history records.', deleteLogContext);
                const { deletedCount } = await historyCollection.deleteMany({ systemId: null });
                log('info', 'Deletion of unlinked records complete.', { ...deleteLogContext, deletedCount });
                return respond(200, { success: true, deletedCount });
            } else if (id) {
                // Delete a single record by ID
                log('warn', 'Deleting single history record.', deleteLogContext);
                const { deletedCount } = await historyCollection.deleteOne({ id });
                if (deletedCount > 0) {
                     log('info', 'Single record deleted successfully.', deleteLogContext);
                     return respond(200, { success: true });
                } else {
                    log('warn', 'Record not found for deletion.', deleteLogContext);
                    return respond(404, { error: 'Record not found.' });
                }
            }
            log('warn', 'Missing parameters for DELETE request.', deleteLogContext);
            return respond(400, { error: "Missing 'id' or 'unlinked=true' parameter for DELETE." });
        }

        // --- Fallback for unsupported methods ---
        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });

    } catch (error) {
        log('error', 'Critical error in history function.', { ...logContext, errorMessage: error.message, stack: error.stack });
        // Distinguish between client errors (like bad JSON) and server errors
        if (error instanceof SyntaxError) {
             return respond(400, { error: "Invalid JSON in request body." });
        }
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};
