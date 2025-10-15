
const { getCollection } = require("./utils/mongodb.js");
const { createLogger } = require("./utils/logger.js");

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

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('ip-admin', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };
    log('debug', 'Function invoked.', { ...logContext, headers: event.headers });

    try {
        const securityCollection = await getCollection("security");
        const rateLimitsCollection = await getCollection("rate_limits");
        const ipConfigDocId = 'ip_config';

        if (httpMethod === 'GET') {
            log('info', 'Fetching all IP admin data.', logContext);
            const ipConfig = await securityCollection.findOne({ _id: ipConfigDocId }) || { verified: [], blocked: [] };
            
            const activityWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentActivity = await rateLimitsCollection.find({ timestamps: { $gte: activityWindowStart } }).toArray();

            const trackedIps = recentActivity.map(record => ({
                ip: record.ip,
                key: record.ip, // Use IP as key for simplicity in UI
                count: record.timestamps.filter(ts => ts > new Date(Date.now() - 60 * 1000)).length,
                lastSeen: new Date(Math.max(...record.timestamps)).toISOString(),
                isVerified: isIpInRanges(record.ip, ipConfig.verified, log),
                isBlocked: isIpInRanges(record.ip, ipConfig.blocked, log),
            })).sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

            return respond(200, { 
                trackedIps, 
                verifiedRanges: ipConfig.verified, 
                blockedRanges: ipConfig.blocked 
            });
        }

        if (httpMethod === 'POST') {
            const parsedBody = JSON.parse(event.body);
            log('debug', 'Parsed POST body.', { ...logContext, body: parsedBody });
            const { action, range, key } = parsedBody;
            const postLogContext = { ...logContext, action, range, key };
            log('info', 'IP admin POST request received.', postLogContext);

            if (action === 'delete-ip' && key) {
                await rateLimitsCollection.deleteOne({ ip: key });
                return respond(200, { success: true });
            }

            let updateOperation;
            let responseKey;
            if (action === 'add' && range) { updateOperation = { $addToSet: { verified: range } }; responseKey = 'verifiedRanges'; }
            else if (action === 'remove' && range) { updateOperation = { $pull: { verified: range } }; responseKey = 'verifiedRanges'; }
            else if (action === 'block' && range) { updateOperation = { $addToSet: { blocked: range } }; responseKey = 'blockedRanges'; }
            else if (action === 'unblock' && range) { updateOperation = { $pull: { blocked: range } }; responseKey = 'blockedRanges'; }
            else { return respond(400, { error: 'Invalid request body.' }); }
            
            const result = await securityCollection.findOneAndUpdate(
                { _id: ipConfigDocId },
                updateOperation,
                { upsert: true, returnDocument: 'after' }
            );

            const updatedRanges = result.value ? (result.value[responseKey.slice(0, -1)] || []) : [range];
            return respond(200, { [responseKey]: updatedRanges });
        }
        
        return respond(405, { error: 'Method Not Allowed' });

    } catch (error) {
        log('error', 'Critical unhandled error in ip-admin handler.', { ...logContext, errorMessage: error.message, stack: error.stack });
        return respond(500, { error: "An internal server error occurred in ip-admin." });
    }
};