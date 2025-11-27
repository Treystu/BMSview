// @ts-nocheck
/**
 * Query Optimization Utilities for MongoDB
 * 
 * Provides optimized query patterns for:
 * - Efficient aggregation pipelines
 * - Time-based partitioning
 * - Query hints and index utilization
 * - Pagination for large result sets
 * 
 * @module netlify/functions/utils/query-optimizer
 */

const { createLogger } = require('./logger.cjs');
const { getCollection } = require('./mongodb.cjs');

const log = createLogger('utils/query-optimizer');

/**
 * Default query optimization settings
 */
const QUERY_CONFIG = {
  defaultLimit: 1000,       // Default query limit
  maxLimit: 10000,          // Maximum allowed limit
  defaultBatchSize: 500,    // Cursor batch size
  timeoutMs: 30000,         // Query timeout
  allowDiskUse: true        // Allow disk use for large aggregations
};

/**
 * Build an optimized aggregation pipeline for time-series data
 * 
 * @param {Object} options - Pipeline options
 * @param {string} options.systemId - System ID filter
 * @param {Date|string} options.startDate - Start of time range
 * @param {Date|string} options.endDate - End of time range
 * @param {string} [options.granularity='hourly'] - 'hourly' | 'daily' | 'weekly'
 * @param {Array<string>} [options.metrics] - Specific metrics to aggregate
 * @param {Object} [options.projection] - Fields to include
 * @returns {Array} MongoDB aggregation pipeline
 */
function buildTimeSeriesAggregation(options) {
  const {
    systemId,
    startDate,
    endDate,
    granularity = 'hourly',
    metrics = ['voltage', 'current', 'soc', 'power', 'temperature'],
    projection = {}
  } = options;
  
  const startISO = typeof startDate === 'string' ? startDate : startDate.toISOString();
  const endISO = typeof endDate === 'string' ? endDate : endDate.toISOString();
  
  // Build date grouping based on granularity
  let dateGroup;
  switch (granularity) {
    case 'hourly':
      dateGroup = {
        year: { $year: { $toDate: '$timestamp' } },
        month: { $month: { $toDate: '$timestamp' } },
        day: { $dayOfMonth: { $toDate: '$timestamp' } },
        hour: { $hour: { $toDate: '$timestamp' } }
      };
      break;
    case 'daily':
      dateGroup = {
        year: { $year: { $toDate: '$timestamp' } },
        month: { $month: { $toDate: '$timestamp' } },
        day: { $dayOfMonth: { $toDate: '$timestamp' } }
      };
      break;
    case 'weekly':
      dateGroup = {
        year: { $isoWeekYear: { $toDate: '$timestamp' } },
        week: { $isoWeek: { $toDate: '$timestamp' } }
      };
      break;
    default:
      dateGroup = {
        year: { $year: { $toDate: '$timestamp' } },
        month: { $month: { $toDate: '$timestamp' } },
        day: { $dayOfMonth: { $toDate: '$timestamp' } },
        hour: { $hour: { $toDate: '$timestamp' } }
      };
  }
  
  // Build metric aggregations
  const metricAggregations = {};
  const metricFieldMap = {
    voltage: 'analysis.overallVoltage',
    current: 'analysis.current',
    soc: 'analysis.stateOfCharge',
    power: 'analysis.power',
    temperature: 'analysis.temperature',
    capacity: 'analysis.remainingCapacity',
    cellVoltageDiff: 'analysis.cellVoltageDifference'
  };
  
  for (const metric of metrics) {
    const field = metricFieldMap[metric];
    if (field) {
      metricAggregations[`avg${metric.charAt(0).toUpperCase() + metric.slice(1)}`] = { $avg: `$${field}` };
      metricAggregations[`min${metric.charAt(0).toUpperCase() + metric.slice(1)}`] = { $min: `$${field}` };
      metricAggregations[`max${metric.charAt(0).toUpperCase() + metric.slice(1)}`] = { $max: `$${field}` };
    }
  }
  
  const pipeline = [
    // Stage 1: Match - use index on systemId and timestamp
    {
      $match: {
        systemId,
        timestamp: { $gte: startISO, $lte: endISO }
      }
    },
    // Stage 2: Project only needed fields (reduces memory)
    {
      $project: {
        _id: 0,
        timestamp: 1,
        'analysis.overallVoltage': 1,
        'analysis.current': 1,
        'analysis.stateOfCharge': 1,
        'analysis.power': 1,
        'analysis.temperature': 1,
        'analysis.remainingCapacity': 1,
        'analysis.cellVoltageDifference': 1,
        ...projection
      }
    },
    // Stage 3: Group by time bucket
    {
      $group: {
        _id: dateGroup,
        count: { $sum: 1 },
        firstTimestamp: { $min: '$timestamp' },
        lastTimestamp: { $max: '$timestamp' },
        ...metricAggregations
      }
    },
    // Stage 4: Sort by time
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 }
    }
  ];
  
  log.debug('Built time-series aggregation', { 
    systemId, 
    granularity, 
    stages: pipeline.length 
  });
  
  return pipeline;
}

/**
 * Execute an optimized query with pagination
 * 
 * @param {string} collectionName - Collection to query
 * @param {Object} query - MongoDB query filter
 * @param {Object} options - Query options
 * @param {number} [options.page=1] - Page number (1-based)
 * @param {number} [options.limit=100] - Results per page
 * @param {Object} [options.sort] - Sort specification
 * @param {Object} [options.projection] - Field projection
 * @returns {Promise<Object>} Paginated results
 */
async function executePaginatedQuery(collectionName, query, options = {}) {
  const {
    page = 1,
    limit = 100,
    sort = { timestamp: -1 },
    projection = { _id: 0 }
  } = options;
  
  const effectiveLimit = Math.min(limit, QUERY_CONFIG.maxLimit);
  const skip = (page - 1) * effectiveLimit;
  
  const startTime = Date.now();
  
  try {
    const collection = await getCollection(collectionName);
    
    // Execute count and query in parallel
    const [totalCount, results] = await Promise.all([
      collection.countDocuments(query),
      collection
        .find(query, { projection })
        .sort(sort)
        .skip(skip)
        .limit(effectiveLimit)
        .batchSize(QUERY_CONFIG.defaultBatchSize)
        .toArray()
    ]);
    
    const totalPages = Math.ceil(totalCount / effectiveLimit);
    const durationMs = Date.now() - startTime;
    
    log.info('Paginated query executed', {
      collection: collectionName,
      page,
      limit: effectiveLimit,
      totalCount,
      resultCount: results.length,
      durationMs
    });
    
    return {
      success: true,
      data: results,
      pagination: {
        page,
        limit: effectiveLimit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      },
      meta: {
        durationMs
      }
    };
  } catch (error) {
    log.error('Paginated query failed', { 
      collection: collectionName, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Execute an aggregation with optimized settings
 * 
 * @param {string} collectionName - Collection to aggregate
 * @param {Array} pipeline - Aggregation pipeline
 * @param {Object} options - Aggregation options
 * @returns {Promise<Object>} Aggregation results
 */
async function executeOptimizedAggregation(collectionName, pipeline, options = {}) {
  const {
    allowDiskUse = QUERY_CONFIG.allowDiskUse,
    maxTimeMS = QUERY_CONFIG.timeoutMs,
    batchSize = QUERY_CONFIG.defaultBatchSize
  } = options;
  
  const startTime = Date.now();
  
  try {
    const collection = await getCollection(collectionName);
    
    const cursor = collection.aggregate(pipeline, {
      allowDiskUse,
      maxTimeMS,
      batchSize
    });
    
    const results = await cursor.toArray();
    const durationMs = Date.now() - startTime;
    
    log.info('Optimized aggregation executed', {
      collection: collectionName,
      stages: pipeline.length,
      resultCount: results.length,
      durationMs
    });
    
    return {
      success: true,
      data: results,
      meta: {
        durationMs,
        stages: pipeline.length
      }
    };
  } catch (error) {
    log.error('Aggregation failed', { 
      collection: collectionName, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Build a cursor-based pagination query for efficient large dataset navigation
 * Uses a cursor (last seen ID or timestamp) instead of skip/limit
 * 
 * @param {Object} options - Query options
 * @param {string} options.collectionName - Collection name
 * @param {Object} options.baseQuery - Base query filter
 * @param {string} [options.cursorField='timestamp'] - Field to use for cursor
 * @param {string} [options.cursor] - Last seen cursor value
 * @param {number} [options.limit=100] - Results per page
 * @param {string} [options.direction='forward'] - 'forward' or 'backward'
 * @returns {Promise<Object>} Results with cursor for next page
 */
async function executeCursorPaginatedQuery(options) {
  const {
    collectionName,
    baseQuery = {},
    cursorField = 'timestamp',
    cursor = null,
    limit = 100,
    direction = 'forward',
    projection = { _id: 0 }
  } = options;
  
  const startTime = Date.now();
  const effectiveLimit = Math.min(limit, QUERY_CONFIG.maxLimit);
  
  // Build cursor-based query
  const query = { ...baseQuery };
  
  if (cursor) {
    if (direction === 'forward') {
      query[cursorField] = { $lt: cursor };
    } else {
      query[cursorField] = { $gt: cursor };
    }
  }
  
  // Sort direction based on pagination direction
  const sortOrder = direction === 'forward' ? -1 : 1;
  
  try {
    const collection = await getCollection(collectionName);
    
    const results = await collection
      .find(query, { projection })
      .sort({ [cursorField]: sortOrder })
      .limit(effectiveLimit + 1) // Fetch one extra to check for more
      .toArray();
    
    const hasMore = results.length > effectiveLimit;
    const data = hasMore ? results.slice(0, effectiveLimit) : results;
    
    // Get cursor for next page
    const nextCursor = data.length > 0 ? data[data.length - 1][cursorField] : null;
    
    const durationMs = Date.now() - startTime;
    
    log.info('Cursor paginated query executed', {
      collection: collectionName,
      resultCount: data.length,
      hasMore,
      durationMs
    });
    
    return {
      success: true,
      data,
      pagination: {
        cursor: nextCursor,
        hasMore,
        limit: effectiveLimit
      },
      meta: {
        durationMs
      }
    };
  } catch (error) {
    log.error('Cursor paginated query failed', { 
      collection: collectionName, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Create optimized date range partitions for parallel querying
 * 
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @param {number} [partitionCount=4] - Number of partitions
 * @returns {Array<{start: Date, end: Date}>} Array of date ranges
 */
function createDatePartitions(startDate, endDate, partitionCount = 4) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalMs = end.getTime() - start.getTime();
  const partitionMs = totalMs / partitionCount;
  
  const partitions = [];
  
  for (let i = 0; i < partitionCount; i++) {
    const partitionStart = new Date(start.getTime() + (i * partitionMs));
    const partitionEnd = i === partitionCount - 1 
      ? end 
      : new Date(start.getTime() + ((i + 1) * partitionMs));
    
    partitions.push({
      start: partitionStart,
      end: partitionEnd,
      index: i
    });
  }
  
  log.debug('Created date partitions', { 
    partitionCount, 
    totalDays: Math.round(totalMs / (24 * 60 * 60 * 1000))
  });
  
  return partitions;
}

/**
 * Execute queries in parallel across date partitions
 * 
 * @param {string} collectionName - Collection name
 * @param {Object} baseQuery - Base query (without date range)
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Combined results
 */
async function executePartitionedQuery(collectionName, baseQuery, startDate, endDate, options = {}) {
  const {
    partitionCount = 4,
    dateField = 'timestamp',
    projection = { _id: 0 },
    sort = { timestamp: 1 }
  } = options;
  
  const startTime = Date.now();
  const partitions = createDatePartitions(startDate, endDate, partitionCount);
  
  log.info('Executing partitioned query', {
    collection: collectionName,
    partitionCount,
    startDate,
    endDate
  });
  
  // Execute queries in parallel
  const partitionPromises = partitions.map(async (partition) => {
    const collection = await getCollection(collectionName);
    
    const query = {
      ...baseQuery,
      [dateField]: {
        $gte: partition.start.toISOString(),
        $lte: partition.end.toISOString()
      }
    };
    
    return collection
      .find(query, { projection })
      .sort(sort)
      .toArray();
  });
  
  const partitionResults = await Promise.all(partitionPromises);
  
  // Combine results
  const allResults = partitionResults.flat();
  
  // Sort combined results
  allResults.sort((a, b) => {
    const aVal = new Date(a[dateField]).getTime();
    const bVal = new Date(b[dateField]).getTime();
    return sort[dateField] === 1 ? aVal - bVal : bVal - aVal;
  });
  
  const durationMs = Date.now() - startTime;
  
  log.info('Partitioned query complete', {
    collection: collectionName,
    totalResults: allResults.length,
    durationMs
  });
  
  return {
    success: true,
    data: allResults,
    meta: {
      durationMs,
      partitionCount,
      resultsPerPartition: partitionResults.map(r => r.length)
    }
  };
}

/**
 * Get query explain stats (for debugging/optimization)
 * 
 * @param {string} collectionName - Collection name
 * @param {Object} query - Query to explain
 * @returns {Promise<Object>} Query execution stats
 */
async function getQueryExplain(collectionName, query) {
  try {
    const collection = await getCollection(collectionName);
    const explain = await collection.find(query).explain('executionStats');
    
    return {
      success: true,
      stats: {
        executionTimeMs: explain.executionStats?.executionTimeMillisEstimate,
        totalDocsExamined: explain.executionStats?.totalDocsExamined,
        totalKeysExamined: explain.executionStats?.totalKeysExamined,
        indexUsed: explain.queryPlanner?.winningPlan?.inputStage?.indexName || 'COLLSCAN',
        isIndexed: !explain.queryPlanner?.winningPlan?.inputStage?.stage?.includes('COLLSCAN')
      }
    };
  } catch (error) {
    log.error('Query explain failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

module.exports = {
  QUERY_CONFIG,
  buildTimeSeriesAggregation,
  executePaginatedQuery,
  executeOptimizedAggregation,
  executeCursorPaginatedQuery,
  createDatePartitions,
  executePartitionedQuery,
  getQueryExplain
};
