/**
 * Generate Insights Background - Long-Running Job Processor
 * 
 * This function handles background insights jobs that exceed the 60s timeout.
 * It's invoked separately from the main endpoint to allow unlimited execution time.
 */

const { createLogger } = require('./utils/logger.cjs');
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');
const { getInsightsJob, failJob } = require('./utils/insights-jobs.cjs');

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
      
      // If only jobId is provided, fetch job data from database
      if (jobId && !body.analysisData) {
        log.info('Fetching job data from database', { jobId });
        const job = await getInsightsJob(jobId, log);
        
        if (!job) {
          log.warn('Job not found', { jobId });
          await failJob(jobId, 'Job not found during background processing', log);
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: 'Job not found',
              jobId
            })
          };
        }
        
        analysisData = job.analysisData;
        systemId = job.systemId;
        customPrompt = job.customPrompt;
      } else {
        // Use data from request body
        analysisData = body.analysisData;
        systemId = body.systemId;
        customPrompt = body.customPrompt;
      }
    } else if (event.jobId) {
      // Direct invocation
      jobId = event.jobId;
      analysisData = event.analysisData;
      systemId = event.systemId;
      customPrompt = event.customPrompt;
    }

    // Validate we have required data
    if (!jobId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing jobId'
        })
      };
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
      stack: error.stack,
      name: error.name,
      code: error.code,
      // Log full error object for debugging
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });

    // Try to mark job as failed if we have a jobId
    let jobId;
    try {
      if (event.body) {
        const body = JSON.parse(event.body);
        jobId = body.jobId;
      } else if (event.jobId) {
        jobId = event.jobId;
      }
      
      if (jobId) {
        await failJob(jobId, error.message, log);
        log.info('Job marked as failed', { jobId });
      }
    } catch (failError) {
      log.error('Failed to mark job as failed', {
        error: failError.message,
        stack: failError.stack,
        originalError: error.message
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        jobId
      })
    };
  }
};
