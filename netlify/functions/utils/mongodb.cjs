// @ts-nocheck
"use strict";

const { MongoClient } = require("mongodb");
const crypto = require("crypto");
const { createLogger } = require("./logger.cjs");

// Module-scoped logger for utils/mongodb (no request context available here)
const log = createLogger("utils/mongodb");

/**
 * OPTIMIZED MongoDB Connection Manager
 * Consolidates connection pooling with aggressive resource management
 * Fixes connection overload issues by reducing pool size and improving reuse
 * 
 * Extended with encryption utilities for sensitive data at rest
 */

// Retrieve MongoDB connection string; may be undefined in test environments.
const MONGODB_URI = process.env.MONGODB_URI;
const FORCE_TEST_MOCK = process.env.FORCE_TEST_MOCK === '1' || !!process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test';
// Support both MONGODB_DB_NAME and MONGODB_DB for backward compatibility
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "bmsview";
// Encryption key for field-level encryption (must be 32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY || null;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // GCM mode uses 16-byte IV

// PBKDF2 configuration for secure key derivation
// Using a fixed salt for deterministic key derivation from the same environment variable
// The salt doesn't need to be secret, just unique to this application
const PBKDF2_SALT = 'bmsview-encryption-v1'; // Application-specific salt
const PBKDF2_ITERATIONS = 100000; // NIST recommends at least 10,000 for PBKDF2
const PBKDF2_KEY_LENGTH = 32; // 256 bits for AES-256
const PBKDF2_DIGEST = 'sha256';

// Cache for derived key to avoid repeated PBKDF2 computations
let cachedDerivedKey = null;

// NOTE: Validation moved to getDb() function to prevent module-load-time errors.
// If MONGODB_URI is missing (e.g., in CI/tests), connectToDatabase will return a mock DB.


/**
 * @type {import('mongodb').MongoClient}
 */
let cachedClient = null;
/**
 * @type {import('mongodb').Db}
 */
let cachedDb = null;
let connectionPromise = null;
let lastHealthCheck = null;
const HEALTH_CHECK_INTERVAL = 60000; // 60 seconds (reduced frequency)

/**
 * Performs a lightweight health check on the database connection
 * @param {import('mongodb').MongoClient} client 
 * @returns {boolean}
 */
function isClientHealthy(client) {
    try {
        return client && client.topology && client.topology.isConnected();
    } catch (error) {
        log.error('MongoDB health check failed', { error: error.message });
        return false;
    }
}

async function connectToDatabase() {
    // Return cached connection if available and healthy
    if (cachedClient && cachedDb) {
        const now = Date.now();

        // Perform periodic health checks (less frequent to reduce overhead)
        if (!lastHealthCheck || (now - lastHealthCheck) > HEALTH_CHECK_INTERVAL) {
            const isHealthy = isClientHealthy(cachedClient);
            lastHealthCheck = now;

            if (isHealthy) {
                log.info('MongoDB connection cache HIT (healthy, reusing)', {
                    cacheAge: now - lastHealthCheck,
                    healthCheckInterval: HEALTH_CHECK_INTERVAL
                });
                return { client: cachedClient, db: cachedDb };
            } else {
                // Connection is unhealthy, reset cache and reconnect
                log.warn('MongoDB connection unhealthy, reconnecting...', {
                    cacheAge: now - lastHealthCheck
                });
                await closeConnection();
            }
        } else {
            log.info('MongoDB connection cache HIT (recent health check, reusing)', {
                timeSinceHealthCheck: now - lastHealthCheck,
                healthCheckInterval: HEALTH_CHECK_INTERVAL
            });
            return { client: cachedClient, db: cachedDb };
        }
    }

    log.info('MongoDB connection cache MISS (creating new connection)', {
        hasCachedClient: !!cachedClient,
        hasCachedDb: !!cachedDb,
        hasConnectionPromise: !!connectionPromise
    });

    // If connection is in progress, wait for it
    if (connectionPromise) {
        return connectionPromise;
    }

    // Create new connection with OPTIMIZED pooling configuration
    connectionPromise = (async () => {
        let client = null;
        try {
            // If we're in a test environment or URI is missing, use a mock DB
            if (FORCE_TEST_MOCK || !MONGODB_URI) {
                log.info('MONGODB_URI not set - using mock DB');
                cachedClient = null;
                cachedDb = {
                    collection: () => ({
                        find: () => ({ toArray: async () => [] }),
                        insertOne: async () => ({ insertedId: null }),
                        updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 })
                    })
                };
                return { client: null, db: cachedDb };
            }

            log.info('Attempting MongoDB connection', {
                databaseName: DB_NAME,
                uriPreview: MONGODB_URI.substring(0, 20) + '...',
                hasUri: !!MONGODB_URI
            });

            client = new MongoClient(MONGODB_URI, {
                // TLS settings - more permissive for compatibility
                tls: true,
                tlsAllowInvalidCertificates: false,
                tlsAllowInvalidHostnames: false,

                // OPTIMIZED: Reduced pool size to prevent connection overload
                maxPoolSize: 5,        // Reduced from 10 to 5
                minPoolSize: 1,        // Keep at least 1 connection alive
                maxIdleTimeMS: 60000,  // Increased back to 60s - don't close connections too aggressively

                // Timeout settings - balanced for serverless
                serverSelectionTimeoutMS: 10000,  // Increased to 10s for serverless cold starts
                socketTimeoutMS: 45000,           // Increased back to 45s
                connectTimeoutMS: 10000,

                // Retry settings
                retryWrites: true,
                retryReads: true,

                // Write concern for better performance
                w: 'majority',
                wtimeoutMS: 5000,

                // Enable monitoring to diagnose issues
                monitorCommands: process.env.NODE_ENV !== 'production',
            });

            // Connect with timeout
            await Promise.race([
                client.connect(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('MongoDB connection timeout')), 10000)
                )
            ]);

            const db = client.db(DB_NAME);

            // Verify connection with ping
            await db.admin().ping();

            // Create indexes (non-blocking error handling with timeout)
            try {
                await Promise.race([
                    createIndexes(db),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Index creation timeout')), 2000))
                ]);
            } catch (idxError) {
                log.warn('Index creation failed or timed out (non-fatal)', { error: idxError.message });
            }

            // Cache the connection
            cachedClient = client;
            cachedDb = db;
            lastHealthCheck = Date.now();

            log.info('MongoDB connected successfully with optimized pool settings');

            // Set up connection monitoring
            client.on('connectionPoolClosed', () => {
                log.info('MongoDB connection pool closed');
                cachedClient = null;
                cachedDb = null;
                connectionPromise = null;
            });

            client.on('error', (error) => {
                log.error('MongoDB client error', { error: error.message, stack: error.stack });
                cachedClient = null;
                cachedDb = null;
                connectionPromise = null;
            });

            client.on('connectionCreated', (event) => {
                log.info('MongoDB connection created', { connectionId: event.connectionId });
            });

            client.on('connectionClosed', (event) => {
                log.info('MongoDB connection closed', { connectionId: event.connectionId, reason: event.reason });
            });

            return { client, db };

        } catch (error) {
            const errorDetails = {
                message: error.message,
                code: error.code,
                name: error.name,
                stack: error.stack
            };

            log.error('Failed to connect to MongoDB', errorDetails);

            // Provide helpful error messages
            if (error.message && error.message.includes('ENOTFOUND')) {
                const hostname = MONGODB_URI.split('@').split('/');
                log.error(`DNS resolution failed - check MongoDB URI hostname: ${hostname}`);
            } else if (error.message && error.message.includes('authentication')) {
                log.error('Authentication failed - check MongoDB credentials');
            } else if (error.message && error.message.includes('timeout')) {
                log.error('Connection timeout - check network/firewall or MongoDB Atlas IP whitelist');
            } else if (error.message && error.message.includes('SSL')) {
                log.error('SSL/TLS error - check certificate configuration');
            }

            // CRITICAL FIX: Close the client if it was created to prevent connection leaks
            if (client) {
                try {
                    await client.close(true);
                    log.info('Closed failed MongoDB client connection');
                } catch (closeError) {
                    log.warn('Error closing failed MongoDB client', { error: closeError.message });
                }
            }

            connectionPromise = null;
            throw error;
        }
    })();

    return connectionPromise;
}

async function getDb() {
    const { db } = await connectToDatabase();
    return db;
}

/**
 * Helper to get a specific collection from the database with retry logic
 * Supports both simple usage: getCollection('name') and with retries: getCollection('name', 2)
 * @param {string} collectionName 
 * @param {number} retries 
 * @returns {Promise<import('mongodb').Collection>}
 */
async function getCollection(collectionName, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { db } = await connectToDatabase();
            return db.collection(collectionName);
        } catch (error) {
            log.error('Failed to get collection', { collectionName, attempt, retries, error: error.message });

            if (attempt === retries) {
                throw new Error(`Failed to get collection ${collectionName} after ${retries} attempts: ${error.message}`);
            }

            // Reset connection on error
            await closeConnection();

            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
}

/**
 * Creates indexes for the collections in the database.
 * @param {import('mongodb').Db} db
 */
async function createIndexes(db) {
    try {
        log.info('Creating indexes...');
        const historyCollection = db.collection('history');
        await historyCollection.createIndex({ systemId: 1, timestamp: -1 });

        const hourlyWeatherCollection = db.collection('hourly-weather');
        await hourlyWeatherCollection.createIndex({ systemId: 1, date: 1 });

        const hourlySolarCollection = db.collection('hourly-solar-irradiance');
        await hourlySolarCollection.createIndex({ systemId: 1, date: 1 });

        log.info('Indexes created successfully.');
    } catch (error) {
        log.error('Error creating indexes', { error: error.message, stack: error.stack });
    }
}

/**
 * Gracefully close the MongoDB connection
 * Useful for cleanup in tests or graceful shutdown
 */
async function closeConnection() {
    if (cachedClient) {
        try {
            await cachedClient.close(true); // Force close
            log.info('MongoDB connection closed');
        } catch (error) {
            log.error('Error closing MongoDB connection', { error: error.message, stack: error.stack });
        } finally {
            cachedClient = null;
            cachedDb = null;
            connectionPromise = null;
            lastHealthCheck = null;
        }
    }
}

/**
 * ========================
 * ENCRYPTION UTILITIES
 * ========================
 * Field-level encryption for sensitive data at rest
 * Uses AES-256-GCM for authenticated encryption
 * Key derivation uses PBKDF2 for cryptographic security
 */

/**
 * Check if encryption is available
 * @returns {boolean} True if encryption key is configured
 */
function isEncryptionAvailable() {
    return !!ENCRYPTION_KEY && ENCRYPTION_KEY.length >= 32;
}

/**
 * Derive a proper 32-byte key from the environment variable using PBKDF2
 * Uses synchronous PBKDF2 with caching to avoid repeated expensive operations
 * 
 * PBKDF2 (Password-Based Key Derivation Function 2) is used because:
 * 1. It's specifically designed for deriving cryptographic keys from passwords/secrets
 * 2. It applies many iterations of a hash function to slow down brute-force attacks
 * 3. It's NIST-recommended and widely used in industry
 * 
 * @returns {Buffer} 32-byte key for AES-256
 */
function getEncryptionKey() {
    if (!ENCRYPTION_KEY) {
        throw new Error('DATA_ENCRYPTION_KEY environment variable is not set');
    }

    // Return cached key if available (PBKDF2 is expensive)
    if (cachedDerivedKey) {
        return cachedDerivedKey;
    }

    // Derive key using PBKDF2 with fixed salt for deterministic derivation
    // The salt is application-specific and provides domain separation
    cachedDerivedKey = crypto.pbkdf2Sync(
        ENCRYPTION_KEY,           // Password/secret from environment
        PBKDF2_SALT,              // Application-specific salt
        PBKDF2_ITERATIONS,        // 100,000 iterations for security
        PBKDF2_KEY_LENGTH,        // 32 bytes = 256 bits for AES-256
        PBKDF2_DIGEST             // SHA-256 hash function
    );

    log.info('Encryption key derived using PBKDF2', {
        iterations: PBKDF2_ITERATIONS,
        keyLength: PBKDF2_KEY_LENGTH,
        digest: PBKDF2_DIGEST
    });

    return cachedDerivedKey;
}

/**
 * Clear the cached encryption key (useful for testing or key rotation)
 */
function clearEncryptionKeyCache() {
    cachedDerivedKey = null;
}

/**
 * Encrypt sensitive data
 * @param {string|Object} data - Data to encrypt (will be JSON stringified if object)
 * @returns {Object} Encrypted data with iv and authTag for decryption
 */
function encryptData(data) {
    if (!isEncryptionAvailable()) {
        log.warn('Encryption not available - DATA_ENCRYPTION_KEY not configured');
        return { encrypted: false, data };
    }

    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

        const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const authTag = cipher.getAuthTag();

        return {
            encrypted: true,
            data: encrypted,
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            algorithm: ENCRYPTION_ALGORITHM
        };
    } catch (error) {
        log.error('Encryption failed', { error: error.message });
        throw new Error('Failed to encrypt data: ' + error.message);
    }
}

/**
 * Decrypt encrypted data
 * @param {Object} encryptedObj - Object with encrypted data, iv, and authTag
 * @returns {*} Decrypted data (parsed from JSON if applicable)
 */
function decryptData(encryptedObj) {
    if (!encryptedObj || !encryptedObj.encrypted) {
        return encryptedObj?.data || encryptedObj;
    }

    if (!isEncryptionAvailable()) {
        log.warn('Cannot decrypt - DATA_ENCRYPTION_KEY not configured');
        throw new Error('Decryption not available - encryption key not configured');
    }

    try {
        const key = getEncryptionKey();
        const iv = Buffer.from(encryptedObj.iv, 'base64');
        const authTag = Buffer.from(encryptedObj.authTag, 'base64');
        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedObj.data, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        // Try to parse as JSON, return as-is if not valid JSON
        try {
            return JSON.parse(decrypted);
        } catch {
            return decrypted;
        }
    } catch (error) {
        log.error('Decryption failed', { error: error.message });
        throw new Error('Failed to decrypt data: ' + error.message);
    }
}

/**
 * Encrypt specific fields in an object
 * @param {Object} obj - Object containing fields to encrypt
 * @param {string[]} fieldsToEncrypt - Array of field names to encrypt
 * @returns {Object} Object with specified fields encrypted
 */
function encryptFields(obj, fieldsToEncrypt) {
    if (!obj || typeof obj !== 'object') return obj;
    if (!isEncryptionAvailable()) return obj;

    const result = { ...obj };
    for (const field of fieldsToEncrypt) {
        if (result[field] !== undefined && result[field] !== null) {
            result[field] = encryptData(result[field]);
        }
    }
    return result;
}

/**
 * Decrypt specific fields in an object
 * @param {Object} obj - Object containing encrypted fields
 * @param {string[]} fieldsToDecrypt - Array of field names to decrypt
 * @returns {Object} Object with specified fields decrypted
 */
function decryptFields(obj, fieldsToDecrypt) {
    if (!obj || typeof obj !== 'object') return obj;

    const result = { ...obj };
    for (const field of fieldsToDecrypt) {
        if (result[field]?.encrypted) {
            try {
                result[field] = decryptData(result[field]);
            } catch (error) {
                log.warn('Failed to decrypt field', { field, error: error.message });
                // Leave field as-is if decryption fails
            }
        }
    }
    return result;
}

/**
 * Generate a secure hash for data (e.g., for deduplication without exposing raw data)
 * @param {string|Object} data - Data to hash
 * @returns {string} SHA-256 hash of the data
 */
function hashData(data) {
    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(plaintext).digest('hex');
}

module.exports = {
    connectToDatabase,
    getCollection,
    closeConnection,
    getDb,
    // Encryption utilities
    encryptData,
    decryptData,
    encryptFields,
    decryptFields,
    isEncryptionAvailable,
    hashData,
    clearEncryptionKeyCache // For testing and key rotation
};
