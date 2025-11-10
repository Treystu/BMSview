/**
 * CORS Utilities - Centralized CORS and security headers
 * 
 * Provides controlled CORS configuration with allowlist support.
 * Can be extended with rate limiting in the future.
 */

/**
 * Get allowed origins from environment or use defaults
 * @returns {string[]} Array of allowed origins
 */
function getAllowedOrigins() {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map(o => o.trim());
  }
  
  // Default: Allow Netlify deployment URLs and localhost for development
  const defaults = [
    'http://localhost:8888',
    'http://localhost:5173',
    'http://127.0.0.1:8888',
    'http://127.0.0.1:5173'
  ];
  
  // Add deployment URL if available
  if (process.env.URL) {
    defaults.push(process.env.URL);
    defaults.push(process.env.URL.replace('http://', 'https://'));
  }
  
  // Add deploy preview URLs
  if (process.env.DEPLOY_PRIME_URL) {
    defaults.push(process.env.DEPLOY_PRIME_URL);
  }
  
  return defaults;
}

/**
 * Get CORS headers for a request
 * Validates origin against allowlist
 * @param {Object} event - Lambda event object
 * @param {boolean} allowWildcard - Allow wildcard (*) for development (default: false in production)
 * @returns {Object} CORS headers
 */
function getCorsHeaders(event, allowWildcard = false) {
  const requestOrigin = event?.headers?.origin || event?.headers?.Origin;
  const allowedOrigins = getAllowedOrigins();
  
  // In production, use strict origin checking unless explicitly allowing wildcard
  const isProduction = process.env.CONTEXT === 'production';
  const useWildcard = allowWildcard || !isProduction;
  
  let allowOrigin = '*';
  
  if (!useWildcard) {
    // Strict mode: only allow specific origins
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else {
      // If origin doesn't match, use first allowed origin as fallback
      allowOrigin = allowedOrigins[0] || '*';
    }
  }
  
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400', // 24 hours
    'Vary': 'Origin' // Important for caching with different origins
  };
}

/**
 * Check if request origin is allowed
 * @param {Object} event - Lambda event object
 * @returns {boolean} True if origin is allowed
 */
function isOriginAllowed(event) {
  const requestOrigin = event?.headers?.origin || event?.headers?.Origin;
  if (!requestOrigin) return true; // Allow requests without origin header
  
  const allowedOrigins = getAllowedOrigins();
  return allowedOrigins.includes(requestOrigin);
}

module.exports = {
  getCorsHeaders,
  isOriginAllowed,
  getAllowedOrigins
};
