// @ts-nocheck
/**
 * Enhanced Database Optimization and Indexing Strategy
 *
 * Provides comprehensive database optimization including:
 * - Index management and optimization
 * - Query performance monitoring
 * - Connection pooling
 * - Caching strategies
 * - Bulk operations
 *
 * @module netlify/functions/utils/database-optimizer
 */

const { MongoClient } = require('mongodb');
const { createLogger } = require('./logger.cjs');

const log = createLogger('utils/database-optimizer');

/**
 * Database optimization configuration
 */
const DB_CONFIG = {
  // Connection pool settings
  maxPoolSize: 50,
  minPoolSize: 5,
  maxIdleTimeMS: 30000,
  waitQueueTimeoutMS: 5000,

  // Performance settings
  readPreference: 'secondary',
  readConcern: { level: 'majority' },
  writeConcern: { w: 'majority', j: true, wtimeout: 10000 },

  // Monitoring
  monitorCommands: true,
  serverSelectionTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,

  // Compression
  compressors: ['zstd', 'zlib', 'snappy'],
  zlibCompressionLevel: 6,
};

/**
 * Index definitions for optimal performance
 */
const INDEX_DEFINITIONS = {
  analysisRecords: [
    // Primary indexes for common queries
    {
      name: 'systemId_timestamp_idx',
      keys: { systemId: 1, timestamp: -1 },
      options: { background: true }
    },
    {
      name: 'timestamp_sparse_idx',
      keys: { timestamp: -1 },
      options: { sparse: true, background: true }
    },
    {
      name: 'hardwareSystemId_idx',
      keys: { hardwareSystemId: 1 },
      options: { sparse: true, background: true }
    },

    // Compound indexes for complex queries
    {
      name: 'systemId_updatedAt_idx',
      keys: { systemId: 1, updatedAt: -1 },
      options: { background: true }
    },
    {
      name: 'analysis_stateOfCharge_idx',
      keys: { 'analysis.stateOfCharge': -1, timestamp: -1 },
      options: { sparse: true, background: true }
    },

    // Text search index for alerts and summaries
    {
      name: 'text_search_idx',
      keys: {
        'analysis.summary': 'text',
        'analysis.alerts': 'text'
      },
      options: { background: true }
    },

    // Geospatial index for location-based queries
    {
      name: 'geo_location_idx',
      keys: { 'weather.location': '2dsphere' },
      options: { sparse: true, background: true }
    },

    // Performance critical indexes
    {
      name: 'analysis_metrics_compound_idx',
      keys: {
        systemId: 1,
        'analysis.overallVoltage': -1,
        'analysis.current': -1,
        'analysis.temperature': -1,
        timestamp: -1
      },
      options: { background: true }
    }
  ],

  bmsSystems: [
    {
      name: 'primary_id_idx',
      keys: { id: 1 },
      options: { unique: true, background: true }
    },
    {
      name: 'hardwareIds_idx',
      keys: { associatedHardwareIds: 1 },
      options: { background: true }
    },
    {
      name: 'location_geo_idx',
      keys: {
        location: '2dsphere'
      },
      options: {
        sparse: true,
        background: true,
        '2dsphereIndexVersion': 3
      }
    },
    {
      name: 'chemistry_voltage_idx',
      keys: { chemistry: 1, voltage: -1 },
      options: { background: true }
    }
  ],

  weatherData: [
    {
      name: 'location_timestamp_idx',
      keys: { location: '2dsphere', timestamp: -1 },
      options: { background: true }
    },
    {
      name: 'systemId_timestamp_idx',
      keys: { systemId: 1, timestamp: -1 },
      options: { background: true }
    },
    {
      name: 'expiry_ttl_idx',
      keys: { timestamp: 1 },
      options: {
        expireAfterSeconds: 2592000, // 30 days TTL
        background: true
      }
    }
  ],

  aiInsights: [
    {
      name: 'recordId_mode_idx',
      keys: { recordId: 1, mode: 1 },
      options: { unique: true, background: true }
    },
    {
      name: 'status_timestamp_idx',
      keys: { status: 1, timestamp: -1 },
      options: { background: true }
    },
    {
      name: 'expiry_ttl_idx',
      keys: { expiresAt: 1 },
      options: {
        expireAfterSeconds: 0, // Use document expiry field
        background: true
      }
    }
  ],

  aiFeedback: [
    {
      name: 'systemId_timestamp_idx',
      keys: { systemId: 1, timestamp: -1 },
      options: { background: true }
    },
    {
      name: 'status_priority_idx',
      keys: { status: 1, priority: -1 },
      options: { background: true }
    },
    {
      name: 'category_feedbackType_idx',
      keys: { category: 1, feedbackType: 1 },
      options: { background: true }
    }
  ]
};

/**
 * Database Performance Monitor
 */
class DatabasePerformanceMonitor {
  constructor() {
    this.metrics = {
      queryCount: 0,
      slowQueries: [],
      indexUsage: new Map(),
      connectionStats: {},
      errorCount: 0,
      lastReset: Date.now()
    };

    this.slowQueryThreshold = 1000; // 1 second
  }

  /**
   * Record a query execution
   */
  recordQuery(operation, duration, wasIndexed = true, indexUsed = null) {
    this.metrics.queryCount++;

    if (duration > this.slowQueryThreshold) {
      this.metrics.slowQueries.push({
        operation,
        duration,
        wasIndexed,
        indexUsed,
        timestamp: new Date().toISOString()
      });

      // Keep only last 100 slow queries
      if (this.metrics.slowQueries.length > 100) {
        this.metrics.slowQueries = this.metrics.slowQueries.slice(-100);
      }

      log.warn('Slow query detected', {
        operation,
        duration,
        wasIndexed,
        indexUsed
      });
    }

    // Track index usage
    if (indexUsed) {
      const current = this.metrics.indexUsage.get(indexUsed) || 0;
      this.metrics.indexUsage.set(indexUsed, current + 1);
    }
  }

  /**
   * Record an error
   */
  recordError(error, operation) {
    this.metrics.errorCount++;
    log.error('Database operation error', {
      operation,
      error: error.message,
      stack: error.stack
    });
  }

  /**
   * Update connection statistics
   */
  updateConnectionStats(stats) {
    this.metrics.connectionStats = {
      ...stats,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Get performance summary
   */
  getSummary() {
    const runtime = Date.now() - this.metrics.lastReset;
    const qps = this.metrics.queryCount / (runtime / 1000);

    return {
      runtime,
      queryCount: this.metrics.queryCount,
      queriesPerSecond: qps,
      slowQueryCount: this.metrics.slowQueries.length,
      errorCount: this.metrics.errorCount,
      errorRate: this.metrics.errorCount / this.metrics.queryCount,
      indexUsage: Object.fromEntries(this.metrics.indexUsage),
      connectionStats: this.metrics.connectionStats
    };
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      queryCount: 0,
      slowQueries: [],
      indexUsage: new Map(),
      connectionStats: {},
      errorCount: 0,
      lastReset: Date.now()
    };
  }
}

const performanceMonitor = new DatabasePerformanceMonitor();

/**
 * Enhanced MongoDB connection with optimization
 */
class OptimizedDatabase {
  constructor() {
    this.client = null;
    this.db = null;
    this.connectionString = process.env.MONGODB_URI;
    this.dbName = process.env.MONGODB_DB_NAME || 'bmsview';
    this.connected = false;
  }

  /**
   * Connect with optimized settings
   */
  async connect() {
    if (this.connected && this.client) {
      return this.db;
    }

    try {
      this.client = new MongoClient(this.connectionString, {
        ...DB_CONFIG,
        // Additional optimization
        bufferMaxEntries: 0,
        useUnifiedTopology: true,
        useNewUrlParser: true,
      });

      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.connected = true;

      // Set up monitoring
      this.setupMonitoring();

      log.info('Database connected with optimization', {
        dbName: this.dbName,
        poolSize: DB_CONFIG.maxPoolSize
      });

      return this.db;
    } catch (error) {
      log.error('Database connection failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Setup performance monitoring
   */
  setupMonitoring() {
    if (!this.client) return;

    // Monitor connection pool events
    this.client.on('connectionPoolCreated', (event) => {
      log.debug('Connection pool created', event);
    });

    this.client.on('connectionPoolClosed', (event) => {
      log.debug('Connection pool closed', event);
    });

    this.client.on('connectionCheckedOut', (event) => {
      performanceMonitor.updateConnectionStats({
        checkedOut: true,
        connectionId: event.connectionId
      });
    });

    this.client.on('connectionCheckOutFailed', (event) => {
      log.warn('Connection checkout failed', event);
      performanceMonitor.recordError(new Error('Connection checkout failed'), 'connectionCheckout');
    });

    // Monitor command events
    this.client.on('commandStarted', (event) => {
      event.startTime = Date.now();
    });

    this.client.on('commandSucceeded', (event) => {
      const duration = Date.now() - (event.startTime || Date.now());
      performanceMonitor.recordQuery(event.commandName, duration);
    });

    this.client.on('commandFailed', (event) => {
      const error = new Error(`Command failed: ${event.failure?.errmsg || 'Unknown error'}`);
      performanceMonitor.recordError(error, event.commandName);
    });
  }

  /**
   * Get collection with caching
   */
  async getCollection(collectionName) {
    if (!this.connected || !this.db) {
      await this.connect();
    }

    return this.db.collection(collectionName);
  }

  /**
   * Execute with performance monitoring
   */
  async executeWithMonitoring(operation, ...args) {
    const startTime = Date.now();

    try {
      const result = await operation(...args);
      const duration = Date.now() - startTime;

      performanceMonitor.recordQuery(operation.name || 'unknown', duration);

      return result;
    } catch (error) {
      performanceMonitor.recordError(error, operation.name || 'unknown');
      throw error;
    }
  }

  /**
   * Close connection
   */
  async close() {
    if (this.client) {
      await this.client.close();
      this.connected = false;
      log.info('Database connection closed');
    }
  }
}

const optimizedDB = new OptimizedDatabase();

/**
 * Index Management Functions
 */

/**
 * Create all required indexes
 */
async function createOptimalIndexes(collectionName = null) {
  const db = await optimizedDB.connect();
  const collections = collectionName ? [collectionName] : Object.keys(INDEX_DEFINITIONS);

  const results = {};

  for (const collection of collections) {
    const indexes = INDEX_DEFINITIONS[collection];
    if (!indexes) continue;

    try {
      const coll = db.collection(collection);
      const createdIndexes = [];

      for (const indexDef of indexes) {
        try {
          const result = await coll.createIndex(indexDef.keys, {
            name: indexDef.name,
            ...indexDef.options
          });

          createdIndexes.push({ name: indexDef.name, result });
          log.info('Index created', { collection, index: indexDef.name });
        } catch (error) {
          if (error.code === 85) { // Index already exists
            log.debug('Index already exists', { collection, index: indexDef.name });
          } else {
            log.error('Index creation failed', {
              collection,
              index: indexDef.name,
              error: error.message
            });
          }
        }
      }

      results[collection] = createdIndexes;
    } catch (error) {
      log.error('Collection index creation failed', { collection, error: error.message });
    }
  }

  return results;
}

/**
 * Analyze index usage and performance
 */
async function analyzeIndexUsage(collectionName) {
  const db = await optimizedDB.connect();
  const collection = db.collection(collectionName);

  try {
    // Get index stats
    const indexStats = await collection.aggregate([
      { $indexStats: {} }
    ]).toArray();

    // Get index usage recommendations
    const recommendations = [];

    for (const stat of indexStats) {
      const usage = stat.accesses?.ops || 0;

      if (usage === 0 && stat.name !== '_id_') {
        recommendations.push({
          type: 'UNUSED_INDEX',
          index: stat.name,
          recommendation: 'Consider dropping this unused index',
          impact: 'Reduce write overhead and storage'
        });
      } else if (usage < 10) {
        recommendations.push({
          type: 'LOW_USAGE_INDEX',
          index: stat.name,
          usage,
          recommendation: 'Monitor usage and consider dropping if consistently low',
          impact: 'Potential write performance improvement'
        });
      }
    }

    return {
      collection: collectionName,
      indexCount: indexStats.length,
      stats: indexStats,
      recommendations
    };
  } catch (error) {
    log.error('Index analysis failed', { collection: collectionName, error: error.message });
    throw error;
  }
}

/**
 * Optimize collection for better performance
 */
async function optimizeCollection(collectionName, options = {}) {
  const db = await optimizedDB.connect();
  const collection = db.collection(collectionName);

  const {
    reindex = false,
    compact = false,
    analyze = true
  } = options;

  const results = {
    collection: collectionName,
    operations: [],
    recommendations: []
  };

  try {
    // Analyze current state
    if (analyze) {
      const stats = await collection.stats();
      const indexAnalysis = await analyzeIndexUsage(collectionName);

      results.stats = stats;
      results.indexAnalysis = indexAnalysis;

      // Storage recommendations
      if (stats.storageSize > stats.size * 2) {
        results.recommendations.push({
          type: 'HIGH_STORAGE_OVERHEAD',
          recommendation: 'Consider running compact operation',
          storageSize: stats.storageSize,
          dataSize: stats.size
        });
      }
    }

    // Reindex if requested
    if (reindex) {
      await collection.reIndex();
      results.operations.push('REINDEX');
      log.info('Collection reindexed', { collection: collectionName });
    }

    // Compact if requested (MongoDB 4.4+)
    if (compact) {
      try {
        await db.runCommand({ compact: collectionName });
        results.operations.push('COMPACT');
        log.info('Collection compacted', { collection: collectionName });
      } catch (error) {
        log.warn('Compact operation failed', {
          collection: collectionName,
          error: error.message
        });
      }
    }

    return results;
  } catch (error) {
    log.error('Collection optimization failed', {
      collection: collectionName,
      error: error.message
    });
    throw error;
  }
}

/**
 * Bulk operations for better performance
 */
async function executeBulkOperation(collectionName, operations, options = {}) {
  const collection = await optimizedDB.getCollection(collectionName);
  const { ordered = false, bypassDocumentValidation = false } = options;

  try {
    const startTime = Date.now();

    let result;
    if (operations.length === 0) {
      return { acknowledged: true, insertedCount: 0, modifiedCount: 0 };
    }

    if (operations.every(op => op.insertOne)) {
      // Bulk insert
      const docs = operations.map(op => op.insertOne.document);
      result = await collection.insertMany(docs, {
        ordered,
        bypassDocumentValidation
      });
    } else {
      // Mixed bulk operations
      const bulk = collection.initializeOrderedBulkOp();

      for (const operation of operations) {
        if (operation.insertOne) {
          bulk.insert(operation.insertOne.document);
        } else if (operation.updateOne) {
          bulk.find(operation.updateOne.filter).updateOne(operation.updateOne.update);
        } else if (operation.deleteOne) {
          bulk.find(operation.deleteOne.filter).deleteOne();
        }
      }

      result = await bulk.execute();
    }

    const duration = Date.now() - startTime;

    log.info('Bulk operation completed', {
      collection: collectionName,
      operationCount: operations.length,
      duration,
      result: {
        acknowledged: result.acknowledged,
        insertedCount: result.insertedCount || 0,
        modifiedCount: result.modifiedCount || 0,
        deletedCount: result.deletedCount || 0
      }
    });

    return result;
  } catch (error) {
    log.error('Bulk operation failed', {
      collection: collectionName,
      operationCount: operations.length,
      error: error.message
    });
    throw error;
  }
}

/**
 * Cache warming for frequently accessed data
 */
async function warmCache(collectionName, warmupQueries = []) {
  const collection = await optimizedDB.getCollection(collectionName);

  try {
    const defaultQueries = [
      // Recent data
      { timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() } },
      // Most common systems
      { $sample: { size: 100 } }
    ];

    const queries = warmupQueries.length > 0 ? warmupQueries : defaultQueries;
    const startTime = Date.now();

    const results = await Promise.all(
      queries.map(query =>
        collection.find(query).limit(100).toArray()
      )
    );

    const totalDocs = results.reduce((sum, docs) => sum + docs.length, 0);
    const duration = Date.now() - startTime;

    log.info('Cache warmed', {
      collection: collectionName,
      queryCount: queries.length,
      totalDocs,
      duration
    });

    return { success: true, queryCount: queries.length, totalDocs, duration };
  } catch (error) {
    log.error('Cache warming failed', {
      collection: collectionName,
      error: error.message
    });
    throw error;
  }
}

/**
 * Database health check
 */
async function performHealthCheck() {
  try {
    const db = await optimizedDB.connect();
    const startTime = Date.now();

    // Basic connectivity test
    await db.admin().ping();

    // Get database stats
    const dbStats = await db.stats();

    // Check index health for critical collections
    const criticalCollections = ['analysisRecords', 'bmsSystems'];
    const collectionHealth = {};

    for (const collectionName of criticalCollections) {
      try {
        const collection = db.collection(collectionName);
        const stats = await collection.stats();
        const indexes = await collection.indexes();

        collectionHealth[collectionName] = {
          documentCount: stats.count,
          indexCount: indexes.length,
          avgObjectSize: stats.avgObjSize,
          storageSize: stats.storageSize,
          indexSize: stats.totalIndexSize
        };
      } catch (error) {
        collectionHealth[collectionName] = { error: error.message };
      }
    }

    // Performance metrics
    const performanceSummary = performanceMonitor.getSummary();

    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      database: {
        name: dbStats.db,
        collections: dbStats.collections,
        dataSize: dbStats.dataSize,
        indexSize: dbStats.indexSize,
        storageSize: dbStats.storageSize
      },
      collections: collectionHealth,
      performance: performanceSummary,
      recommendations: []
    };

    // Add recommendations based on health metrics
    if (performanceSummary.errorRate > 0.1) {
      healthCheck.recommendations.push({
        type: 'HIGH_ERROR_RATE',
        message: `Error rate ${(performanceSummary.errorRate * 100).toFixed(1)}% is above threshold`,
        action: 'Investigate database errors and connection issues'
      });
    }

    if (performanceSummary.slowQueryCount > 10) {
      healthCheck.recommendations.push({
        type: 'SLOW_QUERIES',
        message: `${performanceSummary.slowQueryCount} slow queries detected`,
        action: 'Review query patterns and index usage'
      });
    }

    return healthCheck;
  } catch (error) {
    log.error('Health check failed', { error: error.message });
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
}

module.exports = {
  optimizedDB,
  performanceMonitor,
  DB_CONFIG,
  INDEX_DEFINITIONS,
  createOptimalIndexes,
  analyzeIndexUsage,
  optimizeCollection,
  executeBulkOperation,
  warmCache,
  performHealthCheck,
  DatabasePerformanceMonitor,
  OptimizedDatabase
};