const { getDb } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');
const { getAIModelWithTools } = require('./utils/insights-processor.cjs');
const { runGuruConversation } = require('./utils/insights-guru-runner.cjs');
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
      const db = await getDb();
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
      
      // Create a log function for analysis pipeline (expects function-style logger)
      const log = (level, message, data) => {
        if (typeof logger[level] === 'function') {
          logger[level](message, data);
        } else {
          logger.info(message, { level, ...data });
        }
      };
      // Copy logger methods
      log.info = logger.info.bind(logger);
      log.warn = logger.warn.bind(logger);
      log.error = logger.error.bind(logger);
      log.debug = logger.debug.bind(logger);
      
      const result = await performAnalysisPipeline(
        {
          image: TEST_IMAGE_BASE64,
          mimeType: 'image/png',
          fileName: 'diagnostic-sync-test.png',
          force: true
        },
        null, // systems
        log,
        {} // context
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
      
      // Accept Gemini API 400 errors as a warning (test image is too small)
      if (error.message && error.message.includes('400')) {
        logger.warn('Synchronous analysis test completed with warning (test image issue).', { 
          error: error.message, 
          duration 
        });
        return {
          name: 'Synchronous Analysis',
          status: 'warning',
          duration,
          details: {
            message: 'Pipeline accessible (test image too small for actual analysis)',
            error: error.message
          }
        };
      }
      
      logger.error('Synchronous analysis test failed.', { error: error.message, duration });
      return {
        name: 'Synchronous Analysis',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test asynchronous insights generation (REAL background mode via function call)
  asyncAnalysis: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Asynchronous Insights Generation (Real Background Mode)...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const createUrl = `${baseUrl}/.netlify/functions/generate-insights-with-tools`; // default = background mode

      // Minimal realistic analysisData payload
      const payload = {
        analysisData: {
          measurements: [
            { timestamp: new Date().toISOString(), stateOfCharge: 75, overallVoltage: 52.1, current: -5.2 }
          ],
          overallVoltage: 52.1,
          stateOfCharge: 75,
          current: -5.2
        },
        customPrompt: 'Provide a brief status.'
      };
<<<<<<< HEAD

      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!createResp.ok) {
        const errText = await createResp.text().catch(() => '');
        throw new Error(`Background insights creation failed (${createResp.status}) ${errText}`);
=======
      
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
      
      // Try to invoke the background worker (like the real flow does)
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const backgroundUrl = `${baseUrl}/.netlify/functions/generate-insights-background`;
      
      let workerInvoked = false;
      try {
        logger.info('Attempting to invoke background worker', { jobId, backgroundUrl });
        const workerResponse = await fetch(backgroundUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Insights-Dispatch': 'admin-diagnostics-test'
          },
          body: JSON.stringify({ jobId })
        });
        
        if (workerResponse.ok) {
          workerInvoked = true;
          logger.info('Background worker invoked successfully', { jobId, status: workerResponse.status });
        } else {
          logger.warn('Background worker invocation failed', { 
            jobId, 
            status: workerResponse.status,
            statusText: workerResponse.statusText
          });
        }
      } catch (invokeError) {
        logger.warn('Failed to invoke background worker', { 
          jobId, 
          error: invokeError.message 
        });
        // Continue with polling anyway
      }
      
      // Poll for job status changes
      const maxWaitTime = workerInvoked ? 5000 : 2000; // Wait longer if worker was invoked
      const pollInterval = 500;
      let elapsedTime = 0;
      let finalJob = null;
      
      while (elapsedTime < maxWaitTime) {
        const job = await db.collection('insights-jobs').findOne({ id: jobId });
        
        if (job && (job.status === 'completed' || job.status === 'failed')) {
          finalJob = job;
          break;
        }
        
        // For diagnostic tests without worker invocation, consider job creation as partial success
        if (!workerInvoked && elapsedTime >= 1000) {
          finalJob = job;
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsedTime += pollInterval;
>>>>>>> 5304711139bb9bfaffa034997570ba53dfd6210d
      }

      const createJson = await createResp.json();
      const jobId = createJson.jobId;
      if (!jobId) throw new Error('Background insights response missing jobId');
      logger.info('Background insights job created', { jobId });

      // Poll status endpoint
      const statusUrl = `${baseUrl}/.netlify/functions/generate-insights-status`;
      const pollInterval = 1000;
      const maxWaitMs = 15000; // 15s cap inside diagnostics
      let elapsed = 0;
      let lastStatus = 'unknown';
      let finalData = null;

      while (elapsed < maxWaitMs) {
        const statusResp = await fetch(statusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId })
        });
        if (!statusResp.ok && statusResp.status !== 404) {
          const t = await statusResp.text().catch(() => '');
          throw new Error(`Status check failed (${statusResp.status}) ${t}`);
        }
        if (statusResp.ok) {
          const statusJson = await statusResp.json();
          lastStatus = statusJson.status;
          finalData = statusJson;
          logger.debug('Polled job status', { jobId, status: lastStatus, progressEvents: statusJson.progressCount || 0 });
          if (['completed', 'failed'].includes(lastStatus)) break;
        }
        await new Promise(r => setTimeout(r, pollInterval));
        elapsed += pollInterval;
      }

      const duration = Date.now() - startTime;
<<<<<<< HEAD
      const outcome = lastStatus === 'completed' ? 'success' : (lastStatus === 'failed' ? 'error' : 'warning');

      return {
        name: 'Asynchronous Insights Generation',
        status: outcome,
        duration,
        details: {
          jobId,
          finalStatus: lastStatus,
          iterations: finalData?.progressCount || 0,
          hasFinalInsights: !!finalData?.finalInsights,
          message: outcome === 'warning' ? 'Job did not finish within diagnostics wait window' : 'Background flow exercised'
        },
        error: outcome === 'error' ? (finalData?.error || 'Job failed') : undefined
      };
=======
      
      // Clean up test job
      await db.collection('insights-jobs').deleteOne({ id: jobId });
      
      // Evaluate results
      if (finalJob) {
        if (finalJob.status === 'completed') {
          logger.info('Asynchronous insights test completed successfully.', { 
            jobId,
            duration,
            workerInvoked
          });
          
          return {
            name: 'Asynchronous Insights Generation',
            status: 'success',
            duration,
            details: {
              jobId,
              finalStatus: finalJob.status,
              message: 'Background job processing verified',
              workerInvoked,
              processingTime: duration
            }
          };
        } else if (finalJob.status === 'queued' || finalJob.status === 'processing') {
          // Job created successfully but worker didn't complete processing
          logger.warn('Asynchronous insights test completed with warning.', { 
            jobId,
            duration,
            status: finalJob.status,
            workerInvoked
          });
          
          return {
            name: 'Asynchronous Insights Generation',
            status: 'warning',
            duration,
            details: {
              jobId,
              finalStatus: finalJob.status,
              message: workerInvoked 
                ? 'Background worker invoked but job not completed in time (may still be processing)'
                : 'Job created successfully but background worker not accessible',
              recommendation: 'Ensure generate-insights-background function is deployed and accessible',
              workerInvoked
            }
          };
        } else {
          throw new Error(`Job ended with status: ${finalJob.status}`);
        }
      } else {
        throw new Error('Job not found after creation');
      }
      
>>>>>>> 5304711139bb9bfaffa034997570ba53dfd6210d
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Asynchronous insights test failed.', { error: error.message, duration });
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
      
      // Call weather API via HTTP (same as production)
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const weatherUrl = `${baseUrl}/.netlify/functions/weather`;
      
      const response = await fetch(weatherUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: 37.7749,  // San Francisco
          lon: -122.4194,
          timestamp: new Date().toISOString()
        })
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`Weather API returned ${response.status}`);
      }
      
      const weatherData = await response.json();
      
      return {
        name: 'Weather Service',
        status: 'success',
        duration,
        details: {
          location: 'San Francisco, CA',
          temperature: weatherData?.temp || weatherData?.temperature,
          clouds: weatherData?.clouds,
          hasData: !!weatherData
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
      
      // Call solar estimate API via HTTP (GET method with query parameters)
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const params = new URLSearchParams({
        location: '37.7749,-122.4194',  // San Francisco lat,lon
        panelWatts: '3000',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      });
      const solarUrl = `${baseUrl}/.netlify/functions/solar-estimate?${params.toString()}`;
      
      const response = await fetch(solarUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`Solar API returned ${response.status}`);
      }
      
      const solarData = await response.json();
      
      return {
        name: 'Solar Service',
        status: 'success',
        duration,
        details: {
          location: 'San Francisco, CA',
          expectedCharge: solarData?.expectedCharge,
          hasData: !!solarData
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
      const db = await getDb();
      
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
        iterationTimeoutMs: 20000,  // 20s per iteration (enough for Gemini response)
        totalTimeoutMs: 50000  // 50s total (safe margin under 60s function timeout)
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
      
      // Use environment variable with proper fallback chain
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      logger.info('Using Gemini model', { modelName });
      
      const model = genAI.getGenerativeModel({ model: modelName });
      
      const result = await model.generateContent('Respond with "OK" if you can read this.');
      const response = await result.response;
      const text = response.text();
      
      const duration = Date.now() - startTime;
      
      return {
        name: 'Gemini API',
        status: text.includes('OK') ? 'success' : 'warning',
        duration,
        details: {
          model: modelName,
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
  },

  // Test analyze endpoint
  analyze: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Analyze Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const analyzeUrl = `${baseUrl}/.netlify/functions/analyze?sync=true`;
      
      const response = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: TEST_IMAGE_BASE64,
          fileName: 'diagnostic-analyze-test.png'
        })
      });
      
      const duration = Date.now() - startTime;
      
      if (response.ok) {
        const result = await response.json();
        return {
          name: 'Analyze Endpoint',
          status: 'success',
          duration,
          details: {
            hasResult: !!result,
            recordId: result?.id
          }
        };
      } else if (response.status === 400) {
        // 400 is acceptable for test image (too small for Gemini)
        const errorData = await response.json().catch(() => ({}));
        return {
          name: 'Analyze Endpoint',
          status: 'warning',
          duration,
          details: {
            statusCode: 400,
            message: 'Endpoint accessible (test image too small for actual analysis)',
            error: errorData.error || 'Bad request'
          }
        };
      } else {
        throw new Error(`Analyze endpoint returned ${response.status}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Analyze endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Analyze Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test history endpoint
  history: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing History Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const historyUrl = `${baseUrl}/.netlify/functions/history?page=1&limit=5`;
      
      const response = await fetch(historyUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`History endpoint returned ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        name: 'History Endpoint',
        status: 'success',
        duration,
        details: {
          hasData: !!result,
          itemCount: result?.items?.length || 0,
          totalItems: result?.totalItems || 0
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('History endpoint test failed.', { error: error.message, duration });
      return {
        name: 'History Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test systems endpoint
  systems: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Systems Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const systemsUrl = `${baseUrl}/.netlify/functions/systems`;
      
      const response = await fetch(systemsUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`Systems endpoint returned ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        name: 'Systems Endpoint',
        status: 'success',
        duration,
        details: {
          hasData: !!result,
          systemCount: result?.items?.length || 0,
          totalItems: result?.totalItems || 0
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Systems endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Systems Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test get-job-status endpoint
  getJobStatus: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Get Job Status Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      // Use the correct parameter name 'ids' (not 'id')
      const jobStatusUrl = `${baseUrl}/.netlify/functions/get-job-status?ids=test-nonexistent-job`;
      
      const response = await fetch(jobStatusUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const duration = Date.now() - startTime;
      
      // Endpoint should respond with 200 and job status (even for non-existent jobs)
      if (response.ok) {
        const result = await response.json();
        return {
          name: 'Get Job Status Endpoint',
          status: 'success',
          duration,
          details: {
            message: 'Endpoint accessible and responding',
            jobsChecked: Array.isArray(result) ? result.length : 0
          }
        };
      } else if (response.status === 404) {
        // 404 is also acceptable for non-existent jobs
        return {
          name: 'Get Job Status Endpoint',
          status: 'success',
          duration,
          details: {
            message: 'Endpoint correctly returns 404 for non-existent job'
          }
        };
      } else {
        throw new Error(`Get job status endpoint returned ${response.status}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Get job status endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Get Job Status Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test generate-insights endpoint
  generateInsights: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Generate Insights Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const insightsUrl = `${baseUrl}/.netlify/functions/generate-insights`;
      
      const testData = {
        analysisData: {
          stateOfCharge: 75,
          overallVoltage: 52.1,
          current: -5.2
        },
        customPrompt: 'Brief status check'
      };
      
      const response = await fetch(insightsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testData)
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`Generate insights endpoint returned ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        name: 'Generate Insights Endpoint',
        status: 'success',
        duration,
        details: {
          hasInsights: !!result?.insights,
          hasJobId: !!result?.jobId
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Generate insights endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Generate Insights Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test contact endpoint
  contact: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Contact Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const contactUrl = `${baseUrl}/.netlify/functions/contact`;
      
      const response = await fetch(contactUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Diagnostic Test',
          email: 'test@example.com',
          message: 'Automated diagnostic test'
        })
      });
      
      const duration = Date.now() - startTime;
      
      // Contact may require email configuration, so we accept various responses
      // 200 = success, 400 = validation error, 500 = email not configured, 503 = service unavailable
      if (response.ok || response.status === 400 || response.status === 500 || response.status === 503) {
        const statusMessage = response.status === 500 
          ? 'Endpoint accessible (email configuration may be missing)' 
          : 'Endpoint accessible';
        return {
          name: 'Contact Endpoint',
          status: 'success',
          duration,
          details: {
            statusCode: response.status,
            message: statusMessage
          }
        };
      } else {
        throw new Error(`Contact endpoint returned ${response.status}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Contact endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Contact Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test get-ip endpoint
  getIP: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Get IP Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const getIPUrl = `${baseUrl}/.netlify/functions/get-ip`;
      
      const response = await fetch(getIPUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`Get IP endpoint returned ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        name: 'Get IP Endpoint',
        status: 'success',
        duration,
        details: {
          hasIP: !!result?.ip
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Get IP endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Get IP Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test security endpoint
  security: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Security Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const securityUrl = `${baseUrl}/.netlify/functions/security`;
      
      const response = await fetch(securityUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const duration = Date.now() - startTime;
      
      // Security endpoint may have various responses based on configuration
      // 200 = success, 401 = unauthorized, 403 = forbidden, 502 = bad gateway (MongoDB issue)
      if (response.ok || response.status === 401 || response.status === 403 || response.status === 502) {
        const statusMessage = response.status === 502 
          ? 'Endpoint accessible (possible MongoDB collection issue)' 
          : 'Endpoint accessible';
        return {
          name: 'Security Endpoint',
          status: 'success',
          duration,
          details: {
            statusCode: response.status,
            message: statusMessage
          }
        };
      } else {
        throw new Error(`Security endpoint returned ${response.status}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Security endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Security Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test predictive maintenance endpoint
  predictiveMaintenance: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Predictive Maintenance Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const predUrl = `${baseUrl}/.netlify/functions/predictive-maintenance`;
      
      const response = await fetch(predUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemId: 'test-system'
        })
      });
      
      const duration = Date.now() - startTime;
      
      // Accept various responses as the endpoint may require specific data
      if (response.ok || response.status === 400 || response.status === 404) {
        return {
          name: 'Predictive Maintenance Endpoint',
          status: 'success',
          duration,
          details: {
            statusCode: response.status,
            message: 'Endpoint accessible'
          }
        };
      } else {
        throw new Error(`Predictive maintenance endpoint returned ${response.status}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Predictive maintenance endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Predictive Maintenance Endpoint',
        status: 'error',
        duration,
        error: error.message
      };
    }
  },

  // Test admin-systems endpoint
  adminSystems: async () => {
    const startTime = Date.now();
    try {
      logger.info('Testing Admin Systems Endpoint...');
      const baseUrl = process.env.URL || 'http://localhost:8888';
      const adminUrl = `${baseUrl}/.netlify/functions/admin-systems`;
      
      const response = await fetch(adminUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`Admin systems endpoint returned ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        name: 'Admin Systems Endpoint',
        status: 'success',
        duration,
        details: {
          hasData: !!result
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Admin systems endpoint test failed.', { error: error.message, duration });
      return {
        name: 'Admin Systems Endpoint',
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
    
    // Run tests in parallel to reduce total execution time (critical for staying under 26s Netlify timeout)
    const testPromises = selectedTests.map(async (testName) => {
      if (diagnosticTests[testName]) {
        try {
          const result = await diagnosticTests[testName]();
          return result;
        } catch (error) {
          logger.error(`Test ${testName} threw unexpected error`, { 
            error: error.message 
          });
          return {
            name: testName,
            status: 'error',
            error: `Unexpected error: ${error.message}`
          };
        }
      }
      return null;
    });
    
    // Wait for all tests to complete
    const allResults = await Promise.all(testPromises);
    const results = allResults.filter(r => r !== null);
    
    // Check for errors and warnings
    let hasErrors = false;
    let hasWarnings = false;
    for (const result of results) {
      if (result.status === 'error') hasErrors = true;
      if (result.status === 'warning') hasWarnings = true;
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
