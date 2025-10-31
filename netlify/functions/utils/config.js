/**
 * Shared Configuration Module
 * Centralized configuration management for all functions
 */

const { createLogger } = require('./logger');

class Config {
  constructor() {
    this.logger = createLogger('config');
    this._validateEnvironment();
  }

  _validateEnvironment() {
    const required = ['MONGODB_URI'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      this.logger.critical('Missing required environment variables', { missing });
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  // Database Configuration
  get mongodb() {
    return {
      uri: process.env.MONGODB_URI,
      database: process.env.MONGODB_DB || 'bmsview',
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '10'),
      minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '2'),
      timeout: parseInt(process.env.DB_TIMEOUT || '15000')
    };
  }

  // Gemini API Configuration
  get gemini() {
    return {
      apiKey: process.env.GEMINI_API_KEY,
      // ***UPDATED***: Changed default model to gemini-flash-latest
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
      maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS || '8192'),
      timeout: parseInt(process.env.GEMINI_TIMEOUT || '60000'),
      maxRetries: parseInt(process.env.GEMINI_MAX_RETRIES || '3')
    };
  }

  // Job Processing Configuration
  get jobs() {
    return {
      maxRetries: parseInt(process.env.JOB_MAX_RETRIES || '5'),
      retryDelayBase: parseInt(process.env.JOB_RETRY_DELAY_BASE || '60000'), // 1 minute
      processingTimeout: parseInt(process.env.JOB_PROCESSING_TIMEOUT || '300000'), // 5 minutes
      shepherdEnabled: process.env.JOB_SHEPHERD_ENABLED !== 'false',
      shepherdBatchSize: parseInt(process.env.JOB_SHEPHERD_BATCH_SIZE || '5'),
      shepherdInterval: parseInt(process.env.JOB_SHEPHERD_INTERVAL || '60000') // 1 minute
    };
  }

  // Site Configuration
  get site() {
    return {
      url: process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888',
      deployUrl: process.env.DEPLOY_PRIME_URL || process.env.URL,
      context: process.env.CONTEXT || 'development',
      isProd: process.env.CONTEXT === 'production',
      isDev: process.env.CONTEXT === 'dev' || process.env.CONTEXT === 'development'
    };
  }

  // Logging Configuration
  get logging() {
    return {
      level: process.env.LOG_LEVEL || 'INFO',
      verbose: process.env.LOG_VERBOSE === 'true',
      structuredLogging: process.env.LOG_STRUCTURED !== 'false'
    };
  }

  // Rate Limiting Configuration
  get rateLimiting() {
    return {
      enabled: process.env.RATE_LIMITING_ENABLED !== 'false',
      tokensPerMinute: parseInt(process.env.RATE_LIMIT_TOKENS_PER_MINUTE || '60'),
      circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5'),
      circuitBreakerTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '60000')
    };
  }

  // Security Configuration
  get security() {
    return {
      allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(','),
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB
      maxFilesPerRequest: parseInt(process.env.MAX_FILES_PER_REQUEST || '10')
    };
  }

  // Weather API Configuration
  get weather() {
    return {
      apiKey: process.env.WEATHER_API_KEY,
      provider: process.env.WEATHER_PROVIDER || 'openweathermap',
      timeout: parseInt(process.env.WEATHER_TIMEOUT || '10000')
    };
  }

  // Function URLs
  getFunctionUrl(functionName) {
    const baseUrl = this.site.url;
    return `${baseUrl}/.netlify/functions/${functionName}`;
  }

  // Get all configuration as object (for debugging)
  toObject() {
    return {
      mongodb: { ...this.mongodb, uri: '***' }, // Mask sensitive data
      gemini: { ...this.gemini, apiKey: this.gemini.apiKey ? '***' : undefined },
      jobs: this.jobs,
      site: this.site,
      logging: this.logging,
      rateLimiting: this.rateLimiting,
      security: this.security,
      weather: { ...this.weather, apiKey: this.weather.apiKey ? '***' : undefined }
    };
  }
}

// Singleton instance
let config = null;

function getConfig() {
  if (!config) {
    config = new Config();
  }
  return config;
}

module.exports = { getConfig, Config };
