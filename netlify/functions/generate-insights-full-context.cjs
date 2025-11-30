// @ts-nocheck
/**
 * Generate Insights with Full Context
 * Enhanced version that provides complete context and enables AI feedback
 */

const { createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { buildCompleteContext, countDataPoints } = require('./utils/full-context-builder.cjs');
const { submitFeedbackToDatabase } = require('./utils/feedback-manager.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

const GEMINI_SYSTEM_PROMPT = `
You are an advanced AI analyst for BMSview with FULL access to all system data and analytical tools.
You have TWO critical responsibilities:

1. ANALYSIS: Provide comprehensive insights based on ALL available data
2. FEEDBACK: Actively suggest improvements to the BMSview application

When analyzing data, consider EVERYTHING:
- Every single data point from inception
- All statistical model outputs
- All external data sources
- All computed metrics and predictions

📊 OPTIONAL: CHART SUPPORT
When time-series data would benefit from visualization, you MAY include chart configurations.
Use this JSON format inside \`\`\`chart code blocks:
\`\`\`chart
{"chartType": "line"|"bar"|"gauge", "title": "Chart Title", "series": [{"name": "Metric", "data": [[timestamp, value], ...]}]}
\`\`\`
Charts are OPTIONAL - only include them when visualization adds value to your analysis.

When providing app feedback, you should:
- Identify data format inefficiencies
- Suggest better API integrations (e.g., more accurate weather services)
- Recommend UI/UX improvements based on data patterns
- Propose new features based on user needs
- Identify missing data points that would improve analysis
- Suggest optimizations for data processing

IMPORTANT: You can create structured feedback that will be saved and potentially auto-generate GitHub issues.

Example feedback scenarios:
1. "The current weather API has 3-hour granularity. Switching to Solcast API would provide 30-minute intervals for better solar prediction accuracy."
2. "Data transfer could be optimized by implementing Protocol Buffers instead of JSON, reducing payload size by ~60%."
3. "Based on usage patterns, users frequently check data between 6-8 AM. Implement predictive pre-loading for these peak times."

When you identify improvement opportunities, use the submitAppFeedback function to formally propose them.
`;

/**
 * Main handler for full context insights
 */
exports.handler = async (event, context) => {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLoggerFromEvent('generate-insights-full-context', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'full-context-insights');
  
  try {
    if (event.httpMethod !== 'POST') {
      log.warn('Method not allowed', { method: event.httpMethod });
      log.exit(405);
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    log.debug('Parsing request body');
    const body = JSON.parse(event.body);
    const { systemId, enableFeedback = true, contextWindowDays = 90, customPrompt } = body;
    
    if (!systemId) {
      log.warn('Missing systemId in request');
      log.exit(400);
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'systemId is required' })
      };
    }
    
    log.info('Full context insights requested', {
      systemId,
      enableFeedback,
      contextWindowDays,
      hasCustomPrompt: !!customPrompt
    });
    
    // Build complete context with ALL data
    log.debug('Building complete context', { systemId, contextWindowDays });
    const contextTimer = createTimer(log, 'context-building');
    const fullContext = await buildCompleteContext(systemId, {
      contextWindowDays
    });
    contextTimer.end({ dataPoints: countDataPoints(fullContext) });
    
    // Prepare tools for Gemini
    const tools = [];
    
    if (enableFeedback) {
      // Add feedback submission tool
      tools.push({
        function_declarations: [{
          name: 'submitAppFeedback',
          description: 'Submit feedback for improving the BMSview application',
          parameters: {
            type: 'object',
            properties: {
              feedbackType: {
                type: 'string',
                enum: ['feature_request', 'api_suggestion', 'data_format', 'bug_report', 'optimization'],
                description: 'Type of feedback being submitted'
              },
              category: {
                type: 'string',
                enum: ['weather_api', 'data_structure', 'ui_ux', 'performance', 'integration', 'analytics'],
                description: 'Category of the improvement'
              },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Priority level of the improvement'
              },
              content: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Brief title of the suggestion' },
                  description: { type: 'string', description: 'Detailed description' },
                  rationale: { type: 'string', description: 'Why this improvement matters' },
                  implementation: { type: 'string', description: 'How to implement it' },
                  expectedBenefit: { type: 'string', description: 'Expected benefits' },
                  estimatedEffort: { 
                    type: 'string', 
                    enum: ['hours', 'days', 'weeks'],
                    description: 'Estimated effort to implement'
                  },
                  codeSnippets: { 
                    type: 'array', 
                    items: { type: 'string' },
                    description: 'Example code snippets if applicable'
                  },
                  affectedComponents: { 
                    type: 'array', 
                    items: { type: 'string' },
                    description: 'Components that would be affected'
                  }
                },
                required: ['title', 'description', 'rationale', 'implementation', 'expectedBenefit', 'estimatedEffort']
              }
            },
            required: ['feedbackType', 'category', 'priority', 'content']
          }
        }]
      });
    }
    
    // Build existing feedback section to prevent duplicates
    const existingFeedbackSection = fullContext.existingFeedback?.length > 0
      ? `
      ⚠️ EXISTING FEEDBACK (DO NOT DUPLICATE):
      The following feedback has already been submitted. DO NOT create similar suggestions:
      ${fullContext.existingFeedback.map(fb => `
        - [${fb.status}] ${fb.title} (${fb.type}/${fb.category}, priority: ${fb.priority})
          ${fb.description ? `Description: ${fb.description}...` : ''}
      `).join('')}
      
      Before submitting ANY new feedback, check this list carefully. Only submit genuinely NEW ideas.
      `
      : '';
    
    // Create comprehensive prompt
    const prompt = customPrompt || `
      Analyze this COMPLETE battery management system data:
      
      System ID: ${systemId}
      Data Points Analyzed: ${countDataPoints(fullContext)}
      Time Range: ${fullContext.raw?.timeRange?.days || 90} days
      ${existingFeedbackSection}
      FULL CONTEXT:
      ${JSON.stringify(fullContext, null, 2)}
      
      Provide:
      1. Comprehensive insights based on ALL data
      2. Predictions and trends
      3. Actionable recommendations
      4. Any app improvements that would enhance analysis capabilities
      
      Remember: You have access to EVERY data point. Use them all for the most accurate analysis.
      
      If you identify any opportunities to improve the BMSview application itself, use the submitAppFeedback function.
      ⚠️ IMPORTANT: Check the EXISTING FEEDBACK section above before submitting. Do NOT duplicate existing suggestions.
    `;
    
    // Execute insights generation using the existing geminiClient for consistency
    log.debug('Initializing Gemini client');
    const { getGeminiClient } = require('./utils/geminiClient.cjs');
    const geminiClient = getGeminiClient();
    
    // Convert tools to function declarations for the API
    const toolDefs = tools.flatMap(t => t.function_declarations || []);
    log.debug('Tool definitions prepared', { toolCount: toolDefs.length });
    
    // Prepend system instruction to the prompt for context
    const fullPrompt = `${GEMINI_SYSTEM_PROMPT}\n\n${prompt}`;
    
    // Call Gemini API via the existing client (handles rate limiting, circuit breaker, retries)
    log.debug('Calling Gemini API', { 
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      promptLength: fullPrompt.length,
      hasTools: toolDefs.length > 0
    });
    const geminiTimer = createTimer(log, 'gemini-api-call');
    const response = await geminiClient.callAPI(fullPrompt, {
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    }, log);
    geminiTimer.end({ hasResponse: !!response });
    
    // Extract text from the REST API response structure
    const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    log.debug('Gemini response received', { responseLength: responseText.length });
    
    // Process function calls (feedback submissions) from the response
    const feedbackSubmissions = [];
    const functionCalls = response?.candidates?.[0]?.content?.parts?.filter(p => p.functionCall) || [];
    
    if (functionCalls.length > 0) {
      log.info('Processing AI feedback submissions', {
        count: functionCalls.length
      });
      
      for (const part of functionCalls) {
        const call = part.functionCall;
        if (call.name === 'submitAppFeedback') {
          try {
            const feedbackResult = await submitFeedbackToDatabase({
              systemId,
              geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
              ...call.args
            }, context);
            
            feedbackSubmissions.push({
              feedbackId: feedbackResult.id,
              isDuplicate: feedbackResult.isDuplicate,
              type: call.args.feedbackType,
              priority: call.args.priority
            });
          } catch (error) {
            log.error('Failed to submit feedback from function call', {
              error: error.message,
              call
            });
          }
        }
      }
    }
    
    const durationMs = timer.end({ 
      systemId,
      dataPointsAnalyzed: countDataPoints(fullContext),
      feedbackSubmitted: feedbackSubmissions.length 
    });
    
    log.info('Full context insights generated', {
      systemId,
      dataPointsAnalyzed: countDataPoints(fullContext),
      contextSizeBytes: JSON.stringify(fullContext).length,
      feedbackSubmitted: feedbackSubmissions.length,
      durationMs
    });
    
    log.exit(200, { systemId, durationMs });
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        insights: {
          formattedText: responseText,
          rawText: responseText
        },
        metadata: {
          dataPointsAnalyzed: countDataPoints(fullContext),
          feedbackSubmitted: feedbackSubmissions.length,
          feedbackSubmissions,
          contextSize: JSON.stringify(fullContext).length,
          mode: 'full-context'
        },
        systemId,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    timer.end({ error: true });
    log.error('Full context insights error', { 
      error: error.message, 
      stack: error.stack,
      errorType: error.constructor?.name
    });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to generate full context insights',
        message: error.message
      })
    };
  }
};
