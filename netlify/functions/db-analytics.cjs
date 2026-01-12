// @ts-nocheck
const { getCollection, getDb } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { ensureAdminAuthorized } = require('./utils/auth.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

// Helper to format bytes to human readable
const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async (event, context) => {
    const log = createLoggerFromEvent('db-analytics', event, context);
    const timer = createTimer(log, 'db-analytics');
    const headers = getCorsHeaders(event);

    log.entry(createStandardEntryMeta(event));

    // Unified logging: also forward to centralized collector
    const forwardLog = createForwardingLogger('db-analytics');

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const authResponse = await ensureAdminAuthorized(event, context, headers, log);
    if (authResponse) {
        timer.end({ outcome: 'unauthorized' });
        log.exit(403, { outcome: 'unauthorized' });
        return authResponse;
    }

    try {
        const { collection: collectionName = 'history', mode = 'summary' } = event.queryStringParameters || {};

        const output = {
            timestamp: new Date().toISOString(),
            mode,
            collection: collectionName,
            stats: {},
            fieldAnalysis: []
        };

        // 1. Database Level Stats
        if (mode === 'summary' || mode === 'full') {
            const db = await getDb();

            log.dbOperation('stats', 'db');
            const dbStats = await db.stats();
            output.stats.db = {
                dbName: dbStats.db,
                objects: dbStats.objects,
                avgObjSize: formatBytes(dbStats.avgObjSize),
                dataSize: formatBytes(dbStats.dataSize),
                storageSize: formatBytes(dbStats.storageSize),
                indexes: dbStats.indexes,
                indexSize: formatBytes(dbStats.indexSize),
            };

            // Collection Stats for key collections
            const cols = ['history', 'systems'];
            output.stats.collections = {};

            for (const name of cols) {
                const col = await getCollection(name);
                log.dbOperation('stats', name);
                const stats = await col.stats();
                output.stats.collections[name] = {
                    count: stats.count,
                    size: formatBytes(stats.size),
                    avgObjSize: formatBytes(stats.avgObjSize),
                    storageSize: formatBytes(stats.storageSize),
                    nindexes: stats.nindexes,
                    totalIndexSize: formatBytes(stats.totalIndexSize)
                };
            }
        }

        // 2. Field Level Analysis
        if (mode === 'fields' || mode === 'full') {
            const targetCol = await getCollection(collectionName);

            // Aggregation pipeline to calculate size per top-level field
            // Note: This scans the collection. efficient for <100k records.
            const pipeline = [
                {
                    $project: {
                        // Convert document to array of key-value pairs
                        data: { $objectToArray: "$$ROOT" }
                    }
                },
                { $unwind: "$data" },
                {
                    $group: {
                        _id: "$data.k",
                        totalSize: { $sum: { $bsonSize: "$data.v" } },
                        count: { $sum: 1 }, // How many docs have this field
                        avgSize: { $avg: { $bsonSize: "$data.v" } }
                    }
                },
                { $sort: { totalSize: -1 } }
            ];



            log.dbOperation('aggregate', collectionName, { pipelineStepCount: pipeline.length });
            const rawFieldStats = await targetCol.aggregate(pipeline).toArray();

            // Format for output
            output.fieldAnalysis = rawFieldStats.map(f => ({
                field: f._id,
                totalSize: f.totalSize,
                totalSizeHuman: formatBytes(f.totalSize),
                avgSize: Math.round(f.avgSize),
                count: f.count,
                percentageOfData: '0%' // Will calc below
            }));

            // Calc percentages
            const totalCalcSize = output.fieldAnalysis.reduce((acc, curr) => acc + curr.totalSize, 0);
            output.fieldAnalysis.forEach(f => {
                f.percentageOfData = ((f.totalSize / totalCalcSize) * 100).toFixed(1) + '%';
            });
            output.stats.analyzedTotalSize = formatBytes(totalCalcSize);
        }

        // Special: Deep analysis of 'analysis' object if requested
        if (mode === 'deep' && collectionName === 'history') {
            const targetCol = await getCollection('history');
            const pipeline = [
                {
                    $addFields: {
                        // Flatten the analysis object to top level for measurement
                        // We prefix to avoid collision
                        analysisProps: { $objectToArray: { $ifNull: ["$analysis", {}] } }
                    }
                },
                { $unwind: "$analysisProps" },
                {
                    $group: {
                        _id: { $concat: ["analysis.", "$analysisProps.k"] },
                        totalSize: { $sum: { $bsonSize: "$analysisProps.v" } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { totalSize: -1 } }
            ];

            log.dbOperation('aggregate', 'history', { pipelineStepCount: pipeline.length, analysisType: 'deep' });
            const deepStats = await targetCol.aggregate(pipeline).toArray();
            output.deepAnalysis = deepStats.map(f => ({
                field: f._id,
                totalSizeHuman: formatBytes(f.totalSize),
                totalSize: f.totalSize
            }));
        }

        timer.end({ success: true });
        log.exit(200);
        return respond(200, output, headers);

    } catch (err) {
        log.error('DB Analytics failed', { error: err.message, stack: err.stack });
        timer.end({ success: false, error: err.message });
        return respond(500, { error: err.message }, headers);
    }
};

const respond = (statusCode, body, headers = {}) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
});
