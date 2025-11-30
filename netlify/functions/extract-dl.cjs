const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

const respond = (statusCode, body, headers = {}) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
});

exports.handler = async function(event, context) {
    const headers = getCorsHeaders(event);
    
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }
    
    const log = createLoggerFromEvent('extract-dl', event, context);
    log.entry({ method: event.httpMethod, path: event.path });
    const timer = createTimer(log, 'extract-dl');

    if (event.httpMethod !== 'POST') {
        log.warn('Method not allowed', { method: event.httpMethod });
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return respond(405, { error: 'Method Not Allowed' }, headers);
    }

    try {
        log.debug('Parsing request body');
        const parsedBody = JSON.parse(event.body);
        const { text } = parsedBody;
        log.info('Processing DL extraction request', { textLength: text?.length });

        if (!text || typeof text !== 'string') {
            log.warn('Missing or invalid text in request body');
            timer.end({ error: 'invalid_text' });
            log.exit(400);
            return respond(400, { error: 'Missing or invalid text field.' }, headers);
        }

        // Extract DL numbers using regex patterns
        // Common BMS DL patterns: DL123456, DL-123456, DL 123456, etc.
        const dlPatterns = [
            /DL[-\s]?(\d{6,8})/gi,
            /DL[:\s]?(\d{6,8})/gi,
            /DL(\d{6,8})/gi,
            /\b[A-Z]{2}\d{6,8}\b/gi // General pattern for 2 letters + 6-8 digits
        ];

        let extractedDLs = new Set();
        
        for (const pattern of dlPatterns) {
            const matches = text.match(pattern);
            if (matches) {
                for (const match of matches) {
                    // Extract just the numeric part
                    const numericMatch = match.match(/\d+/);
                    if (numericMatch) {
                        extractedDLs.add(numericMatch[0]);
                    }
                }
            }
        }

        const dlNumbers = Array.from(extractedDLs);
        
        timer.end({ dlCount: dlNumbers.length });
        log.info('DL extraction completed', { 
            dlCount: dlNumbers.length,
            dlNumbers: dlNumbers.slice(0, 5) // Log first 5 to avoid logging too much
        });
        log.exit(200);

        return respond(200, { 
            dlNumbers,
            count: dlNumbers.length,
            success: true
        }, headers);

    } catch (error) {
        timer.end({ error: true });
        log.error('Critical error in extract-dl function', { 
            error: error.message, 
            stack: error.stack 
        });
        log.exit(500);
        return respond(500, { error: 'Internal server error during DL extraction.' }, headers);
    }
};
