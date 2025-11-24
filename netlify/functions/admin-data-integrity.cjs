/**
 * Admin Data Integrity Endpoint
 * 
 * Performs comprehensive audit of all DL-# (Data Logger IDs) in the database.
 * Groups records by deviceId (DL-#), counts records, and categorizes each as:
 * - MATCHED: DL-# has a corresponding System profile
 * - ORPHAN: DL-# has no associated System profile (needs adoption)
 * 
 * This endpoint powers the Data Reconciliation Dashboard.
 */

const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");

const respond = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

exports.handler = async function(event, context) {
    const log = createLogger('admin-data-integrity', context);
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const { httpMethod } = event;
    const logContext = { clientIp, httpMethod };
    
    log('info', 'Admin Data Integrity function invoked.', logContext);

    if (httpMethod !== 'GET') {
        return respond(405, { error: 'Method not allowed. Use GET.' });
    }

    try {
        const historyCollection = await getCollection("history");
        const systemsCollection = await getCollection("systems");

        log('info', 'Starting data integrity audit...', logContext);

        // Step 1: Aggregate all records by dlNumber (deviceId)
        // This pipeline groups all analysis records by their DL-# and counts them
        const aggregationPipeline = [
            {
                // Only include records that have a dlNumber
                $match: {
                    "analysis.dlNumber": { $exists: true, $ne: null, $ne: "" }
                }
            },
            {
                $group: {
                    _id: "$analysis.dlNumber",
                    recordCount: { $sum: 1 },
                    lastSeen: { $max: "$timestamp" },
                    firstSeen: { $min: "$timestamp" },
                    // Sample a systemId if any records are already linked
                    linkedSystemId: { $first: "$systemId" },
                    linkedSystemName: { $first: "$systemName" }
                }
            },
            {
                $sort: { recordCount: -1 }
            }
        ];

        log('debug', 'Running aggregation pipeline...', { ...logContext, pipeline: JSON.stringify(aggregationPipeline) });
        const aggregationResults = await historyCollection.aggregate(aggregationPipeline).toArray();
        
        log('info', `Aggregation complete. Found ${aggregationResults.length} unique DL-# sources.`, logContext);

        // Step 2: Fetch all systems and create a mapping of DL-# to System
        const allSystems = await systemsCollection.find({}, { projection: { _id: 0 } }).toArray();
        
        log('info', `Fetched ${allSystems.length} registered systems.`, logContext);

        // Create a map: DL-# -> System object
        const dlToSystemMap = new Map();
        allSystems.forEach(system => {
            if (system.associatedDLs && Array.isArray(system.associatedDLs)) {
                system.associatedDLs.forEach(dlId => {
                    dlToSystemMap.set(dlId, system);
                });
            }
        });

        // Step 3: Categorize each DL-# as MATCHED or ORPHAN
        const categorizedData = aggregationResults.map(item => {
            const dlId = item._id;
            const system = dlToSystemMap.get(dlId);
            
            if (system) {
                // This DL is associated with a registered system
                return {
                    dl_id: dlId,
                    record_count: item.recordCount,
                    status: 'MATCHED',
                    system_id: system.id,
                    system_name: system.name,
                    first_seen: item.firstSeen,
                    last_seen: item.lastSeen,
                    // Include additional system metadata
                    system_chemistry: system.chemistry,
                    system_voltage: system.voltage,
                    system_capacity: system.capacity
                };
            } else {
                // This DL is not associated with any system - it's an orphan
                return {
                    dl_id: dlId,
                    record_count: item.recordCount,
                    status: 'ORPHAN',
                    system_id: null,
                    system_name: null,
                    first_seen: item.firstSeen,
                    last_seen: item.lastSeen,
                    // If records were previously linked, include that info
                    previously_linked_system_id: item.linkedSystemId || null,
                    previously_linked_system_name: item.linkedSystemName || null
                };
            }
        });

        // Step 4: Calculate summary statistics
        const summary = {
            total_dl_sources: categorizedData.length,
            matched: categorizedData.filter(d => d.status === 'MATCHED').length,
            orphaned: categorizedData.filter(d => d.status === 'ORPHAN').length,
            total_records: aggregationResults.reduce((sum, item) => sum + item.recordCount, 0),
            orphaned_records: categorizedData
                .filter(d => d.status === 'ORPHAN')
                .reduce((sum, item) => sum + item.record_count, 0)
        };

        log('info', 'Data integrity audit complete.', { ...logContext, summary });

        return respond(200, {
            summary,
            data: categorizedData,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error during data integrity audit.';
        log('error', 'Data integrity audit failed.', { ...logContext, error, stack: err instanceof Error ? err.stack : undefined });
        return respond(500, { 
            error: 'Failed to perform data integrity audit.',
            details: error 
        });
    }
};
