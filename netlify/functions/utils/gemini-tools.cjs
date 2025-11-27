/**
 * Gemini Function Calling Tool Definitions
 * 
 * This module defines the tools/functions that can be used to query additional data
 * when generating insights. This enables intelligent, context-aware analysis.
 * 
 * IMPORTANT UNIT CLARIFICATIONS:
 * ==============================
 * - Power (W, kW): Instantaneous rate of energy transfer. avgPower_W is a RATE, not accumulation.
 * - Energy (Wh, kWh): Power integrated over time. This is what you pay for on your electric bill.
 * - Current (A): Rate of charge flow. To get Ah, multiply by hours.
 * - Capacity (Ah): Total charge. To get Wh, multiply by voltage.
 * 
 * CRITICAL CALCULATION RULES:
 * ===========================
 * - Energy (Wh) = Power (W) × Time (hours)
 * - Energy (kWh) = Power (kW) × Time (hours) = Energy (Wh) / 1000
 * - Energy (Wh) = Current (A) × Voltage (V) × Time (hours)
 * - Energy (Wh) = Capacity (Ah) × Voltage (V)
 * 
 * EXAMPLE:
 * If avgChargingPower_W = 1100 W for 8 hours of sunlight:
 * Daily charging energy = 1100 W × 8 h = 8800 Wh = 8.8 kWh
 * 
 * NEVER confuse W (power) with Wh (energy) - they are different units!
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

// Pre-load utility modules at the top level for Netlify bundler
const { aggregateHourlyData, sampleDataPoints, computeBucketMetrics } = require('./data-aggregation.cjs');
const forecasting = require('./forecasting.cjs');
const patternAnalysis = require('./pattern-analysis.cjs');
const energyBudget = require('./energy-budget.cjs');

/**
 * Tool definitions for Gemini function calling
 * These describe the available functions Gemini can call
 * 
 * RESPONSE FIELD NAMING CONVENTION:
 * - Fields ending with _W: Power in Watts (instantaneous rate)
 * - Fields ending with _Wh: Energy in Watt-hours (accumulated)
 * - Fields ending with _kWh: Energy in kilowatt-hours (accumulated)
 * - Fields ending with _A: Current in Amps
 * - Fields ending with _Ah: Charge in Amp-hours
 * - Fields ending with _V: Voltage in Volts
 */
const toolDefinitions = [
  {
    name: 'request_bms_data',
    description: `PRIMARY tool for raw data. Returns time-series data arrays.
• USE "hourly_avg" for: Detailed analysis of < 30 days (e.g., "last week", "yesterday").
• USE "daily_avg" for: Long-term trends > 30 days (e.g., "last month", "battery health trends").
• USE "raw" ONLY for: Pinpoint diagnosis of specific 1-2 hour events.
• ISO DATES: Ensure time_range_start < time_range_end.
• ENERGY FIELDS: Response includes pre-calculated chargingKWh and dischargingKWh per bucket - USE THESE instead of calculating from power.`,
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'The unique identifier of the battery system (provided in DATA AVAILABILITY section)'
        },
        metric: {
          type: 'string',
          description: 'The SPECIFIC data metric needed. Request ONE metric at a time for best performance. Options: "voltage" (battery pack voltage V), "current" (charge/discharge current A, positive=charging, negative=discharging, includes Ah calculations), "power" (instantaneous Watts AND pre-calculated Wh/kWh energy), "soc" (state of charge percentage), "capacity" (remaining Ah), "temperature" (battery temp °C), "cell_voltage_difference" (voltage spread across cells), "all" (use sparingly - returns all metrics including energy)',
          enum: ['all', 'voltage', 'current', 'power', 'soc', 'capacity', 'temperature', 'cell_voltage_difference']
        },
        time_range_start: {
          type: 'string',
          description: 'Start of time range in ISO 8601 format (e.g., "2025-11-01T00:00:00Z"). Use strategic date ranges - smaller is faster.'
        },
        time_range_end: {
          type: 'string',
          description: 'End of time range in ISO 8601 format (e.g., "2025-11-18T00:00:00Z")'
        },
        granularity: {
          type: 'string',
          description: 'Data resolution: "hourly_avg" (hourly averages + hourly energy kWh), "daily_avg" (daily averages + daily energy kWh, best for energy totals), "raw" (snapshots only, no energy calculations). For energy analysis, use daily_avg which provides chargingKWh and dischargingKWh per day.',
          enum: ['hourly_avg', 'daily_avg', 'raw'],
          default: 'hourly_avg'
        }
      },
      required: ['systemId', 'metric', 'time_range_start', 'time_range_end']
    }
  },
  {
    name: 'getSystemHistory',
    description: 'DEPRECATED: Use request_bms_data instead. Legacy function for retrieving historical battery measurements.',
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
    description: 'Get weather data for a location and time. Returns temperature (°C), cloud cover (%), UV index, and other conditions. Use this to correlate battery performance with environmental factors (e.g., cold affecting capacity, clouds affecting solar). For historical data, specify timestamp.',
    parameters: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Latitude of the location (e.g., 38.8)'
        },
        longitude: {
          type: 'number',
          description: 'Longitude of the location (e.g., -104.8)'
        },
        timestamp: {
          type: 'string',
          description: 'ISO timestamp for historical weather (e.g., "2025-11-15T12:00:00Z"). Omit for current weather.'
        },
        type: {
          type: 'string',
          enum: ['current', 'historical', 'hourly'],
          description: 'Type of weather data: current (latest conditions), historical (specific past time), hourly (hourly forecast/history)',
          default: 'historical'
        }
      },
      required: ['latitude', 'longitude']
    }
  },
  {
    name: 'getSolarEstimate',
    description: 'Get solar energy production estimates for a location and date range. Returns daily expected solar generation in Wh based on panel wattage, location, and historical weather patterns. Use this to compare expected vs actual charging, assess solar system performance, or plan for energy needs. Location can be US zip code or lat,lon coordinates.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'US Zip Code (e.g., "80942") or "lat,lon" format (e.g., "38.8,-104.8")'
        },
        panelWatts: {
          type: 'number',
          description: 'Solar panel maximum power rating in Watts (e.g., 400 for a 400W panel)'
        },
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (e.g., "2025-11-01")'
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (e.g., "2025-11-18")'
        }
      },
      required: ['location', 'panelWatts', 'startDate', 'endDate']
    }
  },
  {
    name: 'getSystemAnalytics',
    description: 'Get comprehensive analytics for a battery system. Returns hourly usage patterns, performance baselines, alert frequency analysis, and statistical summaries. Use this to understand typical system behavior, identify anomalies, and establish performance benchmarks. Returns aggregated analytics, not raw time-series data.',
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
  },
  {
    name: 'predict_battery_trends',
    description: 'Uses statistical regression on historical data to forecast future performance.\n' +
                 '• USE THIS for: "How long will my battery last?", "Is my capacity degrading?", "Maintenance planning".\n' +
                 '• DO NOT guess degradation - use this tool to get the calculated slope.\n' +
                 '• Returns: degradation rate, days to threshold, confidence intervals.',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'Battery system identifier'
        },
        metric: {
          type: 'string',
          enum: ['capacity', 'efficiency', 'temperature', 'voltage', 'lifetime'],
          description: 'What metric to predict: capacity (degradation over time), efficiency (charge/discharge), temperature (thermal patterns), voltage (voltage trends), lifetime (estimated SERVICE LIFE until replacement threshold based on degradation - NOT runtime before discharge)'
        },
        forecastDays: {
          type: 'number',
          default: 30,
          description: 'Number of days to forecast into the future (default: 30, max: 365)'
        },
        confidenceLevel: {
          type: 'boolean',
          default: true,
          description: 'Include confidence intervals and prediction accuracy metrics'
        }
      },
      required: ['systemId', 'metric']
    }
  },
  {
    name: 'analyze_usage_patterns',
    description: 'Analyze energy consumption patterns and identify trends, cycles, and anomalies. Essential for off-grid optimization, load planning, and detecting unusual behavior.',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'Battery system identifier'
        },
        patternType: {
          type: 'string',
          enum: ['daily', 'weekly', 'seasonal', 'anomalies'],
          default: 'daily',
          description: 'Type of pattern to analyze: daily (hourly usage patterns), weekly (weekday vs weekend), seasonal (monthly/quarterly trends), anomalies (detect unusual events)'
        },
        timeRange: {
          type: 'string',
          default: '30d',
          description: 'Analysis period in format "7d", "30d", "90d", or "1y"'
        }
      },
      required: ['systemId']
    }
  },
  {
    name: 'calculate_energy_budget',
    description: 'Calculate energy requirements, solar sufficiency, and system capacity for different scenarios. Critical for off-grid planning, expansion decisions, and backup requirements.',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'Battery system identifier'
        },
        scenario: {
          type: 'string',
          enum: ['current', 'worst_case', 'average', 'emergency'],
          description: 'Energy scenario to model: current (existing usage), worst_case (minimum solar + max consumption), average (typical conditions), emergency (backup power needs)'
        },
        includeWeather: {
          type: 'boolean',
          default: true,
          description: 'Include weather-based solar generation adjustments'
        },
        timeframe: {
          type: 'string',
          default: '30d',
          description: 'Timeframe for budget calculation: "7d", "30d", "90d"'
        }
      },
      required: ['systemId', 'scenario']
    }
  },
  {
    name: 'get_hourly_soc_predictions',
    description: 'Get hourly State of Charge (SOC%) predictions for past hours. Combines actual BMS data with interpolated predictions based on solar patterns, weather, and historical usage. Use this to understand battery behavior between screenshots, visualize charging/discharge curves, and answer questions about hourly SOC trends. Returns timestamp, SOC%, and whether each data point is actual or predicted.',
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'Battery system identifier'
        },
        hoursBack: {
          type: 'number',
          default: 72,
          description: 'Number of hours to predict backwards from now (default: 72 hours / 3 days, max: 168 hours / 7 days)'
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
      case 'request_bms_data':
        result = await requestBmsData(parameters, log);
        break;

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

      case 'predict_battery_trends':
        result = await predictBatteryTrends(parameters, log);
        break;

      case 'analyze_usage_patterns':
        result = await analyzeUsagePatterns(parameters, log);
        break;

      case 'calculate_energy_budget':
        result = await calculateEnergyBudget(parameters, log);
        break;

      case 'get_hourly_soc_predictions':
        result = await getHourlySocPredictions(parameters, log);
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
      
      // Categorize error for better handling
      const errorCategory = categorizeToolError(error, toolName);
      
      log.error('Tool execution failed', {
        toolName,
        error: error.message,
        category: errorCategory.category,
        isRetriable: errorCategory.isRetriable,
        stack: error.stack,
        duration: `${duration}ms`,
        parameters
      });
      
      // Return error with graceful degradation info
      return {
        error: true,
        message: `Failed to execute ${toolName}: ${error.message}`,
        errorCategory: errorCategory.category,
        isRetriable: errorCategory.isRetriable,
        suggestedAction: errorCategory.suggestedAction,
        graceful_degradation: true,
        partialResults: errorCategory.canContinue ? {} : null
      };
    }
  }

/**
 * Categorize tool execution errors for better handling
 * Determines if error is retriable and suggests remediation
 * 
 * @param {Error} error - The error that occurred
 * @param {string} toolName - Name of the tool that failed
 * @returns {Object} Error categorization
 * @property {string} category - Error category (network, rate_limit, database, invalid_parameters, no_data, token_limit, circuit_open, unknown)
 * @property {boolean} isRetriable - Whether the error should be retried
 * @property {boolean} canContinue - Whether system can continue with partial results (internal use only)
 * @property {string} suggestedAction - Human-readable suggested action
 */
function categorizeToolError(error, toolName) {
  // Check error code first for more reliable categorization
  if (error.code) {
    const errorCode = error.code.toString().toUpperCase();
    
    // Network error codes
    if (errorCode === 'ETIMEDOUT' || errorCode === 'ECONNREFUSED' || 
        errorCode === 'ENOTFOUND' || errorCode === 'ECONNRESET' ||
        errorCode === 'EPIPE' || errorCode === 'EHOSTUNREACH') {
      return {
        category: 'network',
        isRetriable: true,
        canContinue: true,
        suggestedAction: 'Retry with exponential backoff. System can continue with partial data.'
      };
    }
  }
  
  const errorMessage = error.message?.toLowerCase() || '';
  
  // Network/connectivity errors - retriable
  if (errorMessage.includes('network') || 
      errorMessage.includes('timeout') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('fetch failed')) {
    return {
      category: 'network',
      isRetriable: true,
      canContinue: true,
      suggestedAction: 'Retry with exponential backoff. System can continue with partial data.'
    };
  }
  
  // Rate limiting - retriable with delay
  if (errorMessage.includes('rate limit') || 
      errorMessage.includes('429') ||
      errorMessage.includes('quota')) {
    return {
      category: 'rate_limit',
      isRetriable: true,
      canContinue: true,
      suggestedAction: 'Wait before retry. Reduce request frequency. Analysis can proceed with available data.'
    };
  }
  
  // Database errors - potentially retriable
  if (errorMessage.includes('database') || 
      errorMessage.includes('mongodb') ||
      errorMessage.includes('connection')) {
    return {
      category: 'database',
      isRetriable: true,
      canContinue: true,
      suggestedAction: 'Retry database operation. Check connection pool status.'
    };
  }
  
  // Invalid parameters - not retriable
  if (errorMessage.includes('invalid') || 
      errorMessage.includes('required') ||
      errorMessage.includes('parameter')) {
    return {
      category: 'invalid_parameters',
      isRetriable: false,
      canContinue: true,
      suggestedAction: `Fix ${toolName} parameters. Check parameter types and required fields.`
    };
  }
  
  // Data not found - not an error, system can continue
  if (errorMessage.includes('not found') || 
      errorMessage.includes('no data') ||
      errorMessage.includes('empty')) {
    return {
      category: 'no_data',
      isRetriable: false,
      canContinue: true,
      suggestedAction: 'No action needed. System will proceed with available data from other sources.'
    };
  }
  
  // Token limit exceeded - special handling
  if (errorMessage.includes('token') && 
      (errorMessage.includes('limit') || errorMessage.includes('exceeded'))) {
    return {
      category: 'token_limit',
      isRetriable: true,
      canContinue: true,
      suggestedAction: 'Reduce context size. Use smaller time windows or daily aggregation instead of hourly.'
    };
  }
  
  // Circuit breaker open - retriable after cooldown
  if (errorMessage.includes('circuit') && errorMessage.includes('open')) {
    return {
      category: 'circuit_open',
      isRetriable: true,
      canContinue: true,
      suggestedAction: 'Wait for circuit breaker to reset. Service is temporarily unavailable.'
    };
  }
  
  // Default: unknown error
  return {
    category: 'unknown',
    isRetriable: true,
    canContinue: true,
    suggestedAction: 'Investigate error cause. System will attempt to continue with partial results.'
  };
}

/**
 * Request BMS data with specified granularity and metric filtering
 * This is the primary data access tool for Gemini
 * Implements intelligent data size limits to prevent timeouts
 */
async function requestBmsData(params, log) {
  log.info('requestBmsData called with params', { params });
  if (!getCollection) {
    log.error('Database connection not available for requestBmsData');
    throw new Error('Database connection not available');
  }

  const {
    systemId,
    metric = 'all',
    time_range_start,
    time_range_end,
    granularity = 'hourly_avg'
  } = params;

  log.info('Processing BMS data request', {
    systemId,
    metric,
    time_range_start,
    time_range_end,
    granularity
  });

  // Validate time range
  const startDate = new Date(time_range_start);
  const endDate = new Date(time_range_end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format. Use ISO 8601 format (e.g., "2025-11-01T00:00:00Z")');
  }

  if (startDate >= endDate) {
    throw new Error('time_range_start must be before time_range_end');
  }

  const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
  log.debug('Time range parsed', { startDate, endDate, daysDiff });

  const historyCollection = await getCollection('history');

  // Build query
  const query = {
    systemId,
    timestamp: {
      $gte: startDate.toISOString(),
      $lte: endDate.toISOString()
    }
  };

  // Project only needed fields to reduce data transfer
  const projection = {
    _id: 0,
    timestamp: 1,
    analysis: 1
  };

  const queryStartTime = Date.now();
  const records = await historyCollection
    .find(query, { projection })
    .sort({ timestamp: 1 })
    .toArray();

  const queryDuration = Date.now() - queryStartTime;
  log.info('Raw records fetched', {
    count: records.length,
    queryDuration: `${queryDuration}ms`
  });

  if (records.length === 0) {
    return {
      systemId,
      metric,
      time_range: { start: time_range_start, end: time_range_end },
      granularity,
      dataPoints: 0,
      message: 'No data found for the specified time range',
      data: []
    };
  }

  // Process based on granularity
  let processedData;
  if (granularity === 'raw') {
    // Return raw records (filtered by metric if specified)
    // Apply intelligent sampling for large datasets
    const maxRawPoints = 500; // Limit raw data to prevent token overflow
    let sampledRecords = records;

    if (records.length > maxRawPoints) {
      log.warn('Raw data exceeds limit, applying sampling', {
        originalCount: records.length,
        maxPoints: maxRawPoints
      });

      // Sample evenly across the time range
      const step = Math.ceil(records.length / maxRawPoints);
      sampledRecords = records.filter((_, index) => index % step === 0);

      // Always include last record
      if (sampledRecords[sampledRecords.length - 1] !== records[records.length - 1]) {
        sampledRecords.push(records[records.length - 1]);
      }
    }

    processedData = sampledRecords.map(r => ({
      timestamp: r.timestamp,
      ...extractMetrics(r.analysis, metric)
    }));
  } else if (granularity === 'hourly_avg') {
    // Aggregate into hourly buckets
    const hourlyData = aggregateHourlyData(records, log);

    // Apply intelligent sampling if dataset is very large
    const maxHourlyPoints = 200; // ~8 days of hourly data
    const sampledHourly = sampleDataPoints(hourlyData, maxHourlyPoints, log);

    processedData = sampledHourly.map(h => ({
      timestamp: h.timestamp,
      dataPoints: h.dataPoints,
      ...filterMetrics(h.metrics, metric)
    }));
  } else if (granularity === 'daily_avg') {
    // Aggregate into daily buckets
    processedData = aggregateDailyData(records, metric, log);
  } else {
    throw new Error(`Unknown granularity: ${granularity}`);
  }

  const resultSize = JSON.stringify(processedData).length;
  const estimatedTokens = Math.ceil(resultSize / 4);

  // Warn if response is still very large
  if (estimatedTokens > 20000) {
    log.warn('Response size still large after optimization', {
      estimatedTokens,
      dataPoints: processedData.length,
      suggestion: 'Consider requesting specific metrics or smaller time range'
    });
  }

  log.info('BMS data request completed', {
    systemId,
    metric,
    granularity,
    outputDataPoints: processedData.length,
    resultSize,
    estimatedTokens
  });

  const result = {
    systemId,
    metric,
    time_range: { start: time_range_start, end: time_range_end },
    granularity,
    dataPoints: processedData.length,
    data: processedData,
    ...(records.length > processedData.length && {
      note: `Data was sampled from ${records.length} records to ${processedData.length} points for optimization`
    })
  };

  log.info('requestBmsData returning result', { result });

  return result;
}

/**
 * Extract specified metrics from analysis data
 */
function extractMetrics(analysis, metric) {
  if (!analysis) return {};

  if (metric === 'all') {
    return {
      voltage: analysis.overallVoltage,
      current: analysis.current,
      power: analysis.power,
      soc: analysis.stateOfCharge,
      capacity: analysis.remainingCapacity,
      temperature: analysis.temperature,
      mosTemperature: analysis.mosTemperature,
      cellVoltageDiff: analysis.cellVoltageDifference
    };
  }

  const metricMap = {
    voltage: { voltage: analysis.overallVoltage },
    current: { current: analysis.current },
    power: { power: analysis.power },
    soc: { soc: analysis.stateOfCharge },
    capacity: { capacity: analysis.remainingCapacity },
    temperature: {
      temperature: analysis.temperature,
      mosTemperature: analysis.mosTemperature
    },
    cell_voltage_difference: { cellVoltageDiff: analysis.cellVoltageDifference }
  };

  return metricMap[metric] || {};
}

/**
 * Filter averaged metrics based on requested metric
 */
function filterMetrics(metrics, metric) {
  if (!metrics) return {};

  if (metric === 'all') return metrics;

  const metricMap = {
    voltage: { avgVoltage: metrics.avgVoltage },
    current: {
      avgCurrent: metrics.avgCurrent,
      avgChargingCurrent: metrics.avgChargingCurrent,
      avgDischargingCurrent: metrics.avgDischargingCurrent,
      chargingCount: metrics.chargingCount,
      dischargingCount: metrics.dischargingCount
    },
    power: {
      avgPower: metrics.avgPower,
      avgChargingPower: metrics.avgChargingPower,
      avgDischargingPower: metrics.avgDischargingPower
    },
    soc: { avgSoC: metrics.avgSoC },
    capacity: { avgCapacity: metrics.avgCapacity },
    temperature: {
      avgTemperature: metrics.avgTemperature,
      avgMosTemperature: metrics.avgMosTemperature
    },
    cell_voltage_difference: { avgCellVoltageDiff: metrics.avgCellVoltageDiff }
  };

  return metricMap[metric] || metrics;
}

/**
 * Aggregate records into daily buckets
 */
function aggregateDailyData(records, metric, log) {
  const dailyBuckets = new Map();

  for (const record of records) {
    if (!record.timestamp || !record.analysis) continue;

    const timestamp = new Date(record.timestamp);
    const dayBucket = new Date(timestamp);
    dayBucket.setHours(0, 0, 0, 0);
    const bucketKey = dayBucket.toISOString();

    if (!dailyBuckets.has(bucketKey)) {
      dailyBuckets.set(bucketKey, []);
    }
    dailyBuckets.get(bucketKey).push(record);
  }

  log.debug('Records grouped into daily buckets', { bucketCount: dailyBuckets.size });

  const dailyData = [];
  for (const [bucketKey, bucketRecords] of dailyBuckets.entries()) {
    // Reuse hourly aggregation logic with 24-hour bucket for daily energy calculations
    const dummyLog = { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
    const metrics = computeBucketMetrics(bucketRecords, dummyLog, { bucketHours: 24 });

    dailyData.push({
      timestamp: bucketKey,
      dataPoints: bucketRecords.length,
      ...filterMetrics(metrics, metric)
    });
  }

  dailyData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return dailyData;
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

/**
 * Predict battery trends using time series analysis
 * Implements linear regression and statistical forecasting
 */
async function predictBatteryTrends(params, log) {
  const { systemId, metric, forecastDays = 30, confidenceLevel = true } = params;

  log.info('Predicting battery trends', { systemId, metric, forecastDays });

  try {
    // Route to appropriate prediction function based on metric
    switch (metric) {
      case 'capacity':
        return await forecasting.predictCapacityDegradation(systemId, forecastDays, confidenceLevel, log);

      case 'efficiency':
        return await forecasting.predictEfficiency(systemId, forecastDays, confidenceLevel, log);

      case 'temperature':
        return await forecasting.predictTemperature(systemId, forecastDays, confidenceLevel, log);

      case 'voltage':
        return await forecasting.predictVoltage(systemId, forecastDays, confidenceLevel, log);

      case 'lifetime':
        return await forecasting.predictLifetime(systemId, confidenceLevel, log);

      default:
        throw new Error(`Unsupported metric for prediction: ${metric}`);
    }
  } catch (error) {
    log.error('Prediction failed', {
      error: error.message,
      systemId,
      metric
    });
    return {
      error: true,
      message: `Unable to generate ${metric} prediction: ${error.message}`,
      systemId,
      metric
    };
  }
}

/**
 * Get hourly SOC predictions for past hours
 */
async function getHourlySocPredictions(params, log) {
  const { systemId, hoursBack = 72 } = params;

  log.info('Getting hourly SOC predictions', { systemId, hoursBack });

  try {
    // Validate hoursBack range
    const validatedHoursBack = Math.min(Math.max(1, hoursBack), 168); // Max 7 days

    if (validatedHoursBack !== hoursBack) {
      log.warn('hoursBack adjusted to valid range', {
        requested: hoursBack,
        adjusted: validatedHoursBack
      });
    }

    return await forecasting.predictHourlySoc(systemId, validatedHoursBack, log);
  } catch (error) {
    log.error('Hourly SOC prediction failed', {
      error: error.message,
      systemId,
      hoursBack
    });
    return {
      error: true,
      message: `Unable to generate hourly SOC predictions: ${error.message}`,
      systemId,
      hoursBack
    };
  }
}

/**
 * Analyze usage patterns (daily, weekly, seasonal, anomalies)
 */
async function analyzeUsagePatterns(params, log) {
  const { systemId, patternType = 'daily', timeRange = '30d' } = params;

  log.info('Analyzing usage patterns', { systemId, patternType, timeRange });

  try {
    // Route to appropriate analysis function
    switch (patternType) {
      case 'daily':
        return await patternAnalysis.analyzeDailyPatterns(systemId, timeRange, log);

      case 'weekly':
        return await patternAnalysis.analyzeWeeklyPatterns(systemId, timeRange, log);

      case 'seasonal':
        return await patternAnalysis.analyzeSeasonalPatterns(systemId, timeRange, log);

      case 'anomalies':
        return await patternAnalysis.detectAnomalies(systemId, timeRange, log);

      default:
        throw new Error(`Unsupported pattern type: ${patternType}`);
    }
  } catch (error) {
    log.error('Pattern analysis failed', {
      error: error.message,
      systemId,
      patternType
    });
    return {
      error: true,
      message: `Unable to analyze ${patternType} patterns: ${error.message}`,
      systemId,
      patternType
    };
  }
}

/**
 * Calculate energy budget for different scenarios
 */
async function calculateEnergyBudget(params, log) {
  const { systemId, scenario, includeWeather = true, timeframe = '30d' } = params;

  log.info('Calculating energy budget', { systemId, scenario, includeWeather, timeframe });

  try {
    // Route to appropriate budget calculation
    switch (scenario) {
      case 'current':
        return await energyBudget.calculateCurrentBudget(systemId, timeframe, includeWeather, log);

      case 'worst_case':
        return await energyBudget.calculateWorstCase(systemId, timeframe, includeWeather, log);

      case 'average':
        return await energyBudget.calculateAverage(systemId, timeframe, includeWeather, log);

      case 'emergency':
        return await energyBudget.calculateEmergencyBackup(systemId, timeframe, log);

      default:
        throw new Error(`Unsupported scenario: ${scenario}`);
    }
  } catch (error) {
    log.error('Energy budget calculation failed', {
      error: error.message,
      systemId,
      scenario
    });
    return {
      error: true,
      message: `Unable to calculate ${scenario} energy budget: ${error.message}`,
      systemId,
      scenario
    };
  }
}

module.exports = {
  toolDefinitions,
  executeToolCall
};

