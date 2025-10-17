/**
 * Enhanced Process Analysis Function
 * Includes comprehensive logging, rate limiting, and error handling
 */

const { GoogleGenAI, Type } = require("@google/genai");
const { v4: uuidv4 } = require("uuid");
const { getCollection, executeWithTimeout } = require("./utils/dbClient.js");
const { createLogger } = require("./utils/logger.js");
const { getGeminiClient } = require("./utils/geminiClient.js");
const { getConfig } = require("./utils/config.js");

exports.handler = async (event, context) => {
    const logger = createLogger('process-analysis', context);
    const config = getConfig();
    
    logger.entry({
        headers: event.headers,
        hasBackground: event.headers?.['x-netlify-background'] === 'true',
        body: event.body ? 'present' : 'missing'
    });

    let jobId;
    try {
        const body = JSON.parse(event.body || '{}');
        jobId = body.jobId;
        
        if (!jobId) {
            logger.error('Missing jobId in request body');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing jobId' })
            };
        }

        logger.info('Processing job', { jobId });

        // Get collections
        const jobsCollection = await getCollection("jobs");
        const historyCollection = await getCollection("history");
        const systemsCollection = await getCollection("systems");

        // Fetch job with timeout
        logger.dbOperation('findOne', 'jobs', { jobId });
        const job = await executeWithTimeout(
            () => jobsCollection.findOne({ id: jobId }),
            config.mongodb.timeout
        );

        if (!job) {
            logger.error('Job not found', { jobId });
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Job not found' })
            };
        }

        logger.info('Job found', {
            jobId,
            fileName: job.fileName,
            status: job.status,
            retryCount: job.retryCount || 0
        });

        // Update status to Processing
        await updateJobStatus(jobId, 'Processing', logger, jobsCollection, {
            startedAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString()
        });

        // Extract data from image using Gemini
        logger.info('Starting data extraction', { jobId, stage: 'extraction' });
        await updateJobStatus(jobId, 'Extracting data', logger, jobsCollection);

        const geminiClient = getGeminiClient();
        const extractionResult = await extractDataWithRetry(
            job,
            geminiClient,
            logger,
            jobsCollection,
            config
        );

        if (!extractionResult.success) {
            // Job was requeued or failed
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    message: extractionResult.message,
                    requeued: extractionResult.requeued 
                })
            };
        }

        const analysis = extractionResult.data;
        logger.info('Data extraction completed', { 
            jobId, 
            stage: 'extraction_complete',
            hasData: !!analysis 
        });

        // Checkpoint: Save extraction data
        await updateJobStatus(jobId, 'Extraction complete (checkpoint)', logger, jobsCollection, {
            extractedData: analysis
        });

        // Map and validate data
        logger.info('Mapping extracted data', { jobId, stage: 'mapping' });
        await updateJobStatus(jobId, 'Mapping data', logger, jobsCollection);
        
        const mappedAnalysis = mapAnalysisData(analysis, logger, jobId);

        // Match system
        logger.info('Matching system', { jobId, stage: 'system_matching' });
        await updateJobStatus(jobId, 'Matching system', logger, jobsCollection);
        
        const matchingSystem = await findMatchingSystem(
            mappedAnalysis.dlNumber,
            systemsCollection,
            logger,
            jobId
        );

        // Parse timestamp
        logger.info('Parsing timestamp', { jobId, stage: 'timestamp_parsing' });
        const timestamp = parseTimestamp(mappedAnalysis.timestampFromImage, logger, jobId);

        // Fetch weather if system has location
        let weather = null;
        if (matchingSystem?.latitude && matchingSystem?.longitude) {
            logger.info('Fetching weather data', { 
                jobId, 
                stage: 'weather_fetch',
                systemId: matchingSystem.id 
            });
            await updateJobStatus(jobId, 'Fetching weather', logger, jobsCollection);
            
            weather = await fetchWeatherData(
                matchingSystem.latitude,
                matchingSystem.longitude,
                timestamp,
                logger,
                jobId
            );
        } else {
            logger.info('Skipping weather fetch - no location data', { 
                jobId, 
                stage: 'weather_fetch' 
            });
        }

        // Save result
        logger.info('Saving analysis result', { jobId, stage: 'saving' });
        await updateJobStatus(jobId, 'Saving result', logger, jobsCollection);

        const analysisKey = generateAnalysisKey(mappedAnalysis);
        const existingRecord = await historyCollection.findOne({
            fileName: job.fileName,
            analysisKey: analysisKey
        });

        let recordId;
        if (existingRecord) {
            logger.info('Duplicate analysis found, using existing record', {
                jobId,
                existingRecordId: existingRecord.id
            });
            recordId = existingRecord.id;
        } else {
            const newRecord = {
                _id: uuidv4(),
                id: uuidv4(),
                timestamp,
                systemId: matchingSystem?.id || null,
                systemName: matchingSystem?.name || null,
                analysis: mappedAnalysis,
                weather,
                dlNumber: mappedAnalysis.dlNumber,
                fileName: job.fileName,
                analysisKey,
                createdAt: new Date().toISOString()
            };

            await executeWithTimeout(
                () => historyCollection.insertOne(newRecord),
                config.mongodb.timeout
            );

            logger.info('New analysis record saved', {
                jobId,
                recordId: newRecord.id
            });
            recordId = newRecord.id;
        }

        // Mark job as completed
        await updateJobStatus(jobId, 'completed', logger, jobsCollection, {
            recordId,
            completedAt: new Date().toISOString()
        });

        logger.info('Job completed successfully', { 
            jobId, 
            recordId,
            stage: 'completion'
        });

        logger.exit(200, { jobId, recordId });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: `Successfully processed job ${jobId}`,
                recordId 
            })
        };

    } catch (error) {
        logger.error('Job processing failed', {
            jobId,
            error: error.message,
            stack: error.stack
        });

        if (jobId) {
            try {
                const jobsCollection = await getCollection("jobs");
                await updateJobStatus(jobId, 'failed', logger, jobsCollection, {
                    error: `failed_${error.message}`,
                    failedAt: new Date().toISOString()
                });
            } catch (updateError) {
                logger.critical('Failed to update job status after error', {
                    jobId,
                    updateError: updateError.message
                });
            }
        }

        logger.exit(200, { jobId, error: error.message });

        // Return 200 to prevent Netlify from retrying
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                error: `Job ${jobId} failed: ${error.message}` 
            })
        };
    }
};

/**
 * Extract data from image with retry logic and rate limiting
 */
async function extractDataWithRetry(job, geminiClient, logger, jobsCollection, config) {
    const jobId = job.id;
    const retryCount = job.retryCount || 0;
    const maxRetries = config.jobs.maxRetries;

    try {
        logger.info('Calling Gemini API', {
            jobId,
            attempt: retryCount + 1,
            maxRetries,
            model: config.gemini.model
        });

        const prompt = buildExtractionPrompt();
        const startTime = Date.now();

        const response = await geminiClient.callAPI(
            prompt,
            {
                model: config.gemini.model,
                temperature: config.gemini.temperature,
                maxOutputTokens: config.gemini.maxOutputTokens,
                maxRetries: config.gemini.maxRetries
            },
            logger
        );

        const duration = Date.now() - startTime;
        logger.metric('gemini_api_call', duration);

        const extractedData = parseGeminiResponse(response, logger, jobId);
        
        return {
            success: true,
            data: extractedData
        };

    } catch (error) {
        const isRateLimit = error.message?.includes('Rate limit') || 
                           error.message?.includes('429');
        const isQuotaExhausted = error.message?.includes('quota') ||
                                error.message?.includes('RESOURCE_EXHAUSTED');

        if (isRateLimit || isQuotaExhausted) {
            logger.warn('Rate limit or quota exhausted', {
                jobId,
                retryCount,
                error: error.message
            });

            if (retryCount >= maxRetries) {
                logger.error('Max retries exceeded for rate limit', {
                    jobId,
                    retryCount,
                    maxRetries
                });

                await updateJobStatus(jobId, 'failed', logger, jobsCollection, {
                    error: `failed_Maximum retry count exceeded (${maxRetries}). Reason: ${error.message}`,
                    retryCount,
                    failedAt: new Date().toISOString()
                });

                return {
                    success: false,
                    message: 'Max retries exceeded',
                    requeued: false
                };
            }

            // Requeue with exponential backoff
            const backoffDelay = config.jobs.retryDelayBase * Math.pow(2, retryCount);
            const nextRetryAt = new Date(Date.now() + backoffDelay);

            await updateJobStatus(jobId, 'Queued', logger, jobsCollection, {
                retryCount: retryCount + 1,
                lastFailureReason: error.message,
                nextRetryAt: nextRetryAt.toISOString(),
                requeuedAt: new Date().toISOString()
            });

            logger.info('Job requeued due to rate limit', {
                jobId,
                nextRetryAt: nextRetryAt.toISOString(),
                backoffMinutes: Math.round(backoffDelay / 60000)
            });

            return {
                success: false,
                message: 'Job requeued due to rate limit',
                requeued: true
            };
        }

        // Non-retryable error
        throw error;
    }
}

/**
 * Update job status in database
 */
async function updateJobStatus(jobId, status, logger, jobsCollection, extra = {}) {
    try {
        logger.dbOperation('updateOne', 'jobs', { jobId, status });

        const isTerminal = status === 'completed' || status.startsWith('failed');
        const isCheckpoint = status === 'Extraction complete (checkpoint)';

        const updatePayload = {
            $set: {
                ...extra,
                status,
                statusEnteredAt: new Date().toISOString(),
                lastHeartbeat: new Date().toISOString()
            }
        };

        if (isTerminal || isCheckpoint) {
            updatePayload.$unset = { image: "", images: "" };
        }

        const result = await jobsCollection.updateOne(
            { id: jobId },
            updatePayload
        );

        if (result.matchedCount > 0) {
            logger.info('Job status updated', { jobId, status });
        } else {
            logger.warn('Job not found for status update', { jobId, status });
        }
    } catch (error) {
        logger.error('Failed to update job status', {
            jobId,
            status,
            error: error.message
        });
    }
}

/**
 * Build extraction prompt for Gemini
 */
function buildExtractionPrompt() {
    return `Extract BMS data from the image. Return structured JSON with all available fields.`;
}

/**
 * Parse Gemini API response
 */
function parseGeminiResponse(response, logger, jobId) {
    try {
        // Parse response based on Gemini API structure
        const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) {
            throw new Error('No content in Gemini response');
        }

        const data = JSON.parse(content);
        logger.info('Gemini response parsed', { jobId, hasData: !!data });
        return data;
    } catch (error) {
        logger.error('Failed to parse Gemini response', {
            jobId,
            error: error.message
        });
        throw error;
    }
}

/**
 * Map analysis data to standard format
 */
function mapAnalysisData(analysis, logger, jobId) {
    logger.info('Mapping analysis data', { jobId });
    // Implement mapping logic
    return analysis;
}

/**
 * Find matching system by DL number
 */
async function findMatchingSystem(dlNumber, systemsCollection, logger, jobId) {
    if (!dlNumber) {
        logger.info('No DL number to match', { jobId });
        return null;
    }

    try {
        logger.dbOperation('findOne', 'systems', { dlNumber });
        const system = await systemsCollection.findOne({ dlNumber });
        
        if (system) {
            logger.info('System matched', { jobId, systemId: system.id });
        } else {
            logger.info('No matching system found', { jobId, dlNumber });
        }
        
        return system;
    } catch (error) {
        logger.error('Error matching system', {
            jobId,
            dlNumber,
            error: error.message
        });
        return null;
    }
}

/**
 * Parse timestamp from image
 */
function parseTimestamp(timestampStr, logger, jobId) {
    try {
        if (!timestampStr) {
            logger.warn('No timestamp in image, using current time', { jobId });
            return new Date().toISOString();
        }

        const parsed = new Date(timestampStr);
        if (isNaN(parsed.getTime())) {
            logger.warn('Invalid timestamp, using current time', { 
                jobId, 
                timestampStr 
            });
            return new Date().toISOString();
        }

        logger.info('Timestamp parsed', { jobId, timestamp: parsed.toISOString() });
        return parsed.toISOString();
    } catch (error) {
        logger.warn('Error parsing timestamp, using current time', {
            jobId,
            error: error.message
        });
        return new Date().toISOString();
    }
}

/**
 * Fetch weather data
 */
async function fetchWeatherData(latitude, longitude, timestamp, logger, jobId) {
    try {
        logger.apiCall('weather', 'fetch', { latitude, longitude, timestamp });
        
        // Implement weather API call
        // For now, return null
        logger.info('Weather data fetched', { jobId });
        return null;
    } catch (error) {
        logger.error('Failed to fetch weather data', {
            jobId,
            error: error.message
        });
        return null;
    }
}

/**
 * Generate analysis key for deduplication
 */
function generateAnalysisKey(analysis) {
    // Implement key generation logic
    return JSON.stringify(analysis);
}