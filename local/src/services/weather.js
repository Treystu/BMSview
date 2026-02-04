/**
 * Weather Module - Fetches weather and solar data
 *
 * Re-exported from lib/weather.js for src/ module compatibility
 * NOTE: extractTimestampFromFilename from this module is DEPRECATED
 * Use TimeAuthority.extractStrictTimestamp instead
 */

const weather = require('../../lib/weather');

// Re-export everything except the deprecated function
module.exports = {
  getWeather: weather.getWeather,
  getSolarIrradiance: weather.getSolarIrradiance,
  getSolarOnly: weather.getSolarOnly,
  clearCaches: weather.clearCaches,
  getCacheStats: weather.getCacheStats,
  batchPreFetchWeather: weather.batchPreFetchWeather
  // NOTE: extractTimestampFromFilename is intentionally NOT exported
  // Use TimeAuthority.extractStrictTimestamp instead
};
