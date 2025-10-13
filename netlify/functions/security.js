const { getConfiguredStore } = require("./utils/blobs.js");
const { createRetryWrapper } = require("./utils/retry.js");

const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute
const UNVERIFIED_IP_LIMIT = 100;

class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

let verifiedIpCache = { ranges: [], lastFetched: 0, ttl: 300000 }; // 5 minutes
let blockedIpCache = { ranges: [], lastFetched: 0, ttl: 300000 }; // 5 minutes

const ipToInt = (ip) => ip.split('.').reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0;

const isIpInCidr = (ip, cidr, log) => {
  try {
    const [range, bitsStr = 32] = cidr.split('/'); const bits = parseInt(bitsStr, 10);
    const mask = -1 << (32 - bits);
    const result = (ipToInt(ip) & mask) === (ipToInt(range) & mask);
    log('debug', 'CIDR check result.', { ip, cidr, result });
    return result;
  } catch (e) {
    log('error', `Error in isIpInCidr.`, { ip, cidr, errorMessage: e.message });
    return false;
  }
};

const getIpRanges = async (storeName, cache, log, withRetry) => {
    const now = Date.now();
    if (now - cache.lastFetched < cache.ttl) {
        log('debug', 'IP ranges cache hit.', { storeName });
        return cache.ranges;
    }
    try {
        log('info', 'IP ranges cache miss. Fetching from store.', { storeName });
        const store = getConfiguredStore(storeName, log);
        const data = await withRetry(() => store.get("ranges", { type: "json" }));
        const ranges = Array.isArray(data) ? data : [];
        cache.ranges = ranges;
        cache.lastFetched = now;
        log('debug', 'IP ranges fetched and cached.', { storeName, count: ranges.length });
        return ranges;
    } catch (error) {
        if (error.status !== 404) { // Don't log error for a non-existent ranges file
            log('error', `Could not fetch ${storeName} ranges. Returning empty array.`, { errorMessage: error.message });
        }
        cache.ranges = [];
        cache.lastFetched = now;
        return [];
    }
};

const getVerifiedRanges = (log, withRetry) => getIpRanges("verified-ips", verifiedIpCache, log, withRetry);
const getBlockedRanges = (log, withRetry) => getIpRanges("bms-blocked-ips", blockedIpCache, log, withRetry);

const isIpInRanges = (ip, ranges, log) => {
  for (const range of ranges) {
    if (range.includes('/') ? isIpInCidr(ip, range, log) : ip === range) return true;
  }
  return false;
};

const ipToKey = (ip) => Buffer.from(ip).toString('base64url');

const checkRateLimit = async (request, log, withRetry) => {
    const ip = request.headers['x-nf-client-connection-ip'];
    if (!ip) return;
    const logContext = { clientIp: ip };

    log('debug', 'Checking rate limit.', logContext);
    const verifiedRanges = await getVerifiedRanges(log, withRetry);
    if (isIpInRanges(ip, verifiedRanges, log)) {
        log('info', 'IP is verified, bypassing rate limit.', logContext);
        return;
    }

    log('debug', 'IP is not verified, proceeding with rate limit check.', logContext);
    const store = getConfiguredStore("rate-limiting", log);
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_SECONDS * 1000;
    const key = ipToKey(ip);

    for (let i = 0; i < 5; i++) { // Retry for contention
        log('debug', `Fetching rate limit metadata (attempt ${i + 1}).`, { ...logContext, key });
        const metadata = await withRetry(() => store.getWithMetadata(key, { type: "json" })).catch(err => (err.status === 404 ? null : Promise.reject(err)));
        const timestamps = metadata?.data || [];
        const recentTimestamps = timestamps.filter(ts => ts > windowStart);
        log('debug', 'Rate limit data fetched.', { ...logContext, key, totalTimestamps: timestamps.length, recentCount: recentTimestamps.length, limit: UNVERIFIED_IP_LIMIT });
        
        if (recentTimestamps.length >= UNVERIFIED_IP_LIMIT) {
            log('warn', 'Rate limit exceeded for unverified IP.', logContext);
            throw new HttpError(429, `Too Many Requests: Rate limit exceeded.`);
        }
        
        const newTimestamps = [...recentTimestamps, now];
        try {
            await withRetry(() => store.setJSON(key, newTimestamps, { onlyIfMatch: metadata?.etag, onlyIfNew: !metadata }));
            log('debug', 'Rate limit timestamp recorded successfully.', { ...logContext, newCount: newTimestamps.length });
            return;
        } catch (error) {
            if (error.status === 412 || (error.message && error.message.includes('key already exists'))) {
                 const delay = 50 * Math.pow(2, i);
                 log('warn', `Rate limit store contention. Retrying in ${delay}ms...`, { ...logContext, attempt: i + 1 });
                 await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    log('error', 'Failed to update rate limit store after multiple retries.', logContext);
    throw new HttpError(503, "Service busy. Please try again shortly.");
};

const checkSecurity = async (request, log) => {
    const withRetry = createRetryWrapper(log);
    const ip = request.headers['x-nf-client-connection-ip'];
    log('info', 'Executing security check.', { clientIp: ip });
    try {
        if (ip) {
            const blockedRanges = await getBlockedRanges(log, withRetry);
            log('debug', 'Blocked ranges loaded.', { clientIp: ip, count: blockedRanges.length });
            if (isIpInRanges(ip, blockedRanges, log)) {
                log('warn', 'Request from blocked IP was rejected.', { clientIp: ip });
                throw new HttpError(403, 'Your IP address has been blocked.');
            }
        }
        await checkRateLimit(request, log, withRetry);
        log('info', 'Security check completed.', { clientIp: ip });
    } catch (error) {
        if (error instanceof HttpError) throw error;
        log('error', `A critical error occurred during the security check.`, { clientIp: ip, errorMessage: error.message, stack: error.stack });
        // Fail open for non-HttpErrors to avoid blocking legitimate traffic due to intermittent issues.
    }
};

module.exports = { checkSecurity, HttpError };