/**
 * Generate Insights Status - Job Status Polling Endpoint
 * 
 * Allows clients to poll for the status of background insights jobs.
 */

const { createLogger } = require('./utils/logger.cjs');
const { getInsightsJob } = require('./utils/insights-jobs.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  return true;
}

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLogger('generate-insights-status', context);

  try {
    // Parse request - support both POST with body and GET with query params
    let jobId;
    
    if (event.httpMethod === 'POST' && event.body) {
      const body = JSON.parse(event.body);
      jobId = body.jobId;
    } else if (event.queryStringParameters) {
      jobId = event.queryStringParameters.jobId;
    }

    if (!jobId) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'jobId is required' 
        })
      };
    }

    log.info('Status check requested', { jobId });

    // Get job from database
    const job = await getInsightsJob(jobId, log);

    if (!job) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Job not found',
          jobId 
        })
      };
    }

    // Build response based on job status
    const response = {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };

    // Add status-specific fields
    if (job.status === 'completed') {
      response.insights = job.finalInsights;
      response.completedAt = job.updatedAt;
      response.metadata = {
        turns: job.finalInsights?.turns || 0,
        toolCalls: job.finalInsights?.toolCalls || 0
      };
    } else if (job.status === 'failed') {
      response.error = job.error;
      response.failedAt = job.updatedAt;
    } else if (job.status === 'processing') {
      response.progress = job.progress || [];
      response.partialInsights = job.partialInsights;
    }

    log.info('Status check completed', { 
      jobId, 
      status: job.status 
    });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    log.error('Status check failed', {
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to check job status',
        message: error.message
      })
    };
  }
};
