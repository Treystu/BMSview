const { createLogger } = require('./utils/logger.cjs');

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('extract-dl', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod, body } = event;
    const logContext = { clientIp, httpMethod };

    log('info', 'Extract DL function invoked.', { ...logContext, path: event.path });

    if (httpMethod !== 'POST') {
        log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
        return respond(405, { error: 'Method Not Allowed' });
    }

    try {
        const parsedBody = JSON.parse(body);
        const { text } = parsedBody;
        const requestLogContext = { ...logContext, textLength: text?.length };
        log('info', 'Processing DL extraction request.', requestLogContext);

        if (!text || typeof text !== 'string') {
            log('warn', 'Missing or invalid text in request body.', requestLogContext);
            return respond(400, { error: 'Missing or invalid text field.' });
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
        
        log('info', 'DL extraction completed.', { 
            ...requestLogContext, 
            dlCount: dlNumbers.length,
            dlNumbers: dlNumbers.slice(0, 5) // Log first 5 to avoid logging too much
        });

        return respond(200, { 
            dlNumbers,
            count: dlNumbers.length,
            success: true
        });

    } catch (error) {
        log('error', 'Critical error in extract-dl function.', { 
            ...logContext, 
            errorMessage: error.message, 
            stack: error.stack 
        });
        return respond(500, { error: 'Internal server error during DL extraction.' });
    }
};
