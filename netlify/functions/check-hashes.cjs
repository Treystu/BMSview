"use strict";

const { getCollection } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');

exports.handler = async (event, context) => {
    const headers = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('check-hashes', event, context);
    log.entry({ method: event.httpMethod, path: event.path });
    const timer = createTimer(log, 'check-hashes');

    // ENHANCED LOGGING: Always log function invocation for debugging
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        function: 'check-hashes',
        event: 'INVOKED',
        method: event.httpMethod,
        hasBody: !!event.body,
        bodyLength: event.body?.length || 0
    }));

    if (event.httpMethod !== 'POST') {
        log.warn('Method not allowed', { method: event.httpMethod });
        log.exit(405);
        return errorResponse(405, 'method_not_allowed', 'Method Not Allowed', null, headers);
    }

    try {
        const { hashes } = JSON.parse(event.body);

        if (!Array.isArray(hashes) || hashes.length === 0) {
            log.warn('Invalid hashes array in request');
            log.exit(400);
            return errorResponse(400, 'bad_request', 'Missing or invalid "hashes" array in request body.', null, headers);
        }

        // ENHANCED LOGGING: Log the actual hashes being checked
        log.info('Checking hashes for existence', { 
            hashCount: hashes.length,
            hashPreview: hashes.slice(0, 3).map(h => h.substring(0, 16) + '...')
        });

        const collection = await getCollection('analysis-results');

        const criticalFields = [
            'analysis.dlNumber',
            'analysis.stateOfCharge',
            'analysis.overallVoltage',
            'analysis.current',
            'analysis.remainingCapacity',
            'analysis.chargeMosOn',
            'analysis.dischargeMosOn',
            'analysis.balanceOn',
            'analysis.highestCellVoltage',
            'analysis.lowestCellVoltage',
            'analysis.averageCellVoltage',
            'analysis.cellVoltageDifference',
            'analysis.cycleCount',
            'analysis.power'
        ];

        const query = { contentHash: { $in: hashes } };
        
        // ENHANCED LOGGING: Log query details
        log.info('Executing MongoDB query', {
            queryType: 'find',
            collection: 'analysis-results',
            hashesInQuery: hashes.length
        });
        
        const allMatchingRecords = await collection.find(query, {
            projection: { contentHash: 1, analysis: 1 }
        }).toArray();

        // ENHANCED LOGGING: Log query results
        log.info('MongoDB query complete', {
            recordsFound: allMatchingRecords.length,
            hashesQueried: hashes.length,
            matchRate: allMatchingRecords.length > 0 ? 
                `${Math.round((new Set(allMatchingRecords.map(r => r.contentHash)).size / hashes.length) * 100)}%` : '0%'
        });

        const duplicates = [];
        const upgrades = new Set();
        const seenHashes = new Set();

        for (const record of allMatchingRecords) {
            if (seenHashes.has(record.contentHash)) continue;

            const hasAllCriticalFields = criticalFields.every(field => {
                const fieldValue = field.split('.').reduce((o, i) => o?.[i], record);
                return fieldValue !== undefined && fieldValue !== null;
            });

            if (hasAllCriticalFields) {
                duplicates.push({
                    hash: record.contentHash,
                    data: { ...record.analysis, _recordId: record._id.toString() },
                });
                seenHashes.add(record.contentHash);
                
                // ENHANCED LOGGING: Log each duplicate found
                log.info('Duplicate detected', {
                    hash: record.contentHash.substring(0, 16) + '...',
                    recordId: record._id.toString(),
                    dlNumber: record.analysis?.dlNumber
                });
            } else {
                upgrades.add(record.contentHash);
                
                // ENHANCED LOGGING: Log each upgrade needed
                const missingFields = criticalFields.filter(field => {
                    const fieldValue = field.split('.').reduce((o, i) => o?.[i], record);
                    return fieldValue === undefined || fieldValue === null;
                });
                
                log.info('Upgrade needed - missing fields', {
                    hash: record.contentHash.substring(0, 16) + '...',
                    recordId: record._id.toString(),
                    missingFields: missingFields.map(f => f.split('.').pop()),
                    missingCount: missingFields.length
                });
            }
        }
        
        const result = {
            duplicates,
            upgrades: [...upgrades],
        };

        const durationMs = timer.end({ 
            hashesChecked: hashes.length, 
            duplicatesFound: duplicates.length,
            upgradesNeeded: upgrades.size
        });
        
        // ENHANCED LOGGING: Final summary with detailed breakdown
        log.info('Hash check complete', { 
            hashesChecked: hashes.length, 
            duplicatesFound: duplicates.length, 
            upgradesNeeded: upgrades.size,
            newFiles: hashes.length - duplicates.length - upgrades.size,
            durationMs
        });
        
        // ENHANCED LOGGING: Console log for easy visibility
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            function: 'check-hashes',
            event: 'COMPLETE',
            summary: {
                total: hashes.length,
                duplicates: duplicates.length,
                upgrades: upgrades.size,
                newFiles: hashes.length - duplicates.length - upgrades.size
            },
            durationMs
        }));

        log.exit(200);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result),
        };

    } catch (error) {
        timer.end({ error: true });
        log.error('Error checking hashes', { error: error.message, stack: error.stack });
        log.exit(500);
        return errorResponse(500, 'internal_error', 'An internal error occurred while checking hashes.', null, headers);
    }
};