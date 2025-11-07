const { createLogger } = require('../../utils/logger.cjs');

exports.handler = async (event, context) => {
  const log = createLogger('debug-insights', context);

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const debug = {
      requestMethod: event.httpMethod,
      headers: event.headers,
      bodyKeys: Object.keys(body),
      bodyStructure: analyzeStructure(body),
      timestamp: new Date().toISOString()
    };

    log.info('Debug request received', debug);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        debug,
        recommendations: generateRecommendations(body)
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function analyzeStructure(obj, depth = 0) {
  if (depth > 3) return '[too deep]';

  if (Array.isArray(obj)) {
    return `Array(${obj.length})`;
  }

  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = analyzeStructure(value, depth + 1);
    }
    return result;
  }

  return typeof obj;
}

function generateRecommendations(body) {
  const recommendations = [];

  if (!body.analysisData && !body.batteryData && !body.measurements) {
    recommendations.push('Include analysisData, batteryData, or measurements in request');
  }

  if (body.analysisData && !body.analysisData.measurements) {
    recommendations.push('analysisData should contain measurements array');
  }

  return recommendations;
}

