// @ts-nocheck
const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { createStandardEntryMeta } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCachedWeatherForHour } = require('./utils/weather-batch-backfill.cjs');

function validateEnvironment(log) {
  if (!process.env.WEATHER_API_KEY) {
    log.error('Missing WEATHER_API_KEY environment variable');
    return false;
  }
  return true;
}

const fetchWithRetry = async (url, log, retries = 3, initialDelay = 500) => {
  for (let i = 0; i < retries; i++) {
    const attempt = i + 1;
    log.debug('Fetching URL', { url: url.replace(/appid=[^&]+/, 'appid=***'), attempt, maxRetries: retries });
    try {
      const response = await fetch(url);
      if (response.ok) {
        log.debug('Fetch successful', { status: response.status, attempt });
        return response;
      }
      log.warn('Fetch failed with status', { status: response.status, attempt });
    } catch (e) {
      log.warn('Fetch failed with error, retrying', { attempt, error: e.message });
      if (i === retries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, initialDelay * Math.pow(2, i)));
  }
};

exports.handler = async function (event, context) {
  const headers = getCorsHeaders(event);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('weather', event, context);
  log.entry(createStandardEntryMeta(event));
  const timer = createTimer(log, 'weather');

  if (event.httpMethod !== 'POST') {
    log.warn('Method not allowed', { method: event.httpMethod });
    timer.end({ error: 'method_not_allowed' });
    log.exit(405);
    return {
      statusCode: 405,
      headers: { ...headers, 'Content-Type': 'application/json', 'Allow': 'POST' },
      body: JSON.stringify({
        error: 'Weather endpoint expects POST requests with JSON body { "lat": number, "lon": number, "timestamp"?: string }.'
      })
    };
  }

  if (!validateEnvironment(log)) {
    timer.end({ error: 'missing_api_key' });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Weather API key is not configured.' })
    };
  }

  const apiKey = process.env.WEATHER_API_KEY;

  try {
    log.debug('Parsing request body');
    const parsedBody = JSON.parse(event.body);
    const { lat, lon, timestamp, type } = parsedBody;
    log.info('Processing weather request', { lat, lon, timestamp, type });

    if (lat === undefined || lon === undefined) {
      log.warn('Missing latitude or longitude');
      timer.end({ error: 'missing_coords' });
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing latitude or longitude.' })
      };
    }

    if (type === 'hourly' && timestamp) {
      log.debug('Fetching hourly weather data for a day');
      const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
      const timemachineUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`;

      const mainResponse = await fetchWithRetry(timemachineUrl, log);
      const mainData = await mainResponse.json();
      if (!mainResponse.ok) throw new Error(mainData.message || 'Failed to fetch from OpenWeather Timemachine API.');

      timer.end({ type: 'hourly', dataPoints: (mainData.hourly || []).length });
      log.exit(200);
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(mainData.hourly || [])
      };
    }

    if (timestamp) {
      log.debug('Fetching historical weather data');

      // CACHE-FIRST: Check if we have this data cached
      // Try to find systemId from the request (if provided)
      const systemId = parsedBody.systemId;
      if (systemId) {
        const cachedWeather = await getCachedWeatherForHour(systemId, timestamp, log);
        if (cachedWeather) {
          timer.end({ type: 'historical', cached: true });
          log.info('Returning cached weather data', { systemId, timestamp });
          log.exit(200);
          return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(cachedWeather)
          };
        }
      }

      // Cache miss - fetch from API
      log.debug('Cache miss, fetching from OpenWeather API');
      const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
      const timemachineUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`;
      const uviUrl = `https://api.openweathermap.org/data/2.5/uvi/history?lat=${lat}&lon=${lon}&start=${unixTimestamp}&end=${unixTimestamp}&appid=${apiKey}`;

      const [mainResponse, uviResponse] = await Promise.all([
        fetchWithRetry(timemachineUrl, log),
        fetchWithRetry(uviUrl, log)
      ]);

      const mainData = await mainResponse.json();
      const uviData = await uviResponse.json();
      if (!mainResponse.ok) throw new Error(mainData.message || 'Failed to fetch from OpenWeather Timemachine API.');
      const current = mainData.data?.[0];
      if (!current) throw new Error('No weather data available in Timemachine API response.');

      const result = {
        temp: current.temp,
        clouds: current.clouds,
        uvi: null,
        weather_main: current.weather[0]?.main || 'Unknown',
        weather_icon: current.weather[0]?.icon || '',
      };

      if (uviResponse.ok && uviData && Array.isArray(uviData) && uviData.length > 0) {
        result.uvi = uviData[0].value;
        log.debug('Successfully fetched historical UVI data', { uviValue: result.uvi });
      } else {
        log.warn('Could not fetch historical UVI data');
      }

      timer.end({ type: 'historical', hasUvi: result.uvi !== null });
      log.info('Successfully fetched historical weather data');
      log.exit(200);
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };

    } else {
      log.debug('Fetching current weather data');
      const onecallUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,hourly,daily,alerts&appid=${apiKey}`;

      const weatherResponse = await fetchWithRetry(onecallUrl, log);
      const weatherData = await weatherResponse.json();
      if (!weatherResponse.ok) throw new Error(weatherData.message || 'Failed to fetch from OpenWeather API.');

      const current = weatherData.current;
      if (!current) throw new Error('No current weather data available in API response.');

      const result = {
        temp: current.temp,
        clouds: current.clouds,
        uvi: current.uvi,
        weather_main: current.weather[0]?.main || 'Unknown',
        weather_icon: current.weather[0]?.icon || '',
      };

      timer.end({ type: 'current' });
      log.info('Successfully fetched current weather data');
      log.exit(200);
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

  } catch (error) {
    timer.end({ error: true });
    log.error('Critical error in weather function', { error: error.message, stack: error.stack });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: "Failed to fetch weather data on the server." }),
    };
  }
};
