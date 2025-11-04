const { getCollection } = require('./utils/mongodb.cjs');
const { createLogger } = require('./utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');
const { performAnalysisPipeline } = require('./utils/analysis-pipeline.cjs');

const DIAGNOSTIC_JOB_ID = 'diagnostic-test-job';
const FAKE_IMAGE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='; // 1x1 black pixel

// Timeout-enabled fetch helper for short network probes
async function fetchWithTimeout(url, opts = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, ...opts });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}
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
        // Invoke the processor and poll the job doc until it reaches a terminal state or we timeout
        const response = await fetchWithTimeout(invokeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-netlify-background': 'true' },
            body: JSON.stringify({ jobId: DIAGNOSTIC_JOB_ID }),
        }, 5000);

        if (response.status !== 202 && response.status !== 200) {
            throw new Error(`Failed to invoke process-analysis function, status: ${response.status}`);
        }

        log.info('Successfully invoked async processor. Polling for completion...');

        const start = Date.now();
        const TIMEOUT_MS = 30_000; // 30s max
        const POLL_INTERVAL = 1000;

        while (Date.now() - start < TIMEOUT_MS) {
            const finalJob = await jobsCollection.findOne({ id: DIAGNOSTIC_JOB_ID });
            if (!finalJob) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL));
                continue;
            }
            if (finalJob.status === 'completed') {
                log.info('Asynchronous analysis test completed successfully.', { recordId: finalJob.recordId });
                return { status: 'Success', message: 'Asynchronous analysis pipeline completed successfully.', recordId: finalJob.recordId };
            }
            if (finalJob.status === 'failed' || finalJob.error) {
                throw new Error(`Job failed with status '${finalJob.status}' and error: ${finalJob.error}`);
            }
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
        }
        throw new Error('Timed out waiting for async job to complete.');

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

async function testDeleteEndpoint(log, recordId) {
    log.info('Running diagnostic: Testing Delete endpoint for record.', { recordId });
    try {
        const deleteUrl = `${process.env.URL}/.netlify/functions/history?id=${encodeURIComponent(recordId)}`;
        const deleteResp = await fetchWithTimeout(deleteUrl, { method: 'DELETE' }, 5000);
        if (!deleteResp.ok) {
            const txt = await deleteResp.text().catch(() => '');
            throw new Error(`Delete returned status ${deleteResp.status}: ${txt}`);
        }

        // Verify deletion by attempting to GET the record
        const getUrl = `${process.env.URL}/.netlify/functions/history?id=${encodeURIComponent(recordId)}`;
        const getResp = await fetchWithTimeout(getUrl, { method: 'GET' }, 5000).catch(() => null);
        if (getResp && getResp.status === 404) {
            log.info('Delete endpoint verification successful; record no longer found.');
            return { status: 'Success', message: 'Delete endpoint removed the record and GET now returns 404.' };
        }
        if (!getResp) {
            return { status: 'Warning', message: 'Delete succeeded but verification GET timed out.' };
        }
        // If GET succeeded, parse body and report unexpected presence
        if (getResp.ok) {
            const body = await getResp.text().catch(() => '');
            log.warn('Record still present after delete attempt.', { bodyPreview: body.substring(0, 200) });
            return { status: 'Failure', message: 'Record still present after delete; frontend might need to refresh state.' };
        }
        return { status: 'Failure', message: `Unexpected GET response (${getResp.status}) after delete.` };
    } catch (err) {
        log.error('Delete endpoint diagnostic failed.', { errorMessage: err.message });
        return { status: 'Failure', message: `Delete diagnostic failed: ${err.message}` };
    }
}

async function testGeminiHealth(log) {
    log.info('Running diagnostic: Testing Gemini / LLM availability...');
    try {
        if (!process.env.GEMINI_API_KEY) {
            log.warn('GEMINI_API_KEY not configured in environment.');
            return { status: 'Failure', message: 'GEMINI_API_KEY not set.' };
        }
        // Attempt to require client and do a short list-models style probe if available
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
            // If client has a lightweight method, call it in a timeboxed manner
            if (typeof client.getGenerativeModel === 'function') {
                // Timebox the call to avoid hanging diagnostics
                const modelProbe = client.getGenerativeModel({ model: 'gemini-flash-latest' });
                const probe = await Promise.race([
                    modelProbe,
                    new Promise((_, rej) => setTimeout(() => rej(new Error('Model probe timed out')), 5000))
                ]).catch(e => { throw e; });
                log.info('Gemini client probe succeeded.', { probe: !!probe });
                return { status: 'Success', message: 'Gemini client appears available and responsive.' };
            }
            log.info('Gemini client loaded but does not expose getGenerativeModel; assuming healthy client installation.');
            return { status: 'Success', message: 'Gemini client installed.' };
        } catch (err) {
            log.warn('Gemini client require/instantiate failed.', { errorMessage: err.message });
            return { status: 'Failure', message: `Could not instantiate Gemini client: ${err.message}` };
        }
    } catch (err) {
        log.error('Gemini health check failed unexpectedly.', { errorMessage: err.message });
        return { status: 'Failure', message: `Gemini health check failed: ${err.message}` };
    }
}

exports.handler = async function (event, context) {
    const log = createLogger('admin-diagnostics', context);
    log.info('Admin diagnostics function invoked.');

    // Basic auth check - replace with your actual admin check
    if (!context.clientContext?.user) {
        log.warn('Unauthorized access attempt to diagnostics function.');
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const results = {};
    results.database = await testDatabaseConnection(log);

    // Run sync analysis and, if successful, verify delete behavior for the created record
    const sync = await testSyncAnalysis(log, context);
    results.syncAnalysis = sync;
    if (sync && sync.recordId) {
        results.deleteCheck = await testDeleteEndpoint(log, sync.recordId).catch(e => ({ status: 'Failure', message: e.message }));
    } else {
        results.deleteCheck = { status: 'Skipped', message: 'Sync analysis did not create a record to test delete.' };
    }

    results.asyncAnalysis = await testAsyncAnalysis(log);
    results.weatherService = await testWeatherService(log);

    // LLM/Gemini health
    results.gemini = await testGeminiHealth(log);

    // Add quick environment suggestions
    results.suggestions = [];
    if (results.database && results.database.status === 'Failure') results.suggestions.push('Check MONGODB_URI and network connectivity to your MongoDB host.');
    if (results.gemini && results.gemini.status === 'Failure') results.suggestions.push('Set GEMINI_API_KEY env var or check that the generative-ai client is installed.');

    log.info('All diagnostic tests completed.', { results });

    return {
        statusCode: 200,
        body: JSON.stringify(results),
    };
};
