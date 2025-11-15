/**
 * Generate Insights Background - Long-Running Job Processor
 * 
 * This function handles background insights jobs that exceed the 60s timeout.
 * It's invoked separately from the main endpoint to allow unlimited execution time.
 */

const { createLogger } = require('./utils/logger.cjs');
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');
const { getInsightsJob } = require('./utils/insights-jobs.cjs');

/**
 * Handler for background job invocations
 * Can be triggered via HTTP or direct invocation
 */
exports.handler = async (event, context) => {
  const log = createLogger('generate-insights-background', context);

  try {
    // Parse job details from event
    let jobId, analysisData, systemId, customPrompt;

    if (event.body) {
      const body = JSON.parse(event.body);
      jobId = body.jobId;
      analysisData = body.analysisData;
      systemId = body.systemId;
      customPrompt = body.customPrompt;
    } else if (event.jobId) {
      // Direct invocation
      jobId = event.jobId;
      analysisData = event.analysisData;
      systemId = event.systemId;
      customPrompt = event.customPrompt;
    } else {
      throw new Error('Missing required job parameters');
    }

    log.info('Background job started', {
      jobId,
      hasAnalysisData: !!analysisData,
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt
    });

    // Process the insights job
    const result = await processInsightsInBackground(
      jobId,
      analysisData,
      systemId,
      customPrompt,
      log
    );

    log.info('Background job completed', {
      jobId,
      success: result.success
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId,
        result
      })
    };

  } catch (error) {
    log.error('Background job failed', {
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Background job failed',
        message: error.message
      })
    };
  }
};
