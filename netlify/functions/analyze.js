const { MongoClient } = require('mongodb');
const { errorResponse } = require('./utils/errors');
const { parseJsonBody, validateAnalyzeRequest } = require('./utils/validation');

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI);
const database = client.db('battery-analysis');

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, headers);
  }

  // Capture request-scoped context for safe use in catch
  let requestContext = { jobId: undefined };

  try {
    await client.connect();

    // Safe parse & validate
    const parsed = parseJsonBody(event);
    if (!parsed.ok) {
      return errorResponse(400, 'invalid_request', parsed.error, undefined, headers);
    }

    const validated = validateAnalyzeRequest(parsed.value);
    if (!validated.ok) {
      return errorResponse(400, 'missing_parameters', validated.error, validated.details, headers);
    }

    const { jobId, fileData, userId } = validated.value;
    requestContext.jobId = jobId;

    // Send initial response with SSE headers
    const response = {
      statusCode: 200,
      headers,
      body: ''
    };

    // Function to send progress events
    const sendEvent = async (data) => {
      const eventData = `data: ${JSON.stringify(data)}\n\n`;
      console.log('Sending event:', eventData);
      // In a real implementation, this would stream to the client
      // For now, we'll store events in the database
      await storeProgressEvent(jobId, data);
    };

    // Start processing
    await sendEvent({ jobId, stage: 'started', progress: 0, message: 'Initializing analysis...' });

    // Validate and parse file
    await sendEvent({ jobId, stage: 'validating', progress: 10, message: 'Validating file format...' });
    const parsedData = await validateAndParseFile(fileData);
    
    // Extract battery metrics
    await sendEvent({ jobId, stage: 'extracting', progress: 25, message: 'Extracting battery metrics...' });
    const metrics = await extractBatteryMetrics(parsedData);
    
    // Perform analysis
    await sendEvent({ jobId, stage: 'analyzing', progress: 50, message: 'Performing comprehensive analysis...' });
    const analysis = await performAnalysis(metrics);
    
    // Generate insights
    await sendEvent({ jobId, stage: 'insights', progress: 75, message: 'Generating insights...' });
    const insights = await generateInsights(analysis);
    
    // Complete
    await sendEvent({ jobId, stage: 'completed', progress: 100, message: 'Analysis complete!' });

    // Store results
    await storeAnalysisResults(jobId, userId, {
      metrics,
      analysis,
      insights,
      completedAt: new Date()
    });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        jobId,
        message: 'Analysis initiated successfully'
      })
    };

  } catch (error) {
    console.error('Analysis error:', error);
    
    // Send error event
    if (requestContext.jobId) {
      await storeProgressEvent(requestContext.jobId, {
        stage: 'error',
        progress: 0,
        message: `Analysis failed: ${error.message}`
      });
    }

    return errorResponse(500, 'analysis_failed', 'Analysis failed', { message: error.message }, headers);
  } finally {
    await client.close();
  }
};

async function validateAndParseFile(fileData) {
  // Simulate file validation and parsing
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (!fileData || fileData.length === 0) {
    throw new Error('Empty file data');
  }
  
  // Mock parsing logic
  return {
    format: 'csv',
    rows: fileData.split('\n').length,
    columns: fileData.split('\n')[0]?.split(',').length || 0,
    data: fileData
  };
}

async function extractBatteryMetrics(parsedData) {
  // Simulate metrics extraction
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    totalCycles: Math.floor(Math.random() * 1000) + 100,
    avgCapacity: Math.floor(Math.random() * 50) + 50,
    maxTemperature: Math.floor(Math.random() * 20) + 25,
    efficiency: Math.random() * 0.3 + 0.7,
    healthScore: Math.floor(Math.random() * 30) + 70
  };
}

async function performAnalysis(metrics) {
  // Simulate comprehensive analysis
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    degradationTrend: metrics.efficiency > 0.85 ? 'stable' : 'declining',
    riskFactors: metrics.avgCapacity < 60 ? ['low capacity'] : [],
    performanceIssues: metrics.maxTemperature > 40 ? ['high temperature'] : [],
    maintenanceNeeds: metrics.healthScore < 80 ? ['service recommended'] : []
  };
}

async function generateInsights(analysis) {
  // Simulate insights generation
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return {
    summary: `Battery health is ${analysis.degradationTrend} with ${analysis.riskFactors.length} risk factors identified.`,
    recommendations: [
      analysis.degradationTrend === 'declining' ? 'Monitor capacity closely' : 'Continue normal operation',
      analysis.riskFactors.includes('low capacity') ? 'Consider capacity calibration' : '',
      analysis.performanceIssues.includes('high temperature') ? 'Improve cooling system' : ''
    ].filter(Boolean),
    nextMaintenance: analysis.maintenanceNeeds.length > 0 ? 'Schedule service within 30 days' : 'No immediate maintenance required'
  };
}

async function storeProgressEvent(jobId, eventData) {
  try {
    const collection = database.collection('progress-events');
    await collection.insertOne({
      jobId,
      ...eventData,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error storing progress event:', error);
  }
}

async function storeAnalysisResults(jobId, userId, results) {
  try {
    const collection = database.collection('analysis-results');
    await collection.insertOne({
      jobId,
      userId,
      ...results,
      createdAt: new Date()
    });
  } catch (error) {
    console.error('Error storing analysis results:', error);
  }
}