"use strict";

const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");
const { errorResponse } = require("./utils/errors.cjs");

const JSON_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
};

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const COLLECTION_CONFIG = {
    systems: {
        dbName: "systems",
        fallbackUpdatedAtFields: [
            { name: "createdAt", type: "date" },
            { name: "timestamp", type: "string" }
        ]
    },
    history: {
        dbName: "history",
        fallbackUpdatedAtFields: [
            { name: "timestamp", type: "string" },
            { name: "createdAt", type: "date" }
        ]
    },
    "analysis-results": {
        dbName: "analysis-results",
        fallbackUpdatedAtFields: [
            { name: "timestamp", type: "string" },
            { name: "createdAt", type: "date" }
        ]
    },
    analytics: {
        dbName: "system-analytics",
        fallbackUpdatedAtFields: [
            { name: "timestamp", type: "string" },
            { name: "createdAt", type: "date" }
        ]
    }
};

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: JSON_HEADERS,
        body: JSON.stringify(body)
    };
}

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

function buildIncrementalFilter(sinceIso, sinceDate, fallbackFields) {
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

    // Include legacy documents with no timestamp so they sync at least once
    orClauses.push({ updatedAt: { $exists: false } });

    return { $or: orClauses };
}

function normalizeRecordTimestamps(records, fallbackFields, serverTime, log, collectionKey) {
    let missingCount = 0;
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

exports.handler = async function (event, context) {
    const log = createLogger("sync-incremental", context);
    log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });
    const requestStartedAt = Date.now();

    if (event.httpMethod !== "GET") {
        log.warn("Method not allowed", { method: event.httpMethod });
        return jsonResponse(405, { error: "Method Not Allowed" });
    }

    const params = event.queryStringParameters || {};
    const collectionKey = params.collection;
    const since = params.since;

    if (!collectionKey) {
        log.warn("Missing collection query parameter");
        return errorResponse(400, "missing_collection", "The 'collection' query parameter is required.");
    }

    if (!since) {
        log.warn("Missing since query parameter", { collection: collectionKey });
        return errorResponse(400, "missing_since", "The 'since' query parameter is required.");
    }

    if (!ISO_UTC_REGEX.test(since)) {
        log.warn("Invalid since timestamp format", { since });
        return errorResponse(400, "invalid_since", "The 'since' parameter must be an ISO 8601 UTC timestamp with milliseconds.");
    }

    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
        log.warn("Unparseable since timestamp", { since });
        return errorResponse(400, "invalid_since", "The 'since' parameter could not be parsed as a valid date.");
    }

    const config = COLLECTION_CONFIG[collectionKey];
    if (!config) {
        log.warn("Unsupported collection requested", { collection: collectionKey });
        return errorResponse(400, "invalid_collection", `Collection '${collectionKey}' is not supported.`);
    }

    try {
        const collection = await getCollection(config.dbName);
        const fallbackFields = config.fallbackUpdatedAtFields || [];
        const filter = buildIncrementalFilter(since, sinceDate, fallbackFields);

        const itemsQueryStartedAt = Date.now();
        const items = await collection.find(filter, { projection: { _id: 0 } }).toArray();
        const itemsQueryDurationMs = Date.now() - itemsQueryStartedAt;

        const deletedCollection = await getCollection("deleted-records");
        const deletedQueryStartedAt = Date.now();
        const deletedRecords = await deletedCollection.find({ collection: config.dbName }, { projection: { _id: 0 } }).toArray();
        const deletedQueryDurationMs = Date.now() - deletedQueryStartedAt;

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
        log.error("Failed to execute incremental sync", {
            message: error.message,
            stack: error.stack,
            collection: collectionKey,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(500, { collection: collectionKey });
        return errorResponse(500, "sync_incremental_error", "Failed to retrieve incremental updates for the requested collection.");
    }
};
