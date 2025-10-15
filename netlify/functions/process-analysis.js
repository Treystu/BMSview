const { GoogleGenAI, Type } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");
const { createRetryWrapper } = require("./utils/retry.js");

const GEMINI_API_TIMEOUT_MS = 45000;

const findJob = async (jobId, collection, log) => {
    log('debug', 'Attempting to find job by ID in MongoDB.', { jobId });
    const job = await collection.findOne({ id: jobId });
    log('debug', job ? 'Found job.' : 'Job not found.', { jobId });
    return job;
};

const updateJobStatus = async (jobId, status, log, jobsCollection, extra = {}) => {
    const logContext = { jobId, newStatus: status, ...extra };
    try {
        log('debug', 'Attempting to update job status in MongoDB.', logContext);

        const isTerminal = status === 'completed' || status.startsWith('failed');
        const isCheckpoint = status === 'Extraction complete (checkpoint)';
        
        const updatePayload = {
            $set: {
                ...extra,
                status,
                statusEnteredAt: new Date().toISOString(),
                lastHeartbeat: new Date().toISOString(),
            }
        };
        
        if (isTerminal || isCheckpoint) {
            log('debug', 'Status is terminal or checkpoint, removing image data.', logContext);
            updatePayload.$unset = { image: "", images: "" };
        }

        const result = await jobsCollection.updateOne({ id: jobId }, updatePayload);
        
        if (result.matchedCount > 0) {
             log('info', 'Job status updated successfully in MongoDB.', logContext);
        } else {
             log('warn', 'Tried to update status for a job that was not found.', logContext);
        }
    } catch (e) {
        log('error', 'Failed to update job status in MongoDB.', { ...logContext, error: e.message });
    }
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

const extractBmsData = async (ai, image, mimeType, log, context, jobId, jobsCollection, withRetry) => {
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
                
                await updateJobStatus(jobId, `Retrying (API throttled)...`, log, jobsCollection, {});
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
    
    if (analysis.current != null && analysis.power != null && analysis.current < 0 && analysis.power > 0) {
        log('warn', 'Correcting positive power sign for negative current.', { originalPower: analysis.power, current: analysis.current });
        analysis.power = -analysis.power;
    }
    log('debug', 'Data mapping complete.', { finalKeys: Object.keys(analysis) });
    return analysis;
};

const performPostAnalysis = (analysis, system, log) => {
    if (!analysis) return null;

    const enhancedAnalysis = JSON.parse(JSON.stringify(analysis)); // Deep copy
    if (!enhancedAnalysis.alerts) enhancedAnalysis.alerts = [];

    // 1. Enhanced Status Logic
    let baseStatus = 'Standby';
    if (enhancedAnalysis.current != null) {
        if (enhancedAnalysis.current > 0.5) baseStatus = 'Charging';
        else if (enhancedAnalysis.current < -0.5) baseStatus = 'Discharging';
    }

    const modifiers = [];
    if (enhancedAnalysis.balanceOn) modifiers.push('Balancing');
    if (enhancedAnalysis.chargeMosOn === false && enhancedAnalysis.dischargeMosOn === false) {
       modifiers.push('MOS Off');
    }

    enhancedAnalysis.status = modifiers.length > 0 ? `${baseStatus} (${modifiers.join(', ')})` : baseStatus;
    
    // 2. Alert Generation Logic (assuming LiFePO4 chemistry for now)
    const { cellVoltageDifference, temperature, mosTemperature, cellVoltages } = enhancedAnalysis;

    // Cell Difference
    if (cellVoltageDifference != null) {
        const diffMv = (cellVoltageDifference * 1000).toFixed(0);
        if (cellVoltageDifference > 0.1) {
            enhancedAnalysis.alerts.push(`CRITICAL: Cell difference is ${diffMv}mV, which is dangerously high and risks cell damage. Immediate balancing or cell inspection is required.`);
        } else if (cellVoltageDifference > 0.05) {
            enhancedAnalysis.alerts.push(`WARNING: Cell difference is ${diffMv}mV, which is high. The pack needs balancing.`);
        }
    }

    // Battery Temperature
    if (temperature != null) {
        const tempC = temperature.toFixed(1);
        if (temperature > 50) {
            enhancedAnalysis.alerts.push(`CRITICAL: Battery temperature is ${tempC}°C, which is dangerously high. Stop charging/discharging immediately to prevent damage.`);
        } else if (temperature > 40) {
            enhancedAnalysis.alerts.push(`WARNING: Battery temperature is ${tempC}°C. Performance may be reduced.`);
        } else if (temperature < 0 && baseStatus === 'Charging') {
             enhancedAnalysis.alerts.push(`WARNING: Battery temperature is ${tempC}°C. Charging is not recommended below freezing.`);
        }
    }
    
    // MOS Temperature
    if (mosTemperature != null) {
        const mosTempC = mosTemperature.toFixed(1);
        if (mosTemperature > 80) {
            enhancedAnalysis.alerts.push(`CRITICAL: MOS temperature is ${mosTempC}°C, which is dangerously high. Reduce load immediately to prevent damage.`);
        } else if (mosTemperature > 65) {
            enhancedAnalysis.alerts.push(`WARNING: MOS temperature is ${mosTempC}°C, which is high. Monitor the load.`);
        }
    }

    // Individual Cell Voltages
    if (cellVoltages && Array.isArray(cellVoltages)) {
        const overVoltageCells = [];
        const underVoltageCells = [];
        cellVoltages.forEach((voltage, index) => {
            if (voltage > 3.65) overVoltageCells.push({index: index + 1, voltage});
            else if (voltage < 2.8) underVoltageCells.push({index: index + 1, voltage});
        });

        if (overVoltageCells.length > 0) {
            const highest = overVoltageCells.reduce((max, cell) => cell.voltage > max.voltage ? cell : max, overVoltageCells[0]);
            let alertMsg = `CRITICAL: Cell ${highest.index} is at ${highest.voltage.toFixed(3)}V (overvoltage).`;
            if (overVoltageCells.length > 1) alertMsg += ` ${overVoltageCells.length - 1} other cell(s) are also overvoltage. Stop charging immediately.`;
            else alertMsg += ' Stop charging immediately.';
            enhancedAnalysis.alerts.push(alertMsg);
        }
        if (underVoltageCells.length > 0) {
            const lowest = underVoltageCells.reduce((min, cell) => cell.voltage < min.voltage ? cell : min, underVoltageCells[0]);
            let alertMsg = `CRITICAL: Cell ${lowest.index} is at ${lowest.voltage.toFixed(3)}V (undervoltage).`;
            if (underVoltageCells.length > 1) alertMsg += ` ${underVoltageCells.length - 1} other cell(s) are also undervoltage. Stop discharging immediately.`;
            else alertMsg += ' Stop discharging immediately.';
            enhancedAnalysis.alerts.push(alertMsg);
        }
    }

    log('info', 'Post-analysis complete.', { status: enhancedAnalysis.status, alertsGenerated: enhancedAnalysis.alerts.length });
    return enhancedAnalysis;
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

const generateAnalysisKey = (analysis) => {
    if (!analysis) return null;
    try {
        const keyParts = [
            analysis.dlNumber || 'nodl',
            (analysis.overallVoltage != null ? analysis.overallVoltage.toFixed(2) : 'nov'),
            (analysis.current != null ? analysis.current.toFixed(2) : 'noc'),
            (analysis.stateOfCharge != null ? analysis.stateOfCharge.toFixed(1) : 'nosoc'),
            (analysis.cellVoltages && analysis.cellVoltages.length > 0 ? [...analysis.cellVoltages].sort().map(v => v.toFixed(3)).join(',') : 'nocells'),
            (analysis.temperatures && analysis.temperatures.length > 0 ? [...analysis.temperatures].sort().map(t => t.toFixed(1)).join(',') : 'notemps'),
            (analysis.cycleCount != null ? analysis.cycleCount : 'nocycle'),
            (analysis.remainingCapacity != null ? analysis.remainingCapacity.toFixed(2) : 'norc')
        ];
        return keyParts.join('|');
    } catch (e) {
        console.error("Error generating analysis key", e, { analysisData: analysis });
        return `error_${uuidv4()}`;
    }
};


exports.handler = async function(event, context) {
    const log = createLogger('process-analysis', context);
    const withRetry = createRetryWrapper(log);
    log('info', 'Background process-analysis function invoked.', { stage: 'invocation' });
    log('debug', 'Invocation details.', { body: event.body });

    let jobId;

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const body = JSON.parse(event.body);
        jobId = body.jobId;

        if (!jobId) {
            log('error', 'Job ID is missing from invocation payload.', { body: event.body });
            return { statusCode: 400, body: 'Job ID is required.' };
        }

        const logContext = { jobId, stage: 'setup' };
        log('info', 'Background analysis job started.', logContext);
        
        const jobsCollection = await getCollection("jobs");
        const historyCollection = await getCollection("history");
        const systemsCollection = await getCollection("systems");

        log('info', 'Finding job in MongoDB.', logContext);
        const job = await findJob(jobId, jobsCollection, log);

        if (!job) throw new Error(`Job with ID ${jobId} not found.`);
        log('info', 'Fetched job from database.', { ...logContext, fileName: job.fileName });

        let extractedData = job.extractedData || null;
        
        if (!extractedData) {
            logContext.stage = 'extraction';
            log('info', 'Starting data extraction.', logContext);
            await updateJobStatus(jobId, 'Extracting data', log, jobsCollection, {});
            
            const { image, mimeType } = job;
            if (!image) throw new Error("Job is missing image data for extraction.");
            extractedData = await extractBmsData(ai, image, mimeType, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }), context, jobId, jobsCollection, withRetry);
            log('info', 'AI data extraction complete.', logContext);

            await updateJobStatus(jobId, 'Extraction complete (checkpoint)', log, jobsCollection, { extractedData });
            log('info', 'Saved extraction checkpoint to job.', logContext);
        } else {
            log('info', 'Resuming from checkpoint. Skipping data extraction.', { ...logContext, stage: 'resume', extractedDataKeys: Object.keys(extractedData) });
        }
        
        logContext.stage = 'mapping';
        log('info', 'Mapping extracted data to analysis schema.', logContext);
        await updateJobStatus(jobId, 'Mapping data', log, jobsCollection, {});
        const analysisRaw = mapExtractedToAnalysisData(extractedData, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
        if (!analysisRaw) throw new Error("Failed to process extracted data into a valid analysis object.");
        
        logContext.stage = 'system_matching';
        log('info', 'Matching analysis record to a registered system.', logContext);
        await updateJobStatus(jobId, 'Matching system', log, jobsCollection, {});
        
        const allSystems = job.systems || await withRetry(() => systemsCollection.find({}).toArray());
        const matchingSystem = analysisRaw.dlNumber ? allSystems.find(s => s.associatedDLs?.includes(analysisRaw.dlNumber)) : null;
        log('info', `System matching result: ${matchingSystem ? matchingSystem.name : 'None'}.`, { ...logContext, dlNumber: analysisRaw.dlNumber, systemId: matchingSystem?.id });
        
        const analysis = performPostAnalysis(analysisRaw, matchingSystem, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
        
        logContext.stage = 'timestamp_parsing';
        log('info', 'Determining final timestamp for record.', logContext);
        const timestamp = parseTimestamp(analysis.timestampFromImage, job.fileName, (level, msg, extra) => log(level, msg, { ...logContext, ...extra })).toISOString();
        log('info', 'Final timestamp determined.', { ...logContext, timestamp });

        let weather = null;
        if (matchingSystem?.latitude && matchingSystem?.longitude) {
            logContext.stage = 'weather_fetch';
            log('info', 'Fetching weather data for matched system.', { ...logContext, systemId: matchingSystem.id });
            await updateJobStatus(jobId, 'Fetching weather', log, jobsCollection, {});
            weather = await fetchWeatherData(matchingSystem.latitude, matchingSystem.longitude, timestamp, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
        } else {
             log('info', 'Skipping weather fetch: system has no location data.', { ...logContext, stage: 'weather_fetch' });
        }

        logContext.stage = 'saving';
        log('info', 'Checking for duplicates and saving final analysis record.', logContext);
        await updateJobStatus(jobId, 'Saving result', log, jobsCollection, {});

        const analysisKey = generateAnalysisKey(analysis);
        const existingRecord = await historyCollection.findOne({ 
            fileName: job.fileName, 
            analysisKey: analysisKey 
        });

        let recordIdToReturn;
        if (existingRecord) {
            log('info', 'Identical analysis record found. Skipping creation of new record.', { ...logContext, existingRecordId: existingRecord.id });
            recordIdToReturn = existingRecord.id;
        } else {
            const newRecord = {
                _id: uuidv4(),
                id: uuidv4(),
                timestamp,
                systemId: matchingSystem?.id || null,
                systemName: matchingSystem?.name || null,
                analysis,
                weather,
                dlNumber: analysis.dlNumber,
                fileName: job.fileName,
                analysisKey,
            };
            
            log('debug', 'Final record prepared for saving.', { ...logContext, recordId: newRecord.id });
            await withRetry(() => historyCollection.insertOne(newRecord));
            log('info', 'Successfully saved new analysis record to history collection.', { ...logContext, recordId: newRecord.id });
            recordIdToReturn = newRecord.id;
        }

        logContext.stage = 'completion';
        log('info', 'Marking job as completed.', logContext);
        await updateJobStatus(jobId, 'completed', log, jobsCollection, { recordId: recordIdToReturn });
        log('info', 'Job completed successfully.', { ...logContext, recordId: recordIdToReturn });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Successfully processed job ${jobId}` }),
        };

    } catch (error) {
        const logContext = { jobId, stage: 'error_handling' };
        log('error', 'Background analysis job failed.', { ...logContext, errorMessage: error.message, stack: error.stack });
        
        if (jobId) {
            try {
                const jobsCollection = await getCollection("jobs");
                // The full error message, prefixed for the client to parse.
                const errorMessageForClient = `failed_${error.message}`;
                
                await updateJobStatus(jobId, 'failed', log, jobsCollection, { error: errorMessageForClient });
            } catch (updateError) {
                log('error', 'CRITICAL: Could not update job status to failed after a processing error.', { ...logContext, updateError: updateError.message });
            }
        } else {
            log('error', 'Could not update job status because jobId was not available.');
        }

        // Must return a 200 OK for background functions, even on error, to prevent Netlify from retrying.
        return {
            statusCode: 200,
            body: JSON.stringify({ error: `Job ${jobId} failed to process: ${error.message}` }),
        };
    }
};