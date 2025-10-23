const { getGeminiClient } = require("./geminiClient.js");
const { v4: uuidv4 } = require("uuid");
const { getCollection } = require("./mongodb.js");
const { createRetryWrapper } = require("./retry.js");
const { getResponseSchema, getImageExtractionPrompt, cleanAndParseJson, mapExtractedToAnalysisData, performPostAnalysis, parseTimestamp, generateAnalysisKey } = require('./analysis-helpers.js');

const GEMINI_API_TIMEOUT_MS = 45000;

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
        return await response.json();
    } catch (error) {
        log('error', 'Error calling weather function.', { ...logContext, errorMessage: error.message });
        return null;
    }
};

const extractBmsData = async (image, mimeType, log, context) => {
    const geminiClient = getGeminiClient();
    const extractionPrompt = getImageExtractionPrompt();
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';

    const prompt = {
        text: extractionPrompt,
        image: image,
        mimeType: mimeType
    };

    try {
        log('info', 'Sending request to Gemini API via custom client.', { model: modelName });
        const startTime = Date.now();

        const result = await geminiClient.callAPI(prompt, { model: modelName }, log);
        const duration = Date.now() - startTime;

        log('info', 'Received response from Gemini API via custom client.', { durationMs: duration });

        const rawText = result.candidates[0]?.content.parts[0]?.text;
        if (!rawText) {
            throw new Error("Invalid response structure from Gemini API client.");
        }
        return cleanAndParseJson(rawText, log);

    } catch (error) {
        const errorMessage = error.message || 'Unknown Gemini API error';
        log('error', 'Gemini API call failed.', { error: errorMessage });

        if (errorMessage.includes('429') || errorMessage.includes('quota')) {
            throw new Error('TRANSIENT_ERROR: Gemini API quota exhausted.');
        }
        throw new Error(`Gemini API Error: ${errorMessage}`);
    }
};

const performAnalysisPipeline = async (image, systems, log, context) => {
    const logContext = { fileName: image.fileName, stage: 'pipeline-start' };
    log('info', 'Starting analysis pipeline.', logContext);

    const withRetry = createRetryWrapper(log);

    const historyCollection = await getCollection("history");
    const systemsCollection = await getCollection("systems");

    // 1. Extract Data
    logContext.stage = 'extraction';
    log('info', 'Starting data extraction.', logContext);
    const extractedData = await extractBmsData(image.image, image.mimeType, log, context);
    log('info', 'Data extraction complete.', logContext);

    // 2. Map and Post-Process
    logContext.stage = 'processing';
    log('info', 'Processing and analyzing data.', logContext);
    const analysisRaw = mapExtractedToAnalysisData(extractedData, log);
    if (!analysisRaw) throw new Error("Failed to map extracted data.");

    const allSystems = (systems && systems.items) ? systems.items : await withRetry(() => systemsCollection.find({}).toArray());
    const matchingSystem = analysisRaw.dlNumber ? allSystems.find(s => s.associatedDLs?.includes(analysisRaw.dlNumber)) : null;
    
    const analysis = performPostAnalysis(analysisRaw, matchingSystem, log);

    // 3. Timestamp and Weather
    logContext.stage = 'enrichment';
    log('info', 'Enriching data with timestamp and weather.', logContext);
    const timestamp = parseTimestamp(analysis.timestampFromImage, image.fileName, log).toISOString();
    
    let weather = null;
    if (matchingSystem?.latitude && matchingSystem?.longitude) {
        weather = await callWeatherFunction(matchingSystem.latitude, matchingSystem.longitude, timestamp, log);
    }

    // 4. Save to History
    logContext.stage = 'saving';
    log('info', 'Saving analysis record.', logContext);
    const analysisKey = generateAnalysisKey(analysis);
    
    const existingRecord = await historyCollection.findOne({ 
        fileName: image.fileName, 
        analysisKey: analysisKey 
    });

    if (existingRecord && !image.force) {
        log('info', 'Identical analysis record found. Returning existing record.', { ...logContext, recordId: existingRecord.id });
        return existingRecord;
    }

    const newRecord = {
        _id: uuidv4(),
        id: uuidv4(),
        timestamp,
        systemId: matchingSystem?.id || null,
        systemName: matchingSystem?.name || null,
        analysis,
        weather,
        dlNumber: analysis.dlNumber,
        fileName: image.fileName,
        analysisKey,
        status: 'completed', // For sync, it's always completed
    };

    await withRetry(() => historyCollection.insertOne(newRecord));
    log('info', 'Successfully saved new analysis record.', { ...logContext, recordId: newRecord.id });

    return newRecord;
};

module.exports = { performAnalysisPipeline };