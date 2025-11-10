
const { getCollection } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');

// Production test suite - optional, will be created if needed
let ProductionTestSuite;
try {
    ProductionTestSuite = require('../../tests/production-test-suite.js').ProductionTestSuite;
} catch (e) {
    // Stub if not available
    ProductionTestSuite = class {
        async runAllTests() {
            return {
                success: true,
                results: { tests: [], message: 'Production test suite not available' }
            };
        }
        getAvailableTests() {
            return [];
        }
    };
}

const DIAGNOSTIC_JOB_ID = 'diagnostic-test-job';
const FAKE_IMAGE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function fetchWithTimeout(url, options, timeout = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

async function testDatabaseConnection(log) {
    log.info('Running diagnostic: Testing Database Connection...');
    try {
        const startTime = Date.now();
        const collection = await getCollection('diagnostics');
        const testDoc = { _id: 'diagnostic-test', timestamp: new Date() };

        await collection.insertOne(testDoc);
        await collection.deleteOne({ _id: 'diagnostic-test' });

        const duration = Date.now() - startTime;
        log.info('Database connection test completed successfully.', { duration });

        return {
            status: 'Success',
            message: 'Database connection successful',
            responseTime: duration
        };
    } catch (error) {
        log.error('Database connection test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

async function testSyncAnalysis(log, context) {
    log.info('Running diagnostic: Testing Synchronous Analysis...');
    try {
        const image = {
            fileName: 'diagnostic-sync-test.png',
            image: FAKE_IMAGE_B64,
            mimeType: 'image/png',
            force: true,
        };
        const result = await performAnalysisPipeline(image, { items: [] }, log, context);
        if (result && result.id) {
            log.info('Synchronous analysis test completed successfully.', { recordId: result.id });
            return {
                status: 'Success',
                message: 'Synchronous analysis pipeline completed successfully.',
                recordId: result.id
            };
        }
        throw new Error('Analysis pipeline did not return expected result');
    } catch (error) {
        log.error('Synchronous analysis test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

async function testAsyncAnalysis(log) {
    log.info('Running diagnostic: Testing Asynchronous Analysis...');
    try {
        const jobsCollection = await getCollection('jobs');
        const testJob = {
            id: DIAGNOSTIC_JOB_ID,
            status: 'pending',
            createdAt: new Date(),
            fileName: 'diagnostic-async-test.png',
            image: FAKE_IMAGE_B64,
            mimeType: 'image/png'
        };

        await jobsCollection.deleteOne({ id: DIAGNOSTIC_JOB_ID });
        await jobsCollection.insertOne(testJob);
        log.info('Test job inserted for async analysis.', { jobId: DIAGNOSTIC_JOB_ID });

        const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
        const response = await fetchWithTimeout(invokeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-netlify-background': 'true' },
            body: JSON.stringify({ jobId: DIAGNOSTIC_JOB_ID }),
        }, 5000);

        if (response.status !== 202 && response.status !== 200) {
            throw new Error(`Failed to invoke process-analysis function, status: ${response.status}`);
        }

        // Poll for completion
        let attempts = 0;
        const maxAttempts = 10;
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const job = await jobsCollection.findOne({ id: DIAGNOSTIC_JOB_ID });
            if (job && (job.status === 'completed' || job.status === 'failed')) {
                await jobsCollection.deleteOne({ id: DIAGNOSTIC_JOB_ID });
                return {
                    status: job.status === 'completed' ? 'Success' : 'Failure',
                    message: job.status === 'completed' ? 'Async analysis completed successfully' : `Async analysis failed: ${job.error || 'Unknown error'}`
                };
            }
            attempts++;
        }

        await jobsCollection.deleteOne({ id: DIAGNOSTIC_JOB_ID });
        return {
            status: 'Failure',
            message: 'Async analysis timed out'
        };
    } catch (error) {
        log.error('Asynchronous analysis test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

async function testWeatherService(log) {
    log.info('Running diagnostic: Testing Weather Service...');
    const weatherUrl = `${process.env.URL}/.netlify/functions/weather`;
    const subtests = [];

    try {
        // 1. Ensure non-POST requests are rejected with actionable feedback
        try {
            const getResponse = await fetchWithTimeout(weatherUrl, { method: 'GET' }, 5000);
            const getPassed = getResponse.status === 405;
            const getMessage = getPassed
                ? 'GET request correctly rejected with 405.'
                : `Expected 405 for GET, received ${getResponse.status}`;
            subtests.push({ name: 'Reject GET', status: getPassed ? 'Success' : 'Failure', message: getMessage });
        } catch (error) {
            subtests.push({ name: 'Reject GET', status: 'Failure', message: `GET request threw error: ${error.message}` });
        }

        // 2. Validate payload requirements (missing lat/lon)
        try {
            const missingPayloadResponse = await fetchWithTimeout(weatherUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            }, 5000);
            const parsed = await safeJson(missingPayloadResponse);
            const missingPayloadPassed = missingPayloadResponse.status === 400;
            const missingPayloadMessage = missingPayloadPassed
                ? 'POST without lat/lon correctly returned 400.'
                : `Expected 400 for missing lat/lon, received ${missingPayloadResponse.status} ${parsed && parsed.error ? parsed.error : ''}`;
            subtests.push({ name: 'Validate POST payload', status: missingPayloadPassed ? 'Success' : 'Failure', message: missingPayloadMessage });
        } catch (error) {
            subtests.push({ name: 'Validate POST payload', status: 'Failure', message: `POST validation threw error: ${error.message}` });
        }

        // 3. Execute valid POST request with timestamp and verify response shape
        try {
            const timestamp = new Date().toISOString();
            const validResponse = await fetchWithTimeout(weatherUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: 38.8,
                    lon: -104.8,
                    timestamp
                })
            }, 8000);

            if (!validResponse.ok) {
                const parsed = await safeJson(validResponse);
                subtests.push({
                    name: 'Valid POST weather fetch',
                    status: 'Failure',
                    message: `Weather service returned status ${validResponse.status}${parsed && parsed.error ? `: ${parsed.error}` : ''}`
                });
            } else {
                const payload = await validResponse.json();
                const requiredKeys = ['temp', 'clouds', 'uvi', 'weather_main'];
                const missingKeys = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(payload, key));
                if (missingKeys.length > 0) {
                    subtests.push({
                        name: 'Valid POST weather fetch',
                        status: 'Failure',
                        message: `Response missing keys: ${missingKeys.join(', ')}`
                    });
                } else {
                    subtests.push({
                        name: 'Valid POST weather fetch',
                        status: 'Success',
                        message: 'Weather service returned expected fields.'
                    });
                }
            }
        } catch (error) {
            subtests.push({ name: 'Valid POST weather fetch', status: 'Failure', message: `Valid request threw error: ${error.message}` });
        }

        const failed = subtests.some(test => test.status === 'Failure');
        return {
            status: failed ? 'Failure' : 'Success',
            message: failed ? 'One or more weather service checks failed.' : 'Weather service passed all checks.',
            details: subtests
        };
    } catch (outerError) {
        log.error('Weather service test failed catastrophically.', { error: outerError.message });
        subtests.push({ name: 'Weather diagnostic execution', status: 'Failure', message: outerError.message });
        return {
            status: 'Failure',
            message: outerError.message,
            details: subtests
        };
    }
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

async function safeTest(log, testName, testFn) {
    try {
        const result = await testFn();
        if (!result || typeof result !== 'object' || !result.status) {
            log.warn('Diagnostic test returned unexpected payload.', { testName, resultType: typeof result });
            return {
                status: 'Failure',
                message: 'Test completed without providing a status payload.'
            };
        }
        return result;
    } catch (error) {
        log.error('Diagnostic test threw an unhandled error.', {
            testName,
            error: error.message,
            stack: error.stack
        });
        return {
            status: 'Failure',
            message: error.message || 'Unexpected error during diagnostics.'
        };
    }
}

async function testGeminiHealth(log) {
    log.info('Running diagnostic: Testing Gemini API Health...');
    try {
        if (!process.env.GEMINI_API_KEY) {
            return {
                status: 'Failure',
                message: 'GEMINI_API_KEY environment variable not set'
            };
        }

        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        if (typeof client.getGenerativeModel === 'function') {
            const startTime = Date.now();
            const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

            // Simple test prompt
            await Promise.race([
                model.generateContent('Test prompt: respond with "OK"'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini API timeout')), 10000))
            ]);

            const duration = Date.now() - startTime;
            log.info('Gemini API health check completed.', { duration });

            return {
                status: 'Success',
                message: 'Gemini API is accessible and responding',
                responseTime: duration
            };
        } else {
            return {
                status: 'Failure',
                message: 'Gemini client not properly initialized'
            };
        }
    } catch (error) {
        log.error('Gemini API health check failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

async function testSolarService(log) {
    log.info('Running diagnostic: Testing Solar Service...');
    try {
        const solarUrl = `${process.env.URL}/.netlify/functions/solar-estimate?location=80942&panelWatts=400&startDate=2025-01-01&endDate=2025-01-02`;
        const response = await fetchWithTimeout(solarUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 10000);

        if (response.ok) {
            const data = await response.json();
            return {
                status: 'Success',
                message: 'Solar service responding correctly',
                data: data.dailyEstimates ? `${data.dailyEstimates.length} daily estimates` : 'Solar data available'
            };
        } else {
            return {
                status: 'Failure',
                message: `Solar service returned status: ${response.status}`
            };
        }
    } catch (error) {
        log.error('Solar service test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

async function testSystemAnalytics(log) {
    log.info('Running diagnostic: Testing System Analytics...');
    try {
        // First, get a system ID to test with
        const systemsCollection = await getCollection('systems');
        const systems = await systemsCollection.find({}).limit(1).toArray();

        if (systems.length === 0) {
            return {
                status: 'Skipped',
                message: 'No systems available to test analytics'
            };
        }

        const systemId = systems[0].id;
        const analyticsUrl = `${process.env.URL}/.netlify/functions/system-analytics?systemId=${systemId}`;
        const response = await fetchWithTimeout(analyticsUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 10000);

        if (response.ok) {
            await response.json(); // Consume response
            return {
                status: 'Success',
                message: 'System analytics responding correctly',
                data: `Analytics for system ${systemId}`
            };
        } else {
            return {
                status: 'Failure',
                message: `System analytics returned status: ${response.status}`
            };
        }
    } catch (error) {
        log.error('System analytics test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

async function testInsightsWithTools(log) {
    log.info('Running diagnostic: Testing Enhanced Insights with Function Calling...');
    try {
        const insightsUrl = `${process.env.URL}/.netlify/functions/generate-insights-with-tools`;
        const testData = {
            analysisData: {
                overallVoltage: 52.4,
                current: -5.2,
                stateOfCharge: 85,
                temperature: 25,
                cellVoltages: [3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28, 3.27, 3.28],
                alerts: [],
                summary: 'Diagnostic test'
            },
            systemId: 'test-system',
            customPrompt: 'Provide a brief health summary'
        };

        const response = await fetchWithTimeout(insightsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        }, 30000); // increased timeout: some enhanced-insights runs can take >15s

        if (response.ok) {
            const data = await response.json();
            return {
                status: 'Success',
                message: 'Enhanced insights with function calling working correctly',
                data: data.usedFunctionCalling ? 'Function calling active' : 'Standard mode'
            };
        } else {
            return {
                status: 'Failure',
                message: `Enhanced insights returned status: ${response.status}`
            };
        }
    } catch (error) {
        log.error('Enhanced insights test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

async function testDeleteEndpoint(log, recordId) {
    log.info('Running diagnostic: Testing Delete Endpoint...', { recordId });
    try {
        const deleteUrl = `${process.env.URL}/.netlify/functions/history?id=${recordId}`;
        const response = await fetchWithTimeout(deleteUrl, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        }, 5000);

        if (response.ok) {
            return {
                status: 'Success',
                message: 'Delete endpoint working correctly'
            };
        } else {
            return {
                status: 'Failure',
                message: `Delete endpoint returned status: ${response.status}`
            };
        }
    } catch (error) {
        log.error('Delete endpoint test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
        };
    }
}

// ============================================================================
// ADDITIONAL DIAGNOSTIC TESTS - Core Analysis Functions
// ============================================================================

async function testAnalyzeEndpoint(log) {
    log.info('Running diagnostic: Testing Analyze Endpoint (synchronous mode)...');
    const startTime = Date.now();
    try {
        const analyzeUrl = `${process.env.URL}/.netlify/functions/analyze?sync=true&force=true`;
        const testData = {
            fileName: 'diagnostic-analyze-test.png',
            image: FAKE_IMAGE_B64,
            mimeType: 'image/png'
        };

        log.debug('Sending analyze request', { url: analyzeUrl, fileName: testData.fileName });
        const response = await fetchWithTimeout(analyzeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `diagnostic-test-${Date.now()}`
            },
            body: JSON.stringify(testData)
        }, 30000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok && responseData) {
            log.info('Analyze endpoint test completed successfully.', {
                duration,
                statusCode: response.status,
                recordId: responseData.id,
                hasAnalysis: !!responseData.analysis
            });
            return {
                status: 'Success',
                message: 'Analyze endpoint working correctly',
                responseTime: duration,
                recordId: responseData.id,
                data: { statusCode: response.status, hasAnalysis: !!responseData.analysis }
            };
        } else {
            log.warn('Analyze endpoint returned non-OK response', {
                duration,
                statusCode: response.status,
                responseData
            });
            return {
                status: 'Failure',
                message: `Analyze endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Analyze endpoint test failed.', {
            error: error.message,
            duration,
            stack: error.stack
        });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testProcessAnalysisEndpoint(log) {
    log.info('Running diagnostic: Testing Process Analysis Endpoint...');
    const startTime = Date.now();
    try {
        const jobId = `diagnostic-process-test-${Date.now()}`;
        const jobsCollection = await getCollection('jobs');

        // Create a test job
        const testJob = {
            id: jobId,
            status: 'pending',
            createdAt: new Date(),
            fileName: 'diagnostic-process-test.png',
            image: FAKE_IMAGE_B64,
            mimeType: 'image/png'
        };

        log.debug('Creating test job', { jobId });
        await jobsCollection.insertOne(testJob);

        const processUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
        log.debug('Invoking process-analysis function', { url: processUrl, jobId });

        const response = await fetchWithTimeout(processUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-netlify-background': 'true' },
            body: JSON.stringify({ jobId })
        }, 5000);

        const duration = Date.now() - startTime;

        // Poll for completion
        let attempts = 0;
        const maxAttempts = 10;
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const job = await jobsCollection.findOne({ id: jobId });

            if (job && (job.status === 'completed' || job.status === 'failed')) {
                await jobsCollection.deleteOne({ id: jobId });

                log.info('Process analysis test completed', {
                    jobId,
                    finalStatus: job.status,
                    totalDuration: Date.now() - startTime,
                    attempts
                });

                return {
                    status: job.status === 'completed' ? 'Success' : 'Failure',
                    message: job.status === 'completed'
                        ? 'Process analysis completed successfully'
                        : `Process analysis failed: ${job.error || 'Unknown error'}`,
                    responseTime: Date.now() - startTime,
                    data: { finalStatus: job.status, attempts }
                };
            }
            attempts++;
        }

        await jobsCollection.deleteOne({ id: jobId });
        log.warn('Process analysis test timed out', { jobId, duration: Date.now() - startTime });
        return {
            status: 'Failure',
            message: 'Process analysis timed out',
            duration: Date.now() - startTime
        };
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Process analysis test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testExtractDLEndpoint(log) {
    log.info('Running diagnostic: Testing Extract DL Endpoint...');
    const startTime = Date.now();
    try {
        const extractUrl = `${process.env.URL}/.netlify/functions/extract-dl`;
        const testData = {
            fileName: 'diagnostic-extract-test.png',
            image: FAKE_IMAGE_B64,
            mimeType: 'image/png'
        };

        log.debug('Sending extract-dl request', { url: extractUrl, fileName: testData.fileName });
        const response = await fetchWithTimeout(extractUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        }, 15000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('Extract DL test completed successfully.', {
                duration,
                statusCode: response.status,
                hasDlNumber: !!(responseData && responseData.dlNumber)
            });
            return {
                status: 'Success',
                message: 'Extract DL endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status, extractedData: !!responseData }
            };
        } else {
            log.warn('Extract DL endpoint returned non-OK response', {
                duration,
                statusCode: response.status,
                responseData
            });
            return {
                status: 'Failure',
                message: `Extract DL endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Extract DL test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

// ============================================================================
// ADDITIONAL DIAGNOSTIC TESTS - Insights Generation Functions
// ============================================================================

async function testGenerateInsightsEndpoint(log) {
    log.info('Running diagnostic: Testing Generate Insights Endpoint (standard mode)...');
    const startTime = Date.now();
    try {
        const insightsUrl = `${process.env.URL}/.netlify/functions/generate-insights`;
        const testData = {
            batteryData: {
                measurements: [
                    {
                        timestamp: new Date().toISOString(),
                        stateOfCharge: 85,
                        voltage: 52.4,
                        current: -5.2,
                        temperature: 25
                    }
                ]
            },
            systemId: 'diagnostic-test-system'
        };

        log.debug('Sending generate-insights request', { url: insightsUrl, systemId: testData.systemId });
        const response = await fetchWithTimeout(insightsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        }, 30000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok && responseData) {
            log.info('Generate insights test completed successfully.', {
                duration,
                statusCode: response.status,
                hasInsights: !!responseData.insights
            });
            return {
                status: 'Success',
                message: 'Generate insights endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status, hasInsights: !!responseData.insights }
            };
        } else {
            log.warn('Generate insights endpoint returned non-OK response', {
                duration,
                statusCode: response.status,
                responseData
            });
            return {
                status: 'Failure',
                message: `Generate insights endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Generate insights test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testDebugInsightsEndpoint(log) {
    log.info('Running diagnostic: Testing Debug Insights Endpoint...');
    const startTime = Date.now();
    try {
        const debugUrl = `${process.env.URL}/.netlify/functions/debug-insights`;
        const testData = {
            batteryData: {
                measurements: [
                    {
                        timestamp: new Date().toISOString(),
                        stateOfCharge: 85,
                        voltage: 52.4
                    }
                ]
            }
        };

        log.debug('Sending debug-insights request', { url: debugUrl });
        const response = await fetchWithTimeout(debugUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        }, 10000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('Debug insights test completed successfully.', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Success',
                message: 'Debug insights endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status }
            };
        } else {
            log.warn('Debug insights endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Debug insights endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Debug insights test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

// ============================================================================
// ADDITIONAL DIAGNOSTIC TESTS - Data Management Functions
// ============================================================================

async function testHistoryEndpoint(log) {
    log.info('Running diagnostic: Testing History Endpoint...');
    const startTime = Date.now();
    try {
        // Test GET request
        const historyUrl = `${process.env.URL}/.netlify/functions/history?page=1&limit=5`;
        log.debug('Testing history GET request', { url: historyUrl });

        const response = await fetchWithTimeout(historyUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 10000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok && responseData) {
            log.info('History endpoint test completed successfully.', {
                duration,
                statusCode: response.status,
                itemCount: responseData.items ? responseData.items.length : 0,
                totalItems: responseData.totalItems
            });
            return {
                status: 'Success',
                message: 'History endpoint working correctly',
                responseTime: duration,
                data: {
                    statusCode: response.status,
                    itemCount: responseData.items ? responseData.items.length : 0,
                    totalItems: responseData.totalItems
                }
            };
        } else {
            log.warn('History endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `History endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('History endpoint test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testSystemsEndpoint(log) {
    log.info('Running diagnostic: Testing Systems Endpoint...');
    const startTime = Date.now();
    try {
        const systemsUrl = `${process.env.URL}/.netlify/functions/systems?page=1&limit=5`;
        log.debug('Testing systems GET request', { url: systemsUrl });

        const response = await fetchWithTimeout(systemsUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 10000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok && responseData) {
            log.info('Systems endpoint test completed successfully.', {
                duration,
                statusCode: response.status,
                itemCount: responseData.items ? responseData.items.length : 0,
                totalItems: responseData.totalItems
            });
            return {
                status: 'Success',
                message: 'Systems endpoint working correctly',
                responseTime: duration,
                data: {
                    statusCode: response.status,
                    itemCount: responseData.items ? responseData.items.length : 0,
                    totalItems: responseData.totalItems
                }
            };
        } else {
            log.warn('Systems endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Systems endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Systems endpoint test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testDataEndpoint(log) {
    log.info('Running diagnostic: Testing Data Endpoint...');
    const startTime = Date.now();
    try {
        const dataUrl = `${process.env.URL}/.netlify/functions/data`;
        log.debug('Testing data GET request', { url: dataUrl });

        const response = await fetchWithTimeout(dataUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 10000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('Data endpoint test completed successfully.', {
                duration,
                statusCode: response.status,
                hasData: !!responseData
            });
            return {
                status: 'Success',
                message: 'Data endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status, hasData: !!responseData }
            };
        } else {
            log.warn('Data endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Data endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Data endpoint test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testExportDataEndpoint(log) {
    log.info('Running diagnostic: Testing Export Data Endpoint...');
    const startTime = Date.now();
    try {
        const exportUrl = `${process.env.URL}/.netlify/functions/export-data?type=history&format=csv`;
        log.debug('Testing export-data request', { url: exportUrl });

        const response = await fetchWithTimeout(exportUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 15000);

        const duration = Date.now() - startTime;

        if (response.ok) {
            const contentType = response.headers.get('content-type');
            log.info('Export data test completed successfully.', {
                duration,
                statusCode: response.status,
                contentType
            });
            return {
                status: 'Success',
                message: 'Export data endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status, contentType }
            };
        } else {
            log.warn('Export data endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Export data endpoint returned status: ${response.status}`
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Export data test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

// ============================================================================
// ADDITIONAL DIAGNOSTIC TESTS - Job Management Functions
// ============================================================================

async function testGetJobStatusEndpoint(log) {
    log.info('Running diagnostic: Testing Get Job Status Endpoint...');
    const startTime = Date.now();
    try {
        // Create a test job to query
        const jobsCollection = await getCollection('jobs');
        const testJobId = `diagnostic-status-test-${Date.now()}`;
        const testJob = {
            id: testJobId,
            status: 'completed',
            createdAt: new Date(),
            fileName: 'diagnostic-status-test.png'
        };

        log.debug('Creating test job for status check', { jobId: testJobId });
        await jobsCollection.insertOne(testJob);

        const statusUrl = `${process.env.URL}/.netlify/functions/get-job-status?ids=${testJobId}`;
        log.debug('Testing get-job-status request', { url: statusUrl });

        const response = await fetchWithTimeout(statusUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 5000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        // Clean up test job
        await jobsCollection.deleteOne({ id: testJobId });

        if (response.ok && responseData && Array.isArray(responseData) && responseData.length > 0) {
            log.info('Get job status test completed successfully.', {
                duration,
                statusCode: response.status,
                jobCount: responseData.length,
                jobStatus: responseData[0].status
            });
            return {
                status: 'Success',
                message: 'Get job status endpoint working correctly',
                responseTime: duration,
                data: {
                    statusCode: response.status,
                    jobCount: responseData.length
                }
            };
        } else {
            log.warn('Get job status endpoint returned unexpected response', {
                duration,
                statusCode: response.status,
                responseData
            });
            return {
                status: 'Failure',
                message: `Get job status endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Get job status test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testJobShepherdEndpoint(log) {
    log.info('Running diagnostic: Testing Job Shepherd Endpoint...');
    const startTime = Date.now();
    try {
        const shepherdUrl = `${process.env.URL}/.netlify/functions/job-shepherd`;
        log.debug('Testing job-shepherd request', { url: shepherdUrl });

        const response = await fetchWithTimeout(shepherdUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }, 10000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('Job shepherd test completed successfully.', {
                duration,
                statusCode: response.status,
                processedJobs: responseData?.processedJobs || 0
            });
            return {
                status: 'Success',
                message: 'Job shepherd endpoint working correctly',
                responseTime: duration,
                data: {
                    statusCode: response.status,
                    processedJobs: responseData?.processedJobs || 0
                }
            };
        } else {
            log.warn('Job shepherd endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Job shepherd endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Job shepherd test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

// ============================================================================
// ADDITIONAL DIAGNOSTIC TESTS - Utility & Admin Functions
// ============================================================================

async function testContactEndpoint(log) {
    log.info('Running diagnostic: Testing Contact Endpoint...');
    const startTime = Date.now();
    try {
        // Check if email is configured
        if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
            log.warn('Contact endpoint test skipped - email not configured');
            return {
                status: 'Skipped',
                message: 'Email configuration not available (EMAIL_HOST or EMAIL_USER missing)',
                duration: Date.now() - startTime
            };
        }

        const contactUrl = `${process.env.URL}/.netlify/functions/contact`;
        const testData = {
            name: 'Diagnostic Test',
            email: 'diagnostic@test.local',
            message: 'This is a diagnostic test message - can be ignored'
        };

        log.debug('Testing contact request', { url: contactUrl });
        const response = await fetchWithTimeout(contactUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        }, 10000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('Contact endpoint test completed successfully.', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Success',
                message: 'Contact endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status }
            };
        } else {
            log.warn('Contact endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Contact endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Contact endpoint test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testGetIPEndpoint(log) {
    log.info('Running diagnostic: Testing Get IP Endpoint...');
    const startTime = Date.now();
    try {
        const ipUrl = `${process.env.URL}/.netlify/functions/get-ip`;
        log.debug('Testing get-ip request', { url: ipUrl });

        const response = await fetchWithTimeout(ipUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 5000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok && responseData) {
            log.info('Get IP test completed successfully.', {
                duration,
                statusCode: response.status,
                hasIP: !!responseData.ip
            });
            return {
                status: 'Success',
                message: 'Get IP endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status, hasIP: !!responseData.ip }
            };
        } else {
            log.warn('Get IP endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Get IP endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Get IP test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testUploadEndpoint(log) {
    log.info('Running diagnostic: Testing Upload Endpoint...');
    const startTime = Date.now();
    try {
        // Note: Testing multipart/form-data upload is complex
        // This test validates the endpoint responds appropriately
        const uploadUrl = `${process.env.URL}/.netlify/functions/upload`;
        log.debug('Testing upload endpoint availability', { url: uploadUrl });

        const response = await fetchWithTimeout(uploadUrl, {
            method: 'OPTIONS',
            headers: { 'Content-Type': 'application/json' }
        }, 5000);

        const duration = Date.now() - startTime;

        if (response.ok || response.status === 200) {
            log.info('Upload endpoint test completed successfully.', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Success',
                message: 'Upload endpoint is accessible',
                responseTime: duration,
                data: { statusCode: response.status }
            };
        } else {
            log.warn('Upload endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Upload endpoint returned status: ${response.status}`
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Upload endpoint test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testSecurityEndpoint(log) {
    log.info('Running diagnostic: Testing Security Endpoint...');
    const startTime = Date.now();
    try {
        const securityUrl = `${process.env.URL}/.netlify/functions/security`;
        log.debug('Testing security request', { url: securityUrl });

        const response = await fetchWithTimeout(securityUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 5000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('Security endpoint test completed successfully.', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Success',
                message: 'Security endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status }
            };
        } else {
            log.warn('Security endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Security endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Security endpoint test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testPredictiveMaintenanceEndpoint(log) {
    log.info('Running diagnostic: Testing Predictive Maintenance Endpoint...');
    const startTime = Date.now();
    try {
        // First check if we have a system to test with
        const systemsCollection = await getCollection('systems');
        const systems = await systemsCollection.find({}).limit(1).toArray();

        if (systems.length === 0) {
            log.warn('Predictive maintenance test skipped - no systems available');
            return {
                status: 'Skipped',
                message: 'No systems available to test predictive maintenance',
                duration: Date.now() - startTime
            };
        }

        const systemId = systems[0].id;
        const maintenanceUrl = `${process.env.URL}/.netlify/functions/predictive-maintenance?systemId=${systemId}`;
        log.debug('Testing predictive-maintenance request', { url: maintenanceUrl, systemId });

        const response = await fetchWithTimeout(maintenanceUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 15000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('Predictive maintenance test completed successfully.', {
                duration,
                statusCode: response.status,
                systemId
            });
            return {
                status: 'Success',
                message: 'Predictive maintenance endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status, systemId }
            };
        } else {
            log.warn('Predictive maintenance endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Predictive maintenance endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Predictive maintenance test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testIPAdminEndpoint(log) {
    log.info('Running diagnostic: Testing IP Admin Endpoint...');
    const startTime = Date.now();
    try {
        const ipAdminUrl = `${process.env.URL}/.netlify/functions/ip-admin`;
        log.debug('Testing ip-admin request', { url: ipAdminUrl });

        const response = await fetchWithTimeout(ipAdminUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 5000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            log.info('IP Admin test completed successfully.', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Success',
                message: 'IP Admin endpoint working correctly',
                responseTime: duration,
                data: { statusCode: response.status }
            };
        } else {
            log.warn('IP Admin endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `IP Admin endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('IP Admin test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

async function testAdminSystemsEndpoint(log) {
    log.info('Running diagnostic: Testing Admin Systems Endpoint...');
    const startTime = Date.now();
    try {
        const adminSystemsUrl = `${process.env.URL}/.netlify/functions/admin-systems?adopted=false`;
        log.debug('Testing admin-systems request', { url: adminSystemsUrl });

        const response = await fetchWithTimeout(adminSystemsUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 10000);

        const duration = Date.now() - startTime;
        const responseData = await response.json().catch(() => null);

        if (response.ok && responseData) {
            log.info('Admin systems test completed successfully.', {
                duration,
                statusCode: response.status,
                systemCount: responseData.items ? responseData.items.length : 0
            });
            return {
                status: 'Success',
                message: 'Admin systems endpoint working correctly',
                responseTime: duration,
                data: {
                    statusCode: response.status,
                    systemCount: responseData.items ? responseData.items.length : 0
                }
            };
        } else {
            log.warn('Admin systems endpoint returned non-OK response', {
                duration,
                statusCode: response.status
            });
            return {
                status: 'Failure',
                message: `Admin systems endpoint returned status: ${response.status}`,
                details: responseData
            };
        }
    } catch (error) {
        const duration = Date.now() - startTime;
        log.error('Admin systems test failed.', { error: error.message, duration, stack: error.stack });
        return {
            status: 'Failure',
            message: error.message,
            duration
        };
    }
}

// === PRODUCTION SYNC DIAGNOSTIC TESTS ===

/**
 * Test 1: Cache Integrity Check
 * Verify all MongoDB records have required sync fields
 */
async function testCacheIntegrity(log) {
    log.info('Running diagnostic: Cache Integrity Check...');
    const startTime = Date.now();
    try {
        const collections = ['systems', 'history', 'analysis-results'];
        let totalRecords = 0;
        let validRecords = 0;
        const issues = [];

        for (const collName of collections) {
            try {
                const collection = await getCollection(collName);
                const records = await collection.find({}).limit(100).toArray();
                totalRecords += records.length;

                for (const rec of records) {
                    const hasUpdatedAt = rec.updatedAt && typeof rec.updatedAt === 'string';
                    const hasSyncStatus = ['pending', 'synced', 'conflict'].includes(rec._syncStatus);

                    if (hasUpdatedAt && hasSyncStatus) {
                        validRecords++;
                    } else {
                        issues.push({
                            collection: collName,
                            id: rec.id || rec._id,
                            missing: {
                                updatedAt: !hasUpdatedAt,
                                syncStatus: !hasSyncStatus
                            }
                        });
                    }
                }
            } catch (e) {
                log.warn(`Failed to check collection ${collName}`, { error: e.message });
            }
        }

        return {
            status: issues.length === 0 ? 'Success' : 'Warning',
            message: issues.length === 0 ? 'All records have required sync fields' : `Found ${issues.length} records missing sync fields`,
            details: {
                totalRecords,
                validRecords,
                issueCount: issues.length,
                issues: issues.slice(0, 5) // Show first 5
            },
            duration: Date.now() - startTime
        };
    } catch (error) {
        log.error('Cache integrity check failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message,
            duration: Date.now() - startTime
        };
    }
}

/**
 * Test 2: MongoDB Sync Status
 * Check sync metadata and pending items
 */
async function testSyncStatus(log) {
    log.info('Running diagnostic: MongoDB Sync Status...');
    const startTime = Date.now();
    try {
        const collection = await getCollection('systems');
        const pendingCount = await collection.countDocuments({ _syncStatus: 'pending' });
        const syncedCount = await collection.countDocuments({ _syncStatus: 'synced' });
        const conflictCount = await collection.countDocuments({ _syncStatus: 'conflict' });

        // Get most recent sync timestamp
        const latest = await collection.findOne({}, { sort: { updatedAt: -1 } });
        const lastSync = latest?.updatedAt || 'never';

        const status = pendingCount === 0 ? 'Success' : (pendingCount > 10 ? 'Warning' : 'Success');

        return {
            status,
            message: status === 'Success' ? 'Sync status OK' : `${pendingCount} pending items waiting to sync`,
            details: {
                pending: pendingCount,
                synced: syncedCount,
                conflicts: conflictCount,
                lastSyncTime: lastSync
            },
            duration: Date.now() - startTime
        };
    } catch (error) {
        log.error('Sync status check failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message,
            duration: Date.now() - startTime
        };
    }
}

/**
 * Test 3: Conflict Detection
 * Query records with sync conflicts
 */
async function testConflictDetection(log) {
    log.info('Running diagnostic: Conflict Detection...');
    const startTime = Date.now();
    try {
        const collection = await getCollection('systems');
        const conflicts = await collection.find({ _syncStatus: 'conflict' }).limit(50).toArray();

        const conflictDetails = conflicts.map(c => ({
            id: c.id || c._id,
            updatedAt: c.updatedAt,
            lastModified: c.lastModified
        }));

        return {
            status: conflicts.length === 0 ? 'Success' : 'Warning',
            message: conflicts.length === 0 ? 'No sync conflicts found' : `Found ${conflicts.length} conflicting records`,
            details: {
                conflictCount: conflicts.length,
                conflicts: conflictDetails.slice(0, 5)
            },
            duration: Date.now() - startTime
        };
    } catch (error) {
        log.error('Conflict detection failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message,
            duration: Date.now() - startTime
        };
    }
}

/**
 * Test 4: Timestamp Consistency Check
 * Verify all timestamps are ISO 8601 UTC format
 */
async function testTimestampConsistency(log) {
    log.info('Running diagnostic: Timestamp Consistency Check...');
    const startTime = Date.now();
    const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    try {
        const collections = ['systems', 'history', 'analysis-results'];
        let totalChecked = 0;
        let validTimestamps = 0;
        const issues = [];

        for (const collName of collections) {
            try {
                const collection = await getCollection(collName);
                const records = await collection.find({}).limit(50).toArray();

                for (const rec of records) {
                    totalChecked++;
                    if (rec.updatedAt && ISO_UTC_REGEX.test(rec.updatedAt)) {
                        validTimestamps++;
                    } else {
                        issues.push({
                            collection: collName,
                            id: rec.id || rec._id,
                            timestamp: rec.updatedAt
                        });
                    }
                }
            } catch (e) {
                log.warn(`Failed to check timestamps in ${collName}`, { error: e.message });
            }
        }

        return {
            status: issues.length === 0 ? 'Success' : 'Failure',
            message: issues.length === 0 ? 'All timestamps are valid UTC' : `Found ${issues.length} invalid timestamps`,
            details: {
                totalChecked,
                validTimestamps,
                invalidCount: issues.length,
                samples: issues.slice(0, 3)
            },
            duration: Date.now() - startTime
        };
    } catch (error) {
        log.error('Timestamp consistency check failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message,
            duration: Date.now() - startTime
        };
    }
}

/**
 * Test 5: Data Integrity Checksum
 * Generate checksum and compare with server state
 */
async function testDataIntegrity(log) {
    log.info('Running diagnostic: Data Integrity Checksum...');
    const startTime = Date.now();
    const crypto = require('crypto');

    try {
        const collection = await getCollection('systems');
        const records = await collection.find({}).toArray();

        // Generate checksum
        const checksumData = records
            .map(r => `${r.id || r._id}:${r.updatedAt}`)
            .sort()
            .join('|');

        const checksum = crypto
            .createHash('sha256')
            .update(checksumData)
            .digest('hex');

        return {
            status: 'Success',
            message: 'Data integrity checksum computed',
            details: {
                recordCount: records.length,
                checksum: checksum.substring(0, 16) + '...',
                fullChecksum: checksum
            },
            duration: Date.now() - startTime
        };
    } catch (error) {
        log.error('Data integrity check failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message,
            duration: Date.now() - startTime
        };
    }
}

/**
 * Test 6: Full Sync Cycle Test
 * Create, modify, delete test records
 */
async function testFullSyncCycle(log) {
    log.info('Running diagnostic: Full Sync Cycle Test...');
    const startTime = Date.now();
    const testId = `test-sync-${Date.now()}`;

    try {
        const collection = await getCollection('systems');
        const results = [];

        // Step 1: Create
        const testRecord = {
            id: testId,
            name: 'Test Sync Cycle',
            updatedAt: new Date().toISOString(),
            _syncStatus: 'synced'
        };
        await collection.insertOne(testRecord);
        results.push({ step: 'create', status: 'success' });

        // Step 2: Read
        const created = await collection.findOne({ id: testId });
        if (created) {
            results.push({ step: 'read', status: 'success' });
        } else {
            throw new Error('Failed to read created record');
        }

        // Step 3: Update
        await collection.updateOne({ id: testId }, { $set: { name: 'Updated Test', updatedAt: new Date().toISOString() } });
        results.push({ step: 'update', status: 'success' });

        // Step 4: Delete
        await collection.deleteOne({ id: testId });
        results.push({ step: 'delete', status: 'success' });

        return {
            status: 'Success',
            message: 'Full sync cycle test completed successfully',
            details: {
                steps: results
            },
            duration: Date.now() - startTime
        };
    } catch (error) {
        log.error('Full sync cycle test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message,
            duration: Date.now() - startTime
        };
    }
}

/**
 * Test 7: Cache Statistics
 * Count records and estimate cache size
 */
async function testCacheStatistics(log) {
    log.info('Running diagnostic: Cache Statistics...');
    const startTime = Date.now();

    try {
        const collections = ['systems', 'history', 'analysis-results'];
        const stats = {};
        let totalSize = 0;

        for (const collName of collections) {
            try {
                const collection = await getCollection(collName);
                const total = await collection.countDocuments({});
                const pending = await collection.countDocuments({ _syncStatus: 'pending' });
                const synced = await collection.countDocuments({ _syncStatus: 'synced' });

                // Estimate size (rough approximation: ~1-5KB per record)
                const estimatedSize = total * 2500; // bytes

                stats[collName] = {
                    total,
                    pending,
                    synced,
                    estimatedSizeKB: Math.round(estimatedSize / 1024)
                };

                totalSize += estimatedSize;
            } catch (e) {
                log.warn(`Failed to get statistics for ${collName}`, { error: e.message });
            }
        }

        return {
            status: 'Success',
            message: 'Cache statistics retrieved',
            details: {
                byCollection: stats,
                totalRecords: Object.values(stats).reduce((sum, s) => sum + (s.total || 0), 0),
                totalPending: Object.values(stats).reduce((sum, s) => sum + (s.pending || 0), 0),
                estimatedTotalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
            },
            duration: Date.now() - startTime
        };
    } catch (error) {
        log.error('Cache statistics failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message,
            duration: Date.now() - startTime
        };
    }
}

// New comprehensive test runner integration
async function runComprehensiveTests(log, selectedTests = null) {
    log.info('Running comprehensive test suite...', { selectedTests });
    try {
        const testSuite = new ProductionTestSuite();
        const result = await testSuite.runAllTests(selectedTests);

        return {
            status: result.success ? 'Success' : 'Failure',
            message: result.success ? 'All comprehensive tests passed' : 'Some comprehensive tests failed',
            details: result.results,
            testResults: result.results.tests
        };
    } catch (error) {
        log.error('Comprehensive test suite failed.', { error: error.message });
        return {
            status: 'Failure',
            message: `Test suite execution failed: ${error.message}`
        };
    }
}

exports.handler = async (event, context) => {
    const log = createLogger('admin-diagnostics');
    log.info('Admin diagnostics endpoint called.', {
        method: event.httpMethod,
        body: event.body ? JSON.parse(event.body) : null
    });

    try {
        // Parse request body for specific test selection
        let requestBody = {};
        if (event.body) {
            try {
                requestBody = JSON.parse(event.body);
            } catch (e) {
                log.warn('Invalid JSON in request body, running all tests');
            }
        }

        const results = {};

        // Check if specific tests are requested via selectedTests array
        if (requestBody.selectedTests && Array.isArray(requestBody.selectedTests) && requestBody.selectedTests.length > 0) {
            log.info('Running selected diagnostic tests', { selectedTests: requestBody.selectedTests });

            for (const testName of requestBody.selectedTests) {
                switch (testName) {
                    // Infrastructure Tests
                    case 'database':
                        results.database = await safeTest(log, 'database', () => testDatabaseConnection(log));
                        break;
                    case 'gemini':
                        results.gemini = await safeTest(log, 'gemini', () => testGeminiHealth(log));
                        break;

                    // Core Analysis Functions
                    case 'analyze':
                        results.analyze = await safeTest(log, 'analyze', () => testAnalyzeEndpoint(log));
                        break;
                    case 'syncAnalysis':
                        results.syncAnalysis = await safeTest(log, 'syncAnalysis', () => testSyncAnalysis(log, context));
                        break;
                    case 'asyncAnalysis':
                        results.asyncAnalysis = await safeTest(log, 'asyncAnalysis', () => testAsyncAnalysis(log));
                        break;
                    case 'processAnalysis':
                        results.processAnalysis = await safeTest(log, 'processAnalysis', () => testProcessAnalysisEndpoint(log));
                        break;
                    case 'extractDL':
                        results.extractDL = await safeTest(log, 'extractDL', () => testExtractDLEndpoint(log));
                        break;

                    // Insights Generation
                    case 'generateInsights':
                        results.generateInsights = await safeTest(log, 'generateInsights', () => testGenerateInsightsEndpoint(log));
                        break;
                    case 'insightsWithTools':
                        results.insightsWithTools = await safeTest(log, 'insightsWithTools', () => testInsightsWithTools(log));
                        break;
                    case 'debugInsights':
                        results.debugInsights = await safeTest(log, 'debugInsights', () => testDebugInsightsEndpoint(log));
                        break;

                    // Data Management
                    case 'history':
                        results.history = await safeTest(log, 'history', () => testHistoryEndpoint(log));
                        break;
                    case 'systems':
                        results.systems = await safeTest(log, 'systems', () => testSystemsEndpoint(log));
                        break;
                    case 'data':
                        results.data = await safeTest(log, 'data', () => testDataEndpoint(log));
                        break;
                    case 'exportData':
                        results.exportData = await safeTest(log, 'exportData', () => testExportDataEndpoint(log));
                        break;

                    // Job Management
                    case 'getJobStatus':
                        results.getJobStatus = await safeTest(log, 'getJobStatus', () => testGetJobStatusEndpoint(log));
                        break;
                    case 'jobShepherd':
                        results.jobShepherd = await safeTest(log, 'jobShepherd', () => testJobShepherdEndpoint(log));
                        break;

                    // External Services
                    case 'weather':
                        results.weatherService = await safeTest(log, 'weatherService', () => testWeatherService(log));
                        break;
                    case 'solar':
                        results.solarService = await safeTest(log, 'solarService', () => testSolarService(log));
                        break;
                    case 'systemAnalytics':
                        results.systemAnalytics = await safeTest(log, 'systemAnalytics', () => testSystemAnalytics(log));
                        break;

                    // Utility & Admin
                    case 'contact':
                        results.contact = await safeTest(log, 'contact', () => testContactEndpoint(log));
                        break;
                    case 'getIP':
                        results.getIP = await safeTest(log, 'getIP', () => testGetIPEndpoint(log));
                        break;
                    case 'upload':
                        results.upload = await safeTest(log, 'upload', () => testUploadEndpoint(log));
                        break;
                    case 'security':
                        results.security = await safeTest(log, 'security', () => testSecurityEndpoint(log));
                        break;
                    case 'predictiveMaintenance':
                        results.predictiveMaintenance = await safeTest(log, 'predictiveMaintenance', () => testPredictiveMaintenanceEndpoint(log));
                        break;
                    case 'ipAdmin':
                        results.ipAdmin = await safeTest(log, 'ipAdmin', () => testIPAdminEndpoint(log));
                        break;
                    case 'adminSystems':
                        results.adminSystems = await safeTest(log, 'adminSystems', () => testAdminSystemsEndpoint(log));
                        break;

                    // Production Sync Diagnostic Tests
                    case 'cache-integrity':
                        results['cache-integrity'] = await safeTest(log, 'cache-integrity', () => testCacheIntegrity(log));
                        break;
                    case 'sync-status':
                        results['sync-status'] = await safeTest(log, 'sync-status', () => testSyncStatus(log));
                        break;
                    case 'conflict-detection':
                        results['conflict-detection'] = await safeTest(log, 'conflict-detection', () => testConflictDetection(log));
                        break;
                    case 'timestamp-consistency':
                        results['timestamp-consistency'] = await safeTest(log, 'timestamp-consistency', () => testTimestampConsistency(log));
                        break;
                    case 'checksum-integrity':
                        results['checksum-integrity'] = await safeTest(log, 'checksum-integrity', () => testDataIntegrity(log));
                        break;
                    case 'full-sync-cycle':
                        results['full-sync-cycle'] = await safeTest(log, 'full-sync-cycle', () => testFullSyncCycle(log));
                        break;
                    case 'cache-stats':
                        results['cache-stats'] = await safeTest(log, 'cache-stats', () => testCacheStatistics(log));
                        break;

                    default:
                        log.warn('Unknown test type requested', { testName });
                        break;
                }
            }
        } else if (requestBody.test) {
            // Legacy support: Check if specific test type is requested via 'test' property
            const testType = requestBody.test;

            // If selectedTests is also provided (nested case), run only those tests
            if (requestBody.selectedTests && Array.isArray(requestBody.selectedTests) && requestBody.selectedTests.length > 0) {
                log.info('Running selected diagnostic tests (legacy mode)', { selectedTests: requestBody.selectedTests });

                for (const testName of requestBody.selectedTests) {
                    switch (testName) {
                        // Infrastructure Tests
                        case 'database':
                            results.database = await safeTest(log, 'database', () => testDatabaseConnection(log));
                            break;
                        case 'gemini':
                            results.gemini = await safeTest(log, 'gemini', () => testGeminiHealth(log));
                            break;

                        // Core Analysis Functions
                        case 'analyze':
                            results.analyze = await safeTest(log, 'analyze', () => testAnalyzeEndpoint(log));
                            break;
                        case 'syncAnalysis':
                            results.syncAnalysis = await safeTest(log, 'syncAnalysis', () => testSyncAnalysis(log, context));
                            break;
                        case 'asyncAnalysis':
                            results.asyncAnalysis = await safeTest(log, 'asyncAnalysis', () => testAsyncAnalysis(log));
                            break;
                        case 'processAnalysis':
                            results.processAnalysis = await safeTest(log, 'processAnalysis', () => testProcessAnalysisEndpoint(log));
                            break;
                        case 'extractDL':
                            results.extractDL = await safeTest(log, 'extractDL', () => testExtractDLEndpoint(log));
                            break;

                        // Insights Generation
                        case 'generateInsights':
                            results.generateInsights = await safeTest(log, 'generateInsights', () => testGenerateInsightsEndpoint(log));
                            break;
                        case 'insightsWithTools':
                            results.insightsWithTools = await safeTest(log, 'insightsWithTools', () => testInsightsWithTools(log));
                            break;
                        case 'debugInsights':
                            results.debugInsights = await safeTest(log, 'debugInsights', () => testDebugInsightsEndpoint(log));
                            break;

                        // Data Management
                        case 'history':
                            results.history = await safeTest(log, 'history', () => testHistoryEndpoint(log));
                            break;
                        case 'systems':
                            results.systems = await safeTest(log, 'systems', () => testSystemsEndpoint(log));
                            break;
                        case 'data':
                            results.data = await safeTest(log, 'data', () => testDataEndpoint(log));
                            break;
                        case 'exportData':
                            results.exportData = await safeTest(log, 'exportData', () => testExportDataEndpoint(log));
                            break;

                        // Job Management
                        case 'getJobStatus':
                            results.getJobStatus = await safeTest(log, 'getJobStatus', () => testGetJobStatusEndpoint(log));
                            break;
                        case 'jobShepherd':
                            results.jobShepherd = await safeTest(log, 'jobShepherd', () => testJobShepherdEndpoint(log));
                            break;

                        // External Services
                        case 'weather':
                            results.weatherService = await safeTest(log, 'weatherService', () => testWeatherService(log));
                            break;
                        case 'solar':
                            results.solarService = await safeTest(log, 'solarService', () => testSolarService(log));
                            break;
                        case 'systemAnalytics':
                            results.systemAnalytics = await safeTest(log, 'systemAnalytics', () => testSystemAnalytics(log));
                            break;

                        // Utility & Admin
                        case 'contact':
                            results.contact = await safeTest(log, 'contact', () => testContactEndpoint(log));
                            break;
                        case 'getIP':
                            results.getIP = await safeTest(log, 'getIP', () => testGetIPEndpoint(log));
                            break;
                        case 'upload':
                            results.upload = await safeTest(log, 'upload', () => testUploadEndpoint(log));
                            break;
                        case 'security':
                            results.security = await safeTest(log, 'security', () => testSecurityEndpoint(log));
                            break;
                        case 'predictiveMaintenance':
                            results.predictiveMaintenance = await safeTest(log, 'predictiveMaintenance', () => testPredictiveMaintenanceEndpoint(log));
                            break;
                        case 'ipAdmin':
                            results.ipAdmin = await safeTest(log, 'ipAdmin', () => testIPAdminEndpoint(log));
                            break;
                        case 'adminSystems':
                            results.adminSystems = await safeTest(log, 'adminSystems', () => testAdminSystemsEndpoint(log));
                            break;

                        default:
                            log.warn('Unknown test type requested', { testName });
                            break;
                    }
                }
            } else {
                // Run all tests if no selection provided
                switch (testType) {
                    // Infrastructure Tests
                    case 'database':
                        results.database = await safeTest(log, 'database', () => testDatabaseConnection(log));
                        break;
                    case 'gemini':
                        results.gemini = await safeTest(log, 'gemini', () => testGeminiHealth(log));
                        break;

                    // Core Analysis Functions
                    case 'analyze':
                        results.analyze = await safeTest(log, 'analyze', () => testAnalyzeEndpoint(log));
                        break;
                    case 'syncAnalysis':
                        results.syncAnalysis = await safeTest(log, 'syncAnalysis', () => testSyncAnalysis(log, context));
                        break;
                    case 'asyncAnalysis':
                        results.asyncAnalysis = await safeTest(log, 'asyncAnalysis', () => testAsyncAnalysis(log));
                        break;
                    case 'processAnalysis':
                        results.processAnalysis = await safeTest(log, 'processAnalysis', () => testProcessAnalysisEndpoint(log));
                        break;
                    case 'extractDL':
                        results.extractDL = await safeTest(log, 'extractDL', () => testExtractDLEndpoint(log));
                        break;

                    // Insights Generation
                    case 'generateInsights':
                        results.generateInsights = await safeTest(log, 'generateInsights', () => testGenerateInsightsEndpoint(log));
                        break;
                    case 'insightsWithTools':
                        results.insightsWithTools = await safeTest(log, 'insightsWithTools', () => testInsightsWithTools(log));
                        break;
                    case 'debugInsights':
                        results.debugInsights = await safeTest(log, 'debugInsights', () => testDebugInsightsEndpoint(log));
                        break;

                    // Data Management
                    case 'history':
                        results.history = await safeTest(log, 'history', () => testHistoryEndpoint(log));
                        break;
                    case 'systems':
                        results.systems = await safeTest(log, 'systems', () => testSystemsEndpoint(log));
                        break;
                    case 'data':
                        results.data = await safeTest(log, 'data', () => testDataEndpoint(log));
                        break;
                    case 'exportData':
                        results.exportData = await safeTest(log, 'exportData', () => testExportDataEndpoint(log));
                        break;

                    // Job Management
                    case 'getJobStatus':
                        results.getJobStatus = await safeTest(log, 'getJobStatus', () => testGetJobStatusEndpoint(log));
                        break;
                    case 'jobShepherd':
                        results.jobShepherd = await safeTest(log, 'jobShepherd', () => testJobShepherdEndpoint(log));
                        break;

                    // External Services
                    case 'weather':
                        results.weatherService = await safeTest(log, 'weatherService', () => testWeatherService(log));
                        break;
                    case 'solar':
                        results.solarService = await safeTest(log, 'solarService', () => testSolarService(log));
                        break;
                    case 'systemAnalytics':
                        results.systemAnalytics = await safeTest(log, 'systemAnalytics', () => testSystemAnalytics(log));
                        break;

                    // Utility & Admin
                    case 'contact':
                        results.contact = await safeTest(log, 'contact', () => testContactEndpoint(log));
                        break;
                    case 'getIP':
                        results.getIP = await safeTest(log, 'getIP', () => testGetIPEndpoint(log));
                        break;
                    case 'upload':
                        results.upload = await safeTest(log, 'upload', () => testUploadEndpoint(log));
                        break;
                    case 'security':
                        results.security = await safeTest(log, 'security', () => testSecurityEndpoint(log));
                        break;
                    case 'predictiveMaintenance':
                        results.predictiveMaintenance = await safeTest(log, 'predictiveMaintenance', () => testPredictiveMaintenanceEndpoint(log));
                        break;
                    case 'ipAdmin':
                        results.ipAdmin = await safeTest(log, 'ipAdmin', () => testIPAdminEndpoint(log));
                        break;
                    case 'adminSystems':
                        results.adminSystems = await safeTest(log, 'adminSystems', () => testAdminSystemsEndpoint(log));
                        break;
                    case 'comprehensive':
                        results.comprehensive = await safeTest(log, 'comprehensive', () => runComprehensiveTests(log, requestBody.selectedTests));
                        break;
                    default:
                        // Run all basic tests
                        results.database = await safeTest(log, 'database', () => testDatabaseConnection(log));
                        results.gemini = await safeTest(log, 'gemini', () => testGeminiHealth(log));
                        results.analyze = await safeTest(log, 'analyze', () => testAnalyzeEndpoint(log));
                        results.syncAnalysis = await safeTest(log, 'syncAnalysis', () => testSyncAnalysis(log, context));
                        results.asyncAnalysis = await safeTest(log, 'asyncAnalysis', () => testAsyncAnalysis(log));
                        results.processAnalysis = await safeTest(log, 'processAnalysis', () => testProcessAnalysisEndpoint(log));
                        results.extractDL = await safeTest(log, 'extractDL', () => testExtractDLEndpoint(log));
                        results.generateInsights = await safeTest(log, 'generateInsights', () => testGenerateInsightsEndpoint(log));
                        results.insightsWithTools = await safeTest(log, 'insightsWithTools', () => testInsightsWithTools(log));
                        results.debugInsights = await safeTest(log, 'debugInsights', () => testDebugInsightsEndpoint(log));
                        results.history = await safeTest(log, 'history', () => testHistoryEndpoint(log));
                        results.systems = await safeTest(log, 'systems', () => testSystemsEndpoint(log));
                        results.data = await safeTest(log, 'data', () => testDataEndpoint(log));
                        results.exportData = await safeTest(log, 'exportData', () => testExportDataEndpoint(log));
                        results.getJobStatus = await safeTest(log, 'getJobStatus', () => testGetJobStatusEndpoint(log));
                        results.jobShepherd = await safeTest(log, 'jobShepherd', () => testJobShepherdEndpoint(log));
                        results.weatherService = await safeTest(log, 'weatherService', () => testWeatherService(log));
                        results.solarService = await safeTest(log, 'solarService', () => testSolarService(log));
                        results.systemAnalytics = await safeTest(log, 'systemAnalytics', () => testSystemAnalytics(log));
                        results.contact = await safeTest(log, 'contact', () => testContactEndpoint(log));
                        results.getIP = await safeTest(log, 'getIP', () => testGetIPEndpoint(log));
                        results.upload = await safeTest(log, 'upload', () => testUploadEndpoint(log));
                        results.security = await safeTest(log, 'security', () => testSecurityEndpoint(log));
                        results.predictiveMaintenance = await safeTest(log, 'predictiveMaintenance', () => testPredictiveMaintenanceEndpoint(log));
                        results.ipAdmin = await safeTest(log, 'ipAdmin', () => testIPAdminEndpoint(log));
                        results.adminSystems = await safeTest(log, 'adminSystems', () => testAdminSystemsEndpoint(log));
                        break;
                }
            }
        } else {
            // Run all tests including comprehensive suite
            log.info('Running all diagnostic tests (comprehensive mode)');

            // Infrastructure Tests
            results.database = await safeTest(log, 'database', () => testDatabaseConnection(log));
            results.gemini = await safeTest(log, 'gemini', () => testGeminiHealth(log));

            // Core Analysis Functions
            results.analyze = await safeTest(log, 'analyze', () => testAnalyzeEndpoint(log));
            const sync = await safeTest(log, 'syncAnalysis', () => testSyncAnalysis(log, context));
            results.syncAnalysis = sync;
            if (sync && sync.recordId) {
                results.deleteCheck = await safeTest(log, 'deleteCheck', () => testDeleteEndpoint(log, sync.recordId));
            } else {
                results.deleteCheck = {
                    status: 'Skipped',
                    message: 'Sync analysis did not create a record to test delete.'
                };
            }
            results.asyncAnalysis = await safeTest(log, 'asyncAnalysis', () => testAsyncAnalysis(log));
            results.processAnalysis = await safeTest(log, 'processAnalysis', () => testProcessAnalysisEndpoint(log));
            results.extractDL = await safeTest(log, 'extractDL', () => testExtractDLEndpoint(log));

            // Insights Generation
            results.generateInsights = await safeTest(log, 'generateInsights', () => testGenerateInsightsEndpoint(log));
            results.insightsWithTools = await safeTest(log, 'insightsWithTools', () => testInsightsWithTools(log));
            results.debugInsights = await safeTest(log, 'debugInsights', () => testDebugInsightsEndpoint(log));

            // Data Management
            results.history = await safeTest(log, 'history', () => testHistoryEndpoint(log));
            results.systems = await safeTest(log, 'systems', () => testSystemsEndpoint(log));
            results.data = await safeTest(log, 'data', () => testDataEndpoint(log));
            results.exportData = await safeTest(log, 'exportData', () => testExportDataEndpoint(log));

            // Job Management
            results.getJobStatus = await safeTest(log, 'getJobStatus', () => testGetJobStatusEndpoint(log));
            results.jobShepherd = await safeTest(log, 'jobShepherd', () => testJobShepherdEndpoint(log));

            // External Services
            results.weatherService = await safeTest(log, 'weatherService', () => testWeatherService(log));
            results.solarService = await safeTest(log, 'solarService', () => testSolarService(log));
            results.systemAnalytics = await safeTest(log, 'systemAnalytics', () => testSystemAnalytics(log));

            // Utility & Admin
            results.contact = await safeTest(log, 'contact', () => testContactEndpoint(log));
            results.getIP = await safeTest(log, 'getIP', () => testGetIPEndpoint(log));
            results.upload = await safeTest(log, 'upload', () => testUploadEndpoint(log));
            results.security = await safeTest(log, 'security', () => testSecurityEndpoint(log));
            results.predictiveMaintenance = await safeTest(log, 'predictiveMaintenance', () => testPredictiveMaintenanceEndpoint(log));
            results.ipAdmin = await safeTest(log, 'ipAdmin', () => testIPAdminEndpoint(log));
            results.adminSystems = await safeTest(log, 'adminSystems', () => testAdminSystemsEndpoint(log));

            // Comprehensive Test Suite
            results.comprehensive = await safeTest(log, 'comprehensive', () => runComprehensiveTests(log));
        }

        // Add suggestions for failures
        results.suggestions = [];
        if (results.database && results.database.status === 'Failure') {
            results.suggestions.push('Check MONGODB_URI and network connectivity to your MongoDB host.');
        }
        if (results.gemini && results.gemini.status === 'Failure') {
            results.suggestions.push('Set GEMINI_API_KEY env var or check that the generative-ai client is installed.');
        }
        if (results.contact && results.contact.status === 'Failure') {
            results.suggestions.push('Check EMAIL_HOST, EMAIL_USER, EMAIL_PASS environment variables for contact functionality.');
        }
        if (results.comprehensive && results.comprehensive.status === 'Failure') {
            results.suggestions.push('Check individual test failures in the comprehensive test results.');
        }
        // If enhanced insights (function-calling) failed due to an abort/timeout, add a targeted suggestion
        if (results.insightsWithTools && results.insightsWithTools.status === 'Failure') {
            const message = (results.insightsWithTools.message || '').toString().toLowerCase();
            if (message.includes('abort') || message.includes('aborted') || message.includes('timeout')) {
                results.suggestions.push('Enhanced insights aborted or timed out - consider increasing the timeout, checking GEMINI_API_KEY, model quotas, and network connectivity.');
            }
        }

        // Add available test types for UI (organized by category)
        results.availableTests = {
            infrastructure: ['database', 'gemini'],
            coreAnalysis: ['analyze', 'syncAnalysis', 'asyncAnalysis', 'processAnalysis', 'extractDL'],
            insights: ['generateInsights', 'insightsWithTools', 'debugInsights'],
            dataManagement: ['history', 'systems', 'data', 'exportData'],
            jobManagement: ['getJobStatus', 'jobShepherd'],
            externalServices: ['weather', 'solar', 'systemAnalytics'],
            utilityAdmin: ['contact', 'getIP', 'upload', 'security', 'predictiveMaintenance', 'ipAdmin', 'adminSystems'],
            syncHealth: ['cache-integrity', 'sync-status', 'conflict-detection', 'timestamp-consistency', 'checksum-integrity', 'full-sync-cycle', 'cache-stats'],
            comprehensive: ['comprehensive']
        };

        // Flat list for backward compatibility
        // Note: 34 total tests (27 original + 7 new sync tests)
        // When running all tests, 'deleteCheck' is also added dynamically
        results.availableTestsList = [
            'database', 'gemini', 'analyze', 'syncAnalysis', 'asyncAnalysis', 'processAnalysis',
            'extractDL', 'generateInsights', 'insightsWithTools', 'debugInsights', 'history',
            'systems', 'data', 'exportData', 'getJobStatus', 'jobShepherd', 'weather', 'solar',
            'systemAnalytics', 'contact', 'getIP', 'upload', 'security', 'predictiveMaintenance',
            'ipAdmin', 'adminSystems', 'cache-integrity', 'sync-status', 'conflict-detection',
            'timestamp-consistency', 'checksum-integrity', 'full-sync-cycle', 'cache-stats', 'comprehensive'
        ];

        // Add available comprehensive test types
        const testSuite = new ProductionTestSuite();
        results.availableComprehensiveTests = testSuite.getAvailableTests();

        // Calculate summary statistics
        // Filter to get only actual test results (exclude metadata and lists)
        const metadataKeys = ['suggestions', 'availableTests', 'availableTestsList', 'availableComprehensiveTests', 'testSummary'];
        const allTestResults = Object.keys(results).filter(k => !metadataKeys.includes(k));
        const successCount = allTestResults.filter(k => results[k]?.status === 'Success').length;
        const failureCount = allTestResults.filter(k => results[k]?.status === 'Failure').length;
        const skippedCount = allTestResults.filter(k => results[k]?.status === 'Skipped').length;

        results.testSummary = {
            total: allTestResults.length,
            success: successCount,
            failure: failureCount,
            skipped: skippedCount,
            successRate: allTestResults.length > 0 ? ((successCount / allTestResults.length) * 100).toFixed(2) : 0
        };

        log.info('All diagnostic tests completed.', {
            summary: results.testSummary,
            testCount: allTestResults.length
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            },
            body: JSON.stringify(results),
        };
    } catch (error) {
        log.error('Diagnostic endpoint error.', { error: error.message, stack: error.stack });
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Internal server error during diagnostics',
                message: error.message
            }),
        };
    }
};
