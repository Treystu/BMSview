/**
 * Enhanced Analyze Function
 * Includes environment-aware URLs and comprehensive logging
 */

const { getCollection } = require('./utils/dbClient.js');
const { createLogger } = require("./utils/logger.js");
const { getConfig } = require("./utils/config.js");
const { v4: uuidv4 } = require("uuid");
const { checkSecurity, HttpError } = require('./security.js');

const getBasename = (path) => path ? path.split(/[/\\]/).pop() || '' : '';

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    },
});

/**
 * Invoke background processor with environment-aware URL
 */
const invokeProcessor = async (jobId, logger, config) => {
    const invokeUrl = config.getFunctionUrl('process-analysis');
    
    logger.info('Invoking background processor', { 
        jobId, 
        invokeUrl,
        context: config.site.context
    });

    try {
        const response = await fetch(invokeUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-netlify-background': 'true'
            },
            body: JSON.stringify({ jobId }),
        });

        logger.info('Background processor invoked', {
            jobId,
            status: response.status,
            ok: response.ok
        });

        return response.ok;
    } catch (error) {
        logger.error('Failed to invoke background processor', {
            jobId,
            error: error.message
        });
        return false;
    }
};

exports.handler = async (event, context) => {
    const logger = createLogger('analyze', context);
    const config = getConfig();
    
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;

    logger.entry({
        clientIp,
        httpMethod,
        path: event.path,
        bodySize: event.body?.length || 0
    });

    try {
        if (httpMethod !== 'POST') {
            logger.warn('Method not allowed', { httpMethod });
            return respond(405, { error: 'Method Not Allowed' });
        }

        // Security check
        logger.info('Performing security check');
        await checkSecurity(event, logger);
        logger.info('Security check passed');

        // Parse request body
        const body = JSON.parse(event.body);
        const { images, systems } = body;

        logger.info('Request parsed', {
            imageCount: images?.length || 0,
            systemCount: systems?.length || 0
        });

        if (!Array.isArray(images) || images.length === 0) {
            logger.warn('No images provided');
            return respond(400, { error: "No images provided for analysis." });
        }

        // Get collections
        const historyCollection = await getCollection("history");
        const jobsCollection = await getCollection("jobs");

        logger.info('Starting batch analysis', {
            imageCount: images.length,
            systemCount: systems?.length || 0
        });

        // Check for existing records
        const basenamesToCheck = images.map(img => getBasename(img.fileName));
        
        logger.dbOperation('find', 'history', {
            filter: { fileName: { $in: basenamesToCheck } }
        });

        const existingRecords = await historyCollection
            .find({ fileName: { $in: basenamesToCheck } })
            .toArray();

        const existingRecordMap = new Map(
            existingRecords.map(r => [r.fileName, r])
        );

        logger.info('Existing records checked', {
            total: basenamesToCheck.length,
            existing: existingRecords.length,
            new: basenamesToCheck.length - existingRecords.length
        });

        // Process images and create jobs
        const jobCreationResponses = [];
        const batchBasenames = new Set();
        const jobsToInsert = [];

        for (const [index, image] of images.entries()) {
            const basename = getBasename(image.fileName);

            // Check for duplicates in current batch
            if (batchBasenames.has(basename)) {
                logger.debug('Duplicate in batch', { fileName: image.fileName });
                jobCreationResponses.push({
                    fileName: image.fileName,
                    status: 'duplicate_batch'
                });
                continue;
            }
            batchBasenames.add(basename);

            // Check for duplicates in history
            const existingRecord = existingRecordMap.get(basename);
            if (existingRecord && !image.force) {
                logger.debug('Duplicate in history', {
                    fileName: image.fileName,
                    existingRecordId: existingRecord.id
                });
                jobCreationResponses.push({
                    fileName: image.fileName,
                    status: 'duplicate_history',
                    duplicateRecordId: existingRecord.id
                });
                continue;
            }

            // Create new job
            const newJobId = uuidv4();
            logger.debug('Creating job', {
                jobId: newJobId,
                fileName: image.fileName,
                index
            });

            jobsToInsert.push({
                _id: newJobId,
                id: newJobId,
                fileName: image.fileName,
                status: "Queued",
                image: image.image,
                mimeType: image.mimeType,
                systems,
                createdAt: new Date().toISOString(),
                retryCount: 0,
                lastHeartbeat: new Date().toISOString()
            });

            jobCreationResponses.push({
                fileName: image.fileName,
                jobId: newJobId,
                status: 'Submitted'
            });
        }

        // Insert jobs
        if (jobsToInsert.length > 0) {
            logger.dbOperation('insertMany', 'jobs', {
                count: jobsToInsert.length
            });

            await jobsCollection.insertMany(jobsToInsert);

            logger.info('Jobs created', {
                count: jobsToInsert.length,
                jobIds: jobsToInsert.map(j => j.id)
            });

            // Invoke background processor for each job
            const invocationPromises = jobsToInsert.map(job =>
                invokeProcessor(job.id, logger, config)
            );

            const invocationResults = await Promise.allSettled(invocationPromises);
            
            const successCount = invocationResults.filter(r => 
                r.status === 'fulfilled' && r.value
            ).length;

            logger.info('Background processors invoked', {
                total: jobsToInsert.length,
                successful: successCount,
                failed: jobsToInsert.length - successCount
            });
        } else {
            logger.info('No new jobs to create', {
                totalImages: images.length,
                duplicates: images.length
            });
        }

        logger.info('Batch analysis completed', {
            totalImages: images.length,
            newJobs: jobsToInsert.length,
            duplicates: images.length - jobsToInsert.length
        });

        logger.exit(200, {
            newJobs: jobsToInsert.length,
            duplicates: images.length - jobsToInsert.length
        });

        return respond(200, {
            message: `Analysis initiated for ${jobsToInsert.length} images.`,
            jobs: jobCreationResponses
        });

    } catch (error) {
        if (error instanceof HttpError) {
            logger.warn('Security check failed', {
                status: error.statusCode,
                message: error.message
            });
            return respond(error.statusCode, { error: error.message });
        }

        logger.error('Analysis failed', {
            error: error.message,
            stack: error.stack
        });

        logger.exit(500, { error: error.message });

        return respond(500, {
            error: 'Internal server error',
            message: error.message
        });
    }
};