/**
 * Settings management - stores API keys and configuration locally
 */

const fs = require('fs');
const path = require('path');

// Get the settings file path (in app directory or user home)
function getSettingsPath() {
  // If running as pkg executable, use home directory
  if (process.pkg) {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const configDir = path.join(homeDir, '.bms-analyzer');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return path.join(configDir, 'settings.json');
  }

  // Development mode - use local directory
  return path.join(__dirname, '..', 'settings.json');
}

// Default settings
const DEFAULT_SETTINGS = {
  geminiApiKey: '',
  weatherApiKey: '',
  latitude: 19.442831,  // Big Island, Hawaii
  longitude: -154.943977,
  outputDir: './output',
  batchConcurrency: 10,  // Parallel API calls (10 is safe for Gemini rate limits)
  imageCompression: true,  // Compress images before sending to API
  maxImageWidth: 1280,  // Max width for compressed images
  imageQuality: 85,  // JPEG quality (0-100)
  screenshotsDir: './Screenshots'
};

/**
 * Load settings from file
 */
function getSettings() {
  const settingsPath = getSettingsPath();

  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(data);
      return { ...DEFAULT_SETTINGS, ...settings };
    }
  } catch (error) {
    console.error('Error loading settings:', error.message);
  }

  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to file
 */
function saveSettings(settings) {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

module.exports = {
  getSettings,
  saveSettings,
  getSettingsPath,
  DEFAULT_SETTINGS
};
