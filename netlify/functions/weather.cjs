const { createLogger } = require("./utils/logger.cjs");

const fetchWithRetry = async (url, log, retries = 3, initialDelay = 500) => {
  for (let i = 0; i < retries; i++) {
    const attempt = i + 1;
    log('debug', `Fetching URL (attempt ${attempt}/${retries}).`, { url });
    try {
      const response = await fetch(url);
      if (response.ok) {
        log('debug', `Fetch successful.`, { url, status: response.status, attempt });
        return response;
      }
      log('warn', `Fetch failed with status ${response.status}. Retrying...`, { url, attempt });
    } catch (e) {
      log('warn', `Fetch failed with error. Retrying...`, { url, attempt, error: e.message });
      if (i === retries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, initialDelay * Math.pow(2, i)));
  }
};

exports.handler = async function (event, context) {
  const log = createLogger('weather', context);
  const clientIp = event.headers['x-nf-client-connection-ip'];
  const { httpMethod, body } = event;
  const logContext = { clientIp, httpMethod };

  log('info', 'Weather function invoked.', { ...logContext, path: event.path });

  if (httpMethod !== 'POST') {
    log('warn', `Method Not Allowed: ${httpMethod}`, {
      ...logContext,
      queryStringParameters: event.queryStringParameters,
      hasBody: Boolean(event.body)
    });
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST' },
      body: JSON.stringify({
        error: 'Weather endpoint expects POST requests with JSON body { "lat": number, "lon": number, "timestamp"?: string }.'
      })
    };
  }

  const apiKey = process.env.WEATHER_API_KEY;
  log('info', `WEATHER_API_KEY: ${apiKey ? 'loaded' : 'not loaded'}`)
  if (!apiKey) {
    log('error', 'Weather API key (WEATHER_API_KEY) is not configured in environment variables.', logContext);
    return { statusCode: 500, body: JSON.stringify({ error: 'Weather API key is not configured.' }) };
  }

  try {
    const parsedBody = JSON.parse(body);
    log('debug', 'Parsed POST body.', { ...logContext, body: parsedBody });
    const { lat, lon, timestamp, type } = parsedBody;
    const requestLogContext = { ...logContext, lat, lon, timestamp, type };
    log('info', 'Processing weather request.', requestLogContext);

    if (lat === undefined || lon === undefined) {
      log('warn', 'Missing latitude or longitude in request body.', requestLogContext);
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing latitude or longitude.' }) };
    }

    if (type === 'hourly' && timestamp) {
      log('debug', 'Fetching hourly weather data for a day.', requestLogContext);
      const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
      const timemachineUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`;

      const mainResponse = await fetchWithRetry(timemachineUrl, log);
      const mainData = await mainResponse.json();
      if (!mainResponse.ok) throw new Error(mainData.message || 'Failed to fetch from OpenWeather Timemachine API.');

      return { statusCode: 200, body: JSON.stringify(mainData.hourly || []) };
    }

    if (timestamp) {
      log('debug', 'Fetching historical weather data.', requestLogContext);
      const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
      const timemachineUrl = `https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`;
      const uviUrl = `https://api.openweathermap.org/data/2.5/uvi/history?lat=${lat}&lon=${lon}&start=${unixTimestamp}&end=${unixTimestamp}&appid=${apiKey}`;

      log('debug', 'Fetching from OpenWeather APIs.', { ...requestLogContext, timemachineUrl, uviUrl });

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
        log('debug', 'Successfully fetched historical UVI data.', { ...requestLogContext, uviValue: result.uvi });
      } else {
        log('warn', 'Could not fetch historical UVI data.', { ...requestLogContext, uviApiResponse: uviData });
      }
      log('info', 'Successfully fetched historical weather data.', { ...requestLogContext, result });
      return { statusCode: 200, body: JSON.stringify(result) };

    } else {
      log('debug', 'Fetching current weather data.', requestLogContext);
      const onecallUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,hourly,daily,alerts&appid=${apiKey}`;
      log('debug', 'Fetching from OneCall API.', { ...requestLogContext, url: onecallUrl });

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
      log('info', 'Successfully fetched current weather data.', { ...requestLogContext, result });
      return { statusCode: 200, body: JSON.stringify(result) };
    }

  } catch (error) {
    log('error', 'Critical error in weather function.', { ...logContext, errorMessage: error.message, stack: error.stack });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch weather data on the server." }),
    };
  }
};
