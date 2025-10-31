"use strict";

const MAX_BODY_BYTES = parseInt(process.env.MAX_FILE_SIZE || "10485760"); // 10MB default

/**
 * Safely parse JSON body from a Netlify event.
 * Returns { ok: true, value } or { ok: false, error }.
 */
function parseJsonBody(event) {
  try {
    if (!event || typeof event.body !== "string") {
      return { ok: false, error: "Missing request body" };
    }

    // Basic size guard; Netlify already limits but double-check
    const estimatedBytes = Buffer.byteLength(event.body, "utf8");
    if (estimatedBytes > MAX_BODY_BYTES) {
      return { ok: false, error: "Request body too large" };
    }

    const parsed = JSON.parse(event.body);
    return { ok: true, value: parsed };
  } catch (e) {
    return { ok: false, error: "Invalid JSON body" };
  }
}

/**
 * Validate analyze request minimal shape.
 * Accept legacy shape: { jobId, fileData, userId }
 */
function validateAnalyzeRequest(payload) {
  const details = { missing: [] };

  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Request payload must be an object" };
  }

  if (!payload.jobId || typeof payload.jobId !== "string") {
    details.missing.push("jobId");
  }
  if (!payload.fileData || typeof payload.fileData !== "string") {
    details.missing.push("fileData");
  }
  if (!payload.userId || typeof payload.userId !== "string") {
    details.missing.push("userId");
  }

  if (details.missing.length > 0) {
    return { ok: false, error: "Missing required parameters", details };
  }

  return { ok: true, value: payload };
}

module.exports = {
  parseJsonBody,
  validateAnalyzeRequest,
};


