/**
 * Optimized Get Job Status Function
 * Includes connection pooling, projection, and caching
 */

const { getCollection, executeWithTimeout } = require("./utils/dbClient.js");
const { createLogger } = require("./utils/logger.js");
const { getConfig } = require("./utils/config.js");

// Simple in-memory cache with TTL
class StatusCache {
    constructor(ttlMs = 1000) {
        this.cache = new Map();
        this.ttl = ttlMs;
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return entry.value;
    }

    set(key, value) {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    clear() {
        this.cache.clear();
    }
}

const statusCache = new StatusCache(1000); // 1 second TTL

exports.handler = async (event, context) => {
    const logger = createLogger('get-job-status', context);
    const config = getConfig();
    
    logger.entry({
        method: event.httpMethod,
        hasBody: !!event.body
    });

    try {
        // Parse request
        const body = JSON.parse(event.body || '{}');
        const jobIds = body.jobIds || [];

        if (!Array.isArray(jobIds) || jobIds.length === 0) {
            logger.warn('Invalid or empty jobIds array');
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Invalid jobIds array' })
            };
        }

        logger.info('Fetching job statuses', { 
            count: jobIds.length,
            jobIds 
        });

        // Check cache first
        const cacheKey = jobIds.sort().join(',');
        const cached = statusCache.get(cacheKey);
        
        if (cached) {
            logger.info('Returning cached statuses', { count: cached.length });
            logger.exit(200, { cached: true, count: cached.length });
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'HIT'
                },
                body: JSON.stringify({ statuses: cached })
            };
        }

        // Fetch from database with optimized query
        const jobsCollection = await getCollection("jobs");
        
        logger.dbOperation('find', 'jobs', { 
            filter: { id: { $in: jobIds } },
            projection: 'optimized'
        });

        const queryStartTime = Date.now();
        
        const jobs = await executeWithTimeout(
            () => jobsCollection
                .find(
                    { id: { $in: jobIds } },
                    {
                        projection: {
                            _id: 0,
                            id: 1,
                            status: 1,
                            recordId: 1,
                            retryCount: 1,
                            nextRetryAt: 1,
                            lastFailureReason: 1,
                            fileName: 1,
                            statusEnteredAt: 1,
                            lastHeartbeat: 1,
                            completedAt: 1,
                            failedAt: 1
                        }
                    }
                )
                .toArray(),
            config.mongodb.timeout
        );

        const queryDuration = Date.now() - queryStartTime;
        logger.metric('db_query_duration', queryDuration);

        if (queryDuration > 300) {
            logger.warn('Slow database query detected', {
                duration: queryDuration,
                count: jobs.length,
                jobIds: jobIds.length
            });
        }

        // Map results
        const statuses = jobIds.map(jobId => {
            const job = jobs.find(j => j.id === jobId);
            
            if (!job) {
                return {
                    jobId,
                    status: 'not_found',
                    error: 'Job not found'
                };
            }

            return {
                jobId: job.id,
                status: job.status,
                recordId: job.recordId || null,
                retryCount: job.retryCount || 0,
                nextRetryAt: job.nextRetryAt || null,
                lastFailureReason: job.lastFailureReason || null,
                fileName: job.fileName || null,
                statusEnteredAt: job.statusEnteredAt || null,
                lastHeartbeat: job.lastHeartbeat || null,
                completedAt: job.completedAt || null,
                failedAt: job.failedAt || null
            };
        });

        // Cache results
        statusCache.set(cacheKey, statuses);

        logger.info('Job statuses fetched', {
            requested: jobIds.length,
            found: jobs.length,
            notFound: jobIds.length - jobs.length,
            queryDuration
        });

        logger.exit(200, { 
            count: statuses.length,
            queryDuration 
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'X-Cache': 'MISS',
                'X-Query-Duration': queryDuration.toString()
            },
            body: JSON.stringify({ statuses })
        };

    } catch (error) {
        logger.error('Failed to fetch job statuses', {
            error: error.message,
            stack: error.stack
        });

        logger.exit(500, { error: error.message });

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Failed to fetch job statuses',
                message: error.message 
            })
        };
    }
};