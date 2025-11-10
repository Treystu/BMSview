/**
 * Manual test to verify admin-diagnostics endpoint works correctly
 * Run with: node tests/admin-diagnostics-manual.test.js
 */

const handler = require('../netlify/functions/admin-diagnostics.cjs').handler;

async function testDiagnostics() {
    console.log('Testing admin-diagnostics endpoint...\n');

    // Test 1: Call with no selectedTests (should run all tests)
    console.log('Test 1: Call with no selectedTests...');
    try {
        const event1 = {
            httpMethod: 'POST',
            body: JSON.stringify({}),
            headers: {}
        };
        const response1 = await handler(event1, {});
        const body1 = JSON.parse(response1.body);

        console.log('✅ Response status:', response1.statusCode);
        console.log('✅ Has testSummary:', !!body1.testSummary);
        console.log('✅ Test summary:', body1.testSummary);
        console.log('');
    } catch (error) {
        console.error('❌ Test 1 failed:', error.message);
    }

    // Test 2: Call with selectedTests array
    console.log('Test 2: Call with selectedTests array...');
    try {
        const event2 = {
            httpMethod: 'POST',
            body: JSON.stringify({
                selectedTests: ['database', 'gemini']
            }),
            headers: {}
        };
        const response2 = await handler(event2, {});
        const body2 = JSON.parse(response2.body);

        console.log('✅ Response status:', response2.statusCode);
        console.log('✅ Has database result:', !!body2.database);
        console.log('✅ Has gemini result:', !!body2.gemini);
        console.log('✅ Database status:', body2.database?.status);
        console.log('✅ Gemini status:', body2.gemini?.status);
        console.log('');
    } catch (error) {
        console.error('❌ Test 2 failed:', error.message);
    }

    // Test 3: Call with sync diagnostic tests
    console.log('Test 3: Call with sync diagnostic tests...');
    try {
        const event3 = {
            httpMethod: 'POST',
            body: JSON.stringify({
                selectedTests: ['cache-integrity', 'sync-status']
            }),
            headers: {}
        };
        const response3 = await handler(event3, {});
        const body3 = JSON.parse(response3.body);

        console.log('✅ Response status:', response3.statusCode);
        console.log('✅ Has cache-integrity result:', !!body3['cache-integrity']);
        console.log('✅ Has sync-status result:', !!body3['sync-status']);
        console.log('✅ Cache integrity status:', body3['cache-integrity']?.status);
        console.log('✅ Sync status:', body3['sync-status']?.status);
        console.log('');
    } catch (error) {
        console.error('❌ Test 3 failed:', error.message);
    }

    console.log('All tests completed!');
}

testDiagnostics().catch(console.error);
