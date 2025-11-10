const { getMongoDb } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');
const { analyzeImage } = require('./utils/analysis-pipeline.cjs');
const { getWeather } = require('./utils/weather.cjs');
const { getSolarData } = require('./utils/solar.cjs');
const { runGuruConversation } = require('./utils/insights-guru-runner.cjs');
const { getAIModelWithTools } = require('./utils/insights-processor.cjs');
const crypto = require('crypto');

const logger = createLogger('admin-diagnostics');

// Test image data for diagnostics
const TEST_IMAGE_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Diagnostic test functions
const diagnosticTests = {
  // Test database connection
  database: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Database Connection...');
      const db = await getMongoDb();
      const collections = await db.listCollections().toArray();
      const duration = Date.now() - startTime;
      
      logger.info('Database connection test completed successfully.', { duration });
      return {
        name: 'Database Connection',
        status: 'success',
        duration,
        details: {
          collections: collections.map(c => c.name),
          count: collections.length
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Database connection test failed.', { error: error.message, duration });
      return {
        name: 'Database Connection',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test synchronous analysis
  syncAnalysis: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Synchronous Analysis...');
      const result = await analyzeImage(
        TEST_IMAGE_BASE64,
        'diagnostic-sync-test.png',
        { forceReanalyze: true }
      );
      const duration = Date.now() - startTime;
      
      logger.info('Synchronous analysis test completed successfully.', { 
        recordId: result.id,
        duration
      });
      
      return {
        name: 'Synchronous Analysis',
        status: 'success',
        duration,
        details: {
          recordId: result.id,
          status: result.status,
          alertCount: result.alerts?.length || 0
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Synchronous analysis test failed.', { error: error.message, duration });
      return {
        name: 'Synchronous Analysis',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test asynchronous insights generation (background mode)
  asyncAnalysis: async () => {
    const startTime = Date.now();
    
    try {
      logger.info('Testing Asynchronous Insights Generation (Background Mode)...');
      const db = await getMongoDb();
      
      // Create minimal test data for insights
      const testAnalysis = {
        id: 'async-test-' + Date.now(),
        stateOfCharge: 75,
        overallVoltage: 52.1,
        current: -5.2,
        power: -270.92,
        highestCellVoltage: 3.35,
        lowestCellVoltage: 3.28,
        cellVoltageDifference: 0.07,
        temperatures: [25, 26],
        status: 'Normal',
        timestamp: new Date()
      };
      
      // Create an insights job directly (simulating background mode)
      const jobId = `diagnostic_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const testJob = {
        id: jobId,
        status: 'queued',
        analysisData: testAnalysis,
        systemId: null,
        customPrompt: 'Provide a brief status.',
        initialSummary: { message: 'Test summary' },
        progress: [],
        partialInsights: null,
        finalInsights: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await db.collection('insights-jobs').insertOne(testJob);
      logger.info('Test insights job created for async test.', { jobId });
      
      // Poll for job status changes (simulating background processing)
      const maxWaitTime = 3000; // 3 seconds max wait for test
      const pollInterval = 500;
      let elapsedTime = 0;
      let finalJob = null;
      
      while (elapsedTime < maxWaitTime) {
        const job = await db.collection('insights-jobs').findOne({ id: jobId });
        
        if (job && (job.status === 'completed' || job.status === 'failed')) {
          finalJob = job;
          break;
        }
        
        // For diagnostic tests, we consider job creation + queuing as success
        // since we can't guarantee a background worker is running
        if (elapsedTime >= 1000) {
          finalJob = job;
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsedTime += pollInterval;
      }
      
      const duration = Date.now() - startTime;
      
      // Clean up test job
      await db.collection('insights-jobs').deleteOne({ id: jobId });
      
      // Evaluate results
      if (finalJob) {
        if (finalJob.status === 'completed') {
          logger.info('Asynchronous insights test completed successfully.', { 
            jobId,
            duration 
          });
          
          return {
            name: 'Asynchronous Insights Generation',
            status: 'success',
            duration,
            details: {
              jobId,
              finalStatus: finalJob.status,
              message: 'Background job processing verified'
            }
          };
        } else if (finalJob.status === 'queued' || finalJob.status === 'processing') {
          // Job created successfully but no worker processed it yet
          logger.warn('Asynchronous insights test completed with warning.', { 
            jobId,
            duration,
            status: finalJob.status
          });
          
          return {
            name: 'Asynchronous Insights Generation',
            status: 'warning',
            duration,
            details: {
              jobId,
              finalStatus: finalJob.status,
              message: 'Job created successfully but no background worker detected',
              recommendation: 'Ensure generate-insights-background function is deployed and accessible'
            }
          };
        } else {
          throw new Error(`Job ended with status: ${finalJob.status}`);
        }
      } else {
        throw new Error('Job not found after creation');
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Asynchronous insights test failed.', { 
        error: error.message,
        duration 
      });
      
      return {
        name: 'Asynchronous Insights Generation',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test weather service
  weather: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Weather Service...');
      const weather = await getWeather(37.7749, -122.4194); // San Francisco
      const duration = Date.now() - startTime;
      
      return {
        name: 'Weather Service',
        status: 'success',
        duration,
        details: {
          location: 'San Francisco, CA',
          temperature: weather?.temperature,
          conditions: weather?.conditions
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Weather service test failed.', { error: error.message, duration });
      return {
        name: 'Weather Service',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test solar service
  solar: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Solar Service...');
      const solarData = await getSolarData(37.7749, -122.4194);
      const duration = Date.now() - startTime;
      
      return {
        name: 'Solar Service',
        status: 'success',
        duration,
        details: {
          location: 'San Francisco, CA',
          sunrise: solarData?.sunrise,
          sunset: solarData?.sunset
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Solar service test failed.', { error: error.message, duration });
      return {
        name: 'Solar Service',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test system analytics
  systemAnalytics: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing System Analytics...');
      const db = await getMongoDb();
      
      // Get basic analytics
      const [analysisCount, systemCount, recentAnalyses] = await Promise.all([
        db.collection('bmsAnalyses').countDocuments(),
        db.collection('systems').countDocuments(),
        db.collection('bmsAnalyses')
          .find({})
          .sort({ timestamp: -1 })
          .limit(5)
          .toArray()
      ]);
      
      const duration = Date.now() - startTime;
      
      return {
        name: 'System Analytics',
        status: 'success',
        duration,
        details: {
          totalAnalyses: analysisCount,
          totalSystems: systemCount,
          recentAnalysesCount: recentAnalyses.length
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('System analytics test failed.', { error: error.message, duration });
      return {
        name: 'System Analytics',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test insights generation with tools
  insightsWithTools: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Enhanced Insights with Function Calling...');
      
      // Get AI model
      const model = await getAIModelWithTools(logger);
      if (!model) {
        throw new Error('AI model not available');
      }
      
      // Create minimal test data
      const testAnalysis = {
        id: 'test-' + Date.now(),
        stateOfCharge: 75,
        overallVoltage: 52.1,
        current: -5.2,
        power: -270.92,
        highestCellVoltage: 3.35,
        lowestCellVoltage: 3.28,
        cellVoltageDifference: 0.07,
        temperatures: [25, 26],
        status: 'Normal',
        timestamp: new Date()
      };
      
      // Run insights generation with a short timeout for testing
      const result = await runGuruConversation({
        model,
        analysisData: testAnalysis,
        systemId: null,
        customPrompt: 'Provide a brief status summary.',
        log: logger,
        mode: 'sync',
        maxIterations: 3,
        iterationTimeoutMs: 10000,
        totalTimeoutMs: 15000
      });
      
      const duration = Date.now() - startTime;
      
      return {
        name: 'Enhanced Insights (Function Calling)',
        status: 'success',
        duration,
        details: {
          insightGenerated: !!result?.insights,
          iterations: result?.iterations || 0,
          toolCallsUsed: result?.toolCalls?.length || 0,
          usedFunctionCalling: result?.usedFunctionCalling || false
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Enhanced insights test failed.', { error: error.message, duration });
      return {
        name: 'Enhanced Insights (Function Calling)',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test Gemini API directly
  gemini: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Gemini API...');
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY not configured');
      }
      
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const result = await model.generateContent('Respond with "OK" if you can read this.');
      const response = await result.response;
      const text = response.text();
      
      const duration = Date.now() - startTime;
      
      return {
        name: 'Gemini API',
        status: text.includes('OK') ? 'success' : 'warning',
        duration,
        details: {
          model: 'gemini-1.5-flash',
          responseReceived: true,
          responsePreview: text.substring(0, 50)
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Gemini API test failed.', { error: error.message, duration });
      return {
        name: 'Gemini API',
        status: 'error',
        duration,
        error: error.message
      };
    }
  }
};

// Main handler
exports.handler = async (event, context) => {
  const startTime = Date.now();
  
  try {
    logger.info('Admin diagnostics endpoint called.', {
      method: event.httpMethod,
      body: event.body ? JSON.parse(event.body) : null
    });
    
    // Parse selected tests from request body
    const { selectedTests = Object.keys(diagnosticTests) } = event.body ? JSON.parse(event.body) : {};
    
    logger.info('Running selected diagnostic tests', { selectedTests });
    
    // Run selected tests in parallel where possible
    const results = [];
    let hasErrors = false;
    let hasWarnings = false;
    
    for (const testName of selectedTests) {
      if (diagnosticTests[testName]) {
        try {
          const result = await diagnosticTests[testName]();
          results.push(result);
          
          if (result.status === 'error') hasErrors = true;
          if (result.status === 'warning') hasWarnings = true;
        } catch (error) {
          logger.error(`Test ${testName} threw unexpected error`, { 
            error: error.message 
          });
          results.push({
            name: testName,
            status: 'error',
            error: `Unexpected error: ${error.message}`
          });
          hasErrors = true;
        }
      }
    }
    
    const totalDuration = Date.now() - startTime;
    
    // Determine overall status
    let overallStatus = 'success';
    if (hasErrors) overallStatus = 'partial';
    else if (hasWarnings) overallStatus = 'warning';
    
    const response = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      duration: totalDuration,
      results,
      summary: {
        total: results.length,
        success: results.filter(r => r.status === 'success').length,
        warnings: results.filter(r => r.status === 'warning').length,
        errors: results.filter(r => r.status === 'error').length
      }
    };
    
    logger.info('Diagnostics completed', { 
      overallStatus,
      summary: response.summary,
      duration: totalDuration 
    });
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Admin diagnostics failed', { 
      error: error.message,
      stack: error.stack,
      duration 
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
        duration
      })
    };
  }
};
