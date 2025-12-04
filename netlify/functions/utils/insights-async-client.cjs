/**
 * Insights Async Workload Client
 * 
 * Triggers async workload for insights generation WITHOUT importing @netlify/async-workloads package.
 * Uses direct background processing to avoid 250MB bundle size limit.
 * 
 * ARCHITECTURE:
 * - Trigger creates job in MongoDB
 * - Starts background processing directly (fire-and-forget)
 * - No AsyncWorkloadsClient import (avoids 43MB package + dependencies)
 * - Background processor handles retry, state, timeout management
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
 * Trigger insights generation via background processing
 * 
 * Uses direct invocation of insights processor (no async workload package needed).
 * This avoids the 250MB bundle size issue while maintaining background processing capability.
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
  
  log.info('Triggering background insights processing', {
    jobId,
    hasAnalysisData: !!analysisData,
    systemId,
    fullContextMode,
    contextWindowDays,
    maxIterations
  });

  // Start processing in background (async, fire-and-forget)
  // The processor handles retry logic, state persistence, and error management
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
    // Error is logged but doesn't fail the trigger - job status will reflect failure
  });

  log.info('Background processing started', { jobId });
  
  return { jobId };
}

/**
 * Trigger high-priority insights workload
 * 
 * In this simplified implementation (without AsyncWorkloadsClient), priority is handled
 * by the background processor's internal queue management.
 * 
 * @param {Object} options - Same as triggerInsightsWorkload
 * @returns {Promise<{jobId: string}>}
 */
async function triggerUrgentInsightsWorkload(options) {
  // For now, same as normal trigger - background processor handles all jobs equally
  // Future enhancement: Could add priority field to job metadata
  return triggerInsightsWorkload(options);
}

/**
 * Schedule insights workload for future execution
 * 
 * In this simplified implementation, scheduling is not supported without AsyncWorkloadsClient.
 * Jobs are processed immediately.
 * 
 * @param {Object} options - Workload options
 * @param {Date|number} delayUntil - Ignored in this implementation
 * @returns {Promise<{jobId: string}>}
 */
async function scheduleInsightsWorkload(options, delayUntil) {
  const log = createLogger('insights-background-client', { jobId: options.jobId });
  log.warn('Scheduling not supported in simplified implementation - processing immediately', {
    requestedDelay: delayUntil
  });
  
  // Execute immediately
  return triggerInsightsWorkload(options);
}

module.exports = {
  triggerInsightsWorkload,
  triggerUrgentInsightsWorkload,
  scheduleInsightsWorkload
};
