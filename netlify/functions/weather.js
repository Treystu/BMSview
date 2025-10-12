const { createLogger } = require("./utils/logger.js");

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

exports.handler = async function(event, context) {
  const log = createLogger('weather', context);
  const clientIp = event.headers['x-nf-client-connection-ip'];
  const { httpMethod, body } = event;
  const logContext = { clientIp, httpMethod };
  
  log('debug', 'Function invoked.', logContext);

  if (httpMethod !== 'POST') {
    log('warn', `Method Not Allowed: ${httpMethod}`, logContext);
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    log('error', 'Weather API key (WEATHER_API_KEY) is not configured in environment variables.', logContext);
    return { statusCode: 500, body: JSON.stringify({ error: 'Weather API key is not configured.' }) };
  }
  
  try {
    const { lat, lon, timestamp } = JSON.parse(body);
    const requestLogContext = { ...logContext, lat, lon, timestamp };
    log('info', 'Processing weather request.', requestLogContext);

    if (lat === undefined || lon === undefined) {
      log('warn', 'Missing latitude or longitude in request body.', requestLogContext);
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing latitude or longitude.' }) };
    }

    if (timestamp) {
        log('debug', 'Fetching historical weather data.', requestLogContext);
        const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
        const [mainResponse, uviResponse] = await Promise.all([
            fetchWithRetry(`https://api.openweathermap.org/data/3.0/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${unixTimestamp}&units=metric&appid=${apiKey}`, log),
            fetchWithRetry(`https://api.openweathermap.org/data/2.5/uvi/history?lat=${lat}&lon=${lon}&start=${unixTimestamp}&end=${unixTimestamp}&appid=${apiKey}`, log)
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
        } else {
            log('warn', 'Could not fetch historical UVI data.', { ...requestLogContext, uviApiResponse: uviData });
        }
        log('info', 'Successfully fetched historical weather data.', { ...requestLogContext, result });
        return { statusCode: 200, body: JSON.stringify(result) };

    } else {
        log('debug', 'Fetching current weather data.', requestLogContext);
        const weatherResponse = await fetchWithRetry(`https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,hourly,daily,alerts&appid=${apiKey}`, log);
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
