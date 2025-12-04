/**
 * Send Insights Event - Event Sender for Async Workloads
 * 
 * This is a SEPARATE function that sends events to the async workload system.
 * It imports @netlify/async-workloads and uses AsyncWorkloadsClient.
 * 
 * ARCHITECTURE:
 * - Trigger function calls THIS function via internal HTTP
 * - THIS function sends event to workload handler
 * - This keeps trigger function lightweight (no package import)
 * 
 * This function has external_node_modules configured in netlify.toml
 * so the package is externalized and available at runtime.
 */

const { AsyncWorkloadsClient } = require('@netlify/async-workloads');
const { createLogger } = require('./utils/logger.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

/**
 * Handler for sending async workload events
 * Called internally by the trigger function
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLogger('send-insights-event', context);
  log.entry({ method: event.httpMethod, path: event.path });
  
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      eventName = 'generate-insights',
      eventData,
      priority = 5,
      delayUntil
    } = body;
    
    if (!eventData || !eventData.jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required fields',
          message: 'eventData.jobId is required'
        })
      };
    }
    
    log.info('Sending async workload event', {
      eventName,
      jobId: eventData.jobId,
      priority,
      hasDelayUntil: !!delayUntil
    });
    
    // Create async workloads client
    const client = new AsyncWorkloadsClient();
    
    // Send event to async workload system
    const result = await client.send(eventName, {
      data: eventData,
      priority,
      delayUntil
    });
    
    if (result.sendStatus !== 'succeeded') {
      log.error('Failed to send async workload event', {
        sendStatus: result.sendStatus,
        eventName,
        jobId: eventData.jobId
      });
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Failed to send event',
          sendStatus: result.sendStatus
        })
      };
    }
    
    log.info('Async workload event sent successfully', {
      eventId: result.eventId,
      jobId: eventData.jobId,
      eventName
    });
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        eventId: result.eventId,
        jobId: eventData.jobId,
        eventName
      })
    };
    
  } catch (error) {
    log.error('Error sending async workload event', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
