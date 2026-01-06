"use strict";

// ***FIX: Removed the placeholder 'performAnalysisPipeline' function and the first 'module.exports' which were causing a redeclaration error.***

const { getGeminiClient } = require("./geminiClient.cjs");
const { v4: uuidv4 } = require("uuid");
// ***FIX: Corrected import path. File is in the same directory.***
const { getCollection } = require("./mongodb.cjs");
// ***FIX: Corrected import path. File is in the same directory.***
const { createRetryWrapper } = require("./retry.cjs");
const { getResponseSchema, getImageExtractionPrompt, cleanAndParseJson, mapExtractedToAnalysisData, performPostAnalysis, parseTimestamp, generateAnalysisKey, mergeAnalysisData, validateExtractionQuality } = require('./analysis-helpers.cjs');
const { validateAnalysisData } = require('./data-validation.cjs');
const { generateValidationFeedback, calculateQualityScore } = require('./validation-feedback.cjs');
const { logAIOperation, checkForAnomalies } = require('./metrics-collector.cjs');

const GEMINI_API_TIMEOUT_MS = 45000;

const callWeatherFunction = async (lat, lon, timestamp, log) => {
    // ... existing code ...
    // Build weather URL with fallback for development
    const baseUrl = process.env.URL || 'http://localhost:8888';
    const weatherUrl = `${baseUrl}/.netlify/functions/weather`;
    const logContext = { lat, lon, timestamp, weatherUrl, hasEnvUrl: !!process.env.URL };

    // Validate required parameters
    if (!lat || !lon) {
        log('warn', 'Missing required parameters for weather function.', logContext);
        return null;
    }

    // ... existing code ...
    log('debug', 'Calling weather function.', logContext);
    try {
        const response = await fetch(weatherUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
        log('debug', 'Weather function call successful.', { ...logContext, hasWeatherData: !!data });
        return data;
    } catch (error) {
        // ... existing code ...
        log('error', 'Error calling weather function.', { ...logContext, errorMessage: error.message, errorStack: error.stack });
        return null;
    }
};

/**
 * Extracts BMS data from an image using Gemini.
 * @param {string} image - Base64 encoded image data
 * @param {string} mimeType - MIME type of the image
 * @param {Function} log - Logger function
 * @param {Object} context - Execution context
 * @param {string|null} [previousFeedback] - Feedback from previous failed attempt
 * @returns {Promise<{data: Object, tokenMetadata: {inputTokens: number, outputTokens: number, totalTokens: number}}>} Extracted data with token metadata
 */
const extractBmsData = async (image, mimeType, log, context, previousFeedback = null) => {
    // ... existing code ...
    const geminiClient = getGeminiClient();
    const extractionPrompt = getImageExtractionPrompt(previousFeedback);
    // Use Gemini 1.5 Flash 8B - most cost-effective model for structured data extraction
    // Pricing: $0.0375/M input, $0.15/M output (62.5% cheaper than 2.5-flash)
    // Override with GEMINI_MODEL env var if higher quality needed
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b';

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

        // Extract token usage metadata from Gemini response
        const usageMetadata = result.usageMetadata || {};
        const tokenMetadata = {
            inputTokens: usageMetadata.promptTokenCount || 0,
            outputTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0
        };

        // ... existing code ...
        log('info', 'Received response from Gemini API via custom client.', {
            durationMs: duration,
            inputTokens: tokenMetadata.inputTokens,
            outputTokens: tokenMetadata.outputTokens,
            totalTokens: tokenMetadata.totalTokens
        });

        // Safely access nested properties with proper validation
        const candidates = result?.candidates;
        if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
            throw new Error("Invalid response structure from Gemini API: missing candidates array");
        }

        const firstCandidate = candidates[0];
        if (!firstCandidate?.content?.parts || !Array.isArray(firstCandidate.content.parts) || firstCandidate.content.parts.length === 0) {
            throw new Error("Invalid response structure from Gemini API: missing content or parts");
        }

        const rawText = firstCandidate.content.parts[0]?.text;
        // ... existing code ...
        if (!rawText) {
            throw new Error("Invalid response structure from Gemini API: missing text in response");
        }
        // ... existing code ...
        const parsedData = cleanAndParseJson(rawText, log);
        return { data: parsedData, tokenMetadata };

    } catch (error) {
        // ... existing code ...
        const errorMessage = error instanceof Error ? error.message : String(error) || 'Unknown Gemini API error';
        log('error', 'Gemini API call failed.', { error: errorMessage });

        // ... existing code ...
        if (errorMessage.includes('429') || errorMessage.includes('quota')) {
            throw new Error('TRANSIENT_ERROR: Gemini API quota exhausted.');
        }
        // ... existing code ...
        throw new Error(`Gemini API Error: ${errorMessage}`);
    }
};

/**
 * Orchestrates the analysis pipeline.
 * @param {Object} image - Image payload
 * @param {string} image.image - Base64 image data
 * @param {string} image.mimeType - MIME type
 * @param {string} image.fileName - File name
 * @param {boolean} [image.force] - Force re-analysis
 * @param {string} [image.sequenceId] - Sequence ID for Story Mode
 * @param {number} [image.timelinePosition] - Position in sequence
 * @param {Object} systems - Systems collection or data
 * @param {Function} log - Logger function
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Analysis record
 */
const performAnalysisPipeline = async (image, systems, log, context, systemId = null) => {
    // ... existing code ...
    const logContext = { fileName: image.fileName, stage: 'pipeline-start' };
    log('info', 'Starting analysis pipeline.', logContext);

    // Track operation start time for metrics
    const operationStartTime = Date.now();
    let tokensUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    // ... existing code ...
    const withRetry = createRetryWrapper(log);

    const historyCollection = await getCollection("history");
    // ... existing code ...
    const systemsCollection = await getCollection("systems");

    // Configuration: Max extraction attempts with validation feedback
    const MAX_EXTRACTION_ATTEMPTS = 3;
    const MIN_ACCEPTABLE_QUALITY = 60; // Quality score threshold

    let attemptNumber = 0;
    let previousFeedback = null;
    let extractedData = null;
    let analysisRaw = null;
    let integrityValidation = null;
    let validationResult = null;
    let bestAttempt = null; // Track best attempt in case all fail

    // Retry loop for extraction with validation feedback
    while (attemptNumber < MAX_EXTRACTION_ATTEMPTS) {
        attemptNumber++;

        // 1. Extract Data (with feedback from previous attempt if applicable)
        logContext.stage = 'extraction';
        logContext.attemptNumber = attemptNumber;
        logContext.isRetry = attemptNumber > 1;

        if (attemptNumber > 1) {
            log('warn', `Data extraction retry attempt ${attemptNumber} of ${MAX_EXTRACTION_ATTEMPTS}.`, {
                ...logContext,
                hasFeedback: !!previousFeedback
            });
        } else {
            log('info', 'Starting data extraction.', logContext);
        }

        try {
            const extractionResult = await extractBmsData(image.image, image.mimeType, log, context, previousFeedback);
            extractedData = extractionResult.data;
            // Accumulate token usage across retries
            inputTokens += extractionResult.tokenMetadata.inputTokens;
            outputTokens += extractionResult.tokenMetadata.outputTokens;
            tokensUsed += extractionResult.tokenMetadata.totalTokens;
            log('info', 'Data extraction complete.', {
                ...logContext,
                inputTokens: extractionResult.tokenMetadata.inputTokens,
                outputTokens: extractionResult.tokenMetadata.outputTokens
            });
        } catch (error) {
            log('error', `Data extraction attempt ${attemptNumber} failed.`, {
                ...logContext,
                error: error.message
            });

            // If this is the last attempt, throw the error
            if (attemptNumber >= MAX_EXTRACTION_ATTEMPTS) {
                throw error;
            }

            // Otherwise, prepare generic feedback and retry
            previousFeedback = `RETRY ATTEMPT ${attemptNumber + 1}: The previous extraction attempt failed with an error: ${error.message}. Please try again, paying careful attention to all fields.`;
            continue;
        }

        // 2. Map and Post-Process
        logContext.stage = 'processing';
        log('info', 'Processing and analyzing data.', logContext);
        analysisRaw = mapExtractedToAnalysisData(extractedData, log);

        if (!analysisRaw) {
            log('error', `Failed to map extracted data on attempt ${attemptNumber}.`, logContext);

            if (attemptNumber >= MAX_EXTRACTION_ATTEMPTS) {
                throw new Error("Failed to map extracted data.");
            }

            previousFeedback = `RETRY ATTEMPT ${attemptNumber + 1}: The previous extraction attempt produced data that could not be mapped. Ensure your response is a valid JSON object following the schema exactly.`;
            continue;
        }

        // Validate extraction quality
        validationResult = validateExtractionQuality(extractedData, analysisRaw, log);

        // Perform data integrity validation
        logContext.stage = 'validation';
        log('info', 'Validating data integrity.', logContext);
        integrityValidation = validateAnalysisData(analysisRaw, log);

        // Calculate quality score
        const qualityScore = calculateQualityScore(integrityValidation);

        // Track best attempt so far (store only metadata to avoid large object copies)
        if (!bestAttempt || qualityScore > bestAttempt.qualityScore) {
            bestAttempt = {
                extractedData,
                analysisRaw,
                integrityValidation,
                validationResult,
                qualityScore,
                attemptNumber
            };
        }

        // Log validation results
        if (!integrityValidation.isValid) {
            log('warn', `Data integrity validation failed on attempt ${attemptNumber}.`, {
                ...logContext,
                qualityScore,
                warningCount: integrityValidation.warnings.length,
                flagCount: integrityValidation.flags.length,
                warnings: integrityValidation.warnings
            });
        } else if (integrityValidation.warnings.length > 0) {
            log('info', `Data integrity validation passed with warnings on attempt ${attemptNumber}.`, {
                ...logContext,
                qualityScore,
                warningCount: integrityValidation.warnings.length,
                warnings: integrityValidation.warnings
            });
        } else {
            log('info', `Data integrity validation passed without warnings on attempt ${attemptNumber}.`, {
                ...logContext,
                qualityScore
            });
        }

        // Success criteria: Either perfect validation OR acceptable quality score
        if (integrityValidation.isValid && integrityValidation.warnings.length === 0) {
            log('info', 'Extraction succeeded with perfect validation.', {
                ...logContext,
                qualityScore,
                finalAttemptNumber: attemptNumber
            });
            break; // Success!
        }

        if (qualityScore >= MIN_ACCEPTABLE_QUALITY) {
            log('info', 'Extraction succeeded with acceptable quality.', {
                ...logContext,
                qualityScore,
                finalAttemptNumber: attemptNumber
            });
            break; // Good enough!
        }

        // If we've exhausted attempts, use best attempt
        if (attemptNumber >= MAX_EXTRACTION_ATTEMPTS) {
            log('warn', `All ${MAX_EXTRACTION_ATTEMPTS} extraction attempts completed. Using best attempt.`, {
                ...logContext,
                bestAttemptNumber: bestAttempt.attemptNumber,
                bestQualityScore: bestAttempt.qualityScore,
                finalQualityScore: qualityScore
            });

            // Restore best attempt data
            if (bestAttempt.attemptNumber !== attemptNumber) {
                extractedData = bestAttempt.extractedData;
                analysisRaw = bestAttempt.analysisRaw;
                integrityValidation = bestAttempt.integrityValidation;
                validationResult = bestAttempt.validationResult;
            }

            break; // Exit loop with best attempt
        }

        // Generate feedback for next attempt
        // Note: attemptNumber is 1-based, so attemptNumber+1 is the next attempt number
        previousFeedback = generateValidationFeedback(integrityValidation, attemptNumber + 1);

        log('info', 'Preparing to retry extraction with validation feedback.', {
            ...logContext,
            currentAttempt: attemptNumber,
            nextAttempt: attemptNumber + 1,
            feedbackLength: previousFeedback ? previousFeedback.length : 0
        });
    }

    // Log extraction quality for transparency
    if (validationResult.hasCriticalIssues) {
        log('error', 'Critical data extraction issues detected.', {
            qualityScore: validationResult.qualityScore,
            warnings: validationResult.warnings
        });
    } else if (!validationResult.isComplete) {
        log('warn', 'Data extraction quality is below optimal.', {
            qualityScore: validationResult.qualityScore,
            warnings: validationResult.warnings
        });
    }

    const allSystems = (systems && systems.items) ? systems.items : await withRetry(() => systemsCollection.find({}).toArray());
    // ... existing code ...
    const matchingSystem = (systemId && allSystems)
        ? allSystems.find(s => s.id === systemId)
        : (analysisRaw.hardwareSystemId && analysisRaw.hardwareSystemId !== 'UNKNOWN'
            ? allSystems.find(s => (s.associatedHardwareIds || s.associatedDLs)?.includes(analysisRaw.hardwareSystemId))
            : null);

    const analysis = performPostAnalysis(analysisRaw, matchingSystem, log);

    // Add validation metadata to analysis
    analysis._extractionQuality = validationResult;
    analysis._validationScore = calculateQualityScore(integrityValidation);
    analysis._extractionAttempts = attemptNumber;

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

    // If force re-analysis and existing record found, merge intelligently
    if (existingRecord && image.force) {
        log('info', 'Force re-analysis: merging new data with existing record.', { ...logContext, recordId: existingRecord.id });

        // Merge analysis data - prefer non-null/non-empty values from new analysis
        const mergedAnalysis = mergeAnalysisData(existingRecord.analysis, analysis, log);

        // Update existing record with merged data
        const updatePayload = {
            $set: {
                analysis: mergedAnalysis,
                timestamp, // Update timestamp to reflect re-analysis
                weather: weather || existingRecord.weather, // Keep existing weather if new one fails
                lastReanalyzed: new Date().toISOString(),
                reanalysisCount: (existingRecord.reanalysisCount || 0) + 1,
                needsReview: !integrityValidation.isValid,
                validationWarnings: integrityValidation.warnings,
                validationScore: calculateQualityScore(integrityValidation),
                extractionAttempts: attemptNumber
            }
        };

        await withRetry(() => historyCollection.updateOne(
            { id: existingRecord.id },
            updatePayload
        ));

        log('info', 'Successfully updated existing record with re-analysis data.', {
            ...logContext,
            recordId: existingRecord.id,
            reanalysisCount: (existingRecord.reanalysisCount || 0) + 1
        });

        // Return updated record
        return {
            ...existingRecord,
            analysis: mergedAnalysis,
            timestamp,
            weather: weather || existingRecord.weather,
            lastReanalyzed: new Date().toISOString(),
            reanalysisCount: (existingRecord.reanalysisCount || 0) + 1,
            needsReview: !integrityValidation.isValid,
            validationWarnings: integrityValidation.warnings,
            validationScore: calculateQualityScore(integrityValidation),
            extractionAttempts: attemptNumber
        };
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
        hardwareSystemId: analysis.hardwareSystemId,
        dlNumber: analysis.hardwareSystemId, // Legacy compat
        // ... existing code ...
        fileName: image.fileName,
        analysisKey,
        // ... existing code ...
        status: 'completed', // For sync, it's always completed
        reanalysisCount: 0,
        // Add validation metadata
        needsReview: !integrityValidation.isValid,
        validationWarnings: integrityValidation.warnings,
        validationScore: calculateQualityScore(integrityValidation),
        extractionAttempts: attemptNumber,
        // Story Mode / Sequence Modeling
        sequenceId: image.sequenceId || null,
        timelinePosition: image.timelinePosition !== undefined ? image.timelinePosition : null
    };

    await withRetry(() => historyCollection.insertOne(newRecord));
    // ... existing code ...
    log('info', 'Successfully saved new analysis record.', { ...logContext, recordId: newRecord.id });

    // Log operation metrics
    const operationDuration = Date.now() - operationStartTime;
    try {
        await logAIOperation({
            operation: 'analysis',
            systemId: newRecord.systemId,
            duration: operationDuration,
            tokensUsed: tokensUsed || 0,
            inputTokens: inputTokens || 0,
            outputTokens: outputTokens || 0,
            success: true,
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            metadata: {
                fileName: image.fileName,
                extractionAttempts: attemptNumber,
                qualityScore: newRecord.validationScore,
                needsReview: newRecord.needsReview
            }
        });

        // Check for anomalies
        await checkForAnomalies({
            duration: operationDuration,
            cost: 0 // Cost will be calculated by logAIOperation
        });
    } catch (metricsError) {
        // Don't fail the operation if metrics logging fails
        log('warn', 'Failed to log operation metrics', { error: metricsError.message });
    }

    return newRecord;
};

module.exports = { performAnalysisPipeline };

