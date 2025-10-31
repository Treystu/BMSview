const { getCollection } = require('./utils/mongodb.js');
const { createLogger } = require("./utils/logger.js");
const { checkSecurity, HttpError } = require('./security.js');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.js');

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async (event, context) => {
    const log = createLogger('analyze', context);
    log('info', 'analyze.js handler function invoked');
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };

    try {
        if (httpMethod !== 'POST') {
            return respond(405, { error: 'Method Not Allowed' });
        }

        // 1. Perform security check (rate limiting, IP blocking)
        await checkSecurity(event, log);
        
        const body = JSON.parse(event.body);
        const { image, systems } = body;
        
        if (!image || !image.image || !image.fileName || !image.mimeType) {
            log('warn', 'Invalid request body. "image" object is missing or incomplete.', logContext);
            return respond(400, { error: "Invalid request: 'image' object with fileName, image (base64), and mimeType is required." });
        }

        const isSync = event.queryStringParameters?.sync === 'true';

        if (isSync) {
            // --- SYNCHRONOUS FLOW ---
            // This is the new, primary path.
            // It does all work immediately and returns the result.
            // It's faster for the user and avoids all job queue complexity.
            log('info', 'Starting synchronous analysis.', { ...logContext, fileName: image.fileName });

            const analysisRecord = await performAnalysisPipeline(image, systems, log, context);
            
            log('info', 'Synchronous analysis complete.', { ...logContext, recordId: analysisRecord.id, fileName: image.fileName });
            
            // Return the full analysis record
            return respond(200, analysisRecord);

        } else {
            // --- ASYNCHRONOUS FLOW (Legacy / Fallback) ---
            // This path is no longer used by the refactored frontend,
            // but is kept for compatibility or future bulk-upload features.
            log('warn', 'Legacy async analysis path triggered. This is deprecated.', { ...logContext, fileName: image.fileName });
            // You would re-implement the old job creation logic here if needed.
            // For now, we'll just return an error to indicate it's not supported.
            return respond(400, { error: "Asynchronous analysis is no longer supported. Please use the 'sync=true' parameter." });
        }

    } catch (error) {
        log('error', "Critical error in analyze dispatcher.", { ...logContext, errorMessage: error.message, stack: error.stack });
        if (error instanceof HttpError) {
            return respond(error.statusCode, { error: error.message });
        }
        if (error.message.includes('TRANSIENT_ERROR')) {
            // Specifically catch transient errors (like quota) and return a 429
            return respond(429, { error: "Analysis failed: " + error.message });
        }
        return respond(500, { error: "An internal server error occurred: " + error.message });
    }
};

