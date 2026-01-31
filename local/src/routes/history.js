/**
 * History Routes - Data retrieval and export
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const { getAllRecords, getCsvPath } = require('../services/csv-store');
const { getSettings } = require('../services/settings');

const router = express.Router();

// GET /api/history - Get all records
router.get('/history', (req, res) => {
  try {
    const records = getAllRecords();
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/export - Download CSV
router.get('/export', (req, res) => {
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

// GET /api/csv-path - Get CSV file path
router.get('/csv-path', (req, res) => {
  try {
    const settings = getSettings();
    const csvPath = path.resolve(settings.outputDir || './output', 'bms-data.csv');
    res.json({ path: csvPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
