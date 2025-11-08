/**
 * Background processor for Generate Insights jobs.
 *
 * This function is invoked asynchronously via /.netlify/functions/generate-insights-background
 * and is responsible for loading the queued job payload, executing the AI analysis,
 * and persisting the results back to MongoDB.
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');
const { getInsightsJob, failJob } = require('./utils/insights-jobs.cjs');
const { processInsightsInBackground } = require('./utils/insights-processor.cjs');

exports.handler = async (event = {}, context = {}) => {
  const log = createLogger('generate-insights-background', context);
  const timer = createTimer(log, 'generate-insights-background');

  log.info('Background invocation received', {
    method: event.httpMethod,
    path: event.path,
    query: event.queryStringParameters
  });

  let jobId = null;

  try {
    const payload = parseBackgroundPayload(event, log);
    jobId = payload?.jobId || event?.queryStringParameters?.jobId || null;

    if (!jobId) {
      log.warn('Background invocation missing jobId');
      timer.end({ error: true });
      return buildBackgroundResponse(false, 'Missing jobId');
    }

    const job = await getInsightsJob(jobId, log);
    if (!job) {
      log.warn('Background job not found', { jobId });
      await markJobFailed(jobId, 'Job not found during background processing', log);
      timer.end({ error: true });
      return buildBackgroundResponse(false, 'Job not found');
    }

    log.info('Starting background insights processing', {
      jobId,
      hasSystemId: !!job.systemId,
      hasCustomPrompt: !!job.customPrompt
    });

    await processInsightsInBackground(
      jobId,
      job.analysisData,
      job.systemId,
      job.customPrompt,
      log
    );

    const durationMs = timer.end();
    log.info('Background insights processing completed', { jobId, durationMs });

    return buildBackgroundResponse(true, null, { jobId });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Background insights processing failed', { jobId, error: err.message, stack: err.stack });

    if (jobId) {
      await markJobFailed(jobId, err.message, log);
    }

    timer.end({ error: true });
    return buildBackgroundResponse(false, err.message, { jobId });
  }
};

function parseBackgroundPayload(event, log) {
  if (!event?.body) {
    return null;
  }

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.warn('Failed to parse background request body', { error: err.message });
    return null;
  }
}

async function markJobFailed(jobId, message, log) {
  try {
    await failJob(jobId, message, log);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Failed to record job failure', { jobId, error: err.message });
  }
}

function buildBackgroundResponse(success, errorMessage, extra = {}) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      success,
      error: errorMessage || undefined,
      ...extra,
      timestamp: new Date().toISOString()
    })
  };
}
