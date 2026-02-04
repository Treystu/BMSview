/**
 * Image Optimization Service
 *
 * Compresses images before sending to Gemini API to:
 * 1. Reduce upload time
 * 2. Reduce API costs (fewer tokens for smaller images)
 * 3. Speed up processing
 *
 * NOTE: If sharp is not available, compression is skipped gracefully
 */

let sharp = null;
let sharpAvailable = false;

try {
  sharp = require('sharp');
  sharpAvailable = true;
  console.log('[ImageOptimizer] Sharp loaded successfully - image compression enabled');
} catch (err) {
  console.warn('[ImageOptimizer] Sharp not available - image compression disabled');
  console.warn('[ImageOptimizer] To enable: npm install --include=optional sharp');
}

/**
 * Check if image compression is available
 */
function isCompressionAvailable() {
  return sharpAvailable;
}

/**
 * Compress an image buffer
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Object} options - Compression options
 * @returns {Promise<{buffer: Buffer, originalSize: number, compressedSize: number, savings: string}>}
 */
async function compressImage(imageBuffer, options = {}) {
  const {
    maxWidth = 1280,
    quality = 85,
    format = 'jpeg'
  } = options;

  const originalSize = imageBuffer.length;

  // If sharp not available, return original
  if (!sharpAvailable) {
    return {
      buffer: imageBuffer,
      originalSize,
      compressedSize: originalSize,
      savings: '0%',
      skipped: true,
      reason: 'sharp not available'
    };
  }

  try {
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();

    // Skip if already small enough
    if (metadata.width <= maxWidth && originalSize < 200000) {
      return {
        buffer: imageBuffer,
        originalSize,
        compressedSize: originalSize,
        savings: '0%',
        skipped: true
      };
    }

    // Compress
    let pipeline = sharp(imageBuffer);

    // Resize if needed (maintain aspect ratio)
    if (metadata.width > maxWidth) {
      pipeline = pipeline.resize(maxWidth, null, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Convert to JPEG with quality setting
    const compressedBuffer = await pipeline
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    const compressedSize = compressedBuffer.length;
    const savingsPercent = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

    return {
      buffer: compressedBuffer,
      originalSize,
      compressedSize,
      savings: `${savingsPercent}%`,
      skipped: false
    };
  } catch (error) {
    // If compression fails, return original
    console.warn(`[ImageOptimizer] Compression failed: ${error.message}`);
    return {
      buffer: imageBuffer,
      originalSize,
      compressedSize: originalSize,
      savings: '0%',
      error: error.message
    };
  }
}

/**
 * Batch compress multiple images in parallel
 * @param {Array<{buffer: Buffer, fileName: string}>} images - Array of images
 * @param {Object} options - Compression options
 * @returns {Promise<{images: Array, stats: Object}>} Compressed images with stats
 */
async function batchCompressImages(images, options = {}) {
  const { concurrency = 10 } = options;

  // If sharp not available, return images unchanged
  if (!sharpAvailable) {
    console.log('[ImageOptimizer] Skipping compression (sharp not available)');
    const totalSize = images.reduce((sum, img) => sum + img.buffer.length, 0);
    return {
      images: images,
      stats: {
        totalOriginal: totalSize,
        totalCompressed: totalSize,
        savings: '0%',
        elapsed: 0,
        skipped: true,
        reason: 'sharp not available'
      }
    };
  }

  console.log(`[ImageOptimizer] Compressing ${images.length} images (concurrency=${concurrency})...`);
  const startTime = Date.now();

  let totalOriginal = 0;
  let totalCompressed = 0;

  // Process in batches to control concurrency
  const results = [];
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (img) => {
        const result = await compressImage(img.buffer, options);
        totalOriginal += result.originalSize;
        totalCompressed += result.compressedSize;
        return {
          ...img,
          buffer: result.buffer,
          mimeType: result.skipped ? img.mimeType : 'image/jpeg', // Keep original if skipped
          compressionStats: {
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            savings: result.savings
          }
        };
      })
    );
    results.push(...batchResults);
  }

  const elapsed = Date.now() - startTime;
  const totalSavings = ((totalOriginal - totalCompressed) / totalOriginal * 100).toFixed(1);

  console.log(`[ImageOptimizer] Done in ${elapsed}ms. Saved ${totalSavings}% (${(totalOriginal / 1024 / 1024).toFixed(1)}MB → ${(totalCompressed / 1024 / 1024).toFixed(1)}MB)`);

  return {
    images: results,
    stats: {
      totalOriginal,
      totalCompressed,
      savings: totalSavings + '%',
      elapsed
    }
  };
}

module.exports = {
  compressImage,
  batchCompressImages,
  isCompressionAvailable
};
