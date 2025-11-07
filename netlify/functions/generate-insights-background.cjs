/**
 * Generate Insights Background Processor
 * 
 * Long-running Netlify background function for AI insights generation.
 * Supports up to 15 minutes of processing time with progress streaming.
 * 
 * This function is invoked by generate-insights-with-tools.cjs and runs
 * the full AI tool calling loop with real-time progress updates.
 * 
 * @module netlify/functions/generate-insights-background
 */

const { createLogger, createTimer } = require('./utils/logger.cjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { 
  getInsightsJob, 
  updateJobStatus, 
  addProgressEvent,
  updatePartialInsights,
  completeJob,
  failJob
} = require('./utils/insights-jobs.cjs');

// Extended constants for background processing
const MAX_TOOL_ITERATIONS = 15; // More iterations allowed in background
const ITERATION_TIMEOUT_MS = 30000; // 30 seconds per iteration
const TOTAL_TIMEOUT_MS = 14 * 60 * 1000; // 14 minutes (leave buffer for cleanup)

/**
 * Background handler - marked for Netlify background execution
 */
async function handler(event, context) {
  const log = createLogger('generate-insights-background', context);
  const timer = createTimer(log, 'generate-insights-background');
  
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
      log.warn('Missing jobId in background function');
      return respond(400, { error: 'jobId is required' });
    }
    
    log.info('Starting background insights processing', { jobId });
    
    // Get job from database
    const job = await getInsightsJob(jobId, log);
    
    if (!job) {
      log.error('Job not found', { jobId });
      return respond(404, { error: 'Job not found' });
    }
    
    // Update status to processing
    await updateJobStatus(jobId, 'processing', log);
    await addProgressEvent(jobId, {
      type: 'status',
      data: { message: 'Background processing started' }
    }, log);
    
    try {
      // Execute AI processing with function calling
      const result = await executeBackgroundProcessing(
        job.analysisData,
        job.systemId,
        job.customPrompt,
        jobId,
        log
      );
      
      // Mark job as complete
      await completeJob(jobId, result.insights, log);
      await addProgressEvent(jobId, {
        type: 'status',
        data: { message: 'Processing completed successfully' }
      }, log);
      
      timer.end();
      
      log.info('Background processing completed', {
        jobId,
        iterations: result.iterations,
        toolCallsUsed: result.toolCalls?.length || 0
      });
      
      return respond(200, { 
        success: true, 
        jobId,
        status: 'completed'
      });
      
    } catch (processingError) {
      const error = processingError instanceof Error ? processingError : new Error(String(processingError));
      log.error('Background processing failed', { 
        jobId,
        error: error.message,
        stack: error.stack
      });
      
      // Mark job as failed
      await failJob(jobId, error.message, log);
      await addProgressEvent(jobId, {
        type: 'error',
        data: { error: error.message }
      }, log);
      
      timer.end();
      
      return respond(500, { 
        error: 'Processing failed',
        jobId,
        message: error.message
      });
    }
    
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Background function error', { 
      error: error.message, 
      stack: error.stack 
    });
    timer.end();
    
    return respond(500, { 
      error: 'Background function failed',
      message: error.message
    });
  }
}

/**
 * Execute AI processing with function calling loop
 */
async function executeBackgroundProcessing(analysisData, systemId, customPrompt, jobId, log) {
  const conversationHistory = [];
  const toolCallsExecuted = [];
  let iterationCount = 0;
  
  const startTime = Date.now();
  
  log.info('Starting AI function calling loop', { 
    jobId,
    hasSystemId: !!systemId, 
    hasCustomPrompt: !!customPrompt 
  });
  
  // Get AI model
  const model = await getAIModelWithTools(log);
  if (!model) {
    throw new Error('AI model not available');
  }
  
  // Build enhanced prompt
  const initialPrompt = await buildEnhancedPrompt(analysisData, systemId, customPrompt, log);
  
  conversationHistory.push({
    role: 'user',
    content: initialPrompt
  });
  
  // Multi-turn conversation loop
  while (iterationCount < MAX_TOOL_ITERATIONS) {
    iterationCount++;
    
    // Check total timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > TOTAL_TIMEOUT_MS) {
      log.warn('Processing exceeded total timeout', {
        jobId,
        elapsedTime,
        iterationCount
      });
      throw new Error('Analysis exceeded time limit. Try a simpler question.');
    }
    
    log.info(`Processing iteration ${iterationCount}`, {
      jobId,
      conversationLength: conversationHistory.length,
      elapsedTime: `${elapsedTime}ms`
    });
    
    // Add progress event for iteration start
    await addProgressEvent(jobId, {
      type: 'iteration',
      data: { 
        iteration: iterationCount,
        elapsedSeconds: Math.floor(elapsedTime / 1000)
      }
    }, log);
    
    // Generate response from Gemini with timeout
    const iterationStartTime = Date.now();
    let response;
    
    try {
      const conversationText = conversationHistory.map(msg => 
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
      ).join('\n\n');
      
      const responsePromise = model.generateContent(conversationText);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Iteration timeout')), ITERATION_TIMEOUT_MS)
      );
      
      response = await Promise.race([responsePromise, timeoutPromise]);
    } catch (error) {
      if (error.message === 'Iteration timeout') {
        log.warn('Gemini iteration timed out', { 
          jobId,
          iteration: iterationCount,
          duration: Date.now() - iterationStartTime
        });
        throw new Error('AI processing took too long. Try simplifying your question.');
      }
      throw error;
    }
    
    const responseText = response.response.text();
    
    // Try to parse as JSON
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText.trim());
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[1].trim());
        } catch {
          parsedResponse = null;
        }
      } else {
        const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonObjectMatch) {
          try {
            parsedResponse = JSON.parse(jsonObjectMatch[0]);
          } catch {
            parsedResponse = null;
          }
        } else {
          parsedResponse = null;
        }
      }
    }
    
    // Check if it's a tool call
    if (parsedResponse && parsedResponse.tool_call) {
      log.info('AI requested tool call', {
        jobId,
        toolName: parsedResponse.tool_call,
        iteration: iterationCount
      });
      
      // Add progress event for tool call
      await addProgressEvent(jobId, {
        type: 'tool_call',
        data: { 
          tool: parsedResponse.tool_call,
          parameters: parsedResponse.parameters,
          iteration: iterationCount
        }
      }, log);
      
      // Execute the tool
      const { executeToolCall } = require('./utils/gemini-tools.cjs');
      const toolResult = await executeToolCall(
        parsedResponse.tool_call,
        parsedResponse.parameters,
        log
      );
      
      toolCallsExecuted.push({
        name: parsedResponse.tool_call,
        parameters: parsedResponse.parameters,
        iteration: iterationCount
      });
      
      // Add progress event for tool response
      await addProgressEvent(jobId, {
        type: 'tool_response',
        data: { 
          tool: parsedResponse.tool_call,
          success: !toolResult.error,
          dataSize: JSON.stringify(toolResult).length
        }
      }, log);
      
      // Check if tool execution failed
      if (toolResult.error) {
        log.warn('Tool execution returned error', { 
          jobId,
          toolName: parsedResponse.tool_call,
          error: toolResult.message 
        });
        
        conversationHistory.push({
          role: 'assistant',
          content: JSON.stringify(parsedResponse)
        });
        conversationHistory.push({
          role: 'user',
          content: `Tool execution error: ${toolResult.message}. Please adjust your request or provide an answer with available data.`
        });
        continue;
      }
      
      // Send tool result back to Gemini
      conversationHistory.push({
        role: 'assistant',
        content: JSON.stringify(parsedResponse)
      });
      conversationHistory.push({
        role: 'user',
        content: `Tool response from ${parsedResponse.tool_call}:\n${JSON.stringify(toolResult, null, 2)}`
      });
      
      continue;
    }
    
    // Check if it's a final answer
    if (parsedResponse && parsedResponse.final_answer) {
      log.info('Received final answer from AI', {
        jobId,
        iterations: iterationCount,
        toolCallsUsed: toolCallsExecuted.length
      });
      
      // Update partial insights with final answer
      await updatePartialInsights(jobId, parsedResponse.final_answer, log);
      
      // Add progress event for completion
      await addProgressEvent(jobId, {
        type: 'ai_response',
        data: { 
          type: 'final_answer',
          iteration: iterationCount
        }
      }, log);
      
      return {
        insights: {
          rawText: parsedResponse.final_answer,
          formattedText: formatInsightsResponse(parsedResponse.final_answer),
          healthStatus: 'Generated',
          performance: { trend: 'See analysis above' }
        },
        toolCalls: toolCallsExecuted,
        usedFunctionCalling: toolCallsExecuted.length > 0,
        iterations: iterationCount
      };
    }
    
    // No JSON structure, treat as final answer (plain text)
    log.info('Received plain text response (treating as final answer)', {
      jobId,
      iterations: iterationCount
    });
    
    await updatePartialInsights(jobId, responseText, log);
    
    return {
      insights: {
        rawText: responseText,
        formattedText: formatInsightsResponse(responseText),
        healthStatus: 'Generated',
        performance: { trend: 'See analysis above' }
      },
      toolCalls: toolCallsExecuted,
      usedFunctionCalling: toolCallsExecuted.length > 0,
      iterations: iterationCount
    };
  }
  
  // Max iterations reached
  log.warn('Max iterations reached', {
    jobId,
    maxIterations: MAX_TOOL_ITERATIONS,
    toolCallsExecuted: toolCallsExecuted.length
  });
  
  const lastAssistantMsg = conversationHistory
    .filter(msg => msg.role === 'assistant')
    .pop();
  
  const fallbackAnswer = lastAssistantMsg 
    ? `Analysis incomplete (max iterations reached). Partial results:\n\n${lastAssistantMsg.content}`
    : 'Analysis could not be completed. Please try a simpler question.';
  
  return {
    insights: {
      rawText: fallbackAnswer,
      formattedText: formatInsightsResponse(fallbackAnswer),
      healthStatus: 'Incomplete',
      performance: { trend: 'Analysis incomplete' }
    },
    toolCalls: toolCallsExecuted,
    usedFunctionCalling: toolCallsExecuted.length > 0,
    iterations: iterationCount,
    warning: 'Max iterations reached'
  };
}

/**
 * Format insights response for better display
 */
function formatInsightsResponse(text) {
  if (text.includes('═══') || text.includes('🔋 Battery System')) {
    return text;
  }
  
  const lines = [];
  lines.push('═══════════════════════════════════════════════════');
  lines.push('🔋 BATTERY SYSTEM INSIGHTS');
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');
  lines.push(text);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('═══════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Build enhanced prompt - reuse logic from generate-insights-with-tools
 */
async function buildEnhancedPrompt(analysisData, systemId, customPrompt, log) {
  const { toolDefinitions } = require('./utils/gemini-tools.cjs');
  
  let prompt = `You are a BMS (Battery Management System) data analyst. Your goal is to answer the user's question based on the data provided.

You will receive an initial data set (current battery snapshot and recent historical data if available).

**IMPORTANT INSTRUCTIONS FOR DATA REQUESTS:**

1. If you can answer the user's question with the data provided, you **must** respond with a JSON object containing ONLY a \`final_answer\` key:
   {
     "final_answer": "Your detailed analysis here..."
   }

2. If the data is insufficient, you **must** request more data by responding with ONLY a JSON object that calls a tool. Do not add any conversational text. Format:
   {
     "tool_call": "tool_name",
     "parameters": {
       "param1": "value1",
       "param2": "value2"
     }
   }

**AVAILABLE TOOLS:**

${JSON.stringify(toolDefinitions, null, 2)}

**CURRENT BATTERY SNAPSHOT:**
${JSON.stringify(analysisData, null, 2)}
`;
  
  // Load initial historical data if systemId provided
  if (systemId) {
    try {
      const { getHourlyAveragedData, formatHourlyDataForAI } = require('./utils/data-aggregation.cjs');
      const DEFAULT_DAYS_LOOKBACK = 30;
      
      log.info('Loading initial historical data', { systemId });
      const hourlyData = await getHourlyAveragedData(systemId, DEFAULT_DAYS_LOOKBACK, log);
      
      if (hourlyData && hourlyData.length > 0) {
        const initialHistoricalData = formatHourlyDataForAI(hourlyData, log);
        
        prompt += `

**SYSTEM ID:** ${systemId}

**INITIAL HISTORICAL DATA (${DEFAULT_DAYS_LOOKBACK} days of hourly averages):**
${JSON.stringify(initialHistoricalData, null, 2)}

Note: This is ${hourlyData.length} hours of data. If you need different metrics, time ranges, or granularity, use the request_bms_data tool.
`;
      } else {
        prompt += `

**SYSTEM ID:** ${systemId}

No historical data found. You can use request_bms_data to query data if needed.
`;
      }
    } catch (error) {
      log.error('Failed to load initial historical data', { error: error.message, systemId });
      prompt += `

**SYSTEM ID:** ${systemId}

Historical data temporarily unavailable.
`;
    }
  }
  
  prompt += '\n\n';
  
  if (customPrompt) {
    prompt += `**USER QUESTION:**
${customPrompt}

**YOUR TASK:**
Analyze the data and answer the question comprehensively. Use tools if you need more data.
Always respond with valid JSON (either tool_call or final_answer).
`;
  } else {
    prompt += `**YOUR TASK:**
Provide a comprehensive battery health analysis with deep insights based on available data.
Use tools to request additional data if needed for thorough analysis.
Always respond with valid JSON (either tool_call or final_answer).
`;
  }
  
  return prompt;
}

/**
 * Get AI model instance
 */
async function getAIModelWithTools(log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log.error('GEMINI_API_KEY not configured');
    return null;
  }
  
  const genAI = new GoogleGenerativeAI(apiKey);
  
  const modelsToTry = [
    { name: 'gemini-2.5-flash', description: 'latest stable model' },
    { name: 'gemini-2.0-flash-exp', description: 'experimental model' },
    { name: 'gemini-1.5-flash', description: 'fallback stable model' }
  ];
  
  for (const { name, description } of modelsToTry) {
    try {
      log.info(`Attempting to use ${name} (${description})`);
      
      const model = genAI.getGenerativeModel({
        model: name,
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
        }
      });
      
      log.info(`Model ${name} initialized successfully`);
      return model;
    } catch (err) {
      log.warn(`Failed to initialize ${name}`, { error: err.message });
    }
  }
  
  log.error('All AI models unavailable');
  return null;
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
