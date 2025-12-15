// @ts-nocheck
/**
 * Diagnostics Guru Query Endpoint
 * Handles custom diagnostic queries with full context about system state
 * Leverages existing insights generation with diagnostic-specific context
 */

const { createLoggerFromEvent } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  const log = createLoggerFromEvent('diagnostics-guru-query', event, context);

  try {
    const { query, includeContext, systemId } = JSON.parse(event.body || '{}');

    if (!query || typeof query !== 'string') {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'query is required and must be a string' })
      };
    }

    log.info('Processing diagnostics query', { 
      queryLength: query.length,
      includeContext,
      systemId 
    });

    // Build diagnostic context if requested
    let diagnosticContext = '';
    if (includeContext) {
      const contextParts = [];

      // Add collection status
      try {
        const collections = ['analysis-results', 'history', 'systems', 'insights-jobs'];
        const collectionStats = {};

        for (const collectionName of collections) {
          try {
            const coll = await getCollection(collectionName);
            const count = await coll.countDocuments({});
            const recent = await coll.countDocuments({
              $or: [
                { timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() } },
                { createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
              ]
            });
            collectionStats[collectionName] = { total: count, recent };
          } catch (err) {
            collectionStats[collectionName] = { error: err.message };
          }
        }

        contextParts.push('COLLECTION STATUS:');
        contextParts.push(JSON.stringify(collectionStats, null, 2));
      } catch (err) {
        log.warn('Failed to gather collection context', { error: err.message });
      }

      // Add recent error logs if available
      try {
        const logsCollection = await getCollection('logs');
        const recentErrors = await logsCollection
          .find({ level: 'error' })
          .sort({ timestamp: -1 })
          .limit(5)
          .toArray();

        if (recentErrors.length > 0) {
          contextParts.push('\nRECENT ERRORS:');
          contextParts.push(JSON.stringify(recentErrors.map(e => ({
            timestamp: e.timestamp,
            message: e.message,
            function: e.function
          })), null, 2));
        }
      } catch (err) {
        // Logs collection might not exist, that's OK
      }

      diagnosticContext = contextParts.join('\n');
    }

    // Build enhanced diagnostic prompt
    const diagnosticPrompt = `
DIAGNOSTIC QUERY MODE ACTIVE

You are now acting as a Diagnostics Guru for the BMSview application. Your role is to help diagnose and troubleshoot issues.

${diagnosticContext ? `SYSTEM CONTEXT:\n${diagnosticContext}\n\n` : ''}

USER'S DIAGNOSTIC QUERY:
${query}

Please analyze the query and provide:
1. Root cause analysis based on available data
2. Specific diagnostic steps to verify the issue
3. Actionable recommendations to fix the problem
4. Code/configuration references where relevant (use function names, not line numbers)

Focus on practical troubleshooting guidance.
`;

    // Use existing insights endpoint with diagnostic context
    const insightsEndpoint = '/.netlify/functions/generate-insights-with-tools';
    const insightsPayload = {
      systemId: systemId || null,
      customPrompt: diagnosticPrompt,
      fullContextMode: true, // Enable full context for diagnostics
      mode: 'sync',
      consentGranted: true // Diagnostic queries don't need separate consent
    };

    // Forward to insights endpoint
    const insightsUrl = `${process.env.URL || 'http://localhost:8888'}${insightsEndpoint}`;
    
    log.info('Forwarding to insights endpoint', { url: insightsUrl });

    const response = await fetch(insightsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward authentication headers if present
        ...(event.headers['authorization'] ? { 'Authorization': event.headers['authorization'] } : {})
      },
      body: JSON.stringify(insightsPayload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(errorData.error || errorData.message || `Request failed: ${response.status}`);
    }

    const result = await response.json();

    // Extract insights from response
    const diagnosticResponse = {
      success: true,
      recommendations: result.insights || result.finalInsights || 'No recommendations generated',
      collectionStatus: includeContext ? diagnosticContext : undefined,
      metadata: {
        mode: 'diagnostic_query',
        jobId: result.jobId,
        timestamp: new Date().toISOString()
      }
    };

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(diagnosticResponse)
    };

  } catch (error) {
    log.error('Diagnostics query failed', { 
      error: error.message, 
      stack: error.stack 
    });

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: true,
        message: error.message || 'Diagnostics query failed'
      })
    };
  }
};
