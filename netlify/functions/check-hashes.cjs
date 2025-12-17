"use strict";

const { getCollection } = require('./utils/mongodb.cjs');
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { errorResponse } = require('./utils/errors.cjs');
const {
    createStandardEntryMeta,
    logDebugRequestSummary
} = require('./utils/handler-logging.cjs');

/**
 * @typedef {import('./utils/jsdoc-types.cjs').LogLike} LogLike
 */

/**
 * @param {any} event
 * @param {any} context
 */
exports.handler = async (event, context) => {
    const headers = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent('check-hashes', event, context);
    log.entry(createStandardEntryMeta(event));
    logDebugRequestSummary(log, event, { label: 'Check hashes request', includeBody: true });
    /** @type {any} */
    const timer = createTimer(log, 'check-hashes');

    if (event.httpMethod !== 'POST') {
        log.warn('Method not allowed', { method: event.httpMethod });
        log.exit(405);
        return errorResponse(405, 'method_not_allowed', 'Method Not Allowed', undefined, headers);
    }

    try {
        const { hashes } = JSON.parse(event.body);

        if (!Array.isArray(hashes) || hashes.length === 0) {
            log.warn('Invalid hashes array in request');
            log.exit(400);
            return errorResponse(400, 'bad_request', 'Missing or invalid "hashes" array in request body.', undefined, headers);
        }

        const startTime = Date.now();

        // ENHANCED LOGGING: Log the actual hashes being checked
        log.info('Checking hashes for existence', {
            hashCount: hashes.length,
            hashPreview: hashes.slice(0, 3).map(h => h.substring(0, 16) + '...'),
            firstFullHash: hashes[0], // Log first complete hash for debugging
            event: 'START'
        });

        const collection = await getCollection('analysis-results');

        // Critical fields needed for a complete duplicate (optimization: use object for O(1) lookup)
        const criticalFieldsMap = {
            'dlNumber': true,
            'stateOfCharge': true,
            'overallVoltage': true,
            'current': true,
            'remainingCapacity': true,
            'chargeMosOn': true,
            'dischargeMosOn': true,
            'balanceOn': true,
            'highestCellVoltage': true,
            'lowestCellVoltage': true,
            'averageCellVoltage': true,
            'cellVoltageDifference': true,
            'cycleCount': true,
            'power': true
        };
        const criticalFieldsList = Object.keys(criticalFieldsMap);

        const query = { contentHash: { $in: hashes } };

        const queryStartTime = Date.now();

        // ENHANCED LOGGING: Log query details
        log.info('Executing MongoDB query', {
            queryType: 'find',
            collection: 'analysis-results',
            hashesInQuery: hashes.length,
            event: 'QUERY_START'
        });

        // Optimized projection - only fetch what we need
        const allMatchingRecords = await collection.find(query, {
            projection: {
                contentHash: 1,
                'analysis.dlNumber': 1,
                'analysis.stateOfCharge': 1,
                'analysis.overallVoltage': 1,
                'analysis.current': 1,
                'analysis.remainingCapacity': 1,
                'analysis.chargeMosOn': 1,
                'analysis.dischargeMosOn': 1,
                'analysis.balanceOn': 1,
                'analysis.highestCellVoltage': 1,
                'analysis.lowestCellVoltage': 1,
                'analysis.averageCellVoltage': 1,
                'analysis.cellVoltageDifference': 1,
                'analysis.cycleCount': 1,
                'analysis.power': 1,
                _id: 1
            }
        }).toArray();

        const queryDurationMs = Date.now() - queryStartTime;
        const uniqueHashesFound = new Set(allMatchingRecords.map(r => r.contentHash)).size;

        // ENHANCED LOGGING: Log query results with performance metrics
        log.info('MongoDB query complete', {
            recordsFound: allMatchingRecords.length,
            uniqueHashesFound: uniqueHashesFound,
            hashesQueried: hashes.length,
            matchRate: `${Math.round((uniqueHashesFound / hashes.length) * 100)}%`,
            queryDurationMs: queryDurationMs,
            avgPerHash: hashes.length > 0 ? `${(queryDurationMs / hashes.length).toFixed(2)}ms` : 'N/A',
            event: 'QUERY_COMPLETE'
        });

        const duplicates = [];
        const upgrades = new Set();
        const seenHashes = new Set();

        const processingStartTime = Date.now();

        // Optimized field checking - batch process records
        for (const record of allMatchingRecords) {
            if (seenHashes.has(record.contentHash)) continue;

            // Fast field existence check - short-circuit on first missing field
            const analysis = record.analysis || {};
            let hasAllCriticalFields = true;
            for (const field of criticalFieldsList) {
                if (analysis[field] === undefined || analysis[field] === null) {
                    hasAllCriticalFields = false;
                    break; // Short-circuit on first missing field
                }
            }

            if (hasAllCriticalFields) {
                duplicates.push({
                    hash: record.contentHash,
                    data: { ...analysis, _recordId: record._id.toString() },
                });
                seenHashes.add(record.contentHash);

                // ENHANCED LOGGING: Log duplicate found (debug level for high volume)
                log.debug('Duplicate detected', {
                    hash: record.contentHash.substring(0, 16) + '...',
                    recordId: record._id.toString(),
                    dlNumber: analysis.dlNumber
                });
            } else {
                upgrades.add(record.contentHash);

                // ENHANCED LOGGING: Log upgrade needed with missing fields
                const missingFields = criticalFieldsList.filter(field =>
                    analysis[field] === undefined || analysis[field] === null
                );

                log.debug('Upgrade needed - missing fields', {
                    hash: record.contentHash.substring(0, 16) + '...',
                    recordId: record._id.toString(),
                    missingFields: missingFields,
                    missingCount: missingFields.length
                });
            }
        }

        const processingDurationMs = Date.now() - processingStartTime;

        const result = {
            duplicates,
            upgrades: [...upgrades],
        };

        const totalDurationMs = Date.now() - startTime;
        timer.end({
            hashesChecked: hashes.length,
            duplicatesFound: duplicates.length,
            upgradesNeeded: upgrades.size,
            queryDurationMs,
            processingDurationMs,
            totalDurationMs
        });

        log.info('Hash check complete', {
            hashesChecked: hashes.length,
            duplicatesFound: duplicates.length,
            upgradesNeeded: upgrades.size,
            newFiles: hashes.length - duplicates.length - upgrades.size,
            queryDurationMs,
            processingDurationMs,
            totalDurationMs,
            avgPerHash: `${(totalDurationMs / hashes.length).toFixed(2)}ms`,
            event: 'COMPLETE'
        });

        log.exit(200);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result),
        };

    } catch (error) {
        timer.end({ error: true });
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        log.error('Error checking hashes', { error: message, stack });
        log.exit(500);
        return errorResponse(500, 'internal_error', 'An internal error occurred while checking hashes.', undefined, headers);
    }
};