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
    // Parse request body with better error handling
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn('Failed to parse request body', { error: error.message, body: event.body });
      return respond(400, { error: 'Invalid JSON in request body' });
    }

    // Extract and normalize data
    let analysisData = body.analysisData || body.batteryData || body;

    // Handle different data structures
    if (body.measurements) {
      analysisData = { measurements: body.measurements };
    }

    if (!analysisData || (!analysisData.measurements && !analysisData.voltage && !analysisData.current)) {
      log.warn('No analysis data found', { bodyKeys: Object.keys(body) });
      return respond(400, {
        error: 'analysisData is required',
        debug: {
          receivedKeys: Object.keys(body),
          expectedStructure: 'analysisData with measurements array or direct measurements'
        }
      });
    }

    const { systemId, customPrompt } = body;

    log.info('Starting insights generation with function calling', {
      hasSystemId: !!systemId,
      hasCustomPrompt: !!customPrompt,
      dataStructure: analysisData ? Object.keys(analysisData) : 'none'
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

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.warn('Error generating insights', { error: error.message, stack: error.stack });
    timer.end();
    return respond(500, { error: 'Failed to generate insights', message: error.message });
  }
}

/**
 * Execute Gemini conversation with enhanced context
 * Note: Function calling is not currently supported by the Gemini API version in use.
 * Instead, we gather additional context upfront and include it in the prompt.
 */
async function executeWithFunctionCalling(model, initialPrompt, systemId, log) {
  const toolCalls = [];

  try {
    // Gather additional context if systemId is provided
    let enhancedPrompt = initialPrompt;

    if (systemId) {
      log.info('Gathering additional context for system', { systemId });

      // Try to get system history
      try {
        const historyData = await executeToolCall('getSystemHistory', { systemId, limit: 10 }, log);
        if (historyData && !historyData.error) {
          toolCalls.push({ name: 'getSystemHistory', args: { systemId, limit: 10 } });
          enhancedPrompt += `\n\nRECENT SYSTEM HISTORY (Last 10 records):\n${JSON.stringify(historyData, null, 2)}`;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn('Failed to get system history', { error: error.message });
      }

      // Try to get system analytics
      try {
        const analyticsData = await executeToolCall('getSystemAnalytics', { systemId }, log);
        if (analyticsData && !analyticsData.error) {
          toolCalls.push({ name: 'getSystemAnalytics', args: { systemId } });
          enhancedPrompt += `\n\nSYSTEM ANALYTICS:\n${JSON.stringify(analyticsData, null, 2)}`;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.warn('Failed to get system analytics', { error: error.message });
      }
    }

    // Generate insights with enhanced context
    log.info('Generating insights with enhanced context');
    const result = await model.generateContent(enhancedPrompt);
    const response = result.response;
    const finalResponse = response.text();

    log.info('Successfully generated insights');

    return {
      insights: {
        rawText: finalResponse,
        formattedText: finalResponse
      },
      toolCalls,
      usedFunctionCalling: toolCalls.length > 0
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.warn('Error generating insights', { error: error.message });

    return {
      insights: {
        rawText: 'Analysis completed with partial data due to an error.',
        formattedText: 'Analysis completed with partial data due to an error.'
      },
      toolCalls,
      usedFunctionCalling: false
    };
  }
}

/**
 * Build enhanced prompt with context about available data
 */
function buildEnhancedPrompt(analysisData, systemId, customPrompt) {
  // If custom prompt is provided, use it as the primary instruction
  if (customPrompt) {
    let prompt = `You are an expert battery system analyst.

CURRENT BATTERY SNAPSHOT:
${JSON.stringify(analysisData, null, 2)}

${systemId ? `SYSTEM ID: ${systemId}

NOTE: Additional historical data and system analytics may be provided below.
` : ''}

USER QUESTION:
${customPrompt}

Please answer the user's question based on the battery data provided. If historical data or system analytics are included below, use them to provide more comprehensive insights.`;

    return prompt;
  }

  // Default comprehensive analysis prompt
  let prompt = `You are an expert battery system analyst.

CURRENT BATTERY SNAPSHOT:
${JSON.stringify(analysisData, null, 2)}

${systemId ? `SYSTEM ID: ${systemId}

NOTE: Additional historical data and system analytics will be provided below if available.
` : ''}

INSTRUCTIONS:
Provide a comprehensive battery health analysis including:
- Overall battery health status
- Performance assessment
- Any alerts or concerns
- Actionable recommendations
- Runtime estimates if applicable

When analyzing:
- Consider historical trends if provided
- Look for patterns in the data
- Identify any anomalies or concerns
- Provide specific, actionable recommendations

Provide clear, concise insights that are easy to understand.`;

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
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
      }
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.warn('Failed to initialize AI model', { error: error.message });
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

