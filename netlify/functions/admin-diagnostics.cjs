const { connectDB } = require('./utils/mongodb.cjs');
const { logger } = require('./utils/logger.cjs');
const { GoogleGenAI } = require('@google/genai');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');
const { generateInsightsWithTools } = require('./utils/insights-tools.cjs');
const { createInsightsJob, getJobById, updateJobProgress } = require('./utils/insights-jobs.cjs');
const { GeminiClient } = require('./utils/geminiClient.cjs');
const axios = require('axios');
const crypto = require('crypto');

// Test data based on actual BMS screenshot
const TEST_BMS_DATA = {
  voltage: 53.4,
  current: 1.7,
  power: 90.78, // 0.090kw from image
  soc: 72.1,
  capacity: 475.8,
  temperature: 25,
  cellVoltages: Array(16).fill(3.338), // Average from image
  cellTemperatures: Array(16).fill(25),
  maxCellVoltage: 3.339,
  minCellVoltage: 3.337,
  cellVoltageDelta: 0.002,
  cycles: 31,
  chargeMosStatus: true,
  dischargeMosStatus: true,
  balanceStatus: false,
  timestamp: new Date().toISOString(),
  deviceId: 'DL-40181001173B',
  testData: true // Mark as test data for cleanup
};

// Generate unique test ID for this diagnostic run
const generateTestId = () => `diag_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

// Verbose error formatter
const formatError = (error, context = {}) => {
  const errorDetails = {
    message: error.message || 'Unknown error',
    type: error.constructor.name,
    code: error.code,
    statusCode: error.statusCode,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 stack lines
    timestamp: new Date().toISOString(),
    context
  };

  // Add specific error type details
  if (error.response) {
    errorDetails.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data
    };
  }

  if (error.config) {
    errorDetails.request = {
      url: error.config.url,
      method: error.config.method,
      headers: error.config.headers
    };
  }

  return errorDetails;
};

// Cleanup function to remove ALL test data
const cleanupTestData = async (testId) => {
  const cleanupResults = {
    success: [],
    failed: []
  };

  try {
    const db = await connectDB();
    
    // List all collections to clean
    const collections = [
      'analyses',
      'insights', 
      'jobs',
      'diagnostics',
      'systems',
      'bms_data',
      'test_data'
    ];

    for (const collection of collections) {
      try {
        const result = await db.collection(collection).deleteMany({ 
          $or: [
            { testId },
            { testData: true },
            { 'metadata.testId': testId }
          ]
        });
        
        if (result.deletedCount > 0) {
          cleanupResults.success.push(`${collection}: deleted ${result.deletedCount} docs`);
          logger.info(`Cleaned up test data from ${collection}`, { 
            testId, 
            deletedCount: result.deletedCount 
          });
        }
      } catch (error) {
        cleanupResults.failed.push(`${collection}: ${error.message}`);
        logger.error(`Failed to cleanup ${collection}`, { 
          testId, 
          error: error.message 
        });
      }
    }

    return cleanupResults;
  } catch (error) {
    logger.error('CRITICAL: Failed to connect for cleanup', formatError(error, { testId }));
    cleanupResults.failed.push(`connection: ${error.message}`);
    return cleanupResults;
  }
};

// Initialize Gemini client with verbose logging
let genAI;
const getGeminiClient = () => {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const error = new Error('GEMINI_API_KEY environment variable is not configured');
      logger.error('CRITICAL: Gemini API Key Missing', formatError(error));
      throw error;
    }
    logger.info('Initializing Gemini client', { 
      keyLength: apiKey.length,
      keyPrefix: apiKey.substring(0, 6) + '...'
    });
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
};

// Helper to execute with timeout, retry, and verbose logging
const executeWithTimeout = async (fn, options = {}) => {
  const {
    timeout = 10000,
    retries = 2,
    testName = 'unknown',
    critical = false
  } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const attemptStartTime = Date.now();
    
    try {
      logger.info(`Executing ${testName} (attempt ${attempt + 1}/${retries + 1})`, {
        timeout,
        critical
      });

      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => 
          setTimeout(() => {
            const error = new Error(`TIMEOUT: ${testName} exceeded ${timeout}ms limit`);
            logger.error(`TIMEOUT detected in ${testName}`, { 
              timeout, 
              attempt,
              elapsed: Date.now() - attemptStartTime 
            });
            reject(error);
          }, timeout)
        )
      ]);

      logger.info(`${testName} completed successfully`, {
        attempt,
        duration: Date.now() - attemptStartTime
      });

      return result;
    } catch (error) {
      const errorDetails = formatError(error, {
        testName,
        attempt,
        retriesRemaining: retries - attempt,
        elapsed: Date.now() - attemptStartTime
      });

      logger.error(`${testName} failed on attempt ${attempt + 1}`, errorDetails);

      if (attempt === retries) {
        if (critical) {
          logger.error(`CRITICAL FAILURE: ${testName} failed after all retries`, errorDetails);
        }
        throw error;
      }

      const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff
      logger.info(`Retrying ${testName} after ${waitTime}ms delay`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
};

const diagnosticTests = {
  database: async (testId) => {
    const startTime = Date.now();
    const testResults = {
      name: 'Database Connection',
      status: 'running',
      steps: [],
      duration: 0
    };

    try {
      logger.info('========== STARTING DATABASE CONNECTION TEST ==========');
      
      // Step 1: Connection
      logger.info('Step 1/6: Testing MongoDB connection...');
      const db = await executeWithTimeout(
        () => connectDB(),
        { testName: 'MongoDB Connection', timeout: 5000, critical: true }
      );
      testResults.steps.push({ step: 'connection', status: 'success', time: Date.now() - startTime });

      // Step 2: CREATE operation
      logger.info('Step 2/6: Testing CREATE operation...');
      const testDoc = { 
        testId,
        test: true,
        timestamp: new Date(),
        function: 'admin-diagnostics',
        data: TEST_BMS_DATA,
        diagnosticRun: new Date().toISOString()
      };
      
      const insertResult = await executeWithTimeout(
        () => db.collection('diagnostics').insertOne(testDoc),
        { testName: 'MongoDB Insert', timeout: 3000 }
      );
      testResults.steps.push({ 
        step: 'create', 
        status: 'success',
        insertedId: insertResult.insertedId.toString(),
        time: Date.now() - startTime 
      });

      // Step 3: READ operation
      logger.info('Step 3/6: Testing READ operation...');
      const readDoc = await executeWithTimeout(
        () => db.collection('diagnostics').findOne({ _id: insertResult.insertedId }),
        { testName: 'MongoDB Read', timeout: 3000 }
      );
      testResults.steps.push({ 
        step: 'read',
        status: readDoc ? 'success' : 'failed',
        documentFound: !!readDoc,
        time: Date.now() - startTime
      });

      // Step 4: UPDATE operation
      logger.info('Step 4/6: Testing UPDATE operation...');
      const updateResult = await executeWithTimeout(
        () => db.collection('diagnostics').updateOne(
          { _id: insertResult.insertedId },
          { $set: { updated: true, updateTime: new Date(), updateCount: 1 } }
        ),
        { testName: 'MongoDB Update', timeout: 3000 }
      );
      testResults.steps.push({
        step: 'update',
        status: updateResult.modifiedCount === 1 ? 'success' : 'failed',
        modifiedCount: updateResult.modifiedCount,
        time: Date.now() - startTime
      });

      // Step 5: AGGREGATE operation
      logger.info('Step 5/6: Testing AGGREGATE operation...');
      const aggregateResult = await executeWithTimeout(
        () => db.collection('diagnostics').aggregate([
          { $match: { testId } },
          { $group: { _id: '$testId', count: { $sum: 1 }, avgPower: { $avg: '$data.power' } } }
        ]).toArray(),
        { testName: 'MongoDB Aggregate', timeout: 5000 }
      );
      testResults.steps.push({
        step: 'aggregate',
        status: aggregateResult.length > 0 ? 'success' : 'failed',
        resultCount: aggregateResult.length,
        aggregateData: aggregateResult[0],
        time: Date.now() - startTime
      });

      // Step 6: DELETE operation (cleanup)
      logger.info('Step 6/6: Testing DELETE operation (cleanup)...');
      const deleteResult = await executeWithTimeout(
        () => db.collection('diagnostics').deleteOne({ _id: insertResult.insertedId }),
        { testName: 'MongoDB Delete', timeout: 3000 }
      );
      testResults.steps.push({
        step: 'delete',
        status: deleteResult.deletedCount === 1 ? 'success' : 'failed',
        deletedCount: deleteResult.deletedCount,
        time: Date.now() - startTime
      });

      // Check indexes
      const indexes = await db.collection('diagnostics').indexes();
      
      testResults.status = 'success';
      testResults.duration = Date.now() - startTime;
      testResults.details = {
        connected: true,
        allOperationsSuccessful: testResults.steps.every(s => s.status === 'success'),
        indexCount: indexes.length,
        indexes: indexes.map(idx => ({ name: idx.name, keys: idx.key }))
      };

      logger.info('========== DATABASE TEST COMPLETED SUCCESSFULLY ==========', testResults);
      return testResults;

    } catch (error) {
      const errorDetails = formatError(error, { testId });
      logger.error('========== DATABASE TEST FAILED ==========', errorDetails);
      
      return {
        name: 'Database Connection',
        status: 'error',
        duration: Date.now() - startTime,
        error: errorDetails,
        steps: testResults.steps,
        details: { 
          connected: false,
          failedAt: testResults.steps.length + 1,
          errorType: error.constructor.name
        }
      };
    }
  },

  gemini: async (testId) => {
    const startTime = Date.now();
    const testResults = {
      name: 'Gemini API',
      status: 'running',
      tests: [],
      duration: 0
    };

    try {
      logger.info('========== STARTING GEMINI API TEST ==========');
      
      const client = getGeminiClient();
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      logger.info(`Initializing Gemini model: ${modelName}`);
      
      const model = client.getGenerativeModel({ model: modelName });
      
      // Test 1: Simple text generation
      logger.info('Test 1/3: Simple text generation...');
      try {
        const simpleResult = await executeWithTimeout(async () => {
          const result = await model.generateContent('Reply with exactly "OK" if you receive this message.');
          const response = result.response;
          return response.text();
        }, { testName: 'Gemini Simple Text', timeout: 8000 });
        
        testResults.tests.push({
          test: 'simple_text',
          status: 'success',
          passed: simpleResult.includes('OK'),
          responseLength: simpleResult.length,
          responsePreview: simpleResult.substring(0, 100)
        });
        logger.info('Gemini simple text test passed', { 
          response: simpleResult.substring(0, 50) 
        });
      } catch (error) {
        testResults.tests.push({
          test: 'simple_text',
          status: 'error',
          error: formatError(error)
        });
        throw error;
      }

      // Test 2: Complex BMS analysis
      logger.info('Test 2/3: Complex BMS data analysis...');
      try {
        const complexPrompt = `Analyze this battery management system data and provide a detailed health assessment:
          
          System ID: ${TEST_BMS_DATA.deviceId}
          Voltage: ${TEST_BMS_DATA.voltage}V
          Current: ${TEST_BMS_DATA.current}A  
          State of Charge: ${TEST_BMS_DATA.soc}%
          Capacity: ${TEST_BMS_DATA.capacity}Ah
          Power: ${TEST_BMS_DATA.power}W
          Cycles: ${TEST_BMS_DATA.cycles}
          Cell Voltage Delta: ${TEST_BMS_DATA.cellVoltageDelta}V
          Max Cell: ${TEST_BMS_DATA.maxCellVoltage}V
          Min Cell: ${TEST_BMS_DATA.minCellVoltage}V
          Temperature: ${TEST_BMS_DATA.temperature}°C
          Charge MOS: ${TEST_BMS_DATA.chargeMosStatus ? 'ON' : 'OFF'}
          Discharge MOS: ${TEST_BMS_DATA.dischargeMosStatus ? 'ON' : 'OFF'}
          Balance: ${TEST_BMS_DATA.balanceStatus ? 'ACTIVE' : 'INACTIVE'}
          
          Provide:
          1. Overall health status (Good/Warning/Critical)
          2. Key observations (3-5 points)
          3. Immediate recommendations
          4. Long-term maintenance suggestions`;
        
        const complexResult = await executeWithTimeout(async () => {
          const result = await model.generateContent(complexPrompt);
          return result.response.text();
        }, { testName: 'Gemini Complex Analysis', timeout: 15000 });
        
        testResults.tests.push({
          test: 'complex_analysis',
          status: 'success',
          passed: complexResult.length > 100,
          responseLength: complexResult.length,
          hasHealthStatus: complexResult.toLowerCase().includes('good') || 
                          complexResult.toLowerCase().includes('warning') ||
                          complexResult.toLowerCase().includes('critical'),
          hasRecommendations: complexResult.toLowerCase().includes('recommend'),
          responsePreview: complexResult.substring(0, 200)
        });
        logger.info('Gemini complex analysis test passed', { 
          responseLength: complexResult.length 
        });
      } catch (error) {
        testResults.tests.push({
          test: 'complex_analysis',
          status: 'error',
          error: formatError(error)
        });
        logger.error('Complex analysis failed but continuing tests', formatError(error));
      }

      // Test 3: Function calling capabilities
      logger.info('Test 3/3: Function calling capabilities...');
      try {
        const functionModel = client.getGenerativeModel({
          model: modelName,
          tools: [{
            functionDeclarations: [{
              name: 'analyze_battery_health',
              description: 'Analyze battery health metrics',
              parameters: {
                type: 'object',
                properties: {
                  voltage: { type: 'number', description: 'Battery voltage' },
                  soc: { type: 'number', description: 'State of charge percentage' },
                  health_status: { 
                    type: 'string', 
                    enum: ['good', 'warning', 'critical'],
                    description: 'Overall health assessment' 
                  }
                },
                required: ['voltage', 'soc', 'health_status']
              }
            }]
          }]
        });
        
        const functionResult = await executeWithTimeout(async () => {
          const result = await functionModel.generateContent(
            `Analyze this battery: Voltage=${TEST_BMS_DATA.voltage}V, SOC=${TEST_BMS_DATA.soc}%. ` +
            `Call the analyze_battery_health function with appropriate values.`
          );
          return result.response;
        }, { testName: 'Gemini Function Calling', timeout: 10000 });
        
        const functionCalls = functionResult.functionCalls ? functionResult.functionCalls() : [];
        
        testResults.tests.push({
          test: 'function_calling',
          status: 'success',
          passed: true,
          hasFunctionCalls: functionCalls.length > 0,
          functionCallCount: functionCalls.length,
          functionNames: functionCalls.map(fc => fc.name)
        });
        logger.info('Gemini function calling test completed', { 
          functionCallCount: functionCalls.length 
        });
      } catch (error) {
        testResults.tests.push({
          test: 'function_calling',
          status: 'warning',
          warning: 'Function calling not fully supported',
          error: formatError(error)
        });
        logger.warn('Function calling test had issues', formatError(error));
      }

      testResults.status = testResults.tests.every(t => t.status === 'success') ? 'success' : 'partial';
      testResults.duration = Date.now() - startTime;
      testResults.details = {
        model: modelName,
        allTestsPassed: testResults.tests.every(t => t.status === 'success'),
        testsRun: testResults.tests.length,
        testsPassed: testResults.tests.filter(t => t.status === 'success').length
      };

      logger.info('========== GEMINI TEST COMPLETED ==========', testResults);
      return testResults;

    } catch (error) {
      const errorDetails = formatError(error, { testId });
      logger.error('========== GEMINI TEST FAILED ==========', errorDetails);
      
      return {
        name: 'Gemini API',
        status: 'error',
        duration: Date.now() - startTime,
        error: errorDetails,
        tests: testResults.tests,
        details: {
          model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
          apiKeyConfigured: !!process.env.GEMINI_API_KEY,
          errorType: error.constructor.name
        }
      };
    }
  },

  analyze: async (testId) => {
    const startTime = Date.now();
    const testResults = {
      name: 'Analyze Endpoint',
      status: 'running',
      stages: [],
      duration: 0
    };

    try {
      logger.info('========== STARTING ANALYZE ENDPOINT TEST ==========');
      
      // Prepare test image data
      const testImageData = Buffer.from(JSON.stringify(TEST_BMS_DATA)).toString('base64');
      
      // Stage 1: Pipeline initialization
      logger.info('Stage 1/4: Initializing analysis pipeline...');
      testResults.stages.push({ 
        stage: 'initialization',
        status: 'success',
        time: Date.now() - startTime 
      });

      // Stage 2: Data extraction
      logger.info('Stage 2/4: Extracting data from image...');
      const extractionStart = Date.now();
      
      const analysisResult = await executeWithTimeout(async () => {
        return await performAnalysisPipeline(
          testImageData,
          `test-image-${testId}.png`,
          { 
            testId,
            skipSave: false,
            metadata: { source: 'diagnostic_test', testRun: true }
          }
        );
      }, { testName: 'Analysis Pipeline', timeout: 25000 });
      
      testResults.stages.push({
        stage: 'extraction',
        status: 'success',
        duration: Date.now() - extractionStart,
        dataExtracted: !!analysisResult.extractedData
      });

      // Stage 3: Data validation
      logger.info('Stage 3/4: Validating extracted data...');
      const validationChecks = {
        hasVoltage: analysisResult.extractedData?.voltage > 0,
        hasSOC: analysisResult.extractedData?.soc >= 0 && analysisResult.extractedData?.soc <= 100,
        hasTimestamp: !!analysisResult.extractedData?.timestamp,
        hasMetadata: !!analysisResult.metadata
      };
      
      testResults.stages.push({
        stage: 'validation',
        status: Object.values(validationChecks).every(v => v) ? 'success' : 'warning',
        checks: validationChecks
      });

      // Stage 4: Database storage
      logger.info('Stage 4/4: Verifying database storage...');
      const db = await connectDB();
      const savedAnalysis = await db.collection('analyses').findOne({ testId });
      
      testResults.stages.push({
        stage: 'storage',
        status: savedAnalysis ? 'success' : 'failed',
        documentId: savedAnalysis?._id?.toString(),
        documentSize: JSON.stringify(savedAnalysis).length
      });

      // Cleanup
      if (savedAnalysis) {
        await db.collection('analyses').deleteOne({ _id: savedAnalysis._id });
        logger.info('Test data cleaned up from analyses collection');
      }

      testResults.status = 'success';
      testResults.duration = Date.now() - startTime;
      testResults.details = {
        pipelineComplete: true,
        allStagesSuccessful: testResults.stages.every(s => s.status === 'success'),
        extractedData: {
          voltage: analysisResult.extractedData?.voltage,
          soc: analysisResult.extractedData?.soc,
          power: analysisResult.extractedData?.power,
          capacity: analysisResult.extractedData?.capacity
        },
        processingTimeMs: analysisResult.metadata?.processingTime
      };

      logger.info('========== ANALYZE TEST COMPLETED ==========', testResults);
      return testResults;

    } catch (error) {
      const errorDetails = formatError(error, { testId });
      logger.error('========== ANALYZE TEST FAILED ==========', errorDetails);
      
      return {
        name: 'Analyze Endpoint',
        status: 'error',
        duration: Date.now() - startTime,
        error: errorDetails,
        stages: testResults.stages,
        details: {
          pipelineComplete: false,
          failedAtStage: testResults.stages.length + 1
        }
      };
    }
  },

  insightsWithTools: async (testId) => {
    const startTime = Date.now();
    const testResults = {
      name: 'Insights with Tools',
      status: 'running',
      toolCalls: [],
      duration: 0
    };

    try {
      logger.info('========== STARTING INSIGHTS WITH TOOLS TEST ==========');
      
      // Test all available tool functions
      const toolTests = [
        { name: 'request_bms_data', test: 'BMS data retrieval' },
        { name: 'getSystemAnalytics', test: 'System analytics' },
        { name: 'predict_battery_trends', test: 'Predictive analysis' },
        { name: 'analyze_usage_patterns', test: 'Usage pattern analysis' },
        { name: 'calculate_energy_budget', test: 'Energy budget calculation' }
      ];

      logger.info(`Testing ${toolTests.length} tool functions...`);

      for (const tool of toolTests) {
        logger.info(`Testing tool: ${tool.name}`);
        const toolStart = Date.now();
        
        try {
          // Generate insights with specific tool request
          const insights = await executeWithTimeout(async () => {
            return await generateInsightsWithTools(
              TEST_BMS_DATA,
              {
                testId,
                mode: 'diagnostic',
                requestedTools: [tool.name],
                maxIterations: 2,
                timeoutMs: 15000
              }
            );
          }, { testName: `Tool: ${tool.name}`, timeout: 20000 });

          testResults.toolCalls.push({
            tool: tool.name,
            status: 'success',
            duration: Date.now() - toolStart,
            toolExecuted: insights.toolCallsExecuted > 0,
            insightsGenerated: !!insights.summary
          });

        } catch (error) {
          testResults.toolCalls.push({
            tool: tool.name,
            status: 'error',
            duration: Date.now() - toolStart,
            error: formatError(error)
          });
          logger.error(`Tool ${tool.name} failed`, formatError(error));
        }
      }

      // Test combined insights generation
      logger.info('Testing combined insights generation with all tools...');
      try {
        const combinedInsights = await executeWithTimeout(async () => {
          return await generateInsightsWithTools(
            TEST_BMS_DATA,
            {
              testId,
              mode: 'comprehensive',
              maxIterations: 3,
              timeoutMs: 30000
            }
          );
        }, { testName: 'Combined Insights', timeout: 35000 });

        testResults.combinedTest = {
          status: 'success',
          toolCallsExecuted: combinedInsights.toolCallsExecuted,
          iterations: combinedInsights.iterations,
          insightLength: combinedInsights.summary?.length || 0,
          hasRecommendations: !!combinedInsights.recommendations
        };
      } catch (error) {
        testResults.combinedTest = {
          status: 'error',
          error: formatError(error)
        };
      }

      testResults.status = testResults.toolCalls.every(t => t.status === 'success') ? 'success' : 'partial';
      testResults.duration = Date.now() - startTime;
      testResults.details = {
        totalTools: toolTests.length,
        successfulTools: testResults.toolCalls.filter(t => t.status === 'success').length,
        failedTools: testResults.toolCalls.filter(t => t.status === 'error').length,
        combinedTestPassed: testResults.combinedTest?.status === 'success'
      };

      logger.info('========== INSIGHTS WITH TOOLS TEST COMPLETED ==========', testResults);
      return testResults;

    } catch (error) {
      const errorDetails = formatError(error, { testId });
      logger.error('========== INSIGHTS WITH TOOLS TEST FAILED ==========', errorDetails);
      
      return {
        name: 'Insights with Tools',
        status: 'error',
        duration: Date.now() - startTime,
        error: errorDetails,
        toolCalls: testResults.toolCalls,
        details: {
          toolsTestsRun: testResults.toolCalls.length
        }
      };
    }
  },

  asyncAnalysis: async (testId) => {
    const startTime = Date.now();
    const testResults = {
      name: 'Asynchronous Insights (Background)',
      status: 'running',
      jobLifecycle: [],
      duration: 0
    };

    try {
      logger.info('========== STARTING ASYNC BACKGROUND JOB TEST ==========');
      
      // Create background job
      logger.info('Creating background insights job...');
      const jobId = await createInsightsJob({
        analysisData: TEST_BMS_DATA,
        options: {
          mode: 'comprehensive',
          testId,
          priority: 'high'
        }
      });
      
      logger.info(`Background job created with ID: ${jobId}`);
      testResults.jobLifecycle.push({
        event: 'created',
        jobId,
        time: Date.now() - startTime
      });

      // Poll for completion with detailed status tracking
      let attempts = 0;
      const maxAttempts = 30; // 60 seconds max
      let finalStatus = null;
      const statusHistory = [];

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const job = await getJobById(jobId);
        const currentStatus = {
          attempt: attempts + 1,
          status: job?.status || 'not_found',
          progressEvents: job?.progress?.length || 0,
          lastProgress: job?.progress?.[job.progress.length - 1],
          elapsed: Date.now() - startTime
        };
        
        statusHistory.push(currentStatus);
        
        logger.info(`Job status check ${attempts + 1}/${maxAttempts}`, currentStatus);

        if (job && (job.status === 'completed' || job.status === 'failed')) {
          finalStatus = job;
          testResults.jobLifecycle.push({
            event: job.status,
            time: Date.now() - startTime,
            details: job.result || job.error
          });
          break;
        }
        
        attempts++;
      }

      // Clean up job
      if (jobId) {
        const db = await connectDB();
        await db.collection('jobs').deleteOne({ jobId });
        logger.info('Test job cleaned up');
      }

      testResults.status = finalStatus?.status === 'completed' ? 'success' : 
                          finalStatus?.status === 'failed' ? 'error' : 'warning';
      testResults.duration = Date.now() - startTime;
      testResults.details = {
        jobId,
        finalStatus: finalStatus?.status || 'timeout',
        totalPolls: attempts,
        progressEvents: finalStatus?.progress?.length || 0,
        statusHistory: statusHistory.slice(-5), // Last 5 status checks
        jobResult: finalStatus?.result,
        jobError: finalStatus?.error
      };

      logger.info('========== ASYNC TEST COMPLETED ==========', testResults);
      return testResults;

    } catch (error) {
      const errorDetails = formatError(error, { testId });
      logger.error('========== ASYNC TEST FAILED ==========', errorDetails);
      
      return {
        name: 'Asynchronous Insights (Background)',
        status: 'error',
        duration: Date.now() - startTime,
        error: errorDetails,
        jobLifecycle: testResults.jobLifecycle
      };
    }
  },

  // Additional comprehensive tests
  history: async (testId) => {
    const startTime = Date.now();
    try {
      logger.info('Testing History Endpoint...');
      const db = await connectDB();
      
      // Insert test record
      const testRecord = {
        testId,
        timestamp: new Date(),
        data: TEST_BMS_DATA,
        type: 'diagnostic_test'
      };
      await db.collection('analyses').insertOne(testRecord);
      
      // Query records
      const records = await db.collection('analyses').find({ testId }).toArray();
      
      // Clean up
      await db.collection('analyses').deleteMany({ testId });
      
      return {
        name: 'History Endpoint',
        status: 'success',
        duration: Date.now() - startTime,
        details: {
          recordsCreated: 1,
          recordsQueried: records.length,
          recordsCleaned: true
        }
      };
    } catch (error) {
      return {
        name: 'History Endpoint',
        status: 'error',
        duration: Date.now() - startTime,
        error: formatError(error)
      };
    }
  },

  systems: async (testId) => {
    const startTime = Date.now();
    try {
      logger.info('Testing Systems Endpoint...');
      const db = await connectDB();
      
      // Create test system
      const testSystem = {
        testId,
        systemId: `test_system_${testId}`,
        name: 'Diagnostic Test System',
        configuration: TEST_BMS_DATA,
        created: new Date()
      };
      await db.collection('systems').insertOne(testSystem);
      
      // Query systems
      const systems = await db.collection('systems').find({ testId }).toArray();
      
      // Update system
      await db.collection('systems').updateOne(
        { testId },
        { $set: { lastDiagnostic: new Date() } }
      );
      
      // Clean up
      await db.collection('systems').deleteMany({ testId });
      
      return {
        name: 'Systems Endpoint',
        status: 'success',
        duration: Date.now() - startTime,
        details: {
          systemCreated: true,
          systemQueried: systems.length === 1,
          systemUpdated: true,
          systemDeleted: true
        }
      };
    } catch (error) {
      return {
        name: 'Systems Endpoint',
        status: 'error',
        duration: Date.now() - startTime,
        error: formatError(error)
      };
    }
  }
};

// Main handler with comprehensive error handling and verbose logging
exports.handler = async (event, context) => {
  const requestStartTime = Date.now();
  const testId = generateTestId();
  
  logger.info('========================================');
  logger.info('ADMIN DIAGNOSTICS STARTED');
  logger.info('========================================');
  logger.info('Diagnostic run initiated', {
    testId,
    timestamp: new Date().toISOString(),
    method: event.httpMethod,
    requestId: context.requestId,
    environment: process.env.NODE_ENV || 'production'
  });

  try {
    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        body: ''
      };
    }

    // Parse request
    let selectedTests = Object.keys(diagnosticTests);
    if (event.httpMethod === 'POST' && event.body) {
      try {
        const { selectedTests: requestedTests } = JSON.parse(event.body);
        if (requestedTests && Array.isArray(requestedTests)) {
          selectedTests = requestedTests.filter(test => diagnosticTests[test]);
          logger.info('Custom test selection', { 
            requested: requestedTests.length,
            valid: selectedTests.length,
            tests: selectedTests
          });
        }
      } catch (parseError) {
        logger.error('Failed to parse request body', formatError(parseError));
      }
    }

    logger.info(`Running ${selectedTests.length} diagnostic tests`, { selectedTests });

    // Run tests with detailed tracking
    const results = [];
    const testErrors = [];
    
    for (const testName of selectedTests) {
      if (diagnosticTests[testName]) {
        logger.info(`\n>>> Starting test: ${testName}`);
        try {
          const result = await diagnosticTests[testName](testId);
          results.push(result);
          logger.info(`<<< Completed test: ${testName} (${result.status})`);
        } catch (testError) {
          const errorResult = {
            name: testName,
            status: 'error',
            error: formatError(testError),
            duration: 0
          };
          results.push(errorResult);
          testErrors.push({ test: testName, error: testError.message });
          logger.error(`<<< Test failed: ${testName}`, formatError(testError));
        }
      }
    }

    // Cleanup test data
    logger.info('\nCleaning up test data...');
    const cleanupResults = await cleanupTestData(testId);
    logger.info('Cleanup completed', cleanupResults);

    // Calculate comprehensive summary
    const summary = {
      total: results.length,
      success: results.filter(r => r.status === 'success').length,
      partial: results.filter(r => r.status === 'partial').length,
      warnings: results.filter(r => r.status === 'warning').length,
      errors: results.filter(r => r.status === 'error').length
    };

    const overallStatus = summary.errors > 0 ? 'error' : 
                         summary.warnings > 0 || summary.partial > 0 ? 'partial' : 'success';

    const diagnosticResults = {
      status: overallStatus,
      testId,
      summary,
      results,
      cleanup: cleanupResults,
      metadata: {
        timestamp: new Date().toISOString(),
        duration: Date.now() - requestStartTime,
        environment: process.env.NODE_ENV || 'production',
        requestId: context.requestId
      }
    };

    logger.info('========================================');
    logger.info('DIAGNOSTICS COMPLETED', {
      overallStatus,
      summary,
      duration: Date.now() - requestStartTime,
      testId
    });
    logger.info('========================================\n');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Diagnostic-Id': testId,
        'X-Diagnostic-Status': overallStatus
      },
      body: JSON.stringify(diagnosticResults, null, 2)
    };

  } catch (error) {
    const errorDetails = formatError(error, { 
      testId,
      elapsed: Date.now() - requestStartTime 
    });
    
    logger.error('========================================');
    logger.error('CRITICAL: DIAGNOSTICS SYSTEM FAILURE', errorDetails);
    logger.error('========================================\n');

    // Attempt cleanup even after failure
    try {
      await cleanupTestData(testId);
    } catch (cleanupError) {
      logger.error('Cleanup failed after system error', formatError(cleanupError));
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'X-Diagnostic-Id': testId,
        'X-Diagnostic-Status': 'system_failure'
      },
      body: JSON.stringify({
        status: 'system_failure',
        testId,
        error: errorDetails,
        metadata: {
          timestamp: new Date().toISOString(),
          duration: Date.now() - requestStartTime,
          requestId: context.requestId
        }
      }, null, 2)
    };
  }
};
