/**
 * Shared Database Client with Connection Pooling
 * Provides optimized MongoDB connections with proper error handling
 */

const { MongoClient } = require('mongodb');
const { createLogger } = require('./logger');

let cachedClient = null;
let cachedDb = null;

const DB_CONFIG = {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 20000,
  connectTimeoutMS: 10000,
  retryWrites: true,
  retryReads: true,
  w: 'majority'
};

/**
 * Get MongoDB client with connection pooling
 * @returns {Promise<MongoClient>} MongoDB client
 */
async function getClient() {
  if (cachedClient && cachedClient.topology && cachedClient.topology.isConnected()) {
    return cachedClient;
  }

  const logger = createLogger('dbClient');
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.critical('MONGODB_URI environment variable not set');
    throw new Error('Database configuration missing');
  }

  try {
    logger.info('Creating new MongoDB connection');
    const client = new MongoClient(uri, DB_CONFIG);
    await client.connect();
    
    cachedClient = client;
    logger.info('MongoDB connection established', { 
      poolSize: DB_CONFIG.maxPoolSize 
    });
    
    return client;
  } catch (error) {
    logger.error('Failed to connect to MongoDB', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Get database instance
 * @returns {Promise<Db>} MongoDB database
 */
async function getDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  const client = await getClient();
  const dbName = process.env.MONGODB_DB || 'bmsview';
  cachedDb = client.db(dbName);
  
  return cachedDb;
}

/**
 * Get collection with optimized settings
 * @param {string} collectionName - Name of the collection
 * @returns {Promise<Collection>} MongoDB collection
 */
async function getCollection(collectionName) {
  const db = await getDatabase();
  return db.collection(collectionName);
}

/**
 * Execute a database operation with timeout and retry logic
 * @param {Function} operation - Database operation to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {number} retries - Number of retries
 * @returns {Promise<any>} Operation result
 */
async function executeWithTimeout(operation, timeoutMs = 15000, retries = 2) {
  const logger = createLogger('dbClient');
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database operation timeout')), timeoutMs);
      });

      const result = await Promise.race([
        operation(),
        timeoutPromise
      ]);

      return result;
    } catch (error) {
      if (attempt === retries) {
        logger.error('Database operation failed after retries', {
          attempt: attempt + 1,
          error: error.message
        });
        throw error;
      }
      
      logger.warn('Database operation failed, retrying', {
        attempt: attempt + 1,
        error: error.message
      });
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

/**
 * Create indexes for optimized queries
 * @param {string} collectionName - Collection name
 * @param {Array} indexes - Array of index specifications
 */
async function ensureIndexes(collectionName, indexes) {
  const logger = createLogger('dbClient');
  const collection = await getCollection(collectionName);

  try {
    for (const indexSpec of indexes) {
      await collection.createIndex(indexSpec.key, indexSpec.options || {});
      logger.info('Index created', { 
        collection: collectionName, 
        index: indexSpec.key 
      });
    }
  } catch (error) {
    logger.warn('Failed to create index', { 
      collection: collectionName, 
      error: error.message 
    });
  }
}

/**
 * Close database connection
 */
async function closeConnection() {
  const logger = createLogger('dbClient');
  
  if (cachedClient) {
    try {
      await cachedClient.close();
      cachedClient = null;
      cachedDb = null;
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection', { 
        error: error.message 
      });
    }
  }
}

module.exports = {
  getClient,
  getDatabase,
  getCollection,
  executeWithTimeout,
  ensureIndexes,
  closeConnection
};