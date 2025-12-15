const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

const MIN_DL_DIGITS = 6;
const MAX_DL_DIGITS = 14;
// digitPattern enforces between MIN and MAX digits while allowing at most one space or dash between digits:
// one digit followed by MIN-1 to MAX-1 groups of (optional single space/dash + digit)
const digitPattern = `\\d(?:[ -]?\\d){${MIN_DL_DIGITS - 1},${MAX_DL_DIGITS - 1}}`;

const dlRegexes = [
    // DL-prefixed variants with optional punctuation/spacing and 0-4 letters to allow state/region codes
    new RegExp(`\\bDL(?:[#\\s:-]|\\s+No\\.?)?[\\s:-]*([A-Z]{0,4}${digitPattern})`, 'gi'),
    new RegExp(`\\bD\\/L\\b[\\s:-]*([A-Z]{0,4}${digitPattern})`, 'gi'),
    new RegExp(`\\bdrivers?\\s+licen[cs]e\\b[\\s:-]*([A-Z]{0,4}${digitPattern})`, 'gi'),
    // Alternate prefixes: short (2-3 letters) code followed by a dash and numbers (e.g., AB-123456), constrained to reduce false positives
    new RegExp(`\\b[A-Z]{2,3}-(${digitPattern})\\b`, 'gi')
];

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

        const extractedDLs = new Set();

        for (const pattern of dlRegexes) {
            for (const match of text.matchAll(pattern)) {
                if (typeof match[1] === 'undefined') {
                    log.warn('Regex match missing expected capture group', { pattern: pattern.toString(), match });
                    continue;
                }
                const candidate = match[1].trim();
                const digitsOnly = candidate.replace(/\D/g, '');

                if (digitsOnly.length >= MIN_DL_DIGITS && digitsOnly.length <= MAX_DL_DIGITS) {
                    extractedDLs.add(digitsOnly);
                } else {
                    log.debug('Discarded DL candidate outside accepted digit range', { 
                        candidate, 
                        digitsOnlyLength: digitsOnly.length,
                        minDigits: MIN_DL_DIGITS,
                        maxDigits: MAX_DL_DIGITS
                    });
                }
            }
        }

        const dlNumbers = Array.from(extractedDLs);
        const success = dlNumbers.length > 0;
        
        timer.end({ dlCount: dlNumbers.length });
        if (success) {
            log.info('DL extraction completed', { 
                dlCount: dlNumbers.length,
                dlNumbers: dlNumbers.slice(0, 5) // Log first 5 to avoid logging too much
            });
        } else {
            log.warn('No DL numbers extracted from text', { 
                dlCount: 0,
                textPreview: text.slice(0, 200),
                textLength: text.length
            });
        }
        log.exit(200);

        return respond(200, { 
            dlNumbers,
            count: dlNumbers.length,
            success
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
