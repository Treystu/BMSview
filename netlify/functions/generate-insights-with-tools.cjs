/**
 * Enhanced Insights Generation with Gemini Function Calling
 * 
 * This function enables Gemini to intelligently query for additional data
 * (historical records, weather, solar estimates, system analytics) to provide
 * comprehensive, context-aware battery analysis.
 */

const { createLogger, createTimer } = require('../../utils/logger.cjs');
const { toolDefinitions, executeToolCall } = require('./utils/gemini-tools.cjs');
const { buildPrompt, fallbackTextSummary } = require('../../utils/battery-analysis.cjs');

const MAX_TOOL_ITERATIONS = 5; // Prevent infinite loops

/**
 * Main handler for insights generation with function calling
 */
async function handler(event = {}, context = {}) {
  const log = createLogger('generate-insights-with-tools', context);
  const timer = createTimer(log, 'generate-insights-with-tools');

  try {
    // Parse request body
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
      log.warn('Failed to parse request body', { error: error.message });
      return respond(400, { error: 'Invalid JSON in request body' });
    }

    const { analysisData, systemId, customPrompt } = body;

    if (!analysisData) {
      return respond(400, { error: 'analysisData is required' });
    }

    log.info('Starting insights generation with function calling', {
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt
    });

    // Get AI model
    const model = await getAIModel(log);
    if (!model) {
      log.warn('AI model not available, using fallback');
      const fallbackText = fallbackTextSummary({ measurements: [analysisData] });
      return respond(200, {
        success: true,
        insights: { rawText: fallbackText, formattedText: fallbackText },
        usedFunctionCalling: false
      });
    }

    // Build initial prompt with context about available tools
    const initialPrompt = buildEnhancedPrompt(analysisData, systemId, customPrompt);

    // Execute multi-turn conversation with function calling
    const result = await executeWithFunctionCalling(
      model,
      initialPrompt,
      systemId,
      log
    );

    timer.end();

    return respond(200, {
      success: true,
      insights: result.insights,
      toolCalls: result.toolCalls,
      usedFunctionCalling: result.usedFunctionCalling,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    log.error('Error generating insights', { error: error.message, stack: error.stack });
    timer.end();
    return respond(500, { error: 'Failed to generate insights', message: error.message });
  }
}

/**
 * Execute Gemini conversation with function calling support
 */
async function executeWithFunctionCalling(model, initialPrompt, systemId, log) {
  const toolCalls = [];
  let conversationHistory = [];
  let finalResponse = null;
  let iteration = 0;

  // Add initial user message
  conversationHistory.push({
    role: 'user',
    parts: [{ text: initialPrompt }]
  });

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;
    log.info(`Function calling iteration ${iteration}`);

    try {
      // Call Gemini with tools
      const result = await model.generateContent({
        contents: conversationHistory,
        tools: [{
          functionDeclarations: toolDefinitions
        }]
      });

      const response = result.response;
      const functionCalls = response.functionCalls();

      // If no function calls, we have the final answer
      if (!functionCalls || functionCalls.length === 0) {
        finalResponse = response.text();
        log.info('Received final response from Gemini');
        break;
      }

      // Execute all function calls
      log.info(`Gemini requested ${functionCalls.length} function call(s)`);
      
      const functionResponses = [];
      
      for (const functionCall of functionCalls) {
        const { name, args } = functionCall;
        log.info('Executing function call', { name, args });
        
        toolCalls.push({ name, args });
        
        // Execute the tool
        const toolResult = await executeToolCall(name, args, log);
        
        functionResponses.push({
          functionResponse: {
            name,
            response: toolResult
          }
        });
      }

      // Add function call and responses to conversation history
      conversationHistory.push({
        role: 'model',
        parts: functionCalls.map(fc => ({ functionCall: fc }))
      });
      
      conversationHistory.push({
        role: 'function',
        parts: functionResponses
      });

    } catch (error) {
      log.error('Error in function calling iteration', { iteration, error: error.message });
      
      // If we have any previous response, use it
      if (conversationHistory.length > 0) {
        finalResponse = 'Analysis completed with partial data due to an error.';
      }
      break;
    }
  }

  if (!finalResponse) {
    finalResponse = 'Unable to generate insights after maximum iterations.';
  }

  return {
    insights: {
      rawText: finalResponse,
      formattedText: finalResponse
    },
    toolCalls,
    usedFunctionCalling: toolCalls.length > 0
  };
}

/**
 * Build enhanced prompt that describes available tools
 */
function buildEnhancedPrompt(analysisData, systemId, customPrompt) {
  let prompt = `You are an expert battery system analyst with access to additional data sources.

CURRENT BATTERY SNAPSHOT:
${JSON.stringify(analysisData, null, 2)}

${systemId ? `SYSTEM ID: ${systemId}\n` : ''}

AVAILABLE TOOLS:
You have access to the following tools to gather additional context:

1. getSystemHistory - Retrieve historical battery measurements to analyze trends
2. getWeatherData - Get weather conditions to correlate with performance
3. getSolarEstimate - Get solar production estimates for solar-powered systems
4. getSystemAnalytics - Get comprehensive analytics including hourly patterns and baselines

INSTRUCTIONS:
${customPrompt || 'Provide a comprehensive battery health analysis.'}

When analyzing:
- If you notice unusual temperature readings, consider checking weather data
- If performance seems degraded, compare against historical data
- If this is a solar system, check solar estimates to verify charging expectations
- Use system analytics to understand typical behavior patterns

Provide actionable insights and recommendations based on all available data.`;

  return prompt;
}

/**
 * Get AI model instance
 */
async function getAIModel(log) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      log.warn('GEMINI_API_KEY not configured');
      return null;
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({ 
      model: 'gemini-1.5-pro',  // Use 1.5-pro for function calling support
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
      }
    });
  } catch (error) {
    log.error('Failed to initialize AI model', { error: error.message });
    return null;
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
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = handler;

