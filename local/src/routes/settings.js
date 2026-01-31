/**
 * Settings Routes - API key and configuration management
 */

const express = require('express');
const { getSettings, saveSettings } = require('../services/settings');
const { DEFAULT_MODEL } = require('../services/analyzer');

const router = express.Router();

// GET /api/settings - Get settings (status only, not actual keys)
router.get('/settings', (req, res) => {
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

// POST /api/settings - Update settings
router.post('/settings', (req, res) => {
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

// DELETE /api/settings/:key - Delete specific key
router.delete('/settings/:key', (req, res) => {
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

module.exports = router;
