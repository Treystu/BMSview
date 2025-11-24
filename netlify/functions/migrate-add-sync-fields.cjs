"use strict";

const { getCollection } = require("./utils/mongodb.cjs");
const { createLogger } = require("./utils/logger.cjs");

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

const TARGET_COLLECTIONS = [
    "systems",
    "history",
    "analysis-results"
];

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: JSON_HEADERS,
        body: JSON.stringify(body)
    };
}

function normalizeTimestamp(value, fallback) {
    if (!value) {
        return fallback;
    }

    if (typeof value === "string") {
        if (ISO_UTC_REGEX.test(value)) {
            return value;
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
        return fallback;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return fallback;
}

async function migrateCollection(collectionName, serverTimeIso, log) {
    const collection = await getCollection(collectionName);

    const filter = {
        $or: [
            { updatedAt: { $exists: false } },
            { updatedAt: null },
            { _syncStatus: { $exists: false } },
            { _syncStatus: null }
        ]
    };

    const cursor = collection.find(filter);
    const operations = [];
    let examined = 0;
    let modified = 0;

    for await (const doc of cursor) {
        examined += 1;
        const setPayload = {};

        if (!doc.updatedAt) {
            const candidate = normalizeTimestamp(doc.timestamp, normalizeTimestamp(doc.createdAt, serverTimeIso));
            setPayload.updatedAt = candidate || serverTimeIso;
        } else if (typeof doc.updatedAt !== "string" || !ISO_UTC_REGEX.test(doc.updatedAt)) {
            setPayload.updatedAt = normalizeTimestamp(doc.updatedAt, serverTimeIso);
        }

        if (!doc._syncStatus || typeof doc._syncStatus !== "string") {
            setPayload._syncStatus = "synced";
        }

        if (Object.keys(setPayload).length > 0) {
            operations.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: setPayload }
                }
            });
            modified += 1;
        }

        if (operations.length >= 500) {
            await collection.bulkWrite(operations, { ordered: false });
            operations.length = 0;
        }
    }

    if (operations.length > 0) {
        await collection.bulkWrite(operations, { ordered: false });
    }

    const total = await collection.countDocuments();

    await Promise.all([
        collection.createIndex({ updatedAt: 1 }),
        collection.createIndex({ _syncStatus: 1 })
    ]);

    log.info("Collection migration complete", {
        collection: collectionName,
        examined,
        modified,
        total
    });

    return { collection: collectionName, examined, modified, total };
}

async function ensureSyncMetadata(serverTimeIso, migrationSummaries, log) {
    const syncMetadataCollection = await getCollection("sync-metadata");
    const bulkOperations = [];

    for (const summary of migrationSummaries) {
        const name = summary.collection;
        bulkOperations.push({
            updateOne: {
                filter: { id: name },
                update: {
                    $set: {
                        id: name,
                        collection: name,
                        lastModified: serverTimeIso,
                        recordCount: summary.total,
                        checksum: null,
                        updatedAt: serverTimeIso,
                        _syncStatus: "synced"
                    }
                },
                upsert: true
            }
        });
    }

    if (bulkOperations.length > 0) {
        await syncMetadataCollection.bulkWrite(bulkOperations, { ordered: false });
    }

    log.info("sync-metadata collection prepared", { collections: TARGET_COLLECTIONS.length });
}

async function ensureDeletedRecordsIndexes(log) {
    const deletedRecords = await getCollection("deleted-records");
    await deletedRecords.createIndex({ collection: 1, deletedAt: 1 });
    log.info("deleted-records indexes ensured");
}

exports.handler = async function (event, context) {
    const log = createLogger("migrate-add-sync-fields", context);
    
    if (!validateEnvironment(log)) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }
    
    log.entry({ method: event.httpMethod, path: event.path });

    if (event.httpMethod !== "POST") {
        log.warn("Method not allowed", { method: event.httpMethod });
        return jsonResponse(405, { error: "Method Not Allowed" });
    }

    const serverTimeIso = new Date().toISOString();

    try {
        const results = [];

        for (const collectionName of TARGET_COLLECTIONS) {
            const summary = await migrateCollection(collectionName, serverTimeIso, log);
            results.push(summary);
        }

        await ensureSyncMetadata(serverTimeIso, results, log);
        await ensureDeletedRecordsIndexes(log);

        log.exit(200, { migratedCollections: TARGET_COLLECTIONS.length });

        return jsonResponse(200, {
            success: true,
            migratedCollections: results,
            syncMetadataInitialized: true,
            serverTime: serverTimeIso
        });
    } catch (error) {
        log.error("Migration failed", { message: error.message, stack: error.stack });
        log.exit(500, {});
        return errorResponse(500, "migration_error", "Failed to perform sync field migration.");
    }
};
