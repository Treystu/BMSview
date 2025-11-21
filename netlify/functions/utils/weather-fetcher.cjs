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
 * Uses a more accurate astronomical calculation
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude  
 * @param {Date} date - Date object
 * @returns {object} Object with sunrise and sunset timestamps
 */
function calculateSunriseSunset(lat, lon, date) {
  const latRad = lat * Math.PI / 180;
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear = Math.floor((date - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
  
  // Julian day calculation
  const julianDay = 367 * year - Math.floor(7 * (year + Math.floor((1 + 9 + 1) / 12)) / 4) + 
                    Math.floor(275 * 1 / 9) + dayOfYear + 1721013.5;
  const julianCentury = (julianDay - 2451545) / 36525;
  
  // Solar declination
  const solarDeclination = 0.006918 - 
    0.399912 * Math.cos(2 * Math.PI * (dayOfYear - 1) / 365) + 
    0.070257 * Math.sin(2 * Math.PI * (dayOfYear - 1) / 365) - 
    0.006758 * Math.cos(4 * Math.PI * (dayOfYear - 1) / 365) + 
    0.000907 * Math.sin(4 * Math.PI * (dayOfYear - 1) / 365);
  
  // Hour angle
  const cosHourAngle = (Math.sin(-0.01454) - Math.sin(latRad) * Math.sin(solarDeclination)) / 
                       (Math.cos(latRad) * Math.cos(solarDeclination));
  
  // Handle polar day/night
  if (cosHourAngle > 1) {
    // Polar night - no sunrise
    return { sunrise: null, sunset: null, isPolarNight: true, isPolarDay: false };
  }
  if (cosHourAngle < -1) {
    // Polar day - no sunset
    return { sunrise: null, sunset: null, isPolarNight: false, isPolarDay: true };
  }
  
  const hourAngle = Math.acos(cosHourAngle);
  
  // Equation of time (in minutes)
  const eqTime = 229.18 * (0.000075 + 
    0.001868 * Math.cos(2 * Math.PI * (dayOfYear - 1) / 365) - 
    0.032077 * Math.sin(2 * Math.PI * (dayOfYear - 1) / 365) - 
    0.014615 * Math.cos(4 * Math.PI * (dayOfYear - 1) / 365) - 
    0.040849 * Math.sin(4 * Math.PI * (dayOfYear - 1) / 365));
  
  // Solar noon in minutes from midnight
  const solarNoon = 720 - 4 * lon - eqTime;
  
  // Sunrise and sunset in minutes from midnight
  const sunriseMinutes = solarNoon - hourAngle * 180 / Math.PI * 4;
  const sunsetMinutes = solarNoon + hourAngle * 180 / Math.PI * 4;
  
  // Create Date objects for sunrise and sunset
  const sunrise = new Date(date);
  const sunriseHours = Math.floor(sunriseMinutes / 60);
  const sunriseMins = Math.round(sunriseMinutes % 60);
  sunrise.setHours(sunriseHours, sunriseMins, 0, 0);
  
  const sunset = new Date(date);
  const sunsetHours = Math.floor(sunsetMinutes / 60);
  const sunsetMins = Math.round(sunsetMinutes % 60);
  sunset.setHours(sunsetHours, sunsetMins, 0, 0);
  
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
  
  // Calculate hours in local time by getting the time in minutes since start of day
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  
  const sunriseMinutes = (sunrise - dayStart) / (1000 * 60);
  const sunsetMinutes = (sunset - dayStart) / (1000 * 60);
  
  const sunriseHour = Math.floor(sunriseMinutes / 60);
  const sunsetHour = Math.floor(sunsetMinutes / 60);
  
  const hours = [];
  for (let h = sunriseHour; h <= sunsetHour && h < 24; h++) {
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
