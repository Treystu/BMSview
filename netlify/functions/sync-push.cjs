"use strict";

/**
 * @typedef {import('./utils/jsdoc-types.cjs').LogLike} LogLike
 * @typedef {import('./utils/jsdoc-types.cjs').CollectionConfig} CollectionConfig
 */

const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger, createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
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

/** @type {Record<string, { dbName: string }>} */
const COLLECTION_CONFIG = {
    systems: {
        dbName: "systems"
    },
    history: {
        dbName: "history"
    },
    "analysis-results": {
        dbName: "analysis-results"
    },
    analytics: {
        dbName: "system-analytics"
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

/**
 * @param {Record<string, any>} rawItem
 * @param {string} serverTime
 */
function sanitizeItem(rawItem, serverTime) {
    const sanitized = { ...rawItem };

    delete sanitized._id;
    sanitized.updatedAt = serverTime;
    sanitized._syncStatus = "synced";

    return sanitized;
}

/**
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
exports.handler = async function (event, context) {
    const log = createLoggerFromEvent("sync-push", event, context);
    /** @type {any} */
    const timer = createTimer(log, 'sync-push-handler');

    log.entry(createStandardEntryMeta(event));
    logDebugRequestSummary(log, event, {
        label: "Sync push request",
        includeBody: false
    });

    if (!validateEnvironment(log)) {
        timer.end({ success: false, error: 'configuration' });
        log.exit(500);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error' })
        };
    }

    const requestStartedAt = Date.now();

    if (event.httpMethod !== "POST") {
        log.warn("Method not allowed", { method: event.httpMethod });
        timer.end();
        log.exit(405);
        return jsonResponse(405, { error: "Method Not Allowed" });
    }

    if (!event.body) {
        log.warn("Missing request body");
        return errorResponse(400, "missing_body", "Request body is required.");
    }

    /** @type {any} */
    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (error) {
        const err = /** @type {any} */ (error);
        log.warn("Invalid JSON payload", { error: err && err.message ? err.message : String(error) });
        return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
    }

    const { collection: collectionKey, items } = payload || {};

    if (!collectionKey) {
        log.warn("Missing collection in payload");
        return errorResponse(400, "missing_collection", "The 'collection' field is required in the request body.");
    }

    const config = COLLECTION_CONFIG[collectionKey];
    if (!config) {
        log.warn("Unsupported collection requested", { collection: collectionKey });
        return errorResponse(400, "invalid_collection", `Collection '${collectionKey}' is not supported.`);
    }

    if (!Array.isArray(items)) {
        log.warn("Items payload is not an array", { type: typeof items });
        return errorResponse(400, "invalid_items", "The 'items' field must be an array.");
    }

    const serverTime = new Date().toISOString();
    /** @type {any[]} */
    const operations = [];
    let skipped = 0;

    for (const rawItem of items) {
        if (!rawItem || typeof rawItem !== "object") {
            skipped += 1;
            continue;
        }

        const itemId = rawItem.id;
        if (!itemId || typeof itemId !== "string") {
            skipped += 1;
            log.warn("Skipping item without valid id", { collection: collectionKey });
            continue;
        }

        const sanitizedItem = sanitizeItem(rawItem, serverTime);
        operations.push({
            updateOne: {
                filter: { id: itemId },
                update: { $set: sanitizedItem },
                upsert: true
            }
        });
    }

    if (operations.length === 0) {
        log.info("No valid items to process", { collection: collectionKey, skipped });
        log.exit(200, { collection: collectionKey, processed: 0 });
        return jsonResponse(200, {
            success: true,
            inserted: 0,
            updated: 0,
            processed: 0,
            skipped,
            serverTime
        });
    }

    try {
        const collection = await getCollection(config.dbName);
        const bulkStartedAt = Date.now();
        const result = await collection.bulkWrite(operations, { ordered: false });
        const bulkDurationMs = Date.now() - bulkStartedAt;

        const inserted = result.upsertedCount || 0;
        const updated = result.modifiedCount || 0;
        const matched = result.matchedCount || 0;
        const processed = operations.length;

        log.info("Sync push completed", {
            collection: collectionKey,
            processed,
            inserted,
            updated,
            matched,
            skipped,
            bulkDurationMs,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(200, { collection: collectionKey, processed, inserted, updated });
        timer.end({ success: true, processed, inserted, updated });

        return jsonResponse(200, {
            success: true,
            inserted,
            updated,
            processed,
            skipped,
            serverTime,
            bulkDurationMs
        });
    } catch (error) {
        const err = /** @type {any} */ (error);
        log.error("Failed to execute sync push", {
            message: err && err.message ? err.message : String(error),
            stack: err && err.stack ? err.stack : undefined,
            collection: collectionKey,
            durationMs: Date.now() - requestStartedAt
        });
        log.exit(500, { collection: collectionKey });
        timer.end({ success: false, error: err && err.message ? err.message : String(error) });
        return errorResponse(500, "sync_push_error", "Failed to persist items for the requested collection.");
    }
};
