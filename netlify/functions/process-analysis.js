const { GoogleGenAI, Type } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");
const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");
const { createRetryWrapper } = require("./utils/retry.js");

const JOBS_STORE_NAME = "bms-jobs";
const HISTORY_STORE_NAME = "bms-history";
const SYSTEMS_STORE_NAME = "bms-systems";
const HISTORY_CACHE_KEY = "_all_history_cache";
const GEMINI_API_TIMEOUT_MS = 45000;

const updateJobStatus = async (jobId, status, log, jobsStore, withRetry, extra = {}) => {
    const logContext = { jobId, newStatus: status, ...extra };
    try {
        log('debug', 'Attempting to update job status.', logContext);
        const job = await withRetry(() => jobsStore.get(jobId, { type: "json" }));
        if (!job) {
            log('warn', 'Tried to update status for a job that does not exist.', logContext);
            return;
        }
        const { image, images, ...jobWithoutImages } = job;
        const updatedJob = { ...jobWithoutImages, status, ...extra };
        await withRetry(() => jobsStore.setJSON(jobId, updatedJob));
        log('info', 'Job status updated successfully.', logContext);
    } catch (e) {
        log('error', 'Failed to update job status in blob store.', { ...logContext, error: e.message });
    }
};

const updateHistoryCache = async (store, log, withRetry, newRecord) => {
    const logContext = { recordId: newRecord.id };
    log('debug', 'Attempting to update history cache.', logContext);
    for (let i = 0; i < 5; i++) { // retry loop for contention
        let cache, metadata;
        try {
            const result = await withRetry(() => store.getWithMetadata(HISTORY_CACHE_KEY, { type: 'json' }));
            cache = result.data || [];
            metadata = result.metadata;
            log('debug', 'History cache fetched.', { ...logContext, etag: metadata?.etag, currentSize: cache.length });
        } catch (e) {
            if (e.status === 404) {
                log('info', 'History cache not found, will create a new one.', logContext);
                cache = [];
                metadata = null;
            } else { throw e; }
        }

        if (!Array.isArray(cache)) cache = [];
        
        const updatedCache = [...cache, newRecord];
        updatedCache.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        try {
            await withRetry(() => store.setJSON(HISTORY_CACHE_KEY, updatedCache, { etag: metadata?.etag }));
            log('info', `History cache updated successfully.`, { ...logContext, newSize: updatedCache.length });
            return;
        } catch (e) {
            if (e.status === 412) { // Etag mismatch
                const delay = 50 * Math.pow(2, i);
                log('warn', `History cache update conflict, retrying in ${delay}ms...`, { ...logContext, attempt: i + 1 });
                await new Promise(res => setTimeout(res, delay));
            } else { throw e; }
        }
    }
    log('error', 'Failed to update history cache after multiple retries.', logContext);
};

const getResponseSchema = () => ({
    type: Type.OBJECT,
    properties: {
        dlNumber: { "type": Type.STRING, "nullable": true, "description": "This is the DL Number." },
        timestampFromImage: { "type": Type.STRING, "nullable": true },
        stateOfCharge: { "type": Type.NUMBER, "nullable": true },
        overallVoltage: { "type": Type.NUMBER, "nullable": true },
        current: { "type": Type.NUMBER, "nullable": true },
        remainingCapacity: { "type": Type.NUMBER, "nullable": true },
        power: { "type": Type.NUMBER, "nullable": true, "description": "Power in Watts. If in kW, convert to W." },
        chargeMosOn: { "type": Type.BOOLEAN, "nullable": true },
        dischargeMosOn: { "type": Type.BOOLEAN, "nullable": true },
        balanceOn: { "type": Type.BOOLEAN, "nullable": true },
        highestCellVoltage: { "type": Type.NUMBER, "nullable": true },
        lowestCellVoltage: { "type": Type.NUMBER, "nullable": true },
        cellVoltageDifference: { "type": Type.NUMBER, "nullable": true },
        averageCellVoltage: { "type": Type.NUMBER, "nullable": true },
        cellVoltages: { "type": Type.ARRAY, "items": { "type": Type.NUMBER } },
        cycleCount: { "type": Type.NUMBER, "nullable": true },
        temperatures: { "type": Type.ARRAY, "items": { "type": Type.NUMBER }, "description": "Array of temperatures from all sensors like T1, T2." },
        mosTemperature: { "type": Type.NUMBER, "nullable": true },
        serialNumber: { "type": Type.STRING, "nullable": true },
        softwareVersion: { "type": Type.STRING, "nullable": true },
        hardwareVersion: { "type": Type.STRING, "nullable": true },
        snCode: { "type": Type.STRING, "nullable": true },
    }
});

const getImageExtractionPrompt = () => `You are a meticulous data extraction AI. Analyze the provided BMS screenshot and extract its data into a JSON object, strictly following these rules:
1.  **JSON Object Output**: Your entire response MUST be a single, valid JSON object.
2.  **Strict Schema Adherence**: Use the provided schema. If a value isn't visible, use \`null\` for single fields or \`[]\` for arrays.
3.  **Data Extraction**:
    -   \`dlNumber\`: Find 'DL Number'.
    -   \`stateOfCharge\`: Extract 'SOC' percentage.
    -   \`overallVoltage\`: Extract 'voltage'.
    -   \`current\`: Extract 'current', preserving negative sign.
    -   \`power\`: Extract Power. If in 'kW', multiply by 1000 for Watts. **IMPORTANT: If the 'current' value is negative, the 'power' value must also be negative.**
    -   \`chargeMosOn\`, \`dischargeMosOn\`, \`balanceOn\`: For each, determine if the corresponding indicator ('Chg MOS', 'Dischg MOS', 'Balance') is on (green, lit) which is \`true\`, or off (grey, unlit) which is \`false\`.
    -   \`temperatures\`: Extract all 'Temp', 'T1', 'T2' values into this array.
    -   \`mosTemperature\`: Extract 'MOS Temp'.
    -   \`cellVoltages\`: ONLY if a numbered list of individual cell voltages exists, populate this array. Otherwise, it MUST be \`[]\`.
4.  **Timestamp Logic (CRITICAL)**:
    -   Find a timestamp within the image itself.
    -   If a full date and time are visible (e.g., "2023-01-01 12:04:00"), extract as "YYYY-MM-DDTHH:MM:SS".
    -   If only time is visible (e.g., "12:04:00"), extract only the time string "12:04:00". Do NOT add a date.
    -   If no timestamp is visible, \`timestampFromImage\` MUST be \`null\`.
5.  **Final Review**: Your entire output must be ONLY the raw JSON object, without any surrounding text, explanations, or markdown formatting like \`\`\`json.`;

const cleanAndParseJson = (text, log) => {
    if (!text) {
        log('error', 'The AI model returned an empty response.');
        throw new Error("The AI model returned an empty response.");
    }
    
    log('debug', 'Raw AI response received.', { length: text.length, responseText: text });
    
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        log('error', 'AI response did not contain a valid JSON object.', { responseText: text });
        throw new Error(`AI response did not contain a valid JSON object. Response: ${text}`);
    }
    
    const jsonString = text.substring(jsonStart, jsonEnd + 1);
    
    try {
        const parsed = JSON.parse(jsonString);
        log('debug', 'Successfully parsed JSON from AI response.', { parsedData: parsed });
        return parsed;
    } catch (e) {
        log('error', 'Failed to parse cleaned JSON string.', { error: e.message, cleanedJsonString: jsonString });
        throw new Error(`Failed to parse JSON from AI response. See logs for details.`);
    }
};

const extractBmsData = async (ai, image, mimeType, log, context, jobId, jobsStore, withRetry) => {
    log('debug', 'Preparing for Gemini API call.');
    const extractionPrompt = getImageExtractionPrompt();
    const responseSchema = getResponseSchema();
    const parts = [{ text: extractionPrompt }, { inlineData: { data: image, mimeType } }];

    const maxRetries = 4;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const attemptLogContext = { attempt, maxRetries, timeout: GEMINI_API_TIMEOUT_MS };
        try {
            log('info', `Sending request to Gemini API.`, attemptLogContext);
            
            const apiCall = ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts },
                config: { responseMimeType: "application/json", responseSchema },
            });

            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Gemini API call timed out after ${GEMINI_API_TIMEOUT_MS}ms`)), GEMINI_API_TIMEOUT_MS)
            );

            const response = await Promise.race([apiCall, timeoutPromise]);
            
            log('info', `Received response from Gemini API.`, attemptLogContext);
            const rawText = response.text;
            return cleanAndParseJson(rawText, log);

        } catch (error) {
            lastError = error;
            const isRateLimitError = error.message && error.message.includes('429');
            const remainingTime = context.getRemainingTimeInMillis();
            log('warn', 'Gemini API call failed.', { ...attemptLogContext, error: error.message, isRateLimitError, remainingTime });

            if (isRateLimitError && attempt < maxRetries) {
                const retryAfterMatch = error.message.match(/Please retry in (\d+\.?\d*)/);
                let delay = (retryAfterMatch && parseFloat(retryAfterMatch[1]) * 1000) || (Math.pow(2, attempt) * 1000 + Math.random() * 1000);
                
                await updateJobStatus(jobId, `Retrying (API throttled)...`, log, jobsStore, withRetry);
                const bufferTime = 5000;
                if (delay > remainingTime - bufferTime) {
                    log('error', `Retry delay is too long for remaining execution time. Job will fail to prevent timeout.`, { delay, remainingTime });
                    throw new Error(`Rate limit backoff time (${(delay/1000).toFixed(1)}s) exceeds remaining function execution time. Aborting.`);
                }

                log('warn', `Gemini API rate limit hit. Retrying in ${delay.toFixed(0)}ms...`, { ...attemptLogContext, delay });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    log('error', `Failed to get a successful response from Gemini API after all retries.`, { lastError: lastError.message });
    throw new Error(`Failed to get a successful response from Gemini API after ${maxRetries} attempts. Last error: ${lastError.message}`);
};

const mapExtractedToAnalysisData = (extracted, log) => {
    if (!extracted || typeof extracted !== 'object') {
        log('error', 'Extracted data is invalid, cannot map to AnalysisData.', { extractedData: extracted });
        return null;
    }
    log('debug', 'Mapping extracted data to analysis schema.', { extractedKeys: Object.keys(extracted) });
    const analysis = {
        ...extracted,
        temperature: extracted.temperatures?.[0] || null,
        numTempSensors: extracted.temperatures?.length || 0,
        alerts: [],
        summary: "No summary provided by this model.",
        status: null,
    };
    if (analysis.current != null) {
        analysis.status = analysis.current > 0.5 ? 'Charging' : (analysis.current < -0.5 ? 'Discharging' : 'Standby');
    }
    if (analysis.current != null && analysis.power != null && analysis.current < 0 && analysis.power > 0) {
        log('warn', 'Correcting positive power sign for negative current.', { originalPower: analysis.power, current: analysis.current });
        analysis.power = -analysis.power;
    }
    log('debug', 'Data mapping complete.', { finalKeys: Object.keys(analysis) });
    return analysis;
};

const fetchWeatherData = async (lat, lon, timestamp, log) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!lat || !lon || !apiKey) {
        log('warn', 'Skipping weather fetch: missing lat, lon, or API key.', { hasLat: !!lat, hasLon: !!lon, hasApiKey: !!apiKey });
        return null;
    }
    const logContext = { lat, lon, timestamp };
    try {
        log('debug', 'Fetching weather data from OpenWeather.', logContext);
        const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
        const [mainResponse, uviResponse] = await Promise.all([
            fetch(`https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`),
            fetch(`https://api.openweathermap.org/data/2.5/uvi/history?lat=${lat}&lon=${lon}&start=${unixTimestamp}&end=${unixTimestamp}&appid=${apiKey}`)
        ]);

        const mainData = await mainResponse.json();
        const uviData = await uviResponse.json();
        const current = mainData.data?.[0];

        if (mainResponse.ok && current) {
            const result = {
                temp: current.temp, clouds: current.clouds, uvi: null,
                weather_main: current.weather[0]?.main || 'Unknown', weather_icon: current.weather[0]?.icon || '',
            };
            if (uviResponse.ok && uviData && Array.isArray(uviData) && uviData.length > 0) {
                result.uvi = uviData[0].value;
            }
            log('info', 'Successfully fetched weather data.', { ...logContext, result });
            return result;
        }
        log('warn', 'Failed to fetch weather data from OpenWeather.', { ...logContext, mainStatus: mainResponse.status, uviStatus: uviResponse.status });
    } catch (e) {
        log('error', 'Error fetching weather.', { ...logContext, errorMessage: e.message });
    }
    return null;
};

const parseTimestamp = (timestampFromImage, fileName, log) => {
    log('debug', 'Parsing timestamp.', { timestampFromImage, fileName });
    if (timestampFromImage && /\d{4}[-/]\d{2}[-/]\d{2}/.test(timestampFromImage)) {
        log('debug', 'Using full timestamp from image.', { timestampFromImage });
        return new Date(timestampFromImage);
    }
    const fromFilename = (fileName || '').match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[T _-]?(\d{2})[:.-]?(\d{2})[:.-]?(\d{2})/);
    if (fromFilename) {
        const [, y, m, d, h, min, s] = fromFilename;
        const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
        if (!isNaN(date.getTime())) {
            log('debug', 'Parsed date from filename.', { dateFromFilename: date.toISOString() });
            if (timestampFromImage && /^\d{1,2}:\d{2}(:\d{2})?$/.test(timestampFromImage.trim())) {
                log('debug', 'Applying time from image to filename date.', { timeFromImage: timestampFromImage });
                const [timeH, timeM, timeS] = timestampFromImage.split(':').map(Number);
                date.setUTCHours(timeH || 0, timeM || 0, timeS || 0, 0);
            }
            return date;
        }
    }
    log('info', 'No valid timestamp found in image or filename, using current time.');
    return new Date();
};

exports.handler = async function(event, context) {
    const log = createLogger('process-analysis', context);
    const withRetry = createRetryWrapper(log);
    log('debug', 'Function invoked.', { stage: 'invocation' });

    let jobId;
    let jobsStore; 

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const body = JSON.parse(event.body);
        jobId = body.jobId;

        if (!jobId) {
            log('error', 'Job ID is missing from invocation payload.', { body: event.body });
            return { statusCode: 400, body: 'Job ID is required.' };
        }

        const logContext = { jobId };
        log('info', 'Background analysis job started.', logContext);
        
        jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
        const historyStore = getConfiguredStore(HISTORY_STORE_NAME, log);
        const systemsStore = getConfiguredStore(SYSTEMS_STORE_NAME, log);

        const job = await withRetry(() => jobsStore.get(jobId, { type: "json" }));
        if (!job) throw new Error(`Job with ID ${jobId} not found.`);
        log('debug', 'Fetched job from blob store.', { ...logContext, fileName: job.fileName });

        await updateJobStatus(jobId, 'Processing', log, jobsStore, withRetry);
        const { image, mimeType, systems, fileName } = job;
        
        await updateJobStatus(jobId, 'Extracting data', log, jobsStore, withRetry);
        const extractedData = await extractBmsData(ai, image, mimeType, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }), context, jobId, jobsStore, withRetry);
        log('info', 'AI data extraction complete.', logContext);

        await updateJobStatus(jobId, 'Mapping data', log, jobsStore, withRetry);
        const analysis = mapExtractedToAnalysisData(extractedData, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
        if (!analysis) throw new Error("Failed to process extracted data into a valid analysis object.");
        
        await updateJobStatus(jobId, 'Matching system', log, jobsStore, withRetry);
        const allSystems = systems || await withRetry(() => systemsStore.get("_all_systems_cache", { type: 'json' })).catch(() => []);
        const matchingSystem = analysis.dlNumber ? allSystems.find(s => s.associatedDLs?.includes(analysis.dlNumber)) : null;
        log('info', `System matching result: ${matchingSystem ? matchingSystem.name : 'None'}.`, { ...logContext, dlNumber: analysis.dlNumber, systemId: matchingSystem?.id });
        
        const timestamp = parseTimestamp(analysis.timestampFromImage, fileName, (level, msg, extra) => log(level, msg, { ...logContext, ...extra })).toISOString();
        log('info', 'Determined final timestamp for record.', { ...logContext, timestamp });

        let weather = null;
        if (matchingSystem?.latitude && matchingSystem?.longitude) {
            await updateJobStatus(jobId, 'Fetching weather', log, jobsStore, withRetry);
            weather = await fetchWeatherData(matchingSystem.latitude, matchingSystem.longitude, timestamp, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
        } else {
             log('debug', 'Skipping weather fetch: system has no location data.', logContext);
        }

        await updateJobStatus(jobId, 'Saving result', log, jobsStore, withRetry);
        const record = {
            id: uuidv4(),
            timestamp,
            systemId: matchingSystem?.id || null,
            systemName: matchingSystem?.name || null,
            analysis,
            weather,
            dlNumber: analysis.dlNumber,
            fileName: fileName,
        };
        
        await withRetry(() => historyStore.setJSON(record.id, record));
        log('info', 'Successfully saved analysis record.', { ...logContext, recordId: record.id });
        
        await updateHistoryCache(historyStore, log, withRetry, record);
        
        await updateJobStatus(jobId, 'completed', log, jobsStore, withRetry, { recordId: record.id });
        log('info', 'Job completed successfully.', { ...logContext, recordId: record.id });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Successfully processed job ${jobId}` }),
        };

    } catch (error) {
        const logContext = { jobId };
        log('error', 'Background analysis job failed.', { ...logContext, errorMessage: error.message, stack: error.stack });
        
        if (jobId && jobsStore) {
            try {
                let friendlyError = error.message;
                if (error.message && error.message.includes('exceeds remaining function execution time')) {
                    friendlyError = 'Analysis timed out due to high API load. Please try again later.';
                } else if (error.message && error.message.includes('429')) {
                    friendlyError = 'API rate limit reached. Please wait and try again.';
                }
                
                await updateJobStatus(jobId, 'failed', log, jobsStore, createRetryWrapper(log), { error: friendlyError });
            } catch (updateError) {
                log('error', 'CRITICAL: Could not update job status to failed after a processing error.', { ...logContext, updateError: updateError.message });
            }
        } else {
            log('error', 'Could not update job status because jobId or jobsStore was not available.', { hasJobId: !!jobId, hasStore: !!jobsStore });
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Failed to process job ${jobId}: ${error.message}` }),
        };
    }
};