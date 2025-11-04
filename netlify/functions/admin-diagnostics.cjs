
const { getCollection } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');
const { ProductionTestSuite } = require('../../tests/production-test-suite.js');

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
            image: { fileName: 'diagnostic-async-test.png', image: FAKE_IMAGE_B64 }
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
    try {
        const weatherUrl = `${process.env.URL}/.netlify/functions/weather`;
        const response = await fetchWithTimeout(weatherUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, 5000);

        if (response.ok) {
            const data = await response.json();
            return {
                status: 'Success',
                message: 'Weather service responding correctly',
                data: data.location || 'Weather data available'
            };
        } else {
            return {
                status: 'Failure',
                message: `Weather service returned status: ${response.status}`
            };
        }
    } catch (error) {
        log.error('Weather service test failed.', { error: error.message });
        return {
            status: 'Failure',
            message: error.message
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
            const model = client.getGenerativeModel({ model: 'gemini-flash-latest' });

            // Simple test prompt
            const result = await Promise.race([
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

async function testDeleteEndpoint(log, recordId) {
    log.info('Running diagnostic: Testing Delete Endpoint...', { recordId });
    try {
        const deleteUrl = `${process.env.URL}/.netlify/functions/delete`;
        const response = await fetchWithTimeout(deleteUrl, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recordId })
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

        // Check if specific tests are requested
        if (requestBody.test) {
            const testType = requestBody.test;

            switch (testType) {
                case 'database':
                    results.database = await testDatabaseConnection(log);
                    break;
                case 'syncAnalysis':
                    results.syncAnalysis = await testSyncAnalysis(log, context);
                    break;
                case 'asyncAnalysis':
                    results.asyncAnalysis = await testAsyncAnalysis(log);
                    break;
                case 'weather':
                    results.weatherService = await testWeatherService(log);
                    break;
                case 'gemini':
                    results.gemini = await testGeminiHealth(log);
                    break;
                case 'comprehensive':
                    results.comprehensive = await runComprehensiveTests(log, requestBody.selectedTests);
                    break;
                default:
                    // Run all basic tests
                    results.database = await testDatabaseConnection(log);
                    results.syncAnalysis = await testSyncAnalysis(log, context);
                    results.asyncAnalysis = await testAsyncAnalysis(log);
                    results.weatherService = await testWeatherService(log);
                    results.gemini = await testGeminiHealth(log);
                    break;
            }
        } else {
            // Run all tests including comprehensive suite
            results.database = await testDatabaseConnection(log);

            const sync = await testSyncAnalysis(log, context);
            results.syncAnalysis = sync;
            if (sync && sync.recordId) {
                results.deleteCheck = await testDeleteEndpoint(log, sync.recordId).catch(e => ({
                    status: 'Failure',
                    message: e.message
                }));
            } else {
                results.deleteCheck = {
                    status: 'Skipped',
                    message: 'Sync analysis did not create a record to test delete.'
                };
            }

            results.asyncAnalysis = await testAsyncAnalysis(log);
            results.weatherService = await testWeatherService(log);
            results.gemini = await testGeminiHealth(log);
            results.comprehensive = await runComprehensiveTests(log);
        }

        // Add suggestions for failures
        results.suggestions = [];
        if (results.database && results.database.status === 'Failure') {
            results.suggestions.push('Check MONGODB_URI and network connectivity to your MongoDB host.');
        }
        if (results.gemini && results.gemini.status === 'Failure') {
            results.suggestions.push('Set GEMINI_API_KEY env var or check that the generative-ai client is installed.');
        }
        if (results.comprehensive && results.comprehensive.status === 'Failure') {
            results.suggestions.push('Check individual test failures in the comprehensive test results.');
        }

        // Add available test types for UI
        results.availableTests = [
            'database',
            'syncAnalysis',
            'asyncAnalysis',
            'weather',
            'gemini',
            'comprehensive'
        ];

        // Add available comprehensive test types
        const testSuite = new ProductionTestSuite();
        results.availableComprehensiveTests = testSuite.getAvailableTests();

        log.info('All diagnostic tests completed.', { results });

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
