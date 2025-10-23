
const { getCollection } = require('./utils/mongodb');
const { createLogger } = require('./utils/logger');
const { v4: uuidv4 } = require('uuid');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline');

const DIAGNOSTIC_JOB_ID = 'diagnostic-test-job';
const FAKE_IMAGE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='; // 1x1 black pixel

async function testDatabaseConnection(log) {
    log.info('Running diagnostic: Testing Database Connection...');
    try {
        const collection = await getCollection('systems');
        const count = await collection.countDocuments();
        log.info(`Successfully connected to database. Found ${count} systems.`);
        return { status: 'Success', message: `Successfully connected to database. Found ${count} systems.` };
    } catch (error) {
        log.error('Database connection test failed.', { errorMessage: error.message });
        return { status: 'Failure', message: `Database connection failed: ${error.message}` };
    }
}

async function testSyncAnalysis(log, context) {
    log.info('Running diagnostic: Testing Synchronous Analysis...');
    try {
        const image = {
            fileName: 'diagnostic-sync-test.png',
            image: FAKE_IMAGE_B64,
            mimeType: 'image/png',
            force: true, // Bypass duplicate checks
        };
        const result = await performAnalysisPipeline(image, { items: [] }, log, context);
        if (result && result.id) {
            log.info('Synchronous analysis test completed successfully.', { recordId: result.id });
            return { status: 'Success', message: 'Synchronous analysis pipeline completed successfully.', recordId: result.id };
        }
        throw new Error('Analysis pipeline did not return a valid record.');
    } catch (error) {
        log.error('Synchronous analysis test failed.', { errorMessage: error.message, stack: error.stack });
        return { status: 'Failure', message: `Synchronous analysis failed: ${error.message}` };
    }
}

async function testAsyncAnalysis(log) {
    log.info('Running diagnostic: Testing Asynchronous Analysis...');
    try {
        const jobsCollection = await getCollection('jobs');
        const testJob = {
            _id: DIAGNOSTIC_JOB_ID,
            id: DIAGNOSTIC_JOB_ID,
            fileName: 'diagnostic-async-test.png',
            status: 'Queued',
            image: FAKE_IMAGE_B64,
            mimeType: 'image/png',
            systems: { items: [] },
            createdAt: new Date(),
            retryCount: 0,
        };
        await jobsCollection.deleteOne({ id: DIAGNOSTIC_JOB_ID }); // Clean up previous runs
        await jobsCollection.insertOne(testJob);
        log.info('Test job inserted for async analysis.', { jobId: DIAGNOSTIC_JOB_ID });

        const invokeUrl = `${process.env.URL}/.netlify/functions/process-analysis`;
        const response = await fetch(invokeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-netlify-background': 'true' },
            body: JSON.stringify({ jobId: DIAGNOSTIC_JOB_ID }),
        });

        if (response.status !== 202 && response.status !== 200) {
            throw new Error(`Failed to invoke process-analysis function, status: ${response.status}`);
        }

        log.info('Successfully invoked async processor. Waiting for completion...');
        await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for processing

        const finalJob = await jobsCollection.findOne({ id: DIAGNOSTIC_JOB_ID });
        if (finalJob && finalJob.status === 'completed') {
            log.info('Asynchronous analysis test completed successfully.', { recordId: finalJob.recordId });
            return { status: 'Success', message: 'Asynchronous analysis pipeline completed successfully.', recordId: finalJob.recordId };
        }
        throw new Error(`Job status was '${finalJob?.status}' with error: ${finalJob?.error}`);

    } catch (error) {
        log.error('Asynchronous analysis test failed.', { errorMessage: error.message });
        return { status: 'Failure', message: `Asynchronous analysis failed: ${error.message}` };
    }
}

async function testWeatherService(log) {
    log.info('Running diagnostic: Testing Weather Service...');
    try {
        const weatherUrl = `${process.env.URL}/.netlify/functions/weather`;
        const response = await fetch(weatherUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: 35.6895, lon: 139.6917, timestamp: new Date().toISOString() }), // Tokyo
        });
        if (!response.ok) {
            throw new Error(`Weather service returned status ${response.status}`);
        }
        const data = await response.json();
        log.info('Weather service test successful.', { response: data });
        return { status: 'Success', message: 'Weather service responded successfully.' };
    } catch (error) {
        log.error('Weather service test failed.', { errorMessage: error.message });
        return { status: 'Failure', message: `Weather service test failed: ${error.message}` };
    }
}

exports.handler = async function(event, context) {
    const log = createLogger('admin-diagnostics', context);
    log.info('Admin diagnostics function invoked.');

    // Basic auth check - replace with your actual admin check
    if (!context.clientContext?.user) {
        log.warn('Unauthorized access attempt to diagnostics function.');
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const results = {};
    results.database = await testDatabaseConnection(log);
    results.syncAnalysis = await testSyncAnalysis(log, context);
    results.asyncAnalysis = await testAsyncAnalysis(log);
    results.weatherService = await testWeatherService(log);

    log.info('All diagnostic tests completed.', { results });

    return {
        statusCode: 200,
        body: JSON.stringify(results),
    };
};
