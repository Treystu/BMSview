"use strict";

const MAX_BODY_BYTES = parseInt(process.env.MAX_FILE_SIZE || "10485760"); // 10MB default
const MAX_BASE64_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_SIZE || "6291456"); // 6MB default after base64
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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
  validateImagePayload,
};

/**
 * Validate image payload for sync analysis path
 * @param {{image:string,mimeType:string,fileName:string}} img
 */
function validateImagePayload(img) {
  if (!img || typeof img !== "object") return { ok: false, error: "Missing image payload" };
  if (!img.image || typeof img.image !== "string") return { ok: false, error: "Missing image data" };
  if (!img.mimeType || typeof img.mimeType !== "string") return { ok: false, error: "Missing mimeType" };
  if (!img.fileName || typeof img.fileName !== "string") return { ok: false, error: "Missing fileName" };

  if (!ALLOWED_IMAGE_MIME.has(img.mimeType)) {
    return { ok: false, error: "Unsupported image mimeType" };
  }
  // Rough base64 size check: each 4 chars ~ 3 bytes; account padding
  const approxBytes = Math.floor((img.image.length * 3) / 4);
  if (approxBytes > MAX_BASE64_IMAGE_BYTES) {
    return { ok: false, error: "Image too large" };
  }
  if (/\.(exe|js|sh|bat|ps1|cmd)$/i.test(img.fileName)) {
    return { ok: false, error: "Invalid fileName" };
  }
  return { ok: true };
}


