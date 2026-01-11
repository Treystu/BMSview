/**
 * Analysis Async Client
 * 
 * Triggers async workload for BMS analysis using TRUE Netlify Async Workloads.
 * 
 * DIRECT ARCHITECTURE (No intermediate function):
 * - Uses AsyncWorkloadsClient directly from @netlify/async-workloads
 * - Package is externalized via netlify.toml configuration
 * - This file is used by analyze.cjs to trigger async jobs
 * - Avoids bundle size issues while maintaining full async workload features
 * 
 * USAGE:
 * ```javascript
 * const { triggerAnalysisAsync } = require('./utils/analysis-async-client.cjs');
 * 
 * const result = await triggerAnalysisAsync({
 *   jobId: 'job-123',
 *   fileData: 'base64...',
 *   fileName: 'screenshot.png',
 *   mimeType: 'image/png',
 *   systemId: 'system-456',
 *   forceReanalysis: false
 * });
 * ```
 */

const { AsyncWorkloadsClient } = require('@netlify/async-workloads');
const { createLogger } = require('./logger.cjs');

/**
 * Trigger analysis via async workload
 * 
 * Sends event directly to Netlify's async workload system using AsyncWorkloadsClient.
 * 
 * @param {Object} options - Processing options
 * @param {string} options.jobId - Job identifier
 * @param {string} options.fileData - Base64 encoded image data
 * @param {string} options.fileName - Original filename
 * @param {string} options.mimeType - MIME type of the image
 * @param {string} [options.systemId] - Optional system ID to associate with
 * @param {boolean} [options.forceReanalysis] - Whether to bypass duplicate detection
 * @param {Object} [options.systems] - Systems data for the job
 * @param {Object} [log] - Optional logger instance
 * @returns {Promise<{success: boolean, eventId?: string, error?: string}>}
 */
async function triggerAnalysisAsync(options, log) {
    const {
        jobId,
        fileData,
        fileName,
        mimeType,
        systemId,
        forceReanalysis = false,
        systems
    } = options;

    if (!jobId || !fileData || !fileName || !mimeType) {
        const error = 'Missing required parameters: jobId, fileData, fileName, mimeType';
        if (log) log.error('Invalid parameters for async analysis trigger', { jobId, hasFileData: !!fileData, hasFileName: !!fileName, hasMimeType: !!mimeType });
        throw new Error(error);
    }

    const logger = log || createLogger('analysis-async-client', { jobId });

    logger.info('Triggering async workload via AsyncWorkloadsClient', {
        jobId,
        fileName,
        mimeType,
        hasSystemId: !!systemId,
        forceReanalysis,
        fileBytes: fileData.length
    });

    // Get site URL for AsyncWorkloadsClient
    // In production, this will be the actual site URL
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888';
    const baseUrl = siteUrl.replace(/\/$/, '');

    const client = new AsyncWorkloadsClient({ baseUrl });

    // Send event to async workload system
    const result = await client.send('analyze', {
        jobId,
        fileData,
        fileName,
        mimeType,
        systemId,
        forceReanalysis,
        systems
    });

    if (result.sendStatus !== 'accepted') {
        const error = `Failed to trigger async workload: ${result.sendStatus}`;
        logger.error('Async workload trigger failed', {
            jobId,
            sendStatus: result.sendStatus,
            error: result.error
        });
        throw new Error(error);
    }

    logger.info('Async workload triggered successfully via AsyncWorkloadsClient', {
        eventId: result.eventId,
        jobId
    });

    return {
        success: true,
        eventId: result.eventId,
        jobId
    };
}

module.exports = {
    triggerAnalysisAsync
};
