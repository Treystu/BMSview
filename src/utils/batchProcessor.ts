/**
 * Batch processing utilities for duplicate checking
 * Implements chunking and rate limiting for large file uploads
 */

/**
 * Configuration for batch processing
 */
export const BATCH_CONFIG = {
    // Maximum files to check in a single batch request
    MAX_BATCH_SIZE: 50,

    // Delay between batches to avoid overwhelming the backend (ms)
    BATCH_DELAY_MS: 500,

    // Maximum concurrent batch requests
    MAX_CONCURRENT_BATCHES: 3,

    // Timeout for a single batch request (ms)
    BATCH_TIMEOUT_MS: 30000,

    // Emergency flag to disable batching entirely (for troubleshooting)
    DISABLE_BATCHING: false
};

/**
 * Split an array into chunks of specified size
 * @param array - Array to chunk
 * @param chunkSize - Size of each chunk
 * @returns Array of chunks
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Process batches with concurrency control and delays
 * @param items - Items to process
 * @param batchSize - Size of each batch
 * @param processBatch - Function to process a single batch
 * @param options - Processing options
 * @returns Promise with all results
 */
export async function processBatches<T, R>(
    items: T[],
    batchSize: number,
    processBatch: (batch: T[], batchIndex: number) => Promise<R>,
    options: {
        maxConcurrent?: number;
        delayMs?: number;
        onProgress?: (completed: number, total: number) => void;
        log?: (level: string, message: string, context?: unknown) => void;
        rateLimiter?: RateLimiter; // Optional rate limiter for request throttling
    } = {}
): Promise<R[]> {
    const {
        maxConcurrent = BATCH_CONFIG.MAX_CONCURRENT_BATCHES,
        delayMs = BATCH_CONFIG.BATCH_DELAY_MS,
        onProgress,
        log = () => { },
        rateLimiter
    } = options;

    const chunks = chunkArray(items, batchSize);
    const results: R[] = [];
    let itemsProcessed = 0; // Track actual items processed for accurate progress

    log('info', 'Starting batch processing', {
        totalItems: items.length,
        batchSize,
        numBatches: chunks.length,
        maxConcurrent,
        event: 'BATCH_START'
    });

    // Process batches with concurrency control
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batchGroup = chunks.slice(i, i + maxConcurrent);
        const batchStartTime = Date.now();

        log('info', 'Processing batch group', {
            groupIndex: Math.floor(i / maxConcurrent),
            batchesInGroup: batchGroup.length,
            event: 'BATCH_GROUP_START'
        });

        // Process batches in parallel (up to maxConcurrent)
        const groupResults = await Promise.all(
            batchGroup.map(async (batch, localIndex) => {
                const globalIndex = i + localIndex;
                const startTime = Date.now();

                // Apply rate limiting if configured
                if (rateLimiter) {
                    await rateLimiter.consume(1);
                }

                try {
                    const result = await processBatch(batch, globalIndex);
                    const duration = Date.now() - startTime;

                    log('debug', 'Batch complete', {
                        batchIndex: globalIndex,
                        batchSize: batch.length,
                        durationMs: duration,
                        event: 'BATCH_COMPLETE'
                    });

                    if (onProgress) {
                        // Track actual items processed (batch.length may be < batchSize for last batch)
                        itemsProcessed += batch.length;
                        onProgress(itemsProcessed, items.length);
                    }

                    return result;
                } catch (error) {
                    const duration = Date.now() - startTime;
                    log('error', 'Batch failed', {
                        batchIndex: globalIndex,
                        batchSize: batch.length,
                        durationMs: duration,
                        error: error instanceof Error ? error.message : String(error),
                        event: 'BATCH_ERROR'
                    });
                    throw error;
                }
            })
        );

        results.push(...groupResults);

        const groupDuration = Date.now() - batchStartTime;
        log('info', 'Batch group complete', {
            groupIndex: Math.floor(i / maxConcurrent),
            batchesCompleted: groupResults.length,
            groupDurationMs: groupDuration,
            event: 'BATCH_GROUP_COMPLETE'
        });

        // Add delay between batch groups to avoid overwhelming backend
        if (i + maxConcurrent < chunks.length && delayMs > 0) {
            log('debug', 'Delaying before next batch group', {
                delayMs,
                event: 'BATCH_DELAY'
            });
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    log('info', 'All batches complete', {
        totalItems: items.length,
        totalBatches: chunks.length,
        totalResults: results.length,
        event: 'BATCH_ALL_COMPLETE'
    });

    return results;
}

/**
 * Rate limiter using token bucket algorithm
 * 
 * Used to throttle batch processing requests to prevent overwhelming the backend.
 * 
 * @example
 * // Create a rate limiter: 10 tokens capacity, refill 2 per second
 * const limiter = new RateLimiter(10, 2);
 * 
 * // In processBatches:
 * await processBatches(files, 50, checkBatch, {
 *   rateLimiter: limiter  // Apply rate limiting
 * });
 */
export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private readonly capacity: number;
    private readonly refillRate: number; // tokens per second

    constructor(capacity: number, refillRate: number) {
        this.capacity = capacity;
        this.refillRate = refillRate;
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }

    /**
     * Refill tokens based on elapsed time
     */
    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000; // seconds
        const tokensToAdd = elapsed * this.refillRate;

        this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }

    /**
     * Attempt to consume tokens
     * @param count - Number of tokens to consume
     * @returns true if tokens were available and consumed, false otherwise
     */
    tryConsume(count: number = 1): boolean {
        this.refill();

        if (this.tokens >= count) {
            this.tokens -= count;
            return true;
        }

        return false;
    }

    /**
     * Wait until tokens are available, then consume
     * @param count - Number of tokens to consume
     * @returns Promise that resolves when tokens are consumed
     */
    async consume(count: number = 1): Promise<void> {
        if (count > this.capacity) {
            throw new Error(`Cannot consume ${count} tokens: exceeds capacity of ${this.capacity}`);
        }
        while (!this.tryConsume(count)) {
            // Wait a bit before trying again
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Get current token count
     */
    getTokens(): number {
        this.refill();
        return this.tokens;
    }
}
