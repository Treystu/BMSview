// HOTFIX 3: Improved MongoDB Connection Pooling
// Replace: netlify/functions/utils/mongodb.js
// This fix implements proper connection pooling, health checks, and error handling

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME;

if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
}
if (!DB_NAME) {
    throw new Error('Please define the MONGODB_DB_NAME environment variable');
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
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

/**
 * Performs a health check on the database connection
 * @param {import('mongodb').Db} db 
 * @returns {Promise<boolean>}
 */
async function healthCheck(db) {
    try {
        await db.admin().ping();
        return true;
    } catch (error) {
        console.error('MongoDB health check failed:', error.message);
        return false;
    }
}

/**
 * Connects to MongoDB with proper connection pooling and error handling
 * @returns {Promise<{client: import('mongodb').MongoClient, db: import('mongodb').Db}>}
 */
async function connectToDatabase() {
    // Return cached connection if available and healthy
    if (cachedClient && cachedDb) {
        const now = Date.now();
        
        // Perform periodic health checks
        if (!lastHealthCheck || (now - lastHealthCheck) > HEALTH_CHECK_INTERVAL) {
            const isHealthy = await healthCheck(cachedDb);
            lastHealthCheck = now;
            
            if (isHealthy) {
                return { client: cachedClient, db: cachedDb };
            } else {
                // Connection is unhealthy, reset cache and reconnect
                console.warn('MongoDB connection unhealthy, reconnecting...');
                cachedClient = null;
                cachedDb = null;
                connectionPromise = null;
            }
        } else {
            return { client: cachedClient, db: cachedDb };
        }
    }

    // If connection is in progress, wait for it
    if (connectionPromise) {
        return connectionPromise;
    }

    // Create new connection with proper pooling configuration
    connectionPromise = (async () => {
        try {
            const client = new MongoClient(MONGODB_URI, {
                // Connection pool settings
                maxPoolSize: 10,
                minPoolSize: 2,
                maxIdleTimeMS: 60000, // Close idle connections after 60 seconds
                
                // Timeout settings
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                connectTimeoutMS: 10000,
                
                // Retry settings
                retryWrites: true,
                retryReads: true,
                
                // Monitoring
                monitorCommands: process.env.NODE_ENV === 'development',
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
            
            console.log('MongoDB connected successfully');
            
            // Set up connection monitoring
            client.on('connectionPoolCreated', () => {
                console.log('MongoDB connection pool created');
            });
            
            client.on('connectionPoolClosed', () => {
                console.log('MongoDB connection pool closed');
                cachedClient = null;
                cachedDb = null;
                connectionPromise = null;
            });
            
            client.on('error', (error) => {
                console.error('MongoDB client error:', error);
                cachedClient = null;
                cachedDb = null;
                connectionPromise = null;
            });

            return { client, db };
            
        } catch (error) {
            console.error('Failed to connect to MongoDB:', error);
            connectionPromise = null;
            throw error;
        }
    })();

    return connectionPromise;
}

/**
 * Helper to get a specific collection from the database with retry logic
 * @param {string} collectionName 
 * @param {number} retries 
 * @returns {Promise<import('mongodb').Collection>}
 */
const getCollection = async (collectionName, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { db } = await connectToDatabase();
            return db.collection(collectionName);
        } catch (error) {
            console.error(`Failed to get collection ${collectionName} (attempt ${attempt}/${retries}):`, error.message);
            
            if (attempt === retries) {
                throw new Error(`Failed to get collection ${collectionName} after ${retries} attempts: ${error.message}`);
            }
            
            // Reset connection on error
            cachedClient = null;
            cachedDb = null;
            connectionPromise = null;
            
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
};

/**
 * Gracefully close the MongoDB connection
 * Useful for cleanup in tests or graceful shutdown
 */
async function closeConnection() {
    if (cachedClient) {
        try {
            await cachedClient.close();
            console.log('MongoDB connection closed');
        } catch (error) {
            console.error('Error closing MongoDB connection:', error);
        } finally {
            cachedClient = null;
            cachedDb = null;
            connectionPromise = null;
            lastHealthCheck = null;
        }
    }
}

module.exports = { connectToDatabase, getCollection, closeConnection };