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

/**
 * @param {import('./utils/jsdoc-types.cjs').NetlifyEvent} event
 * @param {import('./utils/jsdoc-types.cjs').NetlifyContext} context
 */
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

  let parsedBody, lat, lon, timestamp, type;
  try {
    log.debug('Parsing request body');
    if (!event.body) {
      throw new Error('Request body is empty');
    }
    parsedBody = JSON.parse(event.body);
    ({ lat, lon, timestamp, type } = parsedBody);
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
      if (!mainResponse.ok) {
        let errorMessage = 'Failed to fetch from OpenWeather Timemachine API.';
        try {
          const errorData = await mainResponse.json();
          errorMessage = errorData.message || errorMessage;
        } catch (jsonError) {
          log.warn('Failed to parse error response from weather API', { error: jsonError.message });
        }
        throw new Error(errorMessage);
      }

      let mainData;
      try {
        mainData = await mainResponse.json();
      } catch (jsonError) {
        log.error('Failed to parse weather API response as JSON', { error: jsonError.message });
        throw new Error(`Invalid JSON response from weather API: ${jsonError.message}`);
      }

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

      log.apiCall('OpenWeather', 'timemachine', { lat, lon, timestamp: unixTimestamp });
      log.apiCall('OpenWeather', 'uvi', { lat, lon, timestamp: unixTimestamp });

      const [mainResponse, uviResponse] = await Promise.all([
        fetchWithRetry(timemachineUrl, log).catch(err => {
          log.error('Failed to fetch main weather data', { error: err.message });
          throw new Error(`Weather API request failed: ${err.message}`);
        }),
        fetchWithRetry(uviUrl, log).catch(err => {
          log.warn('Failed to fetch UVI data (non-critical)', { error: err.message });
          return { ok: false, error: err }; // Return error object but don't fail
        })
      ]);

      log.debug('API Responses Received', {
        mainStatus: mainResponse.status,
        uviStatus: uviResponse.ok ? uviResponse.status : 'failed'
      });

      // Validate and parse main response first
      if (!mainResponse.ok) {
        let errorMessage = 'Failed to fetch from OpenWeather Timemachine API.';
        try {
          const errorData = await mainResponse.json();
          errorMessage = errorData.message || errorMessage;
        } catch (jsonError) {
          log.warn('Failed to parse error response from weather API', { error: jsonError.message });
        }
        throw new Error(errorMessage);
      }

      let mainData;
      try {
        mainData = await mainResponse.json();
      } catch (jsonError) {
        log.error('Failed to parse main weather API response as JSON', { error: jsonError.message });
        throw new Error(`Invalid JSON response from weather API: ${jsonError.message}`);
      }

      const current = mainData.data?.[0];
      if (!current) {
        log.error('No weather data in Timemachine API response', { mainData });
        throw new Error('No weather data available in Timemachine API response.');
      }

      // Parse UVI response (non-critical)
      let uviData = null;
      if (uviResponse.ok) {
        try {
          uviData = await uviResponse.json();
        } catch (jsonError) {
          log.warn('Failed to parse UVI response as JSON', { error: jsonError.message });
        }
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

      // Check response status before parsing
      if (!weatherResponse.ok) {
        let errorMessage = 'Failed to fetch from OpenWeather API.';
        try {
          const errorData = await weatherResponse.json();
          errorMessage = errorData.message || errorMessage;
        } catch (jsonError) {
          log.warn('Failed to parse error response from weather API', { error: jsonError.message });
        }
        throw new Error(errorMessage);
      }

      let weatherData;
      try {
        weatherData = await weatherResponse.json();
      } catch (jsonError) {
        log.error('Failed to parse current weather API response as JSON', { error: jsonError.message });
        throw new Error(`Invalid JSON response from weather API: ${jsonError.message}`);
      }

      const current = weatherData.current;
      if (!current) {
        log.error('No current weather data in API response', { weatherData });
        throw new Error('No current weather data available in API response.');
      }

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
