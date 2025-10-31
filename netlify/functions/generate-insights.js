const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.handler = async (event, context) => {
  // Add timeout handling
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Function timeout')), 45000)
  );

  const mainProcessingLogic = async (event) => {
    try {
      const { batteryData, systemId } = JSON.parse(event.body);
      
      if (!batteryData || !systemId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing required parameters' })
        };
      }

      // Initialize Gemini model
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

      // Prepare insights prompt
      const prompt = `
        Analyze this battery data and provide comprehensive insights:
        System ID: ${systemId}
        Battery Data: ${JSON.stringify(batteryData, null, 2)}
        
        Please provide:
        1. Health status assessment
        2. Performance trends
        3. Maintenance recommendations
        4. Estimated lifespan
        5. Efficiency metrics
      `;

      // Generate insights with streaming
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const insights = response.text();

      // Parse and structure the insights
      const structuredInsights = parseInsights(insights, batteryData);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          insights: structuredInsights,
          timestamp: new Date().toISOString()
        })
      };

    } catch (error) {
      console.error('Error generating insights:', error);
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
    const result = await Promise.race([mainProcessingLogic(event), timeoutPromise]);
    return result;
  } catch (error) {
    // Handle timeout specifically
    if (error.message === 'Function timeout') {
      return { 
        statusCode: 504, 
        body: JSON.stringify({ 
          error: 'Processing timeout',
          message: 'Insights generation took too long. Please try again.' 
        })
      };
    }
    // Other error handling
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Processing failed',
        details: error.message 
      })
    };
  }
};

function parseInsights(rawInsights, batteryData) {
  // Extract structured data from AI response
  const insights = {
    healthStatus: extractHealthStatus(rawInsights),
    performance: analyzePerformance(batteryData),
    recommendations: extractRecommendations(rawInsights),
    estimatedLifespan: extractLifespan(rawInsights),
    efficiency: calculateEfficiency(batteryData),
    rawText: rawInsights
  };

  return insights;
}

function extractHealthStatus(text) {
  const statusPatterns = [
    /health status[:\s]*(\w+)/i,
    /condition[:\s]*(\w+)/i,
    /(\w+)\s+health/i
  ];

  for (const pattern of statusPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return 'Unknown';
}

function analyzePerformance(batteryData) {
  if (!batteryData || !batteryData.measurements) {
    return { trend: 'Unknown', score: 0 };
  }

  const measurements = batteryData.measurements;
  const latest = measurements[measurements.length - 1];
  const earliest = measurements[0];

  const capacityLoss = earliest.capacity - latest.capacity;
  const capacityRetention = (latest.capacity / earliest.capacity) * 100;

  return {
    trend: capacityRetention > 90 ? 'Excellent' : capacityRetention > 70 ? 'Good' : 'Poor',
    capacityRetention: Math.round(capacityRetention),
    degradationRate: Math.round(capacityLoss / measurements.length * 100) / 100
  };
}

function extractRecommendations(text) {
  const recommendations = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (line.includes('recommend') || line.includes('suggest') || line.includes('should')) {
      recommendations.push(line.trim());
    }
  }

  return recommendations.slice(0, 5); // Limit to top 5 recommendations
}

function extractLifespan(text) {
  const lifespanPatterns = [
    /(\d+)\s+days/i,
    /(\d+)\s+months/i,
    /(\d+)\s+years/i
  ];

  for (const pattern of lifespanPatterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return 'Unknown';
}

function calculateEfficiency(batteryData) {
  if (!batteryData || !batteryData.measurements) {
    return { chargeEfficiency: 0, dischargeEfficiency: 0 };
  }

  // Calculate efficiency based on charge/discharge cycles
  const measurements = batteryData.measurements;
  let totalChargeEfficiency = 0;
  let totalDischargeEfficiency = 0;
  let cycleCount = 0;

  for (let i = 1; i < measurements.length; i++) {
    const prev = measurements[i - 1];
    const curr = measurements[i];

    if (curr.state === 'charging' && prev.state === 'discharging') {
      const chargeEfficiency = (curr.energyIn - prev.energyIn) / (curr.soc - prev.soc);
      totalChargeEfficiency += chargeEfficiency;
      cycleCount++;
    }
  }

  return {
    chargeEfficiency: cycleCount > 0 ? Math.round(totalChargeEfficiency / cycleCount * 100) / 100 : 0,
    dischargeEfficiency: cycleCount > 0 ? Math.round(totalDischargeEfficiency / cycleCount * 100) / 100 : 0,
    averageCycleEfficiency: cycleCount > 0 ? Math.round((totalChargeEfficiency + totalDischargeEfficiency) / cycleCount * 100) / 100 : 0
  };
}