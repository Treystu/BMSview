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
  getAllRecords,
  isDuplicate,
  getRecordByHash
} = require('./lib/csv-store');
const { getWeather } = require('./lib/weather');
const { getSettings, saveSettings, getSettingsPath } = require('./lib/settings');
const { extractImagesFromZip, isZipFile, isImageFile, getMimeType } = require('./lib/zip-extractor');

const app = express();
const PORT = process.env.PORT || 3847;

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for ZIPs
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
app.post('/api/analyze', upload.single('image'), async (req, res) => {
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
    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;

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

          // Get weather data if configured
          let weather = null;
          if (settings.weatherApiKey && settings.latitude && settings.longitude) {
            try {
              weather = await getWeather(
                settings.latitude,
                settings.longitude,
                settings.weatherApiKey
              );
            } catch (weatherError) {
              console.warn('Weather fetch failed:', weatherError.message);
            }
          }

          // Create the record
          const record = {
            id: uuidv4(),
            contentHash,
            fileName: image.fileName,
            timestamp: new Date().toISOString(),
            ...analysis,
            weather_temp: weather?.temp || null,
            weather_clouds: weather?.clouds || null,
            weather_uvi: weather?.uvi || null,
            weather_condition: weather?.weather_main || null,
            model_used: modelId,
            cost_usd: analysis._meta?.cost?.total || null
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
      const mimeType = req.file.mimetype;

      // Calculate hash for deduplication
      const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Check for duplicate
      const existingRecord = getRecordByHash(contentHash);
      if (existingRecord) {
        return res.json({
          duplicate: true,
          record: existingRecord,
          message: 'This screenshot has already been analyzed'
        });
      }

      // Convert to base64
      const base64Image = fileBuffer.toString('base64');

      // Analyze the image
      console.log(`[${new Date().toISOString()}] Analyzing: ${fileName} with ${modelId}`);
      const analysis = await analyzeImage(base64Image, mimeType, settings.geminiApiKey, modelId);

      // Get weather data if configured
      let weather = null;
      if (settings.weatherApiKey && settings.latitude && settings.longitude) {
        try {
          weather = await getWeather(
            settings.latitude,
            settings.longitude,
            settings.weatherApiKey
          );
        } catch (weatherError) {
          console.warn('Weather fetch failed:', weatherError.message);
        }
      }

      // Create the record
      const record = {
        id: uuidv4(),
        contentHash,
        fileName,
        timestamp: new Date().toISOString(),
        ...analysis,
        weather_temp: weather?.temp || null,
        weather_clouds: weather?.clouds || null,
        weather_uvi: weather?.uvi || null,
        weather_condition: weather?.weather_main || null,
        model_used: modelId,
        cost_usd: analysis._meta?.cost?.total || null
      };

      // Extract cost info before removing _meta
      const costInfo = analysis._meta?.cost;

      // Remove _meta from record
      delete record._meta;

      // Save to CSV
      saveRecord(record);

      console.log(`[${new Date().toISOString()}] Saved: ${record.id}`);

      res.json({
        success: true,
        record,
        cost: costInfo,
        message: 'Analysis complete'
      });
    }

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Check if image is a duplicate (pre-upload check)
app.post('/api/check-duplicate', upload.single('image'), (req, res) => {
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
