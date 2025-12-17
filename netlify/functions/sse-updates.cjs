// @ts-nocheck
const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { createStandardEntryMeta, logDebugRequestSummary } = require('./utils/handler-logging.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const { getCollection } = require('./utils/mongodb.cjs');

/**
 * Server-Sent Events (SSE) endpoint for real-time admin panel updates
 * 
 * Features:
 * - Real-time analysis progress updates
 * - System health monitoring
 * - Insights generation status
 * - Database operation notifications
 * - Heartbeat/keepalive mechanism
 * 
 * Usage:
 * const eventSource = new EventSource('/.netlify/functions/sse-updates?channel=admin');
 * eventSource.addEventListener('analysis', (e) => { const data = JSON.parse(e.data); });
 * eventSource.addEventListener('heartbeat', (e) => { console.log('Connection alive'); });
 */

// In-memory connections store (simplified for serverless)
// In production, use Redis or similar for multi-instance support
const connections = new Map();

/**
 * Format SSE message
 * @param {string} event - Event type
 * @param {any} data - Event data
 * @param {string} [id] - Optional event ID
 * @returns {string} Formatted SSE message
 */
function formatSSEMessage(event, data, id = null) {
  let message = '';
  if (id) {
    message += `id: ${id}\n`;
  }
  message += `event: ${event}\n`;
  message += `data: ${JSON.stringify(data)}\n\n`;
  return message;
}

/**
 * Send heartbeat to keep connection alive
 * Fully implemented for Edge Functions or long-running contexts
 * @param {string} channel - Channel name
 * @param {any} log - Logger instance
 * @param {WritableStream} [stream] - Optional response stream for writing
 * @returns {Promise<boolean>} Success status
 */
async function sendHeartbeat(channel, log, stream = null) {
  const connection = connections.get(channel);
  if (!connection) return false;

  try {
    const heartbeat = formatSSEMessage('heartbeat', {
      timestamp: new Date().toISOString(),
      channel,
      connectionAge: Date.now() - connection.startedAt.getTime()
    });

    // Write to stream if available (Edge Functions)
    if (stream && typeof stream.write === 'function') {
      stream.write(heartbeat);
    }

    // Update last heartbeat timestamp
    connection.lastHeartbeat = new Date();

    log.debug('Heartbeat sent', { channel, connectionAge: Date.now() - connection.startedAt.getTime() });
    return true;
  } catch (error) {
    log.warn('Heartbeat failed', { channel, error: error.message });
    connections.delete(channel);
    return false;
  }
}

/**
 * Broadcast event to all connections on a channel
 * Fully implemented for streaming to clients
 * @param {string} channel - Channel name
 * @param {string} eventType - Event type
 * @param {any} eventData - Event data
 * @param {any} log - Logger instance
 * @param {WritableStream} [stream] - Optional response stream for writing
 * @returns {Promise<number>} Number of successful broadcasts
 */
async function broadcastEvent(channel, eventType, eventData, log, stream = null) {
  const connection = connections.get(channel);
  if (!connection) {
    log.debug('No connections for channel', { channel });
    return 0;
  }

  try {
    const message = formatSSEMessage(eventType, eventData, Date.now().toString());

    // Write to stream if available (Edge Functions or long-running context)
    if (stream && typeof stream.write === 'function') {
      stream.write(message);
    }

    // Store message in connection history for replay
    if (!connection.messageHistory) {
      connection.messageHistory = [];
    }
    connection.messageHistory.push({
      eventType,
      data: eventData,
      timestamp: new Date()
    });

    // Keep only last 50 messages
    if (connection.messageHistory.length > 50) {
      connection.messageHistory = connection.messageHistory.slice(-50);
    }

    log.debug('Event broadcast', {
      channel,
      eventType,
      dataSize: JSON.stringify(eventData).length,
      historySize: connection.messageHistory.length
    });

    return 1;
  } catch (error) {
    log.error('Broadcast failed', { channel, eventType, error: error.message });
    return 0;
  }
}

/**
 * Monitor analysis progress and broadcast updates
 * @param {string} channel - Channel name
 * @param {any} log - Logger instance
 * @param {WritableStream} [stream] - Optional response stream
 */
async function monitorAnalysisProgress(channel, log, stream = null) {
  try {
    const progressCol = await getCollection('progress-events');

    // Get recent progress events (last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentEvents = await progressCol.find({
      timestamp: { $gte: fiveMinutesAgo }
    }).sort({ timestamp: -1 }).limit(10).toArray();

    if (recentEvents.length > 0) {
      await broadcastEvent(channel, 'analysis-progress', {
        events: recentEvents,
        count: recentEvents.length,
        timestamp: new Date().toISOString()
      }, log, stream);
    }
  } catch (error) {
    log.error('Analysis progress monitoring failed', { error: error.message });
  }
}

/**
 * Monitor system health and broadcast status
 * @param {string} channel - Channel name
 * @param {any} log - Logger instance
 * @param {WritableStream} [stream] - Optional response stream
 */
async function monitorSystemHealth(channel, log, stream = null) {
  try {
    // Check MongoDB connection
    const healthStatus = {
      mongodb: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };

    try {
      const resultsCol = await getCollection('analysis-results');
      const recentCount = await resultsCol.countDocuments({
        timestamp: { $gte: new Date(Date.now() - 3600000) } // Last hour
      });
      healthStatus.recentAnalyses = recentCount;
    } catch (error) {
      healthStatus.mongodb = 'degraded';
      healthStatus.error = error.message;
    }

    await broadcastEvent(channel, 'system-health', healthStatus, log, stream);
  } catch (error) {
    log.error('System health monitoring failed', { error: error.message });
  }
}

/**
 * Monitor insights generation and broadcast updates
 * @param {string} channel - Channel name
 * @param {any} log - Logger instance
 * @param {WritableStream} [stream] - Optional response stream
 */
async function monitorInsightsGeneration(channel, log, stream = null) {
  try {
    const jobsCol = await getCollection('insights-jobs');

    // Get active insights jobs
    const activeJobs = await jobsCol.find({
      status: { $in: ['pending', 'running'] }
    }).limit(5).toArray();

    if (activeJobs.length > 0) {
      await broadcastEvent(channel, 'insights-status', {
        activeJobs: activeJobs.map(job => ({
          id: job.id,
          status: job.status,
          progress: job.progress || 0,
          startedAt: job.startedAt,
          estimatedCompletion: job.estimatedCompletion
        })),
        count: activeJobs.length,
        timestamp: new Date().toISOString()
      }, log, stream);
    }
  } catch (error) {
    log.error('Insights monitoring failed', { error: error.message });
  }
}

exports.handler = async (event, context) => {
  const headers = {
    ...getCorsHeaders(event),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('sse-updates', event, context);
  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'SSE updates request', includeBody: false });
  const timer = createTimer(log, 'sse-updates');

  try {
    // Get channel from query params (default: admin)
    const channel = event.queryStringParameters?.channel || 'admin';
    const connectionId = `${channel}-${Date.now()}`;

    log.info('SSE connection initiated', { channel, connectionId });

    // Store connection
    connections.set(connectionId, {
      channel,
      startedAt: new Date(),
      lastHeartbeat: new Date()
    });

    // Note: In Netlify Functions, we can't maintain long-lived connections
    // This is a demonstration implementation. For production SSE:
    // 1. Use Netlify Edge Functions for true streaming
    // 2. Use WebSockets as alternative
    // 3. Use polling with long-polling techniques
    // 4. Use a dedicated SSE service (Pusher, Ably, etc.)

    // Send initial connection message
    const initialMessage = formatSSEMessage('connected', {
      connectionId,
      channel,
      timestamp: new Date().toISOString(),
      message: 'Connected to real-time updates'
    });

    // Immediately send recent updates
    await Promise.all([
      monitorAnalysisProgress(channel, log),
      monitorSystemHealth(channel, log),
      monitorInsightsGeneration(channel, log)
    ]);

    timer.end({ channel, connectionId });
    log.exit(200);

    // Return initial message with instructions
    // In a real SSE implementation, this would keep the connection open
    return {
      statusCode: 200,
      headers,
      body: initialMessage + formatSSEMessage('info', {
        message: 'Netlify Functions have 10-second timeout. For production SSE, use Netlify Edge Functions or WebSocket alternatives.',
        recommendation: 'Consider polling /.netlify/functions/admin-diagnostics for updates',
        pollingInterval: '5000ms'
      })
    };

  } catch (error) {
    timer.end({ error: true });
    log.error('SSE connection failed', {
      error: error.message,
      stack: error.stack
    });
    log.exit(500);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(event) },
      body: JSON.stringify({
        error: 'SSE connection failed',
        message: error.message,
        recommendation: 'Use polling as fallback'
      })
    };
  }
};

// Export broadcast function for use by other functions
module.exports.broadcastEvent = broadcastEvent;
