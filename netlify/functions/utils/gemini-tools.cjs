// @ts-nocheck
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
// Dynamic import for node-fetch to handle ESM in CJS context
/** @type {any} */
let fetch;
try {
  // In production/Netlify, use dynamic import
  if (typeof window === 'undefined') {
    fetch = (/** @type {any[]} */ ...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
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

// GitHub API integration for repository access
let githubApi;
try {
  githubApi = require('./github-api.cjs');
} catch (err) {
  // GitHub API not available - tools will return errors gracefully
  // Log the error for debugging in development
  if (process.env.LOG_LEVEL === 'DEBUG') {
    console.warn('GitHub API module not available:', err.message);
  }
  githubApi = null;
}

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
  },
  {
    name: 'submitAppFeedback',
    description: `Submit feedback or suggestions for improving the BMSview application. Use this tool when you identify:
• Data format inefficiencies or improvements
• Better API integrations (e.g., more accurate weather/solar services)
• UI/UX improvements based on data patterns you observe
• New features that would benefit users based on their usage patterns
• Missing data points that would improve analysis accuracy
• Performance optimizations or data processing improvements
• Bug reports or issues you notice during analysis

The feedback will be saved to the AI Feedback panel in the Admin Dashboard where it can be reviewed, prioritized, and potentially auto-generate GitHub issues. This is your way to actively improve the application!`,
    parameters: {
      type: 'object',
      properties: {
        systemId: {
          type: 'string',
          description: 'The system ID context for this feedback (use the current system being analyzed)'
        },
        feedbackType: {
          type: 'string',
          enum: ['feature_request', 'api_suggestion', 'data_format', 'bug_report', 'optimization'],
          description: 'Type of feedback: feature_request (new capability), api_suggestion (better external service), data_format (data structure improvement), bug_report (issue found), optimization (performance improvement)'
        },
        category: {
          type: 'string',
          enum: ['weather_api', 'data_structure', 'ui_ux', 'performance', 'integration', 'analytics'],
          description: 'Category: weather_api, data_structure, ui_ux, performance, integration, analytics'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Priority level based on impact and urgency'
        },
        content: {
          type: 'object',
          description: 'Detailed feedback content',
          properties: {
            title: {
              type: 'string',
              description: 'Brief, descriptive title (max 100 chars)'
            },
            description: {
              type: 'string',
              description: 'Detailed description of the suggestion or issue'
            },
            rationale: {
              type: 'string',
              description: 'Why this improvement matters - what problem does it solve?'
            },
            implementation: {
              type: 'string',
              description: 'How to implement it - technical approach or steps'
            },
            expectedBenefit: {
              type: 'string',
              description: 'Expected benefits - quantify if possible (e.g., "60% reduction in payload size")'
            },
            estimatedEffort: {
              type: 'string',
              enum: ['hours', 'days', 'weeks'],
              description: 'Estimated implementation effort'
            },
            codeSnippets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Example code snippets if applicable'
            },
            affectedComponents: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of components/files that would be affected'
            }
          },
          required: ['title', 'description', 'rationale', 'implementation', 'expectedBenefit', 'estimatedEffort']
        },
        guruSource: {
          type: 'string',
          enum: ['diagnostics-guru', 'battery-guru', 'visual-guru', 'full-context-guru', 'quick-guru', 'manual'],
          description: 'Which Guru mode generated this feedback. Used for filtering in Admin Dashboard. Use "battery-guru" for standard insights, "diagnostics-guru" for tool testing/failures, "visual-guru" for chart improvements, "full-context-guru" for deep analysis, "quick-guru" for performance optimizations, "manual" for admin/user submitted.',
          default: 'battery-guru'
        }
      },
      required: ['systemId', 'feedbackType', 'category', 'priority', 'content']
    }
  },
  {
    name: 'searchGitHubIssues',
    description: `Search existing GitHub issues in the BMSview repository. **CRITICAL: ALWAYS use this before creating or suggesting new GitHub issues** to prevent duplicates and reference related work.

Usage Guidelines:
• **Before suggesting new features or fixes**: Search for related issues first
• **When creating GitHub issues**: Check if similar issues exist
• **Query tips**: Use keywords from the issue title and description
• **State filter**: Use 'all' to search both open and closed issues

This tool helps you:
- Avoid duplicate issue creation
- Find related discussions and implementation details
- Reference existing work in new issues
- Understand current project priorities

Example queries:
- "solar API integration" - Find solar-related issues
- "timeout error" - Find timeout-related bugs
- "admin dashboard" - Find UI/UX improvements`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string. Use keywords from issue title/description. Example: "solar API", "timeout fix", "admin panel"'
        },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          default: 'all',
          description: 'Filter by issue state. Use "all" to search both open and closed issues (recommended for duplicate detection).'
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by labels. Examples: ["ai-generated", "enhancement", "bug"]'
        },
        per_page: {
          type: 'number',
          default: 30,
          description: 'Number of results to return (max 100, default 30)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'getCodebaseFile',
    description: `Fetch file contents from the BMSview repository. **USE THIS to verify implementations before making suggestions** about code changes or features.

Security & Access:
• Only allowed paths can be accessed (netlify/functions, components, services, state, hooks, utils, docs, config files)
• Blocked paths: .env, .git, node_modules, coverage, dist
• Files larger than 15KB are automatically truncated
• Directory traversal attempts are blocked

Usage Guidelines:
• **Before suggesting code changes**: Fetch the file to see current implementation
• **When proposing new features**: Check if similar functionality already exists
• **For architecture questions**: Review relevant files (ARCHITECTURE.md, component files)
• **Error messages**: Include actual file path in your recommendation

Example paths:
- "netlify/functions/solar-estimate.ts" - Solar integration function
- "components/AnalysisResult.tsx" - Main results display component
- "ARCHITECTURE.md" - System architecture documentation
- "types.ts" - TypeScript type definitions`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path in repository (e.g., "netlify/functions/analyze.cjs", "components/UploadSection.tsx", "ARCHITECTURE.md")'
        },
        ref: {
          type: 'string',
          default: 'main',
          description: 'Git ref (branch, tag, or commit SHA). Defaults to "main" branch.'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'listDirectory',
    description: `List contents of a directory in the BMSview repository. **USE THIS to discover available files** before fetching specific files or when you need to understand directory structure.

Security & Access:
• Same security restrictions as getCodebaseFile
• Only allowed directories can be listed
• Directory traversal is blocked

Usage Guidelines:
• **Before fetching files**: List directory to see what files are available
• **For component discovery**: List "components/" to see all UI components
• **For function discovery**: List "netlify/functions/" to see all serverless functions
• **For documentation**: List "docs/" to find relevant documentation files

Example paths:
- "netlify/functions" - List all serverless functions
- "components" - List all React components
- "docs" - List documentation files
- "netlify/functions/utils" - List utility modules`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path in repository (e.g., "netlify/functions", "components", "docs")'
        },
        ref: {
          type: 'string',
          default: 'main',
          description: 'Git ref (branch, tag, or commit SHA). Defaults to "main" branch.'
        }
      },
      required: ['path']
    }
  }
];

/**
 * Execute a tool call and return the result
/**
 * @typedef {Object} ToolError
 * @property {string} message
 * @property {string} [code]
 * @property {Object} [info]
 * @property {string} [category]
 * @property {boolean} [isRetriable]
 * @property {string} [suggestedAction]
 * @property {boolean} [canContinue]
 */

/**
 * Executes a tool call from Gemini
 * @param {string} name 
 * @param {Object.<string, any>} params 
 * @param {Object} log 
 * @returns {Promise<Object>}
 */
async function executeToolCall(name, params, log) {
  const start = Date.now();

  try {
    log.info(`Executing tool: ${name}`, { params });

    switch (name) {
      case 'request_bms_data':
        return await requestBmsData(params, log);
      case 'getWeatherData':
        return await getWeatherData(params, log);
      case 'getSolarEstimate':
        return await getSolarEstimate(params, log);
      case 'analyze_usage_patterns':
        return await analyzeUsagePatterns(params, log);
      case 'calculate_energy_budget':
        return await calculateEnergyBudget(params, log);
      case 'predict_battery_trends':
        return await predictBatteryTrends(params, log);
      case 'getSystemAnalytics':
        return await getSystemAnalytics(params, log);
      case 'getHourlySocPredictions':
      case 'get_hourly_soc_predictions':
        return await getHourlySocPredictions(params, log);
      case 'submitAppFeedback':
        return await submitAppFeedback(params, log);
      case 'searchGitHubIssues':
        return await searchGitHubIssues(params, log);
      case 'getCodebaseFile':
        return await getCodebaseFile(params, log);
      case 'listDirectory':
        return await listDirectory(params, log);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const duration = Date.now() - start;
    const err = /** @type {any} */ (error);

    // Categorize error for better handling
    const errorCategory = categorizeToolError(err, name);

    log.error('Tool execution failed', {
      toolName: name,
      error: err.message,
      category: errorCategory.category,
      isRetriable: errorCategory.isRetriable,
      stack: err.stack,
      duration: `${duration}ms`,
      parameters: params
    });

    // Return error with graceful degradation info
    return {
      error: true,
      message: `Failed to execute ${name}: ${err.message}`,
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
 * @returns {{category: string, isRetriable: boolean, canContinue: boolean, suggestedAction: string}} Error categorization
 */
function categorizeToolError(error, toolName) {
  const err = /** @type {any} */ (error);
  // Check error code first for more reliable categorization
  if (err.code) {
    const errorCode = err.code.toString().toUpperCase();

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
 * Request BMS data from the history collection
 * @param {any} params 
 * @param {any} log 
 * @returns {Promise<Object>}
 */
async function requestBmsData(params, log) {
  const { systemId, metric, time_range_start, time_range_end, granularity } = params;
  log.info('request_bms_data called', { systemId, metric, time_range_start, time_range_end, granularity });

  if (!getCollection) {
    throw new Error('Database connection not available');
  }

  // Validate dates
  const startDate = new Date(time_range_start);
  const endDate = new Date(time_range_end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format. Use ISO 8601.');
  }

  if (startDate >= endDate) {
    throw new Error('time_range_start must be before time_range_end');
  }

  const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  log.debug('Time range parsed', { startDate, endDate, daysDiff });

  // MOCK DATA FOR TEST SYSTEM
  if (systemId === 'test-system') {
    log.info('Generating mock data for test-system', { daysDiff, granularity });

    // Generate simple linear mock data
    /** @type {Array<Object>} */
    const data = [];
    let currentDate = new Date(startDate);
    const end = new Date(endDate);

    while (currentDate <= end) {
      data.push({
        timestamp: currentDate.toISOString(),
        avgVoltage: 53.0 + (Math.random() * 2 - 1),
        avgSoC: 80 + (Math.random() * 20 - 10),
        avgCurrent: Math.random() * 20 - 10,
        avgPower: Math.random() * 1000 - 500
      });

      if (granularity === 'hourly_avg') {
        currentDate.setHours(currentDate.getHours() + 1);
      } else {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    return {
      systemId,
      metric,
      time_range: { start: time_range_start, end: time_range_end },
      granularity,
      dataPoints: data.length,
      data: data,
      note: 'Mock data generated for test-system'
    };
  }

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
      sampledRecords = records.filter((/** @type {any} */ _, /** @type {number} */ index) => index % step === 0);

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
/**
 * Filter metrics
 * @param {any} metrics
 * @param {string} metric
 * @returns {Object}
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
/**
 * Aggregate records into daily buckets
 * @param {Array<any>} records 
 * @param {string} metric 
 * @param {any} log 
 * @returns {Array<Object>}
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
    const metrics = computeBucketMetrics(bucketRecords, dummyLog, { bucketHours: 24, chargingThreshold: 50, dischargingThreshold: -50 });

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
/**
 * Get historical battery measurements for a system
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
    records: records.map((/** @type {any} */ r) => ({
      timestamp: r.timestamp,
      analysis: r.analysis,
      weather: r.weather
    }))
  };
}

/**
 * Get weather data for a location
 */
/**
 * Get weather data
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
/**
 * Get solar estimate
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
/**
 * Get system analytics
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
/**
 * Predict battery trends
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
    const err = /** @type {any} */ (error);
    log.error('Prediction failed', {
      error: err.message,
      systemId: params.systemId, // Use params directly
      metric: params.metric,     // Use params directly
      forecastDays: params.forecastDays, // Use params directly
      confidenceLevel: params.confidenceLevel, // Use params directly
      stack: err.stack
    });
    return {
      error: true,
      message: `Unable to generate ${params.metric} prediction: ${err.message}`, // Use params directly
      systemId: params.systemId, // Use params directly
      metric: params.metric      // Use params directly
    };
  }
}

/**
 * Get hourly SOC predictions for past hours
 */
/**
 * Get hourly SOC predictions
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
    const err = /** @type {any} */ (error);
    log.error('Failed to get hourly SOC predictions', {
      error: err.message,
      systemId,
      hoursBack
    });
    return {
      error: true,
      message: `Unable to generate hourly SOC predictions: ${err.message}`,
      systemId,
      hoursBack
    };
  }
}

/**
 * Analyze usage patterns (daily, weekly, seasonal, anomalies)
 */
/**
 * Analyze usage patterns
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
    const err = /** @type {any} */ (error);
    log.error('Failed to analyze usage patterns', {
      error: err.message,
      systemId,
      patternType
    });
    return {
      error: true,
      message: `Unable to analyze ${patternType} patterns: ${err.message}`,
      systemId,
      patternType
    };
  }
}

/**
 * Calculate energy budget for different scenarios
 */
/**
 * Calculate energy budget
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
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
    const err = /** @type {any} */ (error);
    log.error('Failed to calculate energy budget', {
      error: err.message,
      systemId,
      scenario
    });
    return {
      error: true,
      message: `Unable to calculate ${scenario} energy budget: ${err.message}`,
      systemId,
      scenario
    };
  }
}

/**
 * Submit app feedback/suggestions to the AI Feedback system
 * This allows the Battery Guru to actively suggest improvements to BMSview
 */
/**
 * Submit app feedback
 * @param {any} params
 * @param {any} log
 * @returns {Promise<Object>}
 */
async function submitAppFeedback(params, log) {
  const { systemId, feedbackType, category, priority, content, guruSource = 'battery-guru' } = params;

  log.info('Submitting app feedback', {
    systemId,
    feedbackType,
    category,
    priority,
    guruSource,
    title: content?.title
  });

  try {
    // Validate required content fields
    if (!content || !content.title || !content.description) {
      return {
        error: true,
        message: 'Missing required content fields: title and description are required',
        systemId,
        feedbackType
      };
    }

    // Import the feedback manager with error handling
    let submitFeedbackToDatabase;
    try {
      const feedbackManager = require('./feedback-manager.cjs');
      submitFeedbackToDatabase = feedbackManager.submitFeedbackToDatabase;
      if (typeof submitFeedbackToDatabase !== 'function') {
        throw new Error('submitFeedbackToDatabase is not a function');
      }
    } catch (importError) {
      const err = /** @type {any} */ (importError);
      log.error('Failed to load feedback manager module', {
        error: err.message,
        systemId,
        feedbackType
      });
      return {
        error: true,
        message: 'Feedback system is not available. The feedback-manager module could not be loaded.',
        systemId,
        feedbackType,
        suggestion: 'This may be a configuration issue. Your feedback has been logged for manual review.'
      };
    }

    // Generate a unique request ID for tracing
    const requestId = `gemini-tool-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Prepare feedback data
    const feedbackData = {
      systemId: systemId || 'unknown',
      feedbackType,
      category,
      priority,
      guruSource: guruSource || 'battery-guru',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      content: {
        title: content.title,
        description: content.description,
        rationale: content.rationale || '',
        implementation: content.implementation || '',
        expectedBenefit: content.expectedBenefit || '',
        estimatedEffort: content.estimatedEffort || 'days',
        codeSnippets: content.codeSnippets || [],
        affectedComponents: content.affectedComponents || []
      }
    };

    // Submit to database with traceable request ID
    /** @type {any} */
    const result = await submitFeedbackToDatabase(feedbackData, { awsRequestId: requestId });

    log.info('App feedback submitted successfully', {
      feedbackId: result.id,
      isDuplicate: result.isDuplicate,
      similarItems: result.similarItems?.length || 0
    });

    // Return success response that Gemini can understand
    return {
      success: true,
      feedbackId: result.id,
      isDuplicate: result.isDuplicate || false,
      message: result.isDuplicate
        ? `Similar feedback already exists (ID: ${result.id}). Your suggestion has been noted but was not duplicated.`
        : `Feedback submitted successfully! ID: ${result.id}. It will appear in the Admin Dashboard's AI Feedback panel for review.`,
      similarItems: result.similarItems || [],
      nextSteps: result.isDuplicate
        ? 'The existing feedback item will be reviewed by the admin team.'
        : [
          'Your feedback is now visible in Admin Dashboard → AI Feedback & Suggestions',
          'The admin team will review and prioritize it',
          'If marked as critical, it may auto-generate a GitHub issue'
        ]
    };

  } catch (error) {
    const err = /** @type {any} */ (error);
    log.error('Failed to submit app feedback', {
      error: err.message,
      systemId,
      feedbackType,
      stack: error.stack
    });

    return {
      error: true,
      message: `Failed to submit feedback: ${error.message}`,
      systemId,
      feedbackType,
      suggestion: 'The feedback system may be temporarily unavailable. Your suggestion has been logged and can be resubmitted later.'
    };
  }
}

/**
 * Search GitHub issues using the github-api module
 */
async function searchGitHubIssues(params, log) {
  log.info('Searching GitHub issues', { query: params.query, state: params.state });

  if (!githubApi) {
    log.error('GitHub API module not available');
    return {
      error: true,
      message: 'GitHub API module is not available. Cannot search issues.',
      suggestion: 'This feature requires the github-api module to be properly configured.'
    };
  }

  try {
    const result = await githubApi.searchGitHubIssues(params, log);

    log.info('GitHub issues search completed', {
      totalCount: result.total_count,
      returnedCount: result.items?.length || 0
    });

    return result;
  } catch (error) {
    log.error('GitHub issues search failed', {
      error: error.message,
      query: params.query
    });

    return {
      error: true,
      message: `Failed to search GitHub issues: ${error.message}`,
      query: params.query,
      suggestion: error.message.includes('rate limit')
        ? 'GitHub API rate limit reached. Please try again later.'
        : 'Check query syntax and ensure GITHUB_TOKEN is configured.'
    };
  }
}

/**
 * Get file contents from the codebase using the github-api module
 */
async function getCodebaseFile(params, log) {
  log.info('Fetching codebase file', { path: params.path, ref: params.ref });

  if (!githubApi) {
    log.error('GitHub API module not available');
    return {
      error: true,
      message: 'GitHub API module is not available. Cannot fetch files.',
      suggestion: 'This feature requires the github-api module to be properly configured.'
    };
  }

  try {
    const result = await githubApi.getCodebaseFile(params, log);

    log.info('File fetched successfully', {
      path: result.path,
      size: result.size,
      truncated: result.truncated
    });

    return result;
  } catch (error) {
    log.error('Failed to fetch file', {
      error: error.message,
      path: params.path
    });

    return {
      error: true,
      message: `Failed to fetch file: ${error.message}`,
      path: params.path,
      suggestion: error.message.includes('not allowed')
        ? 'File path is not in the allowed list. Only specific repository paths can be accessed.'
        : error.message.includes('not found')
          ? 'File does not exist at the specified path. Use listDirectory to discover available files.'
          : 'Check file path and ensure GITHUB_TOKEN is configured.'
    };
  }
}

/**
 * List directory contents using the github-api module
 */
async function listDirectory(params, log) {
  log.info('Listing directory', { path: params.path, ref: params.ref });

  if (!githubApi) {
    log.error('GitHub API module not available');
    return {
      error: true,
      message: 'GitHub API module is not available. Cannot list directories.',
      suggestion: 'This feature requires the github-api module to be properly configured.'
    };
  }

  try {
    const result = await githubApi.listDirectory(params, log);

    log.info('Directory listed successfully', {
      path: result.path,
      itemCount: result.items?.length || 0
    });

    return result;
  } catch (error) {
    log.error('Failed to list directory', {
      error: error.message,
      path: params.path
    });

    return {
      error: true,
      message: `Failed to list directory: ${error.message}`,
      path: params.path,
      suggestion: error.message.includes('not allowed')
        ? 'Directory path is not in the allowed list. Only specific repository paths can be accessed.'
        : error.message.includes('not found')
          ? 'Directory does not exist at the specified path.'
          : 'Check directory path and ensure GITHUB_TOKEN is configured.'
    };
  }
}

module.exports = {
  toolDefinitions,
  executeToolCall,
  // Export for testing
};
