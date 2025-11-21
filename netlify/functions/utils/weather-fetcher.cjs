/**
 * Weather data fetching utilities for direct API access
 * This module provides functions to fetch weather data directly from OpenWeatherMap
 * without going through the Netlify function endpoint.
 */

const fetchWithRetry = async (url, log, retries = 3, initialDelay = 500) => {
  for (let i = 0; i < retries; i++) {
    const attempt = i + 1;
    log('debug', `Fetching URL (attempt ${attempt}/${retries}).`, { url: url.replace(/appid=[^&]+/, 'appid=***') });
    try {
      const response = await fetch(url);
      if (response.ok) {
        log('debug', `Fetch successful.`, { status: response.status, attempt });
        return response;
      }
      log('warn', `Fetch failed with status ${response.status}. Retrying...`, { attempt });
    } catch (e) {
      log('warn', `Fetch failed with error. Retrying...`, { attempt, error: e.message });
      if (i === retries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, initialDelay * Math.pow(2, i)));
  }
  throw new Error('Max retries reached');
};

/**
 * Fetch historical weather data for a specific timestamp
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} timestamp - ISO 8601 timestamp
 * @param {object} log - Logger instance
 * @returns {Promise<object|null>} Weather data or null if failed
 */
async function fetchHistoricalWeather(lat, lon, timestamp, log) {
  const apiKey = process.env.WEATHER_API_KEY;
  
  if (!apiKey) {
    log('error', 'Weather API key (WEATHER_API_KEY) is not configured.');
    return null;
  }
  
  if (lat === undefined || lon === undefined) {
    log('warn', 'Missing latitude or longitude.', { lat, lon });
    return null;
  }
  
  const logContext = { lat, lon, timestamp };
  
  try {
    const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
    const timemachineUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`;
    const uviUrl = `https://api.openweathermap.org/data/2.5/uvi/history?lat=${lat}&lon=${lon}&start=${unixTimestamp}&end=${unixTimestamp}&appid=${apiKey}`;

    log('debug', 'Fetching historical weather from OpenWeather APIs.', logContext);

    const [mainResponse, uviResponse] = await Promise.all([
      fetchWithRetry(timemachineUrl, log),
      fetchWithRetry(uviUrl, log)
    ]);

    const mainData = await mainResponse.json();
    const uviData = await uviResponse.json();
    
    if (!mainResponse.ok) {
      throw new Error(mainData.message || 'Failed to fetch from OpenWeather Timemachine API.');
    }
    
    const current = mainData.data?.[0];
    if (!current) {
      throw new Error('No weather data available in Timemachine API response.');
    }

    const result = {
      temp: current.temp,
      clouds: current.clouds,
      uvi: null,
      weather_main: current.weather[0]?.main || 'Unknown',
      weather_icon: current.weather[0]?.icon || '',
    };

    if (uviResponse.ok && uviData && Array.isArray(uviData) && uviData.length > 0) {
      result.uvi = uviData[0].value;
      log('debug', 'Successfully fetched historical UVI data.', { ...logContext, uviValue: result.uvi });
    } else {
      log('warn', 'Could not fetch historical UVI data.', logContext);
    }
    
    log('debug', 'Successfully fetched historical weather data.', { ...logContext, result });
    return result;
    
  } catch (error) {
    log('error', 'Error fetching historical weather.', { 
      ...logContext, 
      errorMessage: error.message, 
      errorStack: error.stack 
    });
    return null;
  }
}

/**
 * Fetch hourly weather data for a specific day
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} date - Date string (YYYY-MM-DD or ISO timestamp)
 * @param {object} log - Logger instance
 * @returns {Promise<Array|null>} Array of hourly weather data or null if failed
 */
async function fetchHourlyWeather(lat, lon, date, log) {
  const apiKey = process.env.WEATHER_API_KEY;
  
  if (!apiKey) {
    log('error', 'Weather API key (WEATHER_API_KEY) is not configured.');
    return null;
  }
  
  if (lat === undefined || lon === undefined) {
    log('warn', 'Missing latitude or longitude.', { lat, lon });
    return null;
  }
  
  const logContext = { lat, lon, date };
  
  try {
    const unixTimestamp = Math.floor(new Date(date).getTime() / 1000);
    const timemachineUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`;

    log('debug', 'Fetching hourly weather data from OpenWeather API.', logContext);

    const response = await fetchWithRetry(timemachineUrl, log);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch from OpenWeather Timemachine API.');
    }

    const hourlyData = data.hourly || [];
    log('debug', 'Successfully fetched hourly weather data.', { 
      ...logContext, 
      hourCount: hourlyData.length 
    });
    
    return hourlyData;
    
  } catch (error) {
    log('error', 'Error fetching hourly weather.', { 
      ...logContext, 
      errorMessage: error.message, 
      errorStack: error.stack 
    });
    return null;
  }
}

/**
 * Calculate sunrise and sunset times for a given location and date
 * Uses a simple approximation algorithm
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude  
 * @param {Date} date - Date object
 * @returns {object} Object with sunrise and sunset timestamps
 */
function calculateSunriseSunset(lat, lon, date) {
  // This is a simplified calculation. For production, consider using a library like suncalc
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
  const latRad = lat * Math.PI / 180;
  
  // Solar declination angle
  const declination = 23.45 * Math.sin((360/365) * (dayOfYear - 81) * Math.PI / 180);
  const declinationRad = declination * Math.PI / 180;
  
  // Hour angle
  const cosHourAngle = -Math.tan(latRad) * Math.tan(declinationRad);
  
  // Handle polar day/night
  if (cosHourAngle > 1) {
    // Polar night - no sunrise
    return { sunrise: null, sunset: null, isPolarNight: true };
  }
  if (cosHourAngle < -1) {
    // Polar day - no sunset
    return { sunrise: null, sunset: null, isPolarDay: true };
  }
  
  const hourAngle = Math.acos(cosHourAngle) * 180 / Math.PI;
  
  // Convert to hours (solar noon is at 12:00)
  const sunriseHour = 12 - (hourAngle / 15) - (lon / 15);
  const sunsetHour = 12 + (hourAngle / 15) - (lon / 15);
  
  // Create Date objects for sunrise and sunset
  const sunrise = new Date(date);
  sunrise.setHours(Math.floor(sunriseHour), Math.round((sunriseHour % 1) * 60), 0, 0);
  
  const sunset = new Date(date);
  sunset.setHours(Math.floor(sunsetHour), Math.round((sunsetHour % 1) * 60), 0, 0);
  
  return { sunrise, sunset, isPolarNight: false, isPolarDay: false };
}

/**
 * Get daylight hours for a given date and location
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {Date} date - Date object
 * @returns {Array} Array of hour timestamps (0-23) that are during daylight
 */
function getDaylightHours(lat, lon, date) {
  const { sunrise, sunset, isPolarNight, isPolarDay } = calculateSunriseSunset(lat, lon, date);
  
  if (isPolarNight) {
    return []; // No daylight hours
  }
  
  if (isPolarDay) {
    return Array.from({ length: 24 }, (_, i) => i); // All hours are daylight
  }
  
  const sunriseHour = sunrise.getHours();
  const sunsetHour = sunset.getHours();
  
  const hours = [];
  for (let h = sunriseHour; h <= sunsetHour; h++) {
    hours.push(h);
  }
  
  return hours;
}

module.exports = {
  fetchHistoricalWeather,
  fetchHourlyWeather,
  calculateSunriseSunset,
  getDaylightHours
};
