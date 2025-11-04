const { generateHandler } = require('../netlify/functions/generate-insights.cjs.new');

async function runTests() {
  console.log('Starting tests...\n');
  
  // Test 1: Empty input
  console.log('Test 1: Empty input');
  try {
    const result = await generateHandler();
    console.log('✓ Handled empty input correctly');
    console.log('Result:', result);
  } catch (error) {
    console.error('✗ Failed empty input test:', error);
  }

  // Test 2: Invalid JSON input
  console.log('\nTest 2: Invalid JSON input');
  try {
    const result = await generateHandler({
      body: 'invalid json'
    });
    console.log('✓ Handled invalid JSON correctly');
    console.log('Result:', result);
  } catch (error) {
    console.error('✗ Failed invalid JSON test:', error);
  }

  // Test 3: Valid empty measurements
  console.log('\nTest 3: Valid empty measurements');
  try {
    const result = await generateHandler({
      body: JSON.stringify({
        measurements: []
      })
    });
    console.log('✓ Handled empty measurements correctly');
    console.log('Result:', result);
  } catch (error) {
    console.error('✗ Failed empty measurements test:', error);
  }

  // Test 4: Valid measurements
  console.log('\nTest 4: Valid measurements');
  try {
    const result = await generateHandler({
      body: JSON.stringify({
        measurements: [
          {
            timestamp: new Date().toISOString(),
            voltage: 12.5,
            current: 1.2,
            temperature: 25,
            stateOfCharge: 85
          }
        ]
      })
    });
    console.log('✓ Handled valid measurements correctly');
    console.log('Result:', result);
  } catch (error) {
    console.error('✗ Failed valid measurements test:', error);
  }
}

runTests().catch(console.error);