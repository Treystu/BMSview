const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
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
    const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
    const log = createLoggerFromEvent('ip-admin', event, context);
    const timer = createTimer(log, 'ip-admin-handler');
    
    log.entry({ method: event.httpMethod, path: event.path });
    
    if (!validateEnvironment(log)) {
      timer.end({ success: false, error: 'configuration' });
      log.exit(500);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }
    
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };
    log.debug('Function invoked.', { ...logContext });

    try {
        const securityCollection = await getCollection("security");
        const rateLimitsCollection = await getCollection("rate_limits");
        const ipConfigDocId = 'ip_config';

        if (httpMethod === 'GET') {
            log.info('Fetching all IP admin data.', logContext);
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

            timer.end({ success: true });
            log.exit(200, { trackedIpsCount: trackedIps.length });
            return respond(200, { 
                trackedIps, 
                verifiedRanges: ipConfig.verified, 
                blockedRanges: ipConfig.blocked 
            });
        }

        if (httpMethod === 'POST') {
            const parsedBody = JSON.parse(event.body);
            log.debug('Parsed POST body.', { ...logContext, action: parsedBody.action });
            const { action, range, key } = parsedBody;
            const postLogContext = { ...logContext, action, range, key };
            log.info('IP admin POST request received.', postLogContext);

            if (action === 'delete-ip' && key) {
                await rateLimitsCollection.deleteOne({ ip: key });
                timer.end({ success: true });
                log.exit(200, { action });
                return respond(200, { success: true });
            }

            let updateOperation;
            let responseKey;
            if (action === 'add' && range) { updateOperation = { $addToSet: { verified: range } }; responseKey = 'verifiedRanges'; }
            else if (action === 'remove' && range) { updateOperation = { $pull: { verified: range } }; responseKey = 'verifiedRanges'; }
            else if (action === 'block' && range) { updateOperation = { $addToSet: { blocked: range } }; responseKey = 'blockedRanges'; }
            else if (action === 'unblock' && range) { updateOperation = { $pull: { blocked: range } }; responseKey = 'blockedRanges'; }
            else { 
                timer.end({ success: false });
                log.exit(400);
                return respond(400, { error: 'Invalid request body.' }); 
            }
            
            const result = await securityCollection.findOneAndUpdate(
                { _id: ipConfigDocId },
                updateOperation,
                { upsert: true, returnDocument: 'after' }
            );

            const updatedRanges = result.value ? (result.value[responseKey.slice(0, -1)] || []) : [range];
            timer.end({ success: true });
            log.exit(200, { action });
            return respond(200, { [responseKey]: updatedRanges });
        }
        
        timer.end({ success: false });
        log.exit(405);
        return respond(405, { error: 'Method Not Allowed' });

    } catch (error) {
        log.error('Critical unhandled error in ip-admin handler.', { ...logContext, errorMessage: error.message, stack: error.stack });
        timer.end({ success: false, error: error.message });
        log.exit(500);
        return respond(500, { error: "An internal server error occurred in ip-admin." });
    }
};
