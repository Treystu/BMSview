
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

// --- Configuration ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bms-dev';
const FUNCTION_URL = 'http://localhost:8888/.netlify/functions/process-analysis';
const DB_NAME = 'bms-dev';

// --- Sample Data ---
const TEST_JOB_ID = uuidv4();
const FAKE_IMAGE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='; // 1x1 black pixel

const sampleJob = {
    _id: TEST_JOB_ID,
    id: TEST_JOB_ID,
    fileName: 'test-image.png',
    status: 'Queued',
    image: FAKE_IMAGE_B64,
    mimeType: 'image/png',
    systems: { items: [] }, // Assuming no specific system is needed for this test
    createdAt: new Date(),
    retryCount: 0,
};

// --- Test Runner ---
async function runTest() {
    let client;
    console.log('Starting test for process-analysis function...');

    try {
        // 1. Connect to MongoDB
        console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db(DB_NAME);
        const jobsCollection = db.collection('jobs');
        console.log('MongoDB connected successfully.');

        // 2. Insert the sample job
        console.log(`Inserting test job with ID: ${TEST_JOB_ID}...`);
        await jobsCollection.insertOne(sampleJob);
        console.log('Test job inserted.');

        // 3. Invoke the Netlify function
        console.log(`Invoking function at ${FUNCTION_URL}...`);
        const response = await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-netlify-background': 'true' // Simulate background invocation
            },
            body: JSON.stringify({ jobId: TEST_JOB_ID }),
        });

        console.log(`Function response status: ${response.status}`);
        const responseBody = await response.json();
        console.log('Function response body:', responseBody);

        // 4. Verify the outcome
        if (response.status !== 200) {
            throw new Error(`Function returned status ${response.status}`);
        }
        if (responseBody.error) {
             throw new Error(`Function returned an error: ${responseBody.error}`);
        }

        console.log('Waiting for async processing to complete...');
        await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for Gemini call

        const finalJobState = await jobsCollection.findOne({ id: TEST_JOB_ID });
        console.log('Final job state:', finalJobState);

        if (!finalJobState) {
            throw new Error('Job was not found in the database after execution.');
        }

        if (finalJobState.status === 'failed') {
            console.error('--- TEST FAILED ---');
            console.error('Job failed during processing.');
            console.error('Error:', finalJobState.error);
        } else if (finalJobState.status === 'completed') {
            console.log('--- TEST PASSED ---');
            console.log('Job completed successfully.');
        } else {
             console.warn('--- TEST UNCERTAIN ---');
             console.warn(`Job is in an unexpected state: ${finalJobState.status}`);
        }

    } catch (error) {
        console.error('--- TEST FAILED ---');
        console.error('An error occurred during the test:', error.message);
        console.error(error.stack);
    } finally {
        // 5. Cleanup
        if (client) {
            console.log(`Cleaning up test job with ID: ${TEST_JOB_ID}...`);
            try {
                const db = client.db(DB_NAME);
                await db.collection('jobs').deleteOne({ id: TEST_JOB_ID });
                await db.collection('history').deleteOne({ fileName: 'test-image.png' });
                console.log('Cleanup complete.');
            } catch (cleanupError) {
                console.error('Failed to cleanup test data:', cleanupError.message);
            }
            await client.close();
        }
    }
}

// --- Environment Check ---
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL: GEMINI_API_KEY environment variable is not set.");
    console.error("Please create a .env file with your key to run this test.");
    process.exit(1);
}

if (require.main === module) {
    runTest();
}
