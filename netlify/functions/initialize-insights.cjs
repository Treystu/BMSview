/**
 * Initialize Insights - Separate Function for Data Verification
 * 
 * This function runs BEFORE the main insights generation to verify that Gemini
 * can successfully retrieve historical data. Uses full Netlify timeout budget.
 * 
 * After successful initialization, returns session data that the main insights
 * function can use to continue the analysis.
 */

const { createLogger, createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getGeminiClient } = require('./utils/geminiClient.cjs');
const { toolDefinitions, executeToolCall } = require('./utils/gemini-tools.cjs');

function validateEnvironment(log) {
  if (!process.env.MONGODB_URI) {
    log.error('Missing MONGODB_URI environment variable');
    return false;
  }
  if (!process.env.GEMINI_API_KEY) {
    log.error('Missing GEMINI_API_KEY environment variable');
    return false;
  }
  return true;
}
const { getCorsHeaders } = require('./utils/cors.cjs');

// Full timeout for initialization (Netlify Pro allows 26 seconds)
const INITIALIZATION_TIMEOUT_MS = 25000; // 25 seconds to be safe (leave 1s buffer)
const MAX_RETRIES = 100; // Effectively unlimited within timeout
const RETRY_LINEAR_INCREMENT_MS = 1000; // Add 1 second per retry

/**
 * Main handler for initialization
 */
exports.handler = async (event, context) => {
  const log = createLoggerFromEvent('initialize-insights', event, context);
  const timer = createTimer(log, 'initialize-insights-handler');
  const headers = getCorsHeaders(event);
  
  log.entry({ method: event.httpMethod, path: event.path });
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    log.debug('OPTIONS preflight request');
    timer.end();
    log.exit(200);
    return { statusCode: 200, headers };
  }

  if (!validateEnvironment(log)) {
    timer.end({ success: false, error: 'configuration' });
    log.exit(500);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }
  const startTime = Date.now();

  try {
    // Parse request
    const body = event.body ? JSON.parse(event.body) : {};
    const { 
      systemId,
      contextWindowDays = 30,
      modelOverride
    } = body;

    if (!systemId) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false,
          error: 'systemId is required for initialization' 
        })
      };
    }

    log.info('Starting initialization sequence', {
      systemId,
      contextWindowDays,
      modelOverride,
      maxRetries: MAX_RETRIES
    });

    // Calculate date range for data retrieval
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - contextWindowDays);
    
    const initPrompt = `
🔧 INITIALIZATION SEQUENCE - MANDATORY DATA VERIFICATION

Before providing any analysis, you MUST complete this initialization sequence:

1. **Call request_bms_data tool** with these EXACT parameters:
   - systemId: "${systemId}"
   - metric: "all"
   - time_range_start: "${startDate.toISOString()}"
   - time_range_end: "${endDate.toISOString()}"
   - granularity: "daily_avg"

2. **Verify the response**:
   - Check that dataPoints > 0
   - Confirm you received actual data (not an error)
   - Note the number of data points retrieved

3. **Respond with EXACTLY this format**:
   "INITIALIZATION COMPLETE: Retrieved [X] data points from [start_date] to [end_date]"

⚠️ CRITICAL: Do NOT proceed with analysis until you complete this sequence.
⚠️ Do NOT say "data unavailable" - the tool WILL return data if parameters are correct.
⚠️ If the tool returns an error, report EXACTLY what the error says so we can fix it.

Execute the initialization now.`;

    // Initialize conversation history
    const conversationHistory = [
      {
        role: 'user',
        parts: [{ text: initPrompt }]
      }
    ];

    const geminiClient = getGeminiClient();
    let attempts = 0;
    let toolCallsUsed = 0;
    let turnsUsed = 0;

    // Retry loop until we get successful data retrieval or timeout
    for (attempts = 0; attempts < MAX_RETRIES; attempts++) {
      // Check timeout budget
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > INITIALIZATION_TIMEOUT_MS) {
        log.warn('Initialization timeout', {
          attempts,
          elapsedMs,
          timeoutMs: INITIALIZATION_TIMEOUT_MS
        });
        
        return {
          statusCode: 408,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Initialization timed out',
            attempts,
            durationMs: elapsedMs
          })
        };
      }

      turnsUsed++;
      
      log.info(`Initialization attempt ${attempts + 1}`, { elapsedMs });

      let geminiResponse;
      try {
        geminiResponse = await geminiClient.callAPI(null, {
          history: conversationHistory,
          tools: toolDefinitions,
          model: modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          maxOutputTokens: 2048
        }, log);
      } catch (geminiError) {
        const err = geminiError instanceof Error ? geminiError : new Error(String(geminiError));
        log.error('Gemini API call failed during initialization', {
          attempt: attempts + 1,
          error: err.message
        });
        
        // Linear backoff
        const delayMs = Math.min(RETRY_LINEAR_INCREMENT_MS * (attempts + 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      // Validate response structure
      const responseContent = geminiResponse?.candidates?.[0]?.content;
      if (!responseContent || !responseContent.parts || responseContent.parts.length === 0) {
        log.warn('Invalid Gemini response during initialization, retrying', {
          attempt: attempts + 1,
          hasResponse: !!geminiResponse,
          hasCandidates: !!geminiResponse?.candidates
        });
        
        conversationHistory.push({
          role: 'user',
          parts: [{ text: 'Your response was empty or invalid. Please call request_bms_data with the parameters specified above.' }]
        });
        continue;
      }

      // Add response to history
      conversationHistory.push(responseContent);

      // Check for tool calls
      const toolCalls = responseContent.parts.filter(p => p.functionCall);
      
      if (toolCalls.length === 0) {
        const textParts = responseContent.parts.filter(p => p.text);
        const responseText = textParts.map(p => p.text).join(' ');
        
        log.warn('Gemini did not call request_bms_data', {
          attempt: attempts + 1,
          responseText: responseText.substring(0, 500)
        });
        
        conversationHistory.push({
          role: 'user',
          parts: [{ text: `You did not call the request_bms_data tool. You MUST call it with the exact parameters provided. Do it now.` }]
        });
        continue;
      }

      // Execute tool calls
      let dataRetrieved = false;
      let dataPoints = 0;

      for (const toolCall of toolCalls) {
        const toolName = toolCall.functionCall.name;
        const toolArgs = toolCall.functionCall.args;
        
        log.info(`Initialization tool call: ${toolName}`, {
          attempt: attempts + 1,
          toolArgs: JSON.stringify(toolArgs).substring(0, 500)
        });

        toolCallsUsed++;

        try {
          const toolResult = await executeToolCall(toolName, toolArgs, log);
          
          // Add tool result to conversation
          conversationHistory.push({
            role: 'function',
            parts: [{
              functionResponse: {
                name: toolName,
                response: { result: toolResult }
              }
            }]
          });

          // Check if this was request_bms_data and it succeeded
          if (toolName === 'request_bms_data' && toolResult && !toolResult.error) {
            dataPoints = toolResult.dataPoints || 0;
            if (dataPoints > 0) {
              dataRetrieved = true;
              log.info('Initialization data successfully retrieved', {
                toolName,
                dataPoints,
                attempt: attempts + 1
              });
            } else {
              log.warn('request_bms_data returned 0 data points', {
                attempt: attempts + 1
              });
            }
          } else if (toolResult && toolResult.error) {
            log.error('Tool execution returned error', {
              toolName,
              error: toolResult.message || toolResult.error,
              attempt: attempts + 1
            });
          }
        } catch (toolError) {
          const err = toolError instanceof Error ? toolError : new Error(String(toolError));
          log.error('Tool execution threw exception', {
            toolName,
            error: err.message,
            attempt: attempts + 1
          });
          
          conversationHistory.push({
            role: 'function',
            parts: [{
              functionResponse: {
                name: toolName,
                response: {
                  error: true,
                  message: `Tool failed: ${err.message}`
                }
              }
            }]
          });
        }
      }

      // Check if we successfully retrieved data
      if (dataRetrieved && dataPoints > 0) {
        const durationMs = Date.now() - startTime;
        
        log.info('Initialization sequence SUCCEEDED', {
          attempts: attempts + 1,
          dataPoints,
          toolCallsUsed,
          turnsUsed,
          durationMs
        });
        
        timer.end({ success: true, dataPoints });
        log.exit(200, { dataPoints, attempts: attempts + 1 });
        
        // Return success with session data for handoff
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            systemId,
            contextWindowDays,
            modelOverride,
            dataPoints,
            dateRange: {
              start: startDate.toISOString(),
              end: endDate.toISOString()
            },
            metadata: {
              attempts: attempts + 1,
              toolCallsUsed,
              turnsUsed,
              durationMs
            },
            // Conversation history for continuation (optional, may be large)
            conversationHistory: conversationHistory.slice(-3) // Last 3 exchanges only
          })
        };
      }

      // Data retrieval failed or returned 0 points - retry with guidance
      conversationHistory.push({
        role: 'user',
        parts: [{ text: 'Data retrieval incomplete. Call request_bms_data again with the EXACT parameters specified. Do not proceed without data.' }]
      });
    }

    // Exhausted all retries
    const durationMs = Date.now() - startTime;
    
    log.error('Initialization failed after all retries', {
      attempts,
      maxRetries: MAX_RETRIES,
      durationMs
    });

    timer.end({ success: false, attempts });
    log.exit(500);

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: `Failed to retrieve data after ${attempts} attempts`,
        attempts,
        durationMs
      })
    };

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const durationMs = Date.now() - startTime;
    
    log.error('Initialization failed with exception', {
      error: err.message,
      stack: err.stack,
      durationMs
    });

    timer.end({ success: false, error: err.message });
    log.exit(500);

    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: err.message,
        durationMs
      })
    };
  }
};
