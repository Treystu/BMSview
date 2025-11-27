"use strict";

/**
 * Security Sanitization Utilities
 * Provides input sanitization and validation for AI feedback endpoints
 * 
 * Protects against:
 * - NoSQL injection attacks
 * - Prompt injection attacks
 * - XSS in stored data
 * - Path traversal
 * - Excessive data lengths
 */

// Maximum lengths for various input types
const MAX_LENGTHS = {
  systemId: 100,
  customPrompt: 5000,
  analysisDataString: 100000, // 100KB for stringified analysis data
  jobId: 100,
  modelOverride: 50,
  stringField: 1000,
  arrayLength: 100
};

// Patterns that indicate potential NoSQL injection
const NOSQL_INJECTION_PATTERNS = [
  /\$(?:where|gt|gte|lt|lte|ne|eq|in|nin|and|or|not|nor|exists|type|regex|expr|mod|text|all|elemMatch|size|slice|meta)/i,
  /'\s*;\s*|\s*;\s*'/,      // SQL injection patterns (shouldn't appear in MongoDB queries)
  /--\s*$/                   // SQL comment
];

// High-confidence prompt injection patterns that should cause rejection
const HIGH_CONFIDENCE_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(everything|all)\s+(you|that)/i,
  /\[INST\]|\[\/INST\]/i,   // Instruction markers commonly used in jailbreaks
  /<\|system\|>|<\|user\|>/i // Special tokens for model manipulation
];

// Lower-confidence patterns that warrant warning but not rejection
const SUSPICIOUS_PROMPT_PATTERNS = [
  /you\s+are\s+now\s+a/i,
  /pretend\s+(to\s+be|you\s+are)/i,
  /act\s+as\s+(if|though)/i,
  /new\s+instructions?:/i,
  /system\s+prompt:/i
];

/**
 * Sanitization error class
 */
class SanitizationError extends Error {
  constructor(message, field, type) {
    super(message);
    this.name = 'SanitizationError';
    this.field = field;
    this.type = type;
    this.statusCode = 400;
  }
}

/**
 * Check if a value contains NoSQL injection patterns
 * @param {*} value - Value to check
 * @returns {boolean} True if potentially malicious
 */
function hasNoSqlInjection(value) {
  if (typeof value !== 'string') return false;
  return NOSQL_INJECTION_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Check if a prompt contains injection patterns
 * @param {string} prompt - Prompt to check
 * @returns {Object} { detected: boolean, highConfidence: boolean, patterns: string[] }
 */
function detectPromptInjection(prompt) {
  if (typeof prompt !== 'string') {
    return { detected: false, highConfidence: false, patterns: [] };
  }
  
  const detectedPatterns = [];
  let highConfidence = false;
  
  // Check high-confidence patterns first
  for (const pattern of HIGH_CONFIDENCE_INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      detectedPatterns.push(pattern.source);
      highConfidence = true;
    }
  }
  
  // Check lower-confidence patterns
  for (const pattern of SUSPICIOUS_PROMPT_PATTERNS) {
    if (pattern.test(prompt)) {
      detectedPatterns.push(pattern.source);
    }
  }
  
  return {
    detected: detectedPatterns.length > 0,
    highConfidence,
    patterns: detectedPatterns
  };
}

/**
 * Sanitize a string by removing potentially dangerous characters
 * @param {string} str - String to sanitize
 * @param {Object} options - Sanitization options
 * @returns {string} Sanitized string
 */
function sanitizeString(str, options = {}) {
  if (typeof str !== 'string') return str;
  
  const {
    maxLength = MAX_LENGTHS.stringField,
    allowHtml = false,
    allowNewlines = true,
    trimWhitespace = true
  } = options;
  
  let result = str;
  
  // Truncate to max length
  if (result.length > maxLength) {
    result = result.substring(0, maxLength);
  }
  
  // Remove null bytes
  result = result.replace(/\0/g, '');
  
  // Strip HTML if not allowed
  // Using a simple but robust approach: remove all tags and encode remaining angle brackets
  if (!allowHtml) {
    // Remove all HTML-style tags repeatedly until none remain
    // This handles nested and malformed tags
    let previousResult;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops on malicious input
    
    do {
      previousResult = result;
      // Remove anything that looks like an HTML tag (opening or closing)
      // Use a permissive pattern that catches variations in spacing
      result = result.replace(/<\/?[a-zA-Z][^>]*>/gi, '');
      iterations++;
    } while (result !== previousResult && result.includes('<') && iterations < maxIterations);
    
    // Final safety: encode any remaining < or > characters to prevent XSS
    // This catches malformed tags that weren't removed above
    result = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  
  // Normalize newlines or remove them
  if (!allowNewlines) {
    result = result.replace(/[\r\n]/g, ' ');
  } else {
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  
  // Trim whitespace
  if (trimWhitespace) {
    result = result.trim();
  }
  
  return result;
}

/**
 * Sanitize a systemId
 * @param {string} systemId - System ID to sanitize
 * @param {Object} log - Logger instance
 * @returns {string} Sanitized systemId
 * @throws {SanitizationError} If systemId is invalid
 */
function sanitizeSystemId(systemId, log) {
  if (!systemId || typeof systemId !== 'string') {
    throw new SanitizationError('Invalid systemId: must be a non-empty string', 'systemId', 'invalid_type');
  }
  
  // Check for NoSQL injection
  if (hasNoSqlInjection(systemId)) {
    log.warn('NoSQL injection attempt detected in systemId', { 
      systemId: systemId.substring(0, 20) + '...' 
    });
    throw new SanitizationError('Invalid systemId: contains forbidden patterns', 'systemId', 'injection_detected');
  }
  
  // Allow only alphanumeric, hyphens, underscores
  const sanitized = sanitizeString(systemId, { maxLength: MAX_LENGTHS.systemId });
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new SanitizationError(
      'Invalid systemId: must contain only alphanumeric characters, hyphens, and underscores',
      'systemId',
      'invalid_format'
    );
  }
  
  return sanitized;
}

/**
 * Sanitize a custom prompt for AI insights
 * @param {string} prompt - Custom prompt to sanitize
 * @param {Object} log - Logger instance
 * @returns {Object} { sanitized: string, warnings: string[] }
 */
function sanitizeCustomPrompt(prompt, log) {
  if (!prompt) {
    return { sanitized: null, warnings: [] };
  }
  
  if (typeof prompt !== 'string') {
    throw new SanitizationError('Invalid customPrompt: must be a string', 'customPrompt', 'invalid_type');
  }
  
  const warnings = [];
  
  // Check for prompt injection
  const injectionCheck = detectPromptInjection(prompt);
  if (injectionCheck.detected) {
    log.warn('Prompt injection patterns detected', {
      patterns: injectionCheck.patterns,
      highConfidence: injectionCheck.highConfidence,
      promptPreview: prompt.substring(0, 50) + '...'
    });
    
    // Reject high-confidence injection attempts outright
    if (injectionCheck.highConfidence) {
      throw new SanitizationError(
        'Prompt contains disallowed content that appears to be an injection attempt',
        'customPrompt',
        'prompt_injection_detected'
      );
    }
    
    warnings.push('Potential prompt injection patterns detected and filtered');
  }
  
  // Sanitize the prompt
  let sanitized = sanitizeString(prompt, {
    maxLength: MAX_LENGTHS.customPrompt,
    allowHtml: false,
    allowNewlines: true
  });
  
  // Remove any detected suspicious patterns (lower confidence ones)
  // Ensure global replacement of all occurrences
  for (const pattern of SUSPICIOUS_PROMPT_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
    const globalPattern = new RegExp(pattern.source, flags);
    sanitized = sanitized.replace(globalPattern, '[FILTERED]');
  }
  
  if (sanitized.length !== prompt.length) {
    warnings.push('Prompt was truncated or modified during sanitization');
  }
  
  return { sanitized, warnings };
}

/**
 * Sanitize analysis data object
 * @param {Object} analysisData - Analysis data to sanitize
 * @param {Object} log - Logger instance
 * @returns {Object} Sanitized analysis data
 */
function sanitizeAnalysisData(analysisData, log) {
  if (!analysisData) {
    return null;
  }
  
  if (typeof analysisData !== 'object' || Array.isArray(analysisData)) {
    throw new SanitizationError('Invalid analysisData: must be an object', 'analysisData', 'invalid_type');
  }
  
  // Check size
  const jsonString = JSON.stringify(analysisData);
  if (jsonString.length > MAX_LENGTHS.analysisDataString) {
    throw new SanitizationError(
      `analysisData exceeds maximum size of ${MAX_LENGTHS.analysisDataString} bytes`,
      'analysisData',
      'size_exceeded'
    );
  }
  
  // Deep sanitize the object
  return sanitizeObject(analysisData, log, 'analysisData', 0);
}

/**
 * Recursively sanitize an object
 * @param {Object} obj - Object to sanitize
 * @param {Object} log - Logger instance
 * @param {string} path - Current path for logging
 * @param {number} depth - Current recursion depth
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj, log, path, depth) {
  const MAX_DEPTH = 10;
  
  if (depth > MAX_DEPTH) {
    log.warn('Object nesting too deep, truncating', { path, depth });
    return '[TRUNCATED: TOO DEEP]';
  }
  
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    if (obj.length > MAX_LENGTHS.arrayLength) {
      log.warn('Array too long, truncating', { path, length: obj.length });
      obj = obj.slice(0, MAX_LENGTHS.arrayLength);
    }
    return obj.map((item, idx) => sanitizeObject(item, log, `${path}[${idx}]`, depth + 1));
  }
  
  if (typeof obj === 'string') {
    // Check for injection in string values
    if (hasNoSqlInjection(obj)) {
      log.warn('NoSQL injection detected in object field', { path });
      return '[FILTERED]';
    }
    return sanitizeString(obj);
  }
  
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip keys that start with $ (MongoDB operators)
      if (key.startsWith('$')) {
        log.warn('MongoDB operator key detected and removed', { path, key });
        continue;
      }
      
      // Sanitize key name
      const sanitizedKey = key.replace(/[^\w.-]/g, '_');
      sanitized[sanitizedKey] = sanitizeObject(value, log, `${path}.${sanitizedKey}`, depth + 1);
    }
    return sanitized;
  }
  
  // Numbers, booleans, etc. pass through
  return obj;
}

/**
 * Sanitize a jobId for resume operations
 * @param {string} jobId - Job ID to sanitize
 * @param {Object} log - Logger instance
 * @returns {string} Sanitized jobId
 */
function sanitizeJobId(jobId, log) {
  if (!jobId || typeof jobId !== 'string') {
    throw new SanitizationError('Invalid jobId: must be a non-empty string', 'jobId', 'invalid_type');
  }
  
  if (hasNoSqlInjection(jobId)) {
    log.warn('NoSQL injection attempt in jobId', { jobId: jobId.substring(0, 20) });
    throw new SanitizationError('Invalid jobId: contains forbidden patterns', 'jobId', 'injection_detected');
  }
  
  const sanitized = sanitizeString(jobId, { maxLength: MAX_LENGTHS.jobId });
  
  // Job IDs should match expected format
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    throw new SanitizationError(
      'Invalid jobId: must contain only alphanumeric characters, hyphens, and underscores',
      'jobId',
      'invalid_format'
    );
  }
  
  return sanitized;
}

/**
 * Validate and sanitize complete insights request payload
 * @param {Object} body - Request body
 * @param {Object} log - Logger instance
 * @returns {Object} Sanitized payload
 */
function sanitizeInsightsRequest(body, log) {
  if (!body || typeof body !== 'object') {
    throw new SanitizationError('Invalid request body', 'body', 'invalid_type');
  }
  
  const sanitized = {
    warnings: []
  };
  
  // Sanitize each field
  if (body.systemId) {
    sanitized.systemId = sanitizeSystemId(body.systemId, log);
  }
  
  if (body.analysisData) {
    sanitized.analysisData = sanitizeAnalysisData(body.analysisData, log);
  }
  
  // Also sanitize batteryData (legacy field name) to prevent bypass
  if (body.batteryData) {
    sanitized.batteryData = sanitizeAnalysisData(body.batteryData, log);
  }
  
  if (body.customPrompt) {
    const promptResult = sanitizeCustomPrompt(body.customPrompt, log);
    sanitized.customPrompt = promptResult.sanitized;
    sanitized.warnings.push(...promptResult.warnings);
  }
  
  if (body.resumeJobId) {
    sanitized.resumeJobId = sanitizeJobId(body.resumeJobId, log);
  }
  
  // Pass through safe scalar values
  if (typeof body.contextWindowDays === 'number') {
    sanitized.contextWindowDays = Math.min(Math.max(1, body.contextWindowDays), 365);
  }
  
  if (typeof body.maxIterations === 'number') {
    sanitized.maxIterations = Math.min(Math.max(1, body.maxIterations), 50);
  }
  
  if (typeof body.modelOverride === 'string') {
    sanitized.modelOverride = sanitizeString(body.modelOverride, { 
      maxLength: MAX_LENGTHS.modelOverride 
    });
  }
  
  if (typeof body.mode === 'string') {
    // Only allow known modes
    const allowedModes = ['sync', 'background'];
    sanitized.mode = allowedModes.includes(body.mode) ? body.mode : 'sync';
  }
  
  // Boolean fields
  if (typeof body.consentGranted === 'boolean') {
    sanitized.consentGranted = body.consentGranted;
  }
  
  if (typeof body.initializationComplete === 'boolean') {
    sanitized.initializationComplete = body.initializationComplete;
  }
  
  return sanitized;
}

module.exports = {
  sanitizeString,
  sanitizeSystemId,
  sanitizeCustomPrompt,
  sanitizeAnalysisData,
  sanitizeJobId,
  sanitizeInsightsRequest,
  sanitizeObject,
  hasNoSqlInjection,
  detectPromptInjection,
  SanitizationError,
  MAX_LENGTHS
};
