/**
 * Generate Insights Status - Job Status Polling Endpoint
 * 
 * Allows clients to poll for the status of background insights jobs.
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getInsightsJob } = require('./utils/insights-jobs.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

/**
 * Extract jobId from event (POST body or query params)
 * @param {Object} event - Netlify event
 * @returns {string|null} jobId if found
 */
function extractJobId(event) {
  try {
    if (event.httpMethod === 'POST' && event.body) {
      const body = JSON.parse(event.body);
      return body.jobId || null;
    } else if (event.queryStringParameters) {
      return event.queryStringParameters.jobId || null;
    }
  } catch (e) {
    // Parse error - return null
  }
  return null;
}

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  // Extract jobId for logging context
  const jobId = extractJobId(event);

  const log = createLoggerFromEvent('generate-insights-status', event, context, { jobId });
  log.entry({ method: event.httpMethod, path: event.path, jobId });
  const timer = createTimer(log, 'status-check');

  if (!validateEnvironment(log)) {
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    if (!jobId) {
      log.warn('Missing jobId in request');
      log.exit(400);
      timer.end({ error: 'missing_jobId' });
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'jobId is required' 
        })
      };
    }

    log.debug('Fetching job status', { jobId });

    // Get job from database
    const dbTimer = createTimer(log, 'database-lookup');
    const job = await getInsightsJob(jobId, log);
    dbTimer.end({ found: !!job });

    if (!job) {
      log.warn('Job not found', { jobId });
      log.exit(404, { jobId });
      timer.end({ status: 'not_found' });
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Job not found',
          jobId 
        })
      };
    }

    log.info('Job status retrieved', { jobId, status: job.status });

    // Build response based on job status
    const response = {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };

    // Add status-specific fields
    if (job.status === 'completed') {
      response.insights = job.finalInsights;
      response.completedAt = job.updatedAt;
      response.metadata = {
        turns: job.finalInsights?.turns || 0,
        toolCalls: job.finalInsights?.toolCalls || 0
      };
    } else if (job.status === 'failed') {
      // Issue 236: Enhanced error context for failed jobs
      response.error = job.error;
      response.failedAt = job.updatedAt;
      
      // Extract meaningful failure reason from error message
      const failureReason = extractFailureReason(job.error, job.progress || []);
      response.failureReason = failureReason.reason;
      response.failureCategory = failureReason.category;
      response.suggestions = failureReason.suggestions;
      
      // Include last progress event for context
      if (job.progress && job.progress.length > 0) {
        response.lastProgressEvent = job.progress[job.progress.length - 1];
        response.progressCount = job.progress.length;
      }
    } else if (job.status === 'processing') {
      response.progress = job.progress || [];
      response.partialInsights = job.partialInsights;
      response.progressCount = (job.progress || []).length;
      
      // Include current stage info for status bar
      if (job.progress && job.progress.length > 0) {
        const lastEvent = job.progress[job.progress.length - 1];
        response.currentStage = formatCurrentStage(lastEvent);
      }
    }

    const durationMs = timer.end({ jobId, status: job.status });
    log.info('Status check completed', { 
      jobId, 
      status: job.status,
      durationMs
    });

    log.exit(200, { jobId, status: job.status });
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    timer.end({ error: true });
    log.error('Status check failed', {
      error: error.message,
      stack: error.stack,
      jobId,
      errorType: error.constructor?.name
    });

    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to check job status',
        message: error.message
      })
    };
  }
};

/**
 * Issue 236: Extract meaningful failure reason from error message and progress events
 * @param {string} errorMessage - Raw error message
 * @param {Array} progress - Progress events from the job
 * @returns {{ reason: string, category: string, suggestions: string[] }}
 */
function extractFailureReason(errorMessage, progress) {
  const message = (errorMessage || '').toLowerCase();
  
  // Default response
  let result = {
    reason: errorMessage || 'Unknown error occurred',
    category: 'unknown',
    suggestions: ['Try again in a few moments', 'Check if the system has sufficient data']
  };

  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out')) {
    result = {
      reason: 'The analysis took too long to complete',
      category: 'timeout',
      suggestions: [
        'Reduce the time range for analysis',
        'Ask a more specific question instead of a broad analysis',
        'Break complex queries into multiple simpler questions'
      ]
    };
  }
  // Rate limit errors
  else if (message.includes('rate limit') || message.includes('quota')) {
    result = {
      reason: 'AI service rate limit exceeded',
      category: 'rate_limit',
      suggestions: [
        'Wait 1-2 minutes before trying again',
        'Reduce the frequency of analysis requests'
      ]
    };
  }
  // Token/context limit errors
  else if (message.includes('token') || message.includes('context length') || message.includes('too large')) {
    result = {
      reason: 'The amount of data exceeded AI processing limits',
      category: 'token_limit',
      suggestions: [
        'Reduce the analysis time range',
        'Focus on a specific date range or metric',
        'Use a shorter custom prompt'
      ]
    };
  }
  // Database errors
  else if (message.includes('mongodb') || message.includes('database') || message.includes('connection')) {
    result = {
      reason: 'Database connection issue',
      category: 'database',
      suggestions: [
        'This is usually temporary - try again in a moment',
        'If the issue persists, the system may be undergoing maintenance'
      ]
    };
  }
  // Gemini API errors
  else if (message.includes('gemini') || message.includes('api') || message.includes('model')) {
    result = {
      reason: 'AI service encountered an error',
      category: 'ai_service',
      suggestions: [
        'Try again in a few moments',
        'If the issue persists, the AI service may be experiencing issues'
      ]
    };
  }
  // Network errors
  else if (message.includes('network') || message.includes('econnrefused') || message.includes('fetch')) {
    result = {
      reason: 'Network connectivity issue',
      category: 'network',
      suggestions: [
        'Check your internet connection',
        'Try again in a moment'
      ]
    };
  }
  // Circuit breaker
  else if (message.includes('circuit') || message.includes('circuit_open')) {
    result = {
      reason: 'Service temporarily unavailable due to high load',
      category: 'circuit_breaker',
      suggestions: [
        'Wait 30-60 seconds before trying again',
        'The system is protecting itself from overload'
      ]
    };
  }

  // Check progress events for more context
  if (progress && progress.length > 0) {
    const lastEvent = progress[progress.length - 1];
    if (lastEvent && lastEvent.type === 'error' && lastEvent.data) {
      // Enhance the reason with last progress event info
      if (lastEvent.data.message && !result.reason.includes(lastEvent.data.message)) {
        result.reason += ` (${lastEvent.data.message})`;
      }
    }
    
    // Check for tool-specific failures
    const toolErrorEvent = progress.find(e => e.type === 'tool_call' && e.data?.error);
    if (toolErrorEvent) {
      result.reason = `Tool execution failed: ${toolErrorEvent.data.toolName || 'unknown tool'}`;
      result.suggestions.unshift('The specific tool that failed may have had data issues');
    }
  }

  return result;
}

/**
 * Issue 236: Format current processing stage for status bar display
 * @param {Object} lastEvent - Last progress event
 * @returns {string} - Human-readable stage description
 */
function formatCurrentStage(lastEvent) {
  if (!lastEvent) return 'Processing...';

  switch (lastEvent.type) {
    case 'tool_call':
      const toolName = lastEvent.data?.toolName || 'unknown';
      return `🔧 Fetching ${formatToolName(toolName)}...`;
    case 'tool_response':
      return '✓ Data received, analyzing...';
    case 'ai_response':
      return '🤖 AI generating insights...';
    case 'iteration':
      const iter = lastEvent.data?.iteration || '?';
      const max = lastEvent.data?.maxIterations || '?';
      return `📈 Analysis iteration ${iter}/${max}`;
    case 'status':
      return lastEvent.data?.message || 'Processing...';
    case 'error':
      return `⚠️ ${lastEvent.data?.message || 'Error encountered'}`;
    default:
      return 'Processing...';
  }
}

/**
 * Format tool name for display
 * @param {string} toolName - Tool function name
 * @returns {string} - Human-readable name
 */
function formatToolName(toolName) {
  // Normalize tool name to lowercase for consistent matching
  const normalizedName = (toolName || '').toLowerCase();
  
  const nameMap = {
    'request_bms_data': 'BMS historical data',
    'calculate_energy_budget': 'energy budget',
    'predict_battery_trends': 'trend predictions',
    'analyze_usage_patterns': 'usage patterns',
    'getweatherdata': 'weather data',
    'getsolarestimate': 'solar estimates',
    'getsystemanalytics': 'system analytics',
    'get_hourly_soc_predictions': 'SOC predictions'
  };
  return nameMap[normalizedName] || toolName;
}
