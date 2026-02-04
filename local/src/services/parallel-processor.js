/**
 * Parallel Processing Utility for Batch Image Analysis
 *
 * Provides controlled concurrency to maximize throughput while respecting API limits.
 * Optimized for:
 * - Parallel hashing with timestamp extraction
 * - Batch weather lookups by hour
 * - Image compression
 */

const crypto = require('crypto');
const { extractStrictTimestamp } = require('./TimeAuthority');

/**
 * Process items in parallel with intelligent throttling and backoff
 * @param {Array} items - Items to process
 * @param {Function} processFn - Async function to process each item (item, index) => result
 * @param {Object} options - Processing options
 * @param {number} options.concurrency - Max concurrent operations (default: 10)
 * @param {Function} options.onProgress - Progress callback (completed, total, item, result)
 * @param {Function} options.onError - Error callback (error, item, index)
 * @param {Function} options.onThrottle - Throttle callback (currentConcurrency, reason)
 * @returns {Promise<Array>} Array of results in same order as items
 */
async function processInParallel(items, processFn, options = {}) {
  const {
    concurrency = 10,
    onProgress = null,
    onError = null,
    onThrottle = null
  } = options;

  const results = new Array(items.length);
  let completed = 0;
  let currentIndex = 0;
  let activeWorkers = 0;

  // Adaptive throttling state
  let currentConcurrency = concurrency;
  let consecutiveErrors = 0;
  let consecutiveSlowResponses = 0;
  let backoffUntil = 0;
  const SLOW_THRESHOLD_MS = 8000;  // Consider >8s responses "slow"
  const ERROR_BACKOFF_MS = 2000;   // Wait 2s after rate limit error
  const MIN_CONCURRENCY = 2;
  const recentResponseTimes = [];  // Track last N response times

  console.log(`[Parallel] Starting batch of ${items.length} items (concurrency=${concurrency}, adaptive throttling enabled)`);
  const startTime = Date.now();

  // Helper to check if we should reduce concurrency
  function shouldThrottle(error, responseTime) {
    // Rate limit errors (429, 503, quota exceeded)
    if (error) {
      const msg = error.message?.toLowerCase() || '';
      if (msg.includes('429') || msg.includes('rate') || msg.includes('quota') || msg.includes('503')) {
        return { throttle: true, reason: 'rate_limit', backoff: ERROR_BACKOFF_MS * (consecutiveErrors + 1) };
      }
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        return { throttle: true, reason: 'consecutive_errors', backoff: ERROR_BACKOFF_MS };
      }
    } else {
      consecutiveErrors = 0;
    }

    // Slow response detection
    if (responseTime > SLOW_THRESHOLD_MS) {
      consecutiveSlowResponses++;
      if (consecutiveSlowResponses >= 3) {
        consecutiveSlowResponses = 0;
        return { throttle: true, reason: 'slow_responses', backoff: 0 };
      }
    } else {
      consecutiveSlowResponses = Math.max(0, consecutiveSlowResponses - 1);
    }

    return { throttle: false };
  }

  // Helper to possibly increase concurrency if things are going well
  function shouldIncreaseConcurrency() {
    if (currentConcurrency >= concurrency) return false;
    if (recentResponseTimes.length < 5) return false;

    const avgTime = recentResponseTimes.reduce((a, b) => a + b, 0) / recentResponseTimes.length;
    return avgTime < 3000 && consecutiveErrors === 0;
  }

  // Worker function with throttling
  async function worker(workerId) {
    while (currentIndex < items.length) {
      // Check for backoff
      const now = Date.now();
      if (now < backoffUntil) {
        await new Promise(r => setTimeout(r, backoffUntil - now));
      }

      // Check if we should pause this worker due to reduced concurrency
      if (workerId >= currentConcurrency) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      const index = currentIndex++;
      if (index >= items.length) break;

      const item = items[index];
      const itemStart = Date.now();

      try {
        activeWorkers++;
        const result = await processFn(item, index);
        activeWorkers--;

        const responseTime = Date.now() - itemStart;
        recentResponseTimes.push(responseTime);
        if (recentResponseTimes.length > 10) recentResponseTimes.shift();

        results[index] = result;
        completed++;

        // Check throttling
        const throttleCheck = shouldThrottle(null, responseTime);
        if (throttleCheck.throttle) {
          const newConcurrency = Math.max(MIN_CONCURRENCY, Math.floor(currentConcurrency * 0.7));
          if (newConcurrency < currentConcurrency) {
            console.log(`[Parallel] Throttling: ${currentConcurrency} → ${newConcurrency} (${throttleCheck.reason})`);
            currentConcurrency = newConcurrency;
            if (onThrottle) onThrottle(currentConcurrency, throttleCheck.reason);
          }
        } else if (shouldIncreaseConcurrency()) {
          const newConcurrency = Math.min(concurrency, currentConcurrency + 1);
          if (newConcurrency > currentConcurrency) {
            console.log(`[Parallel] Increasing concurrency: ${currentConcurrency} → ${newConcurrency}`);
            currentConcurrency = newConcurrency;
          }
        }

        if (onProgress) {
          onProgress(completed, items.length, item, result);
        }
      } catch (error) {
        activeWorkers--;
        const responseTime = Date.now() - itemStart;

        // Check for rate limiting
        const throttleCheck = shouldThrottle(error, responseTime);
        if (throttleCheck.throttle) {
          const newConcurrency = Math.max(MIN_CONCURRENCY, Math.floor(currentConcurrency * 0.5));
          console.log(`[Parallel] Error throttle: ${currentConcurrency} → ${newConcurrency} (${throttleCheck.reason})`);
          currentConcurrency = newConcurrency;
          backoffUntil = Date.now() + throttleCheck.backoff;
          if (onThrottle) onThrottle(currentConcurrency, throttleCheck.reason);

          // Retry this item
          currentIndex = index;
          continue;
        }

        results[index] = { error: error.message, item };
        completed++;

        if (onError) {
          onError(error, item, index);
        }
      }
    }
  }

  // Launch workers up to concurrency limit
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker(i));
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (items.length / (Date.now() - startTime) * 1000).toFixed(2);
  console.log(`[Parallel] ✓ Completed ${items.length} items in ${elapsed}s (${rate}/sec, final concurrency: ${currentConcurrency})`);

  return results;
}

/**
 * Pre-compute hashes AND extract timestamps for a batch of images
 * This does both operations in a single pass for efficiency
 * @param {Array<{buffer: Buffer, fileName: string}>} images - Array of image objects
 * @returns {Array} Images with hashes, timestamps, and weather grouping keys
 */
function preComputeHashes(images) {
  console.log(`[Parallel] Pre-processing ${images.length} images (hash + timestamp)...`);
  const startTime = Date.now();

  const results = [];
  const weatherGroups = new Map(); // Group by hour for batch weather lookups

  for (const img of images) {
    // Hash the image
    const hash = crypto.createHash('sha256').update(img.buffer).digest('hex');

    // Extract timestamp from filename
    const tsResult = extractStrictTimestamp(img.fileName);

    // Create weather grouping key (YYYY-MM-DD-HH)
    let weatherKey = null;
    if (tsResult.valid && tsResult.timestamp) {
      const ts = tsResult.timestamp;
      // Extract date and hour: "2026-01-15T14:30:00" -> "2026-01-15-14"
      weatherKey = ts.substring(0, 13).replace('T', '-');

      // Track weather groups
      if (!weatherGroups.has(weatherKey)) {
        weatherGroups.set(weatherKey, []);
      }
      weatherGroups.get(weatherKey).push(img.fileName);
    }

    results.push({
      ...img,
      hash,
      timestamp: tsResult.valid ? tsResult.timestamp : null,
      timestampError: tsResult.valid ? null : tsResult.error,
      weatherKey
    });
  }

  const elapsed = Date.now() - startTime;
  const validTimestamps = results.filter(r => r.timestamp).length;
  console.log(`[Parallel] Pre-processed ${images.length} in ${elapsed}ms: ${validTimestamps} valid timestamps, ${weatherGroups.size} weather groups`);

  return results;
}

/**
 * Group images by weather hour for batch lookups
 * @param {Array} images - Pre-processed images with weatherKey
 * @returns {Map<string, Array>} Map of weatherKey -> images
 */
function groupByWeatherHour(images) {
  const groups = new Map();

  for (const img of images) {
    if (img.weatherKey) {
      if (!groups.has(img.weatherKey)) {
        groups.set(img.weatherKey, []);
      }
      groups.get(img.weatherKey).push(img);
    }
  }

  return groups;
}

/**
 * Filter images that need processing based on existing records
 * @param {Array} hashedImages - Images with computed hashes
 * @param {Set<string>} completeHashes - Set of hashes for complete records
 * @param {Map<string, object>} hashToRecord - Map of hash -> existing record
 * @param {Function} shouldReanalyze - Function to check if record needs re-analysis
 * @returns {Object} { toProcess: [], toSkip: [] }
 */
function filterByExistingRecords(hashedImages, completeHashes, hashToRecord, shouldReanalyze) {
  console.log(`[Parallel] Filtering ${hashedImages.length} images against ${completeHashes.size} complete records...`);

  const toProcess = [];
  const toSkip = [];

  for (const img of hashedImages) {
    // Check if this is a complete record that doesn't need re-analysis
    if (completeHashes.has(img.hash)) {
      const existingRecord = hashToRecord.get(img.hash);
      toSkip.push({
        ...img,
        existingRecord,
        skipReason: 'complete'
      });
      continue;
    }

    // Check if there's an existing record that might need re-analysis
    const existingRecord = hashToRecord.get(img.hash);
    if (existingRecord) {
      const reanalyzeCheck = shouldReanalyze(existingRecord);
      if (!reanalyzeCheck.should) {
        toSkip.push({
          ...img,
          existingRecord,
          skipReason: reanalyzeCheck.reason
        });
        continue;
      }
      // Needs re-analysis - add to process queue
      img.existingRecord = existingRecord;
      img.reanalyzeReason = reanalyzeCheck.reason;
    }

    toProcess.push(img);
  }

  console.log(`[Parallel] Filter result: ${toProcess.length} to process, ${toSkip.length} to skip`);
  if (toSkip.length > 0) {
    const skipReasons = {};
    for (const s of toSkip) {
      skipReasons[s.skipReason] = (skipReasons[s.skipReason] || 0) + 1;
    }
    console.log(`[Parallel] Skip breakdown:`, skipReasons);
  }

  return { toProcess, toSkip };
}

/**
 * Create a simple progress tracker for console logging
 * @param {number} total - Total items
 * @param {string} prefix - Log prefix
 * @returns {Function} Progress callback
 */
function createProgressLogger(total, prefix = '[Parallel]') {
  const startTime = Date.now();
  let lastLogTime = 0;

  return (completed, _total, item, result) => {
    const now = Date.now();
    // Log every 5 seconds or on completion
    if (now - lastLogTime >= 5000 || completed === total) {
      const elapsed = (now - startTime) / 1000;
      const rate = completed / elapsed;
      const eta = ((total - completed) / rate).toFixed(0);
      const percent = ((completed / total) * 100).toFixed(1);

      console.log(`${prefix} Progress: ${completed}/${total} (${percent}%) | ${rate.toFixed(1)}/sec | ETA: ${eta}s`);
      lastLogTime = now;
    }
  };
}

module.exports = {
  processInParallel,
  preComputeHashes,
  groupByWeatherHour,
  filterByExistingRecords,
  createProgressLogger
};
