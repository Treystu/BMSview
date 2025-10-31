"use strict";

const { MongoClient } = require("mongodb");
const { createLogger } = require("./logger");

// Module-scoped logger for utils/mongodb (no request context available here)
const log = createLogger("utils/mongodb");

/**
 * OPTIMIZED MongoDB Connection Manager
 * Consolidates connection pooling with aggressive resource management
 * Fixes connection overload issues by reducing pool size and improving reuse
 */

const MONGODB_URI = process.env.MONGODB_URI;
// Support both MONGODB_DB_NAME and MONGODB_DB for backward compatibility
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "bmsview";

if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
}

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

/**
 * Connects to MongoDB with optimized connection pooling
 * CRITICAL: Reduced pool size from 10 to 5 to prevent connection overload
 * @returns {Promise<{client: import('mongodb').MongoClient, db: import('mongodb').Db}>}
 */
async function connectToDatabase() {
    // Return cached connection if available and healthy
    if (cachedClient && cachedDb) {
        const now = Date.now();
        
        // Perform periodic health checks (less frequent to reduce overhead)
        if (!lastHealthCheck || (now - lastHealthCheck) > HEALTH_CHECK_INTERVAL) {
            const isHealthy = isClientHealthy(cachedClient);
            lastHealthCheck = now;
            
            if (isHealthy) {
                return { client: cachedClient, db: cachedDb };
            } else {
                // Connection is unhealthy, reset cache and reconnect
                log.warn('MongoDB connection unhealthy, reconnecting...');
                await closeConnection();
            }
        } else {
            return { client: cachedClient, db: cachedDb };
        }
    }

    // If connection is in progress, wait for it
    if (connectionPromise) {
        return connectionPromise;
    }

    // Create new connection with OPTIMIZED pooling configuration
    connectionPromise = (async () => {
        try {
            const client = new MongoClient(MONGODB_URI, {
                // TLS settings
                tlsAllowInvalidCertificates: false,
                tlsAllowInvalidHostnames: false,
                tls: true,

                // OPTIMIZED: Reduced pool size to prevent connection overload
                maxPoolSize: 5,        // Reduced from 10 to 5
                minPoolSize: 1,        // Reduced from 2 to 1
                maxIdleTimeMS: 30000,  // Reduced from 60s to 30s - close idle connections faster
                
                // Timeout settings - more aggressive
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 30000,  // Reduced from 45s to 30s
                connectTimeoutMS: 10000,
                
                // Retry settings
                retryWrites: true,
                retryReads: true,
                
                // Write concern for better performance
                w: 'majority',
                wtimeoutMS: 5000,
                
                // Disable monitoring in production to reduce overhead
                monitorCommands: false,
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

            return { client, db };
            
        } catch (error) {
            log.error('Failed to connect to MongoDB', { error: error.message, stack: error.stack });
            connectionPromise = null;
            throw error;
        }
    })();

    return connectionPromise;
}

/**
 * Get database instance (backward compatibility function)
 * @returns {Promise<import('mongodb').Db>}
 */
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

module.exports = { connectToDatabase, getCollection, closeConnection, getDb };
