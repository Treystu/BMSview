"use strict";

const crypto = require("crypto");
const { getCollection } = require("./utils/mongodb.cjs");

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}
const { createLogger, createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
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

function resolveUpdatedAt(doc, fallbackFields) {
    const directUpdatedAt = normalizeToIsoString(doc.updatedAt);
    if (directUpdatedAt) {
        return directUpdatedAt;
    }

    for (const field of fallbackFields) {
        const fieldValue = doc[field.name];
        if (!fieldValue) {
            continue;
        }

        if (field.type === "date" || field.type === "string") {
            const normalized = normalizeToIsoString(fieldValue);
            if (normalized) {
                return normalized;
            }
        }
    }

    return null;
}

function buildChecksumPayload(records, fallbackFields) {
    const payload = [];
    let lastModified = null;
    let legacyTimestampCount = 0;

    for (const record of records) {
        if (!record || !record.id) {
            continue;
        }

        const resolvedTimestamp = resolveUpdatedAt(record, fallbackFields);
        if (!resolvedTimestamp) {
            legacyTimestampCount += 1;
        }

        const timestampForChecksum = resolvedTimestamp || "1970-01-01T00:00:00.000Z";
        payload.push(`${record.id}:${timestampForChecksum}`);

        if (resolvedTimestamp) {
            if (!lastModified || resolvedTimestamp > lastModified) {
                lastModified = resolvedTimestamp;
            }
        }
    }

    return {
        payload,
        lastModified: lastModified || null,
        legacyTimestampCount
    };
}

async function calculateChecksum(payload) {
    if (!payload.length) {
        return null;
    }

    const sorted = payload.slice().sort().join("|");
    const hash = crypto.createHash("sha256");
    hash.update(sorted, "utf8");
    return hash.digest("hex");
}

exports.handler = async function (event, context) {
    const log = createLoggerFromEvent("sync-metadata", event, context);
    const timer = createTimer(log, 'sync-metadata-handler');
    
    log.entry({ method: event.httpMethod, path: event.path, query: event.queryStringParameters });
    
    if (!validateEnvironment(log)) {
      timer.end({ success: false, error: 'configuration' });
      log.exit(500);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }
    
    const requestStartedAt = Date.now();

    if (event.httpMethod !== "GET") {
        log.warn("Method not allowed", { method: event.httpMethod });
        timer.end();
        log.exit(405);
        return jsonResponse(405, { error: "Method Not Allowed" });
    }

    const collectionKey = event.queryStringParameters && event.queryStringParameters.collection;
    if (!collectionKey) {
        log.warn("Missing collection query parameter");
        return errorResponse(400, "missing_collection", "The 'collection' query parameter is required.");
    }

    const config = COLLECTION_CONFIG[collectionKey];
    if (!config) {
        log.warn("Unsupported collection requested", { collection: collectionKey });
        return errorResponse(400, "invalid_collection", `Collection '${collectionKey}' is not supported.`);
    }

    try {
        const collection = await getCollection(config.dbName);
        const fallbackFields = config.fallbackUpdatedAtFields || [];
        const projection = { _id: 0, id: 1, updatedAt: 1 };
        for (const field of fallbackFields) {
            projection[field.name] = 1;
        }

        const queryStartedAt = Date.now();
        const records = await collection.find({}, { projection }).toArray();
        const queryDurationMs = Date.now() - queryStartedAt;
        log.debug("Mongo query completed", {
            collection: collectionKey,
            queryDurationMs,
            recordsReturned: records.length
        });
        const recordCount = records.length;

        const { payload, lastModified, legacyTimestampCount } = buildChecksumPayload(records, fallbackFields);
        const checksum = await calculateChecksum(payload);
        const serverTime = new Date().toISOString();

        log.info("Sync metadata computed", {
            collection: collectionKey,
            recordCount,
            lastModified,
            checksumPresent: !!checksum,
            legacyTimestampCount,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(200, { collection: collectionKey, recordCount });
        timer.end({ success: true, recordCount });

        return jsonResponse(200, {
            collection: collectionKey,
            recordCount,
            lastModified,
            checksum,
            serverTime
        });
    } catch (error) {
        log.error("Failed to compute sync metadata", {
            message: error.message,
            stack: error.stack,
            collection: collectionKey,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(500, { collection: collectionKey });
        timer.end({ success: false, error: error.message });
        return errorResponse(500, "metadata_error", "Failed to compute metadata for the requested collection.");
    }
};
