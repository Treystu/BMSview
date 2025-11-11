const { GoogleGenAI } = require("@google/genai");
const { connectDB } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');
const { validateObjectId, validateRequest } = require('./utils/validation.cjs');
const crypto = require('crypto');
const axios = require('axios');

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Constants
const MAX_SYNC_DURATION = 55000; // 55s for Netlify function timeout
const MAX_REACT_ITERATIONS = 5;
const JOB_EXPIRY_HOURS = 24;

// Tool definitions for ReAct loop
const AVAILABLE_TOOLS = {
  getHistoricalData: {
    description: "Retrieve historical BMS data for trend analysis",
    parameters: {
      systemId: { type: "string", required: true },
      timeRange: { type: "string", enum: ["week", "month", "3months", "year"], default: "month" }
    },
    execute: async ({ systemId, timeRange = "month" }) => {
      const db = await connectDB();
      const timeLimits = {
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        "3months": 90 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000
      };
      
      const analyses = await db.collection('analyses')
        .find({
          systemId,
          timestamp: { $gte: new Date(Date.now() - timeLimits[timeRange]) }
        })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();
      
      return {
        count: analyses.length,
        timeRange,
        data: analyses.map(a => ({
          timestamp: a.timestamp,
          soc: a.extractedData?.soc,
          voltage: a.extractedData?.voltage,
          current: a.extractedData?.current,
          temperature: a.extractedData?.temperature,
          health: a.healthScore
        }))
      };
    }
  },
  
  calculateTrends: {
    description: "Calculate statistical trends from time series data",
    parameters: {
      data: { type: "array", required: true },
      metric: { type: "string", required: true }
    },
    execute: async ({ data, metric }) => {
      if (!data || data.length < 2) return { error: "Insufficient data for trend analysis" };
      
      const values = data.map(d => d[metric]).filter(v => v != null);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      
      // Simple linear regression for trend
      const n = values.length;
      const indices = Array.from({ length: n }, (_, i) => i);
      const sumX = indices.reduce((a, b) => a + b, 0);
      const sumY = values.reduce((a, b) => a + b, 0);
      const sumXY = indices.reduce((a, x, i) => a + x * values[i], 0);
      const sumX2 = indices.reduce((a, x) => a + x * x, 0);
      
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const trend = slope > 0.01 ? "increasing" : slope < -0.01 ? "decreasing" : "stable";
      
      return {
        metric,
        statistics: { mean, stdDev, min: Math.min(...values), max: Math.max(...values) },
        trend: { direction: trend, slope, confidence: Math.abs(slope) * 100 }
      };
    }
  },
  
  getWeatherData: {
    description: "Get weather data for solar charging predictions",
    parameters: {
      location: { type: "string", required: true }
    },
    execute: async ({ location }) => {
      try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) return { error: "Weather service not configured" };
        
        const response = await axios.get(
          `https://api.openweathermap.org/data/2.5/forecast?q=${location}&appid=${apiKey}&units=metric`
        );
        
        return {
          location: response.data.city.name,
          forecast: response.data.list.slice(0, 5).map(item => ({
            datetime: new Date(item.dt * 1000).toISOString(),
            temp: item.main.temp,
            clouds: item.clouds.all,
            description: item.weather[0].description
          }))
        };
      } catch (error) {
        return { error: "Weather data unavailable" };
      }
    }
  },
  
  estimateSolarCharging: {
    description: "Estimate solar charging potential based on system specs and weather",
    parameters: {
      batteryCapacity: { type: "number", required: true },
      solarPanelWatts: { type: "number", default: 400 },
      efficiency: { type: "number", default: 0.85 },
      cloudCover: { type: "number", default: 20 }
    },
    execute: async ({ batteryCapacity, solarPanelWatts = 400, efficiency = 0.85, cloudCover = 20 }) => {
      const sunHours = 5 * (1 - cloudCover / 100); // Simplified model
      const dailyGeneration = solarPanelWatts * sunHours * efficiency;
      const chargingTime = (batteryCapacity * 1000) / (solarPanelWatts * efficiency);
      
      return {
        estimatedDailyGeneration: `${(dailyGeneration / 1000).toFixed(2)} kWh`,
        fullChargeTime: `${chargingTime.toFixed(1)} hours`,
        efficiency: `${(efficiency * 100).toFixed(0)}%`,
        assumptions: {
          sunHours,
          panelWatts: solarPanelWatts,
          cloudCover: `${cloudCover}%`
        }
      };
    }
  },
  
  queryKnowledgeBase: {
    description: "Search internal knowledge base for battery maintenance and troubleshooting",
    parameters: {
      query: { type: "string", required: true },
      category: { type: "string", enum: ["maintenance", "troubleshooting", "optimization", "safety"] }
    },
    execute: async ({ query, category }) => {
      // Simulated knowledge base - in production, this would query a vector DB
      const knowledgeBase = {
        maintenance: [
          "Regular equalization charges help balance cell voltages",
          "Keep terminals clean and connections tight",
          "Check electrolyte levels monthly for flooded batteries"
        ],
        troubleshooting: [
          "High voltage deviation indicates cell imbalance",
          "Rapid SOC drops suggest parasitic loads or failing cells",
          "Temperature spikes during charging indicate overcharging"
        ],
        optimization: [
          "Maintain SOC between 20-80% for maximum lifespan",
          "Use temperature compensation for charging voltage",
          "Size solar arrays for 1.2-1.5x daily consumption"
        ],
        safety: [
          "Install proper ventilation for hydrogen gas dissipation",
          "Use appropriate PPE when handling batteries",
          "Implement overcurrent and overvoltage protection"
        ]
      };
      
      const results = knowledgeBase[category] || knowledgeBase.troubleshooting;
      return {
        category,
        query,
        results: results.filter(r => 
          r.toLowerCase().includes(query.toLowerCase()) || 
          query.toLowerCase().split(' ').some(word => r.toLowerCase().includes(word))
        ).slice(0, 3)
      };
    }
  }
};

// ReAct Loop Implementation
class ReActAgent {
  constructor(model, analysisData, customQuery = null, logger = null) {
    this.model = model;
    this.analysisData = analysisData;
    this.customQuery = customQuery;
    this.logger = logger;
    this.thoughtHistory = [];
    this.toolCallHistory = [];
    this.iterations = 0;
  }

  async execute() {
    const systemPrompt = this.buildSystemPrompt();
    let currentContext = this.buildInitialContext();
    
    while (this.iterations < MAX_REACT_ITERATIONS) {
      this.iterations++;
      
      // THINK: Generate reasoning about what information is needed
      const thought = await this.think(systemPrompt, currentContext);
      this.thoughtHistory.push(thought);
      
      // Check if we have enough information to provide final answer
      if (thought.includes("[SUFFICIENT]") || this.iterations === MAX_REACT_ITERATIONS) {
        break;
      }
      
      // ACT: Extract and execute tool calls
      const toolCalls = this.extractToolCalls(thought);
      for (const toolCall of toolCalls) {
        const result = await this.executeTool(toolCall);
        this.toolCallHistory.push({ tool: toolCall.tool, params: toolCall.params, result });
        currentContext += `\n\nTool: ${toolCall.tool}\nResult: ${JSON.stringify(result, null, 2)}`;
      }
      
      // If no tools were called, prevent infinite loop
      if (toolCalls.length === 0) {
        break;
      }
    }
    
    // Generate final comprehensive insights
    return await this.generateFinalInsights(systemPrompt, currentContext);
  }

  buildSystemPrompt() {
    return `You are Battery Guru, an expert AI assistant specializing in Battery Management Systems (BMS) analysis.
    
Your role is to provide comprehensive, actionable insights using a ReAct (Reasoning and Action) approach:
1. THINK about what information is needed
2. ACT by calling appropriate tools
3. OBSERVE the results
4. REPEAT until you have sufficient information
5. SYNTHESIZE a comprehensive response

Available Tools:
${Object.entries(AVAILABLE_TOOLS).map(([name, tool]) => 
  `- ${name}: ${tool.description}`
).join('\n')}

When you need to call a tool, use this format:
[TOOL_CALL: toolName(param1=value1, param2=value2)]

When you have sufficient information, indicate with:
[SUFFICIENT]

Focus on:
- Battery health and performance trends
- Predictive maintenance recommendations
- Optimization strategies
- Safety considerations
- Energy efficiency improvements`;
  }

  buildInitialContext() {
    const context = [`Current BMS Analysis Data:
${JSON.stringify(this.analysisData, null, 2)}`];

    if (this.customQuery) {
      context.push(`\nUser Query: ${this.customQuery}`);
    }

    context.push(`\nSystem Information:
- System ID: ${this.analysisData.systemId || 'Unknown'}
- Timestamp: ${this.analysisData.timestamp || new Date().toISOString()}
- Battery Type: ${this.analysisData.extractedData?.batteryType || 'Unknown'}
- Current SOC: ${this.analysisData.extractedData?.soc || 'Unknown'}%
- Voltage: ${this.analysisData.extractedData?.voltage || 'Unknown'}V
- Temperature: ${this.analysisData.extractedData?.temperature || 'Unknown'}°C`);

    return context.join('\n');
  }

  async think(systemPrompt, context) {
    const prompt = `${systemPrompt}\n\nContext:\n${context}\n\nThought ${this.iterations}: What information do I need to provide comprehensive insights?`;
    
    const result = await this.model.generateContent(prompt);
    return result.response.text();
  }

  extractToolCalls(thought) {
    const toolCallRegex = /\[TOOL_CALL:\s*(\w+)\((.*?)\)\]/g;
    const calls = [];
    let match;
    
    while ((match = toolCallRegex.exec(thought)) !== null) {
      const [, toolName, paramsStr] = match;
      if (AVAILABLE_TOOLS[toolName]) {
        const params = this.parseParams(paramsStr);
        calls.push({ tool: toolName, params });
      }
    }
    
    return calls;
  }

  parseParams(paramsStr) {
    const params = {};
    const paramRegex = /(\w+)=([^,]+)/g;
    let match;
    
    while ((match = paramRegex.exec(paramsStr)) !== null) {
      const [, key, value] = match;
      // Try to parse as JSON, fallback to string
      try {
        params[key] = JSON.parse(value.trim());
      } catch {
        params[key] = value.trim().replace(/^["']|["']$/g, '');
      }
    }
    
    return params;
  }

  async executeTool(toolCall) {
    const tool = AVAILABLE_TOOLS[toolCall.tool];
    if (!tool) {
      return { error: `Unknown tool: ${toolCall.tool}` };
    }
    
    try {
      return await tool.execute(toolCall.params);
    } catch (error) {
      const errorMessage = error && error.message ? error.message : 'Unknown error';
      
      if (this.logger) {
        this.logger.error('Tool execution error', { 
          tool: toolCall.tool, 
          params: toolCall.params, 
          error: errorMessage 
        });
      }
      return { error: `Tool execution failed: ${errorMessage}` };
    }
  }

  async generateFinalInsights(systemPrompt, context) {
    const finalPrompt = `${systemPrompt}

Context and Analysis Results:
${context}

Tool Call History:
${JSON.stringify(this.toolCallHistory, null, 2)}

Based on all the information gathered, provide comprehensive insights including:

1. **System Health Assessment**: Current state and any concerns
2. **Performance Trends**: Historical patterns and what they indicate
3. **Predictive Insights**: What to expect in the near future
4. **Actionable Recommendations**: Specific steps to optimize the system
5. **Maintenance Schedule**: When and what to check
6. **Energy Optimization**: How to maximize efficiency
7. **Safety Considerations**: Any risks or precautions needed

${this.customQuery ? `\nAlso specifically address the user's question: ${this.customQuery}` : ''}

Format your response in clear sections with specific, actionable advice.`;

    const result = await this.model.generateContent(finalPrompt);
    return result.response.text();
  }
}

// Main handler
exports.handler = async (event, context) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const log = createLogger('generate-insights', context);
  
  try {
    // Parse request
    const { analysisId, systemId, customQuery, mode = 'sync', jobId } = 
      event.httpMethod === 'GET' ? event.queryStringParameters || {} : JSON.parse(event.body || '{}');
    
    // Handle job status check
    if (mode === 'status' && jobId) {
      return await handleJobStatus(jobId, log);
    }
    
    // Validate input
    if (!analysisId && !systemId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Either analysisId or systemId is required' 
        })
      };
    }

    // Get analysis data
    const db = await connectDB();
    let analysisData;
    
    if (analysisId) {
      if (!validateObjectId(analysisId)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid analysisId format' })
        };
      }
      
      analysisData = await db.collection('analyses').findOne({ 
        _id: new (require('mongodb').ObjectId)(analysisId) 
      });
      
      if (!analysisData) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Analysis not found' })
        };
      }
    } else {
      // Get latest analysis for system
      analysisData = await db.collection('analyses')
        .findOne(
          { systemId },
          { sort: { timestamp: -1 } }
        );
      
      if (!analysisData) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'No analysis found for system' })
        };
      }
    }

    // Handle async mode
    if (mode === 'async') {
      return await handleAsyncMode(db, analysisData, customQuery, requestId, log);
    }

    // Execute ReAct loop (sync mode)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
      }
    });

    const agent = new ReActAgent(model, analysisData, customQuery, log);
    
    // Set timeout for sync execution
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), MAX_SYNC_DURATION)
    );
    
    try {
      const insights = await Promise.race([
        agent.execute(),
        timeoutPromise
      ]);

      // Store insights
      const insightDoc = {
        analysisId: analysisData._id,
        systemId: analysisData.systemId,
        insights,
        customQuery,
        thoughtHistory: agent.thoughtHistory,
        toolCalls: agent.toolCallHistory,
        iterations: agent.iterations,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        requestId
      };
      
      await db.collection('insights').insertOne(insightDoc);

      log.info('Insights generated successfully', {
        requestId,
        analysisId: analysisData._id,
        iterations: agent.iterations,
        duration: Date.now() - startTime
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          insights,
          metadata: {
            iterations: agent.iterations,
            toolCalls: agent.toolCallHistory.length,
            duration: Date.now() - startTime,
            requestId
          }
        })
      };
      
    } catch (timeoutError) {
      if (timeoutError && timeoutError.message === 'Timeout') {
        // Switch to async mode
        log.info('Switching to async mode due to timeout', { requestId });
        return await handleAsyncMode(db, analysisData, customQuery, requestId, log);
      }
      throw timeoutError;
    }
    
  } catch (error) {
    // Safely handle error object that might be undefined or not a proper Error
    const errorMessage = error && error.message ? error.message : 'Unknown error';
    const errorStack = error && error.stack ? error.stack : '';
    
    log.error('Generate insights error', {
      requestId,
      error: errorMessage,
      stack: errorStack,
      errorType: error ? error.constructor.name : 'undefined'
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to generate insights',
        message: errorMessage,
        requestId
      })
    };
  }
};

// Handle async mode
async function handleAsyncMode(db, analysisData, customQuery, requestId, log) {
  const jobId = crypto.randomUUID();
  
  // Create job record
  const job = {
    _id: jobId,
    type: 'insights',
    status: 'pending',
    analysisId: analysisData._id,
    systemId: analysisData.systemId,
    customQuery,
    requestId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + JOB_EXPIRY_HOURS * 60 * 60 * 1000)
  };
  
  await db.collection('jobs').insertOne(job);
  
  // Start background processing
  processInBackground(jobId, analysisData, customQuery, requestId);
  
  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      jobId,
      message: 'Insights generation started',
      statusUrl: `/.netlify/functions/generate-insights?mode=status&jobId=${jobId}`
    })
  };
}

// Background processing
async function processInBackground(jobId, analysisData, customQuery, requestId) {
  const startTime = Date.now();
  const log = createLogger('generate-insights-background', { requestId });
  
  try {
    const db = await connectDB();
    
    // Update job status
    await db.collection('jobs').updateOne(
      { _id: jobId },
      { $set: { status: 'processing', startedAt: new Date() } }
    );
    
    // Execute ReAct loop
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
      }
    });

    const agent = new ReActAgent(model, analysisData, customQuery, log);
    const insights = await agent.execute();
    
    // Store results
    const insightDoc = {
      analysisId: analysisData._id,
      systemId: analysisData.systemId,
      insights,
      customQuery,
      thoughtHistory: agent.thoughtHistory,
      toolCalls: agent.toolCallHistory,
      iterations: agent.iterations,
      timestamp: new Date(),
      duration: Date.now() - startTime,
      requestId,
      jobId
    };
    
    await db.collection('insights').insertOne(insightDoc);
    
    // Update job with results
    await db.collection('jobs').updateOne(
      { _id: jobId },
      { 
        $set: { 
          status: 'completed',
          completedAt: new Date(),
          duration: Date.now() - startTime,
          result: {
            insights,
            metadata: {
              iterations: agent.iterations,
              toolCalls: agent.toolCallHistory.length
            }
          }
        } 
      }
    );
    
    log.info('Background insights completed', {
      jobId,
      requestId,
      duration: Date.now() - startTime
    });
    
  } catch (error) {
    const errorMessage = error && error.message ? error.message : 'Unknown error';
    
    log.error('Background processing error', {
      jobId,
      requestId,
      error: errorMessage
    });
    
    try {
      const db = await connectDB();
      await db.collection('jobs').updateOne(
        { _id: jobId },
        { 
          $set: { 
            status: 'failed',
            failedAt: new Date(),
            error: errorMessage
          } 
        }
      );
    } catch (updateError) {
      log.error('Failed to update job status', {
        jobId,
        error: updateError && updateError.message ? updateError.message : 'Unknown error'
      });
    }
  }
}

// Handle job status check
async function handleJobStatus(jobId, log) {
  try {
    const db = await connectDB();
    const job = await db.collection('jobs').findOne({ _id: jobId });
    
    if (!job) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Job not found' })
      };
    }
    
    const response = {
      jobId,
      status: job.status,
      createdAt: job.createdAt
    };
    
    if (job.status === 'completed') {
      response.result = job.result;
      response.completedAt = job.completedAt;
      response.duration = job.duration;
    } else if (job.status === 'failed') {
      response.error = job.error;
      response.failedAt = job.failedAt;
    } else if (job.status === 'processing') {
      response.startedAt = job.startedAt;
      response.estimatedCompletion = new Date(job.startedAt.getTime() + 60000); // Estimate 1 minute
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    const errorMessage = error && error.message ? error.message : 'Unknown error';
    
    log.error('Job status check error', { jobId, error: errorMessage });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to check job status' })
    };
  }
}

/**
 * Programmatic function to generate insights with tools (for use by other functions)
 * This is exported for admin-diagnostics and other internal callers
 */
async function generateInsightsWithTools(analysisData, options = {}) {
  const {
    testId,
    mode = 'comprehensive',
    requestedTools = [],
    maxIterations = 3,
    timeoutMs = 30000,
    customPrompt
  } = options;

  const log = createLogger('generateInsightsWithTools', { testId });

  try {
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });
    const agent = new ReActAgent(model, analysisData, customPrompt, log);
    
    const insights = await Promise.race([
      agent.execute(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Insights generation timeout')), timeoutMs)
      )
    ]);

    return {
      summary: insights,
      toolCallsExecuted: agent.toolCallHistory.length,
      iterations: agent.iterations,
      thoughtHistory: agent.thoughtHistory,
      mode
    };
  } catch (error) {
    const errorMessage = error && error.message ? error.message : 'Unknown error';
    
    log.error('generateInsightsWithTools error', { 
      testId, 
      error: errorMessage,
      mode 
    });
    throw error;
  }
}

// Export both the handler and the programmatic function
exports.generateInsightsWithTools = generateInsightsWithTools;
// Backward compatibility alias for tests
exports.generateHandler = exports.handler;
