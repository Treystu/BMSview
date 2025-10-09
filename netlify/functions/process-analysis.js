const { GoogleGenAI, Type } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");
const { getConfiguredStore } = require("./utils/blobs.js");

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const JOBS_STORE_NAME = "bms-jobs";
const HISTORY_STORE_NAME = "bms-history";
const SYSTEMS_STORE_NAME = "bms-systems";
const HISTORY_CACHE_KEY = "_all_history_cache";

const createLogger = (context) => (level, message, extra = {}) => {
    try {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            functionName: context?.functionName || 'process-analysis',
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        }));
    } catch (e) {
        console.log(JSON.stringify({
            level: 'ERROR',
            functionName: context?.functionName || 'process-analysis',
            awsRequestId: context?.awsRequestId,
            message: 'Failed to serialize log message.',
            originalMessage: message,
            serializationError: e.message,
        }));
    }
};

const withRetry = async (fn, log, maxRetries = 3, initialDelay = 250) => {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            const isRetryable = (error instanceof TypeError) || (error.message && (error.message.includes('401 status code') || error.message.includes('502 status code')));
            if (isRetryable && i < maxRetries) {
                const delay = initialDelay * Math.pow(2, i) + Math.random() * initialDelay;
                log('warn', `A retryable blob store operation failed. Retrying...`, { attempt: i + 1, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

const updateHistoryCache = async (store, log, newRecord) => {
    for (let i = 0; i < 5; i++) {
        let cache, metadata;
        try {
            const result = await withRetry(() => store.getWithMetadata(HISTORY_CACHE_KEY, { type: 'json' }), log);
            cache = result.data || [];
            metadata = result.metadata;
        } catch (e) {
            if (e.status === 404) {
                log('info', 'History cache not found, will create a new one.');
                cache = [];
                metadata = null;
            } else { throw e; }
        }

        if (!Array.isArray(cache)) cache = [];
        
        const updatedCache = [...cache, newRecord];
        updatedCache.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        try {
            await withRetry(() => store.setJSON(HISTORY_CACHE_KEY, updatedCache, { etag: metadata?.etag }), log);
            return;
        } catch (e) {
            if (e.status === 412) {
                const delay = 50 * Math.pow(2, i);
                log('warn', `History cache update conflict, retrying in ${delay}ms...`, { attempt: i + 1 });
                await new Promise(res => setTimeout(res, delay));
            } else { throw e; }
        }
    }
    log('error', 'Failed to update history cache after multiple retries.');
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
    -   \`power\`: Extract Power. If in 'kW', multiply by 1000 for Watts.
    -   \`status\`: 'Chg MOS', 'Dischg MOS', 'Balance' lights: green is \`true\`, grey/off is \`false\`.
    -   \`temperatures\`: Extract all 'Temp', 'T1', 'T2' values into this array.
    -   \`mosTemperature\`: Extract 'MOS Temp'.
    -   \`cellVoltages\`: ONLY if a numbered list of individual cell voltages exists, populate this array. Otherwise, it MUST be \`[]\`.
4.  **Timestamp Logic (CRITICAL)**:
    -   Find a timestamp within the image itself.
    -   If a full date and time are visible (e.g., "2023-01-01 12:04:00"), extract as "YYYY-MM-DDTHH:MM:SS".
    -   If only time is visible (e.g., "12:04:00"), extract only the time string "12:04:00". Do NOT add a date.
    -   If no timestamp is visible, \`timestampFromImage\` MUST be \`null\`.
5.  **Final Review**: Ensure your final output is a single, valid JSON object matching the schema. Do not add any text before or after the JSON.`;


const extractBmsData = async (image, mimeType, log) => {
    const extractionPrompt = getImageExtractionPrompt();
    const responseSchema = getResponseSchema();
    const parts = [{ text: extractionPrompt }, { inlineData: { data: image, mimeType } }];

    log('info', `Sending request to Gemini API.`, { stage: 'gemini_call_start' });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: { responseMimeType: "application/json", responseSchema },
    });
    log('info', `Received response from Gemini API.`, { stage: 'gemini_call_end' });

    const jsonText = response.text?.trim();
    if (!jsonText) throw new Error(`The AI model returned an empty response.`);
    return JSON.parse(jsonText);
};

const mapExtractedToAnalysisData = (extracted, log) => {
    if (!extracted || typeof extracted !== 'object') {
        log('warn', 'Extracted data is invalid, cannot map to AnalysisData.', { extractedData: extracted });
        return null;
    }
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
    return analysis;
};

const fetchWeatherData = async (lat, lon, timestamp, log) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!lat || !lon || !apiKey) return null;

    try {
        log('info', 'Fetching weather data.', { lat, lon, timestamp });
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
            log('info', 'Successfully fetched weather data.');
            return result;
        }
        log('warn', 'Failed to fetch weather data.', { mainStatus: mainResponse.status, uviStatus: uviResponse.status, mainBody: mainData, uviBody: uviData });
    } catch (e) {
        log('error', 'Error fetching weather.', { errorMessage: e.message });
    }
    return null;
};

const parseTimestamp = (timestampFromImage, fileName, log) => {
    if (timestampFromImage && /\d{4}[-/]\d{2}[-/]\d{2}/.test(timestampFromImage)) {
        log('info', 'Using full timestamp from image.', { timestampFromImage });
        return new Date(timestampFromImage);
    }
    const fromFilename = (fileName || '').match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[T _-]?(\d{2})[:.-]?(\d{2})[:.-]?(\d{2})/);
    if (fromFilename) {
        const [, y, m, d, h, min, s] = fromFilename;
        const date = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
        if (!isNaN(date.getTime())) {
            log('info', 'Parsed date from filename.', { dateFromFilename: date.toISOString() });
            if (timestampFromImage && /^\d{1,2}:\d{2}(:\d{2})?$/.test(timestampFromImage.trim())) {
                log('info', 'Applying time from image to filename date.', { timeFromImage: timestampFromImage });
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
    const log = createLogger(context);
    log('info', 'Function invoked.', { stage: 'invocation' });

    let jobId;
    try {
        const body = JSON.parse(event.body);
        jobId = body.jobId;

        if (!jobId) {
            log('error', 'Job ID is missing from invocation payload.');
            return { statusCode: 400, body: 'Job ID is required.' };
        }

        const logContext = { jobId };
        log('info', 'Background analysis job started.', logContext);
        
        const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
        const historyStore = getConfiguredStore(HISTORY_STORE_NAME, log);
        const systemsStore = getConfiguredStore(SYSTEMS_STORE_NAME, log);

        const job = await withRetry(() => jobsStore.get(jobId, { type: "json" }), log);
        if (!job) throw new Error(`Job with ID ${jobId} not found.`);
        log('info', 'Fetched job from blob store.', { ...logContext, fileName: job.fileName });

        await withRetry(() => jobsStore.setJSON(jobId, { ...job, status: 'processing' }), log);
        log('info', 'Job status updated to processing.', logContext);

        const { image, mimeType, systems, fileName } = job;
        const extractedData = await extractBmsData(image, mimeType, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
        log('info', 'AI data extraction complete.', logContext);

        const analysis = mapExtractedToAnalysisData(extractedData, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
        if (!analysis) throw new Error("Failed to process extracted data into a valid analysis object.");
        log('info', 'Successfully mapped extracted data.', { ...logContext, analysisKeys: Object.keys(analysis) });
        
        const allSystems = systems || await withRetry(() => systemsStore.get("_all_systems_cache", { type: 'json' }), log).catch(() => []);
        const matchingSystem = analysis.dlNumber ? allSystems.find(s => s.associatedDLs?.includes(analysis.dlNumber)) : null;
        log('info', `System matching result: ${matchingSystem ? matchingSystem.name : 'None'}.`, { ...logContext, dlNumber: analysis.dlNumber, systemId: matchingSystem?.id });
        
        const timestamp = parseTimestamp(analysis.timestampFromImage, fileName, (level, msg, extra) => log(level, msg, { ...logContext, ...extra })).toISOString();
        log('info', 'Determined final timestamp for record.', { ...logContext, timestamp });

        let weather = null;
        if (matchingSystem?.latitude && matchingSystem?.longitude) {
            log('info', 'Fetching weather for matching system.', { ...logContext, systemId: matchingSystem.id });
            weather = await fetchWeatherData(matchingSystem.latitude, matchingSystem.longitude, timestamp, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
            log('info', 'Weather fetch attempt complete.', { ...logContext, hasWeather: !!weather });
        } else {
             log('info', 'Skipping weather fetch: system has no location data.', logContext);
        }

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
        
        await withRetry(() => historyStore.setJSON(record.id, record), log);
        log('info', 'Successfully saved analysis record.', { ...logContext, recordId: record.id });
        
        await updateHistoryCache(historyStore, log, record);
        log('info', 'History cache updated.', { ...logContext, recordId: record.id });
        
        await withRetry(() => jobsStore.setJSON(jobId, { ...job, status: 'completed', recordId: record.id, image: undefined, mimeType: undefined, systems: undefined }), log);
        log('info', 'Job completed successfully.', { ...logContext, recordId: record.id });

    } catch (error) {
        const logContext = { jobId };
        log('error', 'Background analysis job failed.', { ...logContext, errorMessage: error.message, stack: error.stack });
        
        if (jobId) {
            try {
                const jobsStore = getConfiguredStore(JOBS_STORE_NAME, log);
                const job = await withRetry(() => jobsStore.get(jobId, { type: "json" }), log).catch(() => ({}));
                await withRetry(() => jobsStore.setJSON(jobId, { ...job, status: 'failed', error: error.message, image: undefined, mimeType: undefined, systems: undefined }), log);
                log('info', 'Job status updated to failed in blob store.', logContext);
            } catch (updateError) {
                log('error', 'CRITICAL: Could not update job status to failed after a processing error.', { ...logContext, updateError: updateError.message });
            }
        }
    }
};
