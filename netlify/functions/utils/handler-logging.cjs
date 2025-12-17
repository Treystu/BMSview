"use strict";

const { createLoggerFromEvent } = require("./logger.cjs");

/**
 * @param {Record<string, any>} [headers]
 * @returns {Record<string, any>}
 */
function sanitizeHeaders(headers = {}) {
    if (!headers || typeof headers !== "object") return {};

    const allow = ["user-agent", "x-request-id", "x-correlation-id", "referer", "origin", "host"];
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        const lk = String(k).toLowerCase();

        if (allow.includes(lk)) {
            out[lk] = typeof v === "string" ? v.slice(0, 200) : v;
            continue;
        }

        if (lk.includes("authorization") || lk.includes("cookie") || lk.includes("token") || lk.includes("api-key")) {
            out[lk] = "[REDACTED]";
        }
    }

    return out;
}

/**
 * @param {any} body
 * @returns {any}
 */
function safeJsonParse(body) {
    if (body == null) return null;
    if (typeof body !== "string") return body;
    if (!body.trim()) return null;
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

/**
 * Convert an arbitrary value to something safe-ish to log.
 * - Caps long strings
 * - Summarizes large objects/arrays
 * - Optionally limits keys
 *
 * @param {any} value
 * @param {{ maxStringLength?: number, maxKeys?: number, maxArrayLength?: number, maxDepth?: number }} [options]
 * @param {number} [depth]
 * @returns {any}
 */
function toSafeLogValue(value, options = {}, depth = 0) {
    const {
        maxStringLength = 5000,
        maxKeys = 50,
        maxArrayLength = 50,
        maxDepth = 3
    } = options;

    if (value == null) return value;

    const t = typeof value;
    if (t === 'string') {
        if (value.length <= maxStringLength) return value;
        return value.slice(0, maxStringLength) + `…[truncated ${value.length - maxStringLength} chars]`;
    }

    if (t === 'number' || t === 'boolean') return value;
    if (t === 'bigint') return value.toString();
    if (t === 'function') return `[Function ${value.name || 'anonymous'}]`;

    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) {
        if (depth >= maxDepth) return `[Array(${value.length})]`;
        const sliced = value.slice(0, maxArrayLength);
        const mapped = sliced.map((v) => toSafeLogValue(v, options, depth + 1));
        return value.length > maxArrayLength
            ? [...mapped, `…[+${value.length - maxArrayLength} more]`]
            : mapped;
    }

    if (t === 'object') {
        if (depth >= maxDepth) return `[Object keys=${Object.keys(value).length}]`;
        /** @type {Record<string, any>} */
        const out = {};
        const keys = Object.keys(value);
        const limited = keys.slice(0, maxKeys);
        for (const k of limited) {
            // Keep header/token safety even in debug dumps
            const lk = String(k).toLowerCase();
            if (lk.includes('authorization') || lk.includes('cookie') || lk.includes('token') || lk.includes('api-key')) {
                out[k] = '[REDACTED]';
                continue;
            }
            out[k] = toSafeLogValue(value[k], options, depth + 1);
        }
        if (keys.length > maxKeys) out.__truncatedKeys = keys.length - maxKeys;
        return out;
    }

    try {
        return String(value);
    } catch {
        return '[Unserializable]';
    }
}

/**
 * Emit a single debug log line that captures the request shape/params in a safe, capped way.
 * Designed to be used right after log.entry(...).
 *
 * @param {import('./logger.cjs').LogFunction} log
 * @param {any} event
 * @param {{ label?: string, includeBody?: boolean, bodyMaxStringLength?: number }} [options]
 */
function logDebugRequestSummary(log, event, options = {}) {
    if (!log || typeof log.debug !== 'function') return;

    const { label = 'Request summary', includeBody = true, bodyMaxStringLength = 20000 } = options;
    const parsedBody = includeBody ? safeJsonParse(event?.body) : undefined;

    const summary = {
        method: event?.httpMethod,
        path: event?.path,
        query: toSafeLogValue(event?.queryStringParameters, { maxStringLength: 2000 }),
        systemId: getSystemIdFromEvent(event),
        timeRange: getTimeRangeFromEvent(event),
        headers: sanitizeHeaders(event?.headers),
        bodyLength: event?.body ? String(event.body).length : 0,
        body: includeBody ? toSafeLogValue(parsedBody, { maxStringLength: bodyMaxStringLength }) : undefined
    };

    log.debug(label, summary);
}

/**
 * @param {any} event
 * @returns {string|null}
 */
function getSystemIdFromEvent(event) {
    const q = event?.queryStringParameters || {};
    const parsedBody = safeJsonParse(event?.body);

    return (
        q.systemId ||
        parsedBody?.systemId ||
        parsedBody?.system?.id ||
        parsedBody?.system?.systemId ||
        parsedBody?.analysis?.systemId ||
        null
    );
}

/**
 * @param {any} event
 * @returns {{ start: any, end: any }}
 */
function getTimeRangeFromEvent(event) {
    const q = event?.queryStringParameters || {};
    const parsedBody = safeJsonParse(event?.body);

    const start = q.start || q.startDate || parsedBody?.start || parsedBody?.startDate || parsedBody?.from || null;
    const end = q.end || q.endDate || parsedBody?.end || parsedBody?.endDate || parsedBody?.to || null;

    return { start, end };
}

/**
 * @param {any} event
 * @param {Record<string, any>} [extra]
 * @returns {Record<string, any>}
 */
function createStandardEntryMeta(event, extra = {}) {
    const systemId = getSystemIdFromEvent(event);
    const timeRange = getTimeRangeFromEvent(event);

    return {
        method: event?.httpMethod,
        path: event?.path,
        query: event?.queryStringParameters,
        systemId,
        timeRange,
        headers: sanitizeHeaders(event?.headers),
        bodyLength: event?.body ? String(event.body).length : 0,
        ...extra
    };
}

/**
 * @param {string} functionName
 * @param {any} event
 * @param {any} [context]
 * @param {{ jobId?: string, entryExtra?: Record<string, any> }} [options]
 */
function createStandardLogger(functionName, event, context = {}, options = {}) {
    const log = createLoggerFromEvent(
        functionName,
        event,
        context,
        options.jobId ? { jobId: options.jobId } : undefined
    );
    return { log, entryMeta: createStandardEntryMeta(event, options.entryExtra) };
}

module.exports = {
    createStandardLogger,
    createStandardEntryMeta,
    logDebugRequestSummary,
    getSystemIdFromEvent,
    getTimeRangeFromEvent,
    sanitizeHeaders
};
