const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createLogger, createTimer } = require('./utils/logger.cjs');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Token estimation helper (1 token ≈ 4 characters)
const estimateTokens = (str) => Math.ceil(str.length / 4);
const MAX_TOKENS = 28000; // 28k for safety (Gemini Pro's limit is 32k)

exports.handler = async (event, context) => {
  const log = createLogger('generate-insights', context);
  const timer = createTimer(log, 'generate-insights-handler');
  log.entry({ method: event.httpMethod, path: event.path });

  try {
    // 1. Safe input parsing
    const body = JSON.parse(event.body || '{}');
    const { analysisData: batteryData, systemId, customPrompt } = body;
    const requestContext = { systemId, hasBatteryData: !!batteryData };

    // 2. Input validation
    if (!batteryData?.measurements) {
      log.warn('Missing/invalid battery data', requestContext);
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid battery data format' }) };
    }

    // 3. Token safety check
    const dataString = JSON.stringify(batteryData);
    const dataTokens = estimateTokens(dataString);
    
    if (dataTokens > MAX_TOKENS) {
      log.warn('Battery data exceeds token limit', {
        systemId,
        dataTokens,
        maxTokens: MAX_TOKENS
      });
      return {
        statusCode: 413,
413,
        body: JSON.stringify({
          error: 'Battery data too large',
          maxTokens: MAX_TOKENS,
          actualTokens: dataTokens,
          suggestion: 'Reduce measurement points or summarize data'
        })
      };
    }

    // 4. Generate optimized prompt
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const prompt = buildPrompt(systemId, batteryData, customPrompt);
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
        tokenUsage: { promptTokens, generatedTokens: estimateTokens(insightsText) },
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
function buildPrompt(systemId, batteryData, customPrompt) {
  const baseContext = `SYSTEM ID: ${systemId || 'N/A'}\nBATTERY DATA:\n${JSON.stringify(batteryData)}`;
  
  return customPrompt
    ? `${baseContext}\n\nUSER QUERY: ${sanitizePrompt(customPrompt)}\n\nRESPONSE FORMAT: JSON {
      healthStatus: string,
      performanceSummary: string,
      recommendations: string[],
      estimatedLifespan: string,
      efficiencyNotes: string
    }`
    : `${baseContext}\n\nANALYZE AND PROVIDE:\n1. Health status\n2. Performance trends\n3. Maintenance recommendations\n4. Estimated lifespan\n5. Efficiency notes\n\nRESPONSE FORMAT: JSON (same keys as above)`;
}

function sanitizePrompt(prompt) {
  return prompt.replace(/[{}<>\[\]]/g, '').substring(0, 1000);
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
  const measurements = batteryData.measurements;
  if (!measurements?.length) return { trend: 'Unknown', score: 0 };

  const first = measurements[0];
  const last = measurements[measurements.length - 1];
  const capacityRetention = (last.capacity / first.capacity) * 100;

  return {
    trend: capacityRetention > 90 ? 'Excellent' : 
           capacityRetention > 70 ? 'Good' : 'Poor',
    capacityRetention: Math.round(capacityRetention),
    degradationRate: parseFloat(((first.capacity - last.capacity) / measurements.length).toFixed(2))
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
        Math.abs(curr.soc - prev.soc) > 5) { // Minimum 5% SOC change
      const chargeEff = (curr.energyIn - prev.energyIn) / (curr.soc - prev.soc);
      totalChargeEff += chargeEff;
      validCycles++;
    }
  }

  const avgChargeEff = validCycles ? parseFloat((totalChargeEff / validCycles).toFixed(2)) : 0;
  
  return {
    chargeEfficiency: avgChargeEff,
    dischargeEfficiency: avgChargeEff * 0.92, // Typical discharge efficiency
    cyclesAnalyzed: validCycles
  };
}

// --- Text Extraction Functions (More Robust) ---
function extractHealthStatus(text) {
  const status = text.match(/(excellent|good|fair|poor|critical|unknown)/i);
  return status?.[1]?.toLowerCase() || 'unknown';
}

function extractRecommendations(text) {
  return text.split('\n')
    .filter(line => /recommend|suggest|advise|should|consider/i.test(line))
    .slice(0, 3)
    .map(line => line.replace(/^[-\d\.\s]+/, '').trim());
}

function extractLifespan(text) {
  const match = text.match(/(\d+\s*-\s*\d+|\d+)\s*(months|years)/i);
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
