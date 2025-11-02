const { GoogleGenerativeAI } = require('@google/generative-ai');
// ... existing code ...
const { createLogger, createTimer } = require('./utils/logger');

// Initialize Gemini AI
// ... existing code ...
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.handler = async (event, context) => {
// ... existing code ...
  const log = createLogger('generate-insights', context);
  const timer = createTimer(log, 'generate-insights-handler');
// ... existing code ...
  log.entry({ method: event.httpMethod, path: event.path });
  // Add timeout handling
// ... existing code ...
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Function timeout')), 45000)
// ... existing code ...
  );

  const mainProcessingLogic = async (event) => {
// ... existing code ...
    try {
      log.debug('Parsing request body', { bodyLength: event.body?.length });
      // ***FIX: Destructure 'analysisData' from the request and rename it to 'batteryData'***
      const { analysisData: batteryData, systemId, customPrompt } = JSON.parse(event.body);
      
      const requestContext = { systemId, hasBatteryData: !!batteryData };
// ... existing code ...
      
      if (!batteryData) { // systemId is optional, but batteryData is required
        log.warn('Missing required parameters', requestContext);
// ... existing code ...
        const durationMs = timer.end();
        log.exit(400);
// ... existing code ...
        return {
          statusCode: 400,
// ... existing code ...
          body: JSON.stringify({ error: 'Missing required parameters' })
        };
      }

// ... existing code ...
      log.info('Generating insights', requestContext);
      // Initialize Gemini model
      // ***FIX: Updated model name to resolve 404 error***
      // ***UPDATE: Using 'latest' as requested to stay up-to-date.***
      const modelName = 'gemini-2.5-flash-latest';
      const model = genAI.getGenerativeModel({ model: modelName });
      log.debug('Gemini model initialized', { model: modelName });

      // Prepare insights prompt
      // ***FIX: Use customPrompt if it exists, otherwise use the standard prompt***
      const prompt = customPrompt
        ? `
          Using the following system data as context:
          System ID: ${systemId || 'N/A'}
          Battery Data: ${JSON.stringify(batteryData, null, 2)}

          Answer this user query: "${customPrompt}"
        `
        : `
          Analyze this battery data and provide comprehensive insights:
          System ID: ${systemId || 'N/A'}
          Battery Data: ${JSON.stringify(batteryData, null, 2)}
// ... existing code ...
        
          Please provide:
          1. Health status assessment
// ... existing code ...
          2. Performance trends
          3. Maintenance recommendations
          4. Estimated lifespan
// ... existing code ...
          5. Efficiency metrics
        `;

      // Generate insights with streaming
// ... existing code ...
      log.debug('Calling Gemini API to generate insights', requestContext);
      const result = await model.generateContent(prompt);
// ... existing code ...
      const response = await result.response;
      const insights = response.text();
// ... existing code ...
      log.debug('Received insights from Gemini', { systemId, insightsLength: insights.length });

      // Parse and structure the insights
// ... existing code ...
      log.debug('Parsing and structuring insights', requestContext);
      const structuredInsights = parseInsights(insights, batteryData, log);

// ... existing code ...
      log.info('Insights generated successfully', requestContext);
      const durationMs = timer.end({ success: true });
// ... existing code ...
      log.exit(200, requestContext);
      return {
// ... existing code ...
        statusCode: 200,
        body: JSON.stringify({
// ... existing code ...
          success: true,
          insights: structuredInsights,
// ... existing code ...
          timestamp: new Date().toISOString()
        })
      };

// ... existing code ...
    } catch (error) {
      log.error('Error generating insights', { systemId: (JSON.parse(event.body) || {}).systemId, error: error.message, stack: error.stack });
      const durationMs = timer.end({ success: false });
      log.exit(500);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Failed to generate insights',
          details: error.message 
        })
      };
    }
  };

  try {
// ... existing code ...
    const result = await Promise.race([mainProcessingLogic(event), timeoutPromise]);
    return result;
// ... existing code ...
  } catch (error) {
    // Handle timeout specifically
// ... existing code ...
    if (error.message === 'Function timeout') {
      log.warn('Function timeout', { timeoutMs: 45000 });
// ... existing code ...
      const durationMs = timer.end({ success: false, timeout: true });
      log.exit(504);
// ... existing code ...
      return { 
        statusCode: 504, 
// ... existing code ...
        body: JSON.stringify({ 
          error: 'Processing timeout',
// ... existing code ...
          message: 'Insights generation took too long. Please try again.' 
        })
      };
// ... existing code ...
    }
    // Other error handling
// ... existing code ...
    log.error('Unexpected error in generate-insights handler', { error: error.message, stack: error.stack });
    const durationMs = timer.end({ success: false });
// ... existing code ...
    log.exit(500);
    return {
// ... existing code ...
      statusCode: 500,
      body: JSON.stringify({ 
// ... existing code ...
        error: 'Processing failed',
        details: error.message 
// ... existing code ...
      })
    };
  }
};

function parseInsights(rawInsights, batteryData, log) {
// ... existing code ...
  log.debug('Parsing raw insights', { rawLength: rawInsights.length });
  // Extract structured data from AI response
// ... existing code ...
  const insights = {
    healthStatus: extractHealthStatus(rawInsights),
// ... existing code ...
    performance: analyzePerformance(batteryData),
    recommendations: extractRecommendations(rawInsights),
// ... existing code ...
    estimatedLifespan: extractLifespan(rawInsights),
    efficiency: calculateEfficiency(batteryData),
// ... existing code ...
    rawText: rawInsights
  };

// ... existing code ...
  return insights;
}

function extractHealthStatus(text) {
// ... existing code ...
  const statusPatterns = [
    /health status[:\s]*(\w+)/i,
// ... existing code ...
    /condition[:\s]*(\w+)/i,
    /(\w+)\s+health/i
// ... existing code ...
  ];

  for (const pattern of statusPatterns) {
// ... existing code ...
    const match = text.match(pattern);
    if (match) return match[1];
  }

// ... existing code ...
  return 'Unknown';
}

function analyzePerformance(batteryData) {
// ... existing code ...
  if (!batteryData || !batteryData.measurements) {
    return { trend: 'Unknown', score: 0 };
  }

// ... existing code ...
  const measurements = batteryData.measurements;
  const latest = measurements[measurements.length - 1];
// ... existing code ...
  const earliest = measurements[0];

  const capacityLoss = earliest.capacity - latest.capacity;
// ... existing code ...
  const capacityRetention = (latest.capacity / earliest.capacity) * 100;

  return {
// ... existing code ...
    trend: capacityRetention > 90 ? 'Excellent' : capacityRetention > 70 ? 'Good' : 'Poor',
    capacityRetention: Math.round(capacityRetention),
// ... existing code ...
    degradationRate: Math.round(capacityLoss / measurements.length * 100) / 100
  };
}

function extractRecommendations(text) {
// ... existing code ...
  const recommendations = [];
  const lines = text.split('\n');
// ... existing code ...
  
  for (const line of lines) {
    if (line.includes('recommend') || line.includes('suggest') || line.includes('should')) {
// ... existing code ...
      recommendations.push(line.trim());
    }
  }

// ... existing code ...
  return recommendations.slice(0, 5); // Limit to top 5 recommendations
}

function extractLifespan(text) {
// ... existing code ...
  const lifespanPatterns = [
    /(\d+)\s+days/i,
// ... existing code ...
    /(\d+)\s+months/i,
    /(\d+)\s+years/i
// ... existing code ...
  ];

  for (const pattern of lifespanPatterns) {
// ... existing code ...
    const match = text.match(pattern);
    if (match) return match[0];
  }

// ... existing code ...
  return 'Unknown';
}

function calculateEfficiency(batteryData) {
// ... existing code ...
  if (!batteryData || !batteryData.measurements) {
    return { chargeEfficiency: 0, dischargeEfficiency: 0 };
  }

// ... existing code ...
  // Calculate efficiency based on charge/discharge cycles
  const measurements = batteryData.measurements;
// ... existing code ...
  let totalChargeEfficiency = 0;
  let totalDischargeEfficiency = 0;
// ... existing code ...
  let cycleCount = 0;

  for (let i = 1; i < measurements.length; i++) {
// ... existing code ...
    const prev = measurements[i - 1];
    const curr = measurements[i];

    if (curr.state === 'charging' && prev.state === 'discharging') {
// ... existing code ...
      const chargeEfficiency = (curr.energyIn - prev.energyIn) / (curr.soc - prev.soc);
      totalChargeEfficiency += chargeEfficiency;
// ... existing code ...
      cycleCount++;
    }
  }

// ... existing code ...
  return {
    chargeEfficiency: cycleCount > 0 ? Math.round(totalChargeEfficiency / cycleCount * 100) / 100 : 0,
// ... existing code ...
    dischargeEfficiency: cycleCount > 0 ? Math.round(totalDischargeEfficiency / cycleCount * 100) / 100 : 0,
    averageCycleEfficiency: cycleCount > 0 ? Math.round((totalChargeEfficiency + totalDischargeEfficiency) / cycleCount * 100) / 100 : 0
// ... existing code ...
  };
}

