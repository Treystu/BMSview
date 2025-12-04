/**
 * Insights Background Processing Client
 * 
 * Helper for triggering insights generation in background.
 * Uses simple in-process async execution without package dependencies.
 * 
 * Usage:
 * ```js
 * const { triggerInsightsWorkload } = require('./utils/insights-async-client.cjs');
 * 
 * const { jobId } = await triggerInsightsWorkload({
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

const { processInsightsInBackground } = require('./insights-processor.cjs');
const { createLogger } = require('./logger.cjs');

/**
 * Trigger insights generation in background
 * 
 * @param {Object} options - Processing options
 * @param {string} options.jobId - Job identifier
 * @param {Object} [options.analysisData] - Analysis data (optional if jobId exists in DB)
 * @param {string} [options.systemId] - System identifier
 * @param {string} [options.customPrompt] - Custom user prompt
 * @param {number} [options.contextWindowDays] - Days of context to load
 * @param {number} [options.maxIterations] - Maximum AI iterations
 * @param {string} [options.modelOverride] - Gemini model override
 * @param {boolean} [options.fullContextMode] - Enable full context mode
 * @returns {Promise<{jobId: string}>}
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
    fullContextMode
  } = options;

  if (!jobId) {
    throw new Error('jobId is required to trigger insights processing');
  }

  const log = createLogger('insights-background-client', { jobId });

  // Start processing in background (async, fire-and-forget)
  processInsightsInBackground(
    jobId,
    analysisData,
    systemId,
    customPrompt,
    contextWindowDays,
    maxIterations,
    modelOverride,
    fullContextMode
  ).catch(error => {
    log.error('Background insights processing failed', {
      jobId,
      error: error.message,
      stack: error.stack
    });
  });

  return { jobId };
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
