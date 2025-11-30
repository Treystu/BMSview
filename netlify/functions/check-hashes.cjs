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

        log.info('Checking hashes for existence', { hashCount: hashes.length });

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
        const allMatchingRecords = await collection.find(query, {
            projection: { contentHash: 1, analysis: 1 }
        }).toArray();

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
            } else {
                upgrades.add(record.contentHash);
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
        log.info('Hash check complete', { 
            hashesChecked: hashes.length, 
            duplicatesFound: duplicates.length, 
            upgradesNeeded: upgrades.size,
            durationMs
        });

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