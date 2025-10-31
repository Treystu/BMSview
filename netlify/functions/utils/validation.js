"use strict";

const MAX_BODY_BYTES = parseInt(process.env.MAX_FILE_SIZE || "10485760"); // 10MB default
const MAX_BASE64_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_SIZE || "6291456"); // 6MB default after base64
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Safely parse JSON body from a Netlify event.
 * Returns { ok: true, value } or { ok: false, error }.
 * @param {object} event - Netlify function event
 * @param {object} log - Optional logger instance for debug logging
 */
function parseJsonBody(event, log = null) {
  try {
    if (!event || typeof event.body !== "string") {
      if (log) {
        log.debug('JSON body parse failed: missing or invalid body', { 
          hasEvent: !!event, 
          bodyType: typeof event?.body 
        });
      }
      return { ok: false, error: "Missing request body" };
    }

    // Basic size guard; Netlify already limits but double-check
    const estimatedBytes = Buffer.byteLength(event.body, "utf8");
    if (log) {
      log.debug('Checking request body size', { estimatedBytes, maxBytes: MAX_BODY_BYTES });
    }
    
    if (estimatedBytes > MAX_BODY_BYTES) {
      if (log) {
        log.warn('Request body too large', { estimatedBytes, maxBytes: MAX_BODY_BYTES });
      }
      return { ok: false, error: "Request body too large" };
    }

    const parsed = JSON.parse(event.body);
    if (log) {
      log.debug('JSON body parsed successfully', { bodySize: estimatedBytes });
    }
    return { ok: true, value: parsed };
  } catch (e) {
    if (log) {
      log.debug('JSON body parse failed: invalid JSON', { error: e.message });
    }
    return { ok: false, error: "Invalid JSON body" };
  }
}

/**
 * Validate analyze request minimal shape.
 * Accept legacy shape: { jobId, fileData, userId }
 * @param {object} payload - Request payload to validate
 * @param {object} log - Optional logger instance for debug logging
 */
function validateAnalyzeRequest(payload, log = null) {
  const details = { missing: [] };

  if (!payload || typeof payload !== "object") {
    if (log) {
      log.debug('Validate analyze request failed: invalid payload type', { payloadType: typeof payload });
    }
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
    if (log) {
      log.debug('Validate analyze request failed: missing required fields', { missing: details.missing });
    }
    return { ok: false, error: "Missing required parameters", details };
  }

  if (log) {
    log.debug('Validate analyze request passed', { hasJobId: !!payload.jobId, hasFileData: !!payload.fileData, hasUserId: !!payload.userId });
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
 * @param {{image:string,mimeType:string,fileName:string}} img - Image payload to validate
 * @param {object} log - Optional logger instance for debug logging
 */
function validateImagePayload(img, log = null) {
  if (!img || typeof img !== "object") {
    if (log) {
      log.debug('Image payload validation failed: missing or invalid payload', { imgType: typeof img });
    }
    return { ok: false, error: "Missing image payload" };
  }
  if (!img.image || typeof img.image !== "string") {
    if (log) {
      log.debug('Image payload validation failed: missing image data', { hasImage: !!img.image, imageType: typeof img.image });
    }
    return { ok: false, error: "Missing image data" };
  }
  if (!img.mimeType || typeof img.mimeType !== "string") {
    if (log) {
      log.debug('Image payload validation failed: missing mimeType', { hasMimeType: !!img.mimeType });
    }
    return { ok: false, error: "Missing mimeType" };
  }
  if (!img.fileName || typeof img.fileName !== "string") {
    if (log) {
      log.debug('Image payload validation failed: missing fileName', { hasFileName: !!img.fileName });
    }
    return { ok: false, error: "Missing fileName" };
  }

  if (!ALLOWED_IMAGE_MIME.has(img.mimeType)) {
    if (log) {
      log.debug('Image payload validation failed: unsupported mimeType', { 
        mimeType: img.mimeType, 
        allowed: Array.from(ALLOWED_IMAGE_MIME) 
      });
    }
    return { ok: false, error: "Unsupported image mimeType" };
  }
  
  // Rough base64 size check: each 4 chars ~ 3 bytes; account padding
  const approxBytes = Math.floor((img.image.length * 3) / 4);
  if (log) {
    log.debug('Checking image size', { fileName: img.fileName, approxBytes, maxBytes: MAX_BASE64_IMAGE_BYTES });
  }
  
  if (approxBytes > MAX_BASE64_IMAGE_BYTES) {
    if (log) {
      log.warn('Image payload validation failed: image too large', { 
        fileName: img.fileName, 
        approxBytes, 
        maxBytes: MAX_BASE64_IMAGE_BYTES 
      });
    }
    return { ok: false, error: "Image too large" };
  }
  
  if (/\.(exe|js|sh|bat|ps1|cmd)$/i.test(img.fileName)) {
    if (log) {
      log.warn('Image payload validation failed: invalid file extension', { fileName: img.fileName });
    }
    return { ok: false, error: "Invalid fileName" };
  }
  
  if (log) {
    log.debug('Image payload validation passed', { 
      fileName: img.fileName, 
      mimeType: img.mimeType, 
      approxBytes 
    });
  }
  return { ok: true };
}


