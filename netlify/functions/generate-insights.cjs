const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createLogger, createTimer } = require('./utils/logger.cjs');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Token estimation helper (1 token ≈ 4 characters)
const estimateTokens = (str) => Math.ceil((str || '').length / 4);
const MAX_TOKENS = 28000; // 28k for safety (Gemini Pro's limit is 32k)
const BASE_PROMPT_TOKENS = 1500; // Estimated tokens for prompt template

exports.handler = async (event, context) => {
  const log = createLogger('generate-insights', context);
  const timer = createTimer(log, 'generate-insights-handler');
  log.entry({ method: event.httpMethod, path: event.path });

  try {
    // 1. Safe input parsing
    const body = JSON.parse(event.body || '{}');
    const { analysisData: batteryData, systemId, customPrompt } = body;
    const requestContext = { systemId, hasBatteryData: !!batteryData };

    // 2. Enhanced Input validation
    if (!batteryData) {
      log.warn('Missing battery data', requestContext);
      return { statusCode: 400, body: JSON.stringify({ error: 'Battery data is required' }) };
    }

    if (!Array.isArray(batteryData.measurements)) {
      log.warn('Invalid measurements format', { ...requestContext, receivedType: typeof batteryData.measurements });
      return { statusCode: 400, body: JSON.stringify({ error: 'Battery measurements must be an array' }) };
    }

    if (batteryData.measurements.length === 0) {
      log.warn('Empty measurements array', requestContext);
      return { statusCode: 400, body: JSON.stringify({ error: 'Battery measurements array is empty' }) };
    }

    // 3. Token safety check (optimized)
    const dataString = JSON.stringify(batteryData);
    const dataTokens = estimateTokens(dataString);
    const estimatedTotalTokens = dataTokens + BASE_PROMPT_TOKENS;
    
    if (estimatedTotalTokens > MAX_TOKENS) {
      log.warn('Input exceeds token limit', {
        systemId,
        dataTokens,
        baseTokens: BASE_PROMPT_TOKENS,
        maxTokens: MAX_TOKENS
      });
      return {
        statusCode: 413,
        body: JSON.stringify({
          error: 'Input data too large',
          maxTokens: MAX_TOKENS,
          estimatedTokens: estimatedTotalTokens,
          suggestion: `Reduce data points (current: ${batteryData.measurements.length})`
        })
      };
    }

    // 4. Generate optimized prompt
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const prompt = buildPrompt(systemId, dataString, customPrompt);
    const promptTokens = estimateTokens(prompt);
    
    log.debug('Calling Gemini API', {
      systemId,
      promptTokens,
      remainingTokens: MAX_TOKENS - promptTokens
    });

    // 5. Structured output request
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const insightsText = response.text();
    
    // 6. Parse with fallback
    const structuredInsights = parseInsights(
      insightsText,
      batteryData,
      log
    );

    log.info('Insights generated', requestContext);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        insights: structuredInsights,
        tokenUsage: { 
          prompt: promptTokens, 
          generated: estimateTokens(insightsText),
          total: promptTokens + estimateTokens(insightsText)
        },
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    log.error('Processing failed', { error: error.message });
    return handleError(error, log);
  } finally {
    timer.end();
  }
};

// --- Helper Functions ---
function buildPrompt(systemId, dataString, customPrompt) {
  const baseContext = `SYSTEM ID: ${systemId || 'N/A'}
BATTERY DATA:
${dataString}`;
  
  return customPrompt
    ? `${baseContext}

USER QUERY: ${sanitizePrompt(customPrompt)}

RESPONSE FORMAT: JSON {
      healthStatus: string,
      performanceSummary: string,
      recommendations: string[],
      estimatedLifespan: string,
      efficiencyNotes: string
    }`
    : `${baseContext}

ANALYZE AND PROVIDE:
1. Health status
2. Performance trends
3. Maintenance recommendations
4. Estimated lifespan
5. Efficiency notes

RESPONSE FORMAT: JSON (same keys as above)`;
}

function sanitizePrompt(prompt) {
  return (prompt || '').replace(/[{}<>\[\]]/g, '').substring(0, 1000);
}

function parseInsights(rawInsights, batteryData, log) {
  try {
    // Attempt JSON parse first
    const jsonMatch = rawInsights.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        healthStatus: parsed.healthStatus || extractHealthStatus(rawInsights),
        performance: analyzePerformance(batteryData),
        recommendations: parsed.recommendations || extractRecommendations(rawInsights),
        estimatedLifespan: parsed.estimatedLifespan || extractLifespan(rawInsights),
        efficiency: calculateEfficiency(batteryData),
        rawText: rawInsights
      };
    }
  } catch (e) {
    log.warn('JSON parse failed, using fallback', { error: e.message });
  }
  
  // Fallback to text extraction
  return {
    healthStatus: extractHealthStatus(rawInsights),
    performance: analyzePerformance(batteryData),
    recommendations: extractRecommendations(rawInsights),
    estimatedLifespan: extractLifespan(rawInsights),
    efficiency: calculateEfficiency(batteryData),
    rawText: rawInsights
  };
}

// --- Data Processing Functions (Optimized) ---
function analyzePerformance(batteryData) {
  const measurements = batteryData.measurements || [];
  if (measurements.length < 2) return { trend: 'Insufficient Data', capacityRetention: 0 };

  const first = measurements[0];
  const last = measurements[measurements.length - 1];
  const capacityRetention = (last.capacity / first.capacity) * 100;

  return {
    trend: capacityRetention > 90 ? 'Excellent' : 
           capacityRetention > 70 ? 'Good' : 'Poor',
    capacityRetention: Math.round(capacityRetention),
    degradationRate: parseFloat(((first.capacity - last.capacity) / measurements.length).toFixed(4))
  };
}

function calculateEfficiency(batteryData) {
  const measurements = batteryData.measurements || [];
  let totalChargeEff = 0;
  let validCycles = 0;

  for (let i = 1; i < measurements.length; i++) {
    const prev = measurements[i-1];
    const curr = measurements[i];
    
    if (curr.state === 'charging' && 
        prev.state === 'discharging' &&
        Math.abs(curr.soc - prev.soc) > 5) {
      const chargeEff = (curr.energyIn - prev.energyIn) / (curr.soc - prev.soc);
      totalChargeEff += chargeEff;
      validCycles++;
    }
  }

  const avgChargeEff = validCycles ? parseFloat((totalChargeEff / validCycles).toFixed(4)) : 0;
  
  return {
    chargeEfficiency: avgChargeEff,
    dischargeEfficiency: avgChargeEff * 0.92, // Typical discharge efficiency
    cyclesAnalyzed: validCycles
  };
}

// --- Text Extraction Functions ---
function extractHealthStatus(text) {
  const status = text.match(/(excellent|good|fair|poor|critical|unknown)/i);
  return status?.[1]?.toLowerCase() || 'unknown';
}

function extractRecommendations(text) {
  return (text || '').split('
')
    .filter(line => /recommend|suggest|advise|should|consider/i.test(line))
    .slice(0, 3)
    .map(line => line.replace(/^[-\d\.\s]+/, '').trim());
}

function extractLifespan(text) {
  const match = (text || '').match(/(\d+\s*-\s*\d+|\d+)\s*(months|years)/i);
  return match?.[0] || 'Unknown';
}

// --- Error Handler ---
function handleError(error, log) {
  const status = error.message.includes('timeout') ? 504 : 500;
  return {
    statusCode: status,
    body: JSON.stringify({
      error: status === 504 ? 'Processing timeout' : 'Insights generation failed',
      details: error.message.replace(/api key|gemini|google/gi, '***')
    })
  };
}
