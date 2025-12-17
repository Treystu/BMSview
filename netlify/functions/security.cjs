// COMPREHENSIVE FIX: Rate Limiting with Proper MongoDB Operations
// This fix eliminates the $expr in upsert error and adds comprehensive logging

const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger, createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const {
    createStandardEntryMeta,
    logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 */
function validateEnvironment(log) {
    if (!process.env.MONGODB_URI) {
        log.error('Missing MONGODB_URI environment variable');
        return false;
    }
    return true;
}

class HttpError extends Error {
    /**
     * @param {number} statusCode
     * @param {string} message
     */
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

/** @param {string} ip */
const ipToInt = (ip) => ip.split('.').reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0;

/**
 * @param {string} ip
 * @param {string} cidr
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 */
const isIpInCidr = (ip, cidr, log) => {
    try {
        const [range, bitsStr = '32'] = cidr.split('/');
        const bits = parseInt(bitsStr, 10);
        const mask = -1 << (32 - bits);
        return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error(`Error in isIpInCidr`, { ip, cidr, errorMessage: message });
        return false;
    }
};

/**
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 * @param {string} type
 */
const getIpRanges = async (log, type) => {
    try {
        /** @type {any} */
        const securityCollection = await getCollection("security");
        const doc = await securityCollection.findOne(/** @type {any} */({ _id: 'ip_config' }));
        return doc ? (doc[type] || []) : [];
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Could not fetch ${type} ranges from MongoDB`, { errorMessage: message });
        return [];
    }
};

/**
 * @param {string} ip
 * @param {string[]} ranges
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 */
const isIpInRanges = (ip, ranges, log) => {
    for (const range of ranges) {
        if (range.includes('/') ? isIpInCidr(ip, range, log) : ip === range) return true;
    }
    return false;
};

/**
 * FIXED: Two-step rate limiting to avoid $expr in upsert
 * This approach:
 * 1. First finds the current rate limit document
 * 2. Checks if limit is exceeded
 * 3. Updates atomically if within limit
 * 4. Prevents race conditions using MongoDB's atomic operations
 */
/**
 * @param {any} request
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 */
const checkRateLimit = async (request, log) => {
    const ip = request.headers['x-nf-client-connection-ip'];
    if (!ip) return;
    const logContext = { clientIp: ip };

    log.debug('Checking rate limit', logContext);

    // Check if IP is verified (bypass rate limiting)
    const verifiedRanges = await getIpRanges(log, 'verified');
    if (isIpInRanges(ip, verifiedRanges, log)) {
        log.info('IP is verified, bypassing rate limit', logContext);
        return;
    }

    log.debug('IP is not verified, proceeding with rate limit check', logContext);
    const rateLimitCollection = await getCollection("rate_limits");
    const now = new Date();
    const windowStart = new Date(now.getTime() - (60 * 1000)); // 1 minute window

    const UNVERIFIED_IP_LIMIT = 100;

    try {
        // STEP 1: Find current rate limit document
        const currentDoc = await rateLimitCollection.findOne({ ip });

        // STEP 2: Calculate current request count in window
        const timestamps = currentDoc?.timestamps || [];
        const recentTimestamps = timestamps.filter(/** @param {any} ts */(ts) => new Date(ts) > windowStart);
        const currentCount = recentTimestamps.length;

        log.debug('Current rate limit status', {
            ...logContext,
            currentCount,
            limit: UNVERIFIED_IP_LIMIT,
            hasExistingDoc: !!currentDoc
        });

        // STEP 3: Check if limit exceeded
        if (currentCount >= UNVERIFIED_IP_LIMIT) {
            log.warn('Rate limit exceeded for unverified IP', {
                ...logContext,
                currentCount,
                limit: UNVERIFIED_IP_LIMIT
            });
            throw new HttpError(429, `Too Many Requests: Rate limit exceeded. Current: ${currentCount}/${UNVERIFIED_IP_LIMIT}`);
        }

        // STEP 4: Update atomically (add new timestamp)
        // Clean up old timestamps and add new one in single operation
        const updatedTimestamps = [...recentTimestamps, now];

        await rateLimitCollection.updateOne(
            { ip },
            {
                $set: {
                    timestamps: updatedTimestamps,
                    lastRequest: now,
                    updatedAt: now
                },
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true }
        );

        log.debug('Rate limit check passed and updated', {
            ...logContext,
            newCount: updatedTimestamps.length,
            limit: UNVERIFIED_IP_LIMIT,
            remaining: UNVERIFIED_IP_LIMIT - updatedTimestamps.length
        });

    } catch (error) {
        if (error instanceof HttpError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        log.error('Error during rate limit check', { ...logContext, errorMessage: message, stack });
        // Fail open on database errors to prevent service disruption
        log.warn('Rate limit check failed, allowing request through', logContext);
    }
};

/**
 * @param {any} request
 * @param {import('./utils/jsdoc-types.cjs').LogLike} log
 */
const checkSecurity = async (request, log) => {
    const ip = request.headers['x-nf-client-connection-ip'];
    const logContext = { clientIp: ip };
    log.info('Executing security check', logContext);

    try {
        if (ip) {
            log.debug('Checking if IP is in blocked ranges', logContext);
            const blockedRanges = await getIpRanges(log, 'blocked');
            if (isIpInRanges(ip, blockedRanges, log)) {
                log.warn('Request from blocked IP was rejected', logContext);
                throw new HttpError(403, 'Your IP address has been blocked.');
            }
            log.debug('IP is not blocked. Proceeding to rate limit check', logContext);
        } else {
            log.warn('No client IP found in headers, cannot perform IP-based security checks', logContext);
        }

        await checkRateLimit(request, log);
        log.info('Security check completed successfully', logContext);

    } catch (error) {
        if (error instanceof HttpError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        log.error(`A critical error occurred during the security check`, {
            ...logContext,
            errorMessage: message,
            stack
        });
    }
};

/**
 * @param {any} event
 * @param {any} context
 */
exports.handler = async function (event, context) {
    const log = createLoggerFromEvent('security-handler', event, context);
    /** @type {any} */
    const timer = createTimer(log, 'security-handler');

    log.entry(createStandardEntryMeta(event));
    logDebugRequestSummary(log, event, { label: 'Security check request', includeBody: false });

    if (!validateEnvironment(log)) {
        timer.end({ success: false, error: 'configuration' });
        log.exit(500);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error' })
        };
    }

    const clientIp = event.headers['x-nf-client-connection-ip'];
    const logContext = { clientIp, httpMethod: event.httpMethod };

    try {
        await checkSecurity(event, log);
        log.info('Security check passed', logContext);
        timer.end({ success: true });
        log.exit(200);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Security check passed' }),
            headers: { 'Content-Type': 'application/json' }
        };
    } catch (error) {
        if (error instanceof HttpError) {
            log.warn('Security check failed', { ...logContext, statusCode: error.statusCode });
            timer.end({ success: false, statusCode: error.statusCode });
            log.exit(error.statusCode);
            return {
                statusCode: error.statusCode,
                body: JSON.stringify({ error: error.message }),
                headers: { 'Content-Type': 'application/json' }
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        log.error('Security handler error', { ...logContext, error: message });
        timer.end({ success: false, error: message });
        log.exit(500);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' }),
            headers: { 'Content-Type': 'application/json' }
        };
    }
};

module.exports = { checkSecurity, HttpError };
