/**
 * Insights Async Workload Client
 * 
 * Triggers async workload for insights generation using TRUE Netlify Async Workloads.
 * 
 * DIRECT ARCHITECTURE (No intermediate function):
 * - Uses AsyncWorkloadsClient directly from @netlify/async-workloads
 * - Package is externalized via netlify.toml configuration
 * - This file is used by trigger function which ALSO has external_node_modules config
 * - Avoids bundle size issues while maintaining full async workload features
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
const { createLogger } = require('./logger.cjs');

/**
 * Trigger insights generation via async workload
 * 
 * Sends event directly to Netlify's async workload system using AsyncWorkloadsClient.
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
  
  log.info('Triggering async workload via AsyncWorkloadsClient', {
    jobId,
    hasAnalysisData: !!analysisData,
    systemId,
    priority,
    hasDelay: !!delayUntil
  });
  
  // Create async workloads client
  const client = new AsyncWorkloadsClient();
  
  // Send event to async workload system
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
    delayUntil: delayUntil instanceof Date ? delayUntil.getTime() : delayUntil
  });
  
  if (result.sendStatus !== 'succeeded') {
    log.error('Failed to send async workload event', {
      sendStatus: result.sendStatus,
      jobId
    });
    throw new Error(`Failed to trigger async workload: ${result.sendStatus}`);
  }
  
  log.info('Async workload triggered successfully via AsyncWorkloadsClient', {
    eventId: result.eventId,
    jobId
  });
  
  return {
    eventId: result.eventId,
    jobId
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
