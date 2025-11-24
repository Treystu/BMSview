"use strict";

// Structured error helpers for Netlify functions

/**
 * Create a standardized error payload.
 * @param {string} code - Stable, machine-readable error code.
 * @param {string} message - Human-readable message.
 * @param {object} [details] - Optional additional context (non-PII).
 */
function createErrorPayload(code, message, details) {
  try {
    const payload = { error: { code, message } };
    if (details && typeof details === "object") {
      payload.error.details = details;
    }
    return payload;
  } catch (error) {
    console.error('Error in createErrorPayload:', error);
    return { error: { code: 'internal_error', message: 'Failed to create error payload' } };
  }
}

/**
 * Build a Netlify response object for errors with structured body.
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @param {object} [headers]
 */
function errorResponse(statusCode, code, message, details, headers) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(createErrorPayload(code, message, details)),
  };
}

module.exports = {
  createErrorPayload,
  errorResponse,
};


