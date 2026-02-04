/**
 * Upload Routes - Handles file uploads with strict timestamp enforcement
 *
 * ZERO-TOLERANCE TIMESTAMP POLICY:
 * Every file is validated through TimeAuthority BEFORE processing.
 * Files without valid timestamps are REJECTED, not processed with fallbacks.
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { extractStrictTimestamp, isValidFilename } = require('../services/TimeAuthority');
const { analyzeImage, getAvailableModels, estimateCost, DEFAULT_MODEL } = require('../services/analyzer');
const { saveRecord, getRecordByHash, getRecordsByHashes, getCompleteRecordHashes, updateRecord } = require('../services/csv-store');
const { getWeather, getSolarOnly, batchPreFetchWeather } = require('../services/weather');
const { getSettings } = require('../services/settings');
const { extractImagesFromZip, isZipFile, isImageFile } = require('../services/zip-extractor');
const {
  sanitizeRecord,
  determineVerificationState,
  shouldReanalyze,
  validatePhysics,
  attemptPhysicsFix,
  applySanityFixes,
  VERIFICATION_STATES
} = require('../services/verification');
const {
  processInParallel,
  preComputeHashes,
  groupByWeatherHour,
  filterByExistingRecords,
  createProgressLogger
} = require('../services/parallel-processor');
const { batchCompressImages } = require('../services/image-optimizer');

const router = express.Router();

// Configure multer
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
      'application/zip', 'application/x-zip-compressed', 'application/octet-stream'
    ];
    if (allowedTypes.includes(file.mimetype) ||
        file.originalname.endsWith('.zip') ||
        isImageFile(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and ZIP files are allowed.'));
    }
  }
});

// Multer error handler
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    console.error('[Upload] Multer error:', err.code, err.message);
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  } else if (err) {
    console.error('[Upload] Error:', err.message);
    return res.status(400).json({ error: err.message });
  }
  next();
}

/**
 * Validate filename and extract timestamp using TimeAuthority
 * Returns { valid, timestamp, error }
 */
function validateAndExtractTimestamp(fileName) {
  try {
    const timestamp = extractStrictTimestamp(fileName);
    return { valid: true, timestamp, error: null };
  } catch (err) {
    return { valid: false, timestamp: null, error: err.message };
  }
}

/**
 * Process a single image with strict timestamp enforcement
 * Uses verification state system for automatic re-analysis of incomplete records
 *
 * @param {Buffer} imageBuffer - Image data
 * @param {string} fileName - Original filename
 * @param {string} mimeType - Image MIME type
 * @param {string} modelId - Gemini model to use
 * @param {object} settings - App settings
 * @param {object} options - Processing options
 * @param {boolean} options.forceReanalyze - Force re-analyze even if complete (default: false)
 */
async function processSingleImage(imageBuffer, fileName, mimeType, modelId, settings, options = {}) {
  const { forceReanalyze = false } = options;

  // STEP 1: TimeAuthority validation (Filename or Bust)
  const timestampValidation = validateAndExtractTimestamp(fileName);

  if (!timestampValidation.valid) {
    return {
      success: false,
      rejected: true,
      reason: 'Not meeting filename expectations',
      error: timestampValidation.error,
      fileName
    };
  }

  const forcedTimestamp = timestampValidation.timestamp;

  // STEP 2: Check for duplicate and determine if re-analysis needed
  const contentHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  const existingRecord = getRecordByHash(contentHash);

  if (existingRecord) {
    // Use verification system to determine if re-analysis is needed
    const reanalyzeCheck = shouldReanalyze(existingRecord);

    if (!forceReanalyze && !reanalyzeCheck.should) {
      return {
        success: false,
        duplicate: true,
        record: existingRecord,
        fileName,
        verificationState: existingRecord.verification_state,
        reason: reanalyzeCheck.reason
      };
    }

    console.log(`[Upload] Re-analyzing ${fileName}: ${reanalyzeCheck.reason}`);
  }

  // STEP 3: Analyze with Gemini (passing the FORCED timestamp)
  const base64Image = imageBuffer.toString('base64');
  const analysis = await analyzeImage(base64Image, mimeType, settings.geminiApiKey, modelId, forcedTimestamp);

  // STEP 4: Get weather/solar data using the strict timestamp
  let weather = null;
  if (settings.latitude && settings.longitude) {
    try {
      // Parse the timestamp for weather API (create Date from local time string)
      const [datePart, timePart] = forcedTimestamp.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, min, sec] = timePart.split(':').map(Number);
      const effectiveTime = new Date(year, month - 1, day, hour, min, sec);

      if (settings.weatherApiKey) {
        weather = await getWeather(settings.latitude, settings.longitude, settings.weatherApiKey, effectiveTime);
      } else {
        weather = await getSolarOnly(settings.latitude, settings.longitude, effectiveTime);
      }
    } catch (weatherError) {
      console.warn('[Upload] Weather/Solar fetch failed:', weatherError.message);
    }
  }

  // STEP 5: Create record data
  let recordData = {
    contentHash,
    fileName,
    timestamp: new Date().toISOString(), // Upload time (for reference only)
    timestampFromFilename: forcedTimestamp, // THE authoritative timestamp
    ...analysis,
    weather_temp: weather?.temp ?? null,
    weather_clouds: weather?.clouds ?? null,
    weather_uvi: weather?.uvi ?? null,
    weather_condition: weather?.weather_main ?? null,
    solar_ghi: weather?.solar_ghi ?? null,
    solar_dni: weather?.solar_dni ?? null,
    solar_dhi: weather?.solar_dhi ?? null,
    solar_direct: weather?.solar_direct ?? null,
    model_used: modelId,
    cost_usd: analysis._meta?.cost?.total ?? null
  };

  // Remove _meta from record
  delete recordData._meta;

  // STEP 6: Sanitize data - fix obviously wrong values
  const { sanitized, fixes } = sanitizeRecord(recordData);
  recordData = sanitized;

  if (fixes.length > 0) {
    console.log(`[Upload] Data sanitization for ${fileName}:`, fixes);
  }

  // STEP 6b: Attempt physics-based fixes (decimal errors, unit conversions)
  const physicsFixResult = attemptPhysicsFix(recordData);
  if (physicsFixResult.fixes.length > 0) {
    console.log(`[Upload] Physics-based fixes for ${fileName}:`, physicsFixResult.fixes);
    recordData = physicsFixResult.fixed;
  }

  // STEP 6c: Validate physics (Ohm's law, cell topology, chemistry bounds)
  const physicsValidation = validatePhysics(recordData);
  if (!physicsValidation.valid) {
    console.warn(`[Upload] Physics validation FAILED for ${fileName}:`, physicsValidation.errors);
  }
  if (physicsValidation.warnings.length > 0) {
    console.log(`[Upload] Physics warnings for ${fileName}:`, physicsValidation.warnings);
  }

  // STEP 6d: Apply sanity validation (null out impossible values like cycle=0 when not new)
  const sanityResult = applySanityFixes(recordData);
  if (sanityResult.fixes.length > 0) {
    console.log(`[Upload] Sanity fixes for ${fileName}:`, sanityResult.fixes);
    recordData = sanityResult.fixed;
  }

  // STEP 7: Determine verification state
  const analysisCount = existingRecord ? (existingRecord.analysis_count || 1) + 1 : 1;
  const previousState = existingRecord?.verification_state || null;
  const verificationResult = determineVerificationState(recordData, previousState, analysisCount);

  recordData.verification_state = verificationResult.state;
  recordData.analysis_count = analysisCount;
  recordData.needs_reanalysis = verificationResult.state === VERIFICATION_STATES.PARTIAL_NEEDS_VERIFY;

  console.log(`[Upload] ${fileName}: State=${verificationResult.state}, Count=${analysisCount}, Missing=${verificationResult.missing.join(', ') || 'none'}`);

  // STEP 8: Save or update record
  let record;
  let wasUpdated = false;

  if (existingRecord) {
    // UPDATE existing record with new extraction
    record = updateRecord(existingRecord.id, recordData);
    wasUpdated = true;
    console.log(`[Upload] UPDATED existing record: ${fileName}`);
  } else {
    // CREATE new record
    record = { id: uuidv4(), ...recordData };
    saveRecord(record);
    console.log(`[Upload] CREATED new record: ${fileName}`);
  }

  return {
    success: true,
    record,
    cost: analysis._meta?.cost,
    fileName,
    wasUpdated,
    verificationState: verificationResult.state,
    missingFields: verificationResult.missing
  };
}

/**
 * Optimized single image processing for batch operations
 * Uses pre-computed hash and timestamp to avoid redundant work
 */
async function processSingleImageOptimized(imageBuffer, fileName, mimeType, modelId, settings, options = {}) {
  const {
    forceReanalyze = false,
    precomputedHash = null,
    precomputedTimestamp = null,
    existingRecord = null
  } = options;

  const funcStart = Date.now();

  // Use pre-computed values if available
  const contentHash = precomputedHash || crypto.createHash('sha256').update(imageBuffer).digest('hex');
  const forcedTimestamp = precomputedTimestamp;

  if (!forcedTimestamp) {
    return {
      success: false,
      rejected: true,
      reason: 'No timestamp available',
      error: 'Timestamp must be pre-computed for optimized processing',
      fileName
    };
  }

  // Analyze with Gemini (this is the slow part - API call)
  const apiStart = Date.now();
  const base64Image = imageBuffer.toString('base64');
  const analysis = await analyzeImage(base64Image, mimeType, settings.geminiApiKey, modelId, forcedTimestamp);
  const apiTime = Date.now() - apiStart;

  // Get weather/solar data
  let weather = null;
  if (settings.latitude && settings.longitude) {
    try {
      const [datePart, timePart] = forcedTimestamp.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, min, sec] = timePart.split(':').map(Number);
      const effectiveTime = new Date(year, month - 1, day, hour, min, sec);

      if (settings.weatherApiKey) {
        weather = await getWeather(settings.latitude, settings.longitude, settings.weatherApiKey, effectiveTime);
      } else {
        weather = await getSolarOnly(settings.latitude, settings.longitude, effectiveTime);
      }
    } catch (weatherError) {
      // Silently continue - weather is optional
    }
  }

  // Create record data
  let recordData = {
    contentHash,
    fileName,
    timestamp: new Date().toISOString(),
    timestampFromFilename: forcedTimestamp,
    ...analysis,
    weather_temp: weather?.temp ?? null,
    weather_clouds: weather?.clouds ?? null,
    weather_uvi: weather?.uvi ?? null,
    weather_condition: weather?.weather_main ?? null,
    solar_ghi: weather?.solar_ghi ?? null,
    solar_dni: weather?.solar_dni ?? null,
    solar_dhi: weather?.solar_dhi ?? null,
    solar_direct: weather?.solar_direct ?? null,
    model_used: modelId,
    cost_usd: analysis._meta?.cost?.total ?? null
  };

  delete recordData._meta;

  // Sanitize and validate
  const { sanitized, fixes } = sanitizeRecord(recordData);
  recordData = sanitized;

  const physicsFixResult = attemptPhysicsFix(recordData);
  if (physicsFixResult.fixes.length > 0) {
    recordData = physicsFixResult.fixed;
  }

  // Apply sanity validation (null out impossible values)
  const sanityResult = applySanityFixes(recordData);
  if (sanityResult.fixes.length > 0) {
    recordData = sanityResult.fixed;
  }

  // Determine verification state
  const analysisCount = existingRecord ? (existingRecord.analysis_count || 1) + 1 : 1;
  const previousState = existingRecord?.verification_state || null;
  const verificationResult = determineVerificationState(recordData, previousState, analysisCount);

  recordData.verification_state = verificationResult.state;
  recordData.analysis_count = analysisCount;
  recordData.needs_reanalysis = verificationResult.state === VERIFICATION_STATES.PARTIAL_NEEDS_VERIFY;

  // Save or update
  let record;
  let wasUpdated = false;

  if (existingRecord) {
    record = updateRecord(existingRecord.id, recordData);
    wasUpdated = true;
  } else {
    record = { id: uuidv4(), ...recordData };
    saveRecord(record);
  }

  const totalTime = Date.now() - funcStart;

  return {
    success: true,
    record,
    cost: analysis._meta?.cost,
    fileName,
    wasUpdated,
    verificationState: verificationResult.state,
    missingFields: verificationResult.missing,
    timing: {
      total: totalTime,
      api: apiTime
    }
  };
}

// GET /api/models - Get available models
router.get('/models', (req, res) => {
  try {
    const models = getAvailableModels();
    res.json({
      models,
      defaultModel: DEFAULT_MODEL
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/estimate/:modelId - Get cost estimate
router.get('/estimate/:modelId', (req, res) => {
  try {
    const { modelId } = req.params;
    const count = parseInt(req.query.count) || 1;
    const estimate = estimateCost(modelId);

    const batchEstimate = {
      ...estimate,
      count,
      estimatedCost: {
        ...estimate.estimatedCost,
        total: estimate.estimatedCost.total * count,
        formatted: `$${(estimate.estimatedCost.total * count).toFixed(6)}`
      }
    };

    res.json(batchEstimate);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/analyze - Analyze screenshot(s)
router.post('/analyze', upload.single('image'), handleMulterError, async (req, res) => {
  console.log('[Upload] Analyze request received');

  try {
    const settings = getSettings();

    if (!settings.geminiApiKey) {
      return res.status(400).json({
        error: 'Gemini API key not configured. Please add it in Settings.'
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const modelId = req.body.model || settings.selectedModel || DEFAULT_MODEL;
    const forceReanalyze = req.body.forceReanalyze === 'true' || req.body.forceReanalyze === true;
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;

    // Auto-update incomplete records by default (verification state system)
    const processOptions = { forceReanalyze };

    console.log(`[Upload] Processing: ${fileName} (${fileBuffer.length} bytes)`);

    // Handle ZIP files
    if (isZipFile(fileBuffer) || fileName.toLowerCase().endsWith('.zip')) {
      const batchStart = Date.now();
      console.log(`[Upload] ========== BATCH PROCESSING START ==========`);

      const images = extractImagesFromZip(fileBuffer);

      if (images.length === 0) {
        return res.status(400).json({ error: 'No images found in ZIP file' });
      }

      console.log(`[Upload] ZIP extracted: ${images.length} images`);

      // OPTIMIZATION 1: Pre-compute all hashes first (fast, CPU-bound)
      console.log(`[Upload] Phase 1: Computing content hashes...`);
      const hashStart = Date.now();
      const hashedImages = preComputeHashes(images);
      console.log(`[Upload] Phase 1 complete: ${Date.now() - hashStart}ms`);

      // OPTIMIZATION 2: Batch lookup existing records
      console.log(`[Upload] Phase 2: Checking existing records...`);
      const lookupStart = Date.now();
      const allHashes = hashedImages.map(img => img.hash);
      const existingRecords = getRecordsByHashes(allHashes);
      const completeHashes = getCompleteRecordHashes();
      console.log(`[Upload] Phase 2 complete: ${Date.now() - lookupStart}ms (${completeHashes.size} complete records in DB)`);

      // OPTIMIZATION 3: Filter to only images that need processing
      console.log(`[Upload] Phase 3: Filtering images...`);
      const { toProcess, toSkip } = filterByExistingRecords(
        hashedImages,
        completeHashes,
        existingRecords,
        shouldReanalyze
      );

      // Validate filenames for processable images
      const validToProcess = [];
      const invalidFilenames = [];
      for (const img of toProcess) {
        const timestampValidation = validateAndExtractTimestamp(img.fileName);
        if (timestampValidation.valid) {
          img.timestamp = timestampValidation.timestamp;
          validToProcess.push(img);
        } else {
          invalidFilenames.push({
            fileName: img.fileName,
            error: timestampValidation.error,
            rejected: true
          });
        }
      }

      console.log(`[Upload] Phase 3 complete: ${validToProcess.length} to process, ${toSkip.length} skipped, ${invalidFilenames.length} invalid filenames`);

      // Build results array starting with skipped items
      const results = [];

      // Add skipped items as duplicates
      for (const skipped of toSkip) {
        results.push({
          success: false,
          duplicate: true,
          record: skipped.existingRecord,
          fileName: skipped.fileName,
          verificationState: skipped.existingRecord?.verification_state,
          reason: skipped.skipReason
        });
      }

      // Add invalid filenames as rejected
      results.push(...invalidFilenames);

      // OPTIMIZATION 4: Process remaining images in parallel
      let totalCost = 0;
      let processed = 0;
      let updated = 0;
      let errors = 0;

      if (validToProcess.length > 0) {
        console.log(`[Upload] Phase 4: Processing ${validToProcess.length} images in parallel...`);
        const concurrency = settings.batchConcurrency || 5;
        console.log(`[Upload] Concurrency: ${concurrency} parallel API calls`);

        const processStart = Date.now();
        const progressLogger = createProgressLogger(validToProcess.length, '[Upload]');

        const processResults = await processInParallel(
          validToProcess,
          async (img) => {
            // Process single image (with pre-computed hash and timestamp)
            return await processSingleImageOptimized(
              img.buffer,
              img.fileName,
              img.mimeType,
              modelId,
              settings,
              {
                ...processOptions,
                precomputedHash: img.hash,
                precomputedTimestamp: img.timestamp,
                existingRecord: img.existingRecord
              }
            );
          },
          {
            concurrency,
            onProgress: progressLogger,
            onError: (err, img) => {
              console.error(`[Upload] Error: ${img.fileName} - ${err.message}`);
            }
          }
        );

        // Aggregate results
        for (const result of processResults) {
          if (result.error && !result.success) {
            errors++;
          } else if (result.success) {
            if (result.wasUpdated) {
              updated++;
            } else {
              processed++;
            }
            if (result.cost?.total) {
              totalCost += result.cost.total;
            }
          }
          results.push(result);
        }

        console.log(`[Upload] Phase 4 complete: ${Date.now() - processStart}ms`);
      }

      const totalTime = ((Date.now() - batchStart) / 1000).toFixed(1);
      console.log(`[Upload] ========== BATCH COMPLETE ==========`);
      console.log(`[Upload] Total: ${images.length} | Processed: ${processed} | Updated: ${updated} | Skipped: ${toSkip.length} | Rejected: ${invalidFilenames.length} | Errors: ${errors}`);
      console.log(`[Upload] Time: ${totalTime}s | Cost: $${totalCost.toFixed(6)}`);

      res.json({
        success: true,
        isZip: true,
        totalImages: images.length,
        processed,
        updated,
        duplicates: toSkip.length,
        rejected: invalidFilenames.length,
        errors,
        totalCost: {
          amount: totalCost,
          formatted: `$${totalCost.toFixed(6)}`
        },
        timing: {
          totalSeconds: parseFloat(totalTime),
          imagesPerSecond: (images.length / parseFloat(totalTime)).toFixed(2)
        },
        results
      });

    } else {
      // Single image
      const result = await processSingleImage(
        fileBuffer,
        fileName,
        req.file.mimetype,
        modelId,
        settings,
        processOptions
      );

      if (result.rejected) {
        return res.status(400).json({
          error: result.error,
          rejected: true,
          reason: result.reason
        });
      }

      if (result.duplicate) {
        return res.json({
          duplicate: true,
          record: result.record,
          message: 'This screenshot has already been analyzed'
        });
      }

      res.json({
        success: true,
        record: result.record,
        cost: result.cost,
        message: 'Analysis complete'
      });
    }

  } catch (error) {
    console.error('[Upload] Error:', error.message);
    res.status(500).json({ error: error.message || 'Unknown error during analysis' });
  }
});

// POST /api/check-duplicate - Pre-upload duplicate check
router.post('/check-duplicate', upload.single('image'), handleMulterError, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const contentHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const existingRecord = getRecordByHash(contentHash);

    // Also check if filename is valid
    const timestampValidation = validateAndExtractTimestamp(req.file.originalname);

    res.json({
      isDuplicate: !!existingRecord,
      existingRecord: existingRecord || null,
      filenameValid: timestampValidation.valid,
      filenameError: timestampValidation.error
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/analyze-stream - SSE-based analyze with real-time progress
router.post('/analyze-stream', upload.single('image'), handleMulterError, async (req, res) => {
  console.log('[Upload-SSE] ========== STREAM REQUEST RECEIVED ==========');

  // Clear prompt cache to ensure latest prompt is used
  const { clearPromptCache } = require('../services/analyzer');
  clearPromptCache();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Helper to send SSE events
  const sendEvent = (type, data) => {
    const eventData = { type, ...data };
    console.log(`[SSE] Event: ${type}`, JSON.stringify(data).substring(0, 200));
    res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  };

  try {
    const settings = getSettings();

    if (!settings.geminiApiKey) {
      sendEvent('error', { message: 'Gemini API key not configured. Please add it in Settings.' });
      return res.end();
    }

    if (!req.file) {
      sendEvent('error', { message: 'No file provided' });
      return res.end();
    }

    const modelId = settings.selectedModel || DEFAULT_MODEL;
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;

    console.log(`[Upload-SSE] File: ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

    // Handle ZIP files with streaming progress
    if (isZipFile(fileBuffer) || fileName.toLowerCase().endsWith('.zip')) {
      const batchStart = Date.now();

      // Phase 0: Extract ZIP
      sendEvent('phase', { phase: 'extracting', message: 'Extracting ZIP file...' });
      const images = extractImagesFromZip(fileBuffer);
      console.log(`[Upload-SSE] Extracted ${images.length} images from ZIP`);

      if (images.length === 0) {
        sendEvent('error', { message: 'No images found in ZIP file' });
        return res.end();
      }

      sendEvent('init', {
        total: images.length,
        message: `Found ${images.length} images`
      });

      // Phase 1: Hash all images
      console.log(`[Upload-SSE] Phase 1: Hashing ${images.length} images...`);
      sendEvent('phase', { phase: 'hashing', message: 'Computing content hashes...' });
      const hashedImages = preComputeHashes(images);

      // Phase 2: PRE-CHECK - Look up existing records
      console.log(`[Upload-SSE] Phase 2: Pre-checking against database...`);
      sendEvent('phase', { phase: 'precheck', message: 'Checking for known-good records...' });
      const allHashes = hashedImages.map(img => img.hash);
      const existingRecords = getRecordsByHashes(allHashes);
      const completeHashes = getCompleteRecordHashes();

      // Count known-good records UPFRONT
      let knownGoodCount = 0;
      let needsProcessingCount = 0;
      let needsReanalysisCount = 0;

      for (const img of hashedImages) {
        if (completeHashes.has(img.hash)) {
          knownGoodCount++;
        } else {
          const existing = existingRecords.get(img.hash);
          if (existing) {
            const recheck = shouldReanalyze(existing);
            if (recheck.should) {
              needsReanalysisCount++;
            } else {
              knownGoodCount++; // Verified incomplete, no need to reprocess
            }
          } else {
            needsProcessingCount++;
          }
        }
      }

      // ★ PROMINENT PRE-CHECK RESULT - Show user what will be skipped
      console.log(`[Upload-SSE] ★ PRE-CHECK COMPLETE ★`);
      console.log(`[Upload-SSE]   Known-good (skip): ${knownGoodCount}`);
      console.log(`[Upload-SSE]   New (process): ${needsProcessingCount}`);
      console.log(`[Upload-SSE]   Re-analyze: ${needsReanalysisCount}`);

      sendEvent('precheck-complete', {
        total: images.length,
        knownGood: knownGoodCount,
        newImages: needsProcessingCount,
        needsReanalysis: needsReanalysisCount,
        message: `✓ ${knownGoodCount} already complete, ${needsProcessingCount + needsReanalysisCount} need processing`
      });

      // Phase 3: Filter and validate
      console.log(`[Upload-SSE] Phase 3: Filtering and validating filenames...`);
      sendEvent('phase', { phase: 'filtering', message: 'Validating filenames...' });
      const { toProcess, toSkip } = filterByExistingRecords(
        hashedImages,
        completeHashes,
        existingRecords,
        shouldReanalyze
      );

      // Validate filenames
      const validToProcess = [];
      const invalidFilenames = [];
      for (const img of toProcess) {
        const timestampValidation = validateAndExtractTimestamp(img.fileName);
        if (timestampValidation.valid) {
          img.timestamp = timestampValidation.timestamp;
          validToProcess.push(img);
        } else {
          invalidFilenames.push({ fileName: img.fileName, error: timestampValidation.error });
        }
      }

      console.log(`[Upload-SSE] Validation: ${validToProcess.length} valid, ${invalidFilenames.length} invalid filenames`);

      sendEvent('filter-complete', {
        toProcess: validToProcess.length,
        skipped: toSkip.length,
        invalid: invalidFilenames.length
      });

      // Phase 3.5: COMPRESS IMAGES before API calls
      let imagesToProcess = validToProcess;
      if (settings.imageCompression !== false && validToProcess.length > 0) {
        console.log(`[Upload-SSE] Phase 3.5: Compressing ${validToProcess.length} images...`);
        sendEvent('phase', { phase: 'compression', message: `Compressing ${validToProcess.length} images for faster upload...` });

        const compressionOptions = {
          maxWidth: settings.maxImageWidth || 1280,
          quality: settings.imageQuality || 85,
          concurrency: settings.batchConcurrency || 10
        };

        const compressionResult = await batchCompressImages(validToProcess, compressionOptions);
        imagesToProcess = compressionResult.images;

        console.log(`[Upload-SSE] Compression complete: saved ${compressionResult.stats.savings}`);
        sendEvent('compression-complete', {
          originalSize: (compressionResult.stats.totalOriginal / 1024 / 1024).toFixed(1) + 'MB',
          compressedSize: (compressionResult.stats.totalCompressed / 1024 / 1024).toFixed(1) + 'MB',
          savings: compressionResult.stats.savings,
          elapsed: compressionResult.stats.elapsed + 'ms'
        });
      }

      // Phase 3.6: PRE-FETCH WEATHER for all unique hours (batch optimization)
      if ((settings.latitude && settings.longitude) && imagesToProcess.length > 0) {
        const timestamps = imagesToProcess
          .filter(img => img.timestamp)
          .map(img => img.timestamp);

        if (timestamps.length > 0) {
          console.log(`[Upload-SSE] Phase 3.6: Pre-fetching weather for ${timestamps.length} timestamps...`);
          sendEvent('phase', { phase: 'weather-prefetch', message: 'Pre-fetching weather data...' });

          try {
            const weatherResult = await batchPreFetchWeather(
              settings.latitude,
              settings.longitude,
              settings.weatherApiKey || null,
              timestamps,
              { concurrency: 5 }
            );

            sendEvent('weather-prefetch-complete', {
              fetched: weatherResult.fetched,
              cached: weatherResult.cached,
              failed: weatherResult.failed,
              message: `Weather: ${weatherResult.fetched} fetched, ${weatherResult.cached} cached`
            });
          } catch (err) {
            console.warn(`[Upload-SSE] Weather pre-fetch failed: ${err.message}`);
            // Continue anyway - weather is optional
          }
        }
      }

      // Phase 4: Process with real-time progress
      let totalCost = 0;
      let processed = 0;
      let updated = 0;
      let errors = 0;
      const processStart = Date.now();

      // Timing stats for batch summary (instead of per-file "Slow" logs)
      const timingStats = { times: [], apiTimes: [], slowCount: 0 };

      if (imagesToProcess.length > 0) {
        sendEvent('phase', { phase: 'processing', message: `Processing ${imagesToProcess.length} images...` });

        const concurrency = settings.batchConcurrency || 10;

        await processInParallel(
          imagesToProcess,
          async (img) => {
            return await processSingleImageOptimized(
              img.buffer,
              img.fileName,
              img.mimeType,
              modelId,
              settings,
              {
                precomputedHash: img.hash,
                precomputedTimestamp: img.timestamp,
                existingRecord: img.existingRecord
              }
            );
          },
          {
            concurrency,
            onProgress: (completed, total, img, result) => {
              const elapsed = (Date.now() - processStart) / 1000;
              const rate = completed / elapsed;
              const eta = Math.round((total - completed) / rate);

              if (result?.success) {
                if (result.wasUpdated) updated++;
                else processed++;
                if (result.cost?.total) totalCost += result.cost.total;

                // Track timing for batch summary
                if (result.timing) {
                  timingStats.times.push(result.timing.total);
                  timingStats.apiTimes.push(result.timing.api);
                  if (result.timing.total > 5000) timingStats.slowCount++;
                }
              } else if (result?.error) {
                errors++;
              }

              // Send progress update
              sendEvent('progress', {
                completed,
                total,
                percent: ((completed / total) * 100).toFixed(1),
                rate: rate.toFixed(1),
                eta,
                processed,
                updated,
                errors,
                cost: totalCost.toFixed(6),
                currentFile: img.fileName
              });
            },
            onError: (err, img) => {
              console.error(`[Upload-SSE] Error: ${img.fileName} - ${err.message}`);
              errors++;
            }
          }
        );
      }

      const totalTime = ((Date.now() - batchStart) / 1000).toFixed(1);

      // Log batch timing summary (replaces per-file "Slow" logs)
      if (timingStats.times.length > 0) {
        const avgTime = (timingStats.times.reduce((a, b) => a + b, 0) / timingStats.times.length / 1000).toFixed(2);
        const maxTime = (Math.max(...timingStats.times) / 1000).toFixed(2);
        const minTime = (Math.min(...timingStats.times) / 1000).toFixed(2);
        const avgApi = (timingStats.apiTimes.reduce((a, b) => a + b, 0) / timingStats.apiTimes.length / 1000).toFixed(2);
        console.log(`[Upload-SSE] Timing summary: avg=${avgTime}s, min=${minTime}s, max=${maxTime}s, avgAPI=${avgApi}s, slow(>5s)=${timingStats.slowCount}`);
      }

      // Send completion event
      sendEvent('complete', {
        success: true,
        totalImages: images.length,
        processed,
        updated,
        skipped: toSkip.length,
        rejected: invalidFilenames.length,
        errors,
        totalCost: totalCost.toFixed(6),
        totalTime: parseFloat(totalTime),
        rate: (images.length / parseFloat(totalTime)).toFixed(2)
      });

      console.log(`[Upload-SSE] Complete: ${images.length} images in ${totalTime}s`);

    } else {
      // Single image - quick process
      sendEvent('init', { total: 1, message: 'Processing single image...' });

      const result = await processSingleImage(
        fileBuffer,
        fileName,
        req.file.mimetype,
        modelId,
        settings,
        {}
      );

      if (result.rejected) {
        sendEvent('error', { message: result.error, rejected: true });
      } else if (result.duplicate) {
        sendEvent('complete', {
          success: true,
          totalImages: 1,
          processed: 0,
          skipped: 1,
          duplicate: true,
          message: 'This screenshot has already been analyzed'
        });
      } else {
        sendEvent('progress', {
          completed: 1,
          total: 1,
          percent: '100',
          cost: result.cost?.total?.toFixed(6) || '0'
        });
        sendEvent('complete', {
          success: true,
          totalImages: 1,
          processed: 1,
          totalCost: result.cost?.total?.toFixed(6) || '0'
        });
      }
    }

  } catch (error) {
    console.error('[Upload-SSE] Error:', error.message);
    sendEvent('error', { message: error.message || 'Unknown error during analysis' });
  }

  res.end();
});

module.exports = router;
