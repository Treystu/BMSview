"use strict";

/**
 * Shared JSDoc types for CommonJS Netlify Functions.
 *
 * This file intentionally exports nothing at runtime; it exists only to
 * provide reusable typedefs for TypeScript's `checkJs` mode.
 */

/**
 * @typedef {Object} LogLike
 * @property {(message: string, meta?: any) => void} debug
 * @property {(message: string, meta?: any) => void} info
 * @property {(message: string, meta?: any) => void} warn
 * @property {(message: string, meta?: any) => void} error
 * @property {(meta?: any) => void} [entry]
 * @property {(statusCode: number, meta?: any) => void} [exit]
 */

/**
 * @typedef {Object} TimerLike
 * @property {(meta?: any) => void} end
 */

/**
 * @typedef {{ name: string, type: 'date' | 'string' }} FallbackField
 */

/**
 * @typedef {{ dbName: string, fallbackUpdatedAtFields?: FallbackField[] }} CollectionConfig
 */

module.exports = {};
