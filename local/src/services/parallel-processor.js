/**
 * Parallel Processing Utility for Batch Image Analysis
 *
 * Provides controlled concurrency to maximize throughput while respecting API limits.
 * Default concurrency of 5 balances speed with rate limit safety.
 */

const crypto = require('crypto');

/**
 * Process items in parallel with controlled concurrency
 * @param {Array} items - Items to process
 * @param {Function} processFn - Async function to process each item (item, index) => result
 * @param {Object} options - Processing options
 * @param {number} options.concurrency - Max concurrent operations (default: 5)
 * @param {Function} options.onProgress - Progress callback (completed, total, item, result)
 * @param {Function} options.onError - Error callback (error, item, index)
 * @returns {Promise<Array>} Array of results in same order as items
 */
async function processInParallel(items, processFn, options = {}) {
  const {
    concurrency = 5,
    onProgress = null,
    onError = null
  } = options;

  const results = new Array(items.length);
  let completed = 0;
  let currentIndex = 0;

  console.log(`[Parallel] Starting batch of ${items.length} items with concurrency=${concurrency}`);
  const startTime = Date.now();

  // Worker function that processes items from the queue
  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];

      try {
        const result = await processFn(item, index);
        results[index] = result;
        completed++;

        if (onProgress) {
          onProgress(completed, items.length, item, result);
        }
      } catch (error) {
        results[index] = { error: error.message, item };
        completed++;

        if (onError) {
          onError(error, item, index);
        } else {
          console.error(`[Parallel] Error processing item ${index}:`, error.message);
        }
      }
    }
  }

  // Launch workers up to concurrency limit
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (items.length / (Date.now() - startTime) * 1000).toFixed(2);
  console.log(`[Parallel] Completed ${items.length} items in ${elapsed}s (${rate} items/sec)`);

  return results;
}

/**
 * Pre-compute hashes for a batch of image buffers
 * @param {Array<{buffer: Buffer, fileName: string}>} images - Array of image objects
 * @returns {Array<{hash: string, buffer: Buffer, fileName: string}>} Images with hashes
 */
function preComputeHashes(images) {
  console.log(`[Parallel] Pre-computing hashes for ${images.length} images...`);
  const startTime = Date.now();

  const results = images.map(img => ({
    ...img,
    hash: crypto.createHash('sha256').update(img.buffer).digest('hex')
  }));

  const elapsed = Date.now() - startTime;
  console.log(`[Parallel] Hashed ${images.length} images in ${elapsed}ms (${(images.length / elapsed * 1000).toFixed(1)}/sec)`);

  return results;
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
  filterByExistingRecords,
  createProgressLogger
};
