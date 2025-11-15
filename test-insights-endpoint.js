/**
 * Quick test to verify generate-insights-with-tools endpoint works
 */

// Mock event and context
const mockEvent = {
  httpMethod: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    analysisData: {
      overallVoltage: 52.4,
      current: -5.2,
      stateOfCharge: 85,
      temperature: 25,
      cellVoltageDifference: 0.008
    },
    systemId: 'test-system-123',
    customPrompt: 'What is my current battery status?',
    mode: 'sync'
  })
};

const mockContext = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'generate-insights-with-tools-test',
  functionVersion: '1',
  invokedFunctionArn: 'test-arn',
  memoryLimitInMB: '1024',
  awsRequestId: 'test-request-id',
  logGroupName: 'test-log-group',
  logStreamName: 'test-log-stream'
};

async function testEndpoint() {
  console.log('🧪 Testing generate-insights-with-tools endpoint...\n');

  try {
    // Load the handler
    const { handler } = require('./netlify/functions/generate-insights-with-tools.cjs');

    console.log('✅ Handler loaded successfully');
    console.log('📤 Sending test request...\n');

    // Call the handler
    const result = await handler(mockEvent, mockContext);

    console.log('📥 Response received:');
    console.log('Status Code:', result.statusCode);
    console.log('Headers:', JSON.stringify(result.headers, null, 2));
    
    if (result.body) {
      const body = JSON.parse(result.body);
      console.log('\nResponse Body:');
      console.log(JSON.stringify(body, null, 2));
      
      if (body.success) {
        console.log('\n✅ TEST PASSED: Endpoint returned success');
        if (body.insights) {
          console.log('✅ Insights generated successfully');
          console.log('📊 Metadata:', body.metadata);
        }
      } else if (body.jobId) {
        console.log('\n✅ TEST PASSED: Background job created');
        console.log('🔄 Job ID:', body.jobId);
      } else {
        console.log('\n❌ TEST FAILED: Unexpected response');
      }
    }

    return result.statusCode === 200 || result.statusCode === 202 ? 0 : 1;

  } catch (error) {
    console.error('\n❌ TEST FAILED with error:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    return 1;
  }
}

// Run test
testEndpoint()
  .then(exitCode => {
    console.log('\n' + '='.repeat(60));
    console.log(exitCode === 0 ? '✅ All tests passed!' : '❌ Tests failed!');
    console.log('='.repeat(60));
    process.exit(exitCode);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
