/**
 * Weather Module - Fetches weather and solar data
 *
 * Weather: OpenWeatherMap (requires API key)
 * - Current weather via One Call API 3.0
 * - Historical weather via History API (for past dates)
 *
 * Solar: Open-Meteo (free, no API key)
 * - Historical solar data via Archive API
 * - Forecast solar data via Forecast API
 *
 * IMPORTANT: Each unique timestamp gets its own data - no incorrect caching
 */

const OPENWEATHER_ONECALL_URL = 'https://api.openweathermap.org/data/3.0/onecall';
const OPENWEATHER_HISTORY_URL = 'https://api.openweathermap.org/data/3.0/onecall/timemachine';
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Cache for weather/solar data - keyed by exact timestamp (to the hour)
const dataCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min TTL for in-memory cache

/**
 * Generate cache key for a given location and time
 * Uses ISO date-hour format for uniqueness
 */
function getCacheKey(lat, lon, timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  // Format: lat,lon,YYYY-MM-DD-HH
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}`;
  return `${lat.toFixed(4)},${lon.toFixed(4)},${dateKey}`;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(entry) {
  if (!entry) return false;
  return (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

/**
 * Check if a date is in the past (more than 5 days ago - requires archive API)
 */
function isHistoricalDate(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  return date < fiveDaysAgo;
}

/**
 * Check if a date is recent (within last 5 days - can use forecast API)
 */
function isRecentDate(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  return date >= fiveDaysAgo;
}

/**
 * Fetch solar irradiance from Open-Meteo
 * Uses Archive API for historical data, Forecast API for recent/current data
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Date} timestamp - Target timestamp
 * @returns {Promise<object>} Solar data {ghi, dni, dhi, direct}
 */
async function getSolarIrradiance(lat, lon, timestamp = null) {
  const targetTime = timestamp ? new Date(timestamp) : new Date();
  const dateStr = targetTime.toISOString().split('T')[0];
  const targetHour = targetTime.getHours();

  // Determine which API to use based on date
  const useArchive = isHistoricalDate(targetTime);
  const baseUrl = useArchive ? OPEN_METEO_ARCHIVE_URL : OPEN_METEO_FORECAST_URL;

  const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=shortwave_radiation,direct_radiation,diffuse_radiation,direct_normal_irradiance&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;

  try {
    console.log(`[Solar] Fetching from Open-Meteo ${useArchive ? 'Archive' : 'Forecast'} for ${dateStr} hour ${targetHour}`);
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[Solar] API error ${response.status}: ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();

    if (!data.hourly || !data.hourly.shortwave_radiation) {
      console.warn('[Solar] No hourly data in response');
      return null;
    }

    // Find the correct hour index
    let hourIndex = targetHour;
    if (hourIndex >= data.hourly.time.length) {
      hourIndex = data.hourly.time.length - 1;
    }

    const result = {
      ghi: data.hourly.shortwave_radiation[hourIndex] || 0,
      dni: data.hourly.direct_normal_irradiance[hourIndex] || 0,
      dhi: data.hourly.diffuse_radiation[hourIndex] || 0,
      direct: data.hourly.direct_radiation[hourIndex] || 0,
      hour: targetHour,
      date: dateStr
    };

    console.log(`[Solar] Got data for ${dateStr} ${targetHour}:00 - GHI=${result.ghi}, DNI=${result.dni}`);
    return result;
  } catch (error) {
    console.warn('[Solar] Fetch failed:', error.message);
    return null;
  }
}

/**
 * Fetch historical weather from OpenWeatherMap Time Machine API
 * NOTE: Requires One Call API 3.0 subscription (free tier: 1000 calls/day)
 * Subscribe at: https://openweathermap.org/api/one-call-3
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} apiKey - API key
 * @param {Date} timestamp - Historical timestamp
 * @returns {Promise<object>} Weather data
 */
async function getHistoricalWeather(lat, lon, apiKey, timestamp) {
  const unixTime = Math.floor(new Date(timestamp).getTime() / 1000);
  const url = `${OPENWEATHER_HISTORY_URL}?lat=${lat}&lon=${lon}&dt=${unixTime}&units=metric&appid=${apiKey}`;

  try {
    console.log(`[Weather] Fetching historical weather for ${new Date(timestamp).toISOString()} (unix: ${unixTime})`);
    const response = await fetch(url);

    if (!response.ok) {
      let errorMessage = `Weather API error: ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.message) {
          errorMessage = errorBody.message;
        }
      } catch (e) {}
      // If 401/403, likely missing One Call 3.0 subscription
      if (response.status === 401 || response.status === 403) {
        console.warn('[Weather] Historical API requires One Call 3.0 subscription. Subscribe at: https://openweathermap.org/api/one-call-3');
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    // Time Machine API returns data array
    const weatherPoint = data.data?.[0] || data.current;

    if (!weatherPoint) {
      throw new Error('No weather data in response');
    }

    return {
      temp: weatherPoint.temp,
      clouds: weatherPoint.clouds,
      uvi: weatherPoint.uvi || 0,
      weather_main: weatherPoint.weather?.[0]?.main || 'Unknown'
    };
  } catch (error) {
    console.warn('[Weather] Historical fetch failed:', error.message);
    return null;
  }
}

/**
 * Fetch current weather from OpenWeatherMap One Call API
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} apiKey - API key
 * @returns {Promise<object>} Weather data
 */
async function getCurrentWeather(lat, lon, apiKey) {
  const url = `${OPENWEATHER_ONECALL_URL}?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,daily,alerts&appid=${apiKey}`;

  try {
    console.log(`[Weather] Fetching current weather`);
    const response = await fetch(url);

    if (!response.ok) {
      let errorMessage = `Weather API error: ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.message) {
          errorMessage = errorBody.message;
        }
      } catch (e) {}
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const current = data.current;

    if (!current) {
      throw new Error('No current weather data in response');
    }

    return {
      temp: current.temp,
      clouds: current.clouds,
      uvi: current.uvi,
      weather_main: current.weather?.[0]?.main || 'Unknown'
    };
  } catch (error) {
    console.warn('[Weather] Current fetch failed:', error.message);
    return null;
  }
}

/**
 * Fetch weather data for a specific timestamp
 * Uses historical API for past dates, current API for now
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} apiKey - OpenWeatherMap API key
 * @param {Date} timestamp - Target timestamp
 * @returns {Promise<object>} Weather + solar data
 */
async function getWeather(lat, lon, apiKey, timestamp = null) {
  const targetTime = timestamp ? new Date(timestamp) : new Date();
  const cacheKey = getCacheKey(lat, lon, targetTime);

  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (isCacheValid(cached)) {
    console.log(`[Weather] Cache hit for ${cacheKey}`);
    return cached.data;
  }

  // Determine if we need historical or current weather
  const now = new Date();
  const isHistorical = (now - targetTime) > 60 * 60 * 1000; // More than 1 hour ago

  let weatherData = null;

  try {
    if (isHistorical) {
      weatherData = await getHistoricalWeather(lat, lon, apiKey, targetTime);
    } else {
      weatherData = await getCurrentWeather(lat, lon, apiKey);
    }
  } catch (err) {
    console.warn('[Weather] API failed:', err.message);
  }

  // Always fetch solar data (free, no rate limits, works for historical)
  const solar = await getSolarIrradiance(lat, lon, targetTime);

  const result = {
    temp: weatherData?.temp ?? null,
    clouds: weatherData?.clouds ?? null,
    uvi: weatherData?.uvi ?? null,
    weather_main: weatherData?.weather_main ?? null,
    solar_ghi: solar?.ghi ?? null,
    solar_dni: solar?.dni ?? null,
    solar_dhi: solar?.dhi ?? null,
    solar_direct: solar?.direct ?? null
  };

  // Cache the result if we got any data
  if (weatherData || solar) {
    dataCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  }

  // Only throw if we got nothing at all
  if (!weatherData && !solar) {
    throw new Error('Both weather and solar data fetch failed');
  }

  return result;
}

/**
 * Get solar data only (no weather API key required)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Date} timestamp - Target timestamp
 * @returns {Promise<object>} Solar data only
 */
async function getSolarOnly(lat, lon, timestamp = null) {
  const targetTime = timestamp ? new Date(timestamp) : new Date();
  const cacheKey = getCacheKey(lat, lon, targetTime) + ':solar';

  // Check cache
  const cached = dataCache.get(cacheKey);
  if (isCacheValid(cached)) {
    console.log(`[Solar] Cache hit for ${cacheKey}`);
    return cached.data;
  }

  const solar = await getSolarIrradiance(lat, lon, targetTime);

  const result = {
    temp: null,
    clouds: null,
    uvi: null,
    weather_main: null,
    solar_ghi: solar?.ghi ?? null,
    solar_dni: solar?.dni ?? null,
    solar_dhi: solar?.dhi ?? null,
    solar_direct: solar?.direct ?? null
  };

  if (solar) {
    dataCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  }

  return result;
}

/**
 * Extract timestamp from BMS screenshot filename
 * Supports common patterns from phone screenshots and BMS apps
 * @param {string} fileName - Original file name
 * @returns {Date|null} Extracted timestamp or null if not found
 */
function extractTimestampFromFilename(fileName) {
  if (!fileName) return null;

  // Remove extension for parsing
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');

  // Pattern 1: IMG_YYYYMMDD_HHMMSS or Screenshot_YYYYMMDD_HHMMSS
  const pattern1 = /(?:IMG|Screenshot|screenshot|DCIM|Photo)[-_]?(\d{4})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})/i;
  let match = nameWithoutExt.match(pattern1);
  if (match) {
    const [, year, month, day, hour, min, sec] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
  }

  // Pattern 2: YYYY-MM-DD_HH-MM-SS or YYYY-MM-DD HH-MM-SS
  const pattern2 = /(\d{4})-(\d{2})-(\d{2})[-_ ](\d{2})-(\d{2})-(\d{2})/;
  match = nameWithoutExt.match(pattern2);
  if (match) {
    const [, year, month, day, hour, min, sec] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
  }

  // Pattern 3: YYYYMMDD_HHMMSS (bare format)
  const pattern3 = /(\d{4})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})/;
  match = nameWithoutExt.match(pattern3);
  if (match) {
    const [, year, month, day, hour, min, sec] = match;
    const parsedYear = parseInt(year);
    if (parsedYear >= 2000 && parsedYear <= 2100) {
      return new Date(parsedYear, parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
    }
  }

  // Pattern 4: Unix timestamp in milliseconds
  const pattern4 = /^(\d{13})$/;
  match = nameWithoutExt.match(pattern4);
  if (match) {
    const ts = parseInt(match[1]);
    const date = new Date(ts);
    if (date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
      return date;
    }
  }

  // Pattern 5: Unix timestamp in seconds
  const pattern5 = /^(\d{10})$/;
  match = nameWithoutExt.match(pattern5);
  if (match) {
    const ts = parseInt(match[1]) * 1000;
    const date = new Date(ts);
    if (date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
      return date;
    }
  }

  // Pattern 6: iOS style - Photo YYYY-MM-DD at HH.MM.SS
  const pattern6 = /Photo\s+(\d{4})-(\d{2})-(\d{2})\s+at\s+(\d{2})\.(\d{2})\.(\d{2})/i;
  match = nameWithoutExt.match(pattern6);
  if (match) {
    const [, year, month, day, hour, min, sec] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
  }

  return null;
}

/**
 * Clear all caches
 */
function clearCaches() {
  dataCache.clear();
  console.log('[Weather] All caches cleared');
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    entries: dataCache.size
  };
}

/**
 * Batch pre-fetch weather data for multiple timestamps
 * Fetches all unique hours in parallel, then caches results
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string|null} apiKey - OpenWeatherMap API key (null for solar-only)
 * @param {Array<Date|string>} timestamps - Array of timestamps to fetch
 * @param {Object} options - Fetch options
 * @param {number} options.concurrency - Max concurrent fetches (default: 5)
 * @returns {Promise<{fetched: number, cached: number, failed: number}>} Stats
 */
async function batchPreFetchWeather(lat, lon, apiKey, timestamps, options = {}) {
  const { concurrency = 5 } = options;

  // Dedupe by hour (weather doesn't change significantly within an hour)
  const uniqueHours = new Map();
  for (const ts of timestamps) {
    const date = new Date(ts);
    const hourKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}`;
    if (!uniqueHours.has(hourKey)) {
      uniqueHours.set(hourKey, date);
    }
  }

  console.log(`[Weather] Batch pre-fetch: ${timestamps.length} timestamps → ${uniqueHours.size} unique hours`);

  // Check which hours are already cached
  const toFetch = [];
  let alreadyCached = 0;

  for (const [hourKey, date] of uniqueHours) {
    const cacheKey = getCacheKey(lat, lon, date);
    if (isCacheValid(dataCache.get(cacheKey))) {
      alreadyCached++;
    } else {
      toFetch.push({ hourKey, date, cacheKey });
    }
  }

  console.log(`[Weather] Cache status: ${alreadyCached} cached, ${toFetch.length} to fetch`);

  if (toFetch.length === 0) {
    return { fetched: 0, cached: alreadyCached, failed: 0 };
  }

  // Fetch in parallel batches
  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async ({ hourKey, date, cacheKey }) => {
        try {
          let result;
          if (apiKey) {
            result = await getWeather(lat, lon, apiKey, date);
          } else {
            result = await getSolarOnly(lat, lon, date);
          }
          return { success: true, hourKey };
        } catch (err) {
          console.warn(`[Weather] Batch fetch failed for ${hourKey}: ${err.message}`);
          return { success: false, hourKey };
        }
      })
    );

    for (const r of results) {
      if (r.success) fetched++;
      else failed++;
    }
  }

  console.log(`[Weather] Batch pre-fetch complete: ${fetched} fetched, ${alreadyCached} cached, ${failed} failed`);

  return { fetched, cached: alreadyCached, failed };
}

module.exports = {
  getWeather,
  getSolarIrradiance,
  getSolarOnly,
  extractTimestampFromFilename,
  clearCaches,
  getCacheStats,
  batchPreFetchWeather
};
