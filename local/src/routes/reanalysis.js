/**
 * Reanalysis Routes - Handle re-analysis of records with missing data
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  getRecordsNeedingReanalysis,
  flagRecordsForReanalysis,
  clearReanalysisFlag,
  updateRecord,
  getAllRecords
} = require('../services/csv-store');
const { getSettings } = require('../services/settings');
const { analyzeImage } = require('../services/analyzer');
const TimeAuthority = require('../services/TimeAuthority');

const router = express.Router();

// GET /api/reanalysis/status - Get reanalysis status
router.get('/reanalysis/status', (req, res) => {
  try {
    const needsReanalysis = getRecordsNeedingReanalysis();
    const all = getAllRecords();

    // Count by missing data type
    let missingTemps = 0;
    let missingMosTemp = 0;
    let missingCellVoltages = 0;

    needsReanalysis.forEach(r => {
      if (r.temperature_1 === null || r.temperature_1 === undefined || r.temperature_1 === '') {
        missingTemps++;
      }
      if (r.mosTemperature === null || r.mosTemperature === undefined || r.mosTemperature === '') {
        missingMosTemp++;
      }
      if (r.highestCellVoltage === null || r.highestCellVoltage === undefined || r.highestCellVoltage === 0) {
        missingCellVoltages++;
      }
    });

    res.json({
      total: all.length,
      needsReanalysis: needsReanalysis.length,
      breakdown: {
        missingTemperatures: missingTemps,
        missingMosTemperature: missingMosTemp,
        missingCellVoltages: missingCellVoltages
      },
      percentage: ((needsReanalysis.length / all.length) * 100).toFixed(1)
    });
  } catch (error) {
    console.error('[Reanalysis] Status error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reanalysis/flag - Flag records needing reanalysis
router.post('/reanalysis/flag', (req, res) => {
  try {
    const result = flagRecordsForReanalysis((phase, current, total, message) => {
      console.log(`[Reanalysis] ${message}`);
    });

    res.json({
      success: true,
      total: result.total,
      flagged: result.flagged,
      message: `Flagged ${result.flagged} records for re-analysis`
    });
  } catch (error) {
    console.error('[Reanalysis] Flag error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reanalysis/run - Run reanalysis on flagged records
router.post('/reanalysis/run', async (req, res) => {
  const settings = getSettings();

  if (!settings.geminiApiKey) {
    return res.status(400).json({ error: 'Gemini API key not configured' });
  }

  const records = getRecordsNeedingReanalysis();
  const limit = parseInt(req.body.limit) || 10; // Default to 10 at a time
  const toProcess = records.slice(0, limit);

  if (toProcess.length === 0) {
    return res.json({ success: true, message: 'No records need reanalysis', processed: 0 });
  }

  console.log(`[Reanalysis] Starting reanalysis of ${toProcess.length} records`);

  let processed = 0;
  let errors = 0;
  const results = [];

  for (const record of toProcess) {
    try {
      // Find the original image file
      // Try multiple possible locations for screenshots
      const possibleDirs = [
        settings.screenshotsDir,
        './Screenshots',  // Capital S (macOS default)
        './screenshots',  // Lowercase
        './uploads'
      ].filter(Boolean);

      let imagePath = null;
      for (const dir of possibleDirs) {
        const testPath = path.join(dir, record.fileName);
        if (fs.existsSync(testPath)) {
          imagePath = testPath;
          break;
        }
      }

      if (!imagePath) {
        imagePath = path.join(possibleDirs[0] || './Screenshots', record.fileName);
      }

      if (!fs.existsSync(imagePath)) {
        console.warn(`[Reanalysis] Image not found: ${imagePath}`);
        results.push({ id: record.id, success: false, error: 'Image file not found' });
        errors++;
        continue;
      }

      // Read and encode image
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const ext = path.extname(record.fileName).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

      // Get timestamp from filename
      const timestamp = TimeAuthority.extractStrictTimestamp(record.fileName);

      // Analyze with improved prompt
      const analysisResult = await analyzeImage(
        base64Image,
        mimeType,
        settings.geminiApiKey,
        settings.geminiModel || 'gemini-2.0-flash',
        timestamp
      );

      // Build updates - only update fields that were missing
      const updates = {};

      // Update temperatures if previously missing
      if (analysisResult.temperatures && Array.isArray(analysisResult.temperatures)) {
        if ((record.temperature_1 === null || record.temperature_1 === undefined) && analysisResult.temperatures[0] !== undefined) {
          updates.temperature_1 = analysisResult.temperatures[0];
        }
        if ((record.temperature_2 === null || record.temperature_2 === undefined) && analysisResult.temperatures[1] !== undefined) {
          updates.temperature_2 = analysisResult.temperatures[1];
        }
        if ((record.temperature_3 === null || record.temperature_3 === undefined) && analysisResult.temperatures[2] !== undefined) {
          updates.temperature_3 = analysisResult.temperatures[2];
        }
        if ((record.temperature_4 === null || record.temperature_4 === undefined) && analysisResult.temperatures[3] !== undefined) {
          updates.temperature_4 = analysisResult.temperatures[3];
        }
      }

      // Update MOS temperature if previously missing
      if ((record.mosTemperature === null || record.mosTemperature === undefined) && analysisResult.mosTemperature !== undefined) {
        updates.mosTemperature = analysisResult.mosTemperature;
      }

      // Update cell voltages if previously missing
      if ((record.highestCellVoltage === null || record.highestCellVoltage === 0) && analysisResult.highestCellVoltage) {
        updates.highestCellVoltage = analysisResult.highestCellVoltage;
      }
      if ((record.lowestCellVoltage === null || record.lowestCellVoltage === 0) && analysisResult.lowestCellVoltage) {
        updates.lowestCellVoltage = analysisResult.lowestCellVoltage;
      }
      if ((record.averageCellVoltage === null || record.averageCellVoltage === 0) && analysisResult.averageCellVoltage) {
        updates.averageCellVoltage = analysisResult.averageCellVoltage;
      }

      // Clear flag and apply updates
      updates.needs_reanalysis = false;

      if (Object.keys(updates).length > 1) { // More than just needs_reanalysis
        updateRecord(record.id, updates);
        processed++;
        results.push({
          id: record.id,
          success: true,
          updates: Object.keys(updates).filter(k => k !== 'needs_reanalysis')
        });
        console.log(`[Reanalysis] Updated ${record.fileName}: ${Object.keys(updates).join(', ')}`);
      } else {
        // Just clear the flag
        updateRecord(record.id, { needs_reanalysis: false });
        results.push({ id: record.id, success: true, updates: ['flag_cleared'] });
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err) {
      console.error(`[Reanalysis] Error processing ${record.fileName}:`, err.message);
      results.push({ id: record.id, success: false, error: err.message });
      errors++;
    }
  }

  res.json({
    success: true,
    processed,
    errors,
    remaining: records.length - toProcess.length,
    results
  });
});

// GET /api/reanalysis/records - Get list of records needing reanalysis
router.get('/reanalysis/records', (req, res) => {
  try {
    const records = getRecordsNeedingReanalysis();
    const limit = parseInt(req.query.limit) || 50;

    res.json({
      total: records.length,
      records: records.slice(0, limit).map(r => ({
        id: r.id,
        fileName: r.fileName,
        timestampFromFilename: r.timestampFromFilename,
        temperature_1: r.temperature_1,
        mosTemperature: r.mosTemperature,
        highestCellVoltage: r.highestCellVoltage
      }))
    });
  } catch (error) {
    console.error('[Reanalysis] Records error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
