const { getConfiguredStore } = require("./utils/blobs.js");

const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute
const UNVERIFIED_IP_LIMIT = 100;

const withRetry = async (fn, log, maxRetries = 3, initialDelay = 250) => {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            const isRetryable = (error instanceof TypeError) || (error.message && error.message.includes('401 status code'));
            if (isRetryable && i < maxRetries) {
                const delay = initialDelay * Math.pow(2, i) + Math.random() * initialDelay;
                log('warn', `A retryable blob store operation failed. Retrying...`, { attempt: i + 1, error: error.message });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

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
    return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
  } catch (e) {
    log('error', `Error in isIpInCidr.`, { ip, cidr, errorMessage: e.message });
    return false;
  }
};

const getIpRanges = async (storeName, cache, log) => {
    const now = Date.now();
    if (now - cache.lastFetched < cache.ttl) {
        log('info', 'IP ranges cache hit.', { storeName });
        return cache.ranges;
    }
    try {
        log('info', 'IP ranges cache miss. Fetching from store.', { storeName });
        const store = getConfiguredStore(storeName, log);
        const data = await withRetry(() => store.get("ranges", { type: "json" }), log);
        const ranges = Array.isArray(data) ? data : [];
        cache.ranges = ranges;
        cache.lastFetched = now;
        return ranges;
    } catch (error) {
        log('error', `Could not fetch ${storeName} ranges.`, { errorMessage: error.message });
        cache.ranges = [];
        cache.lastFetched = now;
        return [];
    }
};

const getVerifiedRanges = (log) => getIpRanges("verified-ips", verifiedIpCache, log);
const getBlockedRanges = (log) => getIpRanges("bms-blocked-ips", blockedIpCache, log);

const isIpInRanges = (ip, ranges, log) => {
  for (const range of ranges) {
    if (range.includes('/') ? isIpInCidr(ip, range, log) : ip === range) return true;
  }
  return false;
};

const ipToKey = (ip) => Buffer.from(ip).toString('base64url');

const checkRateLimit = async (request, log) => {
    const ip = request.headers['x-nf-client-connection-ip'];
    if (!ip) return;

    const verifiedRanges = await getVerifiedRanges(log);
    if (isIpInRanges(ip, verifiedRanges, log)) {
        log('info', 'IP is verified, bypassing rate limit.', { ip });
        return;
    }

    const store = getConfiguredStore("rate-limiting", log);
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_SECONDS * 1000;
    const key = ipToKey(ip);

    for (let i = 0; i < 5; i++) { // Retry for contention
        log('info', 'Fetching rate limit metadata.', { key });
        const metadata = await withRetry(() => store.getWithMetadata(key, { type: "json" }), log).catch(err => (err.status === 404 ? null : Promise.reject(err)));
        log('info', 'Rate limit metadata fetched.', { key, hasData: !!metadata });
        const timestamps = metadata?.data || [];
        const recentTimestamps = timestamps.filter(ts => ts > windowStart);
        if (recentTimestamps.length >= UNVERIFIED_IP_LIMIT) {
            throw new HttpError(429, `Too Many Requests: Rate limit exceeded.`);
        }
        const newTimestamps = [...recentTimestamps, now];
        try {
            await withRetry(() => store.setJSON(key, newTimestamps, { onlyIfMatch: metadata?.etag, onlyIfNew: !metadata }), log);
            return;
        } catch (error) {
            if (error.status === 412 || (error.message && error.message.includes('key already exists'))) {
                 await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, i)));
            } else {
                throw error;
            }
        }
    }
    throw new HttpError(503, "Service busy. Please try again shortly.");
};

const checkSecurity = async (request, log) => {
    const ip = request.headers['x-nf-client-connection-ip'];
    log('info', 'Executing security check.', { clientIp: ip });
    try {
        if (ip) {
            const blockedRanges = await getBlockedRanges(log);
            log('info', 'Blocked ranges loaded.', { count: blockedRanges.length });
            if (isIpInRanges(ip, blockedRanges, log)) {
                throw new HttpError(403, 'Your IP address has been blocked.');
            }
        }
        await checkRateLimit(request, log);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        log('warn', `A non-fatal error occurred during the security check.`, { errorMessage: error.message });
    }
};

module.exports = { checkSecurity, HttpError };