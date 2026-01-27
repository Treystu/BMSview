/**
 * Weather Module - Fetches current weather data from OpenWeatherMap
 * Simplified version for local use
 */

const OPENWEATHER_API_URL = 'https://api.openweathermap.org/data/3.0/onecall';

/**
 * Fetch current weather data for a location
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} apiKey - OpenWeatherMap API key
 * @returns {Promise<object>} Weather data
 */
async function getWeather(lat, lon, apiKey) {
  const url = `${OPENWEATHER_API_URL}?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,hourly,daily,alerts&appid=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    let errorMessage = `Weather API error: ${response.status}`;

    try {
      const errorBody = await response.json();
      if (errorBody.message) {
        errorMessage = errorBody.message;
      }
    } catch (e) {
      // Ignore parse error
    }

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
    weather_main: current.weather?.[0]?.main || 'Unknown',
    weather_icon: current.weather?.[0]?.icon || ''
  };
}

/**
 * Fetch historical weather data for a specific timestamp
 * Note: Requires OpenWeatherMap One Call API 3.0 subscription
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} timestamp - ISO timestamp
 * @param {string} apiKey - OpenWeatherMap API key
 * @returns {Promise<object>} Weather data
 */
async function getHistoricalWeather(lat, lon, timestamp, apiKey) {
  const unixTime = Math.floor(new Date(timestamp).getTime() / 1000);
  const url = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTime}&units=metric&appid=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    let errorMessage = `Weather API error: ${response.status}`;

    try {
      const errorBody = await response.json();
      if (errorBody.message) {
        errorMessage = errorBody.message;
      }
    } catch (e) {
      // Ignore parse error
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  const current = data.data?.[0];

  if (!current) {
    throw new Error('No historical weather data in response');
  }

  return {
    temp: current.temp,
    clouds: current.clouds,
    uvi: current.uvi || null,
    weather_main: current.weather?.[0]?.main || 'Unknown',
    weather_icon: current.weather?.[0]?.icon || ''
  };
}

module.exports = {
  getWeather,
  getHistoricalWeather
};
