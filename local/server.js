#!/usr/bin/env node
/**
 * BMS Analyzer Local - Simplified local BMS screenshot analyzer
 * Extracts battery data from screenshots using Gemini AI and stores in CSV
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Import our modules
const { analyzeImage, getAvailableModels, estimateCost, DEFAULT_MODEL } = require('./lib/analyzer');
const {
  loadData,
  saveRecord,
  updateRecord,
  updateRecords,
  getAllRecords,
  isDuplicate,
  getRecordByHash,
  getRecordsMissingWeather,
  reloadData,
  checkMigrationNeeded,
  performMigration,
  repairAllData,
  repairCycleCountData,
  repairPhysicsViolations
} = require('./lib/csv-store');
const { getWeather, getSolarOnly, extractTimestampFromFilename } = require('./lib/weather');
const { getSettings, saveSettings, getSettingsPath } = require('./lib/settings');
const { extractImagesFromZip, isZipFile, isImageFile, getMimeType } = require('./lib/zip-extractor');

const app = express();
const PORT = process.env.PORT || 3847;
const DEBUG = process.env.DEBUG === 'true' || true; // Enable debug logging

// Debug logging helper
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data) {
    console.log(`${prefix} ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// Request logging middleware
app.use((req, res, next) => {
  if (DEBUG && req.path.startsWith('/api')) {
    log('info', `${req.method} ${req.path}`);
  }
  next();
});

// Configure multer for file uploads - 10GB limit for local use
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024,  // 10GB limit
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

// Multer error handler middleware
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    log('error', 'Multer error', { code: err.code, field: err.field, message: err.message });
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  } else if (err) {
    log('error', 'Upload error', { message: err.message });
    return res.status(400).json({ error: err.message });
  }
  next();
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Get available models
app.get('/api/models', (req, res) => {
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

// API: Get cost estimate for a model
app.get('/api/estimate/:modelId', (req, res) => {
  try {
    const { modelId } = req.params;
    const count = parseInt(req.query.count) || 1;

    const estimate = estimateCost(modelId);

    // Multiply for batch estimates
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

// API: Get settings (API keys status, not the actual keys)
app.get('/api/settings', (req, res) => {
  try {
    const settings = getSettings();
    res.json({
      hasGeminiKey: !!settings.geminiApiKey,
      hasWeatherKey: !!settings.weatherApiKey,
      latitude: settings.latitude || 19.442831,
      longitude: settings.longitude || -154.943977,
      outputDir: settings.outputDir || './output',
      selectedModel: settings.selectedModel || DEFAULT_MODEL
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Update settings
app.post('/api/settings', (req, res) => {
  try {
    const { geminiApiKey, weatherApiKey, latitude, longitude, outputDir, selectedModel } = req.body;
    const currentSettings = getSettings();

    const newSettings = {
      ...currentSettings,
      geminiApiKey: geminiApiKey !== undefined ? geminiApiKey : currentSettings.geminiApiKey,
      weatherApiKey: weatherApiKey !== undefined ? weatherApiKey : currentSettings.weatherApiKey,
      latitude: latitude !== undefined ? latitude : currentSettings.latitude,
      longitude: longitude !== undefined ? longitude : currentSettings.longitude,
      outputDir: outputDir !== undefined ? outputDir : currentSettings.outputDir,
      selectedModel: selectedModel !== undefined ? selectedModel : currentSettings.selectedModel
    };

    saveSettings(newSettings);

    res.json({
      success: true,
      hasGeminiKey: !!newSettings.geminiApiKey,
      hasWeatherKey: !!newSettings.weatherApiKey,
      selectedModel: newSettings.selectedModel
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Delete a specific API key
app.delete('/api/settings/:key', (req, res) => {
  try {
    const { key } = req.params;
    const currentSettings = getSettings();

    if (key === 'gemini') {
      currentSettings.geminiApiKey = '';
    } else if (key === 'weather') {
      currentSettings.weatherApiKey = '';
    } else {
      return res.status(400).json({ error: 'Invalid key type' });
    }

    saveSettings(currentSettings);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Analyze a screenshot or ZIP file
app.post('/api/analyze', upload.single('image'), handleMulterError, async (req, res) => {
  log('info', 'Analyze request received');

  try {
    const settings = getSettings();
    log('debug', 'Settings loaded', {
      hasGeminiKey: !!settings.geminiApiKey,
      hasWeatherKey: !!settings.weatherApiKey,
      lat: settings.latitude,
      lon: settings.longitude,
      model: settings.selectedModel
    });

    if (!settings.geminiApiKey) {
      log('warn', 'Gemini API key not configured');
      return res.status(400).json({
        error: 'Gemini API key not configured. Please add it in Settings.'
      });
    }

    if (!req.file) {
      log('warn', 'No file provided in request');
      return res.status(400).json({ error: 'No file provided' });
    }

    const modelId = req.body.model || settings.selectedModel || DEFAULT_MODEL;
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;

    log('info', `Processing file: ${fileName}`, {
      size: fileBuffer.length,
      mimeType: req.file.mimetype,
      model: modelId
    });

    // Check if it's a ZIP file
    if (isZipFile(fileBuffer) || fileName.toLowerCase().endsWith('.zip')) {
      // Process ZIP file
      const images = extractImagesFromZip(fileBuffer);

      if (images.length === 0) {
        return res.status(400).json({ error: 'No images found in ZIP file' });
      }

      console.log(`[${new Date().toISOString()}] Processing ZIP with ${images.length} images`);

      const results = [];
      let totalCost = 0;
      let duplicates = 0;
      let processed = 0;

      for (const image of images) {
        const contentHash = crypto.createHash('sha256').update(image.buffer).digest('hex');

        // Check for duplicate
        const existingRecord = getRecordByHash(contentHash);
        if (existingRecord) {
          results.push({
            fileName: image.fileName,
            duplicate: true,
            record: existingRecord
          });
          duplicates++;
          continue;
        }

        try {
          // Analyze the image
          const base64Image = image.buffer.toString('base64');
          const analysis = await analyzeImage(base64Image, image.mimeType, settings.geminiApiKey, modelId);

          // Track cost
          if (analysis._meta?.cost?.total) {
            totalCost += analysis._meta.cost.total;
          }

          // Extract timestamp from filename for accurate time-based data
          const fileTimestamp = extractTimestampFromFilename(image.fileName);
          const effectiveTimestamp = fileTimestamp || new Date();

          // Get weather + solar data (or solar only if no weather key)
          let weather = null;
          if (settings.latitude && settings.longitude) {
            try {
              if (settings.weatherApiKey) {
                weather = await getWeather(
                  settings.latitude,
                  settings.longitude,
                  settings.weatherApiKey,
                  effectiveTimestamp
                );
              } else {
                // Get solar data even without weather API key
                weather = await getSolarOnly(
                  settings.latitude,
                  settings.longitude,
                  effectiveTimestamp
                );
              }
            } catch (weatherError) {
              console.warn('Weather/Solar fetch failed:', weatherError.message);
            }
          }

          // Create the record
          const record = {
            id: uuidv4(),
            contentHash,
            fileName: image.fileName,
            timestamp: new Date().toISOString(),
            timestampFromFilename: fileTimestamp ? fileTimestamp.toISOString() : null,
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

          // Remove _meta from record (keep it separate)
          delete record._meta;

          // Save to CSV
          saveRecord(record);
          processed++;

          results.push({
            fileName: image.fileName,
            success: true,
            record
          });

          console.log(`[${new Date().toISOString()}] Saved: ${record.id} (${image.fileName})`);

        } catch (analysisError) {
          results.push({
            fileName: image.fileName,
            error: analysisError.message
          });
        }
      }

      res.json({
        success: true,
        isZip: true,
        totalImages: images.length,
        processed,
        duplicates,
        errors: results.filter(r => r.error).length,
        totalCost: {
          amount: totalCost,
          formatted: `$${totalCost.toFixed(6)}`
        },
        results
      });

    } else {
      // Process single image
      log('info', 'Processing single image');
      const mimeType = req.file.mimetype;

      // Calculate hash for deduplication
      const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      log('debug', `Content hash: ${contentHash.substring(0, 16)}...`);

      // Check for duplicate
      const existingRecord = getRecordByHash(contentHash);
      if (existingRecord) {
        log('info', 'Duplicate detected, returning existing record');
        return res.json({
          duplicate: true,
          record: existingRecord,
          message: 'This screenshot has already been analyzed'
        });
      }

      // Convert to base64
      const base64Image = fileBuffer.toString('base64');
      log('debug', `Base64 image size: ${base64Image.length} chars`);

      // Analyze the image
      log('info', `Calling Gemini API with model: ${modelId}`);
      const analysis = await analyzeImage(base64Image, mimeType, settings.geminiApiKey, modelId);
      log('info', 'Gemini analysis complete', {
        systemId: analysis.hardwareSystemId,
        soc: analysis.stateOfCharge,
        voltage: analysis.overallVoltage,
        status: analysis.status
      });

      // Extract timestamp from filename for accurate time-based data
      const fileTimestamp = extractTimestampFromFilename(fileName);
      const effectiveTimestamp = fileTimestamp || new Date();
      log('debug', 'Timestamp extraction', {
        fileName,
        extractedTimestamp: fileTimestamp ? fileTimestamp.toISOString() : null,
        effectiveTimestamp: effectiveTimestamp.toISOString()
      });

      // Get weather + solar data (or solar only if no weather key)
      let weather = null;
      if (settings.latitude && settings.longitude) {
        log('debug', `Fetching weather/solar data for ${settings.latitude}, ${settings.longitude}`);
        try {
          if (settings.weatherApiKey) {
            log('debug', 'Using full weather + solar fetch');
            weather = await getWeather(
              settings.latitude,
              settings.longitude,
              settings.weatherApiKey,
              effectiveTimestamp
            );
          } else {
            // Get solar data even without weather API key
            log('debug', 'Using solar-only fetch (no weather API key)');
            weather = await getSolarOnly(
              settings.latitude,
              settings.longitude,
              effectiveTimestamp
            );
          }
          log('info', 'Weather/Solar data received', weather);
        } catch (weatherError) {
          log('warn', 'Weather/Solar fetch failed', weatherError.message);
        }
      } else {
        log('debug', 'No location configured, skipping weather/solar');
      }

      // Create the record
      const record = {
        id: uuidv4(),
        contentHash,
        fileName,
        timestamp: new Date().toISOString(),
        timestampFromFilename: fileTimestamp ? fileTimestamp.toISOString() : null,
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

      // Extract cost info before removing _meta
      const costInfo = analysis._meta?.cost;
      log('debug', 'Cost info', costInfo);

      // Remove _meta from record
      delete record._meta;

      // Save to CSV
      log('info', `Saving record: ${record.id}`);
      saveRecord(record);
      log('info', 'Record saved successfully');

      const response = {
        success: true,
        record,
        cost: costInfo,
        message: 'Analysis complete'
      };

      log('debug', 'Sending response', { recordId: record.id, cost: costInfo?.formatted });
      res.json(response);
    }

  } catch (error) {
    log('error', 'Analysis error', { message: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Unknown error during analysis' });
  }
});

// API: Check if image is a duplicate (pre-upload check)
app.post('/api/check-duplicate', upload.single('image'), handleMulterError, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const contentHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const existingRecord = getRecordByHash(contentHash);

    res.json({
      isDuplicate: !!existingRecord,
      existingRecord: existingRecord || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get all history records
app.get('/api/history', (req, res) => {
  try {
    const records = getAllRecords();
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Backfill missing weather/solar data
app.post('/api/backfill-weather', async (req, res) => {
  log('info', 'Backfill weather request received');

  try {
    const settings = getSettings();

    if (!settings.latitude || !settings.longitude) {
      return res.status(400).json({
        error: 'Location not configured. Please set latitude/longitude in Settings.'
      });
    }

    // Get records missing solar data
    const recordsToUpdate = getRecordsMissingWeather();
    log('info', `Found ${recordsToUpdate.length} records missing weather/solar data`);

    if (recordsToUpdate.length === 0) {
      return res.json({
        success: true,
        message: 'All records already have weather/solar data',
        updated: 0
      });
    }

    const updates = [];
    let successCount = 0;
    let errorCount = 0;

    for (const record of recordsToUpdate) {
      try {
        // Determine timestamp to use for weather lookup
        const timestamp = record.timestampFromFilename || record.timestamp;
        const effectiveTime = timestamp ? new Date(timestamp) : new Date();

        // Fetch weather/solar data
        let weather = null;
        if (settings.weatherApiKey) {
          weather = await getWeather(
            settings.latitude,
            settings.longitude,
            settings.weatherApiKey,
            effectiveTime
          );
        } else {
          weather = await getSolarOnly(
            settings.latitude,
            settings.longitude,
            effectiveTime
          );
        }

        if (weather) {
          updates.push({
            id: record.id,
            updates: {
              weather_temp: weather.temp ?? null,
              weather_clouds: weather.clouds ?? null,
              weather_uvi: weather.uvi ?? null,
              weather_condition: weather.weather_main ?? null,
              solar_ghi: weather.solar_ghi ?? null,
              solar_dni: weather.solar_dni ?? null,
              solar_dhi: weather.solar_dhi ?? null,
              solar_direct: weather.solar_direct ?? null
            }
          });
          successCount++;
        }

        // Rate limit to avoid API throttling
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err) {
        log('warn', `Failed to fetch weather for record ${record.id}:`, err.message);
        errorCount++;
      }
    }

    // Apply all updates
    if (updates.length > 0) {
      const updatedCount = updateRecords(updates);
      log('info', `Updated ${updatedCount} records with weather/solar data`);
    }

    res.json({
      success: true,
      message: `Backfill complete`,
      total: recordsToUpdate.length,
      updated: successCount,
      errors: errorCount
    });

  } catch (error) {
    log('error', 'Backfill error', { message: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// API: Export CSV download
app.get('/api/export', (req, res) => {
  try {
    const settings = getSettings();
    const csvPath = path.join(settings.outputDir || './output', 'bms-data.csv');

    if (!fs.existsSync(csvPath)) {
      return res.status(404).json({ error: 'No data file exists yet' });
    }

    res.download(csvPath, 'bms-data.csv');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get CSV file path
app.get('/api/csv-path', (req, res) => {
  try {
    const settings = getSettings();
    const csvPath = path.resolve(settings.outputDir || './output', 'bms-data.csv');
    res.json({ path: csvPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// BACKGROUND REFRESH SYSTEM WITH SSE (Server-Sent Events)
// ============================================================

// Store for active SSE connections
const sseClients = new Set();

// Broadcast to all SSE clients
function broadcastSSE(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

// SSE endpoint for real-time updates
app.get('/api/refresh-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  sseClients.add(res);
  log('info', `SSE client connected. Total clients: ${sseClients.size}`);

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
    log('info', `SSE client disconnected. Total clients: ${sseClients.size}`);
  });
});

// Background refresh state
let refreshInProgress = false;
let refreshAborted = false;

// API: Start background refresh (non-blocking)
app.post('/api/refresh-start', async (req, res) => {
  if (refreshInProgress) {
    return res.json({ success: false, message: 'Refresh already in progress' });
  }

  refreshInProgress = true;
  refreshAborted = false;

  // Respond immediately
  res.json({ success: true, message: 'Refresh started' });

  // Run refresh in background
  runBackgroundRefresh().finally(() => {
    refreshInProgress = false;
  });
});

// API: Abort refresh
app.post('/api/refresh-abort', (req, res) => {
  if (!refreshInProgress) {
    return res.json({ success: false, message: 'No refresh in progress' });
  }
  refreshAborted = true;
  res.json({ success: true, message: 'Refresh abort requested' });
});

// API: Get refresh status
app.get('/api/refresh-status', (req, res) => {
  res.json({ inProgress: refreshInProgress });
});

// Background refresh function
async function runBackgroundRefresh() {
  console.log('[Refresh] ========== STARTING BACKGROUND REFRESH ==========');
  const settings = getSettings();
  const phases = [];
  let allRecords = [];

  try {
    // Phase 1: Validate and Repair Data
    console.log('[Refresh] Phase 1: Starting validation and repair...');
    broadcastSSE('phase', { phase: 'migration', status: 'running', message: 'Validating and repairing data...' });

    const repairResult = repairAllData((phase, current, total, message) => {
      broadcastSSE('progress', { phase: 'migration', current, total, message });
    });
    console.log('[Refresh] repairAllData complete:', repairResult);

    // Also repair cycle count data (0 → null)
    console.log('[Refresh] Starting cycle count repair...');
    const cycleRepair = repairCycleCountData();
    console.log('[Refresh] Cycle repair result:', cycleRepair);
    if (cycleRepair.fixed > 0) {
      console.log(`[Refresh] Fixed ${cycleRepair.fixed} cycle count values (0 → null)`);
      broadcastSSE('phase', {
        phase: 'cycle-repair',
        status: 'complete',
        message: `Fixed ${cycleRepair.fixed} cycle counts (0 → null)`
      });
    }

    // Repair physics violations (V=0 or I=0 with P>0, SOC=0 with high cell voltage)
    console.log('[Refresh] Starting physics violations repair...');
    const physicsRepair = repairPhysicsViolations();
    console.log('[Refresh] Physics repair result:', physicsRepair);
    if (physicsRepair.totalFixed > 0) {
      console.log(`[Refresh] Fixed ${physicsRepair.totalFixed} physics violations (V=${physicsRepair.voltageFixed}, I=${physicsRepair.currentFixed}, SOC=${physicsRepair.socFixed})`);
      broadcastSSE('phase', {
        phase: 'physics-repair',
        status: 'complete',
        message: `Fixed ${physicsRepair.totalFixed} physics violations`
      });
    }

    const totalRepaired = repairResult.repaired + cycleRepair.fixed + physicsRepair.totalFixed;
    if (totalRepaired > 0) {
      broadcastSSE('phase', {
        phase: 'migration',
        status: 'complete',
        message: `Repaired ${totalRepaired} records (${repairResult.repaired} data, ${cycleRepair.fixed} cycles)`
      });
      phases.push({
        phase: 'migration',
        success: true,
        total: repairResult.total,
        repaired: repairResult.repaired,
        cyclesFixed: cycleRepair.fixed,
        valid: repairResult.valid
      });
    } else {
      broadcastSSE('phase', {
        phase: 'migration',
        status: 'complete',
        message: `All ${repairResult.total} records valid`
      });
      phases.push({ phase: 'migration', success: true, skipped: true, total: repairResult.total });
    }

    if (refreshAborted) {
      broadcastSSE('complete', { success: false, aborted: true, phases });
      return;
    }

    // Phase 2: Reload data and send to UI
    broadcastSSE('phase', { phase: 'reload', status: 'running', message: 'Reloading data...' });
    reloadData();
    allRecords = getAllRecords();
    broadcastSSE('phase', { phase: 'reload', status: 'complete', message: `Loaded ${allRecords.length} records` });
    phases.push({ phase: 'reload', success: true, count: allRecords.length });

    // Send current records to UI immediately
    broadcastSSE('records', { records: allRecords });

    if (refreshAborted) {
      broadcastSSE('complete', { success: false, aborted: true, phases });
      return;
    }

    // Phase 3: Weather/Solar backfill
    if (settings.latitude && settings.longitude) {
      const recordsNeedingWeather = getRecordsMissingWeather();

      if (recordsNeedingWeather.length > 0) {
        broadcastSSE('phase', {
          phase: 'weather',
          status: 'running',
          message: `Fetching weather for ${recordsNeedingWeather.length} records...`,
          total: recordsNeedingWeather.length
        });

        let updated = 0;
        let errors = 0;

        for (let i = 0; i < recordsNeedingWeather.length; i++) {
          if (refreshAborted) break;

          const record = recordsNeedingWeather[i];

          try {
            const timestamp = record.timestampFromFilename || record.timestamp;
            const effectiveTime = timestamp ? new Date(timestamp) : new Date();

            let weather = null;
            if (settings.weatherApiKey) {
              weather = await getWeather(settings.latitude, settings.longitude, settings.weatherApiKey, effectiveTime);
            } else {
              weather = await getSolarOnly(settings.latitude, settings.longitude, effectiveTime);
            }

            if (weather) {
              const updates = {
                weather_temp: weather.temp ?? null,
                weather_clouds: weather.clouds ?? null,
                weather_uvi: weather.uvi ?? null,
                weather_condition: weather.weather_main ?? null,
                solar_ghi: weather.solar_ghi ?? null,
                solar_dni: weather.solar_dni ?? null,
                solar_dhi: weather.solar_dhi ?? null,
                solar_direct: weather.solar_direct ?? null
              };

              updateRecord(record.id, updates);
              updated++;

              // Send updated record to UI immediately for real-time update
              const updatedRecord = { ...record, ...updates };
              broadcastSSE('record-update', { record: updatedRecord });
            }
          } catch (err) {
            errors++;
            log('warn', `Weather fetch failed for ${record.id}: ${err.message}`);
          }

          // Progress update every record
          broadcastSSE('progress', {
            phase: 'weather',
            current: i + 1,
            total: recordsNeedingWeather.length,
            message: `Processing ${i + 1}/${recordsNeedingWeather.length}`,
            updated,
            errors
          });

          // Rate limit - but keep it fast enough for real-time feel
          await new Promise(resolve => setTimeout(resolve, 30));
        }

        broadcastSSE('phase', {
          phase: 'weather',
          status: refreshAborted ? 'aborted' : 'complete',
          message: `Updated ${updated} records, ${errors} errors`,
          updated,
          errors
        });
        phases.push({ phase: 'weather', success: true, updated, errors });
      } else {
        broadcastSSE('phase', { phase: 'weather', status: 'skipped', message: 'All records have weather data' });
        phases.push({ phase: 'weather', success: true, skipped: true });
      }
    } else {
      broadcastSSE('phase', { phase: 'weather', status: 'skipped', message: 'Location not configured' });
      phases.push({ phase: 'weather', success: true, skipped: true, reason: 'no_location' });
    }

    // Complete - include summary for UI
    const summary = {
      totalRecords: allRecords.length,
      repaired: phases.find(p => p.phase === 'migration')?.repaired || 0,
      weatherUpdated: phases.find(p => p.phase === 'weather')?.updated || 0
    };

    broadcastSSE('complete', {
      success: !refreshAborted,
      aborted: refreshAborted,
      phases,
      summary,
      message: refreshAborted ? 'Refresh aborted' : 'Refresh complete'
    });

  } catch (error) {
    console.error('[Refresh] ========== ERROR ==========');
    console.error('[Refresh] Error:', error.message);
    console.error('[Refresh] Stack:', error.stack);
    log('error', 'Background refresh error', { message: error.message, stack: error.stack });
    broadcastSSE('error', { error: error.message, phases });
  }
}

// Global error handler - ensures JSON responses for all errors
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  BMS Analyzer Local v1.1                     ║
╠══════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                   ║
║                                                              ║
║  Features:                                                   ║
║  • Upload BMS screenshots or ZIP files                       ║
║  • Model selection with cost estimation                      ║
║  • Automatic duplicate detection (hash-based)                ║
║  • Weather data enrichment                                   ║
║  • CSV output with all extracted fields                      ║
║                                                              ║
║  Default model: ${DEFAULT_MODEL.padEnd(24)}            ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Try to open browser (only in development, not in pkg)
  if (!process.pkg) {
    try {
      const open = (await import('open')).default;
      await open(`http://localhost:${PORT}`);
    } catch (e) {
      // Ignore if open fails
    }
  }
});
