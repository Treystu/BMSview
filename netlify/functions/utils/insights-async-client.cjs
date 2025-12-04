/**
 * Insights Async Workload Client
 * 
 * Triggers async workload for insights generation using TRUE Netlify Async Workloads.
 * 
 * ARCHITECTURE:
 * - Calls separate "send-insights-event" function via internal HTTP
 * - That function uses AsyncWorkloadsClient to send events
 * - Avoids importing @netlify/async-workloads in trigger function
 * - Keeps trigger lightweight while using full async workload features
 * 
 * Usage:
 * ```js
 * const { triggerInsightsWorkload } = require('./utils/insights-async-client.cjs');
 * 
 * const { eventId, jobId } = await triggerInsightsWorkload({
 *   jobId: 'job-123',
 *   analysisData: {...},
 *   systemId: 'sys-456',
 *   customPrompt: 'Analyze...',
 *   contextWindowDays: 90,
 *   maxIterations: 10,
 *   fullContextMode: true
 * });
 * ```
 */

const { createLogger } = require('./logger.cjs');

/**
 * Get base URL for internal function calls
 */
function getBaseUrl() {
  // In production, use Netlify URL
  if (process.env.URL) {
    return process.env.URL;
  }
  
  // In development, use localhost
  if (process.env.NETLIFY_DEV) {
    return 'http://localhost:8888';
  }
  
  // Fallback
  return 'http://localhost:8888';
}

/**
 * Trigger insights generation via async workload
 * 
 * Sends event to Netlify's async workload system via separate event sender function.
 * 
 * @param {Object} options - Processing options
 * @param {string} options.jobId - Job identifier
 * @param {Object} [options.analysisData] - Analysis data (optional if jobId exists in DB)
 * @param {string} [options.systemId] - System identifier
 * @param {string} [options.customPrompt] - Custom user prompt
 * @param {number} [options.contextWindowDays] - Days of context to load (default: 90)
 * @param {number} [options.maxIterations] - Maximum AI iterations (default: 10)
 * @param {string} [options.modelOverride] - Gemini model override
 * @param {boolean} [options.fullContextMode] - Enable full context mode
 * @param {number} [options.priority] - Event priority (0-10, default: 5)
 * @param {number|Date} [options.delayUntil] - Delay execution until timestamp
 * @returns {Promise<{eventId: string, jobId: string}>}
 */
async function triggerInsightsWorkload(options) {
  const {
    jobId,
    analysisData,
    systemId,
    customPrompt,
    contextWindowDays,
    maxIterations,
    modelOverride,
    fullContextMode,
    priority = 5,
    delayUntil
  } = options;

  if (!jobId) {
    throw new Error('jobId is required to trigger insights workload');
  }

  const log = createLogger('insights-async-client', { jobId });
  
  log.info('Triggering async workload', {
    jobId,
    hasAnalysisData: !!analysisData,
    systemId,
    priority,
    hasDelay: !!delayUntil
  });
  
  const baseUrl = getBaseUrl();
  
  // Call the event sender function (internal HTTP call)
  const response = await fetch(`${baseUrl}/.netlify/functions/send-insights-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      eventName: 'generate-insights',
      eventData: {
        jobId,
        analysisData,
        systemId,
        customPrompt,
        contextWindowDays,
        maxIterations,
        modelOverride,
        fullContextMode
      },
      priority,
      delayUntil: delayUntil instanceof Date ? delayUntil.getTime() : delayUntil
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    log.error('Failed to send async workload event', {
      status: response.status,
      error: errorText
    });
    throw new Error(`Failed to trigger async workload: ${response.status} ${errorText}`);
  }
  
  const result = await response.json();
  
  if (!result.success) {
    log.error('Event sender reported failure', result);
    throw new Error(`Failed to trigger async workload: ${result.error || 'Unknown error'}`);
  }
  
  log.info('Async workload triggered successfully', {
    eventId: result.eventId,
    jobId: result.jobId
  });
  
  return {
    eventId: result.eventId,
    jobId: result.jobId
  };
}

/**
 * Trigger high-priority insights workload
 * 
 * Sends event with priority 10 (highest) for urgent processing.
 * 
 * @param {Object} options - Same as triggerInsightsWorkload
 * @returns {Promise<{eventId: string, jobId: string}>}
 */
async function triggerUrgentInsightsWorkload(options) {
  return triggerInsightsWorkload({
    ...options,
    priority: 10 // Highest priority
  });
}

/**
 * Schedule insights workload for future execution
 * 
 * Delays event execution until specified time using Netlify Async Workloads scheduling.
 * 
 * @param {Object} options - Workload options
 * @param {Date|number} delayUntil - When to execute (Date object or Unix timestamp)
 * @returns {Promise<{eventId: string, jobId: string}>}
 */
async function scheduleInsightsWorkload(options, delayUntil) {
  return triggerInsightsWorkload({
    ...options,
    delayUntil
  });
}

module.exports = {
  triggerInsightsWorkload,
  triggerUrgentInsightsWorkload,
  scheduleInsightsWorkload
};
