const { getCollection } = require('./utils/mongodb.js');
const { createLogger, createTimer } = require("./utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require('./security.js');
const { createRetryWrapper } = require("./utils/retry.js");
const { createRetryWrapper } = require("./utils/retry.js");

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
        analysis.power = -Math.abs(analysis.power);
    }
    
    log('debug', 'Mapped analysis data.', { analysisKeys: Object.keys(analysis) });
    return analysis;
};

const performPostAnalysis = (analysis, system, log) => {
    log('debug', 'Performing post-analysis calculations.', { hasSystem: !!system });
    
    if (!analysis) return null;
    
    const alerts = [];
    let status = 'Normal';
    
    // Cell voltage analysis
    if (analysis.cellVoltages && analysis.cellVoltages.length > 0) {
        const maxVoltage = Math.max(...analysis.cellVoltages);
        const minVoltage = Math.min(...analysis.cellVoltages);
        const difference = maxVoltage - minVoltage;
        
        analysis.highestCellVoltage = maxVoltage;
        analysis.lowestCellVoltage = minVoltage;
        analysis.cellVoltageDifference = difference;
        analysis.averageCellVoltage = analysis.cellVoltages.reduce((a, b) => a + b, 0) / analysis.cellVoltages.length;
        
        if (difference > 0.1) {
            alerts.push(`High cell voltage imbalance: ${difference.toFixed(3)}V`);
            status = 'Warning';
        }
        
        log('debug', 'Cell voltage analysis complete.', { 
            maxVoltage, 
            minVoltage, 
            difference, 
            avgVoltage: analysis.averageCellVoltage 
        });
    }
    
    // Temperature analysis
    if (analysis.temperatures && analysis.temperatures.length > 0) {
        const maxTemp = Math.max(...analysis.temperatures);
        if (maxTemp > 45) {
            alerts.push(`High temperature detected: ${maxTemp}°C`);
            status = 'Warning';
        }
        if (maxTemp > 55) {
            alerts.push(`Critical temperature: ${maxTemp}°C`);
            status = 'Critical';
        }
        
        log('debug', 'Temperature analysis complete.', { maxTemp, alertCount: alerts.length });
    }
    
    // SOC analysis
    if (analysis.stateOfCharge != null) {
        if (analysis.stateOfCharge < 20) {
            alerts.push(`Low battery: ${analysis.stateOfCharge}%`);
            if (status === 'Normal') status = 'Warning';
        }
        if (analysis.stateOfCharge < 10) {
            alerts.push(`Critical battery level: ${analysis.stateOfCharge}%`);
            status = 'Critical';
        }
    }
    
    analysis.alerts = alerts;
    analysis.status = status;
    
    log('info', 'Post-analysis complete.', { status, alertCount: alerts.length });
    return analysis;
};

const callWeatherFunction = async (lat, lon, timestamp, log) => {
    const weatherUrl = `${process.env.URL}/.netlify/functions/weather`;
    const logContext = { lat, lon, timestamp, weatherUrl };
    log('debug', 'Calling weather function.', logContext);
    try {
        const response = await fetch(weatherUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lon, timestamp }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            log('warn', 'Weather function call failed.', { ...logContext, status: response.status, errorBody });
            return null;
        }
        const data = await response.json();
        log('debug', 'Weather function call successful.', logContext);
        return data;
    } catch (error) {
        log('error', 'Error calling weather function.', { ...logContext, errorMessage: error.message });
        return null;
    }
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

const GEMINI_API_TIMEOUT_MS = 45000;
const MAX_RETRY_COUNT = 5; // Maximum retries for quota exhaustion

const extractBmsData = async (ai, image, mimeType, log, context, jobId, jobsCollection, withRetry) => {
    log('debug', 'Preparing for Gemini API call.', { imageSize: image.length, mimeType });
    const extractionPrompt = getImageExtractionPrompt();
    const responseSchema = getResponseSchema();
    const parts = [{ text: extractionPrompt }, { inlineData: { data: image, mimeType } }];

    const maxRetries = 4;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
        const attemptLogContext = { attempt, maxRetries, timeout: GEMINI_API_TIMEOUT_MS, model: modelName };
        try {
            log('info', `Sending request to Gemini API.`, attemptLogContext);
            const startTime = Date.now();
            
            const apiCall = ai.models.generateContent({
                model: modelName,
                contents: { parts },
                config: { responseMimeType: "application/json", responseSchema },
            });

            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Gemini API call timed out after ${GEMINI_API_TIMEOUT_MS}ms`)), GEMINI_API_TIMEOUT_MS)
            );

            const response = await Promise.race([apiCall, timeoutPromise]);
            const duration = Date.now() - startTime;
            
            log('info', `Received response from Gemini API.`, { ...attemptLogContext, durationMs: duration });
            const rawText = response.text;
            return cleanAndParseJson(rawText, log);

        } catch (error) {
            lastError = error;
            const errorMessage = error.message || '';
            const isRateLimitError = errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED');
            const isTimeoutError = errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT');
            const isNetworkError = errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND');
            const remainingTime = context.getRemainingTimeInMillis();
            
            log('warn', 'Gemini API call failed.', { 
                ...attemptLogContext, 
                error: errorMessage, 
                isRateLimitError,
                isTimeoutError,
                isNetworkError,
                remainingTime 
            });

            // TRANSIENT ERRORS: Should be requeued
            if (isRateLimitError) {
                log('error', 'Gemini API quota exhausted. Job will be requeued.', attemptLogContext);
                throw new Error('TRANSIENT_ERROR: Gemini API quota exhausted. Job will be requeued for later processing.');
            }
            
            if (isTimeoutError || isNetworkError) {
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    log('warn', `Network/timeout error. Retrying in ${delay.toFixed(0)}ms...`, { ...attemptLogContext, delay });
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                } else {
                    log('error', 'Network/timeout error persisted after all retries. Job will be requeued.', attemptLogContext);
                    throw new Error('TRANSIENT_ERROR: Network/timeout error persisted. Job will be requeued.');
                }
            }
            
            // PERMANENT ERRORS: Should fail immediately
            if (errorMessage.includes('invalid') || errorMessage.includes('parse') || errorMessage.includes('schema')) {
                log('error', 'Permanent error detected (invalid data/schema). Job will fail.', { ...attemptLogContext, error: errorMessage });
                throw new Error(`PERMANENT_ERROR: ${errorMessage}`);
            }
            
            // Unknown errors: retry with backoff
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                log('warn', `Unknown error. Retrying in ${delay.toFixed(0)}ms...`, { ...attemptLogContext, delay });
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    log('error', `Failed to get a successful response from Gemini API after all retries.`, { lastError: lastError?.message });
    throw new Error(`Failed to get a successful response from Gemini API after ${maxRetries} attempts. Last error: ${lastError?.message}`);
};

const getBasename = (path) => path ? path.split(/[/\\]/).pop() || '' : '';

const getResponseSchema = () => ({
    type: Type.OBJECT,
    properties: {
        dlNumber: { "type": Type.STRING, "nullable": true, "description": "This is the DL Number." },
        timestampFromImage: { "type": Type.STRING, "nullable": true },
        stateOfCharge: { "type": Type.NUMBER, "nullable": true },
        overallVoltage: { "type": Type.NUMBER, "nullable": true },
        current: { "type": Type.NUMBER, "nullable": true },
        remainingCapacity: { "type": Type.NUMBER, "nullable": true },
        fullCapacity: { "type": Type.NUMBER, "nullable": true },
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
    -   \`remainingCapacity\`: Extract 'Remaining Cap'.
    -   \`fullCapacity\`: Extract 'Full Cap'.
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
    
    log('debug', 'Raw AI response received.', { length: text.length, preview: text.substring(0, 200) });
    
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        log('error', 'AI response did not contain a valid JSON object.', { responseText: text });
        throw new Error(`AI response did not contain a valid JSON object. Response: ${text}`);
    }
    
    const jsonString = text.substring(jsonStart, jsonEnd + 1);
    
    try {
        const parsed = JSON.parse(jsonString);
        log('debug', 'Successfully parsed JSON from AI response.', { parsedKeys: Object.keys(parsed) });
        return parsed;
    } catch (e) {
        log('error', 'Failed to parse cleaned JSON string.', { error: e.message, cleanedJsonString: jsonString });
        throw new Error(`Failed to parse JSON from AI response. See logs for details.`);
    }
};;

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

// Function to invoke the background processor
const invokeProcessor = async (jobId, log) => {
    const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
    log('info', 'Invoking background processor.', { jobId, invokeUrl });
    
    try {
        const response = await fetch(invokeUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'x-netlify-background': 'true' 
            },
            body: JSON.stringify({ jobId: jobId }),
        });
        
        if (response.status === 202 || response.status === 200) {
            log('info', 'Background processor invoked successfully.', { 
                jobId, 
                status: response.status 
            });
        } else {
            log('error', 'Background processor invocation returned non-success status.', { 
                jobId, 
                status: response.status,
                statusText: response.statusText
            });
            // Throw an error to be caught by Promise.allSettled
            throw new Error(`Invocation failed with status ${response.status}`);
        }
    } catch (error) {
        log('error', 'Failed to invoke background processor.', { 
            jobId, 
            errorMessage: error.message,
            errorStack: error.stack
        });
        // Re-throw the error to be caught by Promise.allSettled
        throw error;
    }
};

exports.handler = async (event, context) => {
    const log = createLogger('analyze', context);
    log('info', 'analyze.js handler function invoked - v2');
    const timer = createTimer(log, 'analyze-handler');
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };

    log('debug', 'Function invoked.', { ...logContext, path: event.path, method: httpMethod });
    
    const { sync } = event.queryStringParameters || {};

    try {
        if (httpMethod !== 'POST') {
            return respond(405, { error: 'Method Not Allowed' });
        }

        await checkSecurity(event, log);
        
        const body = JSON.parse(event.body);
        const { images, systems } = body;

        if (sync === 'true' && images && images.length === 1) {
            log('info', 'Starting synchronous analysis for single image.', logContext);
            const image = images[0];
            const historyCollection = await getCollection("history");
            const existingRecord = await historyCollection.findOne({ fileName: image.fileName });

            if (existingRecord && !image.force) {
                log('info', 'Sync analysis found duplicate, returning existing record.', { ...logContext, fileName: image.fileName });
                return respond(200, { status: 'duplicate_history', duplicateRecordId: existingRecord.id });
            }

            const record = await performSyncAnalysis(image, systems, image.fileName, log, context);
            return respond(200, { status: 'completed', record });
        }
        
        log('debug', 'Request body parsed.', { 
            ...logContext, 
            imageCount: images?.length, 
            hasSystems: !!systems,
            systemCount: systems?.length || 0,
            bodySize: event.body?.length || 0
        });

        if (!Array.isArray(images) || images.length === 0) {
            log('warn', 'Request rejected: No images provided.', logContext);
            return respond(400, { error: "No images provided for analysis." });
        }
        
        log('info', 'Starting batch analysis.', { 
            ...logContext, 
            imageCount: images.length,
            systemCount: systems?.length || 0
        });
        
        const dbTimer = createTimer(log, 'database-operations');
        const historyCollection = await getCollection("history");
        const jobsCollection = await getCollection("jobs");
        log('debug', 'Database collections retrieved.', logContext);
        
        const jobCreationResponses = [];
        const batchFileNames = new Set();
        const jobsToInsert = [];

        const BATCH_SIZE = 100;
        const imageBatches = [];
        for (let i = 0; i < images.length; i += BATCH_SIZE) {
            imageBatches.push(images.slice(i, i + BATCH_SIZE));
        }

        for (const batch of imageBatches) {
            const fileNamesToCheck = batch.map(img => img.fileName);

            const existingRecords = await historyCollection.find({ fileName: { $in: fileNamesToCheck } }).toArray();
            const existingRecordMap = new Map(existingRecords.map(r => [r.fileName, r]));
            log('info', 'Duplicate check data', { fileNamesToCheck, existingRecordMap: Array.from(existingRecordMap.entries()) });

            for (const [index, image] of batch.entries()) {
                const imageLogContext = { ...logContext, fileName: image.fileName, imageIndex: index };

                if (batchFileNames.has(image.fileName)) {
                    log('debug', 'Duplicate in current batch detected.', imageLogContext);
                    jobCreationResponses.push({ fileName: image.fileName, status: 'duplicate_batch' });
                    continue;
                }
                batchFileNames.add(image.fileName);

                const existingRecord = existingRecordMap.get(image.fileName);
                if (existingRecord && !image.force) {
                    log('debug', 'Duplicate in history detected.', {
                        ...imageLogContext,
                        existingRecordId: existingRecord.id,
                        force: image.force
                    });
                    jobCreationResponses.push({
                        fileName: image.fileName,
                        status: 'duplicate_history',
                        duplicateRecordId: existingRecord.id,
                    });
                    continue;
                }

                log('debug', 'Creating new job for image.', imageLogContext);

                const newJobId = uuidv4();
                jobsToInsert.push({
                    _id: newJobId,
                    id: newJobId,
                    fileName: image.fileName,
                    status: "Queued",
                    image: image.image,
                    mimeType: image.mimeType,
                    systems,
                    createdAt: new Date(),
                    retryCount: 0,
                });
                jobCreationResponses.push({
                    fileName: image.fileName,
                    jobId: newJobId,
                    status: 'Submitted',
                });
            }
        }

        dbTimer.end();        
        if (jobsToInsert.length > 0) {
            const insertTimer = createTimer(log, 'insert-jobs');
            await jobsCollection.insertMany(jobsToInsert);
            insertTimer.end({ jobCount: jobsToInsert.length });
            log('info', `Successfully created ${jobsToInsert.length} new analysis jobs.`, { 
                ...logContext,
                jobIds: jobsToInsert.map(j => j.id)
            });

            // *** THE FIX: Reliably trigger background processors and await invocation ***
            const invocationPromises = jobsToInsert.map(job => invokeProcessor(job.id, log));
            const invocationResults = await Promise.allSettled(invocationPromises);
            
            const failedInvocations = invocationResults.filter(r => r.status === 'rejected');
            if (failedInvocations.length > 0) {
                log('error', `${failedInvocations.length} background processor invocation(s) failed. These jobs will be picked up by the shepherd.`, {
                    ...logContext,
                    failedCount: failedInvocations.length,
                });
            }

            log('info', 'All background processors invoked.', {
                ...logContext,
                jobCount: jobsToInsert.length,
                successful: jobsToInsert.length - failedInvocations.length,
                failed: failedInvocations.length
            });
        } else {
            log('info', 'No new jobs to create (all duplicates).', logContext);
        }
        
        const responseCounts = jobCreationResponses.reduce((acc, j) => {
            if (j.status === 'Submitted') acc.queued++;
            else if (j.status.startsWith('duplicate')) acc.duplicates++;
            return acc;
        }, { queued: 0, duplicates: 0 });
        
        const totalDuration = timer.end({ ...responseCounts, totalProcessed: images.length });
        log('info', `Analysis submission processing complete.`, { 
            ...logContext, 
            ...responseCounts, 
            totalProcessed: images.length,
            totalDurationMs: totalDuration
        });
        
        return respond(200, jobCreationResponses);

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { ...logContext, errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        return respond(500, { error: "An internal server error occurred." });
    }
};

const performSyncAnalysis = async (image, systems, fileName, log, context) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const historyCollection = await getCollection("history");
    const systemsCollection = await getCollection("systems");
    const withRetry = createRetryWrapper(log);

    const logContext = { fileName, stage: 'extraction' };
    log('info', 'Starting single image analysis.', logContext);

    const { image: imageBuffer, mimeType } = image;
    if (!imageBuffer) throw new Error("Image data is missing.");

    const extractedData = await extractBmsData(
        ai,
        imageBuffer,
        mimeType,
        (level, msg, extra) => log(level, msg, { ...logContext, ...extra }),
        context
    );
    log('info', 'AI data extraction complete.', logContext);

    logContext.stage = 'mapping';
    log('info', 'Mapping extracted data.', logContext);
    const analysisRaw = mapExtractedToAnalysisData(extractedData, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
    if (!analysisRaw) throw new Error("Failed to process extracted data.");

    logContext.stage = 'system_matching';
    log('info', 'Matching to system.', logContext);
    const allSystems = systems || (await withRetry(() => systemsCollection.find({}).toArray()));
    const matchingSystem = analysisRaw.dlNumber ? allSystems.find(s => s.associatedDLs?.includes(analysisRaw.dlNumber)) : null;
    log('info', `System match: ${matchingSystem ? matchingSystem.name : 'None'}.`, { ...logContext, dlNumber: analysisRaw.dlNumber, systemId: matchingSystem?.id });

    const analysis = performPostAnalysis(analysisRaw, matchingSystem, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));

    logContext.stage = 'timestamp_parsing';
    log('info', 'Parsing timestamp.', logContext);
    const timestamp = parseTimestamp(analysis.timestampFromImage, fileName, (level, msg, extra) => log(level, msg, { ...logContext, ...extra })).toISOString();
    log('info', 'Final timestamp.', { ...logContext, timestamp });

    let weather = null;
    if (matchingSystem?.latitude && matchingSystem?.longitude) {
        logContext.stage = 'weather_fetch';
        log('info', 'Fetching weather.', { ...logContext, systemId: matchingSystem.id });
        weather = await callWeatherFunction(matchingSystem.latitude, matchingSystem.longitude, timestamp, (level, msg, extra) => log(level, msg, { ...logContext, ...extra }));
    }

    logContext.stage = 'saving';
    log('info', 'Saving analysis record.', logContext);

    const analysisKey = generateAnalysisKey(analysis);
    const newRecord = {
        _id: uuidv4(),
        id: uuidv4(),
        timestamp,
        systemId: matchingSystem?.id || null,
        systemName: matchingSystem?.name || null,
        analysis,
        weather,
        dlNumber: analysis.dlNumber,
        fileName: fileName,
        analysisKey,
    };

    await withRetry(() => historyCollection.insertOne(newRecord));
    log('info', 'Successfully saved new analysis record.', { ...logContext, recordId: newRecord.id });

    return newRecord;
};

