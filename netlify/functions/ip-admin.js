const { getConfiguredStore } = require("./utils/blobs.js");
const { createLogger } = require("./utils/logger.js");

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

const isIpInRanges = (ip, ranges, log) => {
  if (!Array.isArray(ranges)) return false;
  for (const range of ranges) {
    if (range.includes('/') ? isIpInCidr(ip, range, log) : ip === range) return true;
  }
  return false;
};

const listAllBlobs = async (store, log) => {
    let allBlobs = []; let cursor = undefined;
    do {
        const { blobs, cursor: nextCursor } = await withRetry(() => store.list({ cursor, limit: 1000 }), log);
        log('info', 'Fetched a page of blobs', { count: blobs.length, nextCursor: nextCursor || 'end' });
        allBlobs.push(...blobs);
        cursor = nextCursor;
    } while (cursor);
    return allBlobs;
};

const keyToIp = (key) => Buffer.from(key, 'base64url').toString('utf8');

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('ip-admin', context);
    try {
        if (event.httpMethod === 'GET') {
            log('info', 'Fetching all IP admin data.');
            const rateStore = getConfiguredStore("rate-limiting", log);
            const verifiedStore = getConfiguredStore("verified-ips", log);
            const blockedStore = getConfiguredStore("bms-blocked-ips", log);

            const [rateLimitBlobs, rawRangesData, rawBlockedData] = await Promise.all([
                listAllBlobs(rateStore, log).then(blobs => {
                    log('info', `Found ${blobs.length} rate limit blobs.`);
                    return blobs;
                }),
                withRetry(() => verifiedStore.get("ranges", { type: "json" }), log).catch(() => []).then(ranges => {
                    log('info', `Found ${Array.isArray(ranges) ? ranges.length : 0} verified ranges.`);
                    return ranges;
                }),
                withRetry(() => blockedStore.get("ranges", { type: "json" }), log).catch(() => []).then(ranges => {
                    log('info', `Found ${Array.isArray(ranges) ? ranges.length : 0} blocked ranges.`);
                    return ranges;
                })
            ]);

            const verifiedRanges = Array.isArray(rawRangesData) ? rawRangesData : [];
            const blockedRanges = Array.isArray(rawBlockedData) ? rawBlockedData : [];

            const now = Date.now();
            const activityWindowStart = now - 24 * 60 * 60 * 1000;
            const rateLimitWindowStart = now - 60 * 1000;

            const trackedIpsPromises = (rateLimitBlobs || []).map(async (blob) => {
                try {
                    const ip = keyToIp(blob.key);
                    const timestamps = await withRetry(() => rateStore.get(blob.key, { type: "json" }), log) || [];
                    const recentTimestamps = timestamps.filter(ts => ts > activityWindowStart);
                    if (recentTimestamps.length === 0) return null;

                    return {
                        ip, key: blob.key,
                        count: timestamps.filter(ts => ts > rateLimitWindowStart).length,
                        lastSeen: new Date(Math.max(...recentTimestamps)).toISOString(),
                        isVerified: isIpInRanges(ip, verifiedRanges, log),
                        isBlocked: isIpInRanges(ip, blockedRanges, log),
                    };
                } catch (e) {
                    log('error', `Failed to process rate limit blob.`, { key: blob.key, errorMessage: e.message, stack: e.stack });
                    return null;
                }
            });
            
            const trackedIps = (await Promise.all(trackedIpsPromises))
                .filter(Boolean)
                .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
            
            return respond(200, { trackedIps, verifiedRanges, blockedRanges });
        }

        if (event.httpMethod === 'POST') {
            const { action, range, key } = JSON.parse(event.body);
            log('info', 'IP admin POST request received.', { action, hasRange: !!range, hasKey: !!key });

            if (action === 'delete-ip' && key) {
                const rateStore = getConfiguredStore("rate-limiting", log);
                await withRetry(() => rateStore.delete(key), log);
                return respond(200, { success: true });
            }

            let store, storeKey = "ranges", responseKey;
            if (['add', 'remove'].includes(action)) { store = getConfiguredStore("verified-ips", log); responseKey = 'verifiedRanges'; }
            else if (['block', 'unblock'].includes(action)) { store = getConfiguredStore("bms-blocked-ips", log); responseKey = 'blockedRanges'; }
            else { return respond(400, { error: 'Invalid request body.' }); }
            
            const { data, metadata } = await withRetry(() => store.getWithMetadata(storeKey, { type: "json" }), log)
                .catch(err => (err.status === 404 ? { data: [], metadata: null } : Promise.reject(err)));
                
            let ranges = Array.isArray(data) ? data : [];

            if ((action === 'add' || action === 'block') && range) {
                if (!ranges.includes(range)) ranges.push(range);
            } else if ((action === 'remove' || action === 'unblock') && range) {
                ranges = ranges.filter(r => r !== range);
            }
            
            await withRetry(() => store.setJSON(storeKey, ranges, { etag: metadata?.etag }), log);
            log('info', 'Updated ranges with etag check', { etag: metadata?.etag });

            return respond(200, { [responseKey]: ranges });
        }
        
        return respond(405, { error: 'Method Not Allowed' });

    } catch (error) {
        log('error', 'Critical unhandled error in ip-admin handler.', { errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred in ip-admin." });
    }
};