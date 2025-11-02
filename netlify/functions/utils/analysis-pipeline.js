"use strict";

// ***FIX: Removed the placeholder 'performAnalysisPipeline' function and the first 'module.exports' which were causing a redeclaration error.***

const { getGeminiClient } = require("./geminiClient.cjs");
const { v4: uuidv4 } = require("uuid");
// ***FIX: Corrected import path. File is in the same directory.***
const { getCollection } = require("./mongodb.cjs");
// ***FIX: Corrected import path. File is in the same directory.***
const { createRetryWrapper } = require("./retry.cjs");
const { getResponseSchema, getImageExtractionPrompt, cleanAndParseJson, mapExtractedToAnalysisData, performPostAnalysis, parseTimestamp, generateAnalysisKey } = require('./analysis-helpers.cjs');

const GEMINI_API_TIMEOUT_MS = 45000;

const callWeatherFunction = async (lat, lon, timestamp, log) => {
// ... existing code ...
    const weatherUrl = `${process.env.URL}/.netlify/functions/weather`;
    const logContext = { lat, lon, timestamp, weatherUrl };
// ... existing code ...
    log('debug', 'Calling weather function.', logContext);
    try {
        const response = await fetch(weatherUrl, {
// ... existing code ...
            body: JSON.stringify({ lat, lon, timestamp }),
        });
        if (!response.ok) {
            const errorBody = await response.text();
// ... existing code ...
            log('warn', 'Weather function call failed.', { ...logContext, status: response.status, errorBody });
            return null;
        }
        const data = await response.json();
// ... existing code ...
        log('debug', 'Weather function call successful.', logContext);
        return data;
    } catch (error) {
// ... existing code ...
        log('error', 'Error calling weather function.', { ...logContext, errorMessage: error.message });
        return null;
    }
};

const extractBmsData = async (image, mimeType, log, context) => {
// ... existing code ...
    const geminiClient = getGeminiClient();
    const extractionPrompt = getImageExtractionPrompt();
    // ***UPDATED***: Changed default model to gemini-flash-latest
// ... existing code ...
    const modelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';

    const prompt = {
// ... existing code ...
        text: extractionPrompt,
        image: image,
// ... existing code ...
        mimeType: mimeType
    };

    try {
// ... existing code ...
        log('info', 'Sending request to Gemini API via custom client.', { model: modelName });
        const startTime = Date.now();

// ... existing code ...
        const result = await geminiClient.callAPI(prompt, { model: modelName }, log);
        const duration = Date.now() - startTime;

// ... existing code ...
        log('info', 'Received response from Gemini API via custom client.', { durationMs: duration });

        const rawText = result.candidates[0]?.content.parts[0]?.text;
// ... existing code ...
        if (!rawText) {
            throw new Error("Invalid response structure from Gemini API client.");
        }
// ... existing code ...
        return cleanAndParseJson(rawText, log);

    } catch (error) {
// ... existing code ...
        const errorMessage = error.message || 'Unknown Gemini API error';
        log('error', 'Gemini API call failed.', { error: errorMessage });

// ... existing code ...
        if (errorMessage.includes('429') || errorMessage.includes('quota')) {
            throw new Error('TRANSIENT_ERROR: Gemini API quota exhausted.');
        }
// ... existing code ...
        throw new Error(`Gemini API Error: ${errorMessage}`);
    }
};

const performAnalysisPipeline = async (image, systems, log, context) => {
// ... existing code ...
    const logContext = { fileName: image.fileName, stage: 'pipeline-start' };
    log('info', 'Starting analysis pipeline.', logContext);

// ... existing code ...
    const withRetry = createRetryWrapper(log);

    const historyCollection = await getCollection("history");
// ... existing code ...
    const systemsCollection = await getCollection("systems");

    // 1. Extract Data
// ... existing code ...
    logContext.stage = 'extraction';
    log('info', 'Starting data extraction.', logContext);
// ... existing code ...
    const extractedData = await extractBmsData(image.image, image.mimeType, log, context);
    log('info', 'Data extraction complete.', logContext);

// ... existing code ...
    // 2. Map and Post-Process
    logContext.stage = 'processing';
// ... existing code ...
    log('info', 'Processing and analyzing data.', logContext);
    const analysisRaw = mapExtractedToAnalysisData(extractedData, log);
// ... existing code ...
    if (!analysisRaw) throw new Error("Failed to map extracted data.");

    const allSystems = (systems && systems.items) ? systems.items : await withRetry(() => systemsCollection.find({}).toArray());
// ... existing code ...
    const matchingSystem = analysisRaw.dlNumber ? allSystems.find(s => s.associatedDLs?.includes(analysisRaw.dlNumber)) : null;
    
    const analysis = performPostAnalysis(analysisRaw, matchingSystem, log);

// ... existing code ...
    // 3. Timestamp and Weather
    logContext.stage = 'enrichment';
// ... existing code ...
    log('info', 'Enriching data with timestamp and weather.', logContext);
    const timestamp = parseTimestamp(analysis.timestampFromImage, image.fileName, log).toISOString();
// ... existing code ...
    
    let weather = null;
    if (matchingSystem?.latitude && matchingSystem?.longitude) {
// ... existing code ...
        weather = await callWeatherFunction(matchingSystem.latitude, matchingSystem.longitude, timestamp, log);
    }

    // 4. Save to History
// ... existing code ...
    logContext.stage = 'saving';
    log('info', 'Saving analysis record.', logContext);
// ... existing code ...
    const analysisKey = generateAnalysisKey(analysis);
    
    const existingRecord = await historyCollection.findOne({ 
// ... existing code ...
        fileName: image.fileName, 
        analysisKey: analysisKey 
// ... existing code ...
    });

    if (existingRecord && !image.force) {
// ... existing code ...
        log('info', 'Identical analysis record found. Returning existing record.', { ...logContext, recordId: existingRecord.id });
        return existingRecord;
    }

    const newRecord = {
// ... existing code ...
        _id: uuidv4(),
        id: uuidv4(),
// ... existing code ...
        timestamp,
        systemId: matchingSystem?.id || null,
// ... existing code ...
        systemName: matchingSystem?.name || null,
        analysis,
// ... existing code ...
        weather,
        dlNumber: analysis.dlNumber,
// ... existing code ...
        fileName: image.fileName,
        analysisKey,
// ... existing code ...
        status: 'completed', // For sync, it's always completed
    };

    await withRetry(() => historyCollection.insertOne(newRecord));
// ... existing code ...
    log('info', 'Successfully saved new analysis record.', { ...logContext, recordId: newRecord.id });

    return newRecord;
};

module.exports = { performAnalysisPipeline };

