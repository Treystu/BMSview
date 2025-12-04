/**
 * Insights Async Workload Client
 * 
 * Helper for triggering insights generation via Netlify Async Workloads.
 * This replaces the old in-process background execution with durable async workloads.
 * 
 * NOTE: Uses HTTP API instead of @netlify/async-workloads package to avoid 250 MB bundle size limit.
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

/**
 * Trigger insights generation async workload via HTTP API
 * 
 * This uses Netlify's async workload HTTP API instead of the AsyncWorkloadsClient
 * to avoid bundling the large @netlify/async-workloads package (which causes 250 MB limit issues).
 * 
 * @param {Object} options - Workload options
 * @param {string} options.jobId - Job identifier
 * @param {Object} [options.analysisData] - Analysis data (optional if jobId exists in DB)
 * @param {string} [options.systemId] - System identifier
 * @param {string} [options.customPrompt] - Custom user prompt
 * @param {number} [options.contextWindowDays] - Days of context to load
 * @param {number} [options.maxIterations] - Maximum AI iterations
 * @param {string} [options.modelOverride] - Gemini model override
 * @param {boolean} [options.fullContextMode] - Enable full context mode
 * @param {number} [options.priority] - Event priority (0-10, default 5)
 * @param {number|string} [options.delayUntil] - Delay execution until timestamp
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

  // Get Netlify site URL from environment
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888';
  const apiKey = process.env.AWL_API_KEY; // Async Workload API key if needed
  
  // Construct async workload send endpoint
  const endpoint = `${siteUrl}/.netlify/functions/async-workloads/send`;
  
  // Prepare request body
  const requestBody = {
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
    }
  };
  
  // Add optional parameters
  if (priority !== undefined && priority !== 5) {
    requestBody.priority = priority;
  }
  
  if (delayUntil) {
    requestBody.delayUntil = typeof delayUntil === 'number' ? delayUntil : new Date(delayUntil).getTime();
  }
  
  // Make HTTP request to trigger async workload
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to trigger async workload: ${response.status} ${errorText}`);
  }
  
  const result = await response.json();
  
  if (!result.eventId) {
    throw new Error('Async workload API did not return eventId');
  }

  return {
    eventId: result.eventId,
    jobId
  };
}

/**
 * Trigger high-priority insights workload
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
 * @param {Object} options - Workload options
 * @param {Date|number} delayUntil - When to execute (Date object or timestamp)
 * @returns {Promise<{eventId: string, jobId: string}>}
 */
async function scheduleInsightsWorkload(options, delayUntil) {
  const delayTimestamp = delayUntil instanceof Date 
    ? delayUntil.getTime() 
    : delayUntil;

  return triggerInsightsWorkload({
    ...options,
    delayUntil: delayTimestamp
  });
}

module.exports = {
  triggerInsightsWorkload,
  triggerUrgentInsightsWorkload,
  scheduleInsightsWorkload
};
