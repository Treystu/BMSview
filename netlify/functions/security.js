
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

    const result = await rateLimitCollection.findOneAndUpdate(
        { ip },
        { $push: { timestamps: now } },
        { upsert: true, returnDocument: 'after' }
    );

    const timestamps = result.value ? result.value.timestamps : [now];
    const recentTimestamps = timestamps.filter(ts => ts > windowStart);
    
    if (recentTimestamps.length > UNVERIFIED_IP_LIMIT) {
        log('warn', 'Rate limit exceeded for unverified IP.', logContext);
        throw new HttpError(429, `Too Many Requests: Rate limit exceeded.`);
    }

    // Prune old timestamps
    if (timestamps.length > UNVERIFIED_IP_LIMIT * 2) {
        await rateLimitCollection.updateOne({ ip }, { $set: { timestamps: recentTimestamps } });
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
