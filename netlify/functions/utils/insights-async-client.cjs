/**
 * Insights Async Workload Client
 * 
 * Helper for triggering insights generation via Netlify Async Workloads.
 * This replaces the old in-process background execution with durable async workloads.
 * 
 * Uses @netlify/async-workloads package for proper integration with Netlify's async system.
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

const { AsyncWorkloadsClient } = require('@netlify/async-workloads');

/**
 * Trigger insights generation async workload
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

  // Create async workloads client
  const client = new AsyncWorkloadsClient();

  // Send event to trigger workload
  const result = await client.send('generate-insights', {
    data: {
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
    delayUntil
  });

  if (result.sendStatus !== 'succeeded') {
    throw new Error(`Failed to trigger insights workload: ${result.sendStatus}`);
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
