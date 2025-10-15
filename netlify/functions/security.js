// HOTFIX 1: Fixed Rate Limiting with Atomic Operations
// Replace: netlify/functions/security.js
// This fix prevents race conditions in rate limiting by using MongoDB's atomic operations

const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

const ipToInt = (ip) => ip.split('.').reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0;

const isIpInCidr = (ip, cidr, log) => {
  try {
    const [range, bitsStr = 32] = cidr.split('/'); const bits = parseInt(bitsStr, 10);
    const mask = -1 << (32 - bits);
    return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
  } catch (e) {
    log('error', `Error in isIpInCidr.`, { ip, cidr, errorMessage: e.message });
    return false;
  }
};

const getIpRanges = async (log, type) => {
    try {
        const securityCollection = await getCollection("security");
        const doc = await securityCollection.findOne({ _id: 'ip_config' });
        return doc ? (doc[type] || []) : [];
    } catch (error) {
        log('error', `Could not fetch ${type} ranges from MongoDB.`, { errorMessage: error.message });
        return [];
    }
};

const isIpInRanges = (ip, ranges, log) => {
  for (const range of ranges) {
    if (range.includes('/') ? isIpInCidr(ip, range, log) : ip === range) return true;
  }
  return false;
};

/**
 * FIXED: Atomic rate limiting using MongoDB's conditional updates
 * This prevents race conditions by using findOneAndUpdate with conditional expression
 */
const checkRateLimit = async (request, log) => {
    const ip = request.headers['x-nf-client-connection-ip'];
    if (!ip) return;
    const logContext = { clientIp: ip };

    log('debug', 'Checking rate limit.', logContext);
    const verifiedRanges = await getIpRanges(log, 'verified');
    if (isIpInRanges(ip, verifiedRanges, log)) {
        log('info', 'IP is verified, bypassing rate limit.', logContext);
        return;
    }

    log('debug', 'IP is not verified, proceeding with rate limit check.', logContext);
    const rateLimitCollection = await getCollection("rate_limits");
    const now = new Date();
    const windowStart = new Date(now.getTime() - (60 * 1000)); // 1 minute window
    
    const UNVERIFIED_IP_LIMIT = 100;

    try {
        // ATOMIC OPERATION: Use aggregation pipeline to check and update in one operation
        // This prevents race conditions by ensuring the check and increment happen atomically
        const result = await rateLimitCollection.findOneAndUpdate(
            { 
                ip,
                // Only match if we haven't exceeded the limit
                $expr: {
                    $lt: [
                        {
                            $size: {
                                $filter: {
                                    input: { $ifNull: ["$timestamps", []] },
                                    as: "ts",
                                    cond: { $gt: ["$$ts", windowStart] }
                                }
                            }
                        },
                        UNVERIFIED_IP_LIMIT
                    ]
                }
            },
            { 
                $push: { timestamps: now },
                $setOnInsert: { ip, createdAt: now }
            },
            { 
                upsert: true, 
                returnDocument: 'after'
            }
        );

        // If result is null, it means the limit was already exceeded
        if (!result.value) {
            log('warn', 'Rate limit exceeded for unverified IP.', logContext);
            throw new HttpError(429, `Too Many Requests: Rate limit exceeded.`);
        }

        // Clean up old timestamps periodically (every 10th request)
        if (Math.random() < 0.1) {
            const recentTimestamps = result.value.timestamps.filter(ts => ts > windowStart);
            if (recentTimestamps.length < result.value.timestamps.length) {
                await rateLimitCollection.updateOne(
                    { ip },
                    { $set: { timestamps: recentTimestamps } }
                );
                log('debug', 'Cleaned up old timestamps.', { ...logContext, removed: result.value.timestamps.length - recentTimestamps.length });
            }
        }

        log('debug', 'Rate limit check passed.', { 
            ...logContext, 
            currentCount: result.value.timestamps.filter(ts => ts > windowStart).length,
            limit: UNVERIFIED_IP_LIMIT 
        });

    } catch (error) {
        if (error instanceof HttpError) throw error;
        log('error', 'Error during rate limit check.', { ...logContext, errorMessage: error.message });
        // Fail open on database errors to prevent service disruption
        log('warn', 'Rate limit check failed, allowing request through.', logContext);
    }
};

const checkSecurity = async (request, log) => {
    const ip = request.headers['x-nf-client-connection-ip'];
    const logContext = { clientIp: ip };
    log('info', 'Executing security check.', logContext);
    try {
        if (ip) {
            log('debug', 'Checking if IP is in blocked ranges.', logContext);
            const blockedRanges = await getIpRanges(log, 'blocked');
            if (isIpInRanges(ip, blockedRanges, log)) {
                log('warn', 'Request from blocked IP was rejected.', logContext);
                throw new HttpError(403, 'Your IP address has been blocked.');
            }
            log('debug', 'IP is not blocked. Proceeding to rate limit check.', logContext);
        } else {
            log('warn', 'No client IP found in headers, cannot perform IP-based security checks.', logContext);
        }
        await checkRateLimit(request, log);
        log('info', 'Security check completed successfully.', logContext);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        log('error', `A critical error occurred during the security check.`, { ...logContext, errorMessage: error.message, stack: error.stack });
    }
};

module.exports = { checkSecurity, HttpError };