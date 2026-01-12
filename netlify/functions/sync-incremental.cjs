"use strict";

/**
 * @typedef {import('./utils/jsdoc-types.cjs').LogLike} LogLike
 * @typedef {import('./utils/jsdoc-types.cjs').FallbackField} FallbackField
 * @typedef {import('./utils/jsdoc-types.cjs').CollectionConfig} CollectionConfig
 */

const { getCollection } = require("./utils/mongodb.cjs");
const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');
const { getCorsHeaders } = require("./utils/cors.cjs");
const {
    createStandardEntryMeta,
    logDebugRequestSummary
} = require("./utils/handler-logging.cjs");

/** @param {LogLike} log */
function validateEnvironment(log) {
    if (!process.env.MONGODB_URI) {
        log.error('Missing MONGODB_URI environment variable');
        return false;
    }
    return true;
}
const { errorResponse } = require("./utils/errors.cjs");

const JSON_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
};

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const { COLLECTIONS } = require('./utils/collections.cjs');

// ...

/** @type {Record<string, CollectionConfig>} */
const COLLECTION_CONFIG = {
    systems: {
        dbName: COLLECTIONS.SYSTEMS,
        fallbackUpdatedAtFields: [
            { name: "createdAt", type: "date" },
            { name: "timestamp", type: "string" }
        ]
    },
    history: {
        dbName: COLLECTIONS.HISTORY,
        fallbackUpdatedAtFields: [
            { name: "timestamp", type: "string" },
            { name: "createdAt", type: "date" }
        ]
    },
    "analysis-results": {
        dbName: COLLECTIONS.ANALYSIS_RESULTS,
        fallbackUpdatedAtFields: [
            { name: "timestamp", type: "string" },
            { name: "createdAt", type: "date" }
        ]
    },
    analytics: {
        dbName: COLLECTIONS.SYSTEM_ANALYTICS,
        fallbackUpdatedAtFields: [
            { name: "timestamp", type: "string" },
            { name: "createdAt", type: "date" }
        ]
    }
};

/**
 * @param {number} statusCode
 * @param {any} body
 */
function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: JSON_HEADERS,
        body: JSON.stringify(body)
    };
}

/** @param {any} value */
function normalizeToIsoString(value) {
    if (!value) {
        return null;
    }

    if (typeof value === "string") {
        if (ISO_UTC_REGEX.test(value)) {
            return value;
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return null;
}

/**
 * @param {string} sinceIso
 * @param {Date} sinceDate
 * @param {FallbackField[]} fallbackFields
 */
function buildIncrementalFilter(sinceIso, sinceDate, fallbackFields) {
    /** @type {any[]} */
    const orClauses = [
        { updatedAt: { $exists: true, $gte: sinceIso } },
        { updatedAt: { $exists: true, $gte: sinceDate } }
    ];

    for (const field of fallbackFields) {
        if (field.type === "date") {
            orClauses.push({ [field.name]: { $exists: true, $gte: sinceDate } });
        } else {
            orClauses.push({ [field.name]: { $exists: true, $gte: sinceIso } });
        }
    }

    // OPTIMIZATION: Removed legacy document check ({ updatedAt: { $exists: false } })
    // This was causing full table scans and re-fetching of old data on every sync.
    // Legacy documents should be migrated via a separate process if needed.
    // orClauses.push({ updatedAt: { $exists: false } });

    return { $or: orClauses };
}

/**
 * @param {any[]} records
 * @param {FallbackField[]} fallbackFields
 * @param {string} serverTime
 * @param {LogLike} log
 * @param {string} collectionKey
 */
function normalizeRecordTimestamps(records, fallbackFields, serverTime, log, collectionKey) {
    let missingCount = 0;
    /** @type {any[]} */
    const missingIds = [];

    const normalizedRecords = records.map(record => {
        const normalized = { ...record };
        let updatedAtIso = normalizeToIsoString(record.updatedAt);

        if (!updatedAtIso) {
            for (const field of fallbackFields) {
                const fallbackValue = record[field.name];
                const candidate = normalizeToIsoString(fallbackValue);
                if (candidate) {
                    updatedAtIso = candidate;
                    break;
                }
            }
        }

        if (!updatedAtIso) {
            updatedAtIso = serverTime;
            missingCount += 1;
            if (missingIds.length < 5) {
                const sampleId = record.id || record._id || 'unknown';
                missingIds.push(typeof sampleId === 'object' && sampleId !== null ? String(sampleId) : sampleId);
            }
        }

        normalized.updatedAt = updatedAtIso;
        return normalized;
    });

    if (missingCount > 0) {
        log.warn("Records lacked updatedAt; applied serverTime fallback", {
            collection: collectionKey,
            missingCount,
            sampleIds: missingIds,
            inspectedFields: fallbackFields.map(field => field.name)
        });
    }

    return normalizedRecords;
}

/**
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async function (event, context) {exports.handler = async function (event, context) {
    const headers = getCorsHeaders(event);

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent("sync-incremental", event, context);

  // Unified logging: also forward to centralized collector
  const forwardLog = createForwardingLogger('sync-incremental');
    log.entry(createStandardEntryMeta(event));
    logDebugRequestSummary(log, event, {
        label: "Sync incremental request",
        includeBody: false
    });
    /** @type {any} */
    const timer = createTimer(log, "sync-incremental");
    const requestStartedAt = Date.now();

    if (event.httpMethod !== "GET") {
        log.warn("Method not allowed", { method: event.httpMethod });
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return jsonResponse(405, { error: "Method Not Allowed" });
    }

    const params = event.queryStringParameters || {};
    const collectionKey = params.collection;
    const since = params.since;

    if (!collectionKey) {
        log.warn("Missing collection query parameter");
        timer.end({ error: 'missing_collection' });
        log.exit(400);
        return errorResponse(400, "missing_collection", "The 'collection' query parameter is required.");
    }

    if (!since) {
        log.warn("Missing since query parameter", { collection: collectionKey });
        timer.end({ error: 'missing_since' });
        log.exit(400);
        return errorResponse(400, "missing_since", "The 'since' query parameter is required.");
    }

    if (!ISO_UTC_REGEX.test(since)) {
        log.warn("Invalid since timestamp format", { since });
        timer.end({ error: 'invalid_since' });
        log.exit(400);
        return errorResponse(400, "invalid_since", "The 'since' parameter must be an ISO 8601 UTC timestamp with milliseconds.");
    }

    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
        log.warn("Unparseable since timestamp", { since });
        return errorResponse(400, "invalid_since", "The 'since' parameter could not be parsed as a valid date.");
    }

    const config = COLLECTION_CONFIG[String(collectionKey)];
    if (!config) {
        log.warn("Unsupported collection requested", { collection: collectionKey });
        return errorResponse(400, "invalid_collection", `Collection '${collectionKey}' is not supported.`);
    }

    try {
        const collection = await getCollection(config.dbName);
        /** @type {FallbackField[]} */
        const fallbackFields = config.fallbackUpdatedAtFields || [];
        const filter = buildIncrementalFilter(since, sinceDate, fallbackFields);

        const itemsQueryStartedAt = Date.now();
        // OPTIMIZATION: Added limit(1000) to prevent massive result sets causing timeouts
        const items = await collection.find(filter, { projection: { _id: 0 } }).limit(1000).toArray();
        const itemsQueryDurationMs = Date.now() - itemsQueryStartedAt;

        const deletedCollection = await getCollection(COLLECTIONS.DELETED_RECORDS);
        const deletedQueryStartedAt = Date.now();
        const deletedRecords = await deletedCollection.find({ collection: config.dbName }, { projection: { _id: 0 } }).toArray();
        const deletedQueryDurationMs = Date.now() - deletedQueryStartedAt;

        /** @type {string[]} */
        const deletedIds = [];
        for (const record of deletedRecords) {
            const deletedAtIso = normalizeToIsoString(record.deletedAt);
            if (deletedAtIso && deletedAtIso >= since) {
                if (record.id) {
                    deletedIds.push(record.id);
                }
            }
        }

        const serverTime = new Date().toISOString();
        const normalizedItems = normalizeRecordTimestamps(items, fallbackFields, serverTime, log, collectionKey);

        log.debug("Incremental sync query metrics", {
            collection: collectionKey,
            itemsQueryDurationMs,
            deletedQueryDurationMs,
            itemsReturned: normalizedItems.length,
            deletedCandidates: deletedRecords.length
        });

        log.info("Incremental sync complete", {
            collection: collectionKey,
            returnedItems: normalizedItems.length,
            deletedCount: deletedIds.length,
            since,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(200, { collection: collectionKey, returnedItems: normalizedItems.length });

        return jsonResponse(200, {
            collection: collectionKey,
            since,
            serverTime,
            items: normalizedItems,
            deletedIds
        });
    } catch (error) {
        const err = /** @type {any} */ (error);
        log.error("Failed to execute incremental sync", {
            message: err && err.message ? err.message : String(error),
            stack: err && err.stack ? err.stack : undefined,
            collection: collectionKey,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(500, { collection: collectionKey });
        return errorResponse(500, "sync_incremental_error", "Failed to retrieve incremental updates for the requested collection.");
    }
};

    const headers = getCorsHeaders(event);

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers };
    }

    const log = createLoggerFromEvent("sync-incremental", event, context);
    log.entry(createStandardEntryMeta(event));
    logDebugRequestSummary(log, event, {
        label: "Sync incremental request",
        includeBody: false
    });
    /** @type {any} */
    const timer = createTimer(log, "sync-incremental");
    const requestStartedAt = Date.now();

    if (event.httpMethod !== "GET") {
        log.warn("Method not allowed", { method: event.httpMethod });
        timer.end({ error: 'method_not_allowed' });
        log.exit(405);
        return jsonResponse(405, { error: "Method Not Allowed" });
    }

    const params = event.queryStringParameters || {};
    const collectionKey = params.collection;
    const since = params.since;

    if (!collectionKey) {
        log.warn("Missing collection query parameter");
        timer.end({ error: 'missing_collection' });
        log.exit(400);
        return errorResponse(400, "missing_collection", "The 'collection' query parameter is required.");
    }

    if (!since) {
        log.warn("Missing since query parameter", { collection: collectionKey });
        timer.end({ error: 'missing_since' });
        log.exit(400);
        return errorResponse(400, "missing_since", "The 'since' query parameter is required.");
    }

    if (!ISO_UTC_REGEX.test(since)) {
        log.warn("Invalid since timestamp format", { since });
        timer.end({ error: 'invalid_since' });
        log.exit(400);
        return errorResponse(400, "invalid_since", "The 'since' parameter must be an ISO 8601 UTC timestamp with milliseconds.");
    }

    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
        log.warn("Unparseable since timestamp", { since });
        return errorResponse(400, "invalid_since", "The 'since' parameter could not be parsed as a valid date.");
    }

    const config = COLLECTION_CONFIG[String(collectionKey)];
    if (!config) {
        log.warn("Unsupported collection requested", { collection: collectionKey });
        return errorResponse(400, "invalid_collection", `Collection '${collectionKey}' is not supported.`);
    }

    try {
        const collection = await getCollection(config.dbName);
        /** @type {FallbackField[]} */
        const fallbackFields = config.fallbackUpdatedAtFields || [];
        const filter = buildIncrementalFilter(since, sinceDate, fallbackFields);

        const itemsQueryStartedAt = Date.now();
        // OPTIMIZATION: Added limit(1000) to prevent massive result sets causing timeouts
        const items = await collection.find(filter, { projection: { _id: 0 } }).limit(1000).toArray();
        const itemsQueryDurationMs = Date.now() - itemsQueryStartedAt;

        const deletedCollection = await getCollection(COLLECTIONS.DELETED_RECORDS);
        const deletedQueryStartedAt = Date.now();
        const deletedRecords = await deletedCollection.find({ collection: config.dbName }, { projection: { _id: 0 } }).toArray();
        const deletedQueryDurationMs = Date.now() - deletedQueryStartedAt;

        /** @type {string[]} */
        const deletedIds = [];
        for (const record of deletedRecords) {
            const deletedAtIso = normalizeToIsoString(record.deletedAt);
            if (deletedAtIso && deletedAtIso >= since) {
                if (record.id) {
                    deletedIds.push(record.id);
                }
            }
        }

        const serverTime = new Date().toISOString();
        const normalizedItems = normalizeRecordTimestamps(items, fallbackFields, serverTime, log, collectionKey);

        log.debug("Incremental sync query metrics", {
            collection: collectionKey,
            itemsQueryDurationMs,
            deletedQueryDurationMs,
            itemsReturned: normalizedItems.length,
            deletedCandidates: deletedRecords.length
        });

        log.info("Incremental sync complete", {
            collection: collectionKey,
            returnedItems: normalizedItems.length,
            deletedCount: deletedIds.length,
            since,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(200, { collection: collectionKey, returnedItems: normalizedItems.length });

        return jsonResponse(200, {
            collection: collectionKey,
            since,
            serverTime,
            items: normalizedItems,
            deletedIds
        });
    } catch (error) {
        const err = /** @type {any} */ (error);
        log.error("Failed to execute incremental sync", {
            message: err && err.message ? err.message : String(error),
            stack: err && err.stack ? err.stack : undefined,
            collection: collectionKey,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(500, { collection: collectionKey });
        return errorResponse(500, "sync_incremental_error", "Failed to retrieve incremental updates for the requested collection.");
    }
};
