/**
 * Gemini Function Calling Tool Definitions
 * 
 * This module defines the tools/functions that can be used to query additional data
 * when generating insights. This enables intelligent, context-aware analysis.
 */

// Lazy-load MongoDB to avoid connection errors when not needed
/** @type {Function|null} getCollection - MongoDB collection getter function */
let getCollection;
try {
  const mongodb = require('./mongodb.cjs');
  getCollection = mongodb.getCollection;
} catch (err) {
  // MongoDB not available - tools will return errors gracefully
  getCollection = null;
}

// Dynamic import for node-fetch to handle ESM in CJS context
let fetch;
try {
  // In production/Netlify, use dynamic import
  if (typeof window === 'undefined') {
    fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
  }
} catch (e) {
  // Fallback for test environment
  fetch = null;
}

/**
 * Tool definitions for Gemini function calling
 * These describe the available functions Gemini can call
 */
const toolDefinitions = [
  {
    name: 'getSystemHistory',
    description: 'Retrieves historical battery measurements for a specific system. Use this to analyze trends, compare current performance to past performance, or investigate historical issues.',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'The unique identifier of the battery system'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of historical records to retrieve (default: 100, max: 500)',
          default: 100
        },
        startDate: {
          type: 'string',
          description: 'Optional start date in ISO format (YYYY-MM-DD) to filter records'
        },
        endDate: {
          type: 'string',
          description: 'Optional end date in ISO format (YYYY-MM-DD) to filter records'
        }
      },
      required: ['systemId']
    }
  },
  {
    name: 'getWeatherData',
    description: 'Retrieves weather data for a specific location and time. Use this to correlate battery performance with environmental conditions like temperature, cloud cover, or UV index.',
    parameters: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Latitude of the location'
        },
        longitude: {
          type: 'number',
          description: 'Longitude of the location'
        },
        timestamp: {
          type: 'string',
          description: 'ISO timestamp for historical weather data. Omit for current weather.'
        },
        type: {
          type: 'string',
          enum: ['current', 'historical', 'hourly'],
          description: 'Type of weather data to retrieve',
          default: 'historical'
        }
      },
      required: ['latitude', 'longitude']
    }
  },
  {
    name: 'getSolarEstimate',
    description: 'Retrieves solar energy production estimates for a location and date range. Use this to analyze solar charging potential, compare expected vs actual charging, or plan for future energy needs.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'US Zip Code or "lat,lon" format (e.g., "80942" or "38.8,-104.8")'
        },
        panelWatts: {
          type: 'number',
          description: 'Solar panel maximum power rating in Watts'
        },
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format'
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format'
        }
      },
      required: ['location', 'panelWatts', 'startDate', 'endDate']
    }
  },
  {
    name: 'getSystemAnalytics',
    description: 'Retrieves comprehensive analytics for a battery system including hourly averages, performance baselines, and alert analysis. Use this to understand typical system behavior and identify anomalies.',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'The unique identifier of the battery system'
        }
      },
      required: ['systemId']
    }
  }
];

/**
 * Execute a tool call and return the result
 * @param {string} toolName - Name of the tool to execute
 * @param {object} parameters - Parameters for the tool
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Tool execution result
 */
async function executeToolCall(toolName, parameters, log) {
  const startTime = Date.now();
  log.info('Executing tool call', { toolName, parameters });

  try {
    let result;
    switch (toolName) {
      case 'getSystemHistory':
        result = await getSystemHistory(parameters, log);
        break;

      case 'getWeatherData':
        result = await getWeatherData(parameters, log);
        break;

      case 'getSolarEstimate':
        result = await getSolarEstimate(parameters, log);
        break;

      case 'getSystemAnalytics':
        result = await getSystemAnalytics(parameters, log);
        break;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
    
    const duration = Date.now() - startTime;
    log.info('Tool call completed successfully', { 
      toolName, 
      duration: `${duration}ms`,
      resultSize: JSON.stringify(result).length
    });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('Tool execution failed', { 
      toolName, 
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
      parameters
    });
    return {
      error: true,
      message: `Failed to execute ${toolName}: ${error.message}`
    };
  }
}

/**
 * Get historical battery measurements for a system
 */
async function getSystemHistory(params, log) {
  if (!getCollection) {
    log.error('Database connection not available for getSystemHistory');
    throw new Error('Database connection not available');
  }

  const { systemId, limit = 100, startDate, endDate } = params;

  log.debug('Fetching system history from database', { 
    systemId, 
    limit, 
    hasDateRange: !!(startDate || endDate),
    startDate,
    endDate
  });

  const historyCollection = await getCollection('history');

  // Build query
  const query = { systemId };

  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = new Date(startDate).toISOString();
    if (endDate) query.timestamp.$lte = new Date(endDate).toISOString();
  }

  log.debug('Executing database query', { query, limit: Math.min(limit, 500) });
  
  const queryStartTime = Date.now();

  // Fetch records
  const records = await historyCollection
    .find(query, { projection: { _id: 0 } })
    .sort({ timestamp: -1 })
    .limit(Math.min(limit, 500))
    .toArray();
    
  const queryDuration = Date.now() - queryStartTime;

  log.info('Retrieved system history', { 
    systemId, 
    count: records.length,
    queryDuration: `${queryDuration}ms`
  });

  return {
    systemId,
    recordCount: records.length,
    records: records.map(r => ({
      timestamp: r.timestamp,
      analysis: r.analysis,
      weather: r.weather
    }))
  };
}

/**
 * Get weather data for a location
 */
async function getWeatherData(params, log) {
  if (!fetch) {
    log.error('Fetch is not available in this environment');
    throw new Error('Fetch is not available in this environment');
  }

  const { latitude, longitude, timestamp, type = 'historical' } = params;

  log.debug('Fetching weather data', { latitude, longitude, timestamp, type });

  // Call the weather function
  const baseUrl = process.env.URL || 'http://localhost:8888';
  const url = `${baseUrl}/.netlify/functions/weather`;

  const body = {
    lat: latitude,
    lon: longitude,
    ...(timestamp && { timestamp }),
    ...(type === 'hourly' && { type: 'hourly' })
  };

  log.debug('Calling weather API', { url, bodyKeys: Object.keys(body) });
  
  const fetchStartTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const fetchDuration = Date.now() - fetchStartTime;

  if (!response.ok) {
    log.error('Weather API error', { 
      status: response.status, 
      statusText: response.statusText,
      duration: `${fetchDuration}ms`
    });
    throw new Error(`Weather API returned ${response.status}`);
  }

  const data = await response.json();
  log.info('Retrieved weather data', { 
    latitude, 
    longitude, 
    type,
    duration: `${fetchDuration}ms`,
    dataSize: JSON.stringify(data).length
  });

  return data;
}

/**
 * Get solar energy estimates
 */
async function getSolarEstimate(params, log) {
  if (!fetch) {
    throw new Error('Fetch is not available in this environment');
  }

  const { location, panelWatts, startDate, endDate } = params;

  // Call the solar-estimate function
  const baseUrl = process.env.URL || 'http://localhost:8888';
  const queryParams = new URLSearchParams({
    location,
    panelWatts: panelWatts.toString(),
    startDate,
    endDate
  });

  const url = `${baseUrl}/.netlify/functions/solar-estimate?${queryParams}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Solar API returned ${response.status}`);
  }

  const data = await response.json();
  log.info('Retrieved solar estimate', { location, panelWatts, startDate, endDate });

  return data;
}

/**
 * Get system analytics
 */
async function getSystemAnalytics(params, log) {
  if (!fetch) {
    log.error('Fetch is not available in this environment');
    throw new Error('Fetch is not available in this environment');
  }

  const { systemId } = params;

  log.debug('Fetching system analytics', { systemId });

  // Call the system-analytics function
  const baseUrl = process.env.URL || 'http://localhost:8888';
  const url = `${baseUrl}/.netlify/functions/system-analytics?systemId=${systemId}`;

  log.debug('Calling system analytics API', { url });
  
  const fetchStartTime = Date.now();

  const response = await fetch(url);
  
  const fetchDuration = Date.now() - fetchStartTime;

  if (!response.ok) {
    log.error('System analytics API error', { 
      status: response.status, 
      statusText: response.statusText,
      duration: `${fetchDuration}ms`
    });
    throw new Error(`System analytics API returned ${response.status}`);
  }

  const data = await response.json();
  log.info('Retrieved system analytics', { 
    systemId,
    duration: `${fetchDuration}ms`,
    dataSize: JSON.stringify(data).length
  });

  return data;
}

module.exports = {
  toolDefinitions,
  executeToolCall
};

