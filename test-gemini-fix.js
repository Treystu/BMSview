/**
 * Test script to verify Gemini API configuration
 * Run with: node test-gemini-fix.js
 */

const { getGeminiClient } = require('./netlify/functions/utils/geminiClient.js');

async function testGeminiAPI() {
    console.log('Testing Gemini API Configuration...\n');

    // Test 1: Check API Key
    console.log('Test 1: Checking API Key Configuration');
    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY is not set');
        console.log('Please set GEMINI_API_KEY environment variable');
        return false;
    }
    console.log('✅ GEMINI_API_KEY is configured\n');

    // Test 2: Check Model Name
    console.log('Test 2: Checking Model Name');
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    console.log(`Model: ${modelName}`);
    
    // Verify it's not using the old incorrect model name
    if (modelName === 'gemini-1.5-flash-latest') {
        console.error('❌ Using incorrect model name: gemini-1.5-flash-latest');
        console.log('Should use: gemini-1.5-flash');
        return false;
    }
    console.log('✅ Model name is correct\n');

    // Test 3: Test API Endpoint
    console.log('Test 3: Testing API Endpoint');
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    console.log(`Endpoint: https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`);

    try {
        const geminiClient = getGeminiClient();
        console.log('✅ Gemini client initialized\n');

        // Test 4: Simple API Call
        console.log('Test 4: Making test API call');
        const testPrompt = 'Say "Hello, BMSview!" in exactly those words.';
        
        const mockLogger = {
            info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
            warn: (msg, data) => console.log(`[WARN] ${msg}`, data || ''),
            error: (msg, data) => console.log(`[ERROR] ${msg}`, data || '')
        };

        const result = await geminiClient.callAPI(testPrompt, { model: modelName }, mockLogger);
        
        if (result && result.candidates && result.candidates[0]) {
            const responseText = result.candidates[0].content.parts[0].text;
            console.log(`Response: ${responseText}`);
            console.log('✅ API call successful\n');
            return true;
        } else {
            console.error('❌ Invalid response structure');
            console.log('Response:', JSON.stringify(result, null, 2));
            return false;
        }

    } catch (error) {
        console.error('❌ API call failed');
        console.error('Error:', error.message);
        if (error.status) {
            console.error('Status:', error.status);
        }
        if (error.body) {
            console.error('Body:', error.body);
        }
        return false;
    }
}

// Run the test
testGeminiAPI()
    .then(success => {
        console.log('\n' + '='.repeat(50));
        if (success) {
            console.log('✅ All tests passed! Gemini API is configured correctly.');
        } else {
            console.log('❌ Some tests failed. Please check the configuration.');
        }
        console.log('='.repeat(50));
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error('\n❌ Test script error:', error);
        process.exit(1);
    });