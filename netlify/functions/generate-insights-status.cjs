/**
 * Generate Insights Status Endpoint
 * 
 * Provides real-time status updates for background insights generation jobs.
 * Supports polling for progress events, partial insights, and final results.
 * 
 * @module netlify/functions/generate-insights-status
 */

const { createLogger } = require('./utils/logger.cjs');
const { getInsightsJob } = require('./utils/insights-jobs.cjs');

/**
 * Handler for insights status endpoint
 */
async function handler(event, context) {
  const log = createLogger('generate-insights-status', context);
  
  try {
    // Parse request body
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (err) {
      log.warn('Failed to parse request body', { error: err.message });
      return respond(400, { error: 'Invalid JSON in request body' });
    }
    
    const { jobId } = body;
    
    if (!jobId) {
      log.warn('Missing jobId in request');
      return respond(400, { 
        error: 'jobId is required',
        message: 'Please provide a jobId to check status' 
      });
    }
    
    log.info('Checking insights job status', { jobId });
    
    // Get job from database
    const job = await getInsightsJob(jobId, log);
    
    if (!job) {
      log.warn('Job not found', { jobId });
      return respond(404, { 
        error: 'Job not found',
        message: 'The requested insights job does not exist or has expired',
        jobId 
      });
    }
    
    // Build response based on job status
    const response = {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
    
    // Include initial summary if available
    if (job.initialSummary) {
      response.initialSummary = job.initialSummary;
    }
    
    // Include progress events
    if (job.progress && job.progress.length > 0) {
      response.progress = job.progress;
      response.progressCount = job.progress.length;
    }
    
    // Include partial insights if available
    if (job.partialInsights) {
      response.partialInsights = job.partialInsights;
    }
    
    // Include final insights if completed
    if (job.status === 'completed' && job.finalInsights) {
      response.finalInsights = job.finalInsights;
    }
    
    // Include error if failed
    if (job.status === 'failed' && job.error) {
      response.error = job.error;
    }
    
    log.info('Status retrieved successfully', { 
      jobId, 
      status: job.status,
      progressEvents: job.progress?.length || 0,
      hasPartialInsights: !!job.partialInsights,
      hasFinalInsights: !!job.finalInsights
    });
    
    return respond(200, response);
    
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Error retrieving job status', { 
      error: error.message, 
      stack: error.stack 
    });
    
    return respond(500, { 
      error: 'Failed to retrieve job status', 
      message: 'An internal error occurred. Please try again.',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Helper to create HTTP response
 */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = handler;
