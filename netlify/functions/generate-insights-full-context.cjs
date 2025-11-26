// @ts-nocheck
/**
 * Generate Insights with Full Context
 * Enhanced version that provides complete context and enables AI feedback
 */

const { createLogger } = require('./utils/logger.cjs');
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
  const log = createLogger('generate-insights-full-context', context);
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    const body = JSON.parse(event.body);
    const { systemId, enableFeedback = true, contextWindowDays = 90, customPrompt } = body;
    
    if (!systemId) {
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
    const fullContext = await buildCompleteContext(systemId, {
      contextWindowDays
    });
    
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
    
    // Create comprehensive prompt
    const prompt = customPrompt || `
      Analyze this COMPLETE battery management system data:
      
      System ID: ${systemId}
      Data Points Analyzed: ${countDataPoints(fullContext)}
      Time Range: ${fullContext.raw?.timeRange?.days || 90} days
      
      FULL CONTEXT:
      ${JSON.stringify(fullContext, null, 2)}
      
      Provide:
      1. Comprehensive insights based on ALL data
      2. Predictions and trends
      3. Actionable recommendations
      4. Any app improvements that would enhance analysis capabilities
      
      Remember: You have access to EVERY data point. Use them all for the most accurate analysis.
      
      If you identify any opportunities to improve the BMSview application itself, use the submitAppFeedback function.
    `;
    
    // Execute insights generation with tools
    const { GoogleGenerativeAI } = require('@google/genai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      systemInstruction: GEMINI_SYSTEM_PROMPT,
      tools: tools.length > 0 ? tools : undefined
    });
    
    const result = await model.generateContent(prompt);
    const response = result.response;
    
    // Process function calls (feedback submissions)
    const feedbackSubmissions = [];
    if (response.functionCalls && response.functionCalls.length > 0) {
      log.info('Processing AI feedback submissions', {
        count: response.functionCalls.length
      });
      
      for (const call of response.functionCalls) {
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
    
    log.info('Full context insights generated', {
      systemId,
      dataPointsAnalyzed: countDataPoints(fullContext),
      contextSizeBytes: JSON.stringify(fullContext).length,
      feedbackSubmitted: feedbackSubmissions.length
    });
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insights: response.text(),
        dataPointsAnalyzed: countDataPoints(fullContext),
        feedbackSubmitted: feedbackSubmissions.length,
        feedbackSubmissions,
        contextSize: JSON.stringify(fullContext).length,
        systemId,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    log.error('Full context insights error', { error: error.message, stack: error.stack });
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
